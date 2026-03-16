/**
 * WZ Module: Bluesky Keyword Monitor renderer.
 */
(function() {
"use strict";
var WZ = window.WZ;
var t = window._t || function(k, fb) { return fb; };

var BS_COLORS = ["#0085ff", "#38bdf8", "#818cf8", "#34d399", "#a78bfa"];

function _renderBlueskyMonitorLive(data) {
  var results = data.results || [];
  var keywords = data.keywords || [];
  var totalAll = data.count || 0;
  var days = data.days || 180;

  document.getElementById("wz-live-count").textContent =
    totalAll.toLocaleString() + " " + t("wz_bsm_total", "Total") +
    " \u00b7 " + keywords.length + " " + t("wz_bsm_keywords", "Keywords") +
    " \u00b7 " + days + " " + t("wz_bsm_days", "days");

  if (WZ._liveMarkers) WZ._liveMarkers.clearLayers();

  var content = document.getElementById("wz-live-content");

  if (data.error) {
    content.innerHTML = '<div style="padding:24px;text-align:center;color:#ef4444;">' + _esc(data.error) + '</div>';
    return;
  }

  var html = '<div style="padding:12px 16px;max-height:70vh;overflow-y:auto;">';

  // Stats cards per keyword
  html += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;">';
  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    var color = BS_COLORS[i % BS_COLORS.length];
    var total = r.total || 0;
    var series = r.series || [];
    var dailyAvg = series.length ? Math.round(total / series.length) : 0;
    var peak = 0, peakDate = "";
    for (var s = 0; s < series.length; s++) {
      if (series[s].count > peak) { peak = series[s].count; peakDate = series[s].date; }
    }

    html += '<div style="flex:1;min-width:140px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 14px;border-left:3px solid ' + color + ';">';
    html += '<div style="font-size:13px;font-weight:700;color:' + color + ';margin-bottom:6px;">' + _esc(r.term || "?") + '</div>';
    if (r.error) {
      html += '<div style="font-size:11px;color:#ef4444;">' + _esc(r.error) + '</div>';
    } else {
      html += '<div style="display:flex;gap:12px;flex-wrap:wrap;">';
      html += '<div><div style="font-size:18px;font-weight:800;color:var(--text);">' + total.toLocaleString() + '</div>' +
              '<div style="font-size:9px;color:var(--muted);">' + t("wz_bsm_total","Total") + '</div></div>';
      html += '<div><div style="font-size:14px;font-weight:700;color:var(--muted);">' + dailyAvg + '</div>' +
              '<div style="font-size:9px;color:var(--muted);">' + t("wz_bsm_daily_avg","\u2300/day") + '</div></div>';
      if (peak > 0) {
        html += '<div><div style="font-size:14px;font-weight:700;color:#ef4444;">' + peak + '</div>' +
                '<div style="font-size:9px;color:var(--muted);">' + t("wz_bsm_peak","Peak") + ' ' + peakDate.slice(5) + '</div></div>';
      }
      html += '</div>';
    }
    html += '</div>';
  }
  html += '</div>';

  // Combined chart
  if (results.some(function(r) { return r.series && r.series.length > 1; })) {
    html += '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 16px;margin-bottom:14px;">';
    html += '<div style="font-size:12px;font-weight:600;margin-bottom:8px;">' + t("wz_bsm_header","Posts (180 days)") + '</div>';
    html += '<canvas id="bsm-chart" width="600" height="180" style="width:100%;height:180px;"></canvas>';
    html += '</div>';
  }

  if (!results.length || totalAll === 0) {
    html += '<div style="padding:20px;text-align:center;color:var(--muted);font-size:12px;">' +
      t("wz_bsm_empty","No results for these keywords.") + '</div>';
  }

  html += '</div>';
  content.innerHTML = html;

  // Render chart
  if (window.Chart && results.some(function(r) { return r.series && r.series.length > 1; })) {
    var canvas = document.getElementById("bsm-chart");
    if (!canvas) return;

    var allDates = {};
    results.forEach(function(r) {
      (r.series || []).forEach(function(pt) { allDates[pt.date] = true; });
    });
    var labels = Object.keys(allDates).sort();

    var datasets = results.map(function(r, idx) {
      var color = BS_COLORS[idx % BS_COLORS.length];
      var dateMap = {};
      (r.series || []).forEach(function(pt) { dateMap[pt.date] = pt.count; });
      return {
        label: r.term || "?",
        data: labels.map(function(d) { return dateMap[d] || 0; }),
        borderColor: color,
        backgroundColor: color + "30",
        borderWidth: 1.5,
        pointRadius: labels.length > 60 ? 0 : 2,
        pointHoverRadius: 4,
        fill: true,
        tension: 0.3,
      };
    });

    new Chart(canvas.getContext("2d"), {
      type: "line",
      data: { labels: labels, datasets: datasets },
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
}

function _esc(s) {
  if (!s) return "";
  var d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

WZ.registerPlugin("bluesky_monitor", {
  renderer: _renderBlueskyMonitorLive,
  has_map: false,
  has_live_map: false,
  default_source: "bluesky",
});

})();
