#!/usr/bin/env node
// DLVRD server control: stop / restart / status for the API process.
//
//   node scripts/serverctl.js status
//   node scripts/serverctl.js stop
//   node scripts/serverctl.js restart
//
// The server writes its pid to server/server.pid once it is listening, and
// removes it on graceful shutdown, so these commands work without ps/grep.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
// Must match server/index.js, which writes path.join(__dirname, "server.pid")
// with __dirname = <root>/server.
const PID_FILE = path.join(ROOT, "server", "server.pid");
const PORT = process.env.PORT || 4000;

function readPid() {
  try {
    const raw = fs.readFileSync(PID_FILE, "utf8").trim();
    const pid = Number(raw);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isRunning(pid) {
  if (!pid) return false;
  try {
    // Signal 0 probes existence without side effects.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function healthCheck(timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${PORT}/api/health`, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

// Wait until the pid file disappears (process exited) or a timeout elapses.
async function waitGone(pid, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isRunning(pid) || readPid() !== pid) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return !isRunning(pid);
}

// Wait for /api/health to answer (fresh start after restart).
// 30s: first boot compiles nothing but does scrypt seeding + SQLite setup,
// which can comfortably exceed 15s on slower Windows machines.
async function waitHealthy(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await healthCheck(1000)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function stop() {
  const pid = readPid();
  if (!pid) {
    console.log("DLVRD: not running (no pid file)");
    return true;
  }
  if (!isRunning(pid)) {
    console.log(`DLVRD: stale pid file (pid ${pid} not running) — cleaning up`);
    fs.unlinkSync(PID_FILE);
    return true;
  }
  console.log(`DLVRD: stopping pid ${pid}…`);
  // SIGTERM lets the server's shutdown handlers run (removes the pid file).
  process.kill(pid, "SIGTERM");
  const gone = await waitGone(pid);
  if (!gone) {
    console.log("DLVRD: still running after SIGTERM — sending SIGKILL");
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
    try {
      fs.unlinkSync(PID_FILE);
    } catch {
      /* already gone */
    }
  }
  console.log("DLVRD: stopped");
  return true;
}

async function status() {
  const pid = readPid();
  const running = isRunning(pid);
  const healthy = running ? await healthCheck() : false;
  if (running && healthy) {
    console.log(`DLVRD: running (pid ${pid}) — http://localhost:${PORT}/api/health OK`);
  } else if (running) {
    console.log(`DLVRD: process ${pid} exists but /api/health is not answering yet`);
  } else {
    console.log("DLVRD: not running");
  }
  return running && healthy;
}

function startDetached() {
  // Spawn an independent server process that survives this command.
  const isWindows = process.platform === "win32";
  const child = spawn(
    process.execPath,
    [path.join(ROOT, "server", "index.js")],
    {
      cwd: ROOT,
      detached: true,
      stdio: ["ignore", "ignore", "ignore"],
      env: { ...process.env },
      ...(isWindows ? { windowsHide: true } : {}),
    }
  );
  child.unref();
  console.log(`DLVRD: starting server (pid ${child.pid})…`);
}

async function main() {
  const cmd = process.argv[2] || "status";
  if (cmd === "status") {
    process.exit((await status()) ? 0 : 1);
  }
  if (cmd === "stop") {
    process.exit((await stop()) ? 0 : 1);
  }
  if (cmd === "restart") {
    await stop();
    startDetached();
    const ok = await waitHealthy();
    console.log(
      ok
        ? `DLVRD: restarted — http://localhost:${PORT}/api/health OK`
        : "DLVRD: restarted but /api/health has not answered yet (check the server logs)"
    );
    process.exit(ok ? 0 : 1);
  }
  console.error("Usage: node scripts/serverctl.js [status|stop|restart]");
  process.exit(2);
}

main().catch((err) => {
  console.error("DLVRD serverctl error:", err.message);
  process.exit(1);
});
