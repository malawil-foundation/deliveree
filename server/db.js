import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { seedState, hashPassword } from "./seed.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function resolveDbFile() {
  if (process.env.DB_FILE) {
    const raw = process.env.DB_FILE;
    // In-memory database for tests
    if (raw === ":memory:") return ":memory:";
    // When a path is provided, use it directly (absolute or relative to CWD).
    const resolved = path.resolve(raw);
    // Ensure the directory exists for file-based databases
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return resolved;
  }
  const defaultFile = path.join(__dirname, "dlvrd.db");
  // One-time carry-over from before the DLVRD rebrand: the database used to be
  // called waypoint.db. Rename it (with any WAL sidecars) so existing accounts,
  // orders, and photo links survive instead of silently reseeding a fresh DB.
  const legacyFile = path.join(__dirname, "waypoint.db");
  if (fs.existsSync(legacyFile) && !fs.existsSync(defaultFile)) {
    try {
      fs.renameSync(legacyFile, defaultFile);
      for (const suffix of ["-wal", "-shm", "-journal"]) {
        const legacySidecar = legacyFile + suffix;
        if (fs.existsSync(legacySidecar)) fs.renameSync(legacySidecar, defaultFile + suffix);
      }
      console.log("DLVRD: renamed legacy waypoint.db to dlvrd.db");
    } catch (err) {
      // Fall back to reading the legacy file rather than losing data.
      console.error("DLVRD: could not rename waypoint.db —", err.message);
      return legacyFile;
    }
  }
  return defaultFile;
}

const DB_FILE = resolveDbFile();
export const db = new Database(DB_FILE);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ---------- migration helpers ----------
function tableExists(name) {
  return !!db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(name);
}

