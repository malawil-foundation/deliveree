#!/usr/bin/env node
// DLVRD port janitor: frees TCP ports by killing whatever process is
// LISTENING on them. Called automatically before the API / dev servers start
// so a stale process from a previous session can never block startup with
// EADDRINUSE:
//
//   node scripts/free-ports.js 4000 [5173 ...]
//
// Set DLVRD_NO_FREE_PORTS=1 to leave ports untouched.
//
// Safety rails:
// - only processes actually LISTENING on the exact ports requested are
//   targeted — nothing else is touched;
// - this process and its own ancestors are never killed;
// - a supervisor respawn loop is only escalated by killing the supervisor
//   when its command line clearly belongs to this project (project root path
//   or npm/concurrently/watch wrappers of it).
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(process.cwd());
const ROOT_LOWER = ROOT.toLowerCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// netstat/wmic/tasklist can hang indefinitely on a wedged Windows box, which
// would block server startup forever. Every spawnSync gets a hard timeout.
const PROBE_TIMEOUT_MS = 5000;
const KILL_TIMEOUT_MS = 10000;

function run(cmd, args, timeoutMs = PROBE_TIMEOUT_MS) {
  const res = spawnSync(cmd, args, { encoding: "utf8", timeout: timeoutMs });
  if (res.error) return null; // timed out or failed to spawn
  return res;
}

// ---------- listener discovery ----------

function listenersWindows(port) {
  // Plain -ano: the `-p tcp` protocol filter is unreliable on some Windows
  // netstat builds (returns empty output); we filter TCP lines ourselves.
  const res = run("netstat", ["-ano"]);
  if (!res) return []; // netstat hung or failed — report no listeners
  const out = String(res.stdout || "");
  if (!out) return [];
  const pids = new Set();
  for (const line of out.split(/\r?\n/)) {
    // TCP    0.0.0.0:4000    0.0.0.0:0    LISTENING    30644
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5 || cols[0].toUpperCase() !== "TCP") continue;
    if (cols[3].toUpperCase() !== "LISTENING") continue;
    const m = /:(\d+)$/.exec(cols[1]);
    const pid = Number(cols[cols.length - 1]);
    if (m && Number(m[1]) === port && pid > 0) pids.add(pid);
  }
  return [...pids];
}

