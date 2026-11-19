"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const https = require("node:https");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { WebSocket } = require("ws");
const { createBridge } = require("../server");

const password = "phase1-test-Strong-admin-passphrase-2026";
let bridge;
let dir;
let ca;
let origin;
let cookie;
let csrf;
let token;
let deviceId;

function request(route, method = "GET", value, extra = {}) {
  const data = value === undefined ? null : JSON.stringify(value);
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "127.0.0.1", port: bridge.server.address().port,
      path: route, method, ca, servername: "localhost", rejectUnauthorized: true,
      headers: { Host: "127.0.0.1:" + bridge.server.address().port, ...extra }
    };
    if (data !== null) {
      options.headers["Content-Type"] = "application/json";
      options.headers["Content-Length"] = Buffer.byteLength(data);
    }
    const req = https.request(options, (res) => {
      const pieces = [];
      res.on("data", c => pieces.push(c));
      res.on("end", () => {
        const bytes = Buffer.concat(pieces).toString("utf8");
        let body = bytes;
        try { body = JSON.parse(bytes); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    });
    req.on("error", reject);
    if (data !== null) req.write(data);
    req.end();
  });
}
function post(route, value, extra = {}) {
  return request(route, "POST", value, { Origin: origin, ...extra });
}
function adminHeaders() {
  return { Cookie: cookie, "X-TVScope-CSRF": csrf };
}
function wsConnect(authToken, requestOrigin = origin) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket("wss://127.0.0.1:" + bridge.server.address().port + "/api/v1/ws", {
      ca, rejectUnauthorized: true, origin: requestOrigin
    });
    const timeout = setTimeout(() => { ws.terminate(); reject(new Error("Timed out connecting")); }, 3000);
    ws.once("open", () => {
      ws.send(JSON.stringify({ type: "session.authenticate", token: authToken }));
    });
    ws.once("message", data => {
      clearTimeout(timeout);
      try {
        const msg = JSON.parse(String(data));
        if (msg.type !== "session.ready") throw Error("Not authorised");
        resolve({ ws, msg });
      } catch (e) { reject(e); }
    });
    ws.once("error", e => { clearTimeout(timeout); reject(e); });
    ws.once("close", (code) => {
      if (code === 4003) { clearTimeout(timeout); reject(new Error("Unauthorized WebSocket")); }
    });
  });
}
function nextMessage(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WS response timed out")), 2000);
    socket.once("message", data => {
      clearTimeout(timer);
      resolve(JSON.parse(String(data)));
    });
  });
}

