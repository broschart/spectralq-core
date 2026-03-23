/**
 * WZ Module: ENTSO-E Power Grid renderer.
 */
(function() {
"use strict";
var WZ = window.WZ;
var t = window._t || function(k, fb) { return fb; };

function _renderPowerGridLive(data) {
  var series = data.series || [];
  var country = data.country || "?";
  var current = data.current_mw;
  var avg = data.avg_mw;
  var anomaly = data.anomaly;

  document.getElementById("wz-live-count").textContent =
    t("wz_pg_load","Grid Load") + " " + country +
    (current != null ? " \u2013 " + _fmtMW(current) : "");

  // No map markers for power grid — it's country-level
  if (WZ._liveMarkers) WZ._liveMarkers.clearLayers();

  var content = document.getElementById("wz-live-content");
  var html = '<div style="padding:12px 16px;">';

  // Anomaly alert
  if (anomaly) {
    html += '<div style="margin-bottom:12px;background:rgba(220,38,38,.08);border:1px solid rgba(220,38,38,.3);' +
      'border-radius:10px;padding:12px 16px;">' +
      '<div style="font-size:14px;font-weight:700;color:#dc2626;">\u26a0 Lasteinbruch erkannt: -' +
      anomaly.drop_pct + '% unter Durchschnitt</div>' +
      '<div style="font-size:12px;color:var(--muted);margin-top:4px;">' +
      t("wz_pg_current","Current") + ': ' + _fmtMW(anomaly.current) +
      ' \u2014 ' + t("wz_pg_avg","Average") + ': ' + _fmtMW(anomaly.avg) + '</div>' +
      '</div>';
  }

  // Stats
  html += '<div style="margin-bottom:12px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 16px;">';
  html += '<div style="display:flex;gap:20px;flex-wrap:wrap;align-items:center;">';
  html += '<div style="text-align:center;">' +
    '<div style="font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;margin-bottom:2px;">' + t("wz_pg_country","Country") + '</div>' +
    '<div style="font-size:28px;font-weight:800;color:var(--text);">' + _esc(country) + '</div></div>';
  if (current != null) {
    var curColor = anomaly ? "#dc2626" : "#22c55e";
    html += '<div style="text-align:center;">' +
      '<div style="font-size:10px;color:var(--muted);text-transform:uppercase;">' + t("wz_pg_current","Current") + '</div>' +
      '<div style="font-size:24px;font-weight:800;color:' + curColor + ';">' + _fmtMW(current) + '</div></div>';
  }
  if (avg != null) {
    html += '<div style="text-align:center;">' +
      '<div style="font-size:10px;color:var(--muted);text-transform:uppercase;">' + t("wz_pg_avg","Average (24h)") + '</div>' +
      '<div style="font-size:20px;font-weight:700;color:var(--text);">' + _fmtMW(avg) + '</div></div>';
  }
  if (data.min_mw != null) {
    html += '<div style="text-align:center;">' +
      '<div style="font-size:10px;color:var(--muted);text-transform:uppercase;">' + t("wz_pg_min","Minimum") + '</div>' +
      '<div style="font-size:18px;font-weight:700;color:#3b82f6;">' + _fmtMW(data.min_mw) + '</div></div>';
  }
  if (data.max_mw != null) {
    html += '<div style="text-align:center;">' +
      '<div style="font-size:10px;color:var(--muted);text-transform:uppercase;">' + t("wz_pg_max","Maximum") + '</div>' +
      '<div style="font-size:18px;font-weight:700;color:#f59e0b;">' + _fmtMW(data.max_mw) + '</div></div>';
  }
  html += '</div></div>';

  // 48h chart
  if (series.length > 2) {
    html += '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 16px;">';
    html += '<div style="font-size:12px;font-weight:600;margin-bottom:8px;">' + t("wz_pg_chart_title","Grid Load 48h") + '</div>';
    html += '<canvas id="pg-chart" width="600" height="200" style="width:100%;height:200px;"></canvas>';
    html += '</div>';
  }

  html += '</div>';
  content.innerHTML = html;

  // Draw chart
  if (series.length > 2 && window.Chart) {
    var canvas = document.getElementById("pg-chart");
    if (canvas) {
      var labels = series.map(function(p) { return p.time ? p.time.slice(5, 16).replace("T"," ") : ""; });
      var values = series.map(function(p) { return p.value; });
      var avgLine = values.map(function() { return avg; });

      new Chart(canvas.getContext("2d"), {
        type: "line",
        data: {
          labels: labels,
          datasets: [
            {
              label: t("wz_pg_load","Grid Load") + " (MW)",
              data: values,
              borderColor: anomaly ? "#dc2626" : "#f59e0b",
              backgroundColor: (anomaly ? "#dc262620" : "#f59e0b20"),
              borderWidth: 1.5,
              pointRadius: 0,
              pointHoverRadius: 3,
              fill: true,
              tension: 0.3,
            },
            {
              label: t("wz_pg_avg","Average"),
              data: avgLine,
              borderColor: "#64748b",
              borderWidth: 1,
              borderDash: [5, 5],
              pointRadius: 0,
              fill: false,
            }
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: true, labels: { font: { size: 10 }, boxWidth: 12 } } },
          scales: {
            x: {
              display: true,
              ticks: { maxTicksLimit: 12, font: { size: 9 }, color: "#888" },
              grid: { display: false },
            },
            y: {
              display: true,
              ticks: { font: { size: 9 }, color: "#888", callback: function(v) { return _fmtMW(v); } },
              grid: { color: "rgba(100,100,100,.1)" },
            },
          },
          interaction: { intersect: false, mode: "index" },
        },
      });
    }
  }
}

function _fmtMW(v) {
  if (v == null) return "–";
  if (v >= 1000) return (v / 1000).toFixed(1) + " GW";
  return Math.round(v) + " MW";
}

function _esc(s) {
  if (!s) return "";
  var d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

WZ.registerPlugin("powergrid", {
  renderer: _renderPowerGridLive,
  has_map: true,
  has_live_map: false,
  default_source: "entsoe",
});

// Collect Renderer
WZ._collectRenderers["powergrid"] = {
  renderHTML: function(data, cardId) {
    var h = "";
    h += '<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:10px;">';
    if (data.current_mw != null) h += '<div style="text-align:center;"><div style="font-size:22px;font-weight:800;color:#f59e0b;">' + Math.round(data.current_mw).toLocaleString() + '</div><div style="font-size:9px;color:var(--muted);">Aktuell (MW)</div></div>';
    if (data.avg_mw != null) h += '<div style="text-align:center;"><div style="font-size:22px;font-weight:800;color:var(--text);">' + Math.round(data.avg_mw).toLocaleString() + '</div><div style="font-size:9px;color:var(--muted);">\u00d8 (MW)</div></div>';
    if (data.min_mw != null) h += '<div style="text-align:center;"><div style="font-size:18px;font-weight:700;color:#22c55e;">' + Math.round(data.min_mw).toLocaleString() + '</div><div style="font-size:9px;color:var(--muted);">Min</div></div>';
    if (data.max_mw != null) h += '<div style="text-align:center;"><div style="font-size:18px;font-weight:700;color:#ef4444;">' + Math.round(data.max_mw).toLocaleString() + '</div><div style="font-size:9px;color:var(--muted);">Max</div></div>';
    h += '</div>';
    if (data.anomaly) h += '<div style="padding:6px 10px;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);border-radius:6px;margin-bottom:8px;font-size:11px;color:#ef4444;">\u26a0 Anomalie erkannt</div>';
    if (data.series && data.series.length) {
      h += '<div style="position:relative;height:160px;margin-bottom:8px;"><canvas id="' + cardId + '-pg-chart"></canvas></div>';
    }
    if (data.country) h += '<div style="font-size:10px;color:var(--muted);">Land: ' + WZ._esc(data.country) + (data.domain ? ' \u2014 ' + WZ._esc(data.domain) : '') + '</div>';
    return h;
  },
  afterRender: function(data, cardId, cardEl) {
    if (!window.Chart || !data.series || !data.series.length) return;
    var fmtD = WZ._fmtDate || function(s) { return s ? String(s).slice(0,10) : ""; };
    var canvas = document.getElementById(cardId + "-pg-chart");
    if (!canvas) return;
    var labels = data.series.map(function(s) { return fmtD(s.date || s.time); });
    var values = data.series.map(function(s) { return s.value || s.load || s.mw; });
    new Chart(canvas.getContext("2d"), {
      type: "line", data: { labels: labels, datasets: [{ label: "Last (MW)", data: values, borderColor: "#f59e0b", borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.3 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
        scales: { x: { ticks: { font: { size: 8 }, color: "#888", maxTicksLimit: 8 }, grid: { display: false } }, y: { ticks: { font: { size: 8 }, color: "#888" }, grid: { color: "rgba(100,100,100,.1)" }, title: { display: true, text: "MW", color: "#f59e0b", font: { size: 10 } } } },
        interaction: { intersect: false, mode: "index" } }
    });
  }
};

})();