function listenersUnix(port) {
  const res = run("lsof", ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"]);
  if (!res || (res.status !== 0 && !String(res.stdout || "").trim())) {
    // lsof missing or failed — fall back to fuser (most Linux distros).
    const fuser = run("fuser", [`${port}/tcp`]);
    const pids = String(fuser.stderr || "")
      .trim()
      .split(/\s+/)
      .map(Number)
      .filter((n) => n > 0);
    return [...new Set(pids)];
  }
  return [...new Set(
    String(res.stdout || "")
      .trim()
      .split(/\s+/)
      .map(Number)
      .filter((n) => n > 0)
  )];
}

function listenersFor(port) {
  return process.platform === "win32" ? listenersWindows(port) : listenersUnix(port);
}

// ---------- process info / killing ----------

// { ppid, command } for a pid, or null when unknown.
function procInfo(pid) {
  if (process.platform === "win32") {
    const res = run(
      "wmic",
      ["process", "where", `ProcessId=${pid}`, "get", "ParentProcessId,CommandLine", "/format:list"]
    );
    if (!res) return null;
    if (!out.trim()) return null;
    let ppid = null;
    let command = "";
    for (const line of out.split(/\r?\n/)) {
      const p = /^ParentProcessId=(\d+)/.exec(line);
      if (p) ppid = Number(p[1]);
      const c = /^CommandLine=(.*)$/.exec(line);
      if (c) command = c[1].trim();
    }
    return ppid ? { ppid, command } : null;
  }
  const res = run("ps", ["-o", "ppid=,command=", "-p", String(pid)]);
  if (!res) return null;
  const out = String(res.stdout || "").trim();
  if (!out) return null;
  const m = /^(\d+)\s+(.*)$/.exec(out);
  return m ? { ppid: Number(m[1]), command: m[2] } : null;
}

function belongsToProject(command) {
  const cmd = String(command || "").toLowerCase();
  if (!cmd) return false;
  return (
    cmd.includes(ROOT_LOWER) ||
    cmd.includes("server/index.js") ||
    cmd.includes("server\\index.js") ||
    (cmd.includes("npm-cli.js") && cmd.includes("dev")) ||
    cmd.includes("concurrently") ||
    cmd.includes("--watch")
  );
}

// PIDs of this process's ancestors, so we never kill our own supervisors.
// Lazily computed and memoized: it needs several wmic/ps calls, which are
// slow (especially wmic on Windows) — and the result is only needed when a
// supervisor respawn loop is actually being escalated, never on the happy
// path where the ports are already free.
let OWN_ANCESTORS = null;
function getOwnAncestors() {
  if (OWN_ANCESTORS) return OWN_ANCESTORS;
  const set = new Set();
  let pid = process.pid;
  for (let depth = 0; depth < 8; depth += 1) {
    const info = procInfo(pid);
    if (!info || !info.ppid || set.has(info.ppid)) break;
    set.add(info.ppid);
    pid = info.ppid;
  }
  OWN_ANCESTORS = set;
  return set;
}

function killPid(pid) {
  try {
    if (process.platform === "win32") {
      // /T kills the child tree too (orphaned vite/esbuild etc.). spawnSync
      // without a shell avoids Git Bash's /PID path mangling.
      const res = run("taskkill", ["/PID", String(pid), "/T", "/F"], KILL_TIMEOUT_MS);
      return !!res && res.status === 0;
    }
    process.kill(pid, "SIGKILL");
    return true;
  } catch {
    return false;
  }
}

// The port was re-taken right after a kill — a supervisor (npm run dev,
// node --watch, concurrently…) is respawning its child. Kill the supervisor
// tree instead, but only when it provably belongs to this project.
function killSupervisorOf(pid) {
  const info = procInfo(pid);
  if (!info) return false;
  let parent = procInfo(info.ppid);
  if (!parent) return false;
  const parentPid = info.ppid;
  if (getOwnAncestors().has(parentPid)) return false;
  if (!belongsToProject(parent.command)) {
    console.warn(
      `DLVRD: not killing supervisor pid ${parentPid} — command does not belong to this project: ${parent.command}`
    );
    return false;
  }
  if (killPid(parentPid)) {
    console.log(`DLVRD: killed respawn supervisor pid ${parentPid} (${parent.command})`);
    return true;
  }
  return false;
}

// ---------- port freeing ----------

// Poll until nothing is LISTENING on the port (sockets can linger for a
// moment after the owning process dies, especially on Windows).
async function waitPortFree(port, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (listenersFor(port).length === 0) return true;
    await sleep(150);
  }
  return listenersFor(port).length === 0;
}

// Kill every listener on `port` and wait for the port to become bindable.
// Supervised processes respawn their child the moment it dies, so after a
// plain kill we retry a few rounds, escalating to the supervisor tree when a
// respawn loop is detected. Returns true when the port ends up free.
export async function freePort(port, rounds = 6) {
  port = Number(port);
  if (process.env.DLVRD_NO_FREE_PORTS === "1") return true;
  for (let round = 1; round <= rounds; round += 1) {
    const listeners = listenersFor(port).filter((pid) => pid !== process.pid);
    if (listeners.length === 0) return true;
    for (const pid of listeners) {
      if (killPid(pid)) {
        console.log(`DLVRD: killed pid ${pid} that was holding port ${port}`);
      } else {
        console.warn(`DLVRD: could not kill pid ${pid} holding port ${port}`);
      }
    }
    const free = await waitPortFree(port);
    if (free) return true;
    if (round < rounds) {
      console.log(
        `DLVRD: port ${port} was re-taken after cleanup (supervisor respawn?) — retrying (${round + 1}/${rounds})`
      );
      // Escalate: take out the supervisor that keeps respawning the child.
      const again = listenersFor(port).filter((pid) => pid !== process.pid);
      for (const pid of again) killSupervisorOf(pid);
    }
  }
  return listenersFor(port).filter((pid) => pid !== process.pid).length === 0;
}

async function main() {
  const ports = process.argv.slice(2).map(Number).filter((n) => n > 0);
  if (ports.length === 0) {
    console.error("Usage: node scripts/free-ports.js <port> [port ...]");
    process.exit(2);
  }
  let allFree = true;
  for (const port of ports) {
    const ok = await freePort(port);
    if (!ok) {
      console.error(`DLVRD: port ${port} is still occupied after cleanup`);
      allFree = false;
    }
  }
  process.exit(allFree ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("DLVRD free-ports error:", err.message);
    process.exit(1);
  });
}
