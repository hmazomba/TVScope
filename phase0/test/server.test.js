"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { WebSocket } = require("ws");
const { createPhase0Server } = require("../server");

let app;
let base;
test.before(async () => {
  app = createPhase0Server();
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  base = "http://127.0.0.1:" + app.server.address().port;
});
test.after(async () => {
  for (const client of app.wss.clients) client.terminate();
  await new Promise((resolve) => app.server.close(resolve));
  app.wss.close();
});

test("TV page, CSP, health and HTTP ping", async () => {
  const page = await fetch(base + "/tv");
  assert.equal(page.status, 200);
  assert.match(await page.text(), /JVC Browser Diagnostics/);
  assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  const script = await fetch(base + "/tv.js");
  assert.equal(script.status, 200);
  assert.match(await script.text(), /requestMediaKeySystemAccess/);
  const health = await (await fetch(base + "/api/health")).json();
  assert.equal(health.status, "ok");
  const ping = await (await fetch(base + "/api/ping")).json();
  assert.equal(ping.pong, true);
});

test("rejects hostile Host header", async () => {
  const status = await new Promise((resolve, reject) => {
    const req = http.get(base + "/tv", { headers: { Host: "evil.example" } }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject);
  });
  assert.equal(status, 403);
});

test("same-origin report submission, validation and PC readback", async () => {
  const data = JSON.stringify({
    schemaVersion: 1, observedAt: new Date().toISOString(),
    tests: { http: { status: "reachable" } }
  });
  const noOrigin = await fetch(base + "/api/report", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: data
  });
  assert.equal(noOrigin.status, 403);
  const badSchema = await fetch(base + "/api/report", {
    method: "POST", headers: { Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({ schemaVersion: 500, tests: {} })
  });
  assert.equal(badSchema.status, 400);
  const accepted = await fetch(base + "/api/report", {
    method: "POST", headers: { Origin: base, "Content-Type": "application/json" }, body: data
  });
  assert.equal(accepted.status, 201);
  const reports = await (await fetch(base + "/api/reports")).json();
  assert.equal(reports.reports.length, 1);
  assert.equal(reports.reports[0].report.tests.http.status, "reachable");
});

test("rejects oversized reports", async () => {
  const body = JSON.stringify({
    schemaVersion: 1, observedAt: new Date().toISOString(),
    tests: { padding: "x".repeat(40000) }
  });
  const response = await fetch(base + "/api/report", {
    method: "POST",
    headers: { Origin: base, "Content-Type": "application/json" }, body
  });
  assert.equal(response.status, 413);
});

test("WebSocket responds to matching ping ID", async () => {
  const id = "probe-123";
  const result = await new Promise((resolve, reject) => {
    const ws = new WebSocket(base.replace("http:", "ws:") + "/api/ws", { origin: base });
    const timeout = setTimeout(() => { ws.terminate(); reject(new Error("WS timeout")); }, 3000);
    ws.on("open", () => ws.send(JSON.stringify({ type: "probe.ping", id })));
    ws.on("message", (payload) => {
      clearTimeout(timeout);
      resolve(JSON.parse(String(payload)));
      ws.close();
    });
    ws.on("error", (err) => { clearTimeout(timeout); reject(err); });
  });
  assert.equal(result.type, "probe.pong");
  assert.equal(result.id, id);
});

test("optional MP4 byte-range response", async (t) => {
  const sample = path.join(__dirname, "..", "media", "test.mp4");
  if (fs.existsSync(sample)) return t.skip("Preserve operator's sample");
  fs.writeFileSync(sample, Buffer.from("0123456789"));
  try {
    const response = await fetch(base + "/sample.mp4", { headers: { Range: "bytes=2-5" } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-range"), "bytes 2-5/10");
    assert.equal(await response.text(), "2345");
  } finally { fs.unlinkSync(sample); }
});

test("only same-origin localhost clears reports", async () => {
  const blocked = await fetch(base + "/api/reports", { method: "DELETE" });
  assert.equal(blocked.status, 403);
  const accepted = await fetch(base + "/api/reports", {
    method: "DELETE", headers: { Origin: base }
  });
  assert.equal(accepted.status, 200);
  const result = await (await fetch(base + "/api/reports")).json();
  assert.equal(result.reports.length, 0);
});
