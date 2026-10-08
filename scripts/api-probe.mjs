// Throwaway probe: exercises the real API on :4000 as each role and reports
// any non-2xx responses so client/server contract breaks are visible.
const BASE = "http://localhost:4000/api";

async function req(path, { method = "GET", body, token, raw } = {}) {
  const headers = {};
  if (!raw) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: raw ? body : body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const results = [];
function check(label, r, expect = 2) {
  const ok = Math.floor(r.status / 100) === expect;
  results.push({ label, status: r.status, ok, error: r.data?.error });
}

async function login(email, password, role) {
  const path = role ? `/auth/login/${role}` : "/auth/login";
  const r = await req(path, { method: "POST", body: { email, password } });
  if (r.status !== 200) throw new Error(`login ${email} -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.token;
}

async function main() {
  const cust = await login("dana@example.com", "customer123");
  const disp = await login("dispatch@dlvrd.app", "dispatch123");
  const drv = await login("alvin@dlvrd.app", "driver123");
  const admin = await login("admin@dlvrd.app", "admin123");

  // ---------- reads ----------
  for (const [t, name] of [[cust, "cust"], [disp, "disp"], [drv, "drv"], [admin, "admin"]]) {
    check(`${name} GET /orders`, await req("/orders", { token: t }));
    check(`${name} GET /drivers`, await req("/drivers", { token: t }));
  }
  check("disp GET /notifications", await req("/notifications", { token: disp }));
  check("disp GET /note-history", await req("/note-history", { token: disp }));
  check("disp GET /driver-account-events", await req("/driver-account-events", { token: disp }));
  check("disp GET /drivers/eligible-users", await req("/drivers/eligible-users", { token: disp }));
  check("drv GET /my-earnings", await req("/my-earnings", { token: drv }));
  check("drv GET /my-notifications", await req("/my-notifications", { token: drv }));
  check("admin GET /admin/stats", await req("/admin/stats", { token: admin }));
  check("admin GET /admin/users", await req("/admin/users", { token: admin }));
  check("admin GET /admin/user-events", await req("/admin/user-events", { token: admin }));
  check("admin GET /admin/payout-settings", await req("/admin/payout-settings", { token: admin }));
  check("admin GET /admin/driver-earnings", await req("/admin/driver-earnings", { token: admin }));
  check("admin GET /admin/payouts", await req("/admin/payouts", { token: admin }));
  check("admin GET /admin/drivers-summary", await req("/admin/drivers-summary", { token: admin }));

  // ---------- customer lifecycle ----------
  const created = await req("/orders", {
    method: "POST",
    token: cust,
    body: {
      pickupAddress: "Probe pickup 1",
      dropoffAddress: "Probe dropoff 1",
      pickupParish: "Saint Michael",
      dropoffParish: "Saint James",
      pickupLat: 13.1,
      pickupLng: -59.6,
      dropoffLat: 13.2,
      dropoffLng: -59.7,
      notes: "probe order",
    },
  });
  check("cust POST /orders", created, 2);
  const orderId = created.data?.id;
  const priced = await req(`/orders/${orderId}/price`, {
    method: "POST", token: disp, body: { cost: 25.5, paying: true, payAmount: 25.5 },
  });
  check("disp POST /orders/:id/price", priced, 2);
  const paid = await req(`/orders/${orderId}/pay`, { method: "POST", token: cust });
  check("cust POST /orders/:id/pay", paid, 2);
  // assign to first available driver
  const drivers = (await req("/drivers", { token: disp })).data;
  const target = drivers.find((d) => d.status !== "off-duty");
  if (target) {
    const assigned = await req(`/orders/${orderId}/assign`, {
      method: "POST", token: disp, body: { driverId: target.id },
    });
    check("disp POST /orders/:id/assign", assigned, 2);
    // Stops live on the driver object, not the order — refetch drivers.
    const drivers2 = (await req("/drivers", { token: drv })).data;
    const myDriver = drivers2.find((d) => d.id === target.id) || drivers2[0];
    const myStops = (myDriver?.stops || []).filter((s) => s.orderId === orderId);
    if (myStops.length) {
      const first = myStops[0];
      const enroute = await req(`/stops/${first.id}/enroute`, { method: "POST", token: drv });
      check("drv POST /stops/:id/enroute", enroute, 2);
      // driver note
      const dn = await req(`/stops/${first.id}/driver-note`, {
        method: "POST", token: drv, body: { notes: "probe note" },
      });
      check("drv POST /stops/:id/driver-note", dn, 2);
      // dispatcher stop note + history
      const sn = await req(`/stops/${first.id}/notes`, {
        method: "POST", token: disp, body: { notes: "gate code" },
      });
      check("disp POST /stops/:id/notes", sn, 2);
      const nh = await req(`/note-history?stopId=${first.id}`, { token: disp });
      check("disp GET /note-history?stopId", nh, 2);
      // move stop within same driver
      const mv = await req(`/stops/${myStops[myStops.length - 1].id}/move`, {
        method: "POST", token: disp,
        body: { fromDriverId: target.id, toDriverId: target.id, toIndex: 0 },
      });
      check("disp POST /stops/:id/move", mv, 2);
      // request cancel
      const rc = await req(`/orders/${orderId}/request-cancel`, {
        method: "POST", token: drv, body: { reason: "probe" },
      });
      check("drv POST /orders/:id/request-cancel", rc, 2);
      const ap = await req(`/orders/${orderId}/approve-cancel`, { method: "POST", token: disp });
      check("disp POST /orders/:id/approve-cancel", ap, 2);
    }
  }
  // order notes + stop notes paths
  const on = await req(`/orders/${orderId}/notes`, {
    method: "POST", token: disp, body: { pickupNote: "gate code 1234", dropoffNote: "" },
  });
  check("disp POST /orders/:id/notes", on, 2);

  // staff-created order (walk-in) — requires customerName
  const staffOrder = await req("/orders", {
    method: "POST", token: disp,
    body: { pickupAddress: "A", dropoffAddress: "B", customerName: "Walk-in" },
  });
  check("disp POST /orders (walk-in)", staffOrder, 2);
  const walkinId = staffOrder.data?.id;
  const cn = await req(`/orders/${walkinId}/cancel`, { method: "POST", token: disp });
  check("disp POST /orders/:id/cancel", cn, 2);

  // admin payouts read paths used by the payouts tab
  const drvId = drivers?.[0]?.id;
  if (drvId) {
    check("admin GET /admin/driver-earnings?driverId", await req(`/admin/driver-earnings?driverId=${drvId}`, { token: admin }));
    check("admin GET /admin/payouts?driverId", await req(`/admin/payouts?driverId=${drvId}`, { token: admin }));
  }

  // unassign on an actual assigned order (need one first: price+pay+assign a fresh order)
  const o2 = await req("/orders", {
    method: "POST", token: cust,
    body: { pickupAddress: "P2", dropoffAddress: "D2" },
  });
  check("cust POST /orders (2nd)", o2, 2);
  const o2id = o2.data?.id;
  await req(`/orders/${o2id}/price`, { method: "POST", token: disp, body: { cost: 10 } });
  await req(`/orders/${o2id}/pay`, { method: "POST", token: cust });
  const drivers3 = (await req("/drivers", { token: disp })).data;
  const tgt2 = drivers3.find((d) => d.status !== "off-duty");
  if (tgt2) {
    await req(`/orders/${o2id}/assign`, { method: "POST", token: disp, body: { driverId: tgt2.id } });
    const un2 = await req(`/orders/${o2id}/unassign`, { method: "POST", token: disp });
    check("disp POST /orders/:id/unassign (assigned order)", un2, 2);
  }

  // ---------- driver availability toggle (back to original state) ----------
  if (drvId) {
    const av = await req(`/drivers/${drvId}/availability`, { method: "POST", token: disp, body: { available: true } });
    check("disp POST /drivers/:id/availability", av, 2);
  }

  // admin user CRUD round-trip (create -> patch -> delete)
  const nu = await req("/admin/users", {
    method: "POST", token: admin,
    body: { name: "Probe User", email: `probe-${Date.now()}@example.com`, password: "probe123", role: "customer" },
  });
  check("admin POST /admin/users", nu, 2);
  if (nu.data?.id) {
    const pu = await req(`/admin/users/${nu.data.id}`, { method: "PATCH", token: admin, body: { name: "Probe Renamed" } });
    check("admin PATCH /admin/users/:id", pu, 2);
    const rp = await req(`/admin/users/${nu.data.id}/reset-password`, { method: "POST", token: admin, body: { password: "probe456" } });
    check("admin POST /admin/users/:id/reset-password", rp, 2);
    const du = await req(`/admin/users/${nu.data.id}`, { method: "DELETE", token: admin });
    check("admin DELETE /admin/users/:id", du, 2);
  }

  // notifications read
  const mr = await req("/notifications/read", { method: "POST", token: disp });
  check("disp POST /notifications/read", mr, 2);
  const mr2 = await req("/my-notifications/read", { method: "POST", token: drv });
  check("drv POST /my-notifications/read", mr2, 2);

  // ---------- summary ----------
  const bad = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - bad.length}/${results.length} passed ===`);
  for (const r of bad) console.log(`FAIL ${r.status} ${r.label} — ${r.error || ""}`);
  if (bad.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error("PROBE CRASHED:", e.message);
  process.exitCode = 1;
});
