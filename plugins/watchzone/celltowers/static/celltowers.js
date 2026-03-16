/**
 * WZ Module: OpenCelliD Cell Tower renderer.
 */
(function() {
"use strict";
var WZ = window.WZ;
var t = window._t || function(k, fb) { return fb; };

var RADIO_COLORS = {
  LTE:   "#3b82f6",
  UMTS:  "#22c55e",
  GSM:   "#eab308",
  NR:    "#8b5cf6",
  CDMA:  "#f59e0b",
  NBIOT: "#06b6d4",
};

var _ctMarkers = [];

function _renderCellTowerLive(data) {
  var items = data.items || [];
  var total = data.total_in_zone || data.count || 0;
  var radioCounts = data.radio_counts || {};

  document.getElementById("wz-live-count").textContent =
    total + " " + t("wz_ct_count", "cell towers") +
    (items.length < total ? " (" + t("wz_ct_displayed","Displayed") + ": " + items.length + ")" : "");

  if (WZ._liveMarkers) WZ._liveMarkers.clearLayers();
  _ctMarkers = [];

  // Map markers
  if (WZ._liveMap && items.length) {
    for (var i = 0; i < items.length; i++) {
      var c = items[i];
      if (c.lat == null || c.lon == null) continue;
      var color = RADIO_COLORS[c.radio] || "#64748b";
      var samples = c.samples || 0;
      var r = Math.max(3, Math.min(8, 3 + Math.log2(samples + 1)));

      var circle = L.circleMarker([c.lat, c.lon], {
        radius: r, color: color, fillColor: color,
        fillOpacity: 0.6, weight: 1,
      });
      circle.bindPopup(
        '<div style="font-size:12px;min-width:180px;">' +
        '<div style="font-weight:700;color:' + color + ';margin-bottom:4px;">' +
          _esc(c.radio || "?") + ' Tower</div>' +
        '<div style="display:grid;grid-template-columns:auto 1fr;gap:2px 10px;font-size:11px;">' +
          '<span style="color:var(--muted);">MCC/MNC:</span><span>' + (c.mcc||"") + "/" + (c.mnc||"") + '</span>' +
          '<span style="color:var(--muted);">LAC:</span><span>' + (c.lac||"") + '</span>' +
          '<span style="color:var(--muted);">Cell ID:</span><span style="font-family:monospace;">' + (c.cellid||"") + '</span>' +
          '<span style="color:var(--muted);">' + t("wz_ct_samples","Samples") + ':</span><span>' + samples + '</span>' +
          (c.range ? '<span style="color:var(--muted);">' + t("wz_ct_range","Range") + ':</span><span>' + c.range + ' m</span>' : '') +
          (c.averageSignal ? '<span style="color:var(--muted);">' + t("wz_ct_signal","Signal") + ':</span><span>' + c.averageSignal + ' dBm</span>' : '') +
        '</div>' +
        (c.updated ? '<div style="font-size:10px;color:var(--muted);margin-top:4px;">' + t("wz_ct_updated","Updated") + ': ' + _fmtTs(c.updated) + '</div>' : '') +
        '</div>'
      );
      WZ._liveMarkers.addLayer(circle);
      _ctMarkers.push({ marker: circle, idx: i, origRadius: r, origColor: color });

      circle.on("mouseover", _makeHL(i, true));
      circle.on("mouseout",  _makeHL(i, false));
    }
  }

  // Content panel
  var content = document.getElementById("wz-live-content");
  var html = '<div style="padding:12px 16px;">';

  // Stats bar
  html += '<div style="margin-bottom:12px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 16px;">';
  html += '<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;">';
  html += '<div style="text-align:center;">' +
    '<div style="font-size:22px;font-weight:800;color:var(--text);">' + total + '</div>' +
    '<div style="font-size:10px;color:var(--muted);text-transform:uppercase;">' + t("wz_ct_total","Total in zone") + '</div></div>';
  html += '<div style="text-align:center;">' +
    '<div style="font-size:22px;font-weight:800;color:var(--muted);">' + (data.total_samples || 0).toLocaleString() + '</div>' +
    '<div style="font-size:10px;color:var(--muted);text-transform:uppercase;">' + t("wz_ct_samples","Samples") + '</div></div>';
  // Radio type breakdown
  var types = Object.keys(radioCounts).sort(function(a,b) { return radioCounts[b] - radioCounts[a]; });
  for (var ti = 0; ti < types.length; ti++) {
    var rc = RADIO_COLORS[types[ti]] || "#64748b";
    html += '<div style="text-align:center;">' +
      '<div style="font-size:18px;font-weight:700;color:' + rc + ';">' + radioCounts[types[ti]] + '</div>' +
      '<div style="font-size:10px;color:var(--muted);">' + _esc(types[ti]) + '</div></div>';
  }
  html += '</div></div>';

  // Coverage density bar (visual indicator)
  if (items.length > 0) {
    var lteCount = radioCounts["LTE"] || 0;
    var nrCount = radioCounts["NR"] || 0;
    var modernPct = items.length > 0 ? Math.round(((lteCount + nrCount) / (data.count || 1)) * 100) : 0;
    html += '<div style="margin-bottom:12px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 16px;">';
    html += '<div style="font-size:11px;color:var(--muted);margin-bottom:6px;">LTE/5G-Abdeckung</div>';
    html += '<div style="height:8px;background:var(--border);border-radius:4px;overflow:hidden;">';
    html += '<div style="height:100%;width:' + modernPct + '%;background:linear-gradient(90deg,#3b82f6,#8b5cf6);border-radius:4px;transition:width .3s;"></div>';
    html += '</div>';
    html += '<div style="font-size:10px;color:var(--muted);margin-top:2px;">' + modernPct + '% LTE/5G NR</div>';
    html += '</div>';
  }

  // Cell tower table
  html += '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;">';
  html += '<div style="padding:10px 14px;border-bottom:1px solid var(--border);font-size:12px;font-weight:600;">' +
    t("wz_ct_header","Cell towers in zone") + '</div>';

  if (!items.length) {
    html += '<div style="padding:20px;text-align:center;color:var(--muted);font-size:12px;">' +
      t("wz_ct_empty","No cell towers recorded in this region.") + '</div>';
  } else {
    html += '<div id="ct-list" style="max-height:350px;overflow-y:auto;">';
    var showMax = Math.min(items.length, 100);
    for (var j = 0; j < showMax; j++) {
      var cell = items[j];
      var cellColor = RADIO_COLORS[cell.radio] || "#64748b";
      html += '<div class="ct-row" data-idx="' + j + '" ' +
        'style="display:flex;align-items:center;gap:8px;padding:5px 14px;border-bottom:1px solid var(--border);' +
        'font-size:11px;cursor:pointer;transition:background .15s;">' +
        '<span style="display:inline-block;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:700;' +
          'background:' + cellColor + '20;color:' + cellColor + ';min-width:36px;text-align:center;">' + _esc(cell.radio || "?") + '</span>' +
        '<span style="font-family:monospace;color:var(--muted);font-size:10px;min-width:70px;">' +
          (cell.mcc||"") + "/" + (cell.mnc||"") + "/" + (cell.lac||"") + '</span>' +
        '<span style="flex:1;font-family:monospace;color:var(--text);font-size:10px;">' + (cell.cellid||"") + '</span>' +
        '<span style="color:var(--muted);font-size:10px;min-width:50px;text-align:right;">' +
          (cell.samples||0) + ' \u00d7</span>' +
        (cell.range ? '<span style="color:var(--muted);font-size:10px;min-width:50px;text-align:right;">' + cell.range + 'm</span>' : '') +
      '</div>';
    }
    if (items.length > showMax) {
      html += '<div style="padding:6px 14px;font-size:11px;color:var(--muted);">\u2026 ' +
        (items.length - showMax) + ' ' + t("wz_ct_more","more") + '</div>';
    }
    html += '</div>';
  }
  html += '</div></div>';
  content.innerHTML = html;

  // List ↔ Map hover
  document.querySelectorAll(".ct-row").forEach(function(row) {
    var idx = parseInt(row.dataset.idx);
    row.addEventListener("mouseenter", function() { _ctHighlight(idx, true); });
    row.addEventListener("mouseleave", function() { _ctHighlight(idx, false); });
    row.addEventListener("click", function() {
      var entry = _ctMarkers.find(function(m) { return m.idx === idx; });
      if (entry && WZ._liveMap) {
        WZ._liveMap.setView(entry.marker.getLatLng(), Math.max(WZ._liveMap.getZoom(), 14));
        entry.marker.openPopup();
      }
    });
  });
}

function _makeHL(idx, active) { return function() { _ctHighlight(idx, active); }; }

function _ctHighlight(idx, active) {
  var entry = _ctMarkers.find(function(m) { return m.idx === idx; });
  if (entry) {
    if (active) {
      entry.marker.setStyle({ radius: entry.origRadius * 2.5, weight: 3, color: "#fff", fillOpacity: 0.95 });
      entry.marker.bringToFront();
    } else {
      entry.marker.setStyle({ radius: entry.origRadius, weight: 1, color: entry.origColor, fillOpacity: 0.6 });
    }
  }
  var row = document.querySelector('.ct-row[data-idx="' + idx + '"]');
  if (row) {
    row.style.background = active ? "rgba(59,130,246,.1)" : "";
    if (active) row.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

function _fmtTs(ts) {
  if (!ts) return "";
  // Unix timestamp
  if (typeof ts === "number") {
    var d = new Date(ts * 1000);
    return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
  }
  return String(ts).slice(0, 10);
}

function _esc(s) {
  if (!s) return "";
  var d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

WZ.registerPlugin("celltowers", {
  renderer: _renderCellTowerLive,
  default_source: "opencellid",
});

})();
