/**
 * WZ Module: Radiation monitoring (BfS ODL + EURDEP) — side panel + playback.
 */
(function() {
"use strict";
var WZ = window.WZ;
var t = window._t || function(k, fb) { return fb; };

var NORMAL_MAX = 0.3;
var _radMarkers = [];
var _radStations = [];
var _radPlayTimer = null;
var _radPlaying = false;
var _radPlayIdx = 0;
var _radZoneId = null;
var _radSource = "odl";

function _fmtDT(iso) {
  if (!iso) return "";
  return window.fmtDate ? window.fmtDate(iso) : iso.replace("T", " ").slice(0, 16);
}
function _valColor(v) {
  return v == null ? "#888" : v > NORMAL_MAX ? "#ef4444" : v > 0.15 ? "#eab308" : "#22c55e";
}

// ── Live-Ansicht rendern ────────────────────────────────────────────────
function _renderRadiationLive(data) {
  var count = data.count || 0;
  var elevated = data.elevated_count || 0;
  var source = data.source || "odl";
  _radStations = data.stations || [];
  _radZoneId = data.zone_id || WZ._liveZoneId;
  _radSource = data.source || "odl";
  _radMarkers = [];
  _radStop();

  document.getElementById("wz-live-count").textContent =
    count + " " + t("wz_rad_stations", "Stations") +
    (elevated > 0 ? " \u00b7 " + elevated + " " + t("wz_rad_elevated", "Elevated") : "");

  var stations = _radStations;
  var elevatedList = data.elevated || [];

  // ── Layout ──
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

  // ── Marker ──
  if (WZ._liveMarkers) WZ._liveMarkers.clearLayers();
  if (WZ._liveMap && stations.length) {
    for (var i = 0; i < stations.length; i++) {
      var s = stations[i];
      if (!s.lat || !s.lon) continue;
      var val = s.value;
      var clr = _valColor(val);
      var isEl = val != null && val > NORMAL_MAX;
      var radius = isEl ? 7 : 5;
      var marker = L.circleMarker([s.lat, s.lon], {
        radius: radius, fillColor: clr, color: isEl ? "#fff" : clr,
        weight: isEl ? 2 : 1, fillOpacity: 0.85,
      });
      marker.bindPopup(
        '<div style="font-size:12px;min-width:160px;">' +
        '<div style="font-weight:700;margin-bottom:4px;">' + _esc(s.name) + '</div>' +
        '<div style="display:flex;justify-content:space-between;"><span>ID:</span><span style="font-family:monospace;">' + _esc(s.kenn || s.id) + '</span></div>' +
        '<div style="display:flex;justify-content:space-between;"><span>' + t("wz_rad_dose_rate", "Dose rate") + ':</span>' +
        '<span style="font-weight:700;color:' + clr + ';">' + (val != null ? val.toFixed(3) : "\u2013") + ' ' + _esc(s.unit) + '</span></div>' +
        (s.height ? '<div style="display:flex;justify-content:space-between;"><span>' + t("wz_rad_height", "Elevation") + ':</span><span>' + s.height + ' m</span></div>' : "") +
        '<div style="font-size:10px;color:#888;margin-top:4px;">' + _fmtDT(s.end || s.start) + '</div></div>'
      );
      if (WZ._liveMarkers) WZ._liveMarkers.addLayer(marker);
      (function(idx, m) {
        m.on("mouseover", function() { _radHighlight(idx, true); });
        m.on("mouseout",  function() { _radHighlight(idx, false); });
      })(i, marker);
      _radMarkers.push({ marker: marker, idx: i, origRadius: radius, origColor: clr, lat: s.lat, lon: s.lon, kenn: s.kenn || s.id });
    }
  }

  // ── Seitenpanel ──
  var panel = document.getElementById("rad-side-panel");
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "rad-side-panel";
    panel.style.cssText = "width:420px;flex-shrink:0;border-left:1px solid var(--border);background:var(--surface);display:flex;flex-direction:column;overflow:hidden;";
    mapRow.appendChild(panel);
  }
  panel.style.display = "flex";

  if (!stations.length) {
    panel.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);">' +
      t("wz_rad_no_data", "No measurement data in this zone") + '</div>';
    setTimeout(function() { if (WZ._liveMap) WZ._liveMap.invalidateSize(); }, 200);
    return;
  }

  var vals = stations.filter(function(s) { return s.value != null; }).map(function(s) { return s.value; });
  var avg = vals.length ? vals.reduce(function(a, b) { return a + b; }, 0) / vals.length : 0;
  var maxVal = vals.length ? Math.max.apply(null, vals) : 0;
  var srcLabel = source === "odl" ? t("wz_rad_source_odl", "BfS ODL") : t("wz_rad_source_eurdep", "EURDEP");

  var html = '';

  // ── Play-Bar ──
  html += '<div id="rad-play-bar" style="padding:8px 12px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px;flex-shrink:0;">';
  html += '<button id="rad-play-btn" onclick="_radTogglePlay()" style="background:var(--accent1);color:#fff;border:none;border-radius:6px;padding:5px 12px;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:4px;">';
  html += '<span id="rad-play-icon">&#9654;</span> <span id="rad-play-label">' + t("wz_rad_play", "Play") + '</span></button>';
  // Modus-Toggle
  if (source === "odl") {
    html += '<div style="display:flex;border:1px solid var(--border);border-radius:5px;overflow:hidden;font-size:10px;font-weight:600;">';
    html += '<button id="rad-mode-1h" onclick="_radSetMode(\'1h\')" style="padding:3px 8px;border:none;cursor:pointer;background:var(--accent1);color:#fff;">7 ' + t("wz_rad_days", "days") + '</button>';
    html += '<button id="rad-mode-24h" onclick="_radSetMode(\'24h\')" style="padding:3px 8px;border:none;cursor:pointer;background:var(--surface2);color:var(--muted);">180 ' + t("wz_rad_days", "days") + '</button>';
    html += '</div>';
  } else {
    html += '<span style="font-size:10px;color:var(--muted);">' + t("wz_rad_trend_mode", "Trend 6h\u201972h") + '</span>';
  }
  html += '<div id="rad-play-progress" style="flex:1;height:12px;background:var(--border);border-radius:3px;overflow:hidden;position:relative;">';
  html += '<div id="rad-play-fill" style="position:absolute;left:0;top:0;height:100%;width:0%;background:rgba(234,179,8,.3);border-radius:3px;z-index:1;"></div>';
  html += '<div id="rad-play-ticks" style="position:absolute;inset:0;z-index:2;"></div></div>';
  html += '<span id="rad-play-date" style="font-size:11px;color:var(--muted);min-width:100px;text-align:right;"></span>';
  html += '</div>';

  // ── Stats-Bar ──
  html += '<div style="padding:8px 12px;border-bottom:1px solid var(--border);display:flex;gap:14px;flex-wrap:wrap;align-items:center;flex-shrink:0;">';
  html += '<div style="text-align:center;"><div style="font-size:18px;font-weight:800;color:var(--text);">' + count + '</div><div style="font-size:9px;color:var(--muted);text-transform:uppercase;">' + t("wz_rad_stations", "Stations") + '</div></div>';
  html += '<div style="text-align:center;"><div style="font-size:18px;font-weight:800;color:' + (avg > NORMAL_MAX ? '#ef4444' : '#22c55e') + ';">' + avg.toFixed(3) + '</div><div style="font-size:9px;color:var(--muted);text-transform:uppercase;">\u00d8 \u00b5Sv/h</div></div>';
  html += '<div style="text-align:center;"><div style="font-size:18px;font-weight:800;color:' + (maxVal > NORMAL_MAX ? '#ef4444' : '#eab308') + ';">' + maxVal.toFixed(3) + '</div><div style="font-size:9px;color:var(--muted);text-transform:uppercase;">Max \u00b5Sv/h</div></div>';
  html += '<div style="text-align:center;"><div style="font-size:18px;font-weight:800;color:' + (elevated > 0 ? '#ef4444' : '#22c55e') + ';">' + elevated + '</div><div style="font-size:9px;color:var(--muted);text-transform:uppercase;">' + t("wz_rad_elevated", "Elevated") + '</div></div>';
  html += '<span style="margin-left:auto;font-size:10px;color:var(--muted);background:var(--bg);padding:2px 8px;border-radius:4px;">' + srcLabel + '</span></div>';

  // ── Elevated Warning ──
  if (elevatedList.length) {
    html += '<div style="padding:8px 12px;border-bottom:1px solid var(--border);background:rgba(239,68,68,.06);flex-shrink:0;">';
    html += '<div style="font-size:10px;font-weight:700;color:#ef4444;text-transform:uppercase;margin-bottom:4px;">\u26a0 ' + t("wz_rad_elevated", "Elevated") + ' (' + elevatedList.length + ')</div>';
    for (var e = 0; e < Math.min(elevatedList.length, 10); e++) {
      var es = elevatedList[e];
      html += '<div style="display:flex;align-items:center;gap:6px;padding:2px 0;font-size:11px;"><span style="font-weight:700;color:#ef4444;min-width:60px;font-family:monospace;">' + (es.value != null ? es.value.toFixed(3) : "\u2013") + '</span><span style="color:var(--text);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _esc(es.name) + '</span></div>';
    }
    html += '</div>';
  }

  // ── Tabellenkopf ──
  html += '<div style="display:flex;align-items:center;gap:6px;padding:6px 10px;border-bottom:2px solid var(--border);font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;flex-shrink:0;">';
  html += '<span style="min-width:60px;text-align:right;">\u00b5Sv/h</span>';
  html += '<span style="flex:1;">Station</span>';
  html += '<span style="min-width:100px;">' + t("wz_rad_time", "Measured") + '</span>';
  html += '<span style="min-width:50px;text-align:center;">Status</span>';
  html += '<span style="min-width:40px;text-align:right;">' + t("wz_rad_height", "Elev.") + '</span></div>';

  // ── Scrollbare Liste ──
  html += '<div id="rad-list" style="flex:1;overflow-y:auto;min-height:0;font-size:11px;">';
  var showMax = Math.min(stations.length, 200);
  for (var i = 0; i < showMax; i++) {
    var st = stations[i];
    var v = st.value;
    var vClr = _valColor(v);
    var timeStr = st.end || st.start || "";
    html += '<div class="rad-row" data-idx="' + i + '" style="display:flex;align-items:center;gap:6px;padding:5px 10px;border-bottom:1px solid var(--border);cursor:pointer;transition:background .15s;">';
    html += '<span style="font-weight:700;color:' + vClr + ';min-width:60px;text-align:right;font-family:monospace;">' + (v != null ? v.toFixed(3) : "\u2013") + '</span>';
    html += '<span style="flex:1;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _esc(st.name) + ' <span style="color:var(--muted);font-size:10px;">' + _esc(st.kenn || st.id) + '</span></span>';
    html += '<span style="color:var(--muted);min-width:100px;white-space:nowrap;font-size:10px;">' + (timeStr ? _fmtDT(timeStr) : "\u2013") + '</span>';
    html += '<span style="color:var(--muted);min-width:50px;text-align:center;font-size:10px;">' + _esc(st.status) + '</span>';
    html += '<span style="color:var(--muted);min-width:40px;text-align:right;">' + (st.height ? st.height + 'm' : "\u2013") + '</span>';
    html += '</div>';
  }
  if (stations.length > showMax) {
    html += '<div style="padding:6px 10px;font-size:10px;color:var(--muted);text-align:center;">+ ' + (stations.length - showMax) + ' ' + t("wz_seismic_more", "more") + '</div>';
  }
  html += '</div>';

  panel.innerHTML = html;

  // ── Liste ↔ Karte Hover ──
  panel.querySelectorAll(".rad-row").forEach(function(row) {
    var idx = parseInt(row.dataset.idx);
    row.addEventListener("mouseenter", function() { _radHighlight(idx, true); });
    row.addEventListener("mouseleave", function() { _radHighlight(idx, false); });
    row.addEventListener("click", function() {
      var entry = _radMarkers.find(function(m) { return m.idx === idx; });
      if (entry && WZ._liveMap) {
        WZ._liveMap.setView(entry.marker.getLatLng(), Math.max(WZ._liveMap.getZoom(), 12));
        entry.marker.openPopup();
      }
    });
  });

  setTimeout(function() { if (WZ._liveMap) WZ._liveMap.invalidateSize(); }, 200);
}

