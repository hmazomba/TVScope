(function () {
  "use strict";
  var reports = [];
  function status(text) { document.getElementById("status").textContent = text; }
  async function refresh() {
    try {
      var response = await fetch("/api/reports", { cache: "no-store" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      var result = await response.json();
      reports = result.reports || [];
      status(reports.length + " reports in memory. Refresh after TV submits.");
      document.getElementById("results").textContent = JSON.stringify(reports, null, 2);
    } catch (e) { status("Cannot read reports: " + e.message); }
  }
  document.getElementById("refresh").addEventListener("click", refresh);
  document.getElementById("export").addEventListener("click", function () {
    var blob = new Blob([JSON.stringify(reports, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "tvscope-phase0-reports.json";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });
  document.getElementById("clear").addEventListener("click", async function () {
    if (!confirm("Permanently clear all in-memory diagnostic reports?")) return;
    try {
      var response = await fetch("/api/reports", { method: "DELETE" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      await refresh();
    } catch (e) { status("Clear failed: " + e.message); }
  });
  refresh();
})();
