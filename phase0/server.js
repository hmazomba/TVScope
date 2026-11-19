"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { WebSocketServer } = require("ws");

const ROOT = path.join(__dirname, "public");
const MAX_REPORT_BYTES = 32768;
const MAX_REPORTS = 30;
const FILES = new Map([
  ["/tv", ["tv.html", "text/html; charset=utf-8"]],
  ["/", ["tv.html", "text/html; charset=utf-8"]],
  ["/tv.js", ["tv.js", "text/javascript; charset=utf-8"]],
  ["/style.css", ["style.css", "text/css; charset=utf-8"]],
  ["/admin", ["admin.html", "text/html; charset=utf-8"]],
  ["/admin.js", ["admin.js", "text/javascript; charset=utf-8"]]
]);

function interfaceAddresses() {
  const values = [];
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const item of interfaces || []) {
      if (item.family === "IPv4" && !item.internal) values.push(item.address);
    }
  }
  return [...new Set(values)];
}

function allowedHost(hostHeader) {
  if (typeof hostHeader !== "string" || hostHeader.length > 128) return false;
  try {
    const url = new URL("http://" + hostHeader);
    if (url.username || url.password || url.pathname !== "/") return false;
    const host = url.hostname.toLowerCase();
    return ["localhost", "127.0.0.1", "[::1]", ...interfaceAddresses()].includes(host);
  } catch {
    return false;
  }
}

function isLoopback(req) {
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);
}

function originMatches(req) {
  return req.headers.origin === "http://" + req.headers.host;
}

function reply(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(body);
}

function createPhase0Server() {
  const reports = [];
  const wss = new WebSocketServer({
    noServer: true, maxPayload: 1024, perMessageDeflate: false,
    clientTracking: true
  });

  wss.on("connection", (socket) => {
    socket.on("message", (raw, isBinary) => {
      if (isBinary) return socket.close(1003, "JSON text only");
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg && msg.type === "probe.ping" &&
          typeof msg.id === "string" && msg.id.length <= 64) {
        socket.send(JSON.stringify({
          type: "probe.pong", id: msg.id, serverTime: new Date().toISOString()
        }));
      }
    });
  });

  const server = http.createServer((req, res) => {
    if (!allowedHost(req.headers.host)) {
      return reply(res, 403, { error: "unrecognised_host" });
    }

    const route = new URL(req.url || "/", "http://localhost").pathname;
    if (req.method === "GET" && route === "/api/health") {
      return reply(res, 200, { service: "TVScope Phase 0", status: "ok" });
    }
    if (req.method === "GET" && route === "/api/ping") {
      return reply(res, 200, { pong: true, serverTime: Date.now() });
    }
    if (req.method === "GET" && route === "/api/reports") {
      if (!isLoopback(req)) return reply(res, 403, { error: "pc_only" });
      return reply(res, 200, { reports });
    }
    if (req.method === "DELETE" && route === "/api/reports") {
      if (!isLoopback(req) || !originMatches(req)) {
        return reply(res, 403, { error: "pc_only_same_origin" });
      }
      reports.length = 0;
      return reply(res, 200, { cleared: true });
    }
    if (req.method === "POST" && route === "/api/report") {
      if (!originMatches(req)) return reply(res, 403, { error: "origin_mismatch" });
      if (!(req.headers["content-type"] || "").startsWith("application/json")) {
        return reply(res, 415, { error: "json_required" });
      }
      let size = 0;
      let chunks = [];
      let oversized = false;
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_REPORT_BYTES) {
          oversized = true;
          chunks = [];
        } else if (!oversized) {
          chunks.push(chunk);
        }
      });
      req.on("end", () => {
        if (oversized) return reply(res, 413, { error: "report_too_large" });
        let report;
        try { report = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
        catch { return reply(res, 400, { error: "invalid_json" }); }
        if (!report || report.schemaVersion !== 1 ||
            typeof report.observedAt !== "string" ||
            !report.tests || typeof report.tests !== "object" ||
            Array.isArray(report.tests)) {
          return reply(res, 400, { error: "invalid_report_schema" });
        }
        const record = {
          id: crypto.randomUUID(),
          receivedAt: new Date().toISOString(),
          observedIp: req.socket.remoteAddress,
          report
        };
        reports.push(record);
        if (reports.length > MAX_REPORTS) reports.shift();
        return reply(res, 201, { id: record.id, recorded: true });
      });
      req.on("error", () => {
        if (!res.writableEnded) reply(res, 400, { error: "request_error" });
      });
      return;
    }

    const file = FILES.get(route);
    if (req.method === "GET" && file) {
      if ((route === "/admin" || route === "/admin.js") && !isLoopback(req)) {
        return reply(res, 403, { error: "pc_only" });
      }
      const [name, type] = file;
      const body = fs.readFileSync(path.join(ROOT, name));
      res.writeHead(200, {
        "Content-Type": type,
        "Content-Length": body.length,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' ws:; img-src 'self' data:; media-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
      });
      return res.end(body);
    }
    return reply(res, 404, { error: "not_found" });
  });

  server.on("upgrade", (req, socket, head) => {
    const route = new URL(req.url || "/", "http://localhost").pathname;
    if (route !== "/api/ws" || !allowedHost(req.headers.host) || !originMatches(req)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  return { server, reports, wss };
}

if (require.main === module) {
  const port = Number(process.env.TVSCOPE_PORT || 8080);
  const bind = process.env.TVSCOPE_BIND || "0.0.0.0";
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error("Invalid TVSCOPE_PORT");
    process.exit(1);
  }
  const { server } = createPhase0Server();
  server.listen(port, bind, () => {
    console.log("TVScope Phase 0 browser diagnostics");
    console.log("PC dashboard: http://localhost:" + port + "/admin");
    for (const ip of interfaceAddresses()) {
      console.log("Open in JVC Chrome: http://" + ip + ":" + port + "/tv");
    }
    console.log("Private LAN only. No internet exposure; no privileged TV access.");
  });
}

module.exports = { createPhase0Server, interfaceAddresses, allowedHost };
