/**
 * WZ Module: Wayback CDX Archiving Frequency renderer.
 */
(function() {
"use strict";
var WZ = window.WZ;
var t = window._t || function(k, fb) { return fb; };

var _wbfChart = null;

function _renderWaybackCDXLive(data) {
  var daily = data.daily || [];
  var total = data.count || 0;

  document.getElementById("wz-live-count").textContent =
    total + " " + t("wz_wbf_snapshots", "Snapshots") +
    " \u00b7 " + (data.days_with_data || 0) + " " + t("wz_wbf_days", "days");

  if (WZ._liveMarkers) WZ._liveMarkers.clearLayers();

  var content = document.getElementById("wz-live-content");

  if (data.error) {
    content.innerHTML = '<div style="padding:24px;text-align:center;color:#ef4444;">' + _esc(data.error) + '</div>';
    return;
  }

  var dateFrom = data.date_from || "";
  var dateTo = data.date_to || "";

  var html = '<div style="padding:12px 16px;overflow-y:auto;">';

  // Date range picker + URL
  html += '<div style="margin-bottom:10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">';
  html += '<div style="flex:1;min-width:200px;padding:6px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;">';
  html += '<span style="font-size:11px;color:var(--muted);">URL:</span> ';
  html += '<span style="font-size:12px;font-family:monospace;color:var(--text);word-break:break-all;">' + _esc(data.url || "?") + '</span>';
  html += '</div>';
  html += '<div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">';
  html += '<input type="date" id="wbf-date-from" value="' + _esc(dateFrom) + '" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);">';
  html += '<span style="color:var(--muted);font-size:11px;">\u2013</span>';
  html += '<input type="date" id="wbf-date-to" value="' + _esc(dateTo) + '" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);">';
  html += '<button id="wbf-reload-btn" onclick="wbfReloadRange()" style="font-size:11px;font-weight:600;padding:4px 10px;border:1px solid var(--accent1);border-radius:6px;background:var(--accent1);color:#fff;cursor:pointer;white-space:nowrap;">' + t("wz_wbf_apply","Apply") + '</button>';
  html += '</div></div>';

  // Stats row
  html += '<div style="margin-bottom:10px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 14px;">';
  html += '<div style="display:flex;gap:20px;flex-wrap:wrap;align-items:center;">';
  html += '<div style="text-align:center;">' +
    '<div style="font-size:22px;font-weight:800;color:#06b6d4;">' + total.toLocaleString() + '</div>' +
    '<div style="font-size:10px;color:var(--muted);text-transform:uppercase;">' + t("wz_wbf_total","Total") + '</div></div>';
  html += '<div style="text-align:center;">' +
    '<div style="font-size:16px;font-weight:700;color:var(--text);">' + (data.daily_avg || 0) + '</div>' +
    '<div style="font-size:10px;color:var(--muted);text-transform:uppercase;">' + t("wz_wbf_daily_avg","\u2300/day") + '</div></div>';
  if (data.peak > 0) {
    html += '<div style="text-align:center;">' +
      '<div style="font-size:16px;font-weight:700;color:#ef4444;">' + data.peak + '</div>' +
      '<div style="font-size:10px;color:var(--muted);">' + t("wz_wbf_peak","Peak") + ' ' + (data.peak_date||"").slice(5) + '</div></div>';
  }
  if (data.first_date) {
    html += '<div style="text-align:center;">' +
      '<div style="font-size:13px;font-weight:600;color:var(--muted);">' + _esc(data.first_date) + '</div>' +
      '<div style="font-size:10px;color:var(--muted);">' + t("wz_wbf_first","First") + '</div></div>';
  }
  if (data.last_date) {
    html += '<div style="text-align:center;">' +
      '<div style="font-size:13px;font-weight:600;color:var(--muted);">' + _esc(data.last_date) + '</div>' +
      '<div style="font-size:10px;color:var(--muted);">' + t("wz_wbf_last","Last") + '</div></div>';
  }
  html += '</div></div>';

  // Chart
  if (daily.length > 2) {
    html += '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 14px;">';
    html += '<div style="font-size:12px;font-weight:600;margin-bottom:6px;">' + t("wz_wbf_header","Archiving frequency") + '</div>';
    html += '<canvas id="wbf-chart" width="600" height="160" style="width:100%;height:160px;"></canvas>';
    html += '</div>';
  }

  if (!daily.length) {
    html += '<div style="padding:16px;text-align:center;color:var(--muted);font-size:12px;">' +
      t("wz_wbf_empty","No Wayback snapshots for this URL.") + '</div>';
  }

  html += '</div>';
  content.innerHTML = html;

  // Render chart
  _renderChart(daily, total);
}

function _renderChart(daily, total) {
  if (!window.Chart || daily.length < 3) return;
  var canvas = document.getElementById("wbf-chart");
  if (!canvas) return;

  if (_wbfChart) { _wbfChart.destroy(); _wbfChart = null; }

  var labels = daily.map(function(d) { return d.date; });
  var values = daily.map(function(d) { return d.count; });
  var avg = total / Math.max(daily.length, 1);
  var avgLine = values.map(function() { return Math.round(avg * 10) / 10; });

  _wbfChart = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels: labels,
      datasets: [
        {
          label: t("wz_wbf_snapshots","Snapshots") + "/Tag",
          data: values,
          backgroundColor: values.map(function(v) { return v > avg * 3 ? "#ef444480" : "#06b6d460"; }),
          borderColor: values.map(function(v) { return v > avg * 3 ? "#ef4444" : "#06b6d4"; }),
          borderWidth: 1,
        },
        {
          label: t("wz_wbf_daily_avg","\u2300/day"),
          data: avgLine,
          type: "line",
          borderColor: "#64748b",
          borderWidth: 1,
          borderDash: [5, 5],
          pointRadius: 0,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: true, labels: { font: { size: 10 }, boxWidth: 10 } } },
      scales: {
        x: { ticks: { maxTicksLimit: 12, font: { size: 9 }, color: "#888" }, grid: { display: false } },
        y: { min: 0, ticks: { font: { size: 9 }, color: "#888", stepSize: 1 }, grid: { color: "rgba(100,100,100,.1)" } },
      },
      interaction: { intersect: false, mode: "index" },
    },
  });
}

// Reload with new date range
window.wbfReloadRange = async function() {
  var fromEl = document.getElementById("wbf-date-from");
  var toEl = document.getElementById("wbf-date-to");
  if (!fromEl || !toEl) return;
  var dateFrom = fromEl.value;
  var dateTo = toEl.value;
  if (!dateFrom || !dateTo) return;

  var zoneId = WZ._liveZoneId;
  if (!zoneId) return;

  var btn = document.getElementById("wbf-reload-btn");
  if (btn) { btn.disabled = true; btn.textContent = "\u2026"; }

  try {
    var asType = WZ._liveAsType ? "&as_type=" + WZ._liveAsType : "";
    var url = "/api/watchzones/" + zoneId + "/live?from=" + encodeURIComponent(dateFrom) + "&to=" + encodeURIComponent(dateTo) + asType;
    var r = await fetch(url);
    var data = await r.json();
    if (r.ok) _renderWaybackCDXLive(data);
    else alert(data.error || "Error");
  } catch(e) {
    alert(e.message || "Error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = t("wz_wbf_apply","Apply"); }
  }
};

function _esc(s) {
  if (!s) return "";
  var d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

WZ.registerPlugin("wayback_cdx", {
  renderer: _renderWaybackCDXLive,
  has_map: false,
  has_live_map: false,
  live_box_max_width: "800px",
  live_box_height: "auto",
  default_source: "wayback",
});

})();