// ── Highlight ─────────────────────────────────────────────────────────
function _radHighlight(idx, active) {
  var entry = _radMarkers.find(function(m) { return m.idx === idx; });
  if (entry) {
    if (active) {
      entry.marker.setStyle({ radius: entry.origRadius * 2, weight: 3, color: "#fff", fillOpacity: 0.95 });
      entry.marker.bringToFront();
    } else {
      var isEl = entry.origColor === "#ef4444";
      entry.marker.setStyle({ radius: entry.origRadius, weight: isEl ? 2 : 1, color: isEl ? "#fff" : entry.origColor, fillOpacity: 0.85 });
    }
  }
  var row = document.querySelector('.rad-row[data-idx="' + idx + '"]');
  if (row) {
    row.style.background = active ? "rgba(234,179,8,.15)" : "";
    if (active) row.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

// ── Playback ──────────────────────────────────────────────────────────
var _radMode = "1h";
var _radTsData = null;  // cached timeseries

function _radStop() {
  if (_radPlayTimer) { clearTimeout(_radPlayTimer); _radPlayTimer = null; }
  _radPlaying = false;
  _radPlayIdx = 0;
  var btn = document.getElementById("rad-play-icon");
  var lbl = document.getElementById("rad-play-label");
  if (btn) btn.textContent = "\u25b6";
  if (lbl) lbl.textContent = t("wz_rad_play", "Play");
  var fill = document.getElementById("rad-play-fill");
  if (fill) fill.style.width = "0%";
  var dateEl = document.getElementById("rad-play-date");
  if (dateEl) dateEl.textContent = "";
}

window._radSetMode = function(mode) {
  _radMode = mode;
  _radTsData = null;  // reset cache
  _radStop();
  var btn1 = document.getElementById("rad-mode-1h");
  var btn2 = document.getElementById("rad-mode-24h");
  if (btn1) { btn1.style.background = mode === "1h" ? "var(--accent1)" : "var(--surface2)"; btn1.style.color = mode === "1h" ? "#fff" : "var(--muted)"; }
  if (btn2) { btn2.style.background = mode === "24h" ? "var(--accent1)" : "var(--surface2)"; btn2.style.color = mode === "24h" ? "#fff" : "var(--muted)"; }
};

window._radTogglePlay = async function() {
  if (_radPlaying) { _radStop(); _restoreMarkers(); return; }
  if (!_radZoneId) return;

  var btn = document.getElementById("rad-play-icon");
  var lbl = document.getElementById("rad-play-label");

  // Fetch timeseries if not cached
  if (!_radTsData) {
    if (btn) btn.textContent = "\u23f3";
    if (lbl) lbl.textContent = t("wz_rad_loading_ts", "Loading...");
    try {
      var resp = await fetch("/api/watchzones/" + _radZoneId + "/radiation-batch-ts?hours=" + _radMode);
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      _radTsData = await resp.json();
    } catch(e) {
      if (lbl) lbl.textContent = t("wz_rad_ts_error", "Error");
      setTimeout(function() { if (lbl) lbl.textContent = t("wz_rad_play", "Play"); if (btn) btn.textContent = "\u25b6"; }, 2000);
      return;
    }
  }

  var tsStations = _radTsData.stations || {};
  var isTrend = _radTsData.mode === "trend";

  if (isTrend) {
    // ── EURDEP Trend-Playback: 72h → 48h → 24h → 12h → 6h ──
    var windows = [72, 48, 24, 12, 6];
    var windowLabels = ["72h", "48h", "24h", "12h", "6h"];

    // Build lookup: for each window, get value per station id
    var trendIndex = {};
    windows.forEach(function(w) { trendIndex[w] = {}; });
    Object.keys(tsStations).forEach(function(sid) {
      var st = tsStations[sid];
      (st.trend || []).forEach(function(dp) {
        if (dp.window_h && trendIndex[dp.window_h]) {
          trendIndex[dp.window_h][sid] = dp.value;
        }
      });
    });

    // Check we have data
    var hasData = windows.some(function(w) { return Object.keys(trendIndex[w]).length > 0; });
    if (!hasData) {
      _radStop();
      var dateEl = document.getElementById("rad-play-date");
      if (dateEl) dateEl.textContent = t("wz_rad_no_ts", "No timeseries data");
      return;
    }

    // Ticks on progress bar (5 equal steps)
    var ticksEl = document.getElementById("rad-play-ticks");
    if (ticksEl) {
      var tickHtml = "";
      for (var ti = 0; ti < windows.length; ti++) {
        var pct = (ti / (windows.length - 1) * 100).toFixed(1);
        tickHtml += '<div style="position:absolute;left:' + pct + '%;top:0;width:2px;height:12px;background:rgba(234,179,8,.5);border-radius:1px;" title="' + windowLabels[ti] + '"></div>';
      }
      ticksEl.innerHTML = tickHtml;
    }

    _radPlaying = true;
    _radPlayIdx = 0;
    if (btn) btn.textContent = "\u23f8";
    if (lbl) lbl.textContent = t("wz_rad_stop", "Stop");

    function _trendStep() {
      if (!_radPlaying || _radPlayIdx >= windows.length) { _radStop(); _restoreMarkers(); return; }

      var w = windows[_radPlayIdx];
      var vals = trendIndex[w] || {};

      _radMarkers.forEach(function(m) {
        var sid = _radStations[m.idx] ? (_radStations[m.idx].id || _radStations[m.idx].kenn) : "";
        var v = vals[sid];
        if (v != null) {
          var clr = _valColor(v);
          m.marker.setStyle({ fillColor: clr, color: v > NORMAL_MAX ? "#fff" : clr, fillOpacity: 0.85, radius: v > NORMAL_MAX ? 8 : 5 });
        } else {
          m.marker.setStyle({ fillOpacity: 0.15, radius: 3 });
        }
      });

      var fill = document.getElementById("rad-play-fill");
      if (fill) fill.style.width = Math.round((_radPlayIdx + 1) / windows.length * 100) + "%";
      var dateEl = document.getElementById("rad-play-date");
      if (dateEl) dateEl.textContent = "\u2190 " + windowLabels[_radPlayIdx] + " " + t("wz_rad_ago", "ago");

      _radPlayIdx++;

      if (_radPlayIdx < windows.length) {
        _radPlayTimer = setTimeout(_trendStep, 2000);
      } else {
        _radPlayTimer = setTimeout(function() { _radStop(); _restoreMarkers(); }, 2000);
      }
    }

    _trendStep();

  } else {
    // ── ODL Timeseries-Playback ──
    var allTimes = new Set();
    Object.values(tsStations).forEach(function(st) {
      (st.series || []).forEach(function(dp) { if (dp.time) allTimes.add(dp.time); });
    });
    var timeline = Array.from(allTimes).sort();
    if (timeline.length < 2) {
      _radStop();
      var dateEl2 = document.getElementById("rad-play-date");
      if (dateEl2) dateEl2.textContent = t("wz_rad_no_ts", "No timeseries data");
      return;
    }

    var timeIndex = {};
    Object.keys(tsStations).forEach(function(kenn) {
      var st = tsStations[kenn];
      (st.series || []).forEach(function(dp) {
        if (!timeIndex[dp.time]) timeIndex[dp.time] = {};
        timeIndex[dp.time][kenn] = dp.value;
      });
    });

    var tsMs = timeline.map(function(ti) { return new Date(ti + "Z").getTime(); });
    var tMin = tsMs[0], tMax = tsMs[tsMs.length - 1];
    var realSpan = Math.max(1, tMax - tMin);
    var DURATION = 60000;
    var scale = DURATION / realSpan;

    var ticksEl2 = document.getElementById("rad-play-ticks");
    if (ticksEl2) {
      var tickH = "";
      for (var tj = 0; tj < tsMs.length; tj++) {
        var pc = ((tsMs[tj] - tMin) / realSpan * 100).toFixed(2);
        tickH += '<div style="position:absolute;left:' + pc + '%;top:4px;width:1px;height:4px;background:rgba(234,179,8,.5);"></div>';
      }
      ticksEl2.innerHTML = tickH;
    }

    _radPlaying = true;
    _radPlayIdx = 0;
    if (btn) btn.textContent = "\u23f8";
    if (lbl) lbl.textContent = t("wz_rad_stop", "Stop");

    function _step() {
      if (!_radPlaying || _radPlayIdx >= timeline.length) { _radStop(); _restoreMarkers(); return; }

      var curTime = timeline[_radPlayIdx];
      var vals = timeIndex[curTime] || {};

      _radMarkers.forEach(function(m) {
        var v = vals[m.kenn];
        if (v != null) {
          var clr = _valColor(v);
          m.marker.setStyle({ fillColor: clr, color: v > NORMAL_MAX ? "#fff" : clr, fillOpacity: 0.85, radius: v > NORMAL_MAX ? 8 : 5 });
        } else {
          m.marker.setStyle({ fillOpacity: 0.15, radius: 3 });
        }
      });

      var fill = document.getElementById("rad-play-fill");
      if (fill) fill.style.width = Math.round((_radPlayIdx + 1) / timeline.length * 100) + "%";
      var dateEl3 = document.getElementById("rad-play-date");
      if (dateEl3) dateEl3.textContent = _fmtDT(curTime);

      _radPlayIdx++;

      if (_radPlayIdx < timeline.length) {
        var gap = tsMs[_radPlayIdx] - tsMs[_radPlayIdx - 1];
        var delay = Math.max(20, Math.min(3000, gap * scale));
        _radPlayTimer = setTimeout(_step, delay);
      } else {
        _radPlayTimer = setTimeout(function() { _radStop(); _restoreMarkers(); }, 1500);
      }
    }

    _step();
  }
};

function _restoreMarkers() {
  _radMarkers.forEach(function(m) {
    var st = _radStations[m.idx];
    if (!st) return;
    var v = st.value;
    var clr = _valColor(v);
    var isEl = v != null && v > NORMAL_MAX;
    m.marker.setStyle({ fillColor: clr, color: isEl ? "#fff" : clr, fillOpacity: 0.85, radius: m.origRadius, weight: isEl ? 2 : 1 });
  });
}

function _esc(s) {
  if (!s) return "";
  var d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

WZ._onLiveClose.push(function() {
  _radStop();
  _radTsData = null;
  var panel = document.getElementById("rad-side-panel");
  if (panel) { panel.style.display = "none"; panel.innerHTML = ""; }
  _radMarkers = [];
});

WZ.registerPlugin("radiation", {
  renderer: _renderRadiationLive,
  has_heatmap: false,
});

})();
