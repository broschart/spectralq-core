/**
 * WZ Module: OpenAQ Air Quality renderer.
 */
(function() {
"use strict";
var WZ = window.WZ;
var t = window._t || function(k, fb) { return fb; };

var _aqMarkers = [];

function _renderAirQualityLive(data) {
  var items = data.items || [];

  document.getElementById("wz-live-count").textContent =
    (data.count || 0) + " " + t("wz_aq_count", "monitoring stations");

  if (WZ._liveMarkers) WZ._liveMarkers.clearLayers();
  _aqMarkers = [];

  if (WZ._liveMap && items.length) {
    for (var i = 0; i < items.length; i++) {
      var s = items[i];
      if (s.lat == null || s.lon == null) continue;
      var pm = s.pm25;
      var color = s.aqi_color || "#64748b";
      var r = pm != null ? Math.max(5, Math.min(14, 5 + pm / 10)) : 5;

      var circle = L.circleMarker([s.lat, s.lon], {
        radius: r, color: color, fillColor: color,
        fillOpacity: 0.7, weight: pm != null && pm > 55 ? 2 : 1,
      });

      var paramHtml = "";
      var params = s.params || {};
      var pKeys = Object.keys(params);
      for (var pi = 0; pi < pKeys.length; pi++) {
        var pk = pKeys[pi];
        var pv = params[pk];
        if (pv.value != null) {
          paramHtml += '<div style="display:flex;justify-content:space-between;gap:8px;">' +
            '<span style="color:var(--muted);">' + _esc(pk) + '</span>' +
            '<span style="font-weight:600;">' + pv.value + ' ' + _esc(pv.unit) + '</span></div>';
        }
      }

      circle.bindPopup(
        '<div style="font-size:12px;min-width:180px;">' +
        '<div style="font-weight:700;margin-bottom:4px;">' + _esc(s.name) + '</div>' +
        (s.locality ? '<div style="font-size:11px;color:var(--muted);margin-bottom:4px;">' + _esc(s.locality) + ', ' + _esc(s.country) + '</div>' : '') +
        (pm != null ? '<div style="font-size:16px;font-weight:800;color:' + color + ';margin-bottom:4px;">PM2.5: ' + pm + ' µg/m³</div>' : '') +
        '<div style="padding:4px 8px;border-radius:4px;background:' + color + '20;color:' + color + ';font-weight:600;font-size:11px;display:inline-block;margin-bottom:6px;">' + _esc(s.aqi_label) + '</div>' +
        paramHtml +
        '</div>'
      );
      WZ._liveMarkers.addLayer(circle);
      _aqMarkers.push({ marker: circle, idx: i, origRadius: r, origColor: color });

      circle.on("mouseover", _makeHL(i, true));
      circle.on("mouseout",  _makeHL(i, false));
    }
  }

  // Content panel
  var content = document.getElementById("wz-live-content");
  var html = '<div style="padding:12px 16px;">';

  // Stats bar
  html += '<div style="margin-bottom:12px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 16px;">';
  html += '<div style="display:flex;gap:20px;flex-wrap:wrap;align-items:center;">';
  html += '<div style="text-align:center;">' +
    '<div style="font-size:22px;font-weight:800;color:var(--text);">' + (data.count || 0) + '</div>' +
    '<div style="font-size:10px;color:var(--muted);text-transform:uppercase;">' + t("wz_aq_count","Stations") + '</div></div>';
  if (data.avg_pm25 != null) {
    html += '<div style="text-align:center;">' +
      '<div style="font-size:28px;font-weight:800;color:' + (data.avg_color || "#64748b") + ';">' + data.avg_pm25 + '</div>' +
      '<div style="font-size:10px;color:var(--muted);text-transform:uppercase;">⌀ PM2.5 µg/m³</div></div>';
    html += '<div style="text-align:center;">' +
      '<div style="padding:4px 12px;border-radius:6px;background:' + (data.avg_color || "#64748b") + '20;' +
        'color:' + (data.avg_color || "#64748b") + ';font-weight:700;font-size:14px;">' + _esc(data.avg_label || "?") + '</div>' +
      '<div style="font-size:10px;color:var(--muted);margin-top:2px;">' + t("wz_aq_quality","Quality") + '</div></div>';
  }
  if (data.worst_pm25 != null && data.worst_pm25 > (data.avg_pm25 || 0) * 1.5) {
    html += '<div style="text-align:center;">' +
      '<div style="font-size:22px;font-weight:800;color:#dc2626;">' + data.worst_pm25 + '</div>' +
      '<div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Max PM2.5</div></div>';
  }
  html += '</div></div>';

  // Station list
  html += '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;">';
  html += '<div style="padding:10px 14px;border-bottom:1px solid var(--border);font-size:12px;font-weight:600;">' +
    t("wz_aq_header","Monitoring stations in zone") + '</div>';

  if (!items.length) {
    html += '<div style="padding:20px;text-align:center;color:var(--muted);font-size:12px;">' +
      t("wz_aq_empty","No monitoring stations in this region.") + '</div>';
  } else {
    html += '<div id="aq-list" style="max-height:350px;overflow-y:auto;">';
    for (var j = 0; j < items.length; j++) {
      var st = items[j];
      var stColor = st.aqi_color || "#64748b";
      var stPm = st.pm25;
      html += '<div class="aq-row" data-idx="' + j + '" ' +
        'style="display:flex;align-items:center;gap:8px;padding:6px 14px;border-bottom:1px solid var(--border);' +
        'font-size:12px;cursor:pointer;transition:background .15s;">' +
        '<span style="width:10px;height:10px;border-radius:50%;background:' + stColor + ';flex-shrink:0;"></span>' +
        '<span style="flex:1;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
          _esc(st.name) + (st.locality ? ' <span style="color:var(--muted);font-size:10px;">' + _esc(st.locality) + '</span>' : '') +
        '</span>' +
        (stPm != null ?
          '<span style="font-weight:700;color:' + stColor + ';min-width:60px;text-align:right;">' + stPm + ' µg/m³</span>' +
          '<span style="font-size:10px;padding:1px 6px;border-radius:3px;background:' + stColor + '18;color:' + stColor + ';">' + _esc(st.aqi_label) + '</span>'
        : '<span style="color:var(--muted);font-size:10px;">–</span>') +
      '</div>';
    }
    html += '</div>';
  }
  html += '</div></div>';
  content.innerHTML = html;

  // Hover binding
  document.querySelectorAll(".aq-row").forEach(function(row) {
    var idx = parseInt(row.dataset.idx);
    row.addEventListener("mouseenter", function() { _aqHighlight(idx, true); });
    row.addEventListener("mouseleave", function() { _aqHighlight(idx, false); });
    row.addEventListener("click", function() {
      var entry = _aqMarkers.find(function(m) { return m.idx === idx; });
      if (entry && WZ._liveMap) {
        WZ._liveMap.setView(entry.marker.getLatLng(), Math.max(WZ._liveMap.getZoom(), 12));
        entry.marker.openPopup();
      }
    });
  });
}

function _makeHL(idx, active) { return function() { _aqHighlight(idx, active); }; }

function _aqHighlight(idx, active) {
  var entry = _aqMarkers.find(function(m) { return m.idx === idx; });
  if (entry) {
    if (active) {
      entry.marker.setStyle({ radius: entry.origRadius * 2, weight: 3, color: "#fff", fillOpacity: 0.95 });
      entry.marker.bringToFront();
    } else {
      entry.marker.setStyle({ radius: entry.origRadius, weight: 1, color: entry.origColor, fillOpacity: 0.7 });
    }
  }
  var row = document.querySelector('.aq-row[data-idx="' + idx + '"]');
  if (row) {
    row.style.background = active ? "rgba(34,197,94,.1)" : "";
    if (active) row.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

function _esc(s) {
  if (!s) return "";
  var d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

WZ.registerPlugin("airquality", {
  renderer: _renderAirQualityLive,
  default_source: "openaq",
});

})();
