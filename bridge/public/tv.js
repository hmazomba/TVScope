(function () {
  "use strict";
  var token = null;
  var device = null;
  var ws = null;
  var pairing = null;
  var pairTimer = null;
  var reconnectTimer = null;
  var reconnectDelay = 1000;
  var wsPingStart = null;
  var tests = {};
  var remoteEvents = [];

  function el(id) { return document.getElementById(id); }
  function put(id, text) { el(id).textContent = text; }
  function stamp() { return new Date().toISOString(); }
  function errText(e) { return (e && e.message) ? e.message : String(e); }
  async function api(route, method, data, bearer) {
    var headers = {};
    if (data !== undefined) headers["Content-Type"] = "application/json";
    if (bearer) headers.Authorization = "Bearer " + bearer;
    var response = await fetch(route, {
      method: method || "GET", headers: headers,
      body: data === undefined ? undefined : JSON.stringify(data),
      cache: "no-store"
    });
    var body = await response.json();
    if (!response.ok) {
      var error = new Error(body.error || "HTTP " + response.status);
      error.status = response.status;
      throw error;
    }
    return body;
  }
  function preview() {
    var report = { schemaVersion: 1, observedAt: stamp(), tests: tests, remoteEvents: remoteEvents.slice() };
    el("report-preview").textContent = JSON.stringify(report, null, 2);
    return report;
  }
  function storageTest(which) {
    try {
      var area = window[which], key = "tvscope-bridge-probe";
      area.setItem(key, "ok");
      var ok = area.getItem(key) === "ok";
      area.removeItem(key);
      return ok ? "read_write_ok" : "readback_mismatch";
    } catch (e) { return "blocked:" + (e.name || "error"); }
  }
  function collect() {
    var video = document.createElement("video");
    function codec(type) {
      try { return video.canPlayType(type) || "no"; }
      catch (_) { return "unknown"; }
    }
    tests = {
      environment: {
        userAgent: navigator.userAgent || null,
        platform: navigator.platform || null,
        viewport: { width: innerWidth, height: innerHeight },
        screen: { width: screen.width, height: screen.height },
        devicePixelRatio: window.devicePixelRatio || 1,
        secureContext: !!window.isSecureContext,
        onlineHint: !!navigator.onLine,
        emEAvailable: typeof navigator.requestMediaKeySystemAccess === "function"
      },
      storage: {
        localStorage: storageTest("localStorage"),
        sessionStorage: storageTest("sessionStorage")
      },
      media: {
        h264_aac: codec('video/mp4; codecs="avc1.42E01E, mp4a.40.2"'),
        vp9: codec('video/webm; codecs="vp9"'),
        hls: codec("application/vnd.apple.mpegurl"),
        mediaSource: !!(window.MediaSource || window.WebKitMediaSource)
      },
      transport: { scheme: location.protocol, websocket: ws && ws.readyState === 1 ? "connected" : "not_connected" }
    };
    put("report-status", "Local browser diagnostic snapshot ready; review before submit.");
    preview();
  }
  function saveToken(t) {
    token = t;
    try { localStorage.setItem("tvscope_bridge_token", t); }
    catch (_) { try { sessionStorage.setItem("tvscope_bridge_token", t); } catch (_) {} }
  }
  function readToken() {
    try { return localStorage.getItem("tvscope_bridge_token") ||
      sessionStorage.getItem("tvscope_bridge_token"); } catch (_) { return null; }
  }
  function forgetToken() {
    token = null;
    try { localStorage.removeItem("tvscope_bridge_token"); } catch (_) {}
    try { sessionStorage.removeItem("tvscope_bridge_token"); } catch (_) {}
  }
  function showPaired() {
    el("pairing").hidden = true;
    el("paired").hidden = false;
    put("device-name", "Paired: " + (device ? device.label : "TV"));
    put("connection", "Paired. Connecting WSS session...");
  }
  function showUnpaired(message) {
    el("pairing").hidden = false;
    el("paired").hidden = true;
    put("connection", message || "TV not paired. Select Create pairing code.");
  }
  function connect() {
    if (!token || document.hidden) return;
    clearTimeout(reconnectTimer);
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    var scheme = location.protocol === "https:" ? "wss:" : "ws:";
    try {
      ws = new WebSocket(scheme + "//" + location.host + "/api/v1/ws");
      ws.onopen = function () {
        ws.send(JSON.stringify({ type: "session.authenticate", token: token }));
      };
      ws.onmessage = function (ev) {
        var message;
        try { message = JSON.parse(ev.data); } catch (_) { return; }
        if (message.type === "session.ready") {
          reconnectDelay = 1000;
          put("connection", "WSS session authorised. Device " + message.deviceId);
        } else if (message.type === "server.pong") {
          put("ping-outcome", "WebSocket round trip: " +
            (wsPingStart ? Math.round(performance.now() - wsPingStart) + " ms" : "received"));
        } else if (message.type === "admin.notice") {
          put("notice", message.message);
        }
      };
      ws.onclose = function (ev) {
        if (ev.code === 4001 || ev.code === 4003) {
          forgetToken();
          device = null;
          showUnpaired("Session revoked/expired. Pair again.");
          return;
        }
        put("connection", "Bridge disconnected. Reconnecting...");
        reconnectTimer = setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 12000);
      };
      ws.onerror = function () { put("connection", "WebSocket transport error."); };
    } catch (e) { put("connection", "Connection failed: " + errText(e)); }
  }
  async function resume() {
    token = readToken();
    if (!token) { showUnpaired(); return; }
    try {
      var result = await api("/api/v1/session", "GET", undefined, token);
      device = result.device;
      showPaired();
      connect();
    } catch (_) {
      forgetToken();
      showUnpaired("Saved token unavailable. Pair again.");
    }
  }
  async function startPair() {
    if (pairing) return;
    try {
      var result = await api("/api/v1/pair/start", "POST", {});
      pairing = { id: result.id, secret: result.secret };
      put("pair-code", result.code);
      put("pair-state", "Enter code into PC admin. Expires: " + result.expiresAt);
      pairTimer = setInterval(pollPair, 2500);
    } catch (e) { put("pair-state", "Cannot start pairing: " + errText(e)); }
  }
  async function pollPair() {
    if (!pairing) return;
    try {
      var state = await api("/api/v1/pair/status", "POST", pairing);
      if (state.state !== "approved") return;
      clearInterval(pairTimer);
      var claimed = await api("/api/v1/pair/claim", "POST", pairing);
      saveToken(claimed.token);
      device = claimed.device;
      pairing = null;
      put("pair-code", "------");
      showPaired();
      connect();
    } catch (e) {
      clearInterval(pairTimer);
      pairing = null;
      put("pair-code", "------");
      put("pair-state", "Pairing expired or failed: " + errText(e) + ". Try again.");
    }
  }
  el("pair-start").addEventListener("click", startPair);
  el("test-ping").addEventListener("click", function () {
    if (!ws || ws.readyState !== 1) return put("ping-outcome", "No active WebSocket.");
    wsPingStart = performance.now();
    ws.send(JSON.stringify({ type: "client.ping", id: String(Date.now()) }));
  });
  el("collect").addEventListener("click", collect);
  el("preview").addEventListener("click", preview);
  el("clear-keys").addEventListener("click", function () {
    remoteEvents = [];
    put("remote-last", "Remote events cleared.");
    preview();
  });
  el("fullscreen").addEventListener("click", async function () {
    var request = document.documentElement.requestFullscreen ||
      document.documentElement.webkitRequestFullscreen;
    if (!request) {
      tests.fullscreen = "api_missing";
      put("report-status", "Fullscreen API missing.");
      return preview();
    }
    try {
      var response = request.call(document.documentElement);
      if (response && response.then) await response;
      tests.fullscreen = (document.fullscreenElement || document.webkitFullscreenElement) ?
        "active" : "requested";
    } catch (e) { tests.fullscreen = "rejected: " + errText(e); }
    preview();
  });
  window.addEventListener("keydown", function (e) {
    if (document.activeElement !== el("remote-box")) return;
    var allowed = [
      "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", "Escape",
      "Backspace", "Home", "MediaPlay", "MediaPause", "MediaPlayPause"
    ];
    var key = allowed.indexOf(e.key) >= 0 ? e.key : "Other";
    var legacyAllowed = [3, 4, 8, 13, 19, 20, 21, 22, 23, 27, 37, 38, 39, 40, 66, 85, 86];
    var code = Number(e.keyCode) || 0;
    if (key === "Other" && legacyAllowed.indexOf(code) < 0) code = 0;
    remoteEvents.push({ key: key, keyCode: code, at: stamp() });
    if (remoteEvents.length > 60) remoteEvents.shift();
    put("remote-last", "Observed: " + key + " / keyCode " + code +
      ". Count " + remoteEvents.length);
    if (key.indexOf("Arrow") === 0) e.preventDefault();
    preview();
  });
  el("submit").addEventListener("click", async function () {
    if (!token) return put("report-status", "Pair TV first.");
    try {
      var result = await api("/api/v1/diagnostics", "POST", preview(), token);
      put("report-status", result.recorded ? "Report stored on PC." : "Report not stored.");
    } catch (e) { put("report-status", "Submit failed: " + errText(e)); }
  });
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) connect();
  });
  preview();
  resume();
})();
