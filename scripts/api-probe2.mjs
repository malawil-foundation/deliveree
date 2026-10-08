// Throwaway probe 2: photo upload -> stop toggle -> order completion -> CSV export.
import crypto from "node:crypto";
const BASE = "http://localhost:4000/api";

async function req(path, { method = "GET", body, token, raw, headers = {} } = {}) {
  const h = { ...headers };
  if (!raw) h["Content-Type"] = "application/json";
  if (token) h.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method,
    headers: h,
    body: raw ? body : body ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get("content-type") || "";
  const data = type.includes("json") ? await res.json().catch(() => ({})) : await res.text();
  return { status: res.status, data };
}

const login = async (email, password) =>
  (await req("/auth/login", { method: "POST", body: { email, password } })).data.token;

const cust = await login("dana@example.com", "customer123");
const disp = await login("dispatch@dlvrd.app", "dispatch123");
const drv = await login("alvin@dlvrd.app", "driver123");
const admin = await login("admin@dlvrd.app", "admin123");

const results = [];
const check = (label, r, expect = 2) =>
  results.push({ label, status: r.status, ok: Math.floor(r.status / 100) === expect, hint: typeof r.data === "string" ? r.data.slice(0, 60) : r.data?.error });

// Fresh order -> price -> pay -> assign to drv-1
const o = await req("/orders", { method: "POST", token: cust, body: { pickupAddress: "PP", dropoffAddress: "DD" } });
check("create", o);
const id = o.data.id;
check("price", await req(`/orders/${id}/price`, { method: "POST", token: disp, body: { cost: 20 } }));
check("pay", await req(`/orders/${id}/pay`, { method: "POST", token: cust }));
check("assign", await req(`/orders/${id}/assign`, { method: "POST", token: disp, body: { driverId: "drv-1" } }));

// Move drv-1's other stops out of the way? No — just find OUR stops.
const drivers = (await req("/drivers", { token: drv })).data;
const me = drivers.find((d) => d.id === "drv-1");
const mine = (me.stops || []).filter((s) => s.orderId === id);
const pickup = mine.find((s) => s.type === "pickup");
const dropoff = mine.find((s) => s.type === "dropoff");

// Try completing pickup WITHOUT photo — expect 400 with photo message
const noPhoto = await req(`/stops/${pickup.id}/toggle`, { method: "POST", token: drv });
check("toggle pickup w/o photo -> 400", noPhoto, 4);
console.log("  no-photo message:", noPhoto.data.error);

// Build a tiny valid PNG (1x1 transparent)
const png = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0300050201f34a24d50000000049454e44ae426082",
  "hex"
);
const up = await fetch(`${BASE}/stops/${pickup.id}/photo`, {
  method: "POST",
  headers: { Authorization: `Bearer ${drv}`, "Content-Type": "image/png" },
  body: png,
});
check("photo upload", { status: up.status, data: await up.json().catch(() => ({})) });

// Now toggle pickup done
check("toggle pickup with photo", await req(`/stops/${pickup.id}/toggle`, { method: "POST", token: drv }));
// Toggle dropoff done -> order completes
check("toggle dropoff", await req(`/stops/${dropoff.id}/toggle`, { method: "POST", token: drv }));
const after = (await req("/orders", { token: cust })).data.find((x) => x.id === id);
console.log("  order status after both stops done:", after.status);

// Undo dropoff to test un-complete path
check("untoggle dropoff", await req(`/stops/${dropoff.id}/toggle`, { method: "POST", token: drv }));
const after2 = (await req("/orders", { token: cust })).data.find((x) => x.id === id);
console.log("  order status after untoggle:", after2.status);

// CSV export
const csv = await fetch(`${BASE}/admin/driver-earnings.csv`, { headers: { Authorization: `Bearer ${admin}` } });
check("CSV export", { status: csv.status, data: (await csv.text()).slice(0, 80) });
console.log("  CSV head:", (results.at(-1).hint || "").replace(/\n/g, " | "));

// Record a partial payout
const pr = await req("/admin/payouts", {
  method: "POST", token: admin,
  body: { driverId: "drv-1", mode: "partial", amount: 5, note: "probe", driverMessage: "probe payout" },
});
check("record partial payout", pr);
if (pr.status === 201) {
  const pid = pr.data.payout?.id;
  console.log("  payout id:", pid, "totals:", JSON.stringify(pr.data.totals));
}

// Move stop between drivers (use elena's drv-3 if available, off-duty target should 400)
const mvOff = await req(`/stops/${pickup.id}/move`, {
  method: "POST", token: disp, body: { fromDriverId: "drv-1", toDriverId: "drv-3", toIndex: 0 },
});
check("move stop to off-duty driver -> 400", mvOff, 4);
console.log("  move-to-offduty message:", mvOff.data.error);

const bad = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - bad.length}/${results.length} passed ===`);
for (const r of bad) console.log(`FAIL ${r.status} ${r.label} — ${r.hint || r.error || ""}`);
if (bad.length) process.exitCode = 1;
