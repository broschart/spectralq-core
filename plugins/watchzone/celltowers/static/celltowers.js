/**
 * WZ Module: OpenCelliD Cell Tower renderer — side panel layout.
 */
(function() {
"use strict";
var WZ = window.WZ;
var t = window.t || function(k, fb) { return fb; };

var RADIO_COLORS = {
  LTE:   "#3b82f6",
  UMTS:  "#22c55e",
  GSM:   "#eab308",
  NR:    "#8b5cf6",
  CDMA:  "#f59e0b",
  NBIOT: "#06b6d4",
};

var _ctMarkers = [];
var _ctItems = [];
var _ctRangeCircle = null;

function _renderCellTowerLive(data) {
  var ctx = WZ._currentCtx;
  if (ctx && ctx.mapEl) ctx.mapEl.style.height = "clamp(450px,75vh,850px)";
  var items = data.items || [];
  var total = data.total_in_zone || data.count || 0;
  var radioCounts = data.radio_counts || {};

  // Update count display
  var countEl = ctx ? ctx.countEl : document.getElementById("wz-live-count");
  if (countEl) {
    countEl.textContent =
      total + " " + t("wz_cell_count", "cell towers") +
      (items.length < total ? " (" + t("wz_cell_displayed","Displayed") + ": " + items.length + ")" : "");
  }

  if (WZ._liveMarkers) WZ._liveMarkers.clearLayers();
  _ctMarkers = [];
  _ctItems = items;

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
          '<span style="color:var(--muted);">' + t("wz_cell_samples","Samples") + ':</span><span>' + samples + '</span>' +
          (c.range ? '<span style="color:var(--muted);">' + t("wz_cell_range","Range") + ':</span><span>' + c.range + ' m</span>' : '') +
          (c.averageSignal ? '<span style="color:var(--muted);">' + t("wz_cell_signal","Signal") + ':</span><span>' + c.averageSignal + ' dBm</span>' : '') +
        '</div>' +
        (c.updated ? '<div style="font-size:10px;color:var(--muted);margin-top:4px;">' + t("wz_cell_updated","Updated") + ': ' + _fmtTs(c.updated) + '</div>' : '') +
        '</div>'
      );
      WZ._liveMarkers.addLayer(circle);
      _ctMarkers.push({ marker: circle, idx: i, origRadius: r, origColor: color });

      circle.on("mouseover", _makeHL(i, true));
      circle.on("mouseout",  _makeHL(i, false));
    }
  }

  // ── Side panel (right of map) ──
  var panel = document.getElementById("ct-side-panel");
  if (!panel && ctx && ctx.mapRowEl) {
    panel = document.createElement("div");
    panel.id = "ct-side-panel";
    panel.style.cssText = "width:400px;flex-shrink:0;border-left:1px solid var(--border);background:var(--surface);display:flex;flex-direction:column;overflow:hidden;";
    ctx.mapRowEl.appendChild(panel);
  }

  var html = '<div style="padding:12px 14px;display:flex;flex-direction:column;height:100%;box-sizing:border-box;">';

  // Stats bar
  html += '<div style="margin-bottom:12px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 16px;">';
  html += '<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;">';
  html += '<div style="text-align:center;">' +
    '<div style="font-size:22px;font-weight:800;color:var(--text);">' + total + '</div>' +
    '<div style="font-size:10px;color:var(--muted);text-transform:uppercase;">' + t("wz_cell_total","Total in zone") + '</div></div>';
  html += '<div style="text-align:center;">' +
    '<div style="font-size:22px;font-weight:800;color:var(--muted);">' + (data.total_samples || 0).toLocaleString() + '</div>' +
    '<div style="font-size:10px;color:var(--muted);text-transform:uppercase;">' + t("wz_cell_samples","Samples") + '</div></div>';
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

  // ── Forensische Anomalie-Erkennung ──
  if (items.length > 0) {
    var anomalies = [];
    // IMSI-Catcher-Verdacht: nur wenn WIRKLICH auffällig
    var avgSamples = items.reduce(function(s,c){return s+(c.samples||0);},0) / Math.max(1, items.length);
    var suspicious = items.filter(function(c) {
      if (c.changeable !== 1) return false;
      if ((c.samples || 0) > 1) return false;
      if (c.range > 500) return false;
      if (c.radio !== 'GSM' && c.radio !== 'UMTS') return false;
      return true;
    });
    if (suspicious.length) {
      anomalies.push({
        icon: '\u26a0', color: '#ef4444',
        title: t('wz_cell_imsi_suspect','IMSI-Catcher-Verdacht'),
        desc: suspicious.length + ' ' + t('wz_cell_mobile_towers','mobile/tempor\u00e4re Masten mit wenig Messungen'),
        items: suspicious
      });
    }
    // Anomale Reichweite: GSM mit <100m oder LTE mit >10km
    var shortRange = items.filter(function(c) { return c.range > 0 && c.range < 100 && (c.radio === 'GSM' || c.radio === 'UMTS'); });
    var longRange = items.filter(function(c) { return c.range > 10000 && (c.radio === 'LTE' || c.radio === 'NR'); });
    if (shortRange.length) {
      anomalies.push({ icon: '\ud83d\udce1', color: '#f59e0b', title: t('wz_cell_short_range','Mikrozellen / Repeater'), desc: shortRange.length + ' Masten mit <100m Reichweite', items: shortRange });
    }
    if (longRange.length) {
      anomalies.push({ icon: '\ud83d\udce1', color: '#f59e0b', title: t('wz_cell_long_range','Auff\u00e4llige Reichweite'), desc: longRange.length + ' LTE/5G-Masten mit >10km', items: longRange });
    }
    // Fremdes MCC (nicht zum häufigsten passend)
    var mccCounts = {};
    items.forEach(function(c) { var m = c.mcc || '?'; mccCounts[m] = (mccCounts[m]||0)+1; });
    var mainMcc = Object.keys(mccCounts).sort(function(a,b){return mccCounts[b]-mccCounts[a];})[0];
    var foreignMcc = items.filter(function(c) { return c.mcc && String(c.mcc) !== String(mainMcc); });
    if (foreignMcc.length && mainMcc !== '?') {
      anomalies.push({ icon: '\ud83c\udf10', color: '#8b5cf6', title: t('wz_cell_foreign_mcc','Fremde Netzkennungen'), desc: foreignMcc.length + ' Masten mit MCC \u2260 ' + mainMcc, items: foreignMcc });
    }

    if (anomalies.length) {
      html += '<div style="margin-bottom:10px;flex-shrink:0;">';
      anomalies.forEach(function(a) {
        html += '<div style="margin-bottom:6px;padding:8px 12px;background:rgba(' + (a.color === '#ef4444' ? '239,68,68' : a.color === '#f59e0b' ? '245,158,11' : '139,92,246') + ',.08);border:1px solid ' + a.color + '33;border-left:3px solid ' + a.color + ';border-radius:6px;">';
        html += '<div style="font-size:12px;font-weight:700;color:' + a.color + ';">' + a.icon + ' ' + a.title + '</div>';
        html += '<div style="font-size:11px;color:var(--muted);margin-top:2px;">' + a.desc + '</div>';
        html += '</div>';
      });
      html += '</div>';
    }
  }

  // ── Technologie-Verteilung (Stacked Bar) ──
  if (items.length > 0 && Object.keys(radioCounts).length > 0) {
    var radioSorted = Object.keys(radioCounts).sort(function(a,b) { return radioCounts[b] - radioCounts[a]; });
    html += '<div style="margin-bottom:10px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 14px;flex-shrink:0;">';
    html += '<div style="font-size:12px;font-weight:600;margin-bottom:6px;">' + t('wz_cell_tech_dist','Technologie-Verteilung') + '</div>';
    // Stacked horizontal bar
    html += '<div style="height:18px;border-radius:4px;overflow:hidden;display:flex;">';
    radioSorted.forEach(function(r) {
      var pct = (radioCounts[r] / total * 100).toFixed(1);
      html += '<div title="' + _esc(r) + ': ' + radioCounts[r] + ' (' + pct + '%)" style="height:100%;width:' + pct + '%;background:' + (RADIO_COLORS[r] || '#64748b') + ';"></div>';
    });
    html += '</div>';
    // Legende mit Prozent
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">';
    radioSorted.forEach(function(r) {
      var pct = (radioCounts[r] / total * 100).toFixed(1);
      html += '<span style="display:inline-flex;align-items:center;gap:3px;font-size:10px;color:var(--text);">' +
        '<span style="width:8px;height:8px;border-radius:2px;background:' + (RADIO_COLORS[r] || '#64748b') + ';"></span>' +
        _esc(r) + ' <span style="color:var(--muted);">' + radioCounts[r] + ' (' + pct + '%)</span></span>';
    });
    html += '</div></div>';
  }

  // ── Betreiber-Vergleich ──
  if (items.length > 0) {
    var operators = {};
    items.forEach(function(c) {
      var key = (c.mcc || '?') + '/' + (c.mnc || '?');
      if (!operators[key]) operators[key] = { total: 0, radios: {} };
      operators[key].total++;
      var r = c.radio || 'Unknown';
      operators[key].radios[r] = (operators[key].radios[r] || 0) + 1;
    });
    var opKeys = Object.keys(operators).sort(function(a, b) { return operators[b].total - operators[a].total; });

    if (opKeys.length > 1) {
      var maxOp = operators[opKeys[0]].total;
      html += '<div style="margin-bottom:10px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 14px;flex-shrink:0;">';
      html += '<div style="font-size:12px;font-weight:600;margin-bottom:6px;">' + t('wz_cell_operators','Betreiber-Vergleich') + '</div>';
      opKeys.slice(0, 10).forEach(function(key) {
        var op = operators[key];
        var pct = Math.round((op.total / maxOp) * 100);
        // Stacked bar
        var segments = '';
        var allR = Object.keys(op.radios).sort(function(a, b) { return op.radios[b] - op.radios[a]; });
        allR.forEach(function(r) {
          var w = Math.max(1, Math.round((op.radios[r] / op.total) * pct));
          segments += '<div style="height:100%;width:' + w + '%;background:' + (RADIO_COLORS[r] || '#64748b') + ';"></div>';
        });
        html += '<div style="margin-bottom:4px;">' +
          '<div style="display:flex;align-items:center;gap:6px;font-size:11px;">' +
            '<span style="min-width:55px;font-family:monospace;color:var(--text);font-weight:600;">' + _esc(key) + '</span>' +
            '<div style="flex:1;height:10px;background:var(--border);border-radius:3px;overflow:hidden;display:flex;">' + segments + '</div>' +
            '<span style="min-width:30px;text-align:right;color:var(--muted);font-size:10px;">' + op.total + '</span>' +
          '</div></div>';
      });
      html += '</div>';
    }
  }

  // ── Reichweite-Statistik ──
  if (items.length > 0) {
    var ranges = items.filter(function(c){return c.range > 0;}).map(function(c){return c.range;});
    if (ranges.length > 0) {
      var avgRange = Math.round(ranges.reduce(function(a,b){return a+b;},0) / ranges.length);
      var maxRange = Math.max.apply(null, ranges);
      var minRange = Math.min.apply(null, ranges);
      html += '<div style="margin-bottom:10px;display:flex;gap:8px;flex-shrink:0;">';
      html += '<div style="flex:1;text-align:center;padding:6px;background:rgba(59,130,246,.1);border:1px solid rgba(59,130,246,.3);border-radius:6px;"><div style="font-size:16px;font-weight:700;color:#3b82f6;">' + avgRange + ' m</div><div style="font-size:9px;color:var(--muted);">\u00d8 ' + t('wz_cell_range','Reichweite') + '</div></div>';
      html += '<div style="flex:1;text-align:center;padding:6px;background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.3);border-radius:6px;"><div style="font-size:16px;font-weight:700;color:#22c55e;">' + minRange + ' m</div><div style="font-size:9px;color:var(--muted);">Min</div></div>';
      html += '<div style="flex:1;text-align:center;padding:6px;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);border-radius:6px;"><div style="font-size:16px;font-weight:700;color:#ef4444;">' + maxRange + ' m</div><div style="font-size:9px;color:var(--muted);">Max</div></div>';
      html += '</div>';
    }
  }

  // Cell tower table
  html += '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;flex:1;display:flex;flex-direction:column;min-height:0;">';
  html += '<div style="padding:10px 14px;border-bottom:1px solid var(--border);font-size:12px;font-weight:600;">' +
    t("wz_cell_header","Cell towers in zone") + '</div>';

  if (!items.length) {
    html += '<div style="padding:20px;text-align:center;color:var(--muted);font-size:12px;">' +
      t("wz_cell_empty","No cell towers recorded in this region.") + '</div>';
  } else {
    // Tabellenkopf
    html += '<div style="display:flex;align-items:center;gap:8px;padding:5px 14px;border-bottom:2px solid var(--border);font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;flex-shrink:0;">' +
      '<span style="min-width:36px;">Typ</span>' +
      '<span style="min-width:70px;">MCC/MNC/LAC</span>' +
      '<span style="flex:1;">Cell ID</span>' +
      '<span style="min-width:50px;text-align:right;">' + t("wz_cell_samples","Samples") + '</span>' +
      '<span style="min-width:50px;text-align:right;">' + t("wz_cell_range","Range") + '</span>' +
    '</div>';
    html += '<div id="ct-list" style="flex:1;overflow-y:auto;min-height:0;">';
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
        (items.length - showMax) + ' ' + t("wz_cell_more","more") + '</div>';
    }
    html += '</div>';
  }
  html += '</div></div>';

  if (panel) {
    panel.innerHTML = html;
  }

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
      // Reichweiten-Kreis anzeigen
      var cell = _ctItems[idx];
      if (cell && cell.range && cell.range > 0 && WZ._liveMap) {
        if (_ctRangeCircle) { WZ._liveMap.removeLayer(_ctRangeCircle); _ctRangeCircle = null; }
        _ctRangeCircle = L.circle([cell.lat, cell.lon], {
          radius: cell.range,
          color: entry.origColor,
          fillColor: entry.origColor,
          fillOpacity: 0.08,
          weight: 1.5,
          dashArray: '6,4',
          interactive: false,
        }).addTo(WZ._liveMap);
      }
    } else {
      entry.marker.setStyle({ radius: entry.origRadius, weight: 1, color: entry.origColor, fillOpacity: 0.6 });
      if (_ctRangeCircle && WZ._liveMap) {
        WZ._liveMap.removeLayer(_ctRangeCircle);
        _ctRangeCircle = null;
      }
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

WZ._onLiveClose.push(function() {
  _ctMarkers = [];
  _ctRangeCircle = null;
});

WZ.registerPlugin("celltowers", {
  renderer: _renderCellTowerLive,
  default_source: "opencellid",
  has_live_map: true,
  live_title_prefix: "Mobilfunk:",
  live_box_max_width: "1400px",
  live_box_height: "72vh",
  max_area_sqm: 4000000,  // OpenCelliD Limit: 4 km²
});

// Collect Renderer
WZ._collectRenderers["celltowers"] = {
  renderHTML: function(data, cardId) {
    var h = "";
    h += '<div style="font-size:10px;color:var(--muted);margin-bottom:6px;">Datenstand: OpenCelliD (statische Datenbank)</div>';
    var hasItems = data.items && data.items.length && data.items.some(function(it) { return it.lat != null; });
    if (hasItems) h += '<div id="' + cardId + '-map" style="height:400px;border-radius:6px;margin-bottom:8px;"></div>';
    h += '<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:8px;">';
    h += '<div style="text-align:center;"><div style="font-size:20px;font-weight:800;color:var(--text);">' + (data.total_in_zone || data.count || 0) + '</div><div style="font-size:9px;color:var(--muted);">Mobilfunkmasten</div></div>';
    var rc = data.radio_counts || {};
    Object.keys(rc).forEach(function(r) {
      var c = r === "LTE" ? "#06b6d4" : r === "UMTS" ? "#f59e0b" : r === "GSM" ? "#22c55e" : r === "NR" ? "#a855f7" : "#888";
      h += '<div style="text-align:center;"><div style="font-size:20px;font-weight:800;color:' + c + ';">' + rc[r] + '</div><div style="font-size:9px;color:var(--muted);">' + r + '</div></div>';
    });
    h += '</div>';
    if (data.items && data.items.length) {
      h += '<table style="width:100%;font-size:11px;border-collapse:collapse;">';
      h += '<thead><tr style="border-bottom:1px solid var(--border);color:var(--muted);"><th style="text-align:left;padding:3px 6px;">Typ</th><th style="padding:3px 6px;">MCC</th><th style="padding:3px 6px;">MNC</th><th style="text-align:right;padding:3px 6px;">Reichweite</th></tr></thead><tbody>';
      data.items.slice(0, 10).forEach(function(it) {
        h += '<tr style="border-bottom:1px solid rgba(255,255,255,.05);">';
        h += '<td style="padding:3px 6px;font-weight:600;">' + (it.radio || "—") + '</td>';
        h += '<td style="padding:3px 6px;">' + (it.mcc || "—") + '</td>';
        h += '<td style="padding:3px 6px;">' + (it.net || it.mnc || "—") + '</td>';
        h += '<td style="padding:3px 6px;text-align:right;">' + (it.range ? it.range + ' m' : "—") + '</td>';
        h += '</tr>';
      });
      h += '</tbody></table>';
      if (data.items.length > 10) h += '<div style="font-size:10px;color:var(--muted);margin-top:4px;">+ ' + (data.items.length - 10) + ' weitere</div>';
    }
    return h;
  },
  afterRender: function(data, cardId, cardEl) {
    WZ._collectGenericAfterRender({ plugin: "celltowers", data: data }, cardId, cardEl);
  }
};

})();
