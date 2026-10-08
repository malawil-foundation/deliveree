import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const testApps = new Map();

export async function getTestApp(testName) {
  if (testApps.has(testName)) return testApps.get(testName);

  // Create an in-memory database
  const db = new Database(":memory:");
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
  addColumn("drivers", "status_updated_at", "status_updated_at TEXT");
  addColumn("orders", "pickup_parish", "pickup_parish TEXT");
  addColumn("orders", "dropoff_parish", "dropoff_parish TEXT");
  addColumn("orders", "pickup_note", "pickup_note TEXT NOT NULL DEFAULT ''");
  addColumn("orders", "dropoff_note", "dropoff_note TEXT NOT NULL DEFAULT ''");
  addColumn("orders", "paying", "paying INTEGER NOT NULL DEFAULT 0 CHECK (paying IN (0,1))");
  addColumn("orders", "pay_amount", "pay_amount REAL");
  addColumn("orders", "collecting", "collecting INTEGER NOT NULL DEFAULT 0 CHECK (collecting IN (0,1))");
  addColumn("orders", "collect_amount", "collect_amount REAL");
  addColumn("orders", "completed_at", "completed_at TEXT");
  addColumn("orders", "notes_updated_at", "notes_updated_at TEXT");
  addColumn("stops", "en_route_at", "en_route_at TEXT");
  addColumn("stops", "completed_at", "completed_at TEXT");
  addColumn("stops", "photo_uploaded_at", "photo_uploaded_at TEXT");
  addColumn("stops", "notes_updated_at", "notes_updated_at TEXT");
  addColumn("stops", "driver_note_updated_at", "driver_note_updated_at TEXT");

  // Backfill existing orders to have pickup_note/dropoff_note defaults
  db.prepare(`UPDATE orders SET pickup_note = ?, dropoff_note = ? WHERE pickup_note IS NULL`).run("", "");

  // Set environment variables before importing the server. NODE_ENV=test stops
  // server/index.js from binding its own port (and process.exit(1) handlers),
  // which would otherwise keep `node --test` alive after the suite finishes.
  process.env.NODE_ENV = "test";
  process.env.DB_FILE = ":memory:";
  process.env.PORT = "0";

  // Import the server module (it's an ES module, so we use dynamic import)
  const module = await import("../server/index.js");
  const app = module.app;
  
  testApps.set(testName, { app, db });
  return { app, db };
}

export function getTestDb(testName) {
  return testApps.get(testName)?.db;
}

export { Database };
