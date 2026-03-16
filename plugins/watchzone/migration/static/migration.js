/**
 * WZ Module: UNHCR Migration & Displacement renderer — side panel layout.
 */
(function() {
"use strict";
var WZ = window.WZ;
var t = window._t || function(k, fb) { return fb; };

var _COLORS = ["#8b5cf6","#3b82f6","#ef4444","#22c55e","#f59e0b","#06b6d4","#ec4899","#f97316","#14b8a6","#a855f7"];

function _renderMigrationLive(data) {
  var countries = data.countries || [];

  document.getElementById("wz-live-count").textContent =
    countries.length + " " + t("wz_mig_country", "Country") +
    (countries.length !== 1 ? "s" : "");

  if (WZ._liveMarkers) WZ._liveMarkers.clearLayers();

  // ── Layout: Charts links volle Höhe, Länderinfos rechts ──
  var liveBox = document.getElementById("wz-live-box");
  if (liveBox) {
    liveBox.style.display = "flex";
    liveBox.style.flexDirection = "column";
    liveBox.style.height = "95vh";
    liveBox.style.maxHeight = "95vh";
    liveBox.style.maxWidth = "1400px";
  }
  // Karte ausblenden, Map-Row als Chart-Container nutzen
  var mapRow = document.getElementById("wz-map-row");
  if (mapRow) { mapRow.style.display = "none"; }
  ["wz-under-map-bar","wz-resize-map","wz-live-sticky"].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.style.display = "none";
  });

  // Body als Hauptcontainer nutzen (flex horizontal)
  var body = document.getElementById("wz-live-body");
  if (body) {
    body.style.display = "flex";
    body.style.flexDirection = "row";
    body.style.flex = "1";
    body.style.minHeight = "0";
    body.style.padding = "0";
  }
  var contentEl = document.getElementById("wz-live-content");
  if (contentEl) {
    contentEl.style.display = "flex";
    contentEl.style.flex = "1";
    contentEl.style.minWidth = "0";
    contentEl.style.flexDirection = "column";
    contentEl.style.height = "100%";
    contentEl.style.padding = "0";
  }
  var loadingEl = document.getElementById("wz-live-loading");
  if (loadingEl) loadingEl.style.display = "none";

  if (!countries.length) {
    contentEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);">' +
      t("wz_mig_empty", "No migration data for this region.") + '</div>';
    return;
  }

  // ── Charts (linke Seite, volle Breite) ──
  var chartsHtml = '<div style="flex:1;display:flex;flex-direction:column;padding:14px;gap:14px;min-width:0;overflow-y:auto;">';

  var hasRefSeries = countries.some(function(c) { return (c.asylum_series || []).length > 2; });
  if (hasRefSeries && window.Chart) {
    chartsHtml += '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px;flex:1;min-height:180px;display:flex;flex-direction:column;">';
    chartsHtml += '<div style="font-size:12px;font-weight:700;margin-bottom:8px;flex-shrink:0;">' +
      t("wz_mig_trend_refugees", "Refugees \u2014 10-Year Trend") + '</div>';
    chartsHtml += '<div style="position:relative;flex:1;min-height:0;"><canvas id="mig-chart-refugees"></canvas></div>';
    chartsHtml += '</div>';
  }

  var hasAsylSeries = countries.some(function(c) {
    return (c.asylum_series || []).some(function(d) { return d.asylum_seekers > 0; });
  });
  if (hasAsylSeries && window.Chart) {
    chartsHtml += '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px;flex:1;min-height:180px;display:flex;flex-direction:column;">';
    chartsHtml += '<div style="font-size:12px;font-weight:700;margin-bottom:8px;flex-shrink:0;">' +
      t("wz_mig_trend_asylum", "Asylum Seekers \u2014 10-Year Trend") + '</div>';
    chartsHtml += '<div style="position:relative;flex:1;min-height:0;"><canvas id="mig-chart-asylum"></canvas></div>';
    chartsHtml += '</div>';
  }

  chartsHtml += '</div>';
  contentEl.innerHTML = chartsHtml;

  // ── Seitenpanel rechts (Länderkarten) ──
  var panel = document.getElementById("mig-side-panel");
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "mig-side-panel";
    panel.style.cssText = "width:380px;flex-shrink:0;border-left:1px solid var(--border);background:var(--surface);display:flex;flex-direction:column;overflow:hidden;";
    body.appendChild(panel);
  }
  panel.style.display = "flex";

  var panelHtml = '';
  // Header
  panelHtml += '<div style="padding:10px 14px;border-bottom:2px solid var(--border);font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;flex-shrink:0;">' +
    t("wz_mig_countries", "Countries") + ' (' + countries.length + ')</div>';
  // Scrollbare Liste
  panelHtml += '<div style="flex:1;overflow-y:auto;min-height:0;">';

  for (var ci = 0; ci < countries.length; ci++) {
    var c = countries[ci];
    var la = c.latest_as_asylum || {};
    var lo = c.latest_as_origin || {};
    var clr = _COLORS[ci % _COLORS.length];

    panelHtml += '<div style="padding:10px 14px;border-bottom:1px solid var(--border);border-left:3px solid ' + clr + ';">';
    // Country name
    panelHtml += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">';
    panelHtml += '<span style="font-size:13px;font-weight:800;color:var(--text);">' + _esc(c.iso3) + '</span>';
    panelHtml += '<span style="font-size:11px;color:var(--muted);">' + _esc(c.name) + '</span>';
    panelHtml += '</div>';

    // Host stats
    panelHtml += '<div style="font-size:9px;color:var(--muted);text-transform:uppercase;margin-bottom:3px;">' +
      t("wz_mig_as_asylum", "As host country") + '</div>';
    panelHtml += '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:6px;">';
    if (la.refugees) panelHtml += '<div><span style="font-size:14px;font-weight:800;color:#8b5cf6;">' + _fmtN(la.refugees) + '</span> <span style="font-size:9px;color:var(--muted);">' + t("wz_mig_refugees","Ref.") + '</span></div>';
    if (la.asylum_seekers) panelHtml += '<div><span style="font-size:14px;font-weight:800;color:#3b82f6;">' + _fmtN(la.asylum_seekers) + '</span> <span style="font-size:9px;color:var(--muted);">' + t("wz_mig_asylum","Asyl.") + '</span></div>';
    if (la.idps) panelHtml += '<div><span style="font-size:14px;font-weight:800;color:#ea580c;">' + _fmtN(la.idps) + '</span> <span style="font-size:9px;color:var(--muted);">IDPs</span></div>';
    if (la.stateless) panelHtml += '<div><span style="font-size:12px;font-weight:700;color:#64748b;">' + _fmtN(la.stateless) + '</span> <span style="font-size:9px;color:var(--muted);">' + t("wz_mig_stateless","Stateless") + '</span></div>';
    panelHtml += '</div>';

    // Origin stats
    if (lo.refugees || lo.asylum_seekers) {
      panelHtml += '<div style="font-size:9px;color:var(--muted);text-transform:uppercase;margin-bottom:3px;">' +
        t("wz_mig_as_origin", "As country of origin") + '</div>';
      panelHtml += '<div style="display:flex;gap:12px;flex-wrap:wrap;">';
      if (lo.refugees) panelHtml += '<div><span style="font-size:13px;font-weight:800;color:#dc2626;">' + _fmtN(lo.refugees) + '</span> <span style="font-size:9px;color:var(--muted);">' + t("wz_mig_refugees","Ref.") + '</span></div>';
      if (lo.asylum_seekers) panelHtml += '<div><span style="font-size:13px;font-weight:800;color:#f59e0b;">' + _fmtN(lo.asylum_seekers) + '</span> <span style="font-size:9px;color:var(--muted);">' + t("wz_mig_asylum","Asyl.") + '</span></div>';
      panelHtml += '</div>';
    }

    panelHtml += '</div>';
  }

  panelHtml += '</div>';
  panel.innerHTML = panelHtml;

  // ── Render combined charts ──
  if (!window.Chart) return;

  var allYears = {};
  countries.forEach(function(c) {
    (c.asylum_series || []).forEach(function(d) { allYears[d.year] = true; });
  });
  var years = Object.keys(allYears).sort();
  if (years.length < 2) return;

  function _buildDatasets(field) {
    var ds = [];
    countries.forEach(function(c, ci) {
      var series = c.asylum_series || [];
      if (series.length < 2) return;
      var seriesMap = {};
      series.forEach(function(d) { seriesMap[d.year] = d[field] || 0; });
      var hasData = years.some(function(y) { return (seriesMap[y] || 0) > 0; });
      if (!hasData) return;
      var clr = _COLORS[ci % _COLORS.length];
      ds.push({
        label: c.iso3,
        data: years.map(function(y) { return seriesMap[y] || 0; }),
        borderColor: clr,
        borderWidth: 2,
        pointRadius: 3,
        pointBackgroundColor: clr,
        fill: false,
        tension: 0.3,
      });
    });
    return ds;
  }

  function _renderChart(canvasId, datasets) {
    var canvas = document.getElementById(canvasId);
    if (!canvas || !datasets.length) return;
    new Chart(canvas.getContext("2d"), {
      type: "line",
      data: { labels: years, datasets: datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: true, position: "bottom", labels: { font: { size: 10 }, boxWidth: 12, padding: 8 } },
          tooltip: {
            callbacks: { label: function(ctx) { return ctx.dataset.label + ": " + _fmtN(ctx.raw); } },
          },
        },
        scales: {
          x: { ticks: { font: { size: 10 } }, grid: { display: false } },
          y: {
            ticks: { font: { size: 10 }, callback: function(v) { return _fmtN(v); } },
            grid: { color: "rgba(100,100,100,.1)" },
          },
        },
      },
    });
  }

  _renderChart("mig-chart-refugees", _buildDatasets("refugees"));
  _renderChart("mig-chart-asylum", _buildDatasets("asylum_seekers"));
}

function _fmtN(n) {
  if (n == null) return "0";
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(0) + "K";
  return String(n);
}

function _esc(s) {
  if (!s) return "";
  var d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

WZ._onLiveClose.push(function() {
  var panel = document.getElementById("mig-side-panel");
  if (panel) { panel.style.display = "none"; panel.innerHTML = ""; }
});

WZ.registerPlugin("migration", {
  renderer: _renderMigrationLive,
  has_live_map: false,
  default_source: "unhcr",
});

})();
