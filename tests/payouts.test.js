import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { getTestApp } from "./app.js";

let server;
let baseUrl;
let testContext;

function request(method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, baseUrl);
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const options = { method, headers };
    if (body) headers["Content-Length"] = Buffer.byteLength(JSON.stringify(body));
    const req = http.request(url, options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode,
          // Parse lazily so non-JSON responses (e.g. the CSV export) come
          // back as raw text instead of throwing.
          json: async () => {
            try {
              return JSON.parse(data);
            } catch {
              return data;
            }
          },
        });
      });
    });
    req.on("error", reject);
    req.end(body ? JSON.stringify(body) : null);
  });
}

async function getJson(res) {
  const data = await res.json();
  if (res.status >= 400) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

const money = (n) => Math.round(Number(n) * 100) / 100;

describe("Driver payouts", () => {
  let adminToken;
  let customerToken;

  before(async () => {
    testContext = await getTestApp("payouts");
    const app = testContext.app;

    await new Promise((resolve, reject) => {
      server = app.listen(0, "127.0.0.1", () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
      server.on("error", reject);
    });

    adminToken = (await getJson(await request("POST", "/api/auth/login/admin", {
      email: "admin@dlvrd.app",
      password: "admin123",
    }))).token;
    customerToken = (await getJson(await request("POST", "/api/auth/login/customer", {
      email: "dana@example.com",
      password: "customer123",
    }))).token;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // Helper: create → price → pay → assign → complete an order end to end.
  // Pass driverId to pin a specific driver; otherwise the first on-duty one.
  async function completeOrder({ cost, token, driverId }) {
    const created = await getJson(await request("POST", "/api/orders", {
      pickupAddress: "1 Test Lane",
      dropoffAddress: "2 Test Road",
    }, customerToken));
    await getJson(await request("POST", `/api/orders/${created.id}/price`, {
      cost,
      paying: true,
      payAmount: cost,
    }, token));
    await getJson(await request("POST", `/api/orders/${created.id}/pay`, {}, customerToken));
    const drivers = await getJson(await request("GET", "/api/drivers", null, token));
    const driver = driverId
      ? drivers.find((d) => d.id === driverId)
      : drivers.find((d) => d.status !== "off-duty");
    assert.ok(driver, "a suitable driver must exist");
    await getJson(await request("POST", `/api/orders/${created.id}/assign`, {
      driverId: driver.id,
    }, token));
    // Complete every stop of this order (as admin — the proof-of-pickup photo
    // rule only applies to driver-role callers). With all stops done the order
    // auto-completes via refreshOrderCompletion.
    const driverRow = (await getJson(await request("GET", "/api/drivers", null, token)))
      .find((d) => d.id === driver.id);
    const orderStops = driverRow.stops.filter((s) => s.orderId === created.id);
    assert.ok(orderStops.length > 0, "assignment should create stops");
    for (const s of orderStops) {
      if (!s.done) {
        await getJson(await request("POST", `/api/stops/${s.id}/toggle`, {}, token));
      }
    }
    const finalOrder = (await getJson(await request("GET", "/api/orders", null, token)))
      .find((o) => o.id === created.id);
    assert.equal(finalOrder.status, "completed", "order should auto-complete");
    return { orderId: created.id, driverId: driver.id };
  }

  it("exposes the default fee percentage to admins", async () => {
    const settings = await getJson(await request("GET", "/api/admin/payout-settings", null, adminToken));
    assert.equal(typeof settings.feePct, "number");
    assert.ok(settings.feePct >= 0 && settings.feePct <= 100);
  });

  it("rejects invalid fee percentages and non-admin callers", async () => {
    const bad = await request("POST", "/api/admin/payout-settings", { feePct: 150 }, adminToken);
    assert.equal(bad.status, 400);
    const forbidden = await request("GET", "/api/admin/payout-settings", null, customerToken);
    assert.equal(forbidden.status, 403);
  });

  it("snapshots the rate per order and reports earnings", async () => {
    const settings = await getJson(await request("GET", "/api/admin/payout-settings", null, adminToken));
    const defaultPct = settings.feePct;

    const { orderId, driverId } = await completeOrder({ cost: 100, token: adminToken });

    // Earnings report shows the order at the default rate.
    let report = await getJson(
      await request("GET", `/api/admin/driver-earnings?driverId=${driverId}`, null, adminToken)
    );
    let row = report.orders.find((o) => o.orderId === orderId);
    assert.ok(row, "completed order appears in the earnings report");
    assert.equal(row.feePct, defaultPct);
    assert.equal(row.earned, money(100 * (defaultPct / 100)));

    // Changing the global rate must NOT rewrite the snapshot…
    await getJson(await request("POST", "/api/admin/payout-settings", { feePct: 50 }, adminToken));
    report = await getJson(
      await request("GET", `/api/admin/driver-earnings?driverId=${driverId}`, null, adminToken)
    );
    row = report.orders.find((o) => o.orderId === orderId);
    assert.equal(row.feePct, defaultPct, "existing snapshot keeps its original rate");

    // …but a NEW order picks up the new rate.
    const second = await completeOrder({ cost: 200, token: adminToken });
    report = await getJson(
      await request("GET", `/api/admin/driver-earnings?driverId=${second.driverId}`, null, adminToken)
    );
    const row2 = report.orders.find((o) => o.orderId === second.orderId);
    assert.equal(row2.feePct, 50);
    assert.equal(row2.earned, 100);
  });

  it("records a full payout that settles the outstanding balance", async () => {
    const drivers = await getJson(await request("GET", "/api/drivers", null, adminToken));
    const driver = drivers.find((d) => d.status !== "off-duty");
    const before = await getJson(
      await request("GET", `/api/admin/driver-earnings?driverId=${driver.id}`, null, adminToken)
    );
    assert.ok(before.totals.outstanding > 0, "driver should have an outstanding balance");

    const res = await request("POST", "/api/admin/payouts", {
      driverId: driver.id,
      mode: "full",
      note: "test settlement",
    }, adminToken);
    assert.equal(res.status, 201);
    const { payout, totals } = await getJson(res);

    assert.equal(payout.mode, "full");
    assert.equal(payout.amount, before.totals.outstanding);
    assert.equal(totals.paid, money(before.totals.paid + before.totals.outstanding));
    assert.equal(totals.outstanding, 0);
  });

  it("records a manual partial payout, even as an overpay", async () => {
    const drivers = await getJson(await request("GET", "/api/drivers", null, adminToken));
    const driver = drivers.find((d) => d.status !== "off-duty");
    const res = await request("POST", "/api/admin/payouts", {
      driverId: driver.id,
      mode: "partial",
      amount: 5,
      note: "partial advance",
    }, adminToken);
    assert.equal(res.status, 201);
    const { totals } = await getJson(res);
    assert.equal(totals.outstanding, -5);
  });

  it("refuses a full payout when nothing is owed and validates partial amounts", async () => {
    const drivers = await getJson(await request("GET", "/api/drivers", null, adminToken));
    const driver = drivers.find((d) => d.status !== "off-duty");
    const none = await request("POST", "/api/admin/payouts", {
      driverId: driver.id,
      mode: "full",
    }, adminToken);
    assert.equal(none.status, 400);

    const badAmount = await request("POST", "/api/admin/payouts", {
      driverId: driver.id,
      mode: "partial",
      amount: -1,
    }, adminToken);
    assert.equal(badAmount.status, 400);

    const badMode = await request("POST", "/api/admin/payouts", {
      driverId: driver.id,
      mode: "everything",
    }, adminToken);
    assert.equal(badMode.status, 400);

    const unknown = await request("POST", "/api/admin/payouts", {
      driverId: "drv-nope",
      mode: "partial",
      amount: 1,
    }, adminToken);
    assert.equal(unknown.status, 404);
  });

  it("lists payout history newest first", async () => {
    const drivers = await getJson(await request("GET", "/api/drivers", null, adminToken));
    const driver = drivers.find((d) => d.status !== "off-duty");
    const payouts = await getJson(
      await request("GET", `/api/admin/payouts?driverId=${driver.id}`, null, adminToken)
    );
    assert.ok(payouts.length >= 2, "both payouts are recorded");
    const times = payouts.map((p) => new Date(p.paidAt).getTime());
    assert.deepEqual(
      times,
      [...times].sort((a, b) => b - a),
      "history is ordered newest first"
    );
    for (const p of payouts) {
      assert.ok(p.mode === "full" || p.mode === "partial");
      assert.equal(typeof p.amount, "number");
      assert.ok(Array.isArray(p.orderIds));
    }
  });

  it("applies a per-driver fee override to newly assigned orders", async () => {
    const drivers = await getJson(await request("GET", "/api/drivers", null, adminToken));
    const target = drivers.find((d) => d.status !== "off-duty" && d.id !== "drv-1");
    const fallback = drivers.find((d) => d.status !== "off-duty");
    const driverId = target?.id || fallback.id;

    // Set an 80% override on this driver.
    const patched = await getJson(await request("PATCH", `/api/drivers/${driverId}`, {
      feePctOverride: 80,
    }, adminToken));
    assert.equal(patched.feePctOverride, 80);

    // A fresh order assigned to them earns at 80%…
    const { orderId } = await completeOrder({ cost: 100, token: adminToken, driverId });
    let report = await getJson(
      await request("GET", `/api/admin/driver-earnings?driverId=${driverId}`, null, adminToken)
    );
    let row = report.orders.find((o) => o.orderId === orderId);
    assert.equal(row.feePct, 80);
    assert.equal(row.earned, 80);

    // Clearing the override returns new assignments to the global rate.
    await getJson(await request("PATCH", `/api/drivers/${driverId}`, {
      feePctOverride: null,
    }, adminToken));
    const settings = await getJson(await request("GET", "/api/admin/payout-settings", null, adminToken));
    const second = await completeOrder({ cost: 100, token: adminToken, driverId });
    report = await getJson(
      await request("GET", `/api/admin/driver-earnings?driverId=${driverId}`, null, adminToken)
    );
    row = report.orders.find((o) => o.orderId === second.orderId);
    assert.equal(row.feePct, settings.feePct, "cleared override falls back to global rate");

    // The first order keeps its 80% snapshot.
    row = report.orders.find((o) => o.orderId === orderId);
    assert.equal(row.feePct, 80, "existing snapshot is never rewritten");

    // Validation: out-of-range values are rejected.
    const bad = await request("PATCH", `/api/drivers/${driverId}`, {
      feePctOverride: 150,
    }, adminToken);
    assert.equal(bad.status, 400);
  });

  it("exports the earnings report as CSV", async () => {
    const res = await request("GET", "/api/admin/driver-earnings.csv", null, adminToken);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.startsWith("\ufeff"), "CSV starts with a BOM");
    assert.ok(body.includes("Driver,Order,Customer"), "CSV header row present");
    assert.ok(body.includes("Driver earns"), "earnings column present");
    assert.ok(body.includes("ord-"), "order rows present");
    assert.ok(body.includes("Outstanding"), "totals rows present");

    const forbidden = await request("GET", "/api/admin/driver-earnings.csv", null, customerToken);
    assert.equal(forbidden.status, 403);
  });

  it("lets a driver see their own earnings summary", async () => {
    // Complete one job for drv-2 (linked to priya@dlvrd.app), then check her
    // self-service report includes it.
    const drivers = await getJson(await request("GET", "/api/drivers", null, adminToken));
    const drv2 = drivers.find((d) => d.id === "drv-2") || drivers.find((d) => d.status !== "off-duty");
    const { orderId } = await completeOrder({ cost: 40, token: adminToken, driverId: drv2.id });

    const drvUsers = { "drv-1": "marcus@dlvrd.app", "drv-2": "priya@dlvrd.app", "drv-3": "elena@dlvrd.app" };
    const email = drvUsers[drv2.id] || "marcus@dlvrd.app";
    const driverToken = (await getJson(await request("POST", "/api/auth/login/driver", {
      email,
      password: "driver123",
    }))).token;

    const mine = await getJson(await request("GET", "/api/my-earnings", null, driverToken));
    assert.equal(mine.linked, true);
    assert.equal(typeof mine.totals.earned, "number");
    assert.equal(typeof mine.totals.paid, "number");
    assert.equal(
      mine.totals.outstanding,
      Math.round((mine.totals.earned - mine.totals.paid) * 100) / 100
    );
    assert.ok(
      mine.orders.some((o) => o.orderId === orderId),
      "driver sees their own completed order"
    );
    assert.ok(mine.orders.every((o) => o.driverId === drv2.id), "no other drivers' rows leak");

    // Customers must not read the driver endpoint.
    const forbidden = await request("GET", "/api/my-earnings", null, customerToken);
    assert.equal(forbidden.status, 403);
  });

  it("filters the driver earnings report by completed-at range", async () => {
    const drivers = await getJson(await request("GET", "/api/drivers", null, adminToken));
    const drv = drivers.find((d) => d.status !== "off-duty");
    const { orderId } = await completeOrder({ cost: 60, token: adminToken, driverId: drv.id });

    // Future-only window must exclude the just-completed order.
    const future = await getJson(
      await request(
        "GET",
        `/api/my-earnings?from=${encodeURIComponent("2099-01-01T00:00:00.000Z")}`,
        null,
        (await getJson(await request("POST", "/api/auth/login/driver", {
          email: "marcus@dlvrd.app",
          password: "driver123",
        }))).token
      )
    );
    // The report endpoint is per-driver; use the admin one to check the row.
    const adminFuture = await getJson(
      await request(
        "GET",
        `/api/admin/driver-earnings?driverId=${drv.id}&from=${encodeURIComponent("2099-01-01T00:00:00.000Z")}`,
        null,
        adminToken
      )
    );
    assert.equal(adminFuture.orders.find((o) => o.orderId === orderId), undefined);
    assert.equal(adminFuture.totals.orderCount, 0);

    // An open-ended window up to now must include it.
    const adminNow = await getJson(
      await request(
        "GET",
        `/api/admin/driver-earnings?driverId=${drv.id}&to=${encodeURIComponent("2099-01-01T00:00:00.000Z")}`,
        null,
        adminToken
      )
    );
    assert.ok(adminNow.orders.some((o) => o.orderId === orderId));
  });

  it("notifies the linked driver when a payout is recorded", async () => {
    const drivers = await getJson(await request("GET", "/api/drivers", null, adminToken));
    const drv = drivers.find((d) => d.id === "drv-1");
    // Give them something to be paid first (a previous test may have paid it).
    const before = await getJson(
      await request("GET", `/api/admin/driver-earnings?driverId=${drv.id}`, null, adminToken)
    );
    if (before.totals.outstanding <= 0) {
      await completeOrder({ cost: 25, token: adminToken, driverId: drv.id });
    }

    await getJson(await request("POST", "/api/admin/payouts", {
      driverId: drv.id,
      mode: "full",
      note: "weekly",
    }, adminToken));

    // Sign in as the driver linked to drv-1 and read their feed.
    const driverToken = (await getJson(await request("POST", "/api/auth/login/driver", {
      email: "marcus@dlvrd.app",
      password: "driver123",
    }))).token;
    const feed = await getJson(await request("GET", "/api/my-notifications", null, driverToken));
    const payoutNote = feed.items.find((n) => n.kind === "payout");
    assert.ok(payoutNote, "payout notification appears in the driver's feed");
    assert.ok(payoutNote.message.includes("paid"), "message mentions the payment");
    assert.ok(feed.unread >= 1);

    // Marking read clears the unread count but keeps the items.
    await getJson(await request("POST", "/api/my-notifications/read", {}, driverToken));
    const after = await getJson(await request("GET", "/api/my-notifications", null, driverToken));
    assert.equal(after.unread, 0);
    assert.ok(after.items.some((n) => n.kind === "payout"));
  });

  it("lets admins hide the driver earnings view", async () => {
    // Hide it.
    await getJson(await request("POST", "/api/admin/payout-settings", {
      showDriverEarnings: false,
    }, adminToken));
    const settings = await getJson(await request("GET", "/api/admin/payout-settings", null, adminToken));
    assert.equal(settings.showDriverEarnings, false);

    const driverToken = (await getJson(await request("POST", "/api/auth/login/driver", {
      email: "marcus@dlvrd.app",
      password: "driver123",
    }))).token;
    const mine = await getJson(await request("GET", "/api/my-earnings", null, driverToken));
    assert.equal(mine.hidden, true, "hidden drivers get the hidden flag");
    assert.equal(mine.linked, false, "hidden drivers get linked:false so the UI hides the card");

    // Show it again.
    await getJson(await request("POST", "/api/admin/payout-settings", {
      showDriverEarnings: true,
    }, adminToken));
    const mineAgain = await getJson(await request("GET", "/api/my-earnings", null, driverToken));
    assert.equal(mineAgain.linked, true);

    // Non-admins cannot flip the toggle.
    const forbidden = await request("POST", "/api/admin/payout-settings", {
      showDriverEarnings: false,
    }, customerToken);
    assert.equal(forbidden.status, 403);
  });

  it("summarizes effective rates and balances per driver", async () => {
    const drivers = await getJson(await request("GET", "/api/drivers", null, adminToken));
    const drv = drivers.find((d) => d.status !== "off-duty");
    // Set an override so the summary reports it.
    await getJson(await request("PATCH", `/api/drivers/${drv.id}`, {
      feePctOverride: 55,
    }, adminToken));

    const summary = await getJson(await request("GET", "/api/admin/drivers-summary", null, adminToken));
    assert.ok(Array.isArray(summary));
    const row = summary.find((s) => s.driverId === drv.id);
    assert.ok(row, "driver with completed orders appears");
    assert.equal(row.feePct, 55);
    assert.equal(row.hasOverride, true);
    assert.equal(
      row.outstanding,
      Math.round((row.earned - row.paid) * 100) / 100
    );

    // Clear the override again.
    await getJson(await request("PATCH", `/api/drivers/${drv.id}`, {
      feePctOverride: null,
    }, adminToken));
    const summary2 = await getJson(await request("GET", "/api/admin/drivers-summary", null, adminToken));
    const row2 = summary2.find((s) => s.driverId === drv.id);
    const settings = await getJson(await request("GET", "/api/admin/payout-settings", null, adminToken));
    assert.equal(row2.feePct, settings.feePct);
    assert.equal(row2.hasOverride, false);
  });

  it("lets admins send a custom message with a payout notification", async () => {
    const drivers = await getJson(await request("GET", "/api/drivers", null, adminToken));
    const drv = drivers.find((d) => d.id === "drv-3");
    // Ensure something is owed so the full payout is accepted.
    const before = await getJson(
      await request("GET", `/api/admin/driver-earnings?driverId=${drv.id}`, null, adminToken)
    );
    if (before.totals.outstanding <= 0) {
      await completeOrder({ cost: 30, token: adminToken, driverId: drv.id });
    }

    await getJson(await request("POST", "/api/admin/payouts", {
      driverId: drv.id,
      mode: "full",
      note: "internal only",
      driverMessage: "Thanks for a great week — bonus included!",
    }, adminToken));

    // Elena is linked to drv-3.
    const driverToken = (await getJson(await request("POST", "/api/auth/login/driver", {
      email: "elena@dlvrd.app",
      password: "driver123",
    }))).token;
    const feed = await getJson(await request("GET", "/api/my-notifications", null, driverToken));
    const latest = feed.items.find((n) => n.kind === "payout");
    assert.ok(latest, "payout notification exists");
    assert.equal(latest.message, "Thanks for a great week — bonus included!");

    // No custom message → default wording with the amount.
    const before2 = await getJson(
      await request("GET", `/api/admin/driver-earnings?driverId=${drv.id}`, null, adminToken)
    );
    if (before2.totals.outstanding <= 0) {
      await completeOrder({ cost: 10, token: adminToken, driverId: drv.id });
    }
    const paid = await getJson(await request("POST", "/api/admin/payouts", {
      driverId: drv.id,
      mode: "full",
    }, adminToken));
    const amount = paid.payout.amount.toFixed(2);
    const feed2 = await getJson(await request("GET", "/api/my-notifications", null, driverToken));
    const latest2 = feed2.items.find((n) => n.kind === "payout");
    assert.equal(latest2.message, `You've been paid $${amount}`);
  });
});