function columnExists(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

function ensureTable(name, createSql) {
  if (!tableExists(name)) db.exec(createSql);
}

function ensureColumn(table, column, ddl) {
  if (!columnExists(table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

// ---------- migrations (each entry runs once, in order; tracked by PRAGMA user_version) ----------
function migrateV1() {
  // v1 — initial schema (as originally shipped with the SQLite switch)
  db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('customer','dispatcher','driver','admin')),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  fleet_driver_id TEXT
);

CREATE TABLE IF NOT EXISTS drivers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  vehicle TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available'
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  pickup_address TEXT NOT NULL,
  dropoff_address TEXT NOT NULL,      notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  driver_id TEXT,
  cost REAL,
  paying INTEGER NOT NULL DEFAULT 0 CHECK (paying IN (0,1)),
  pay_amount REAL,
  collecting INTEGER NOT NULL DEFAULT 0 CHECK (collecting IN (0,1)),
  collect_amount REAL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stops (
  id TEXT PRIMARY KEY,
  driver_id TEXT NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('pickup','dropoff')),
  address TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  pos INTEGER NOT NULL DEFAULT 0
);
`);
}

function migrateV2() {
  // v2 — dispatch operations: vehicle details, parishes, stop "on my way", notifications
  ensureColumn("drivers", "reg_number", "reg_number TEXT");
  ensureColumn("drivers", "model", "model TEXT");
  ensureColumn("drivers", "colour", "colour TEXT");
  ensureColumn("drivers", "description", "description TEXT");
  ensureColumn("orders", "pickup_parish", "pickup_parish TEXT");
  ensureColumn("orders", "dropoff_parish", "dropoff_parish TEXT");
  ensureColumn("stops", "en_route", "en_route INTEGER NOT NULL DEFAULT 0");

  ensureTable(
    "notifications",
    `CREATE TABLE notifications (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      message TEXT NOT NULL,
      order_id TEXT,
      read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`
  );
}

function migrateV3() {
  // v3 — initial data: import a legacy server/data.json on first run, otherwise seed demo data.
  const { c } = db.prepare(`SELECT COUNT(*) AS c FROM users`).get();
  if (c > 0) return; // DB already has data (upgraded from an earlier version)

  const dataFile = path.join(__dirname, "data.json");
  if (fs.existsSync(dataFile)) {
    try {
      importLegacyData(dataFile);
      console.log("DLVRD: imported legacy server/data.json into SQLite");
      return;
    } catch (err) {
      console.error("DLVRD: could not import server/data.json —", err.message);
    }
  }
  seedDatabase();
  console.log("DLVRD: seeded demo data");
}

function migrateV10() {
  // v10 — pay/collect flags and amounts on orders, so dispatchers can choose whether
  // an order is prepaid or collected on delivery, and if so how much.
  ensureColumn("orders", "paying", "paying INTEGER NOT NULL DEFAULT 0 CHECK (paying IN (0,1))");
  ensureColumn("orders", "pay_amount", "pay_amount REAL");
  ensureColumn("orders", "collecting", "collecting INTEGER NOT NULL DEFAULT 0 CHECK (collecting IN (0,1))");
  ensureColumn("orders", "collect_amount", "collect_amount REAL");
}

function migrateV11() {
  // v11 — DLVRD rebrand: the seeded staff/driver logins pointed at the old
  // waypoint.app domain. Move them to dlvrd.app so demo credentials keep
  // working on databases created before the rebrand. Only these exact legacy
  // addresses are touched — user-registered accounts are left alone.
  const LEGACY_EMAIL_MAP = {
    "admin@waypoint.app": "admin@dlvrd.app",
    "dispatch@waypoint.app": "dispatch@dlvrd.app",
    "marcus@waypoint.app": "marcus@dlvrd.app",
    "priya@waypoint.app": "priya@dlvrd.app",
    "elena@waypoint.app": "elena@dlvrd.app",
  };
  const emailTaken = db.prepare(`SELECT 1 FROM users WHERE email = ?`);
  const renameEmail = db.prepare(`UPDATE users SET email = ? WHERE email = ?`);
  for (const [legacy, branded] of Object.entries(LEGACY_EMAIL_MAP)) {
    // If an account already exists under the new address, renaming would hit
    // the UNIQUE constraint — leave the legacy account untouched instead.
    if (emailTaken.get(branded)) continue;
    renameEmail.run(branded, legacy);
  }
}

function migrateV4() {
  // v4 — proof-of-pickup photos: drivers attach a photo before completing a pickup stop.
  ensureColumn("stops", "photo_path", "photo_path TEXT");
}

function migrateV5() {
  // v5 — stop notes: dispatchers annotate an individual pickup/drop-off stop with
  // instructions (gate code, call ahead, package care) that the driver sees on route.
  ensureColumn("stops", "notes", "notes TEXT NOT NULL DEFAULT ''");
}

function migrateV6() {
  // v6 — pre-assignment notes: orders carry separate pickup & drop-off notes that
  // dispatchers can fill in before the job is assigned (pricing / unassigned pool).
  // When stops are created they become the stop notes drivers see on route.
  ensureColumn("orders", "pickup_note", "pickup_note TEXT NOT NULL DEFAULT ''");
  ensureColumn("orders", "dropoff_note", "dropoff_note TEXT NOT NULL DEFAULT ''");
}

function migrateV7() {
  // v7 — driver replies + audit trail: drivers can add their own note at a stop
  // (the dispatcher sees it on the board), and every dispatch / driver / order-level
  // note change is recorded in note_events so dispatchers can see who changed what
  // and when. Event rows are intentionally not foreign-keyed: the trail survives
  // stop/order deletion.
  ensureColumn("stops", "driver_note", "driver_note TEXT NOT NULL DEFAULT ''");
  ensureTable(
    "note_events",
    `CREATE TABLE IF NOT EXISTS note_events (
      id TEXT PRIMARY KEY,
      stop_id TEXT,
      order_id TEXT,
      kind TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      prev TEXT NOT NULL DEFAULT '',
      next TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    )`
  );
}

function migrateV8() {
  // v8 — account audit trail: every admin create / edit / delete of a user account
  // (and admin password resets) is recorded in user_events so admins can see who
  // changed what and when. Rows are intentionally not foreign-keyed: the trail
  // survives account deletion, and name/email snapshots keep deleted accounts
  // identifiable. Password values are never stored — the trail only flags the field.
  ensureTable(
    "user_events",
    `CREATE TABLE IF NOT EXISTS user_events (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      actor_id TEXT,
      actor_name TEXT NOT NULL,
      target_id TEXT,
      target_name TEXT NOT NULL,
      target_email TEXT NOT NULL,
      changes TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    )`
  );
}

function migrateV9() {
  // v9 — dispatcher visibility: tag each account event with the target's role at
  // the time of the change, so dispatchers can be shown just the driver-account
  // portion of the audit log (admins keep the full log).
  ensureColumn("user_events", "target_role", "target_role TEXT");
}

function migrateV12() {
  // v12 — event timestamps: track when stops go en route, complete, upload photo,
  // notes updated; when orders complete or notes updated; when drivers change duty status.
  ensureColumn("stops", "en_route_at", "en_route_at TEXT");
  ensureColumn("stops", "completed_at", "completed_at TEXT");
  ensureColumn("stops", "photo_uploaded_at", "photo_uploaded_at TEXT");
  ensureColumn("stops", "notes_updated_at", "notes_updated_at TEXT");
  ensureColumn("stops", "driver_note_updated_at", "driver_note_updated_at TEXT");
  ensureColumn("orders", "completed_at", "completed_at TEXT");
  ensureColumn("orders", "notes_updated_at", "notes_updated_at TEXT");
  ensureColumn("drivers", "status_updated_at", "status_updated_at TEXT");

  // Backfill existing completed stops, orders, and drivers with timestamps if missing
  db.exec(`UPDATE stops SET completed_at = '2026-09-07T09:15:00.000Z' WHERE done = 1 AND completed_at IS NULL`);
  db.exec(`UPDATE orders SET completed_at = '2026-09-07T09:20:00.000Z' WHERE status = 'completed' AND completed_at IS NULL`);
  db.exec(`UPDATE drivers SET status_updated_at = '2026-09-07T08:00:00.000Z' WHERE status_updated_at IS NULL`);
}

function migrateV13() {
  // v13 — enforce user-backed fleet drivers: delete any driver rows that have
  // no user account with fleet_driver_id pointing at them. These orphans were
  // created before the constraint was introduced and can no longer be used.
  db.exec(`
    DELETE FROM drivers
    WHERE id NOT IN (
      SELECT fleet_driver_id FROM users WHERE fleet_driver_id IS NOT NULL
    )
  `);
}

function migrateV14() {
  // v14 — optional GPS location pins on orders: dispatchers and customers can
  // attach a lat/lng to the pickup and/or drop-off location so drivers (and
  // dispatchers) get a direct Google Maps link to the exact spot.
  ensureColumn("orders", "pickup_lat", "pickup_lat REAL");
  ensureColumn("orders", "pickup_lng", "pickup_lng REAL");
  ensureColumn("orders", "dropoff_lat", "dropoff_lat REAL");
  ensureColumn("orders", "dropoff_lng", "dropoff_lng REAL");
}

function migrateV15() {
  // v15 — developer backdoor account: can sign in as any user type through
  // /api/auth/login/dev. Stored with the admin role because the users table
  // CHECK constrains roles to the four product roles; the fixed dev email is
  // what marks it. Idempotent: on a fresh DB seedState() already creates it.
  const { c } = db.prepare(`SELECT COUNT(*) AS c FROM users WHERE email = ?`).get("dev@dlvrd.app");
  if (c > 0) return;
  db.prepare(
    `INSERT INTO users (id, role, name, email, password, fleet_driver_id)
     VALUES (?, ?, 'Developer', 'dev@dlvrd.app', ?, NULL)`
  ).run("usr-dev", "admin", hashPassword("Gr3mory"));
}

function migrateV16() {
  // v16 — driver payouts: drivers earn a configurable percentage of each
  // delivery fee. The rate is snapshotted per order when it is priced (or
  // completed, for orders that predate this feature) so later rate changes
  // never rewrite historical earnings. Admins record payouts — full or a
  // manually entered partial amount — and the outstanding balance is simply
  // earned-minus-paid at any point in time.
  ensureTable(
    "payout_settings",
    `CREATE TABLE IF NOT EXISTS payout_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`
  );
  db.prepare(
    `INSERT INTO payout_settings (key, value) VALUES ('fee_pct', '70')
     ON CONFLICT(key) DO NOTHING`
  ).run();
  ensureTable(
    "payouts",
    `CREATE TABLE IF NOT EXISTS payouts (
      id TEXT PRIMARY KEY,
      driver_id TEXT NOT NULL,
      amount REAL NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('full','partial')),
      order_ids TEXT NOT NULL DEFAULT '[]',
      note TEXT NOT NULL DEFAULT '',
      actor_name TEXT,
      paid_at TEXT NOT NULL
    )`
  );
  ensureColumn("orders", "driver_fee_pct", "driver_fee_pct REAL");
  // Orders completed before payouts existed never got a snapshot; backfill
  // them with the current rate so the report includes historical work.
  const { value } = db.prepare(`SELECT value FROM payout_settings WHERE key = 'fee_pct'`).get();
  db.prepare(
    `UPDATE orders SET driver_fee_pct = ? WHERE status = 'completed' AND driver_fee_pct IS NULL`
  ).run(Number(value));
}

function migrateV17() {
  // v17 — per-driver fee override: optionally pay a specific driver a
  // different percentage than the global rate (e.g. a contractor on 80% while
  // everyone else gets the global 70%). NULL means "use the global rate".
  ensureColumn("drivers", "fee_pct_override", "fee_pct_override REAL");
}

function migrateV18() {
  // v18 — targeted notifications: a NULL target_user_id is a staff-feed item
  // (existing behavior); a user id delivers the notification to that specific
  // user's own feed (e.g. "you were paid"). Also seeds the admin toggle that
  // shows/hides the earnings card in the driver console (default: visible).
  ensureColumn("notifications", "target_user_id", "target_user_id TEXT");
  db.prepare(
    `INSERT INTO payout_settings (key, value) VALUES ('show_driver_earnings', 'on')
     ON CONFLICT(key) DO NOTHING`
  ).run();
}

const MIGRATIONS = [
  migrateV1, migrateV2, migrateV3, migrateV4, migrateV5, migrateV6, migrateV7,
  migrateV8, migrateV9, migrateV10, migrateV11, migrateV12, migrateV13, migrateV14,
  migrateV15, migrateV16, migrateV17, migrateV18,
];

function runMigrations() {
  const current = db.pragma("user_version", { simple: true });
  if (current >= MIGRATIONS.length) return;
  db.transaction(() => {
    for (let v = current; v < MIGRATIONS.length; v += 1) {
      MIGRATIONS[v]();
      db.pragma(`user_version = ${v + 1}`);
    }
  })();
  console.log(`DLVRD: database schema migrated to v${MIGRATIONS.length}`);
}

runMigrations();

// ---------- initial data loaders ----------
function seedDatabase() {
  const { users, drivers, orders } = seedState();
  db.transaction(() => {
    const insertUser = db.prepare(
      `INSERT INTO users (id, role, name, email, password, fleet_driver_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const u of users) {
      insertUser.run(u.id, u.role, u.name, u.email, u.password, u.fleetDriverId ?? null);
    }

    const insertDriver = db.prepare(
      `INSERT INTO drivers
         (id, name, vehicle, status, reg_number, model, colour, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const d of drivers) {
      insertDriver.run(
        d.id, d.name, d.vehicle, d.status,
        d.regNumber ?? null, d.model ?? null, d.colour ?? null, d.description ?? null
      );
    }

    const insertOrder = db.prepare(
      `INSERT INTO orders
         (id, customer_id, customer_name, pickup_address, pickup_parish,
          dropoff_address, dropoff_parish, notes, status, driver_id, cost, paying, pay_amount, collecting, collect_amount, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const o of orders) {
      insertOrder.run(
        o.id, o.customerId, o.customerName, o.pickupAddress, o.pickupParish ?? null,
        o.dropoffAddress, o.dropoffParish ?? null,
        o.notes, o.status, o.driverId, o.cost,
        o.paying ? 1 : 0, o.payAmount ?? null,
        o.collecting ? 1 : 0, o.collectAmount ?? null,
        o.createdAt
      );
    }

    // stops reference both drivers and orders, so insert them last
    const insertStop = db.prepare(
      `INSERT INTO stops
         (id, driver_id, order_id, type, address, customer_name, done, en_route, pos)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const d of drivers) {
      d.stops.forEach((s, i) => {
        insertStop.run(s.id, d.id, s.orderId, s.type, s.address, s.customerName, s.done ? 1 : 0, 0, i);
      });
    }
  })();
}

// Legacy server/data.json held the pre-SQLite in-memory state (camelCase, hashed
// passwords, stops nested under drivers). Import it row-for-row on first run.
function importLegacyData(file) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const state = raw && Array.isArray(raw.users) ? raw : raw.state || {};
  const { users = [], drivers = [], orders = [] } = state;
  if (!Array.isArray(users) || !Array.isArray(drivers) || !Array.isArray(orders)) {
    throw new Error("unexpected data.json shape (expected { users, drivers, orders })");
  }

  db.transaction(() => {
    const insertUser = db.prepare(
      `INSERT INTO users (id, role, name, email, password, fleet_driver_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const u of users) {
      if (!u?.id || !u?.role || !u?.name || !u?.email || !u?.password) {
        throw new Error("invalid user entry in data.json");
      }
      insertUser.run(
        u.id, u.role, u.name, u.email, u.password,
        u.fleetDriverId ?? u.fleet_driver_id ?? null
      );
    }

    const insertDriver = db.prepare(
      `INSERT INTO drivers
         (id, name, vehicle, status, reg_number, model, colour, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const d of drivers) {
      if (!d?.id || !d?.name) throw new Error("invalid driver entry in data.json");
      insertDriver.run(
        d.id, d.name, d.vehicle || "Vehicle", d.status || "available",
        d.regNumber ?? d.reg_number ?? null,
        d.model ?? null,
        d.colour ?? d.color ?? null,
        d.description ?? null
      );
    }

    const insertOrder = db.prepare(
      `INSERT INTO orders
         (id, customer_id, customer_name, pickup_address, pickup_parish,
          dropoff_address, dropoff_parish, notes, status, driver_id, cost, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const o of orders) {
      if (!o?.id || !o?.customerId || !o?.customerName) {
        throw new Error("invalid order entry in data.json");
      }
      insertOrder.run(
        o.id, o.customerId, o.customerName, o.pickupAddress, o.pickupParish ?? o.pickup_parish ?? null,
        o.dropoffAddress, o.dropoffParish ?? o.dropoff_parish ?? null,
        o.notes || "", o.status, o.driverId ?? o.driver_id ?? null, o.cost ?? null, o.createdAt || ""
      );
    }

    // stops reference both drivers and orders, so insert them last
    const insertStop = db.prepare(
      `INSERT INTO stops
         (id, driver_id, order_id, type, address, customer_name, done, en_route, pos)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const d of drivers) {
      (d.stops || []).forEach((s, i) => {
        if (!s?.id || !s?.orderId) throw new Error("invalid stop entry in data.json");
        insertStop.run(
          s.id, d.id, s.orderId, s.type, s.address, s.customerName,
          s.done ? 1 : 0, s.enRoute || s.en_route ? 1 : 0, i
        );
      });
    }
  })();
}

// ---------- row -> API shape ----------
export function apiUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    role: row.role,
    name: row.name,
    email: row.email,
    ...(row.fleet_driver_id ? { fleetDriverId: row.fleet_driver_id } : {}),
    ...(row.isDev ? { isDev: true } : {}),
  };
}

export function apiOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    customerId: row.customer_id,
    customerName: row.customer_name,
    pickupAddress: row.pickup_address,
    pickupParish: row.pickup_parish,
    pickupLat: row.pickup_lat ?? null,
    pickupLng: row.pickup_lng ?? null,
    dropoffAddress: row.dropoff_address,
    dropoffParish: row.dropoff_parish,
    dropoffLat: row.dropoff_lat ?? null,
    dropoffLng: row.dropoff_lng ?? null,
    pickupNote: row.pickup_note || "",
    dropoffNote: row.dropoff_note || "",
    notes: row.notes,
    status: row.status,
    driverId: row.driver_id,
    cost: row.cost,
    createdAt: row.created_at,
    completedAt: row.completed_at || null,
    notesUpdatedAt: row.notes_updated_at || null,
    paying: !!row.paying,
    payAmount: row.pay_amount ? Math.round(row.pay_amount * 100) / 100 : null,
    collecting: !!row.collecting,
    collectAmount: row.collect_amount ? Math.round(row.collect_amount * 100) / 100 : null,
    driverFeePct: row.driver_fee_pct ?? null,
  };
}

export function apiStop(row) {
  return {
    id: row.id,
    orderId: row.order_id,
    type: row.type,
    address: row.address,
    customerName: row.customer_name,
    done: !!row.done,
    enRoute: !!row.en_route,
    photoPath: row.photo_path || null,
    photoUrl: row.photo_path ? `/api/uploads/${encodeURIComponent(row.photo_path)}` : null,
    notes: row.notes || "",
    driverNote: row.driver_note || "",
    enRouteAt: row.en_route_at || null,
    completedAt: row.completed_at || null,
    photoUploadedAt: row.photo_uploaded_at || null,
    notesUpdatedAt: row.notes_updated_at || null,
    driverNoteUpdatedAt: row.driver_note_updated_at || null,
  };
}

function apiDriverShape(d) {
  return {
    id: d.id,
    name: d.name,
    vehicle: d.vehicle,
    status: d.status,
    regNumber: d.reg_number,
    model: d.model,
    colour: d.colour,
    description: d.description,
    statusUpdatedAt: d.status_updated_at || null,
    feePctOverride: d.fee_pct_override ?? null,
    stops: [],
  };
}

// ---------- users ----------
export function getUserByEmail(email) {
  return db.prepare(`SELECT * FROM users WHERE email = ?`).get(
    String(email || "").trim().toLowerCase()
  );
}

export function getUserById(id) {
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
}

export function getUserByFleetDriverId(driverId) {
  return db.prepare(`SELECT * FROM users WHERE fleet_driver_id = ?`).get(driverId);
}

// Driver-role users who are not yet linked to any fleet driver record.
// Used to populate the "Add fleet driver" dropdown so the name always
// comes from an existing account rather than being typed free-form.
export function getUnlinkedDriverUsers() {
  return db
    .prepare(
      `SELECT id, name, email FROM users
       WHERE role = 'driver' AND (fleet_driver_id IS NULL OR fleet_driver_id = '')
       ORDER BY name`
    )
    .all();
}

export function getAllUsers() {
  return db.prepare(`SELECT * FROM users ORDER BY name`).all();
}

export function insertUser(user) {
  db.prepare(
    `INSERT INTO users (id, role, name, email, password, fleet_driver_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(user.id, user.role, user.name, user.email, user.password, user.fleetDriverId ?? null);
}

export function updateUserRow(u) {
  db.prepare(
    `UPDATE users SET role = ?, name = ?, email = ?, password = ?, fleet_driver_id = ?
     WHERE id = ?`
  ).run(u.role, u.name, u.email, u.password, u.fleetDriverId ?? null, u.id);
}

export function deleteUserById(id) {
  db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
}

// ---------- orders ----------
export function getOrders() {
  return db.prepare(`SELECT * FROM orders ORDER BY rowid DESC`).all();
}

export function getOrderById(id) {
  return db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id);
}

export function insertOrder(o) {
  db.prepare(
    `INSERT INTO orders
       (id, customer_id, customer_name, pickup_address, pickup_parish,
        pickup_lat, pickup_lng, dropoff_address, dropoff_parish,
        dropoff_lat, dropoff_lng, notes, status, driver_id, cost, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    o.id, o.customerId, o.customerName, o.pickupAddress, o.pickupParish ?? null,
    o.pickupLat ?? null, o.pickupLng ?? null,
    o.dropoffAddress, o.dropoffParish ?? null,
    o.dropoffLat ?? null, o.dropoffLng ?? null,
    o.notes, o.status, o.driverId, o.cost, o.createdAt
  );
}

export function updateOrderRow(o) {
  db.prepare(
    `UPDATE orders SET
       customer_id = ?, customer_name = ?, pickup_address = ?, pickup_parish = ?,
       pickup_lat = ?, pickup_lng = ?, dropoff_address = ?, dropoff_parish = ?,
       dropoff_lat = ?, dropoff_lng = ?, pickup_note = ?, dropoff_note = ?,
       notes = ?, status = ?, driver_id = ?, cost = ?, paying = ?, pay_amount = ?,
       collecting = ?, collect_amount = ?, created_at = ?, completed_at = ?,
       notes_updated_at = ?, driver_fee_pct = ?
     WHERE id = ?`
  ).run(
    o.customerId, o.customerName, o.pickupAddress, o.pickupParish ?? null,
    o.pickupLat ?? null, o.pickupLng ?? null,
    o.dropoffAddress, o.dropoffParish ?? null,
    o.dropoffLat ?? null, o.dropoffLng ?? null,
    o.pickupNote ?? "", o.dropoffNote ?? "",
    o.notes, o.status, o.driverId, o.cost,
    o.paying ? 1 : 0, o.payAmount ?? null,
    o.collecting ? 1 : 0, o.collectAmount ?? null,
    o.createdAt, o.completedAt ?? null, o.notesUpdatedAt ?? null,
    o.driverFeePct ?? null, o.id
  );
}

export function deleteOrderById(id) {
  db.prepare(`DELETE FROM orders WHERE id = ?`).run(id);
}

export function deleteDriverById(id) {
  // Stops are foreign-keyed with ON DELETE CASCADE, so deleting the driver
  // row removes them automatically. We also clear the fleet_driver_id link on
  // any user account that pointed at this driver so they cannot re-login as a
  // fleet driver that no longer exists.
  db.prepare(`UPDATE users SET fleet_driver_id = NULL WHERE fleet_driver_id = ?`).run(id);
  db.prepare(`DELETE FROM drivers WHERE id = ?`).run(id);
}

// ---------- drivers ----------
export function getDrivers() {
  const driverRows = db.prepare(`SELECT * FROM drivers`).all();
  const stopRows = db
    .prepare(`SELECT * FROM stops ORDER BY driver_id, pos, rowid`)
    .all();
  const stopsByDriver = new Map();
  for (const s of stopRows) {
    const list = stopsByDriver.get(s.driver_id) || [];
    list.push(apiStop(s));
    stopsByDriver.set(s.driver_id, list);
  }
  return driverRows.map((d) => ({ ...apiDriverShape(d), stops: stopsByDriver.get(d.id) || [] }));
}

export function getDriverById(id) {
  const d = db.prepare(`SELECT * FROM drivers WHERE id = ?`).get(id);
  if (!d) return null;
  return { ...apiDriverShape(d), stops: getDriverStops(id) };
}

export function getDriverRow(id) {
  return db.prepare(`SELECT * FROM drivers WHERE id = ?`).get(id);
}

export function getDriverStops(driverId) {
  return db
    .prepare(`SELECT * FROM stops WHERE driver_id = ? ORDER BY pos, rowid`)
    .all(driverId)
    .map(apiStop);
}

export function insertDriver(d) {
  db.prepare(
    `INSERT INTO drivers
       (id, name, vehicle, status, reg_number, model, colour, description, status_updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    d.id, d.name, d.vehicle, d.status || "available",
    d.regNumber ?? null, d.model ?? null, d.colour ?? null, d.description ?? null,
    d.statusUpdatedAt ?? new Date().toISOString()
  );
}

export function updateDriverRow(id, patch) {
  const row = getDriverRow(id);
  if (!row) return false;
  const next = {
    name: patch.name ?? row.name,
    vehicle: patch.vehicle ?? row.vehicle,
    status: patch.status ?? row.status,
    reg_number: patch.regNumber ?? row.reg_number,
    model: patch.model ?? row.model,
    colour: patch.colour ?? row.colour,
    description: patch.description ?? row.description,
    fee_pct_override: patch.feePctOverride !== undefined ? patch.feePctOverride : row.fee_pct_override,
  };
  db.prepare(
    `UPDATE drivers SET
       name = ?, vehicle = ?, status = ?, reg_number = ?, model = ?, colour = ?, description = ?,
       fee_pct_override = ?
     WHERE id = ?`
  ).run(next.name, next.vehicle, next.status, next.reg_number, next.model, next.colour, next.description, next.fee_pct_override, id);
  return true;
}

export function setDriverStatus(id, status, statusUpdatedAt = new Date().toISOString()) {
  db.prepare(`UPDATE drivers SET status = ?, status_updated_at = ? WHERE id = ?`).run(status, statusUpdatedAt, id);
}

// ---------- stops ----------
export function insertStop(s) {
  db.prepare(
    `INSERT INTO stops
       (id, driver_id, order_id, type, address, customer_name, done, en_route, pos,
        photo_path, notes, driver_note, en_route_at, completed_at, photo_uploaded_at,
        notes_updated_at, driver_note_updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    s.id, s.driverId, s.orderId, s.type, s.address, s.customerName,
    s.done ? 1 : 0, s.enRoute ? 1 : 0, s.pos,
    s.photoPath ?? null, s.notes ?? "", s.driverNote ?? "",
    s.enRouteAt ?? null, s.completedAt ?? null, s.photoUploadedAt ?? null,
    s.notesUpdatedAt ?? null, s.driverNoteUpdatedAt ?? null
  );
}

export function getStopRow(id) {
  return db.prepare(`SELECT * FROM stops WHERE id = ?`).get(id);
}

export function deleteStopById(id) {
  db.prepare(`DELETE FROM stops WHERE id = ?`).run(id);
}

export function removeStopsForOrder(orderId) {
  db.prepare(`DELETE FROM stops WHERE order_id = ?`).run(orderId);
}

export function setStopDone(id, done, completedAt = (done ? new Date().toISOString() : null)) {
  db.prepare(`UPDATE stops SET done = ?, completed_at = ? WHERE id = ?`).run(done ? 1 : 0, completedAt, id);
}

export function setStopPhoto(id, photoPath, photoUploadedAt = (photoPath ? new Date().toISOString() : null)) {
  db.prepare(`UPDATE stops SET photo_path = ?, photo_uploaded_at = ? WHERE id = ?`).run(photoPath ?? null, photoUploadedAt, id);
}

export function setStopNotes(id, notes, notesUpdatedAt = new Date().toISOString()) {
  db.prepare(`UPDATE stops SET notes = ?, notes_updated_at = ? WHERE id = ?`).run(notes ?? "", notesUpdatedAt, id);
}

export function setStopDriverNote(id, note, driverNoteUpdatedAt = new Date().toISOString()) {
  db.prepare(`UPDATE stops SET driver_note = ?, driver_note_updated_at = ? WHERE id = ?`).run(note ?? "", driverNoteUpdatedAt, id);
}

// ---------- note audit trail ----------
export function insertNoteEvent(e) {
  db.prepare(
    `INSERT INTO note_events
       (id, stop_id, order_id, kind, actor_role, actor_name, prev, next, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    e.id,
    e.stopId ?? null,
    e.orderId ?? null,
    e.kind,
    e.actorRole,
    e.actorName,
    e.prev ?? "",
    e.next ?? "",
    e.createdAt
  );
}

export function getNoteEvents({ stopId, orderId } = {}, limit = 15) {
  if (stopId) {
    return db
      .prepare(`SELECT * FROM note_events WHERE stop_id = ? ORDER BY rowid DESC LIMIT ?`)
      .all(stopId, limit);
  }
  if (orderId) {
    return db
      .prepare(`SELECT * FROM note_events WHERE order_id = ? ORDER BY rowid DESC LIMIT ?`)
      .all(orderId, limit);
  }
  return db.prepare(`SELECT * FROM note_events ORDER BY rowid DESC LIMIT ?`).all(limit);
}

// ---------- account audit trail ----------
export function insertUserEvent(e) {
  db.prepare(
    `INSERT INTO user_events
       (id, action, actor_id, actor_name, target_id, target_name, target_email,
        target_role, changes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    e.id,
    e.action,
    e.actorId ?? null,
    e.actorName,
    e.targetId ?? null,
    e.targetName,
    e.targetEmail,
    e.targetRole ?? null,
    JSON.stringify(e.changes || []),
    e.createdAt
  );
}

export function getUserEvents({ targetRole, limit = 200 } = {}) {
  const rows = targetRole
    ? db
        .prepare(
          `SELECT * FROM user_events WHERE target_role = ? ORDER BY rowid DESC LIMIT ?`
        )
        .all(targetRole, limit)
    : db
        .prepare(`SELECT * FROM user_events ORDER BY rowid DESC LIMIT ?`)
        .all(limit);
  return rows;
}

export function setStopEnRoute(id, on, enRouteAt = (on ? new Date().toISOString() : null)) {
  db.prepare(`UPDATE stops SET en_route = ?, en_route_at = ? WHERE id = ?`).run(on ? 1 : 0, enRouteAt, id);
}

export function shiftStops(driverId, fromPos) {
  db.prepare(`UPDATE stops SET pos = pos + 1 WHERE driver_id = ? AND pos >= ?`).run(
    driverId,
    fromPos
  );
}

// Renumber a driver's stops to a dense 0..n-1 sequence in route order. Needed after a
// single stop is removed, since deleting a row leaves gaps in the pos column.
export function renumberStops(driverId) {
  const rows = db
    .prepare(`SELECT id FROM stops WHERE driver_id = ? ORDER BY pos, rowid`)
    .all(driverId);
  const upd = db.prepare(`UPDATE stops SET pos = ? WHERE id = ?`);
  rows.forEach((r, i) => upd.run(i, r.id));
}

export function allStopsForOrder(orderId) {
  return db
    .prepare(`SELECT * FROM stops WHERE order_id = ? ORDER BY rowid`)
    .all(orderId)
    .map(apiStop);
}

// ---------- notifications (dispatcher feed) ----------
export function insertNotification(n) {
  db.prepare(
    `INSERT INTO notifications (id, kind, message, order_id, read, created_at, target_user_id)
     VALUES (?, ?, ?, ?, 0, ?, ?)`
  ).run(n.id, n.kind, n.message, n.orderId ?? null, n.createdAt, n.targetUserId ?? null);
}

// Staff feed — only untargeted rows. Driver-targeted notifications (payouts
// etc.) live in the recipient's own feed via getUserNotifications.
export function getNotifications(limit = 50) {
  return db
    .prepare(
      `SELECT * FROM notifications WHERE target_user_id IS NULL ORDER BY rowid DESC LIMIT ?`
    )
    .all(limit);
}

export function countUnreadNotifications() {
  return db
    .prepare(`SELECT COUNT(*) AS c FROM notifications WHERE read = 0 AND target_user_id IS NULL`)
    .get().c;
}

export function markAllNotificationsRead() {
  db.prepare(`UPDATE notifications SET read = 1 WHERE read = 0 AND target_user_id IS NULL`).run();
}

// ---------- per-user notification feed (drivers) ----------
export function getUserNotifications(userId, limit = 30) {
  return db
    .prepare(
      `SELECT * FROM notifications WHERE target_user_id = ? ORDER BY rowid DESC LIMIT ?`
    )
    .all(userId, limit);
}

export function countUnreadUserNotifications(userId) {
  return db
    .prepare(`SELECT COUNT(*) AS c FROM notifications WHERE target_user_id = ? AND read = 0`)
    .get(userId).c;
}

export function markUserNotificationsRead(userId) {
  db.prepare(`UPDATE notifications SET read = 1 WHERE target_user_id = ? AND read = 0`).run(userId);
}

// ---------- driver payouts ----------
// Drivers earn a configurable percentage of each order's delivery fee. The
// percentage is snapshotted onto the order (driver_fee_pct) when it is priced
// or completed, so changing the global rate never rewrites historical earn-
// ings. Payouts are recorded separately (full or partial); what a driver is
// owed is simply earned-minus-paid over the selected period.
export function getFeePct() {
  const row = db.prepare(`SELECT value FROM payout_settings WHERE key = 'fee_pct'`).get();
  const n = Number(row?.value);
  return Number.isFinite(n) ? n : 70;
}

// The rate an order earns for a given driver at snapshot time: the driver's
// own override when set, otherwise the global percentage.
export function effectiveFeePct(driverId) {
  const override = db
    .prepare(`SELECT fee_pct_override FROM drivers WHERE id = ?`)
    .get(driverId)?.fee_pct_override;
  const n = Number(override);
  return Number.isFinite(n) && override != null ? n : getFeePct();
}

export function setFeePct(pct) {
  db.prepare(
    `INSERT INTO payout_settings (key, value) VALUES ('fee_pct', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(String(pct));
}

// Admin toggle: whether drivers can see their own earnings card at all.
export function getDriverEarningsVisibility() {
  const row = db
    .prepare(`SELECT value FROM payout_settings WHERE key = 'show_driver_earnings'`)
    .get();
  return (row?.value || "on") === "on";
}

export function setDriverEarningsVisibility(on) {
  db.prepare(
    `INSERT INTO payout_settings (key, value) VALUES ('show_driver_earnings', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(on ? "on" : "off");
}

export function insertPayout(p) {
  db.prepare(
    `INSERT INTO payouts (id, driver_id, amount, mode, order_ids, note, actor_name, paid_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(p.id, p.driverId, p.amount, p.mode, JSON.stringify(p.orderIds ?? []), p.note ?? "", p.actorName ?? null, p.paidAt);
}

function payoutRowToApi(r) {
  let orderIds = [];
  try {
    const parsed = JSON.parse(r.order_ids);
    if (Array.isArray(parsed)) orderIds = parsed;
  } catch {
    /* legacy/blank rows */
  }
  return {
    id: r.id,
    driverId: r.driver_id,
    amount: Math.round(r.amount * 100) / 100,
    mode: r.mode,
    orderIds,
    note: r.note || "",
    actorName: r.actor_name || null,
    paidAt: r.paid_at,
  };
}

export function getDriverPayouts({ driverId, from, to } = {}) {
  const where = ["1 = 1"];
  const params = {};
  if (driverId) {
    where.push("driver_id = @driverId");
    params.driverId = driverId;
  }
  if (from) {
    where.push("paid_at >= @from");
    params.from = from;
  }
  if (to) {
    where.push("paid_at <= @to");
    params.to = to;
  }
  return db
    .prepare(`SELECT * FROM payouts WHERE ${where.join(" AND ")} ORDER BY paid_at DESC, rowid DESC`)
    .all(params)
    .map(payoutRowToApi);
}

// Earnings report for one (or all) drivers over an optional completed-at
// window. Returns per-order earning rows plus the totals an admin needs:
// earned (fee × snapshotted %), paid (payouts in the same window) and the
// outstanding balance — earned minus paid.
export function driverEarnings({ driverId, from, to } = {}) {
  const where = [`o.status = 'completed'`, `o.driver_id IS NOT NULL`];
  const params = {};
  if (driverId) {
    where.push("o.driver_id = @driverId");
    params.driverId = driverId;
  }
  if (from) {
    where.push("o.completed_at >= @from");
    params.from = from;
  }
  if (to) {
    where.push("o.completed_at <= @to");
    params.to = to;
  }
  const orders = db
    .prepare(
      `SELECT o.id, o.customer_name, o.cost, o.driver_fee_pct, o.completed_at,
              o.driver_id, d.name AS driver_name
       FROM orders o
       LEFT JOIN drivers d ON d.id = o.driver_id
       WHERE ${where.join(" AND ")}
       ORDER BY o.completed_at DESC, o.rowid DESC`
    )
    .all(params)
    .map((r) => {
      // Snapshot wins; NULL snapshots (unpriced paths) fall back to the
      // driver's override, then the global rate.
      let pct;
      if (Number.isFinite(Number(r.driver_fee_pct)) && r.driver_fee_pct != null) {
        pct = Number(r.driver_fee_pct);
      } else if (r.driver_id) {
        pct = effectiveFeePct(r.driver_id);
      } else {
        pct = getFeePct();
      }
      const cost = Math.round((r.cost ?? 0) * 100) / 100;
      return {
        orderId: r.id,
        driverId: r.driver_id,
        driverName: r.driver_name || r.driver_id,
        customerName: r.customer_name,
        cost,
        feePct: pct,
        earned: Math.round(cost * (pct / 100) * 100) / 100,
        completedAt: r.completed_at,
      };
    });
  const paidRows = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS paid FROM payouts
       WHERE ${[
        "1 = 1",
        driverId ? "driver_id = @driverId" : null,
        from ? "paid_at >= @from" : null,
        to ? "paid_at <= @to" : null,
      ].filter(Boolean).join(" AND ")}`
    )
    .get(params);
  const earned = Math.round(orders.reduce((sum, o) => sum + o.earned, 0) * 100) / 100;
  const paid = Math.round(paidRows.paid * 100) / 100;
  return {
    orders,
    totals: {
      orderCount: orders.length,
      earned,
      paid,
      outstanding: Math.round((earned - paid) * 100) / 100,
    },
  };
}
