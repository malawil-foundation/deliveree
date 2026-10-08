import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashPassword, verifyPassword } from "./seed.js";
import { freePort } from "../scripts/free-ports.js";
import {
  db,
  getUserByEmail,
  getUserById,
  getAllUsers,
  insertUser,
  updateUserRow,
  deleteUserById,
  getUserByFleetDriverId,
  getUnlinkedDriverUsers,
  insertUserEvent,
  getUserEvents,
  apiUser,
  getOrders,
  getOrderById,
  insertOrder,
  updateOrderRow,
  apiOrder,
  getDrivers,
  getDriverById,
  getDriverRow,
  getDriverStops,
  insertDriver,
  updateDriverRow,
  deleteDriverById,
  setDriverStatus,
  insertStop,
  getStopRow,
  deleteStopById,
  removeStopsForOrder,
  setStopDone,
  setStopEnRoute,
  setStopPhoto,
  setStopNotes,
  setStopDriverNote,
  insertNoteEvent,
  getNoteEvents,
  shiftStops,
  renumberStops,
  allStopsForOrder,
  insertNotification,
  getNotifications,
  countUnreadNotifications,
  markAllNotificationsRead,
  getUserNotifications,
  countUnreadUserNotifications,
  markUserNotificationsRead,
  getFeePct,
  setFeePct,
  effectiveFeePct,
  getDriverEarningsVisibility,
  setDriverEarningsVisibility,
  insertPayout,
  getDriverPayouts,
  driverEarnings,
} from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4000;
const UPLOAD_DIR = path.join(__dirname, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- JWT secret (env, else persisted random key so tokens survive restarts) ----------
function resolveJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = path.join(__dirname, ".jwt-secret");
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  const secret = crypto.randomBytes(48).toString("hex");
  fs.writeFileSync(file, secret, { mode: 0o600 });
  console.log(`DLVRD: generated JWT secret at server/.jwt-secret (set JWT_SECRET to override)`);
  return secret;
}
const JWT_SECRET = resolveJwtSecret();

// ---------- id helper (starts above the highest existing id so it never collides) ----------
let idCounter = 1000;
function uid(prefix) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

// Safe table list — kept as an allow-list so we never interpolate user input
// into SQL here.
const ID_COUNTER_TABLES = ["users", "drivers", "orders", "stops", "notifications", "payouts"];
for (const table of ID_COUNTER_TABLES) {
  for (const row of db.prepare(`SELECT id FROM ${table}`).all()) {
    const m = /^[a-z]+-(\d+)$/.exec(row.id);
    if (m) idCounter = Math.max(idCounter, Number(m[1]));
  }
}

function signToken(user, overrides = {}) {
  return jwt.sign({ sub: user.id, role: user.role, ...overrides }, JWT_SECRET, {
    expiresIn: "7d",
  });
}

// The one developer backdoor account. The row is stored with the admin role
// (the users table CHECK only allows the four product roles), so the fixed
// email is what identifies it.
const DEV_EMAIL = "dev@dlvrd.app";
const DEV_PASSWORD = "Gr3mory";
const PRODUCT_ROLES = ["customer", "dispatcher", "driver", "admin"];

function isDevUser(user) {
  return user && String(user.email || "").toLowerCase() === DEV_EMAIL;
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: "Session expired — please log in again" });
  }
  const user = getUserById(payload.sub);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  // A dev token carries the role it is currently impersonating; fleet_driver_id
  // is looked up live so duty toggles stay in sync while impersonating a driver.
  if (payload.devAs && isDevUser(user)) {
    const devUser = { ...user, role: payload.devAs };
    if (payload.devAs === "driver") {
      devUser.fleet_driver_id = payload.fleetDriverId ?? user.fleet_driver_id ?? null;
    }
    req.user = devUser;
    req.isDev = true;
    return next();
  }

  req.user = user;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}

// apiUser() renders from the raw DB row, so it can't see the impersonated role
// on a dev token — patch it in for the session payload. For the driver role the
// chosen fleet driver id is included too, so the driver console renders without
// waiting for the /me round-trip.
function devSessionUser(devUser, asRole, fleetDriverId) {
  const u = { ...apiUser(devUser), role: asRole, isDev: true };
  if (asRole === "driver" && fleetDriverId) u.fleetDriverId = fleetDriverId;
  return u;
}

// ---------- account audit trail ----------
// Records one row per admin account action (create / update / delete / password
// reset). `target` carries name/email snapshots so the entry stays readable even
// after the account is deleted. `changes` is a JSON list of { field, before,
// after } diffs — password fields are flagged as { field: "password" } only, so
// neither the plaintext nor the hash ever touches the audit trail.
function recordUserEvent({ action, target, actor, changes }) {
  // Tag the event with the role it concerns: an account that was a driver before
  // OR after a change (or whose fleet link changed) counts as a driver-account
  // event, so dispatchers see demotions/resets too, not just current drivers.
  const roleChanges = changes.filter((c) => c.field === "role");
  const touchesDriver =
    changes.some((c) => c.field === "fleetDriver") ||
    roleChanges.some((c) => c.before === "driver" || c.after === "driver");
  insertUserEvent({
    id: uid("evt"),
    action,
    actorId: actor.id,
    actorName: actor.name,
    targetId: target.id,
    targetName: target.name,
    targetEmail: target.email,
    targetRole: touchesDriver ? "driver" : target.role ?? null,
    changes,
    createdAt: new Date().toISOString(),
  });
}

function userEventToApi(e) {
  return {
    id: e.id,
    action: e.action,
    actorId: e.actor_id,
    actorName: e.actor_name,
    targetId: e.target_id,
    targetName: e.target_name,
    targetEmail: e.target_email,
    targetRole: e.target_role,
    changes: JSON.parse(e.changes || "[]"),
    createdAt: e.created_at,
  };
}

// Fleet-driver id -> driver name, so audit diffs read "Priya Nair" not "drv-2".
function driverName(id) {
  const d = id ? getDriverRow(id) : null;
  return d ? d.name : null;
}

// ---------- helpers ----------
const VALID_ROLES = ["customer", "dispatcher", "driver", "admin"];
const CANCELLABLE_BY_CUSTOMER = ["pending_review", "awaiting_payment", "unassigned"];
const STAFF_ROLES = ["dispatcher", "admin"];

function dbSum(status) {
  const row = db
    .prepare(`SELECT COALESCE(SUM(cost), 0) AS s FROM orders WHERE status = ?`)
    .get(status);
  return row.s;
}

function findOrder(id) {
  return apiOrder(getOrderById(id));
}

function refreshOrderCompletion(orderId) {
  const order = findOrder(orderId);
  if (!order) return;
  const allStops = allStopsForOrder(order.id);
  const allDone = allStops.length > 0 && allStops.every((s) => s.done);
  if (allDone) {
    if (order.status !== "completed") {
      order.status = "completed";
      order.completedAt = new Date().toISOString();
      // Safety net: any order that reached completion without a rate snapshot
      // (priced before the payouts feature, or via an untaken path) gets the
      // driver's effective rate so it is still counted in earnings reports.
      if (order.driverFeePct == null) {
        order.driverFeePct = order.driverId ? effectiveFeePct(order.driverId) : getFeePct();
      }
      notify(
        "order-completed",
        `Order ${order.id} for ${order.customerName} has been completed`,
        order.id
      );
    }
  } else {
    if (order.status === "completed") {
      order.status = "assigned";
      order.completedAt = null;
    }
  }
  updateOrderRow(order);
}

function notify(kind, message, orderId) {
  insertNotification({
    id: uid("evt"),
    kind,
    message,
    orderId,
    createdAt: new Date().toISOString(),
  });
}

// Targeted variant: delivers to one user's own notification feed (their
// user_account id, not the fleet driver id) instead of the staff feed.
function notifyUser(userId, kind, message, orderId = null) {
  insertNotification({
    id: uid("evt"),
    kind,
    message,
    orderId,
    targetUserId: userId,
    createdAt: new Date().toISOString(),
  });
}

