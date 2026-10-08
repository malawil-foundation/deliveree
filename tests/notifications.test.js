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

describe("Notifications API", () => {
  let dispatcherToken;

  before(async () => {
    testContext = await getTestApp("notifications");
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
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("should get notifications", async () => {
    const res = await request("GET", "/api/notifications", null, dispatcherToken);
    const data = await getJson(res);
    assert.ok(Array.isArray(data.items), "Should return an array of notifications");
    assert.ok(typeof data.unread === "number", "Should return unread count");
  });

  it("should mark all notifications as read", async () => {
    const res = await request("POST", "/api/notifications/read", null, dispatcherToken);
    const data = await getJson(res);
    assert.equal(data.ok, true, "Should return ok: true");
  });
});
