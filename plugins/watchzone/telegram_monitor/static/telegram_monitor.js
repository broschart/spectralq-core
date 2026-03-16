/**
 * WZ Module: Telegram Keyword Monitor renderer.
 */
(function() {
"use strict";
var WZ = window.WZ;
var t = window._t || function(k, fb) { return fb; };

var TG_COLORS = ["#0088cc", "#29b6f6", "#5c6bc0", "#26a69a", "#7e57c2"];

function _renderTelegramMonitorLive(data) {
  var results = data.results || [];
  var keywords = data.keywords || [];
  var totalAll = data.count || 0;
  var days = data.days || 90;

  document.getElementById("wz-live-count").textContent =
    totalAll.toLocaleString() + " " + t("wz_tgm_total", "Total") +
    " \u00b7 " + keywords.length + " " + t("wz_tgm_keywords", "Keywords") +
    " \u00b7 " + days + " " + t("wz_tgm_days", "days");

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
    var color = TG_COLORS[i % TG_COLORS.length];
    var total = r.total || 0;
    var series = r.series || [];
    var dailyAvg = series.length ? Math.round(total / series.length) : 0;
    var peak = 0, peakDate = "";
    for (var s = 0; s < series.length; s++) {
      if (series[s].count > peak) { peak = series[s].count; peakDate = series[s].date; }
    }

    html += '<div style="flex:1;min-width:140px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 14px;border-left:3px solid ' + color + ';">';
    html += '<div style="font-size:13px;font-weight:700;color:' + color + ';margin-bottom:6px;">' + _esc(r.term || "?") + '</div>';
    html += '<div style="display:flex;gap:12px;flex-wrap:wrap;">';
    html += '<div><div style="font-size:18px;font-weight:800;color:var(--text);">' + total.toLocaleString() + '</div>' +
            '<div style="font-size:9px;color:var(--muted);">' + t("wz_tgm_total","Total") + '</div></div>';
    html += '<div><div style="font-size:14px;font-weight:700;color:var(--muted);">' + dailyAvg + '</div>' +
            '<div style="font-size:9px;color:var(--muted);">' + t("wz_tgm_daily_avg","⌀/day") + '</div></div>';
    if (peak > 0) {
      html += '<div><div style="font-size:14px;font-weight:700;color:#ef4444;">' + peak + '</div>' +
              '<div style="font-size:9px;color:var(--muted);">' + t("wz_tgm_peak","Peak") + ' ' + peakDate.slice(5) + '</div></div>';
    }
    html += '</div></div>';
  }
  html += '</div>';

  // Combined chart
  if (results.some(function(r) { return r.series && r.series.length > 1; })) {
    html += '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 16px;margin-bottom:14px;">';
    html += '<div style="font-size:12px;font-weight:600;margin-bottom:8px;">' + t("wz_tgm_header","Mentions (90 days)") + '</div>';
    html += '<canvas id="tgm-chart" width="600" height="180" style="width:100%;height:180px;"></canvas>';
    html += '</div>';
  }

  // No results message
  if (!results.length || totalAll === 0) {
    html += '<div style="padding:20px;text-align:center;color:var(--muted);font-size:12px;">' +
      t("wz_tgm_empty","No results for these keywords.") + '</div>';
  }

  html += '</div>';
  content.innerHTML = html;

  // Render chart
  if (window.Chart && results.some(function(r) { return r.series && r.series.length > 1; })) {
    var canvas = document.getElementById("tgm-chart");
    if (!canvas) return;

    // Build unified date labels
    var allDates = {};
    results.forEach(function(r) {
      (r.series || []).forEach(function(pt) { allDates[pt.date] = true; });
    });
    var labels = Object.keys(allDates).sort();

    var datasets = results.map(function(r, idx) {
      var color = TG_COLORS[idx % TG_COLORS.length];
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

WZ.registerPlugin("telegram_monitor", {
  renderer: _renderTelegramMonitorLive,
  has_map: false,
  has_live_map: false,
  default_source: "telegram",
});

})();
