/**
 * WZ Module: ndvi renderer — side panel layout.
 */
(function() {
"use strict";
var WZ = window.WZ;

  function _fmtD(d) { return window.fmtDateOnly ? window.fmtDateOnly(d + "T00:00") : d; }

  function _renderNdviLive(data) {
    document.getElementById("wz-live-count").textContent =
      data.count != null ? data.count + " " + t('wz_ndvi_data_points','data points') : "";
    if (WZ._liveMarkers) WZ._liveMarkers.clearLayers();

    var items = data.items || [];

    // ── Layout: Karte volle Höhe links, Panel rechts ──
    var liveBox = document.getElementById("wz-live-box");
    if (liveBox) {
      liveBox.classList.add("wz-map-fill");
      liveBox.style.display = "flex";
      liveBox.style.flexDirection = "column";
      liveBox.style.height = "95vh";
      liveBox.style.maxHeight = "95vh";
      liveBox.style.maxWidth = "1400px";
    }
    var mapRow = document.getElementById("wz-map-row");
    if (mapRow) {
      mapRow.style.display = "flex";
      mapRow.style.flex = "1 1 0";
      mapRow.style.minHeight = "0";
      mapRow.style.height = "100%";
      mapRow.style.flexShrink = "1";
    }
    var mapEl = document.getElementById("wz-live-map");
    if (mapEl) { mapEl.style.height = "100%"; mapEl.style.minHeight = "0"; mapEl.style.flex = "1"; }
    ["wz-live-body","wz-under-map-bar","wz-resize-map","wz-live-sticky"].forEach(function(id) {
      var el = document.getElementById(id); if (el) el.style.display = "none";
    });

    // ── Seitenpanel ──
    var panel = document.getElementById("ndvi-side-panel");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "ndvi-side-panel";
      panel.style.cssText = "width:380px;flex-shrink:0;border-left:1px solid var(--border);background:var(--surface);display:flex;flex-direction:column;overflow:hidden;";
      mapRow.appendChild(panel);
    }
    panel.style.display = "flex";

    if (!items.length) {
      panel.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);">' +
        t('wz_ndvi_empty','No NDVI data available. Copernicus credentials required.') + '</div>';
      setTimeout(function() { if (WZ._liveMap) WZ._liveMap.invalidateSize(); }, 200);
      return;
    }

    var vals = items.map(function(d) { return d.mean_ndvi; });
    var minV = Math.min.apply(null, vals), maxV = Math.max.apply(null, vals);
    var avg = vals.reduce(function(a, b) { return a + b; }, 0) / vals.length;
    var range = maxV - minV || 0.1;

    var html = '';

    // ── Sparkline ──
    var w = 400, h = 80;
    var points = vals.map(function(v, i) {
      return ((i / (vals.length - 1)) * w).toFixed(1) + "," + (h - ((v - minV) / range) * h).toFixed(1);
    }).join(" ");

    html += '<div style="padding:12px 14px;border-bottom:1px solid var(--border);flex-shrink:0;">';
    html += '<h4 style="margin:0 0 8px;font-size:13px;font-weight:600;">' + t('wz_ndvi_trend','NDVI Trend (90 Days)') + '</h4>';
    html += '<svg viewBox="0 0 ' + w + ' ' + h + '" style="width:100%;height:' + h + 'px;display:block;">';
    html += '<polyline points="' + points + '" fill="none" stroke="#16a34a" stroke-width="2"/>';
    html += '</svg>';
    html += '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--muted);margin-top:2px;">';
    html += '<span>' + _fmtD(items[0].date) + '</span><span>' + _fmtD(items[items.length - 1].date) + '</span>';
    html += '</div></div>';

    // ── Stats ──
    var curV = vals[vals.length - 1];
    var curClr = curV > 0.6 ? "#16a34a" : curV > 0.3 ? "#eab308" : curV > 0 ? "#f97316" : "#ef4444";
    html += '<div style="padding:10px 14px;border-bottom:1px solid var(--border);display:flex;gap:14px;flex-wrap:wrap;align-items:center;flex-shrink:0;">';
    html += '<div style="text-align:center;"><div style="font-size:22px;font-weight:800;color:' + curClr + ';">' + curV.toFixed(3) + '</div><div style="font-size:9px;color:var(--muted);text-transform:uppercase;">' + t('wz_ndvi_current','Current') + '</div></div>';
    html += '<div style="text-align:center;"><div style="font-size:22px;font-weight:800;color:var(--text);">' + maxV.toFixed(3) + '</div><div style="font-size:9px;color:var(--muted);text-transform:uppercase;">Max</div></div>';
    html += '<div style="text-align:center;"><div style="font-size:22px;font-weight:800;color:var(--text);">' + minV.toFixed(3) + '</div><div style="font-size:9px;color:var(--muted);text-transform:uppercase;">Min</div></div>';
    html += '<div style="text-align:center;"><div style="font-size:22px;font-weight:800;color:var(--text);">' + avg.toFixed(3) + '</div><div style="font-size:9px;color:var(--muted);text-transform:uppercase;">\u00d8</div></div>';
    html += '</div>';

    // ── Tabellenkopf ──
    html += '<div style="display:flex;align-items:center;gap:6px;padding:6px 10px;border-bottom:2px solid var(--border);font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;flex-shrink:0;">';
    html += '<span style="min-width:100px;">' + t('wz_ndvi_th_date','Date') + '</span>';
    html += '<span style="min-width:70px;text-align:right;">NDVI</span>';
    html += '<span style="flex:1;">' + t('wz_ndvi_th_rating','Rating') + '</span>';
    html += '</div>';

    // ── Scrollbare Liste ──
    html += '<div id="ndvi-list" style="flex:1;overflow-y:auto;min-height:0;font-size:11px;">';
    var reversed = items.slice().reverse();
    reversed.forEach(function(d) {
      var v = d.mean_ndvi;
      var color = v > 0.6 ? "#16a34a" : v > 0.3 ? "#eab308" : v > 0 ? "#f97316" : "#ef4444";
      var label = v > 0.6 ? t('wz_ndvi_dense','Dense Vegetation') : v > 0.3 ? t('wz_ndvi_moderate','Moderate') : v > 0 ? t('wz_ndvi_sparse','Sparse') : t('wz_ndvi_none','No Greenery');
      html += '<div style="display:flex;align-items:center;gap:6px;padding:5px 10px;border-bottom:1px solid var(--border);">';
      html += '<span style="color:var(--muted);min-width:100px;">' + _fmtD(d.date) + '</span>';
      html += '<span style="font-weight:700;color:' + color + ';min-width:70px;text-align:right;font-family:monospace;">' + v.toFixed(4) + '</span>';
      html += '<span style="color:' + color + ';font-size:10px;flex:1;">' + label + '</span>';
      html += '</div>';
    });
    html += '</div>';

    panel.innerHTML = html;
    setTimeout(function() { if (WZ._liveMap) WZ._liveMap.invalidateSize(); }, 200);
  }

  WZ._onLiveClose.push(function() {
    var panel = document.getElementById("ndvi-side-panel");
    if (panel) { panel.style.display = "none"; panel.innerHTML = ""; }
  });

  WZ.registerPlugin('ndvi', { renderer: _renderNdviLive, default_source: "sentinel-ndvi" });

})();
