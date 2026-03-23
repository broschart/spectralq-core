/**
 * WZ Module: OpenStreetMap Changes — map left + data panel right + timelapse.
 */
(function() {
"use strict";
var WZ = window.WZ;
var t = window.t || function(k, fb) { return fb; };

function _esc(s) { if (!s) return ""; var d=document.createElement("div"); d.textContent=s; return d.innerHTML; }
function _fmt(iso) { return window.fmtDate ? window.fmtDate(iso) : iso ? iso.replace("T"," ").slice(0,16) : ""; }
function _fmtD(iso) { return window.fmtDateOnly ? window.fmtDateOnly(iso) : iso ? iso.slice(0,10) : ""; }
function _fmtT(iso) { return window.fmtTimeOnly ? window.fmtTimeOnly(iso) : iso ? iso.slice(11,16) : ""; }

var _osmMarkers = [];
var _osmItems = [];
var _osmPlaying = false;
var _osmAnimFrame = null;

function _renderOSMLive(data) {
  var ctx = WZ._currentCtx;
  _osmItems = data.items || [];
  var items = _osmItems;
  var newCount = data.new_count || 0;
  var tagCounts = data.tag_counts || {};
  var topUsers = data.top_users || [];

  // Show map row + init map
  var mapRow = ctx.mapRowEl;
  if (mapRow) { mapRow.style.display = "flex"; mapRow.style.flex = "1"; mapRow.style.minHeight = "0"; }
  var resizeMap = ctx.resizeMapEl;
  if (resizeMap) resizeMap.style.display = "none";

  // Hide the default body, use map-row as the main container
  var liveBody = ctx.bodyEl;
  if (liveBody) liveBody.style.display = "none";

  if (!WZ._liveMap) {
    var mapEl = ctx.mapEl;
    if (mapEl) {
      mapEl.style.flex = "1";
      mapEl.style.minWidth = "0";
      var z = WZ._zones ? WZ._zones.find(function(zz) { return zz.id === WZ._liveZoneId; }) : null;
      var map = L.map(mapEl, { zoomControl: true }).setView([48, 8], 5);
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OSM &copy; CARTO", maxZoom: 18
      }).addTo(map);
      WZ._liveMap = map;
      WZ._liveMarkers = L.featureGroup().addTo(map);
      if (z && z.geometry) {
        try {
          var geo = typeof z.geometry === "string" ? JSON.parse(z.geometry) : z.geometry;
          var gj = L.geoJSON(geo, { style: { color: "#7cb342", weight: 2, fillColor: "#7cb342", fillOpacity: 0.05, dashArray: "6,4" }, interactive: false });
          gj.addTo(map);
          map.fitBounds(gj.getBounds(), { padding: [30, 30] });
        } catch (e) {}
      }
      setTimeout(function() { map.invalidateSize(); }, 200);
    }
  }

  // Determine date range from data
  var _osmDateRange = '';
  if (data.time_focus && data.time_focus.from) {
    var _tf = data.time_focus;
    _osmDateRange = ' (' + (_tf.title || '') + ' \u00b1 15d)';
  } else if (items.length) {
    var _dates = items.map(function(it) { return (it.date || '').slice(0,10); }).filter(Boolean).sort();
    if (_dates.length) _osmDateRange = ' (' + _dates[0] + ' \u2013 ' + _dates[_dates.length - 1] + ')';
  }
  ctx.countEl.textContent =
    (data.count || 0) + " " + t("wz_osm_changes", "Änderungen") + _osmDateRange +
    (newCount > 0 ? " \u00b7 " + newCount + " " + t("wz_osm_new", "neu") : "");

  // Add all markers (hidden initially for timelapse)
  if (WZ._liveMarkers) WZ._liveMarkers.clearLayers();
  _osmMarkers = [];
  items.forEach(function(el, i) {
    if (el.lat == null || el.lon == null) return;
    var color = el.color || "#64748b";
    var r = el.is_new ? 6 : 4;
    var circle = L.circleMarker([el.lat, el.lon], {
      radius: r, color: color, fillColor: color,
      fillOpacity: el.is_new ? 0.8 : 0.5, weight: el.is_new ? 2 : 1,
    });
    circle.bindPopup(
      '<div style="font-size:12px;min-width:180px;">' +
      '<div style="font-weight:700;color:' + color + ';">' + _esc(el.category) +
        (el.is_new ? ' <span style="background:#22c55e20;color:#22c55e;padding:1px 6px;border-radius:3px;font-size:10px;">NEU</span>' : '') + '</div>' +
      (el.name ? '<div style="margin:2px 0;">' + _esc(el.name) + '</div>' : '') +
      '<div style="font-size:11px;color:var(--muted);">' + _esc(el.tag_key) + '=' + _esc(el.tag_value) + '</div>' +
      '<div style="display:flex;gap:10px;margin-top:4px;font-size:11px;color:var(--muted);">' +
        '<span>\ud83d\udc64 ' + _esc(el.user) + '</span>' +
        '<span>v' + el.version + '</span>' +
        '<span>' + _fmt(el.timestamp) + '</span>' +
      '</div></div>'
    );
    WZ._liveMarkers.addLayer(circle);
    _osmMarkers.push({ marker: circle, idx: i, origRadius: r, origColor: color });
    circle.on("mouseover", function() { _osmHL(i, true); });
    circle.on("mouseout", function() { _osmHL(i, false); });
  });

  // Fit to markers
  if (_osmMarkers.length && WZ._liveMap) {
    var fb = L.featureGroup(_osmMarkers.map(function(m) { return m.marker; }));
    WZ._liveMap.fitBounds(fb.getBounds(), { padding: [40, 40] });
  }

  // ── Build daily bar chart data ──
  var dayCounts = {};
  items.forEach(function(it) {
    if (!it.timestamp) return;
    var day = it.timestamp.slice(0, 10);
    dayCounts[day] = (dayCounts[day] || 0) + 1;
  });
  var days = Object.keys(dayCounts).sort();
  var maxDayCount = 1;
  days.forEach(function(d) { if (dayCounts[d] > maxDayCount) maxDayCount = dayCounts[d]; });

  // ── Bar chart under map ──
  var existingChart = document.getElementById("wz-osm-chart");
  if (existingChart) existingChart.remove();
  var chartDiv = document.createElement("div");
  chartDiv.id = "wz-osm-chart";
  chartDiv.style.cssText = "flex-shrink:0;padding:6px 10px 4px;border-top:1px solid var(--border);background:var(--surface);";
  var chartHtml = '<div style="font-size:9px;color:var(--muted);margin-bottom:3px;">' + t("wz_osm_per_day", "Changes per day") + '</div>';
  chartHtml += '<div style="display:flex;align-items:flex-end;gap:1px;height:40px;">';
  days.forEach(function(d) {
    var h = Math.max(2, Math.round((dayCounts[d] / maxDayCount) * 36));
    var clr = dayCounts[d] >= maxDayCount * 0.8 ? "#7cb342" : dayCounts[d] >= maxDayCount * 0.4 ? "#636363" : "var(--muted)";
    chartHtml += '<div title="' + _fmtD(d) + ': ' + dayCounts[d] + ' ' + t("wz_osm_count", "changes") + '" ' +
      'style="flex:1;min-width:0;height:' + h + 'px;background:' + clr + ';border-radius:2px 2px 0 0;transition:height .2s;cursor:default;"></div>';
  });
  chartHtml += '</div>';
  chartHtml += '<div style="display:flex;justify-content:space-between;font-size:8px;color:var(--muted);margin-top:1px;">';
  if (days.length) chartHtml += '<span>' + _fmtD(days[0]) + '</span><span>' + _fmtD(days[days.length - 1]) + '</span>';
  chartHtml += '</div>';
  chartDiv.innerHTML = chartHtml;

  // Wrap map + chart in a left column
  var mapEl2 = ctx.mapEl;
  var existingLeft = document.getElementById("wz-osm-left");
  if (existingLeft) existingLeft.remove();
  var leftCol = document.createElement("div");
  leftCol.id = "wz-osm-left";
  leftCol.style.cssText = "flex:1;min-width:0;display:flex;flex-direction:column;";
  if (mapEl2 && mapRow) {
    mapRow.insertBefore(leftCol, mapEl2);
    leftCol.appendChild(mapEl2);
    leftCol.appendChild(chartDiv);
  }

  // ── Right panel ──
  var existingPanel = document.getElementById("wz-osm-panel");
  if (existingPanel) existingPanel.remove();

  var panel = document.createElement("div");
  panel.id = "wz-osm-panel";
  panel.style.cssText = "width:420px;flex-shrink:0;display:flex;flex-direction:column;overflow:hidden;border-left:1px solid var(--border);background:var(--surface);";
  if (mapRow) mapRow.appendChild(panel);

  // Compute time range
  var timestamps = items.filter(function(it) { return it.timestamp; }).map(function(it) { return new Date(it.timestamp).getTime(); });
  var minTime = timestamps.length ? Math.min.apply(null, timestamps) : Date.now();
  var maxTime = timestamps.length ? Math.max.apply(null, timestamps) : Date.now();

  var panelHtml = '';

  // Time range + play button
  panelHtml += '<div style="padding:8px 12px;border-bottom:1px solid var(--border);flex-shrink:0;">';
  panelHtml += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">';
  panelHtml += '<span style="font-size:11px;color:var(--muted);">' + _fmt(new Date(minTime).toISOString()) + '</span>';
  panelHtml += '<span style="flex:1;height:1px;background:var(--border);"></span>';
  panelHtml += '<span style="font-size:11px;color:var(--muted);">' + _fmt(new Date(maxTime).toISOString()) + '</span>';
  panelHtml += '</div>';
  panelHtml += '<div style="display:flex;align-items:center;gap:8px;">';
  panelHtml += '<button id="wz-osm-play" style="background:#7cb342;color:#fff;border:none;border-radius:6px;padding:4px 12px;font-size:11px;font-weight:600;cursor:pointer;">\u25B6 ' + t("wz_osm_timelapse", "Timelapse") + '</button>';
  // Slider with tick marks for each change
  var range = maxTime - minTime || 1;
  panelHtml += '<div style="flex:1;position:relative;height:20px;">';
  panelHtml += '<div style="position:absolute;top:3px;left:0;right:0;height:14px;pointer-events:none;">';
  timestamps.forEach(function(ts) {
    var pct = ((ts - minTime) / range) * 100;
    var it = items.find(function(x) { return new Date(x.timestamp).getTime() === ts; });
    var clr = (it && it.color) || "#7cb342";
    panelHtml += '<div style="position:absolute;left:' + pct + '%;top:0;width:2px;height:14px;background:' + clr + ';opacity:0.4;border-radius:1px;"></div>';
  });
  panelHtml += '</div>';
  panelHtml += '<input type="range" id="wz-osm-slider" min="0" max="1000" value="1000" style="position:relative;width:100%;cursor:pointer;accent-color:#7cb342;" />';
  panelHtml += '</div>';
  panelHtml += '<span id="wz-osm-play-time" style="font-size:11px;color:var(--muted);min-width:50px;text-align:right;"></span>';
  panelHtml += '</div></div>';

  // Stats
  panelHtml += '<div style="padding:8px 12px;border-bottom:1px solid var(--border);flex-shrink:0;display:flex;gap:10px;flex-wrap:wrap;align-items:center;">';
  panelHtml += '<div><strong style="font-size:16px;">' + (data.count || 0) + '</strong> <span style="font-size:10px;color:var(--muted);">' + t("wz_osm_total", "Total") + '</span></div>';
  if (newCount > 0) panelHtml += '<div><strong style="font-size:16px;color:#22c55e;">' + newCount + '</strong> <span style="font-size:10px;color:var(--muted);">' + t("wz_osm_new", "New") + '</span></div>';
  var tags = Object.keys(tagCounts).sort(function(a, b) { return tagCounts[b] - tagCounts[a]; });
  for (var ti = 0; ti < Math.min(tags.length, 6); ti++) {
    panelHtml += '<div><strong style="font-size:12px;">' + tagCounts[tags[ti]] + '</strong> <span style="font-size:9px;color:var(--muted);">' + _esc(tags[ti]) + '</span></div>';
  }
  panelHtml += '</div>';

  // Top contributors
  if (topUsers.length) {
    panelHtml += '<div style="padding:6px 12px;border-bottom:1px solid var(--border);flex-shrink:0;display:flex;gap:4px;flex-wrap:wrap;">';
    for (var u = 0; u < Math.min(topUsers.length, 8); u++) {
      panelHtml += '<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:var(--bg);border:1px solid var(--border);">' +
        _esc(topUsers[u].user) + ' <strong>' + topUsers[u].edits + '</strong></span>';
    }
    panelHtml += '</div>';
  }

  // Table header
  panelHtml += '<div style="display:flex;align-items:center;gap:6px;padding:5px 12px;border-bottom:2px solid var(--border);font-size:10px;color:var(--muted);text-transform:uppercase;flex-shrink:0;">' +
    '<span style="width:8px;"></span>' +
    '<span style="min-width:110px;">' + t("wz_osm_col_date", "Date / Time") + '</span>' +
    '<span style="min-width:60px;">' + t("wz_osm_col_category", "Category") + '</span>' +
    '<span style="flex:1;">' + t("wz_osm_col_name", "Name / Value") + '</span>' +
    '<span>' + t("wz_osm_col_user", "User") + '</span>' +
  '</div>';

  // Change list
  panelHtml += '<div id="osm-list" style="flex:1;overflow-y:auto;">';
  var showMax = Math.min(items.length, 150);
  for (var j = 0; j < showMax; j++) {
    var it = items[j];
    panelHtml += '<div class="osm-row" data-idx="' + j + '" data-ts="' + (new Date(it.timestamp).getTime() || 0) + '" ' +
      'style="display:flex;align-items:center;gap:6px;padding:4px 12px;border-bottom:1px solid var(--border);' +
      'font-size:11px;cursor:pointer;transition:background .15s,opacity .15s;">' +
      '<span style="width:8px;height:8px;border-radius:50%;background:' + (it.color || "#64748b") + ';flex-shrink:0;"></span>' +
      (it.is_new ? '<span style="font-size:8px;background:#22c55e20;color:#22c55e;padding:0 3px;border-radius:2px;">NEW</span>' : '') +
      '<span style="color:var(--muted);font-size:10px;min-width:110px;">' + _fmt(it.timestamp) + '</span>' +
      '<span style="min-width:60px;color:' + (it.color || "#64748b") + ';font-weight:600;font-size:10px;">' + _esc(it.category) + '</span>' +
      '<span style="flex:1;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
        _esc(it.name || it.tag_value || it.type + " " + it.id) + '</span>' +
      '<span style="color:var(--muted);font-size:10px;">' + _esc(it.user) + '</span>' +
    '</div>';
  }
  if (items.length > showMax) {
    panelHtml += '<div style="padding:6px 12px;font-size:11px;color:var(--muted);">\u2026 ' +
      (items.length - showMax) + ' ' + t("wz_osm_more", "more") + '</div>';
  }
  panelHtml += '</div>';

  panel.innerHTML = panelHtml;

  // Row hover/click
  panel.querySelectorAll(".osm-row").forEach(function(row) {
    var idx = parseInt(row.dataset.idx);
    row.addEventListener("mouseenter", function() { _osmHL(idx, true); });
    row.addEventListener("mouseleave", function() { _osmHL(idx, false); });
    row.addEventListener("click", function() {
      var entry = _osmMarkers.find(function(m) { return m.idx === idx; });
      if (entry && WZ._liveMap) {
        WZ._liveMap.setView(entry.marker.getLatLng(), Math.max(WZ._liveMap.getZoom(), 15));
        entry.marker.openPopup();
      }
    });
  });

  // ── Timelapse ──
  var playBtn = document.getElementById("wz-osm-play");
  var slider = document.getElementById("wz-osm-slider");
  var timeLabel = document.getElementById("wz-osm-play-time");

  function _setTimelapse(pct) {
    // pct 0..1 — show only items up to this point in time
    var cutoffMs = minTime + (maxTime - minTime) * pct;
    if (timeLabel) timeLabel.textContent = _fmt(new Date(cutoffMs).toISOString());
    // Show/hide markers + rows
    _osmMarkers.forEach(function(m) {
      var ts = _osmItems[m.idx] ? new Date(_osmItems[m.idx].timestamp).getTime() : 0;
      var visible = ts <= cutoffMs;
      m.marker.setStyle({ opacity: visible ? 1 : 0, fillOpacity: visible ? (m.origRadius > 4 ? 0.8 : 0.5) : 0 });
      var el = m.marker.getElement && m.marker.getElement();
      if (el) el.style.pointerEvents = visible ? "" : "none";
    });
    panel.querySelectorAll(".osm-row").forEach(function(row) {
      var ts = parseInt(row.dataset.ts) || 0;
      row.style.opacity = ts <= cutoffMs ? "1" : "0.15";
    });
  }

  if (slider) {
    slider.addEventListener("input", function() {
      _setTimelapse(parseInt(this.value) / 1000);
    });
  }

  var _animStart = null;
  var _TIMELAPSE_DURATION = 15000; // 15 seconds for full range

  function _animLoop(now) {
    if (!_osmPlaying) return;
    if (!_animStart) _animStart = now;
    var elapsed = now - _animStart;
    var pct = Math.min(elapsed / _TIMELAPSE_DURATION, 1);
    if (slider) slider.value = Math.round(pct * 1000);
    _setTimelapse(pct);
    if (pct < 1) {
      _osmAnimFrame = requestAnimationFrame(_animLoop);
    } else {
      _osmPlaying = false;
      if (playBtn) playBtn.innerHTML = "\u21BA " + t("wz_osm_restart", "Restart");
    }
  }

  if (playBtn) {
    playBtn.addEventListener("click", function() {
      if (_osmPlaying) {
        _osmPlaying = false;
        if (_osmAnimFrame) cancelAnimationFrame(_osmAnimFrame);
        this.innerHTML = "\u25B6 " + t("wz_osm_timelapse", "Timelapse");
        // Show all
        _setTimelapse(1);
        if (slider) slider.value = 1000;
      } else {
        _osmPlaying = true;
        _animStart = null;
        this.innerHTML = "\u23F8 " + t("wz_osm_pause", "Pause");
        _osmAnimFrame = requestAnimationFrame(_animLoop);
      }
    });
  }

  setTimeout(function() { if (WZ._liveMap) WZ._liveMap.invalidateSize(); }, 300);
}

