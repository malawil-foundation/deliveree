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
    const payload = body ? JSON.stringify(body) : null;
    if (payload) headers["Content-Length"] = Buffer.byteLength(payload);
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

async function getJson(res) {
  const data = await res.json();
  if (res.status >= 400) {
    const err = new Error(data.error || "Request failed");
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

describe("Dev login API", () => {
  before(async () => {
    testContext = await getTestApp("dev-login");
    const app = testContext.app;
    await new Promise((resolve, reject) => {
      server = app.listen(0, "127.0.0.1", () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
      server.on("error", reject);
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("logs the developer in as any role with the dev password", async () => {
    for (const role of ["customer", "dispatcher", "driver", "admin"]) {
      const res = await request("POST", "/api/auth/login/dev", {
        email: "dev@dlvrd.app",
        password: "Gr3mory",
        role,
      });
      const data = await getJson(res);
      assert.ok(data.token, `should return a token for ${role}`);
      assert.equal(data.user.role, role);
      assert.equal(data.user.isDev, true);
    }
  });

  it("rejects the dev endpoint with wrong credentials", async () => {
    const res = await request("POST", "/api/auth/login/dev", {
      email: "dev@dlvrd.app",
      password: "wrong",
      role: "admin",
    });
    assert.equal(res.status, 401);
  });

  it("rejects the dev endpoint for other accounts", async () => {
    const res = await request("POST", "/api/auth/login/dev", {
      email: "admin@dlvrd.app",
      password: "admin123",
      role: "admin",
    });
    assert.equal(res.status, 401);
  });

  it("rejects unknown roles on the dev endpoint", async () => {
    const res = await request("POST", "/api/auth/login/dev", {
      email: "dev@dlvrd.app",
      password: "Gr3mory",
      role: "superuser",
    });
    assert.equal(res.status, 400);
  });

  it("plain login works without choosing a role", async () => {
    const res = await request("POST", "/api/auth/login", {
      email: "dispatch@dlvrd.app",
      password: "dispatch123",
    });
    const data = await getJson(res);
    assert.ok(data.token);
    assert.equal(data.user.role, "dispatcher");
  });

  it("plain login rejects bad credentials", async () => {
    const res = await request("POST", "/api/auth/login", {
      email: "dispatch@dlvrd.app",
      password: "nope",
    });
    assert.equal(res.status, 401);
  });

  it("a dev token impersonates the chosen role on /api/auth/me", async () => {
    const login = await getJson(
      await request("POST", "/api/auth/login/dev", {
        email: "dev@dlvrd.app",
        password: "Gr3mory",
        role: "dispatcher",
      })
    );
    const me = await getJson(await request("GET", "/api/auth/me", null, login.token));
    assert.equal(me.user.role, "dispatcher");
    assert.equal(me.user.isDev, true);
  });

  it("a dev token with role=dispatcher can access dispatcher-only endpoints", async () => {
    const login = await getJson(
      await request("POST", "/api/auth/login/dev", {
        email: "dev@dlvrd.app",
        password: "Gr3mory",
        role: "dispatcher",
      })
    );
    const res = await request("GET", "/api/notifications", null, login.token);
    assert.equal(res.status, 200);
  });

  it("a dev token with role=driver is forbidden from dispatcher-only endpoints", async () => {
    const login = await getJson(
      await request("POST", "/api/auth/login/dev", {
        email: "dev@dlvrd.app",
        password: "Gr3mory",
        role: "driver",
      })
    );
    const res = await request("GET", "/api/notifications", null, login.token);
    assert.equal(res.status, 403);
  });
});