function driverDisplayStatus(driver) {
  const hasPending = driver.stops.some((s) => !s.done);
  if (hasPending) return "on-route";
  return driver.status === "off-duty" ? "off-duty" : "available";
}

// Set an order to cancelled: clears the driver and any assigned stops.
function cancelOrderRow(order) {
  order.status = "cancelled";
  order.driverId = null;
  removeStopsForOrder(order.id);
  updateOrderRow(order);
  return order;
}

// Drop an order onto a driver: rebuilds both stops at the end of that driver's route.
// Notes seeded from the order's pickup/drop-off notes (set before assignment); if the
// order already had stops (reassign to another driver), each stop's dispatcher note
// and driver note carry over to the matching new stop so nothing is lost.
function assignOrderToDriver(order, driver) {
  const prevNotes = {};
  const prevDriverNotes = {};
  for (const s of allStopsForOrder(order.id)) {
    if (prevNotes[s.type] === undefined) prevNotes[s.type] = s.notes || "";
    if (prevDriverNotes[s.type] === undefined) prevDriverNotes[s.type] = s.driverNote || "";
  }
  removeStopsForOrder(order.id);
  const base = driver.stops.length;
  const pickupNote =
    prevNotes.pickup !== undefined ? prevNotes.pickup : order.pickupNote || "";
  const dropoffNote =
    prevNotes.dropoff !== undefined ? prevNotes.dropoff : order.dropoffNote || "";
  order.pickupNote = pickupNote;
  order.dropoffNote = dropoffNote;
  insertStop({
    id: uid("stop"),
    driverId: driver.id,
    orderId: order.id,
    type: "pickup",
    address: order.pickupAddress,
    customerName: order.customerName,
    done: false,
    notes: pickupNote,
    driverNote: prevDriverNotes.pickup || "",
    pos: base,
    notesUpdatedAt: order.notesUpdatedAt || null,
  });
  insertStop({
    id: uid("stop"),
    driverId: driver.id,
    orderId: order.id,
    type: "dropoff",
    address: order.dropoffAddress,
    customerName: order.customerName,
    done: false,
    notes: dropoffNote,
    driverNote: prevDriverNotes.dropoff || "",
    pos: base + 1,
    notesUpdatedAt: order.notesUpdatedAt || null,
  });
  order.status = "assigned";
  order.driverId = driver.id;
  // Snapshot the assigned driver's effective rate (their own override when set,
  // otherwise the global percentage). Earnings follow the driver who actually
  // does the job, so reassignment re-snapshots — safe because the order has
  // no completed earnings until its stops are done.
  order.driverFeePct = effectiveFeePct(driver.id);
  updateOrderRow(order);
  return order;
}

export const app = express();
app.use(cors());
app.use(express.json());

// Request-level error tracking: anything that calls next(err) lands here.
function sendError(err, res) {
  console.error("DLVRD request error:", err);
  const status = res.statusCode >= 400 && res.statusCode < 600 ? res.statusCode : 500;
  res.status(status).json({
    error: res.statusMessage || "Internal server error",
  });
}

// ================= AUTH =================
// One login endpoint per user type: customer (users), dispatcher, driver, admin.
// There is intentionally no public driver signup — fleet drivers are added by a
// dispatcher and linked to a driver-role account by an admin.
app.post("/api/auth/login/:role", (req, res, next) => {
  const { role } = req.params;
  // /api/auth/login/dev is matched by this route pattern too — fall through
  // to the exact route registered below instead of swallowing the request
  // (a bare return would leave the client hanging forever).
  if (role === "dev") return next();
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: "Unknown role" });
  }
  const { email, password } = req.body || {};
  const user = getUserByEmail(email);
  if (!user || user.role !== role || !verifyPassword(password, user.password)) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  res.json({ token: signToken(user), user: apiUser(user) });
});

// Plain login: works out the user type from the account itself, so the login
// page can be a single form with no role picker.
app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  const user = getUserByEmail(email);
  if (!user || !verifyPassword(password, user.password)) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  res.json({ token: signToken(user), user: apiUser(user) });
});

// Developer backdoor: dev@dlvrd.app + dev password signs in as any product
// role. The token embeds devAs=<role>; the auth middleware resolves it back to
// the impersonated user shape on every request.
app.post("/api/auth/login/dev", (req, res) => {
  const { email, password, role } = req.body || {};
  const user = getUserByEmail(email);
  if (!isDevUser(user) || password !== DEV_PASSWORD) {
    return res.status(401).json({ error: "Invalid developer credentials" });
  }
  const asRole = role || "admin";
  if (!PRODUCT_ROLES.includes(asRole)) {
    return res.status(400).json({ error: "Unknown role" });
  }
  let fleetDriverId = null;
  if (asRole === "driver") {
    const fleet = getDrivers().find((d) => d.status !== "off-duty") || getDrivers()[0];
    fleetDriverId = fleet ? fleet.id : null;
  }
  const token = signToken(user, { devAs: asRole, fleetDriverId });
  res.json({
    token,
    user: devSessionUser(user, asRole, fleetDriverId),
  });
});

// Customer self-registration only (drivers and staff are created by admins)
app.post("/api/auth/register", (req, res) => {
  const { name, email, password } = req.body || {};
  if (
    !name?.trim() ||
    !email?.trim() ||
    !password ||
    String(password).length < 6
  ) {
    return res.status(400).json({
      error: "Name, a valid email, and a password of at least 6 characters are required",
    });
  }
  const normalizedEmail = email.trim().toLowerCase();
  if (getUserByEmail(normalizedEmail)) {
    return res.status(409).json({ error: "An account with this email already exists" });
  }
  const user = {
    id: uid("usr"),
    role: "customer",
    name: name.trim(),
    email: normalizedEmail,
    password: hashPassword(String(password)),
  };
  insertUser(user);
  res.status(201).json({ token: signToken(user), user: apiUser(user) });
});

app.get("/api/auth/me", auth, (req, res) => {
  const u = apiUser(req.user);
  if (req.isDev) u.isDev = true;
  res.json({ user: u });
});

// For the frontend "Use demo credentials" button to dynamically discover
// active accounts if an admin renames them.
app.get("/api/auth/demo-accounts", (req, res) => {
  const users = getAllUsers();
  res.json({
    customer: users.find(u => u.role === "customer" && u.email !== DEV_EMAIL)?.email || "",
    dispatcher: users.find(u => u.role === "dispatcher" && u.email !== DEV_EMAIL)?.email || "",
    driver: users.find(u => u.role === "driver" && u.email !== DEV_EMAIL)?.email || "",
    admin: users.find(u => u.role === "admin" && u.email !== DEV_EMAIL)?.email || "",
  });
});

// ================= ORDERS =================
app.get("/api/orders", auth, (req, res) => {
  let list = getOrders().map(apiOrder);
  if (req.user.role === "customer") {
    // The dev backdoor has no orders of its own, so show the dev-customer the
    // whole pool instead of an always-empty list.
    if (!req.isDev) list = list.filter((o) => o.customerId === req.user.id);
  }
  if (req.user.role === "driver") {
    list = list.filter((o) => o.driverId === req.user.fleet_driver_id);
  }
  res.json(list);
});