test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "tvscope-bridge-tests-"));
  const key = path.join(dir, "key.pem");
  const cert = path.join(dir, "cert.pem");
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", key, "-out", cert, "-days", "1",
    "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"
  ], { stdio: "ignore" });
  ca = fs.readFileSync(cert);
  bridge = createBridge({
    key: fs.readFileSync(key), cert: ca,
    adminPassword: password,
    dataDir: path.join(dir, "data")
  });
  await new Promise(resolve => bridge.server.listen(0, "127.0.0.1", resolve));
  origin = "https://127.0.0.1:" + bridge.server.address().port;
});
test.after(async () => {
  for (const ws of bridge.wss.clients) ws.terminate();
  await new Promise(resolve => bridge.server.close(resolve));
  bridge.wss.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("HTTPS, CSP, host validation and PC admin page", async () => {
  const tv = await request("/tv");
  assert.equal(tv.status, 200);
  assert.match(tv.body, /TV Connection Bridge/);
  assert.match(tv.headers["content-security-policy"], /frame-ancestors 'none'/);
  assert.equal((await request("/tv.js")).status, 200);
  assert.equal((await request("/admin")).status, 200);
  assert.equal((await request("/api/v1/health")).body.tls, true);
  const hostile = await request("/tv", "GET", undefined, { Host: "attacker.example" });
  assert.equal(hostile.status, 403);
  assert.equal((await request("/api/v1/admin/devices")).status, 401);
});

test("admin login, origin + CSRF guards", async () => {
  assert.equal((await post("/api/v1/admin/login", { password: "bad" })).status, 401);
  assert.equal((await request("/api/v1/admin/login", "POST", { password })).status, 403);
  const login = await post("/api/v1/admin/login", { password });
  assert.equal(login.status, 200);
  csrf = login.body.csrf;
  cookie = login.headers["set-cookie"][0].split(";")[0];
  assert.match(login.headers["set-cookie"][0], /HttpOnly; Secure; SameSite=Strict/);
  assert.equal((await request("/api/v1/admin/me", "GET", undefined, { Cookie: cookie })).status, 200);
  const noCsrf = await post("/api/v1/admin/devices/revoke", { id: "fake" }, { Cookie: cookie });
  assert.equal(noCsrf.status, 403);
  const foreign = await post("/api/v1/admin/devices/revoke", { id: "fake" }, {
    ...adminHeaders(), Origin: "https://evil.example"
  });
  assert.equal(foreign.status, 403);
});

test("pairing requires exact code, admin approval and single claim", async () => {
  const start = await post("/api/v1/pair/start", {});
  assert.equal(start.status, 201);
  assert.match(start.body.code, /^[0-9]{6}$/);
  const p = start.body;
  const pending = await request("/api/v1/admin/pairings", "GET", undefined, { Cookie: cookie });
  assert.equal(pending.status, 200);
  assert.equal(pending.body.pairings.length, 1);
  assert.equal(Object.hasOwn(pending.body.pairings[0], "code"), false);
  assert.equal((await post("/api/v1/pair/status", { id: p.id, secret: p.secret })).body.state, "pending");
  const wrong = await post("/api/v1/admin/pairings/approve", {
    id: p.id, code: "999999" === p.code ? "888888" : "999999"
  }, adminHeaders());
  assert.equal(wrong.status, 403);
  const approved = await post("/api/v1/admin/pairings/approve", {
    id: p.id, code: p.code, label: "JVC TV"
  }, adminHeaders());
  assert.equal(approved.status, 200);
  deviceId = approved.body.device.id;
  assert.equal((await post("/api/v1/pair/status", { id: p.id, secret: p.secret })).body.state, "approved");
  const claim = await post("/api/v1/pair/claim", { id: p.id, secret: p.secret });
  assert.equal(claim.status, 200);
  token = claim.body.token;
  assert.equal((await post("/api/v1/pair/claim", { id: p.id, secret: p.secret })).status, 403);
  assert.equal((await request("/api/v1/session", "GET", undefined, {
    Authorization: "Bearer " + token
  })).body.device.id, deviceId);
});

test("diagnostics require scoped token, bounded reports and persistence", async () => {
  const data = { schemaVersion: 1, observedAt: new Date().toISOString(), tests: { browser: "JVC" } };
  assert.equal((await post("/api/v1/diagnostics", data)).status, 401);
  assert.equal((await post("/api/v1/diagnostics", data, { Authorization: "Bearer wrong" })).status, 401);
  assert.equal((await post("/api/v1/diagnostics", { bogus: 1 }, {
    Authorization: "Bearer " + token
  })).status, 400);
  const response = await post("/api/v1/diagnostics", data, {
    Authorization: "Bearer " + token
  });
  assert.equal(response.status, 201);
  const reports = await request("/api/v1/admin/reports", "GET", undefined, { Cookie: cookie });
  assert.equal(reports.body.reports[0].deviceId, deviceId);
  const saved = JSON.parse(fs.readFileSync(bridge.state.file, "utf8"));
  assert.equal(saved.devices[0].tokenHash.length, 64);
  assert.equal(JSON.stringify(saved).includes(token), false);
  assert.equal(saved.reports.length, 1);
});

test("WebSocket authentication, bidirectional control, revocation", async () => {
  await assert.rejects(wsConnect(token, "https://evil.example"), /403|Unexpected server response/);
  await assert.rejects(wsConnect("invalid-token"), /Unauthorized WebSocket/);
  const { ws } = await wsConnect(token);
  const pong = nextMessage(ws);
  ws.send(JSON.stringify({ type: "client.ping", id: "p1" }));
  assert.deepEqual(await pong, { type: "server.pong", id: "p1" });
  const notice = nextMessage(ws);
  const sent = await post("/api/v1/admin/devices/notice", {
    id: deviceId, message: "Bridge connected"
  }, adminHeaders());
  assert.equal(sent.body.deliveredToConnections, 1);
  assert.deepEqual(await notice, { type: "admin.notice", message: "Bridge connected" });
  const revoked = await post("/api/v1/admin/devices/revoke", { id: deviceId }, adminHeaders());
  assert.equal(revoked.status, 200);
  assert.equal((await request("/api/v1/session", "GET", undefined, {
    Authorization: "Bearer " + token
  })).status, 401);
  assert.equal((await post("/api/v1/diagnostics", {
    schemaVersion: 1, observedAt: new Date().toISOString(), tests: {}
  }, { Authorization: "Bearer " + token })).status, 401);
});

test("rejects plaintext and absent TLS certificate configuration", () => {
  assert.throws(() => createBridge({ adminPassword: password }), /TLS cert and key required/);
  assert.throws(() => createBridge({
    cert: ca, key: fs.readFileSync(path.join(dir, "key.pem")),
    adminPassword: "short"
  }), /at least 16/);
});
