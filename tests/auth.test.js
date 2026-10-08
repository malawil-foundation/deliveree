import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

// Must be set before server/index.js is imported (in before()) so it skips
// binding its own port — a second live listener would hang `node --test`.
process.env.NODE_ENV = "test";
import { hashPassword } from "../server/seed.js";
import Database from "better-sqlite3";

let server;
let baseUrl;
// Set once the server is listening; the request() helper throws "Server not
// started" when this is still unset (guards against a broken before() hook).
let ready = false;

function request(method, urlPath, body, token) {
  if (!baseUrl) throw new Error("Server not started");
  const url = new URL(urlPath, baseUrl);
  return new Promise((resolve, reject) => {
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const options = { method, headers };
    // http.request has no `body` option (that's fetch/undici) — the payload
    // must go through req.end() or it is silently dropped.
    const payload = body ? JSON.stringify(body) : null;
    if (payload) headers["Content-Length"] = Buffer.byteLength(payload);
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
    req.end(payload);
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

describe("Auth API", () => {
  let db;
  
  before(async () => {
    // Create a fresh in-memory database for this test suite
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    
    // Run migrations inline (same as the server would do)
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
        dropoff_address TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
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
        pos INTEGER NOT NULL DEFAULT 0,
        en_route INTEGER NOT NULL DEFAULT 0,
        photo_path TEXT,
        notes TEXT NOT NULL DEFAULT '',
        driver_note TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        message TEXT NOT NULL,
        order_id TEXT,
        read INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS note_events (
        id TEXT PRIMARY KEY,
        stop_id TEXT,
        order_id TEXT,
        kind TEXT NOT NULL,
        actor_role TEXT NOT NULL,
        actor_name TEXT NOT NULL,
        prev TEXT NOT NULL DEFAULT '',
        next TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS user_events (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        actor_id TEXT,
        actor_name TEXT NOT NULL,
        target_id TEXT,
        target_name TEXT NOT NULL,
        target_email TEXT NOT NULL,
        target_role TEXT,
        changes TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      );
    `);

    // Add any missing columns that migrations would add
    const addColumn = (table, column, ddl) => {
      const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
      if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    };
    addColumn("drivers", "reg_number", "reg_number TEXT");
    addColumn("drivers", "model", "model TEXT");
    addColumn("drivers", "colour", "colour TEXT");
    addColumn("drivers", "description", "description TEXT");
    addColumn("orders", "pickup_parish", "pickup_parish TEXT");
    addColumn("orders", "dropoff_parish", "dropoff_parish TEXT");
    addColumn("orders", "pickup_note", "pickup_note TEXT NOT NULL DEFAULT ''");
    addColumn("orders", "dropoff_note", "dropoff_note TEXT NOT NULL DEFAULT ''");
    addColumn("orders", "paying", "paying INTEGER NOT NULL DEFAULT 0 CHECK (paying IN (0,1))");
    addColumn("orders", "pay_amount", "pay_amount REAL");
    addColumn("orders", "collecting", "collecting INTEGER NOT NULL DEFAULT 0 CHECK (collecting IN (0,1))");
    addColumn("orders", "collect_amount", "collect_amount REAL");

    // Backfill existing orders to have pickup_note/dropoff_note defaults
    db.prepare(`UPDATE orders SET pickup_note = ?, dropoff_note = ? WHERE pickup_note IS NULL`).run("", "");

    // Create a test customer directly in the database
    const testUser = {
      id: "test-cust-1",
      role: "customer",
      name: "Test Customer",
      email: "test@example.com",
      password: hashPassword("password123"),
      fleetDriverId: null
    };
    db.prepare(`INSERT INTO users (id, role, name, email, password, fleet_driver_id)
      VALUES (?, ?, ?, ?, ?, ?)`).run(
      testUser.id, testUser.role, testUser.name, testUser.email, testUser.password, testUser.fleetDriverId
    );
    console.log("Inserted test user:", testUser.email);
    
    process.env.DB_FILE = ":memory:";
    process.env.PORT = "0";
    
    const module = await import("../server/index.js");
    const app = module.app;
    
    await new Promise((resolve, reject) => {
      server = app.listen(0, "127.0.0.1");
      server.once("listening", () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        ready = true;
        resolve();
      });
      server.on("error", reject);
    });
    console.log("Server listening on:", baseUrl);
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    // Clean up is handled by the test framework
  });

  it("should register a new customer", async () => {
    const res = await request("POST", "/api/auth/register", {
      name: "Test Customer",
      email: "test@example.com",
      password: "password123"
    });
    const data = await getJson(res);
    assert.ok(data.token, "should return a token");
    assert.equal(data.user.role, "customer");
    assert.equal(data.user.name, "Test Customer");
  });

  it("should login with valid credentials", async () => {
    const res = await request("POST", "/api/auth/login/customer", {
      email: "test@example.com",
      password: "password123"
    });
    const data = await getJson(res);
    assert.ok(data.token, "should return a token");
    assert.equal(data.user.email, "test@example.com");
  });

  it("should reject login with invalid password", async () => {
    const res = await request("POST", "/api/auth/login/customer", {
      email: "test@example.com",
      password: "wrongpassword"
    });
    assert.equal(res.status, 401);
  });

  it("should return current user", async () => {
    const loginRes = await request("POST", "/api/auth/login/customer", {
      email: "test@example.com",
      password: "password123"
    });
    const loginData = await getJson(loginRes);

    const res = await request("GET", "/api/auth/me", null, loginData.token);
    const data = await getJson(res);
    assert.equal(data.user.email, "test@example.com");
  });
});
