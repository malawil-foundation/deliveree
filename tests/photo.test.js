import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getTestApp } from "./app.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, "..", "server", "uploads");

let server;
let baseUrl;
let testContext;

// Tracks every file the upload endpoint writes so `after` can clean up —
// the server writes to the real server/uploads directory.
const uploadedFiles = [];

function request(method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, baseUrl);
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    // http.request has no `body` option (that's fetch/undici) — the payload
    // must go through req.end() or it is silently dropped and the server
    // parses an empty JSON body.
    const payload =
      body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body);
    if (payload !== null) headers["Content-Length"] = Buffer.byteLength(payload);
    const options = { method, headers };
    const req = http.request(url, options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, json: async () => JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, json: async () => data });
        }
      });
    });
    req.on("error", reject);
    req.end(payload);
  });
}

// Raw-body upload — mirrors what src/api.js uploadStopPhoto does.
function upload(token, stopId, body, contentType) {
  return new Promise((resolve, reject) => {
    const url = new URL(`/api/stops/${stopId}/photo`, baseUrl);
    const req = http.request(
      url,
      { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType, "Content-Length": body.length } },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, json: async () => JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, json: async () => data });
          }
        });
      }
    );
    req.on("error", reject);
    req.end(body);
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

// PNG bytes (8x1 transparent PNG) — real magic header, tiny payload.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAFAQAAAADCTf2kAAAAEklEQVR4nGP8z8DwnwEJMDEgAQBGKQEGWc5c1gAAAABJRU5ErkJggg==",
  "base64"
);
// GIF89a header + minimal body — a second accepted format.
const GIF_BYTES = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(16, 0)]);

// 8.5 MB of PNG-looking bytes — over the 8 MB cap, under nothing else.
const OVERSIZED_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(8.5 * 1024 * 1024)]);