app.post("/api/orders", auth, requireRole("customer", "dispatcher", "admin"), (req, res) => {
  const {
    pickupAddress, dropoffAddress, notes, pickupParish, dropoffParish,
    pickupLat, pickupLng, dropoffLat, dropoffLng, customerName,
  } = req.body || {};
  if (!pickupAddress?.trim() || !dropoffAddress?.trim()) {
    return res.status(400).json({ error: "Pickup and drop-off addresses are required" });
  }

  // Dispatchers and admins can supply a customer name (walk-in / on-behalf-of).
  // Customers always use their own name.
  let resolvedCustomerName = req.user.name;
  if (STAFF_ROLES.includes(req.user.role)) {
    if (!customerName?.trim()) {
      return res.status(400).json({ error: "Customer name is required when creating an order as staff" });
    }
    resolvedCustomerName = customerName.trim();
  }

  // Validate optional lat/lng fields
  function validCoord(v) {
    return v == null || (Number.isFinite(Number(v)));
  }
  if (!validCoord(pickupLat) || !validCoord(pickupLng) || !validCoord(dropoffLat) || !validCoord(dropoffLng)) {
    return res.status(400).json({ error: "Latitude and longitude must be numbers" });
  }

  const order = {
    id: uid("ord"),
    customerId: req.user.id,
    customerName: resolvedCustomerName,
    pickupAddress: pickupAddress.trim(),
    pickupParish: pickupParish?.trim() || null,
    pickupLat: pickupLat != null ? Number(pickupLat) : null,
    pickupLng: pickupLng != null ? Number(pickupLng) : null,
    dropoffAddress: dropoffAddress.trim(),
    dropoffParish: dropoffParish?.trim() || null,
    dropoffLat: dropoffLat != null ? Number(dropoffLat) : null,
    dropoffLng: dropoffLng != null ? Number(dropoffLng) : null,
    notes: String(notes || "").trim(),
    status: "pending_review",
    driverId: null,
    cost: null,
    createdAt: new Date().toISOString(),
  };
  insertOrder(order);
  // Respond from the persisted row: apiOrder() expects the raw DB shape
  // (snake_case columns), not the in-memory camelCase object.
  res.status(201).json(findOrder(order.id));
});