function _osmHL(idx, active) {
  var entry = _osmMarkers.find(function(m) { return m.idx === idx; });
  if (entry) {
    if (active) {
      entry.marker.setStyle({ radius: entry.origRadius * 2.5, weight: 3, color: "#fff", fillOpacity: 0.95 });
      entry.marker.bringToFront();
      if (WZ._liveMap && !WZ._liveMap.getBounds().contains(entry.marker.getLatLng())) {
        WZ._liveMap.panTo(entry.marker.getLatLng());
      }
    } else {
      entry.marker.setStyle({ radius: entry.origRadius, weight: entry.origRadius > 4 ? 2 : 1, color: entry.origColor, fillOpacity: entry.origRadius > 4 ? 0.8 : 0.5 });
    }
  }
  var row = document.querySelector('.osm-row[data-idx="' + idx + '"]');
  if (row) {
    row.style.background = active ? "rgba(124,179,66,.12)" : "";
    if (active) row.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

// Cleanup
WZ._onLiveClose.push(function() {
  _osmMarkers = [];
  _osmItems = [];
  _osmPlaying = false;
  if (_osmAnimFrame) cancelAnimationFrame(_osmAnimFrame);
  var panel = document.getElementById("wz-osm-panel");
  if (panel) panel.remove();
  var chart = document.getElementById("wz-osm-chart");
  if (chart) chart.remove();
  // Restore map element out of left-col wrapper
  var leftCol = document.getElementById("wz-osm-left");
  if (leftCol) {
    var mapEl = document.getElementById("wz-live-map");
    var mapRow = document.getElementById("wz-map-row");
    if (mapEl && mapRow) { mapRow.insertBefore(mapEl, leftCol); }
    leftCol.remove();
  }
});

WZ.registerPlugin("osm_changes", {
  renderer: _renderOSMLive,
  openStrategy: "spinner",
  live_title_prefix: "OSM:",
  live_title_i18n: "wz_osm_title",
  live_box_max_width: "1400px",
  live_box_height: "75vh",
  default_source: "overpass",
});

// Collect Renderer
WZ._collectRenderers["osm_changes"] = {
  renderHTML: function(data, cardId) {
    var h = "", fmtD = WZ._fmtDate || function(s) { return s ? String(s).slice(0,10) : ""; };
    h += '<div id="' + cardId + '-map" style="height:400px;border-radius:6px;margin-bottom:8px;"></div>';
    // Summary stats
    h += '<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:10px;">';
    h += '<div style="text-align:center;"><div style="font-size:20px;font-weight:800;color:var(--text);">' + (data.count || 0) + '</div><div style="font-size:9px;color:var(--muted);">\u00c4nderungen</div></div>';
    if (data.new_count) h += '<div style="text-align:center;"><div style="font-size:20px;font-weight:800;color:#22c55e;">' + data.new_count + '</div><div style="font-size:9px;color:var(--muted);">Neu erstellt</div></div>';
    var tc = data.tag_counts || {};
    Object.keys(tc).slice(0, 5).forEach(function(t) {
      h += '<div style="text-align:center;"><div style="font-size:16px;font-weight:700;color:var(--text);">' + tc[t] + '</div><div style="font-size:9px;color:var(--muted);max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + WZ._esc(t) + '</div></div>';
    });
    h += '</div>';
    // Top contributors
    if (data.top_users && data.top_users.length) {
      h += '<div style="font-size:10px;color:var(--muted);margin-bottom:6px;">Top-Bearbeiter: ';
      h += data.top_users.slice(0, 5).map(function(u) { return '<strong>' + WZ._esc(u.user) + '</strong> (' + u.edits + ')'; }).join(', ');
      h += '</div>';
    }
    // Items table
    if (data.items && data.items.length) {
      h += '<table style="width:100%;font-size:11px;border-collapse:collapse;">';
      h += '<thead><tr style="border-bottom:1px solid var(--border);color:var(--muted);">'
        + '<th style="text-align:left;padding:3px 6px;">Datum</th>'
        + '<th style="text-align:left;padding:3px 6px;">Kategorie</th>'
        + '<th style="text-align:left;padding:3px 6px;">Name / Tag</th>'
        + '<th style="text-align:left;padding:3px 6px;">Bearbeiter</th>'
        + '<th style="text-align:center;padding:3px 6px;">V</th>'
        + '</tr></thead><tbody>';
      data.items.slice(0, 15).forEach(function(it, idx) {
        var isNew = it.is_new || it.version === 1;
        h += '<tr class="wz-osm-row" data-idx="' + idx + '" style="border-bottom:1px solid rgba(255,255,255,.05);cursor:pointer;">';
        h += '<td style="padding:3px 6px;white-space:nowrap;">' + fmtD(it.timestamp) + '</td>';
        h += '<td style="padding:3px 6px;color:' + (it.color || "var(--text)") + ';">' + WZ._esc(it.category || "") + '</td>';
        h += '<td style="padding:3px 6px;">' + WZ._esc((it.name || it.tag_value || "").substring(0, 30)) + '</td>';
        h += '<td style="padding:3px 6px;color:var(--muted);">' + WZ._esc(it.user || "") + '</td>';
        h += '<td style="padding:3px 6px;text-align:center;">' + (isNew ? '<span style="color:#22c55e;font-weight:700;">NEU</span>' : it.version || "") + '</td>';
        h += '</tr>';
      });
      h += '</tbody></table>';
      if (data.items.length > 15) h += '<div style="font-size:10px;color:var(--muted);margin-top:4px;">+ ' + (data.items.length - 15) + ' weitere</div>';
    }
    return h;
  },
  afterRender: function(data, cardId, cardEl) {
    if (!window.L) return;
    var mapEl = cardEl.querySelector("[id$='-map']");
    if (!mapEl || mapEl._leaflet_id) return;
    var items = data.items || [];
    var m = L.map(mapEl, { zoomControl: false }).setView([30, 10], 2);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png", { maxZoom: 18 }).addTo(m);
    var bounds = [];
    var markers = [];
    items.slice(0, 15).forEach(function(it, idx) {
      if (it.lat == null || it.lon == null) { markers.push(null); return; }
      var col = it.color || "#06b6d4";
      var mk = L.circleMarker([it.lat, it.lon], { radius: 5, color: col, fillColor: col, fillOpacity: 0.5, weight: 1 })
        .bindTooltip('<strong>' + WZ._esc(it.name || it.tag_value || "") + '</strong><br>' + WZ._esc(it.category || ""))
        .addTo(m);
      markers.push(mk);
      bounds.push([it.lat, it.lon]);
    });
    if (bounds.length) { try { m.fitBounds(bounds, { padding: [20, 20], maxZoom: 12 }); } catch(e) {} }

    // Hover on table rows → highlight marker + pan
    var highlightMk = null;
    cardEl.querySelectorAll(".wz-osm-row").forEach(function(row) {
      row.addEventListener("mouseenter", function() {
        var idx = parseInt(row.getAttribute("data-idx"));
        var mk = markers[idx];
        if (!mk) return;
        // Highlight
        if (highlightMk) highlightMk.setStyle({ radius: 5, weight: 1 });
        mk.setStyle({ radius: 10, weight: 3, color: "#fff" });
        highlightMk = mk;
        mk.openTooltip();
        // Pan if not visible
        var ll = mk.getLatLng();
        if (!m.getBounds().contains(ll)) {
          m.panTo(ll, { animate: true, duration: 0.5 });
        }
      });
      row.addEventListener("mouseleave", function() {
        if (highlightMk) {
          var idx = parseInt(row.getAttribute("data-idx"));
          var it = items[idx];
          var col = (it && it.color) || "#06b6d4";
          highlightMk.setStyle({ radius: 5, weight: 1, color: col });
          highlightMk.closeTooltip();
          highlightMk = null;
        }
      });
    });
  }
};

})();