describe("Proof-of-pickup photo API", () => {
  let dispatcherToken;
  let driverToken; // marcus — owns drv-1
  let otherDriverToken; // priya — owns drv-2
  let pickupStopId;
  let pickupStopId2; // second order, for the photo-required gate test

  before(async () => {
    testContext = await getTestApp("photo");
    const app = testContext.app;

    await new Promise((resolve, reject) => {
      server = app.listen(0, "127.0.0.1", () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
      server.on("error", reject);
    });

    dispatcherToken = (await getJson(await request("POST", "/api/auth/login/dispatcher", {
      email: "dispatch@dlvrd.app",
      password: "dispatch123",
    }))).token;
    driverToken = (await getJson(await request("POST", "/api/auth/login/driver", {
      email: "marcus@dlvrd.app",
      password: "driver123",
    }))).token;
    otherDriverToken = (await getJson(await request("POST", "/api/auth/login/driver", {
      email: "priya@dlvrd.app",
      password: "driver123",
    }))).token;

    // Two fresh assigned orders on drv-1 via the real flow:
    // customer creates → dispatcher prices → customer pays → dispatcher assigns.
    const customerToken = (await getJson(await request("POST", "/api/auth/login/customer", {
      email: "dana@example.com",
      password: "customer123",
    }))).token;
    const drivers = await getJson(await request("GET", "/api/drivers", undefined, dispatcherToken));
    const drv1 = drivers.find((d) => d.name === "Marcus Webb");
    assert.ok(drv1, "seed driver Marcus Webb should exist");

    for (let i = 0; i < 2; i += 1) {
      const order = await getJson(
        await request("POST", "/api/orders", {
          pickupAddress: `Photo Test Pickup ${i}`,
          dropoffAddress: `Photo Test Dropoff ${i}`,
        }, customerToken)
      );
      await getJson(await request("POST", `/api/orders/${order.id}/price`, { cost: 10 }, dispatcherToken));
      await getJson(await request("POST", `/api/orders/${order.id}/pay`, undefined, customerToken));
      await getJson(await request("POST", `/api/orders/${order.id}/assign`, { driverId: drv1.id }, dispatcherToken));
    }

    // The two newest pickup stops on drv-1 belong to the two orders above.
    const driversAfter = await getJson(await request("GET", "/api/drivers", undefined, dispatcherToken));
    const drv1Stops = driversAfter.find((d) => d.name === "Marcus Webb").stops
      .filter((s) => s.type === "pickup" && !s.done && !s.photoUrl && s.address.startsWith("Photo Test Pickup"))
      .sort((a, b) => (a.address < b.address ? -1 : 1));
    assert.ok(drv1Stops.length >= 2, `expected 2 fresh pickup stops, got ${drv1Stops.length}`);
    [pickupStopId, pickupStopId2] = drv1Stops.map((s) => s.id);
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    for (const name of uploadedFiles) {
      try {
        fs.unlinkSync(path.join(UPLOAD_DIR, name));
      } catch {
        /* already gone — fine */
      }
    }
  });

  it("rejects unauthenticated uploads (401)", async () => {
    const res = await upload("", pickupStopId, PNG_BYTES, "image/png");
    assert.equal(res.status, 401);
  });

  it("rejects a driver uploading to another driver's stop (403)", async () => {
    const res = await upload(otherDriverToken, pickupStopId, PNG_BYTES, "image/png");
    assert.equal(res.status, 403);
  });

  it("rejects non-image bodies (400)", async () => {
    const res = await upload(driverToken, pickupStopId, JSON.stringify({ hello: "world" }), "application/json");
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /JPEG, PNG, WebP, or GIF/);
  });

  it("rejects mislabeled images whose bytes are not a real image (400)", async () => {
    const res = await upload(driverToken, pickupStopId, "this is definitely not an image", "image/png");
    assert.equal(res.status, 400);
  });

  it("rejects uploads over the 8 MB cap with 413", async () => {
    const res = await upload(driverToken, pickupStopId, OVERSIZED_BYTES, "image/png");
    assert.equal(res.status, 413);
  });

  it("accepts a real PNG and stores it for the stop", async () => {
    const res = await upload(driverToken, pickupStopId, PNG_BYTES, "image/png");
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.match(data.photoUrl, /^\/api\/uploads\/.+\.png$/);

    const fileName = decodeURIComponent(data.photoUrl.split("/").pop());
    uploadedFiles.push(fileName);
    assert.ok(fs.existsSync(path.join(UPLOAD_DIR, fileName)), "file should exist on disk");

    // The driver's route now reports the photo.
    const drivers = await getJson(await request("GET", "/api/drivers", undefined, driverToken));
    const stop = drivers.find((d) => d.name === "Marcus Webb").stops.find((s) => s.id === pickupStopId);
    assert.equal(stop.photoUrl, data.photoUrl);
  });

  it("accepts other supported formats (GIF) via magic-byte sniffing", async () => {
    const res = await upload(driverToken, pickupStopId, GIF_BYTES, "image/gif");
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.match(data.photoUrl, /\.gif$/);
    uploadedFiles.push(decodeURIComponent(data.photoUrl.split("/").pop()));
  });

  it("replaces an existing photo and removes the old file", async () => {
    const first = await getJson(await upload(driverToken, pickupStopId, PNG_BYTES, "image/png"));
    const firstFile = decodeURIComponent(first.photoUrl.split("/").pop());
    uploadedFiles.push(firstFile);

    const second = await getJson(await upload(driverToken, pickupStopId, GIF_BYTES, "image/gif"));
    const secondFile = decodeURIComponent(second.photoUrl.split("/").pop());
    uploadedFiles.push(secondFile);

    assert.notEqual(first.photoUrl, second.photoUrl);
    assert.ok(fs.existsSync(path.join(UPLOAD_DIR, secondFile)), "replacement should exist");
    assert.ok(!fs.existsSync(path.join(UPLOAD_DIR, firstFile)), "old file should be deleted");
  });

  it("lets dispatchers attach the photo for a driver", async () => {
    const res = await upload(dispatcherToken, pickupStopId2, PNG_BYTES, "image/png");
    assert.equal(res.status, 200);
    const data = await res.json();
    uploadedFiles.push(decodeURIComponent(data.photoUrl.split("/").pop()));
  });

  it("blocks completing a pickup without a photo, allows it once one is attached", async () => {
    // Fresh order → clean unphotographed pickup stop on drv-1.
    const customerToken = (await getJson(await request("POST", "/api/auth/login/customer", {
      email: "dana@example.com",
      password: "customer123",
    }))).token;
    const order = await getJson(await request("POST", "/api/orders", {
      pickupAddress: "Gate Test Pickup",
      dropoffAddress: "Gate Test Dropoff",
    }, customerToken));
    await getJson(await request("POST", `/api/orders/${order.id}/price`, { cost: 5 }, dispatcherToken));
    await getJson(await request("POST", `/api/orders/${order.id}/pay`, undefined, customerToken));
    await getJson(await request("POST", `/api/orders/${order.id}/assign`, { driverId: "drv-1" }, dispatcherToken));

    const drivers = await getJson(await request("GET", "/api/drivers", undefined, driverToken));
    const freshPickup = drivers.find((d) => d.name === "Marcus Webb").stops
      .find((s) => s.type === "pickup" && !s.done && !s.photoUrl && s.address === "Gate Test Pickup");
    assert.ok(freshPickup, "fresh unphotographed pickup should exist");

    // No photo → completing the stop is refused with a clear message.
    const denied = await request("POST", `/api/stops/${freshPickup.id}/toggle`, {}, driverToken);
    assert.equal(denied.status, 400);
    const deniedData = await denied.json();
    assert.match(deniedData.error, /proof-of-pickup photo/);

    // Photo attached → the same toggle now succeeds.
    const uploaded = await getJson(await upload(driverToken, freshPickup.id, PNG_BYTES, "image/png"));
    uploadedFiles.push(decodeURIComponent(uploaded.photoUrl.split("/").pop()));

    const allowed = await request("POST", `/api/stops/${freshPickup.id}/toggle`, {}, driverToken);
    assert.equal(allowed.status, 200);
  });
});
