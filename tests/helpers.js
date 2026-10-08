import { fileURLToPath } from "node:url";
import path from "node:path";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let server;
let baseUrl;
let closeServer;

export async function startServer() {
  // Use a custom port to avoid conflicts
  const PORT = 4099;
  
  // Dynamically import the server module
  const module = await import("../server/index.js");
  const app = module.app;
  
  return new Promise((resolve) => {
    server = app.listen(PORT, () => {
      baseUrl = `http://localhost:${PORT}`;
      resolve({ baseUrl, close: () => server.close() });
    });
  });
}

export async function request(method, urlPath, body, token) {
  const url = new URL(urlPath, baseUrl);
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (token) opts.headers.Authorization = `Bearer ${token}`;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url.toString(), opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}