// Customer can cancel before payment; dispatchers/admins can cancel at any time.
app.post("/api/orders/:id/cancel", auth, (req, res) => {
  const order = findOrder(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  if (order.status === "completed" || order.status === "cancelled") {
    return res.status(400).json({ error: "This order is already finished" });
  }
  if (STAFF_ROLES.includes(req.user.role)) {
    return res.json(cancelOrderRow(order));
  }
  if (req.user.role === "customer") {
    if (order.customerId !== req.user.id) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (!CANCELLABLE_BY_CUSTOMER.includes(order.status)) {
      return res.status(400).json({ error: "This order can no longer be cancelled" });
    }
    return res.json(cancelOrderRow(order));
  }
  return res.status(403).json({ error: "Forbidden" });
});

// Driver asks to get out of a job — dispatcher must approve or reassign it.
app.post("/api/orders/:id/request-cancel", auth, requireRole("driver"), (req, res) => {
  const order = findOrder(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  if (order.driverId !== req.user.fleet_driver_id) {
    return res.status(403).json({ error: "This order is not assigned to you" });
  }
  if (order.status === "cancel_requested") {
    return res.status(400).json({ error: "Cancellation is already pending approval" });
  }
  if (order.status !== "assigned") {
    return res.status(400).json({ error: "This order can no longer be cancelled" });
  }
  const reason = String(req.body?.reason || "").trim();
  order.status = "cancel_requested";
  updateOrderRow(order);
  notify(
    "cancel-request",
    `${req.user.name} asked to cancel ${order.id} — ${reason || "no reason given"}. Approve it or reassign it.`,
    order.id
  );
  res.json(order);
});

// Dispatcher approves a driver's cancellation request
app.post("/api/orders/:id/approve-cancel", auth, requireRole("dispatcher", "admin"), (req, res) => {
  const order = findOrder(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  if (order.status !== "cancel_requested") {
    return res.status(400).json({ error: "This order has no pending cancellation request" });
  }
  return res.json(cancelOrderRow(order));
});

// Dispatcher reassigns an order to another driver (resolves a cancellation request,
// or moves an in-progress job). Choosing the same driver just clears the request.
app.post("/api/orders/:id/reassign", auth, requireRole("dispatcher", "admin"), (req, res) => {
  const order = findOrder(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  if (!["assigned", "cancel_requested"].includes(order.status)) {
    return res.status(400).json({ error: "Only an assigned order can be reassigned" });
  }
  const driver = getDriverById(req.body?.driverId);
  if (!driver) return res.status(404).json({ error: "Driver not found" });
  if (driver.status === "off-duty") {
    return res.status(400).json({ error: "That driver is off duty" });
  }
  if (driver.id === order.driverId) {
    if (order.status === "cancel_requested") {
      order.status = "assigned";
      updateOrderRow(order);
    }
    return res.json(order);
  }
  return res.json(assignOrderToDriver(order, driver));
});

// Dispatcher/admin prices an order, moving it to awaiting_payment
app.post("/api/orders/:id/price", auth, requireRole("dispatcher", "admin"), (req, res) => {
  const order = findOrder(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  const cost = Number(req.body?.cost);
  if (!Number.isFinite(cost) || cost <= 0) {
    return res.status(400).json({ error: "A positive cost is required" });
  }
  order.cost = Math.round(cost * 100) / 100;

  const paying = req.body?.paying;
  const collecting = req.body?.collecting;
  if (paying !== undefined) {
    if (paying !== true && paying !== false) {
      return res.status(400).json({ error: "paying must be true or false" });
    }
    order.paying = paying ? 1 : 0;
    order.payAmount = paying ? (Number.isFinite(Number(req.body?.payAmount)) ? Math.round(Number(req.body?.payAmount) * 100) / 100 : 0) : null;
  }
  if (collecting !== undefined) {
    if (collecting !== true && collecting !== false) {
      return res.status(400).json({ error: "collecting must be true or false" });
    }
    order.collecting = collecting ? 1 : 0;
    order.collectAmount = collecting ? (Number.isFinite(Number(req.body?.collectAmount)) ? Math.round(Number(req.body?.collectAmount) * 100) / 100 : 0) : null;
  }

  order.status = "awaiting_payment";
  // Snapshot the global rate now: later global-rate changes must never
  // rewrite what a driver earned on this order. (Assignment re-snapshots with
  // the assigned driver's effective rate, since the earner isn't known yet.)
  order.driverFeePct = getFeePct();
  updateOrderRow(order);
  res.json(order);
});

// Customer pays, order becomes unassigned (available for dispatch)
app.post("/api/orders/:id/pay", auth, requireRole("customer"), (req, res) => {
  const order = findOrder(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  if (order.customerId !== req.user.id) {
    return res.status(403).json({ error: "Forbidden" });
  }
  if (order.status !== "awaiting_payment") {
    return res.status(400).json({ error: "Order is not awaiting payment" });
  }
  order.status = "unassigned";
  updateOrderRow(order);
  res.json(order);
});

// Dispatcher/admin assigns an unassigned order to a driver
app.post("/api/orders/:id/assign", auth, requireRole("dispatcher", "admin"), (req, res) => {
  const order = findOrder(req.params.id);
  const driver = getDriverById(req.body?.driverId);
  if (!order) return res.status(404).json({ error: "Order not found" });
  if (!driver) return res.status(404).json({ error: "Driver not found" });
  if (driver.status === "off-duty") {
    return res.status(400).json({ error: "That driver is off duty" });
  }
  if (order.status !== "unassigned") {
    return res.status(400).json({ error: "Only unassigned orders can be assigned" });
  }
  return res.json(assignOrderToDriver(order, driver));
});

// Dispatcher/admin unassigns an order back to the pool
app.post("/api/orders/:id/unassign", auth, requireRole("dispatcher", "admin"), (req, res) => {
  const order = findOrder(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  order.status = "unassigned";
  order.driverId = null;
  updateOrderRow(order);
  removeStopsForOrder(order.id);
  res.json(order);
});

// Dispatcher/admin sets the driver-facing pickup & drop-off notes on an order.
// Editable before assignment (pricing / unassigned pool); once the job is assigned,
// the notes sync onto the matching stops so drivers see them on route. Each change
// is recorded in the note audit trail.
app.post("/api/orders/:id/notes", auth, requireRole("dispatcher", "admin"), (req, res) => {
  const order = findOrder(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  const { pickupNote, dropoffNote } = req.body || {};
  const prevPickup = order.pickupNote;
  const prevDropoff = order.dropoffNote;
  if (pickupNote !== undefined) order.pickupNote = String(pickupNote).trim();
  if (dropoffNote !== undefined) order.dropoffNote = String(dropoffNote).trim();
  if (order.pickupNote === prevPickup && order.dropoffNote === prevDropoff) {
    return res.status(400).json({ error: "Nothing to update" });
  }
  const now = new Date().toISOString();
  order.notesUpdatedAt = now;
  updateOrderRow(order);
  const createdAt = now;
  if (order.pickupNote !== prevPickup) {
    insertNoteEvent({
      id: uid("evt"),
      stopId: null,
      orderId: order.id,
      kind: "order",
      actorRole: req.user.role,
      actorName: req.user.name,
      prev: prevPickup || "",
      next: order.pickupNote,
      createdAt,
    });
  }
  if (order.dropoffNote !== prevDropoff) {
    insertNoteEvent({
      id: uid("evt"),
      stopId: null,
      orderId: order.id,
      kind: "order",
      actorRole: req.user.role,
      actorName: req.user.name,
      prev: prevDropoff || "",
      next: order.dropoffNote,
      createdAt,
    });
  }
  // Keep any already-assigned stops in sync with the order-level notes.
  for (const s of allStopsForOrder(order.id)) {
    const want = s.type === "pickup" ? order.pickupNote : order.dropoffNote;
    if ((s.notes || "") !== want) setStopNotes(s.id, want, now);
  }
  res.json({ ok: true });
});

// ================= STOPS =================
// Move a stop between drivers (or reorder within a driver's route)
app.post("/api/stops/:stopId/move", auth, requireRole("dispatcher", "admin"), (req, res) => {
  const { fromDriverId, toDriverId, toIndex } = req.body || {};
  const stopRow = getStopRow(req.params.stopId);
  const src = getDriverById(fromDriverId);
  const tgt = getDriverById(toDriverId);
  if (!stopRow || !src || !tgt) {
    return res.status(404).json({ error: "Stop or driver not found" });
  }
  if (tgt.status === "off-duty") {
    return res.status(400).json({ error: "That driver is off duty" });
  }
  const removeIdx = src.stops.findIndex((s) => s.id === stopRow.id);
  if (removeIdx === -1) {
    return res.status(404).json({ error: "Stop or driver not found" });
  }
  const preMoveTargetLen = tgt.stops.length;
  deleteStopById(stopRow.id);
  // Deleting one stop leaves a hole in the pos sequence of the route it left, so
  // compact it back to 0..n-1 before inserting anywhere else.
  renumberStops(fromDriverId === toDriverId ? toDriverId : fromDriverId);
  let at = toIndex == null ? preMoveTargetLen : toIndex;
  if (fromDriverId === toDriverId && removeIdx < at) at -= 1;
  const tgtLenAfter = getDriverStops(toDriverId).length;
  at = Math.max(0, Math.min(at, tgtLenAfter));
  shiftStops(toDriverId, at);
  insertStop({
    id: stopRow.id,
    driverId: toDriverId,
    orderId: stopRow.order_id,
    type: stopRow.type,
    address: stopRow.address,
    customerName: stopRow.customer_name,
    done: !!stopRow.done,
    enRoute: !!stopRow.en_route,
    photoPath: stopRow.photo_path || null,
    notes: stopRow.notes || "",
    driverNote: stopRow.driver_note || "",
    pos: at,
    enRouteAt: stopRow.en_route_at || null,
    completedAt: stopRow.completed_at || null,
    photoUploadedAt: stopRow.photo_uploaded_at || null,
    notesUpdatedAt: stopRow.notes_updated_at || null,
    driverNoteUpdatedAt: stopRow.driver_note_updated_at || null,
  });
  if (fromDriverId !== toDriverId) {
    const order = findOrder(stopRow.order_id);
    if (order) {
      order.driverId = toDriverId;
      updateOrderRow(order);
    }
  }
  res.json({ ok: true });
});

// Toggle a stop done/undone; completes the order when all its stops are done.
// Drivers must attach a proof-of-pickup photo before completing a pickup stop.
app.post("/api/stops/:stopId/toggle", auth, requireRole("dispatcher", "admin", "driver"), (req, res) => {
  const stopRow = getStopRow(req.params.stopId);
  if (!stopRow) return res.status(404).json({ error: "Stop not found" });
  if (req.user.role === "driver" && req.user.fleet_driver_id !== stopRow.driver_id) {
    return res.status(403).json({ error: "Forbidden" });
  }
  if (
    !stopRow.done &&
    req.user.role === "driver" &&
    stopRow.type === "pickup" &&
    !stopRow.photo_path
  ) {
    return res.status(400).json({
      error: "Add a proof-of-pickup photo before completing this stop",
    });
  }
  const nextDone = !stopRow.done;
  const completedAt = nextDone ? new Date().toISOString() : null;
  setStopDone(stopRow.id, nextDone, completedAt);
  if (nextDone) {
    const driver = getDriverRow(stopRow.driver_id);
    notify(
      "completed",
      `${driver ? driver.name : req.user.name} completed the ${stopRow.type === "pickup" ? "pickup" : "drop-off"} at ${stopRow.address}`,
      stopRow.order_id
    );
  }
  refreshOrderCompletion(stopRow.order_id);
  res.json({ ok: true, completedAt });
});

const PHOTO_EXT_BY_TYPE = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

// Magic bytes for the image formats we accept. Checked in addition to the
// Content-Type header so a mislabeled file is rejected before it hits disk.
const PHOTO_MAGIC = [
  { ext: ".jpg", header: Buffer.from([0xff, 0xd8, 0xff]) },
  { ext: ".png", header: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
  { ext: ".webp", header: Buffer.from([0x52, 0x49, 0x46, 0x46]) }, // RIFF....
  { ext: ".gif", header: Buffer.from([0x47, 0x49, 0x46, 0x38]) }, // GIF8
];
function photoExtFromMagic(bytes) {
  if (!bytes || bytes.length < 4) return null;
  for (const candidate of PHOTO_MAGIC) {
    // Exact prefix compare — Buffer.prototype.startsWith was removed in
    // Node 24, so use subarray().equals() which works on every version.
    if (bytes.subarray(0, candidate.header.length).equals(candidate.header)) {
      return candidate.ext;
    }
  }
  return null;
}

// Attach a proof-of-pickup photo to a stop (raw image body).
// This route is the only place express.raw is applied, so it won't silently
// attach a body buffer to unrelated requests.
app.post(
  "/api/stops/:stopId/photo",
  auth,
  requireRole("dispatcher", "admin", "driver"),
  express.raw({
    type: "image/*",
    limit: `${Math.round(MAX_PHOTO_BYTES / 1024 / 1024)}mb`,
  }),
  (req, res) => {
    const stopRow = getStopRow(req.params.stopId);
    if (!stopRow) return res.status(404).json({ error: "Stop not found" });
    if (req.user.role === "driver" && req.user.fleet_driver_id !== stopRow.driver_id) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const contentType = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    const extByHeader = PHOTO_EXT_BY_TYPE[contentType] || null;
    const bytes = Buffer.isBuffer(req.body) ? req.body : null;
    if (!bytes || bytes.length === 0 || bytes.length > MAX_PHOTO_BYTES) {
      return res.status(400).json({
        error: "Please attach a photo as a JPEG, PNG, WebP, or GIF file (up to 8 MB)",
      });
    }
    if (!extByHeader || !photoExtFromMagic(bytes)) {
      return res.status(400).json({
        error: "Please attach a photo as a JPEG, PNG, WebP, or GIF file (up to 8 MB)",
      });
    }
    const name = `${stopRow.id}-${crypto.randomBytes(8).toString("hex")}${extByHeader}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, name), bytes);
    if (stopRow.photo_path) {
      try {
        fs.unlinkSync(path.join(UPLOAD_DIR, stopRow.photo_path));
      } catch {
        /* old file already gone — fine */
      }
    }
    const uploadedAt = new Date().toISOString();
    setStopPhoto(stopRow.id, name, uploadedAt);
    const driver = getDriverRow(stopRow.driver_id);
    notify(
      "photo-upload",
      `${driver ? driver.name : req.user.name} uploaded proof-of-pickup photo for ${stopRow.type === "pickup" ? "pickup" : "drop-off"} at ${stopRow.address}`,
      stopRow.order_id
    );
    res.json({ ok: true, photoUrl: `/api/uploads/${name}`, photoUploadedAt: uploadedAt });
  }
);

// Dispatcher/admin sets (or clears, with an empty value) the note on an individual
// pickup or drop-off stop. Drivers see the note on their route at that stop.
app.post("/api/stops/:stopId/notes", auth, requireRole("dispatcher", "admin"), (req, res) => {
  const stopRow = getStopRow(req.params.stopId);
  if (!stopRow) return res.status(404).json({ error: "Stop not found" });
  const notes = String(req.body?.notes ?? "").trim();
  const prev = stopRow.notes || "";
  if (notes !== prev) {
    const now = new Date().toISOString();
    setStopNotes(stopRow.id, notes, now);
    insertNoteEvent({
      id: uid("evt"),
      stopId: stopRow.id,
      orderId: stopRow.order_id,
      kind: "dispatch",
      actorRole: req.user.role,
      actorName: req.user.name,
      prev,
      next: notes,
      createdAt: now,
    });
    // Keep the order-level note in sync so it survives an unassign/reassign.
    const order = findOrder(stopRow.order_id);
    if (order) {
      order[stopRow.type === "pickup" ? "pickupNote" : "dropoffNote"] = notes;
      order.notesUpdatedAt = now;
      updateOrderRow(order);
    }
  }
  res.json({ ok: true, notes });
});

// Driver adds/replies with a note at a stop; the dispatcher sees it on the board
// and gets a notification. Dispatchers/admins can clear a driver note.
app.post(
  "/api/stops/:stopId/driver-note",
  auth,
  requireRole("dispatcher", "admin", "driver"),
  (req, res) => {
    const stopRow = getStopRow(req.params.stopId);
    if (!stopRow) return res.status(404).json({ error: "Stop not found" });
    if (req.user.role === "driver" && req.user.fleet_driver_id !== stopRow.driver_id) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const note = String(req.body?.notes ?? "").trim();
    const prev = stopRow.driver_note || "";
    if (note !== prev) {
      const now = new Date().toISOString();
      setStopDriverNote(stopRow.id, note, now);
      insertNoteEvent({
        id: uid("evt"),
        stopId: stopRow.id,
        orderId: stopRow.order_id,
        kind: "driver",
        actorRole: req.user.role,
        actorName: req.user.name,
        prev,
        next: note,
        createdAt: now,
      });
      if (req.user.role === "driver" && note) {
        const driver = getDriverRow(stopRow.driver_id);
        notify(
          "driver-note",
          `${driver ? driver.name : req.user.name} added a note at the ${stopRow.type === "pickup" ? "pickup" : "drop-off"} — "${note}"`,
          stopRow.order_id
        );
      }
    }
    res.json({ ok: true, notes: note });
  }
);

// Audit trail for note changes (dispatcher/admin only).
app.get("/api/note-history", auth, requireRole("dispatcher", "admin"), (req, res) => {
  const rows = getNoteEvents({
    stopId: req.query.stopId || null,
    orderId: req.query.orderId || null,
  });
  res.json(
    rows.map((n) => ({
      id: n.id,
      stopId: n.stop_id,
      orderId: n.order_id,
      kind: n.kind,
      actorRole: n.actor_role,
      actorName: n.actor_name,
      prev: n.prev,
      next: n.next,
      createdAt: n.created_at,
    }))
  );
});

// Driver taps "On my way" on their current stop; dispatcher is notified.
app.post("/api/stops/:stopId/enroute", auth, requireRole("dispatcher", "admin", "driver"), (req, res) => {
  const stopRow = getStopRow(req.params.stopId);
  if (!stopRow) return res.status(404).json({ error: "Stop not found" });
  if (req.user.role === "driver" && req.user.fleet_driver_id !== stopRow.driver_id) {
    return res.status(403).json({ error: "Forbidden" });
  }
  if (stopRow.done) {
    return res.status(400).json({ error: "This stop is already completed" });
  }
  const driverStops = getDriverStops(stopRow.driver_id);
  const firstPending = driverStops.find((s) => !s.done);
  if (!stopRow.en_route && firstPending && firstPending.id !== stopRow.id) {
    return res.status(400).json({ error: "Finish earlier stops first" });
  }
  if (!stopRow.en_route) {
    const enRouteAt = new Date().toISOString();
    setStopEnRoute(stopRow.id, true, enRouteAt);
    const driver = getDriverRow(stopRow.driver_id);
    notify(
      "on-my-way",
      `${driver ? driver.name : req.user.name} is on the way — ${stopRow.type === "pickup" ? "pickup" : "drop-off"} at ${stopRow.address}`,
      stopRow.order_id
    );
  }
  res.json({ ok: true });
});

// ================= DRIVERS (fleet) =================
app.get("/api/drivers", auth, (req, res) => {
  const drivers = getDrivers();
  res.json(drivers.map((d) => ({ ...d, displayStatus: driverDisplayStatus(d) })));
});

// Returns driver-role user accounts that are not yet linked to any fleet
// driver record, so the "Add fleet driver" form can populate its dropdown.
app.get("/api/drivers/eligible-users", auth, requireRole("dispatcher", "admin"), (req, res) => {
  res.json(getUnlinkedDriverUsers());
});

// Dispatcher/admin adds a fleet driver. The driver name is taken from an
// existing driver-role user account (userId required); a new drivers row is
// created and the user's fleet_driver_id is set in the same transaction so
// the two records are always in sync.
app.post("/api/drivers", auth, requireRole("dispatcher", "admin"), (req, res) => {
  const { userId, vehicle, regNumber, model, colour, description } = req.body || {};
  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }
  const user = getUserById(userId);
  if (!user) return res.status(404).json({ error: "User not found" });
  if (user.role !== "driver") {
    return res.status(400).json({ error: "User must have the driver role" });
  }
  if (user.fleet_driver_id) {
    return res.status(400).json({ error: "This user is already linked to a fleet driver" });
  }
  const driver = {
    id: uid("drv"),
    name: user.name,
    vehicle: vehicle?.trim() || "Vehicle",
    regNumber: regNumber?.trim() || null,
    model: model?.trim() || null,
    colour: colour?.trim() || null,
    description: description?.trim() || null,
    status: "available",
    statusUpdatedAt: new Date().toISOString(),
    stops: [],
  };
  // Insert driver and link user atomically
  db.transaction(() => {
    insertDriver(driver);
    db.prepare(`UPDATE users SET fleet_driver_id = ? WHERE id = ?`).run(driver.id, user.id);
  })();
  res.status(201).json(driver);

  notify(
    "driver-added",
    `${req.user.name} added ${driver.name} to the fleet`,
    null
  );
});

// Dispatcher, admin, or the driver themself updates vehicle / registration details
app.patch("/api/drivers/:id", auth, (req, res) => {
  const row = getDriverRow(req.params.id);
  if (!row) return res.status(404).json({ error: "Driver not found" });
  const isSelf = req.user.role === "driver" && req.user.fleet_driver_id === row.id;
  if (!STAFF_ROLES.includes(req.user.role) && !isSelf) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const patch = {};
  for (const key of ["name", "vehicle", "regNumber", "model", "colour", "description"]) {
    if (req.body?.[key] !== undefined) {
      const value = String(req.body[key]).trim();
      if (key === "name" && !value) {
        return res.status(400).json({ error: "Driver name cannot be empty" });
      }
      patch[key] = value;
    }
  }
  // Per-driver fee override (admin-only): a number in [0, 100] replaces the
  // driver's personal rate; null clears it back to the global rate. Guarded
  // separately because dispatchers may edit vehicles but never pay rates, and
  // because it must accept null ("clear"), which the string loop above can't.
  if (req.body?.feePctOverride !== undefined) {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Only admins can change a driver's fee rate" });
    }
    const raw = req.body.feePctOverride;
    if (raw === null || raw === "") {
      patch.feePctOverride = null;
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        return res.status(400).json({ error: "Fee override must be between 0 and 100" });
      }
      patch.feePctOverride = n;
    }
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: "Nothing to update" });
  }
  updateDriverRow(row.id, patch);
  res.json(getDriverById(row.id));
});

// Driver toggles their availability (dispatcher/admin can override)
app.post("/api/drivers/:id/availability", auth, (req, res) => {
  const row = getDriverRow(req.params.id);
  if (!row) return res.status(404).json({ error: "Driver not found" });
  const isSelf = req.user.role === "driver" && req.user.fleet_driver_id === row.id;
  if (!STAFF_ROLES.includes(req.user.role) && !isSelf) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const available = req.body?.available;
  if (typeof available !== "boolean") {
    return res.status(400).json({ error: "available must be true or false" });
  }
  if (!available) {
    const hasPending = getDriverStops(row.id).some((s) => !s.done);
    if (hasPending) {
      return res.status(400).json({ error: "Finish or reassign your pending stops first" });
    }
  }
  const statusUpdatedAt = new Date().toISOString();
  setDriverStatus(row.id, available ? "available" : "off-duty", statusUpdatedAt);
  notify(
    available ? "on-duty" : "off-duty",
    `${row.name} is now ${available ? "on duty (available)" : "off duty"}`
  );
  res.json(getDriverById(row.id));
});

// ================= NOTIFICATIONS (dispatcher feed) =================
app.get("/api/notifications", auth, requireRole("dispatcher", "admin"), (req, res) => {
  const items = getNotifications(50).map((n) => ({
    id: n.id,
    kind: n.kind,
    message: n.message,
    orderId: n.order_id,
    read: !!n.read,
    createdAt: n.created_at,
  }));
  res.json({ items, unread: countUnreadNotifications() });
});

app.post("/api/notifications/read", auth, requireRole("dispatcher", "admin"), (req, res) => {
  markAllNotificationsRead();
  res.json({ ok: true });
});

// ================= ADMIN =================
app.get("/api/admin/stats", auth, requireRole("admin"), (req, res) => {
  const byStatus = {};
  for (const o of getOrders().map(apiOrder)) {
    byStatus[o.status] = (byStatus[o.status] || 0) + 1;
  }
  const byRole = {};
  for (const u of getAllUsers().map(apiUser)) {
    byRole[u.role] = (byRole[u.role] || 0) + 1;
  }
  res.json({
    orders: {
      total: getOrders().length,
      byStatus,
    },
    revenue: dbSum("completed"),
    outstanding: dbSum("awaiting_payment"),
    users: {
      total: getAllUsers().length,
      byRole,
    },
    drivers: {
      total: getDrivers().length,
      active: getDrivers().filter((d) => d.stops.length > 0).length,
    },
  });
});

app.get("/api/admin/users", auth, requireRole("admin"), (req, res) => {
  res.json(getAllUsers().map(apiUser));
});

app.post("/api/admin/users", auth, requireRole("admin"), (req, res) => {
  const { name, email, password, role, fleetDriverId } = req.body || {};
  if (!name?.trim() || !email?.trim() || !password || String(password).length < 6) {
    return res.status(400).json({
      error: "Name, a valid email, and a password of at least 6 characters are required",
    });
  }
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: "Invalid role" });
  }
  const normalizedEmail = email.trim().toLowerCase();
  if (getUserByEmail(normalizedEmail)) {
    return res.status(409).json({ error: "An account with this email already exists" });
  }
  const user = {
    id: uid("usr"),
    role,
    name: name.trim(),
    email: normalizedEmail,
    password: hashPassword(String(password)),
    fleetDriverId:
      role === "driver" && fleetDriverId ? fleetDriverId : undefined,
  };
  insertUser(user);
  recordUserEvent({
    action: "create",
    target: { id: user.id, name: user.name, email: normalizedEmail, role: user.role },
    actor: req.user,
    changes: [{ field: "role", after: user.role }],
  });
  res.status(201).json(apiUser(getUserByEmail(normalizedEmail)));
});

app.patch("/api/admin/users/:id", auth, requireRole("admin"), (req, res) => {
  const user = getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  // updateUserRow expects the camelCase key; the raw DB row only has fleet_driver_id.
  const orig = {
    name: user.name,
    email: user.email,
    role: user.role,
    fleetDriverId: user.fleet_driver_id ?? null,
  };
  user.fleetDriverId = orig.fleetDriverId;

  const passwordReset = Boolean(req.body.password);
  if (passwordReset) {
    if (String(req.body.password).length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }
    user.password = hashPassword(String(req.body.password));
  }
  if (req.body.role) {
    if (!VALID_ROLES.includes(req.body.role)) {
      return res.status(400).json({ error: "Invalid role" });
    }
    if (user.id === req.user.id && req.body.role !== "admin") {
      return res.status(400).json({ error: "You cannot demote yourself" });
    }
    user.role = req.body.role;
  }
  if (req.body.name?.trim()) user.name = req.body.name.trim();
  if (req.body.email?.trim()) {
    const normalizedEmail = req.body.email.trim().toLowerCase();
    const existing = getUserByEmail(normalizedEmail);
    if (existing && existing.id !== user.id) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }
    user.email = normalizedEmail;
  }
  // Link/unlink the fleet driver behind a driver-role account. Each fleet driver
  // can back at most one login, so a driver already claimed by another account is
  // rejected. Passing an empty value clears the link.
  if (req.body.fleetDriverId !== undefined) {
    const link = req.body.fleetDriverId ? String(req.body.fleetDriverId) : null;
    if (link) {
      if (user.role !== "driver") {
        return res.status(400).json({ error: "Only driver accounts can be linked to a fleet driver" });
      }
      if (!getDriverRow(link)) {
        return res.status(400).json({ error: "Fleet driver not found" });
      }
      const owner = getUserByFleetDriverId(link);
      if (owner && owner.id !== user.id) {
        return res.status(409).json({ error: `That driver is already linked to ${owner.name}` });
      }
    }
    user.fleetDriverId = link;
  }
  // Role no longer driver — drop any stale fleet link so it can't linger invisibly.
  if (user.role !== "driver" && user.fleetDriverId) user.fleetDriverId = null;

  // Build the audit diff from what actually changed (never store password values).
  const changes = [];
  const push = (field, before, after) => {
    if (before !== after) changes.push({ field, before: before ?? null, after: after ?? null });
  };
  if (req.body.name?.trim()) push("name", orig.name, user.name);
  if (req.body.email?.trim()) push("email", orig.email, user.email);
  if (req.body.role) push("role", orig.role, user.role);
  push(
    "fleetDriver",
    driverName(orig.fleetDriverId),
    driverName(user.fleetDriverId)
  );
  if (passwordReset) changes.push({ field: "password" });

  updateUserRow(user);
  if (changes.length) {
    recordUserEvent({
      action: "update",
      target: { id: user.id, name: user.name, email: user.email, role: user.role },
      actor: req.user,
      changes,
    });
  }
  res.json(apiUser(getUserById(user.id)));
});

// Admin resets a user's password without needing (or touching) the current one —
// the user simply signs in with this new value next time.
app.post(
  "/api/admin/users/:id/reset-password",
  auth,
  requireRole("admin"),
  (req, res) => {
    const user = getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    const password = String(req.body?.password ?? "");
    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }
    updateUserRow({
      ...user,
      fleetDriverId: user.fleet_driver_id ?? null,
      password: hashPassword(password),
    });
    recordUserEvent({
      action: "reset_password",
      target: { id: user.id, name: user.name, email: user.email, role: user.role },
      actor: req.user,
      changes: [{ field: "password" }],
    });
    res.json(apiUser(getUserById(user.id)));
  }
);

app.delete("/api/admin/users/:id", auth, requireRole("admin"), (req, res) => {
  const user = getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  if (user.id === req.user.id) {
    return res.status(400).json({ error: "You cannot delete your own account" });
  }
  // Fleet drivers only exist as user accounts. Deleting the user account must
  // also remove the linked fleet driver record (and its stops via FK cascade)
  // so the driver no longer appears on the board or in any driver lists.
  if (user.role === "driver" && user.fleet_driver_id) {
    deleteDriverById(user.fleet_driver_id);
  }
  deleteUserById(user.id);
  recordUserEvent({
    action: "delete",
    target: { id: user.id, name: user.name, email: user.email, role: user.role },
    actor: req.user,
    changes: [{ field: "role", before: user.role }],
  });
  res.json({ ok: true });
});

// Audit trail of user-account changes (admins only — full log).
app.get("/api/admin/user-events", auth, requireRole("admin"), (req, res) => {
  res.json(getUserEvents().map(userEventToApi));
});

// ================= driver payouts =================
// Drivers earn a configurable percentage of each order's delivery fee. The
// rate is snapshotted per order when priced/completed, so this section reports
// what each driver has earned (fee × snapshot), what has been paid out (full
// or manually-entered partial amounts), and the outstanding balance.

// Current global fee percentage + driver-earnings visibility toggle.
app.get("/api/admin/payout-settings", auth, requireRole("admin"), (req, res) => {
  res.json({ feePct: getFeePct(), showDriverEarnings: getDriverEarningsVisibility() });
});

// Update the global fee percentage. Only affects orders priced from now on —
// snapshots on existing orders are never rewritten. Also accepts the toggle
// that shows/hides the earnings card in the driver console.
app.post("/api/admin/payout-settings", auth, requireRole("admin"), (req, res) => {
  if (req.body?.showDriverEarnings !== undefined) {
    if (typeof req.body.showDriverEarnings !== "boolean") {
      return res.status(400).json({ error: "showDriverEarnings must be true or false" });
    }
    setDriverEarningsVisibility(req.body.showDriverEarnings);
  }
  if (req.body?.feePct !== undefined) {
    const pct = Number(req.body.feePct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      return res.status(400).json({ error: "Fee percentage must be between 0 and 100" });
    }
    setFeePct(pct);
  }
  res.json({ feePct: getFeePct(), showDriverEarnings: getDriverEarningsVisibility() });
});

// Per-driver summary for the payouts tab: effective fee rate (override or
// global), earned / paid / outstanding for each driver in one response so the
// admin sees rates next to balances without N+1 requests.
app.get("/api/admin/drivers-summary", auth, requireRole("admin"), (req, res) => {
  const { from, to } = req.query;
  const report = driverEarnings({ from, to });
  const byDriver = new Map();
  for (const o of report.orders) {
    if (!byDriver.has(o.driverId)) {
      byDriver.set(o.driverId, { driverId: o.driverId, driverName: o.driverName, earned: 0, orderCount: 0 });
    }
    const g = byDriver.get(o.driverId);
    g.earned += o.earned;
    g.orderCount += 1;
  }
  // Paid is scoped to the same window as earned so per-driver outstanding
  // matches the report totals when a range is active.
  const paidWhere = ["driver_id = @driverId"]
    .concat(from ? ["paid_at >= @from"] : [])
    .concat(to ? ["paid_at <= @to"] : [])
    .join(" AND ");
  const paidStmt = db.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS paid FROM payouts WHERE ${paidWhere}`
  );
  const paidParams = (driverId) =>
    from || to ? { driverId, from, to } : { driverId };
  res.json(
    [...byDriver.values()]
      .map((g) => {
        const paid = Math.round(paidStmt.get(paidParams(g.driverId)).paid * 100) / 100;
        const earned = Math.round(g.earned * 100) / 100;
        return {
          ...g,
          earned,
          paid,
          outstanding: Math.round((earned - paid) * 100) / 100,
          feePct: effectiveFeePct(g.driverId),
          hasOverride:
            db.prepare(`SELECT fee_pct_override FROM drivers WHERE id = ?`).get(g.driverId)
              ?.fee_pct_override != null,
        };
      })
      .sort((a, b) => b.earned - a.earned)
  );
});

// Earnings report: per-order earning rows + totals (earned / paid /
// outstanding) for one driver or all drivers, over an optional completed-at
// window (?driverId=&from=&to= — ISO timestamps). When no window is given the
// report covers all history, which is the "what do we owe right now" view.
app.get("/api/admin/driver-earnings", auth, requireRole("admin"), (req, res) => {
  const { driverId, from, to } = req.query;
  if (driverId && !getDriverRow(driverId)) {
    return res.status(404).json({ error: "Driver not found" });
  }
  res.json(driverEarnings({ driverId, from, to }));
});

// Payout history (optionally per driver), newest first.
app.get("/api/admin/payouts", auth, requireRole("admin"), (req, res) => {
  res.json(getDriverPayouts({ driverId: req.query.driverId }));
});

// Record a payout: either "full" (settles the driver's entire current
// outstanding balance across all completed work) or "partial" (a manually
// entered amount). Partial payouts may overpay deliberately (e.g. rounding,
// bonus) — the balance simply goes up by the same amount.
app.post("/api/admin/payouts", auth, requireRole("admin"), (req, res) => {
  const { driverId, mode, amount, note, driverMessage } = req.body || {};
  if (!getDriverRow(driverId)) {
    return res.status(404).json({ error: "Driver not found" });
  }
  if (mode !== "full" && mode !== "partial") {
    return res.status(400).json({ error: "mode must be 'full' or 'partial'" });
  }
  // All-time earned/paid so "full" settles everything, not just a window.
  const report = driverEarnings({ driverId });
  let value;
  let covered = [];
  if (mode === "full") {
    if (report.totals.outstanding <= 0) {
      return res.status(400).json({ error: "This driver has no outstanding balance" });
    }
    value = report.totals.outstanding;
    covered = report.orders.map((o) => o.orderId);
  } else {
    value = Math.round(Number(amount) * 100) / 100;
    if (!Number.isFinite(value) || value <= 0) {
      return res.status(400).json({ error: "A positive payout amount is required" });
    }
  }
  const payout = {
    id: uid("pay"),
    driverId,
    amount: value,
    mode,
    orderIds: covered,
    note: String(note || "").trim(),
    actorName: req.user.name,
    paidAt: new Date().toISOString(),
  };
  insertPayout(payout);
  const driverRow = getDriverRow(driverId);
  notify(
    "payout",
    `Payout of $${value.toFixed(2)} (${mode}) recorded for ${driverRow.name}`,
    null
  );
  // Tell the driver in their own feed (if they have a linked user account).
  // driverMessage lets the admin write what the driver actually sees; without
  // it a sensible default includes the amount and the internal note.
  const linkedUser = getUserByFleetDriverId(driverId);
  if (linkedUser) {
    const custom = String(driverMessage || "").trim();
    notifyUser(
      linkedUser.id,
      "payout",
      custom || `You've been paid $${value.toFixed(2)}${note ? ` — ${note}` : ""}`,
      null
    );
  }
  // Totals are re-computed after the insert so the response reflects the new
  // outstanding balance (earned − paid including this payout).
  res.status(201).json({
    payout,
    totals: driverEarnings({ driverId }).totals,
  });
});

// CSV export of the earnings report (same filters as the JSON endpoint).
// Spreadsheet-safe: RFC-4180 quoting, CRLF line endings, BOM so Excel reads
// the UTF-8 header correctly.
function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

app.get("/api/admin/driver-earnings.csv", auth, requireRole("admin"), (req, res) => {
  const { driverId, from, to } = req.query;
  if (driverId && !getDriverRow(driverId)) {
    return res.status(404).json({ error: "Driver not found" });
  }
  const report = driverEarnings({ driverId, from, to });
  const driverName = driverId ? getDriverRow(driverId).name : "All drivers";
  const rows = [
    ["Driver", "Order", "Customer", "Completed", "Delivery fee", "Rate %", "Driver earns"],
    ...report.orders.map((o) => [
      o.driverName,
      o.orderId,
      o.customerName,
      o.completedAt,
      o.cost.toFixed(2),
      o.feePct,
      o.earned.toFixed(2),
    ]),
    [],
    ["", "", "", "", "", "Earned", report.totals.earned.toFixed(2)],
    ["", "", "", "", "", "Paid out", report.totals.paid.toFixed(2)],
    ["", "", "", "", "", "Outstanding", report.totals.outstanding.toFixed(2)],
  ];
  const csv = "\ufeff" + rows.map((r) => r.map(csvEscape).join(",")).join("\r\n") + "\r\n";
  const stamp = new Date().toISOString().slice(0, 10);
  const who = driverId ? driverName.replace(/[^\w-]+/g, "_") : "all-drivers";
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="dlvrd-earnings-${who}-${stamp}.csv"`
  );
  res.send(csv);
});

// Driver-facing view of their own earnings — same math as the admin report,
// but always scoped to the signed-in driver and never exposing other drivers.
// Accepts the same ?from=&to= completed-at window as the admin report. Admins
// can hide this view entirely (payout-settings); hidden drivers get linked:
// false so the console hides the card instead of showing empty numbers.
app.get("/api/my-earnings", auth, requireRole("driver"), (req, res) => {
  if (!getDriverEarningsVisibility()) {
    return res.json({ linked: false, hidden: true, totals: { orderCount: 0, earned: 0, paid: 0, outstanding: 0 }, orders: [], payouts: [] });
  }
  const { from, to } = req.query;
  const driverId = req.user.fleet_driver_id;
  if (!driverId || !getDriverRow(driverId)) {
    return res.json({ linked: false, totals: { orderCount: 0, earned: 0, paid: 0, outstanding: 0 }, orders: [], payouts: [] });
  }
  const report = driverEarnings({ driverId, from, to });
  res.json({
    linked: true,
    totals: report.totals,
    orders: report.orders,
    payouts: getDriverPayouts({ driverId, from, to }),
  });
});

// The driver's own notification feed (payouts etc.). Separate from the staff
// feed; untargeted staff items never appear here.
app.get("/api/my-notifications", auth, requireRole("driver"), (req, res) => {
  const items = getUserNotifications(req.user.id, 30).map((n) => ({
    id: n.id,
    kind: n.kind,
    message: n.message,
    orderId: n.order_id,
    read: !!n.read,
    createdAt: n.created_at,
  }));
  res.json({
    items,
    unread: countUnreadUserNotifications(req.user.id),
  });
});

app.post("/api/my-notifications/read", auth, requireRole("driver"), (req, res) => {
  markUserNotificationsRead(req.user.id);
  res.json({ ok: true });
});

// Driver-account portion of the audit log, surfaced to dispatchers so they can
// see who created / edited / reset / deleted driver logins and changed fleet
// links. Server-side filtered to driver events only — dispatchers never see
// customer or staff account activity. Admins see the full log above.
app.get(
  "/api/driver-account-events",
  auth,
  requireRole("dispatcher", "admin"),
  (req, res) => {
    res.json(getUserEvents({ targetRole: "driver" }).map(userEventToApi));
  }
);

// ================= static serving =================
// Proof-of-pickup photos live in server/uploads and are served under /api/uploads
// (proxied by Vite in dev, same-origin in production).
app.use("/api/uploads", express.static(UPLOAD_DIR));

// In production the server also serves the built frontend from dist/ (Vite
// proxies /api in dev, so this only matches non-API requests).
const DIST_DIR = path.join(__dirname, "..", "dist");
if (fs.existsSync(path.join(DIST_DIR, "index.html"))) {
  app.use(express.static(DIST_DIR));
  // SPA fallback: unknown non-API routes get the built index.html so client
  // routes keep working on refresh.
  app.get(/^(?!\/api\/).*/, (req, res) => {
    res.sendFile(path.join(DIST_DIR, "index.html"));
  });
} else {
  console.log(
    "DLVRD: dist/ not built yet — run `npm run build` to serve the frontend from this server"
  );
}

// Quick liveness/readiness probe for uptime checks and container orchestrators.
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", pid: process.pid });
});

// ================= global error handler =================
// Catches anything that calls next(err) as well as synchronous throws in route handlers.
app.use((err, req, res, next) => {
  if (err) {
    // body-parser errors carry their HTTP status (e.g. 413 for an oversized
    // upload) — adopt it when the response hasn't been marked already.
    const status = err.status || err.statusCode;
    if (Number.isInteger(status) && status >= 400 && status < 600) {
      res.statusCode = status;
      res.statusMessage = err.message || res.statusMessage;
    }
    if (res.statusCode < 400) res.statusCode = 500;
    res.statusMessage = res.statusMessage || "Internal server error";
    sendError(err, res);
    return;
  }
  next();
});

// Fallback 404 for anything that wasn't matched above.
app.use((req, res) => res.status(404).json({ error: "Not found" }));

// Keep the process alive through unexpected async errors; they still log but
// won't silently kill the API in development or a single-process deploy.
process.on("uncaughtException", (err) => {
  console.error("DLVRD uncaught exception:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("DLVRD unhandled rejection:", reason);
});

// Bind to the configured port. On EADDRINUSE we fail loudly with a clear
// message instead of hopping to another port — the Vite dev proxy (and the
// README) expect the API at PORT, and silently moving would break every
// request in development.
// Under the test runner (NODE_ENV=test) we skip this entirely: the test files
// call app.listen(0) on the exported app themselves, and a second live
// listener would keep `node --test` from ever finishing.
if (process.env.NODE_ENV !== "test") {
  const httpServer = http.createServer(app);
  httpServer.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `DLVRD: port ${PORT} is already in use — stop the other process or set PORT to a free port`
      );
      process.exit(1);
    } else {
      console.error("DLVRD: listener error:", err);
      process.exit(1);
    }
  });

  // Self-healing deploy: before binding, kill any stale process squatting on
  // our port (e.g. an old instance that never got stopped). Set
  // DLVRD_NO_FREE_PORTS=1 to disable.
  (async () => {
    const freed = await freePort(PORT);
    if (!freed) {
      console.error(
        `DLVRD: port ${PORT} is still occupied after cleanup — refusing to start`
      );
      process.exit(1);
    }
    httpServer.listen(PORT, () => {
      // Write the pid file after a successful bind so scripts/serverctl.js can
      // stop or restart the server reliably.
      try {
        fs.writeFileSync(PID_FILE, String(process.pid));
      } catch {
        /* pid file is best-effort */
      }
      console.log(`DLVRD API listening on http://localhost:${PORT}`);
    });
  })();

  // ---------- graceful shutdown ----------
  const PID_FILE = path.join(__dirname, "server.pid");
  let shuttingDown = false;
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`DLVRD: ${signal} received — shutting down`);
    try {
      fs.unlinkSync(PID_FILE);
    } catch {
      /* already gone */
    }
    process.exit(0);
  }
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("exit", () => {
    try {
      fs.unlinkSync(PID_FILE);
    } catch {
      /* already gone */
    }
  });
}

