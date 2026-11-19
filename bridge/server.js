"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const https = require("node:https");
const crypto = require("node:crypto");
const { WebSocketServer } = require("ws");

const CLIENT_TTL_MS = 4 * 60 * 60 * 1000;
const PAIR_TTL_MS = 5 * 60 * 1000;
const MAX_BODY = 32768;
const MAX_DEVICES = 12;
const MAX_REPORTS = 60;
const PUBLIC = new Map([
  ["/tv", ["tv.html", "text/html; charset=utf-8"]],
  ["/tv.js", ["tv.js", "text/javascript; charset=utf-8"]],
  ["/style.css", ["style.css", "text/css; charset=utf-8"]],
  ["/admin", ["admin.html", "text/html; charset=utf-8"]],
  ["/admin.js", ["admin.js", "text/javascript; charset=utf-8"]]
]);

function sha(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
function secureEq(left, right) {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function randomToken() { return crypto.randomBytes(32).toString("base64url"); }
function ipv4s() {
  const found = new Set();
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const entry of addresses || []) {
      if (entry.family === "IPv4" && !entry.internal) found.add(entry.address);
    }
  }
  return [...found];
}
function isLoopback(req) {
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);
}
function json(res, status, data, extra = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extra
  });
  res.end(body);
}
function loadData(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = path.join(dataDir, "state.json");
  if (!fs.existsSync(file)) return { file, devices: [], reports: [] };
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(parsed.devices) || !Array.isArray(parsed.reports)) {
    throw new Error("Invalid persisted state structure");
  }
  return { file, devices: parsed.devices, reports: parsed.reports };
}
function saveData(state) {
  const temp = state.file + "." + process.pid + ".tmp";
  fs.writeFileSync(temp, JSON.stringify({
    devices: state.devices, reports: state.reports
  }), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temp, state.file);
}
function createBridge(opts) {
  if (!opts || !opts.cert || !opts.key) throw new Error("TLS cert and key required");
  if (typeof opts.adminPassword !== "string" || opts.adminPassword.length < 16) {
    throw new Error("TVSCOPE_ADMIN_PASSWORD must be at least 16 characters");
  }
  const adminPasswordHash = sha(opts.adminPassword);
  const state = loadData(opts.dataDir || path.join(__dirname, ".data"));
  const pairings = new Map();
  const adminSessions = new Map();
  const sockets = new Map();
  const limiters = new Map();
  const audit = [];
  const allowedNames = new Set(["localhost", "127.0.0.1", "[::1]",
    ...ipv4s(), ...(opts.allowedHosts || [])].map(x => String(x).toLowerCase()));

  function auditEvent(event, details = {}) {
    audit.push({ event, at: new Date().toISOString(), ...details });
    if (audit.length > 100) audit.shift();
  }
  function allowedHost(req) {
    if (typeof req.headers.host !== "string" || req.headers.host.length > 128) return false;
    try {
      const value = new URL("https://" + req.headers.host);
      const expectedPort = server.address()?.port || Number(opts.port || 8443);
      return value.username === "" && value.password === "" && value.pathname === "/" &&
        allowedNames.has(value.hostname.toLowerCase()) &&
        Number(value.port || 443) === expectedPort;
    } catch { return false; }
  }
  function sameOrigin(req) { return req.headers.origin === "https://" + req.headers.host; }
  function limit(ip, action, count, windowMs) {
    const key = action + "|" + ip;
    const now = Date.now();
    if (limiters.size > 4000) limiters.clear();
    let item = limiters.get(key);
    if (!item || item.expiry <= now) {
      item = { hits: 0, expiry: now + windowMs };
      limiters.set(key, item);
    }
    item.hits++;
    return item.hits <= count;
  }
  function cleanPairings() {
    let changed = false;
    for (const [id, p] of pairings) {
      if (Date.now() <= p.expiry && p.state !== "claimed") continue;
      if (p.state === "approved" && p.deviceId) {
        const unclaimed = state.devices.find(d => d.id === p.deviceId && !d.revokedAt);
        if (unclaimed) {
          unclaimed.revokedAt = new Date().toISOString();
          changed = true;
          auditEvent("pairing.expired_unclaimed", { deviceId: unclaimed.id });
        }
      }
      pairings.delete(id);
    }
    if (changed) saveData(state);
  }
  function validToken(token) {
    if (typeof token !== "string" || token.length < 30 || token.length > 128) return null;
    const hash = sha(token);
    return state.devices.find(d => !d.revokedAt && secureEq(d.tokenHash, hash)) || null;
  }
  function deviceFromBearer(req) {
    const value = req.headers.authorization || "";
    if (typeof value !== "string" || !value.startsWith("Bearer ")) return null;
    return validToken(value.slice(7));
  }
  function cookie(req, name) {
    const pairs = (req.headers.cookie || "").split(";");
    for (const pair of pairs) {
      const [k, ...v] = pair.trim().split("=");
      if (k === name) return v.join("=");
    }
    return null;
  }
  function adminSession(req) {
    if (!isLoopback(req)) return null;
    const id = cookie(req, "tvscope_admin");
    const a = id && adminSessions.get(sha(id));
    if (!a || a.expiry <= Date.now()) return null;
    return a;
  }
  function mutateAllowed(req, session) {
    return sameOrigin(req) && req.headers["x-tvscope-csrf"] === session.csrf;
  }
  async function body(req) {
    if (!(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
      const e = new Error("JSON content type required"); e.status = 415; throw e;
    }
    const chunks = [];
    let bytes = 0;
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > MAX_BODY) {
        const e = new Error("Request too large"); e.status = 413; throw e;
      }
      chunks.push(chunk);
    }
    try {
      const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (typeof value !== "object" || !value || Array.isArray(value)) throw new Error("Object required");
      return value;
    } catch {
      const e = new Error("Invalid JSON"); e.status = 400; throw e;
    }
  }
  function safeDevice(d) {
    return {
      id: d.id, label: d.label, createdAt: d.createdAt,
      lastSeen: d.lastSeen, revokedAt: d.revokedAt || null,
      connected: (sockets.get(d.id)?.size || 0) > 0
    };
  }
  function shutdownDevice(id) {
    for (const sock of sockets.get(id) || []) sock.close(4001, "Revoked");
    sockets.delete(id);
  }
  function staticContent(res, route) {
    const [filename, mime] = PUBLIC.get(route);
    const bytes = fs.readFileSync(path.join(__dirname, "public", filename));
    res.writeHead(200, {
      "Content-Type": mime,
      "Content-Length": bytes.length,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' wss:; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    });
    res.end(bytes);
  }

  async function route(req, res) {
    if (!allowedHost(req)) return json(res, 403, { error: "host_forbidden" });
    const url = new URL(req.url || "/", "https://placeholder");
    const p = url.pathname;
    if (req.method === "GET" && p === "/api/v1/health") {
      return json(res, 200, { status: "ok", service: "TVScope Bridge Phase 1", tls: true });
    }
    if (req.method === "GET" && PUBLIC.has(p)) {
      if ((p === "/admin" || p === "/admin.js") && !isLoopback(req)) {
        return json(res, 403, { error: "pc_only" });
      }
      return staticContent(res, p);
    }
    if (req.method === "POST" && !sameOrigin(req)) {
      return json(res, 403, { error: "origin_forbidden" });
    }
    if (req.method === "POST" && p === "/api/v1/admin/login") {
      if (!isLoopback(req) || !limit(req.socket.remoteAddress, "login", 5, 10 * 60 * 1000)) {
        return json(res, 429, { error: "not_allowed_or_rate_limited" });
      }
      const input = await body(req);
      const valid = typeof input.password === "string" &&
        secureEq(sha(input.password), adminPasswordHash);
      if (!valid) return json(res, 401, { error: "invalid_credentials" });
      const key = randomToken();
      const csrf = randomToken();
      adminSessions.set(sha(key), { csrf, expiry: Date.now() + CLIENT_TTL_MS });
      auditEvent("admin.login");
      return json(res, 200, { authenticated: true, csrf }, {
        "Set-Cookie": "tvscope_admin=" + key +
          "; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=14400"
      });
    }
    if (req.method === "GET" && p === "/api/v1/admin/me") {
      const a = adminSession(req);
      return a ? json(res, 200, { authenticated: true, csrf: a.csrf }) :
        json(res, 401, { error: "admin_login_required" });
    }
    if (p.startsWith("/api/v1/admin/")) {
      const a = adminSession(req);
      if (!a) return json(res, 401, { error: "admin_login_required" });
      if (req.method === "POST" && !mutateAllowed(req, a)) {
        return json(res, 403, { error: "csrf_forbidden" });
      }
      if (req.method === "GET" && p === "/api/v1/admin/pairings") {
        cleanPairings();
        return json(res, 200, {
          pairings: [...pairings.values()].filter(x => x.state === "pending").map(x => ({
            id: x.id, observedIp: x.observedIp, createdAt: x.createdAt,
            expiresAt: new Date(x.expiry).toISOString(), failedAttempts: x.failedAttempts
          }))
        });
      }
      if (req.method === "POST" && p === "/api/v1/admin/pairings/approve") {
        const input = await body(req);
        const pair = pairings.get(input.id);
        if (!pair || pair.state !== "pending" || Date.now() >= pair.expiry) {
          return json(res, 404, { error: "pairing_unavailable" });
        }
        if (++pair.failedAttempts > 5) {
          pairings.delete(pair.id);
          return json(res, 429, { error: "pairing_locked" });
        }
        if (typeof input.code !== "string" || !/^[0-9]{6}$/.test(input.code) ||
            !secureEq(sha(pair.id + ":" + input.code), pair.codeHash)) {
          auditEvent("pairing.failed", { pairId: pair.id });
          return json(res, 403, { error: "code_mismatch" });
        }
        if (state.devices.filter(d => !d.revokedAt).length >= MAX_DEVICES) {
          return json(res, 409, { error: "device_capacity" });
        }
        const label = typeof input.label === "string" ?
          input.label.trim().slice(0, 40) || "JVC TV" : "JVC TV";
        const token = randomToken();
        const d = {
          id: crypto.randomUUID(), label, tokenHash: sha(token),
          createdAt: new Date().toISOString(), lastSeen: null, revokedAt: null
        };
        state.devices.push(d);
        saveData(state);
        pair.state = "approved";
        pair.deviceId = d.id;
        pair.token = token;
        auditEvent("pairing.approved", { deviceId: d.id });
        return json(res, 200, { approved: true, device: safeDevice(d) });
      }
      if (req.method === "GET" && p === "/api/v1/admin/devices") {
        return json(res, 200, {
          devices: state.devices.map(safeDevice), audit: audit.slice(-40)
        });
      }
      if (req.method === "GET" && p === "/api/v1/admin/reports") {
        return json(res, 200, { reports: state.reports.slice(-60) });
      }
      if (req.method === "POST" && p === "/api/v1/admin/devices/revoke") {
        const input = await body(req);
        const d = state.devices.find(x => x.id === input.id && !x.revokedAt);
        if (!d) return json(res, 404, { error: "device_not_found" });
        d.revokedAt = new Date().toISOString();
        saveData(state);
        shutdownDevice(d.id);
        auditEvent("device.revoked", { deviceId: d.id });
        return json(res, 200, { revoked: true });
      }
      if (req.method === "POST" && p === "/api/v1/admin/devices/notice") {
        const input = await body(req);
        if (typeof input.message !== "string" ||
            input.message.length < 1 || input.message.length > 160) {
          return json(res, 400, { error: "invalid_message" });
        }
        const d = state.devices.find(x => x.id === input.id && !x.revokedAt);
        if (!d) return json(res, 404, { error: "device_not_found" });
        let sent = 0;
        for (const sock of sockets.get(d.id) || []) {
          if (sock.readyState === sock.OPEN) {
            sock.send(JSON.stringify({ type: "admin.notice", message: input.message }));
            sent++;
          }
        }
        auditEvent("device.notice", { deviceId: d.id, sent });
        return json(res, 200, { deliveredToConnections: sent });
      }
      return json(res, 404, { error: "unknown_admin_route" });
    }

    if (req.method === "POST" && p === "/api/v1/pair/start") {
      if (!limit(req.socket.remoteAddress, "pair", 4, 10 * 60 * 1000)) {
        return json(res, 429, { error: "pair_rate_limited" });
      }
      cleanPairings();
      if (pairings.size >= 20) return json(res, 429, { error: "pair_capacity" });
      const id = crypto.randomUUID();
      const secret = randomToken();
      const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
      const createdAt = new Date().toISOString();
      const expiry = Date.now() + PAIR_TTL_MS;
      pairings.set(id, {
        id, secretHash: sha(secret), codeHash: sha(id + ":" + code),
        observedIp: req.socket.remoteAddress, createdAt, expiry,
        failedAttempts: 0, state: "pending"
      });
      auditEvent("pairing.requested", { pairId: id });
      return json(res, 201, {
        id, secret, code, expiresAt: new Date(expiry).toISOString()
      });
    }
    if (req.method === "POST" && p === "/api/v1/pair/status") {
      const input = await body(req);
      const pair = pairings.get(input.id);
      if (!pair || Date.now() >= pair.expiry ||
          typeof input.secret !== "string" ||
          !secureEq(pair.secretHash, sha(input.secret))) {
        return json(res, 404, { error: "pairing_unavailable" });
      }
      return json(res, 200, { state: pair.state });
    }
    if (req.method === "POST" && p === "/api/v1/pair/claim") {
      const input = await body(req);
      const pair = pairings.get(input.id);
      if (!pair || pair.state !== "approved" || Date.now() >= pair.expiry ||
          typeof input.secret !== "string" ||
          !secureEq(pair.secretHash, sha(input.secret))) {
        return json(res, 403, { error: "claim_forbidden" });
      }
      const device = state.devices.find(d => d.id === pair.deviceId && !d.revokedAt);
      if (!device) return json(res, 403, { error: "device_revoked" });
      pairings.delete(pair.id);
      return json(res, 200, { token: pair.token, device: safeDevice(device) });
    }
    if (req.method === "GET" && p === "/api/v1/session") {
      const d = deviceFromBearer(req);
      return d ? json(res, 200, { device: safeDevice(d) }) :
        json(res, 401, { error: "not_paired" });
    }
    if (req.method === "POST" && p === "/api/v1/diagnostics") {
      const d = deviceFromBearer(req);
      if (!d) return json(res, 401, { error: "not_paired" });
      if (!limit(d.id, "report", 15, 60 * 1000)) {
        return json(res, 429, { error: "report_rate_limited" });
      }
      const input = await body(req);
      if (input.schemaVersion !== 1 ||
          typeof input.observedAt !== "string" ||
          !input.tests || typeof input.tests !== "object" ||
          Array.isArray(input.tests)) {
        return json(res, 400, { error: "invalid_report" });
      }
      state.reports.push({
        id: crypto.randomUUID(), deviceId: d.id,
        receivedAt: new Date().toISOString(), report: input
      });
      if (state.reports.length > MAX_REPORTS) state.reports.splice(0, state.reports.length - MAX_REPORTS);
      saveData(state);
      auditEvent("diagnostics.submitted", { deviceId: d.id });
      return json(res, 201, { recorded: true });
    }
    return json(res, 404, { error: "not_found" });
  }

  const server = https.createServer({
    key: opts.key, cert: opts.cert, minVersion: "TLSv1.2"
  }, (req, res) => {
    route(req, res).catch(err => {
      const status = Number(err.status) || 500;
      auditEvent("http.error", { status, route: (req.url || "").split("?")[0] });
      if (!res.headersSent) json(res, status, { error: status === 500 ? "internal_error" : err.message });
      else res.end();
    });
  });
  const wss = new WebSocketServer({
    noServer: true, maxPayload: 2048, perMessageDeflate: false
  });
  server.on("upgrade", (req, socket, head) => {
    const p = new URL(req.url || "/", "https://placeholder").pathname;
    if (p !== "/api/v1/ws" || !allowedHost(req) || !sameOrigin(req)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });
  wss.on("connection", (ws, req) => {
    let device = null;
    const authTimer = setTimeout(() => {
      if (!device) ws.close(4003, "Authentication required");
    }, 5000);
    ws.on("message", (raw, isBinary) => {
      if (isBinary) return ws.close(1003, "JSON text only");
      let msg;
      try { msg = JSON.parse(raw.toString()); }
      catch { return ws.close(1007, "Invalid JSON"); }
      if (!device) {
        if (!msg || msg.type !== "session.authenticate") return ws.close(4003, "Authentication required");
        device = validToken(msg.token);
        if (!device) return ws.close(4003, "Invalid session");
        clearTimeout(authTimer);
        let set = sockets.get(device.id);
        if (!set) { set = new Set(); sockets.set(device.id, set); }
        set.add(ws);
        device.lastSeen = new Date().toISOString();
        saveData(state);
        ws.send(JSON.stringify({ type: "session.ready", deviceId: device.id }));
        auditEvent("session.connected", { deviceId: device.id });
        return;
      }
      if (msg && msg.type === "client.ping" &&
          typeof msg.id === "string" && msg.id.length <= 64) {
        ws.send(JSON.stringify({ type: "server.pong", id: msg.id }));
      }
    });
    ws.on("close", () => {
      clearTimeout(authTimer);
      if (device) {
        const set = sockets.get(device.id);
        if (set) {
          set.delete(ws);
          if (!set.size) sockets.delete(device.id);
        }
        auditEvent("session.disconnected", { deviceId: device.id });
      }
    });
  });

  return { server, wss, state, pairings, audit, sockets };
}

if (require.main === module) {
  const certFile = process.env.TVSCOPE_TLS_CERT;
  const keyFile = process.env.TVSCOPE_TLS_KEY;
  const password = process.env.TVSCOPE_ADMIN_PASSWORD;
  const port = Number(process.env.TVSCOPE_PORT || 8443);
  if (!certFile || !keyFile || !Number.isInteger(port) || port < 1 || port > 65535) {
    console.error("Set TVSCOPE_TLS_CERT, TVSCOPE_TLS_KEY; valid TVSCOPE_PORT (default 8443).");
    process.exit(1);
  }
  try {
    const bridge = createBridge({
      cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile),
      adminPassword: password, port,
      dataDir: process.env.TVSCOPE_DATA_DIR,
      allowedHosts: (process.env.TVSCOPE_HOSTS || "").split(",").map(x => x.trim()).filter(Boolean)
    });
    bridge.server.listen(port, process.env.TVSCOPE_BIND || "0.0.0.0", () => {
      console.log("TVScope Bridge Phase 1 — HTTPS only");
      console.log("PC admin: https://localhost:" + port + "/admin (requires TLS trust for localhost)");
      console.log("Alternative: trusted domain mapped to 127.0.0.1 on PC; add domain to TVSCOPE_HOSTS.");
      for (const ip of ipv4s()) {
        console.log("TV address (certificate must cover and be trusted by TV): https://" + ip + ":" + port + "/tv");
      }
      console.log("No public port forwarding. No Android OS access.");
    });
  } catch (e) {
    console.error("Bridge setup failed: " + e.message);
    process.exit(1);
  }
}
module.exports = { createBridge, ipv4s };
