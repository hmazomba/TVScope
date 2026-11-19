(function () {
  "use strict";
  var csrf = null;
  var reports = [];
  function el(id) { return document.getElementById(id); }
  function put(id, text) { el(id).textContent = text; }
  async function api(route, method, payload, mutate) {
    var headers = {};
    if (payload !== undefined) headers["Content-Type"] = "application/json";
    if (mutate && csrf) headers["X-TVScope-CSRF"] = csrf;
    var response = await fetch(route, {
      method: method || "GET", credentials: "same-origin",
      headers: headers, cache: "no-store",
      body: payload === undefined ? undefined : JSON.stringify(payload)
    });
    var data = await response.json();
    if (!response.ok) throw new Error(data.error || "HTTP " + response.status);
    return data;
  }
  function showAdmin() {
    el("login-panel").hidden = true;
    el("admin-panel").hidden = false;
  }
  async function resumeAdmin() {
    try {
      var result = await api("/api/v1/admin/me");
      csrf = result.csrf;
      showAdmin();
      await refresh();
    } catch (_) {
      put("login-status", "Enter admin passphrase configured on PC.");
    }
  }
  el("login").addEventListener("click", async function () {
    var password = el("password").value;
    el("password").value = "";
    try {
      var result = await api("/api/v1/admin/login", "POST", { password: password });
      csrf = result.csrf;
      showAdmin();
      await refresh();
    } catch (e) { put("login-status", "Login failed: " + e.message); }
  });

  function buildOptions(select, records, label) {
    var previous = select.value;
    select.replaceChildren();
    records.forEach(function (record) {
      var option = document.createElement("option");
      option.value = record.id;
      option.textContent = label(record);
      select.appendChild(option);
    });
    if (records.some(function (record) { return record.id === previous; })) {
      select.value = previous;
    }
  }
  async function refresh() {
    try {
      var pending = await api("/api/v1/admin/pairings");
      var devices = await api("/api/v1/admin/devices");
      buildOptions(el("pending"), pending.pairings, function (p) {
        return p.observedIp + " / " + p.id.slice(0, 8) + " / until " + p.expiresAt;
      });
      buildOptions(el("device"), devices.devices.filter(function (d) {
        return !d.revokedAt;
      }), function (d) {
        return d.label + " / " + d.id.slice(0, 8) +
          (d.connected ? " [online]" : " [offline]");
      });
      put("device-json", JSON.stringify(devices, null, 2));
      put("pair-status", pending.pairings.length + " pending pairing(s).");
      put("device-status", devices.devices.length + " device(s) recorded.");
    } catch (e) { put("device-status", "Refresh failed: " + e.message); }
  }
  el("refresh").addEventListener("click", refresh);
  el("approve").addEventListener("click", async function () {
    var id = el("pending").value;
    var code = el("pair-code").value.trim();
    if (!id || !/^[0-9]{6}$/.test(code)) {
      return put("pair-status", "Select pending request and enter six-digit TV code.");
    }
    try {
      await api("/api/v1/admin/pairings/approve", "POST", {
        id: id, code: code, label: el("pair-label").value
      }, true);
      el("pair-code").value = "";
      put("pair-status", "Pairing approved. TV will claim session.");
      await refresh();
    } catch (e) { put("pair-status", "Approve failed: " + e.message); }
  });
  el("send-notice").addEventListener("click", async function () {
    if (!el("device").value) return put("device-status", "Choose paired device.");
    try {
      var result = await api("/api/v1/admin/devices/notice", "POST", {
        id: el("device").value, message: el("notice-input").value
      }, true);
      put("device-status", "Delivered to " + result.deliveredToConnections + " active connection(s).");
    } catch (e) { put("device-status", "Notice failed: " + e.message); }
  });
  el("revoke").addEventListener("click", async function () {
    var id = el("device").value;
    if (!id) return put("device-status", "Select device.");
    if (!confirm("Revoke selected TV? It must pair again to reconnect.")) return;
    try {
      await api("/api/v1/admin/devices/revoke", "POST", { id: id }, true);
      put("device-status", "Device revoked.");
      await refresh();
    } catch (e) { put("device-status", "Revoke failed: " + e.message); }
  });
  async function refreshReports() {
    try {
      var result = await api("/api/v1/admin/reports");
      reports = result.reports;
      put("report-json", JSON.stringify(reports, null, 2));
      put("report-status", reports.length + " reports stored.");
    } catch (e) { put("report-status", "Report refresh failed: " + e.message); }
  }
  el("refresh-reports").addEventListener("click", refreshReports);
  el("export").addEventListener("click", function () {
    var blob = new Blob([JSON.stringify(reports, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "tvscope-phase1-reports.json";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });
  resumeAdmin();
})();
