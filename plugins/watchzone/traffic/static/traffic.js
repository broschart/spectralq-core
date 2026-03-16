/**
 * WZ Module: TomTom Traffic renderer.
 */
(function() {
"use strict";
var WZ = window.WZ;
var t = window._t || function(k, fb) { return fb; };

var _trafficMarkers = [];

function _renderTrafficLive(data) {
  var items = data.items || [];
  var flow = data.flow_samples || [];
  var severe = data.severe_count || 0;

  document.getElementById("wz-live-count").textContent =
    (data.count || 0) + " " + t("wz_traffic_count", "incidents") +
    (severe > 0 ? " \u00b7 " + severe + " " + t("wz_traffic_severity", "Severity") + " \u26a0" : "");

  if (WZ._liveMarkers) WZ._liveMarkers.clearLayers();
  _trafficMarkers = [];

  // Incident markers
  if (WZ._liveMap) {
    for (var i = 0; i < items.length; i++) {
      var inc = items[i];
      if (inc.lat == null || inc.lon == null) continue;
      var mag = inc.magnitude || 0;
      var r = Math.max(4, 3 + mag * 2);
      var color = inc.color || "#64748b";

      var circle = L.circleMarker([inc.lat, inc.lon], {
        radius: r, color: color, fillColor: color,
        fillOpacity: 0.7, weight: mag >= 3 ? 2 : 1,
      });
      circle.bindPopup(
        '<div style="font-size:12px;min-width:180px;">' +
        '<div style="font-weight:700;color:' + color + ';margin-bottom:4px;">' + _esc(inc.category) + '</div>' +
        (inc.description ? '<div style="margin-bottom:4px;">' + _esc(inc.description) + '</div>' : '') +
        (inc.from ? '<div style="font-size:11px;"><strong>Von:</strong> ' + _esc(inc.from) + '</div>' : '') +
        (inc.to ? '<div style="font-size:11px;"><strong>Bis:</strong> ' + _esc(inc.to) + '</div>' : '') +
        '<div style="display:flex;gap:12px;margin-top:4px;font-size:11px;color:var(--muted);">' +
          (inc.delay_s > 0 ? '<span>' + t("wz_traffic_delay","Delay") + ': ' + _fmtDelay(inc.delay_s) + '</span>' : '') +
          (inc.length_m > 0 ? '<span>' + t("wz_traffic_length","Length") + ': ' + _fmtLength(inc.length_m) + '</span>' : '') +
        '</div>' +
        (inc.roads && inc.roads.length ? '<div style="font-size:10px;color:var(--muted);margin-top:2px;">' + inc.roads.join(", ") + '</div>' : '') +
        '</div>'
      );
      WZ._liveMarkers.addLayer(circle);
      _trafficMarkers.push({ marker: circle, idx: i, origRadius: r, origColor: color });

      circle.on("mouseover", _makeHL(i, true));
      circle.on("mouseout",  _makeHL(i, false));
    }

    // Flow sample markers (small squares)
    for (var f = 0; f < flow.length; f++) {
      var s = flow[f];
      if (s.lat == null || s.lon == null) continue;
      var ratio = s.ratio || 1;
      var fColor = ratio >= 0.8 ? "#22c55e" : ratio >= 0.5 ? "#eab308" : "#dc2626";
      var sq = L.circleMarker([s.lat, s.lon], {
        radius: 6, color: fColor, fillColor: fColor, fillOpacity: 0.5,
        weight: 1, dashArray: "3,3",
      });
      sq.bindPopup(
        '<div style="font-size:12px;">' +
        '<strong>' + t("wz_traffic_flow","Traffic Flow") + '</strong><br>' +
        t("wz_traffic_current","Current") + ': ' + s.current_speed + ' km/h<br>' +
        t("wz_traffic_freeflow","Free flow") + ': ' + s.free_flow_speed + ' km/h<br>' +
        t("wz_traffic_flow_ratio","Flow Index") + ': <strong style="color:' + fColor + ';">' + (ratio * 100).toFixed(0) + '%</strong>' +
        '</div>'
      );
      WZ._liveMarkers.addLayer(sq);
    }
  }

  // Content panel
  var content = document.getElementById("wz-live-content");
  var html = '<div style="padding:12px 16px;">';

  // Stats bar
  html += '<div style="margin-bottom:12px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 16px;">';
  html += '<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;">';
  html += '<div style="text-align:center;">' +
    '<div style="font-size:22px;font-weight:800;color:var(--text);">' + (data.count || 0) + '</div>' +
    '<div style="font-size:10px;color:var(--muted);text-transform:uppercase;">' + t("wz_traffic_count","Incidents") + '</div></div>';
  if (severe > 0) {
    html += '<div style="text-align:center;">' +
      '<div style="font-size:22px;font-weight:800;color:#dc2626;">' + severe + '</div>' +
      '<div style="font-size:10px;color:var(--muted);text-transform:uppercase;">' + t("wz_traffic_severity","Severe") + '</div></div>';
  }
  if (data.total_delay_s > 0) {
    html += '<div style="text-align:center;">' +
      '<div style="font-size:22px;font-weight:800;color:#ea580c;">' + _fmtDelay(data.total_delay_s) + '</div>' +
      '<div style="font-size:10px;color:var(--muted);text-transform:uppercase;">' + t("wz_traffic_delay","Delay") + '</div></div>';
  }
  if (data.avg_flow_ratio != null) {
    var frColor = data.avg_flow_ratio >= 0.8 ? "#22c55e" : data.avg_flow_ratio >= 0.5 ? "#eab308" : "#dc2626";
    html += '<div style="text-align:center;">' +
      '<div style="font-size:22px;font-weight:800;color:' + frColor + ';">' + (data.avg_flow_ratio * 100).toFixed(0) + '%</div>' +
      '<div style="font-size:10px;color:var(--muted);text-transform:uppercase;">' + t("wz_traffic_flow_ratio","Flow Index") + '</div></div>';
  }
  // Category breakdown
  var cats = data.category_counts || {};
  var catKeys = Object.keys(cats).sort(function(a,b) { return cats[b] - cats[a]; });
  for (var ci = 0; ci < catKeys.length; ci++) {
    html += '<div style="text-align:center;">' +
      '<div style="font-size:16px;font-weight:700;color:var(--text);">' + cats[catKeys[ci]] + '</div>' +
      '<div style="font-size:9px;color:var(--muted);max-width:70px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _esc(catKeys[ci]) + '</div></div>';
  }
  html += '</div></div>';

  // Incident list
  html += '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;">';
  html += '<div style="padding:10px 14px;border-bottom:1px solid var(--border);font-size:12px;font-weight:600;">' +
    t("wz_traffic_header","Current traffic incidents") + '</div>';

  if (!items.length) {
    html += '<div style="padding:20px;text-align:center;color:var(--muted);font-size:12px;">' +
      t("wz_traffic_empty","No traffic incidents in this region.") + '</div>';
  } else {
    html += '<div id="traffic-list" style="max-height:350px;overflow-y:auto;">';
    for (var j = 0; j < items.length; j++) {
      var ev = items[j];
      var evColor = ev.color || "#64748b";
      var magBars = "";
      for (var m = 0; m < 4; m++) {
        magBars += '<span style="display:inline-block;width:3px;height:10px;border-radius:1px;margin-right:1px;' +
          'background:' + (m < (ev.magnitude||0) ? evColor : 'var(--border)') + ';"></span>';
      }
      html += '<div class="traffic-row" data-idx="' + j + '" ' +
        'style="display:flex;align-items:center;gap:8px;padding:6px 14px;border-bottom:1px solid var(--border);' +
        'font-size:12px;cursor:pointer;transition:background .15s;">' +
        '<span style="width:8px;height:8px;border-radius:50%;background:' + evColor + ';flex-shrink:0;"></span>' +
        '<span style="flex:1;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
          _esc(ev.category) + (ev.from ? ' \u2013 ' + _esc(ev.from) : '') +
        '</span>' +
        '<span style="flex-shrink:0;">' + magBars + '</span>' +
        (ev.delay_s > 0 ? '<span style="font-size:10px;color:#ea580c;min-width:40px;text-align:right;">' + _fmtDelay(ev.delay_s) + '</span>' : '') +
      '</div>';
    }
    if (data.count > 80) {
      html += '<div style="padding:6px 14px;font-size:11px;color:var(--muted);">\u2026 ' +
        (data.count - 80) + ' ' + t("wz_traffic_more","more") + '</div>';
    }
    html += '</div>';
  }
  html += '</div></div>';
  content.innerHTML = html;

  // List ↔ Map hover
  document.querySelectorAll(".traffic-row").forEach(function(row) {
    var idx = parseInt(row.dataset.idx);
    row.addEventListener("mouseenter", function() { _trafficHL(idx, true); });
    row.addEventListener("mouseleave", function() { _trafficHL(idx, false); });
    row.addEventListener("click", function() {
      var entry = _trafficMarkers.find(function(m) { return m.idx === idx; });
      if (entry && WZ._liveMap) {
        WZ._liveMap.setView(entry.marker.getLatLng(), Math.max(WZ._liveMap.getZoom(), 12));
        entry.marker.openPopup();
      }
    });
  });
}

function _makeHL(idx, active) { return function() { _trafficHL(idx, active); }; }

function _trafficHL(idx, active) {
  var entry = _trafficMarkers.find(function(m) { return m.idx === idx; });
  if (entry) {
    if (active) {
      entry.marker.setStyle({ radius: entry.origRadius * 2, weight: 3, color: "#fff", fillOpacity: 0.95 });
      entry.marker.bringToFront();
    } else {
      entry.marker.setStyle({ radius: entry.origRadius, weight: (entry.origRadius > 5 ? 2 : 1), color: entry.origColor, fillOpacity: 0.7 });
    }
  }
  var row = document.querySelector('.traffic-row[data-idx="' + idx + '"]');
  if (row) {
    row.style.background = active ? "rgba(234,88,12,.1)" : "";
    if (active) row.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

function _fmtDelay(s) {
  if (s >= 3600) return Math.floor(s/3600) + "h" + Math.round((s%3600)/60) + "m";
  if (s >= 60) return Math.round(s/60) + " min";
  return s + "s";
}

function _fmtLength(m) {
  return m >= 1000 ? (m/1000).toFixed(1) + " km" : m + " m";
}

function _esc(s) {
  if (!s) return "";
  var d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

WZ.registerPlugin("traffic", {
  renderer: _renderTrafficLive,
  default_source: "tomtom",
});

})();
