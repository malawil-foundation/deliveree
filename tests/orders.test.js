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
        try {
          resolve({ status: res.statusCode, json: async () => JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, json: async () => data });
        }
      });
    });
    req.on("error", reject);
    req.end(body ? JSON.stringify(body) : null);
  });
}

async function getJson(res) {
  const data = await res.json();
  if (res.status >= 400) {
    const err = new Error(data.error || `Request failed ()`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

describe("Orders API", () => {
  let customerToken;

  before(async () => {
    testContext = await getTestApp("orders");
    const app = testContext.app;
    
    await new Promise((resolve, reject) => {
      server = app.listen(0, "127.0.0.1", () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
      server.on("error", reject);
    });

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

  it("should create a new order", async () => {
    const res = await request("POST", "/api/orders", {
      pickupAddress: "123 Test St",
      dropoffAddress: "456 Destination Ave",
      notes: "Handle with care"
    }, customerToken);
    const data = await getJson(res);
    assert.ok(data.id, "Should return an order ID");
    assert.equal(data.status, "pending_review");
    assert.equal(data.pickupAddress, "123 Test St");
    assert.equal(data.dropoffAddress, "456 Destination Ave");
  });

  it("should get all orders", async () => {
    const res = await request("GET", "/api/orders", null, customerToken);
    const data = await getJson(res);
    assert.ok(Array.isArray(data), "Should return an array of orders");
  });
});
