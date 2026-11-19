(function () {
  "use strict";
  var tests = {};
  var remoteEvents = [];
  var maxRemoteEvents = 60;
  var status = document.getElementById("status");
  var keybox = document.getElementById("keybox");
  var reportView = document.getElementById("report");

  function now() { return new Date().toISOString(); }
  function timeMs() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function setText(id, value) { document.getElementById(id).textContent = value; }
  function errorName(e) { return e && (e.name || e.message) || "Unknown error"; }
  function snapshot() {
    return {
      schemaVersion: 1,
      observedAt: now(),
      tests: tests,
      remoteEvents: remoteEvents.slice()
    };
  }
  function preview() { reportView.textContent = JSON.stringify(snapshot(), null, 2); }

  function storageCheck(area) {
    try {
      var store = window[area];
      var key = "tvscope-phase0-probe";
      store.setItem(key, "ok");
      var passes = store.getItem(key) === "ok";
      store.removeItem(key);
      return passes ? "read_write_ok" : "readback_mismatch";
    } catch (e) { return "blocked: " + errorName(e); }
  }

  function capabilitySurvey() {
    var v = document.createElement("video");
    function codec(type) {
      try { return v.canPlayType(type) || "no"; }
      catch (e) { return "error: " + errorName(e); }
    }
    var ms = window.MediaSource || window.WebKitMediaSource;
    var type = 'video/mp4; codecs="avc1.42E01E"';
    return {
      codecs: {
        h264_mp4: codec('video/mp4; codecs="avc1.42E01E"'),
        h264_aac_mp4: codec('video/mp4; codecs="avc1.42E01E, mp4a.40.2"'),
        vp9_webm: codec('video/webm; codecs="vp9"'),
        av1_mp4: codec('video/mp4; codecs="av01.0.05M.08"'),
        hevc_mp4: codec('video/mp4; codecs="hvc1.1.6.L93.B0"'),
        hls: codec("application/vnd.apple.mpegurl")
      },
      mediaSource: typeof ms !== "undefined",
      mseH264Likely: ms && typeof ms.isTypeSupported === "function" ? ms.isTypeSupported(type) : null
    };
  }

  function environmentSurvey() {
    return {
      userAgent: navigator.userAgent || null,
      platform: navigator.platform || null,
      language: navigator.language || null,
      origin: location.origin,
      secureContext: !!window.isSecureContext,
      viewport: { width: innerWidth, height: innerHeight },
      screen: {
        width: screen.width, height: screen.height,
        colorDepth: screen.colorDepth
      },
      pixelRatio: window.devicePixelRatio || 1,
      onlineHint: navigator.onLine,
      hardwareConcurrencyHint: navigator.hardwareConcurrency || null,
      deviceMemoryRoundedHintGb: navigator.deviceMemory || null,
      maxTouchPoints: navigator.maxTouchPoints || 0,
      featurePresence: {
        fetch: typeof window.fetch === "function",
        WebSocket: typeof window.WebSocket === "function",
        localStorage: "localStorage" in window,
        fullscreen: !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen),
        mediaCapabilities: !!navigator.mediaCapabilities,
        encryptedMediaExtensions: typeof navigator.requestMediaKeySystemAccess === "function",
        serviceWorker: !!navigator.serviceWorker
      }
    };
  }

  async function httpCheck() {
    if (typeof fetch !== "function") return { status: "fetch_api_missing" };
    var measurements = [];
    for (var i = 0; i < 3; i++) {
      var start = timeMs();
      try {
        var res = await fetch("/api/ping?i=" + i + "&t=" + Date.now(), { cache: "no-store" });
        var json = await res.json();
        if (!res.ok || json.pong !== true) throw new Error("bad_ping_response");
        measurements.push(Math.round(timeMs() - start));
      } catch (e) {
        return { status: "failed", error: errorName(e), completedSamples: measurements.length };
      }
    }
    return { status: "reachable", roundTripMs: measurements, transport: "HTTP" };
  }

  function websocketCheck() {
    return new Promise(function (resolve) {
      if (typeof WebSocket !== "function") return resolve({ status: "api_missing" });
      var proto = location.protocol === "https:" ? "wss:" : "ws:";
      var socket = null;
      var finished = false;
      var start = timeMs();
      var id = String(Date.now());
      var timer = setTimeout(function () { done({ status: "timeout" }); }, 4500);
      function done(result) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (socket) try { socket.close(); } catch (_) {}
        resolve(result);
      }
      try {
        socket = new WebSocket(proto + "//" + location.host + "/api/ws");
        socket.onopen = function () {
          socket.send(JSON.stringify({ type: "probe.ping", id: id }));
        };
        socket.onmessage = function (event) {
          try {
            var result = JSON.parse(event.data);
            if (result.type === "probe.pong" && result.id === id) {
              done({ status: "reachable", roundTripMs: Math.round(timeMs() - start) });
            }
          } catch (_) {}
        };
        socket.onerror = function () { done({ status: "error" }); };
        socket.onclose = function () { done({ status: "closed_before_pong" }); };
      } catch (e) { done({ status: "failed", error: errorName(e) }); }
    });
  }

  async function decodingCheck() {
    if (!navigator.mediaCapabilities ||
        typeof navigator.mediaCapabilities.decodingInfo !== "function") {
      return { status: "api_missing" };
    }
    try {
      var result = await navigator.mediaCapabilities.decodingInfo({
        type: "file",
        video: {
          contentType: 'video/mp4; codecs="avc1.42E01E"',
          width: 1280, height: 720, bitrate: 2000000, framerate: 30
        }
      });
      return {
        status: "hint_only",
        supported: !!result.supported,
        smooth: !!result.smooth,
        powerEfficient: !!result.powerEfficient,
        note: "Browser prediction; physical playback must be tested separately"
      };
    } catch (e) { return { status: "failed", reason: errorName(e) }; }
  }

  async function drmCheck() {
    if (!window.isSecureContext) {
      return { status: "not_testable_on_insecure_http", reason: "EME may require HTTPS" };
    }
    if (typeof navigator.requestMediaKeySystemAccess !== "function") {
      return { status: "api_missing" };
    }
    try {
      var access = await navigator.requestMediaKeySystemAccess("com.widevine.alpha", [{
        initDataTypes: ["cenc"],
        videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }]
      }]);
      return { status: "key_system_access_granted", system: access.keySystem,
        note: "Does not prove Netflix or DStv playback or device certification" };
    } catch (e) {
      return { status: "request_rejected", reason: errorName(e),
        note: "Cannot infer streaming certification" };
    }
  }

  async function run() {
    status.textContent = "Running browser and network tests...";
    document.getElementById("run").disabled = true;
    try {
      tests.environment = environmentSurvey();
      tests.storage = {
        localStorage: storageCheck("localStorage"),
        sessionStorage: storageCheck("sessionStorage")
      };
      tests.media = capabilitySurvey();
      tests.media.decodingHint720p = await decodingCheck();
      tests.http = await httpCheck();
      tests.websocket = await websocketCheck();
      tests.drm = await drmCheck();
      status.textContent = "Tests complete. Focus remote test box, then review report.";
      preview();
    } catch (e) {
      status.textContent = "Test error: " + errorName(e);
      preview();
    } finally {
      document.getElementById("run").disabled = false;
    }
  }

  document.getElementById("run").addEventListener("click", run);
  document.getElementById("review").addEventListener("click", preview);

  document.getElementById("fullscreen").addEventListener("click", async function () {
    var el = document.documentElement;
    var request = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!request) {
      tests.fullscreen = { status: "api_missing" };
      setText("status", "Fullscreen API unavailable.");
      return preview();
    }
    try {
      var result = request.call(el);
      if (result && result.then) await result;
      tests.fullscreen = { status: "requested", active: !!(document.fullscreenElement || document.webkitFullscreenElement) };
      setText("status", "Fullscreen request submitted; confirm TV screen appearance.");
    } catch (e) {
      tests.fullscreen = { status: "rejected", reason: errorName(e) };
      setText("status", "Fullscreen rejected: " + errorName(e));
    }
    preview();
  });

  function safeRemoteKey(key) {
    if (/^(ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Enter|Escape|Backspace|BrowserBack|GoBack|Home|MediaPlay|MediaPause|MediaPlayPause|MediaStop|MediaTrack|AudioVolume|Volume|Channel|Select|OK)$/.test(key)) return key;
    return "Other";
  }

  window.addEventListener("keydown", function (e) {
    if (document.activeElement !== keybox) return;
    var key = safeRemoteKey(e.key || "");
    if (document.activeElement === keybox &&
        (key.indexOf("Arrow") === 0 || key === "Enter")) e.preventDefault();
    var rawCode = Number(e.keyCode) || 0;
    var remoteCode = [3, 4, 8, 13, 19, 20, 21, 22, 23, 24, 25, 27, 37, 38, 39, 40,
      66, 82, 85, 86, 87, 88, 89, 90, 126, 127, 166, 167].indexOf(rawCode) >= 0;
    var code = key !== "Other" || remoteCode ? rawCode : 0;
    remoteEvents.push({
      at: now(), key: key, code: key === "Other" ? "not_recorded" : (e.code || ""),
      keyCode: code, repeat: !!e.repeat
    });
    if (remoteEvents.length > maxRemoteEvents) remoteEvents.shift();
    setText("key-status", "Last remote event: " + key + " / keyCode " + code +
      " · captured " + remoteEvents.length);
    preview();
  });
  document.getElementById("clear-keys").addEventListener("click", function () {
    remoteEvents = [];
    setText("key-status", "Remote events cleared.");
    preview();
  });

  var video = document.getElementById("video");
  video.addEventListener("error", function () {
    tests.playback = { status: "failed_or_missing_sample", mediaErrorCode: video.error ? video.error.code : null };
    setText("video-status", "Cannot load/play test MP4. Check phase0/media/test.mp4 and browser codecs.");
    preview();
  });
  video.addEventListener("playing", function () {
    tests.playback = { status: "playing_observed", currentTime: video.currentTime,
      note: "Visual/audio quality requires human confirmation" };
    setText("video-status", "Video playing. Confirm actual picture and audio on TV.");
    preview();
  });
  document.getElementById("video-test").addEventListener("click", function () {
    tests.playback = { status: "loading" };
    video.src = "/sample.mp4?ts=" + Date.now();
    video.load();
    var attempt = video.play();
    if (attempt && attempt.catch) {
      attempt.catch(function (e) {
        tests.playback = { status: "play_rejected", reason: errorName(e) };
        setText("video-status", "Playback blocked or failed: " + errorName(e));
        preview();
      });
    }
    setText("video-status", "Loading local sample...");
    preview();
  });

  document.getElementById("send").addEventListener("click", async function () {
    preview();
    if (typeof fetch !== "function") {
      setText("send-status", "Browser fetch API missing. Cannot submit report.");
      return;
    }
    try {
      var response = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot())
      });
      var data = await response.json();
      setText("send-status", response.ok ?
        "Report submitted to PC. ID: " + data.id :
        "Report rejected: " + (data.error || response.status));
    } catch (e) {
      setText("send-status", "Submit failed: " + errorName(e));
    }
  });

  preview();
})();
