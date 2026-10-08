import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

let db;

export function getDb() {
  if (!db) {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initializeSchema(db);
    seedData(db);
  }
  return db;
}

function initializeSchema(db) {
  const migrations = require("../server/db.js");
  // Re-create the migration logic inline to work with an in-memory db.
  // We'll just run the V1 migration and manually create the tables.
  runMigrationsForTest(db, 10);
}

function runMigrationsForTest(db, targetVersion) {
  // Inline the migration logic to work with an in-memory database
  const createStatements = {
    1: `
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
        pos INTEGER NOT NULL DEFAULT 0
      );
    `,
    2: `
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        message TEXT NOT NULL,
        order_id TEXT,
        read INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
    `,
    7: `
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
      ALTER TABLE stops ADD COLUMN driver_note TEXT NOT NULL DEFAULT '';
    `,
    8: `
      CREATE TABLE IF NOT EXISTS user_events (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        actor_id TEXT,
        actor_name TEXT NOT NULL,
        target_id TEXT,
        target_name TEXT NOT NULL,
        target_email TEXT NOT NULL,
        changes TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      );
    `,
    9: `
      ALTER TABLE user_events ADD COLUMN target_role TEXT;
    `,
    10: `
      ALTER TABLE orders ADD COLUMN paying INTEGER NOT NULL DEFAULT 0 CHECK (paying IN (0,1));
      ALTER TABLE orders ADD COLUMN pay_amount REAL;
      ALTER TABLE orders ADD COLUMN collecting INTEGER NOT NULL DEFAULT 0 CHECK (collecting IN (0,1));
      ALTER TABLE orders ADD COLUMN collect_amount REAL;
    `
  };

  for (let v = 1; v <= targetVersion; v++) {
    if (createStatements[v]) {
      db.exec(createStatements[v]);
    }
  }

  // Add additional columns that migrations would add
  const additionalColumns = [
    { table: "drivers", column: "reg_number", ddl: "reg_number TEXT" },
    { table: "drivers", column: "model", ddl: "model TEXT" },
    { table: "drivers", column: "colour", ddl: "colour TEXT" },
    { table: "drivers", column: "description", ddl: "description TEXT" },
    { table: "orders", column: "pickup_parish", ddl: "pickup_parish TEXT" },
    { table: "orders", column: "dropoff_parish", ddl: "dropoff_parish TEXT" },
    { table: "stops", column: "en_route", ddl: "en_route INTEGER NOT NULL DEFAULT 0" },
    { table: "stops", column: "photo_path", ddl: "photo_path TEXT" },
    { table: "stops", column: "notes", ddl: "notes TEXT NOT NULL DEFAULT ''" },
    { table: "orders", column: "pickup_note", ddl: "pickup_note TEXT NOT NULL DEFAULT ''" },
    { table: "orders", column: "dropoff_note", ddl: "dropoff_note TEXT NOT NULL DEFAULT ''" },
    { table: "orders", column: "completed_at", ddl: "completed_at TEXT" },
    { table: "orders", column: "notes_updated_at", ddl: "notes_updated_at TEXT" },
    { table: "drivers", column: "status_updated_at", ddl: "status_updated_at TEXT" },
    { table: "stops", column: "en_route_at", ddl: "en_route_at TEXT" },
    { table: "stops", column: "completed_at", ddl: "completed_at TEXT" },
    { table: "stops", column: "photo_uploaded_at", ddl: "photo_uploaded_at TEXT" },
    { table: "stops", column: "notes_updated_at", ddl: "notes_updated_at TEXT" },
    { table: "stops", column: "driver_note_updated_at", ddl: "driver_note_updated_at TEXT" },
  ];

  for (const { table, column, ddl } of additionalColumns) {
    const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
    if (!exists) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    }
  }
}

function seedData(db) {
  const seed = require("../server/seed.js");
  const state = seed.seedState();

  db.transaction(() => {
    const insertUser = db.prepare(
      `INSERT INTO users (id, role, name, email, password, fleet_driver_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const u of state.users) {
      insertUser.run(u.id, u.role, u.name, u.email, u.password, u.fleetDriverId ?? null);
    }

    const insertDriver = db.prepare(
      `INSERT INTO drivers
         (id, name, vehicle, status, reg_number, model, colour, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const d of state.drivers) {
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
    for (const o of state.orders) {
      insertOrder.run(
        o.id, o.customerId, o.customerName, o.pickupAddress, o.pickupParish ?? null,
        o.dropoffAddress, o.dropoffParish ?? null,
        o.notes, o.status, o.driverId, o.cost,
        o.paying ? 1 : 0, o.payAmount ?? null,
        o.collecting ? 1 : 0, o.collectAmount ?? null,
        o.createdAt
      );
    }

    const insertStop = db.prepare(
      `INSERT INTO stops
         (id, driver_id, order_id, type, address, customer_name, done, en_route, pos,
          photo_path, notes, driver_note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const d of state.drivers) {
      (d.stops || []).forEach((s, i) => {
        insertStop.run(
          s.id, d.id, s.orderId, s.type, s.address, s.customerName,
          s.done ? 1 : 0, s.enRoute || s.en_route ? 1 : 0, i,
          s.photoPath ?? null, s.notes ?? "", s.driverNote ?? ""
        );
      });
    }
  })();
}
