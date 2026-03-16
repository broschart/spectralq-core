/**
 * WZ Module: ACLED conflict event renderer.
 */
(function() {
"use strict";
var WZ = window.WZ;
var t = window._t || function(k, fb) { return fb; };

var EVENT_COLORS = {
  "Battles":                    "#dc2626",
  "Violence against civilians": "#9333ea",
  "Explosions/Remote violence": "#f59e0b",
  "Riots":                      "#ea580c",
  "Protests":                   "#3b82f6",
  "Strategic developments":     "#64748b",
};

var _acledMarkers = [];

function _renderACLEDLive(data) {
  var items = data.items || [];
  var fatalities = data.fatalities || 0;
  var typeCounts = data.type_counts || {};

  document.getElementById("wz-live-count").textContent =
    items.length + " " + t("wz_acled_count", "events (30 days)") +
    (fatalities > 0 ? " \u00b7 " + fatalities + " " + t("wz_acled_fatalities", "Fatalities") : "");

  if (WZ._liveMarkers) WZ._liveMarkers.clearLayers();
  _acledMarkers = [];

  var displayItems = items.slice(0, 100);

  // Map markers
  if (WZ._liveMap && displayItems.length) {
    for (var i = 0; i < displayItems.length; i++) {
      var e = displayItems[i];
      if (e.lat == null || e.lon == null) continue;
      var color = EVENT_COLORS[e.event_type] || "#64748b";
      var hasFatal = (e.fatalities || 0) > 0;
      var r = hasFatal ? Math.min(5 + e.fatalities, 14) : 4;

      var circle = L.circleMarker([e.lat, e.lon], {
        radius: r, color: color, fillColor: color,
        fillOpacity: 0.65, weight: hasFatal ? 2 : 1,
      });
      circle.bindPopup(
        '<div style="font-size:12px;min-width:200px;max-width:320px;">' +
        '<div style="font-weight:700;margin-bottom:4px;">' + _esc(e.event_type) + '</div>' +
        (e.sub_event_type ? '<div style="font-size:11px;color:var(--muted);margin-bottom:4px;">' + _esc(e.sub_event_type) + '</div>' : '') +
        '<div style="margin-bottom:4px;">' + _esc(e.location) + (e.admin1 ? ', ' + _esc(e.admin1) : '') + ' \u2013 ' + _esc(e.country) + '</div>' +
        '<div style="display:flex;gap:12px;margin-bottom:4px;">' +
          '<span style="font-size:11px;color:var(--muted);">' + _esc(e.date) + '</span>' +
          (e.fatalities > 0 ? '<span style="font-size:11px;font-weight:700;color:#dc2626;">' + e.fatalities + ' ' + t("wz_acled_fatalities", "Fatalities") + '</span>' : '') +
        '</div>' +
        (e.actor1 ? '<div style="font-size:11px;"><strong>' + t("wz_acled_actors", "Actors") + ':</strong> ' + _esc(e.actor1) + (e.actor2 ? ' vs. ' + _esc(e.actor2) : '') + '</div>' : '') +
        (e.notes ? '<div style="font-size:10px;color:var(--muted);margin-top:4px;line-height:1.3;">' + _esc(e.notes) + '</div>' : '') +
        '</div>'
      );
      WZ._liveMarkers.addLayer(circle);
      _acledMarkers.push({ marker: circle, idx: i, origRadius: r, origColor: color });

      circle.on("mouseover", _makeHighlighter(i, true));
      circle.on("mouseout",  _makeHighlighter(i, false));
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
    '<div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Events</div></div>';
  if (fatalities > 0) {
    html += '<div style="text-align:center;">' +
      '<div style="font-size:22px;font-weight:800;color:#dc2626;">' + fatalities + '</div>' +
      '<div style="font-size:10px;color:var(--muted);text-transform:uppercase;">' + t("wz_acled_fatalities", "Fatalities") + '</div></div>';
  }
  // Event type breakdown
  var types = Object.keys(typeCounts);
  types.sort(function(a, b) { return typeCounts[b] - typeCounts[a]; });
  for (var ti = 0; ti < types.length; ti++) {
    var tc = EVENT_COLORS[types[ti]] || "#64748b";
    html += '<div style="text-align:center;">' +
      '<div style="font-size:16px;font-weight:700;color:' + tc + ';">' + typeCounts[types[ti]] + '</div>' +
      '<div style="font-size:9px;color:var(--muted);max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _esc(types[ti]) + '</div></div>';
  }
  html += '</div></div>';

  // Event list
  html += '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;">';
  html += '<div style="padding:10px 14px;border-bottom:1px solid var(--border);font-size:12px;font-weight:600;">' +
    t("wz_acled_header", "Conflict events in the last 30 days") + ' (' + (data.count || 0) + ')</div>';

  if (!displayItems.length) {
    html += '<div style="padding:20px;text-align:center;color:var(--muted);font-size:12px;">' +
      t("wz_acled_empty", "No conflict events recorded in this region.") + '</div>';
  } else {
    html += '<div id="acled-list" style="max-height:350px;overflow-y:auto;">';
    for (var j = 0; j < displayItems.length; j++) {
      var ev = displayItems[j];
      var evColor = EVENT_COLORS[ev.event_type] || "#64748b";
      var fatal = ev.fatalities || 0;
      html += '<div class="acled-row" data-idx="' + j + '" ' +
        'style="display:flex;align-items:center;gap:8px;padding:6px 14px;border-bottom:1px solid var(--border);' +
        'font-size:12px;cursor:pointer;transition:background .15s;">' +
        '<span style="width:6px;height:6px;border-radius:50%;background:' + evColor + ';flex-shrink:0;"></span>' +
        '<span style="color:var(--muted);font-size:10px;min-width:70px;white-space:nowrap;">' + _esc(ev.date) + '</span>' +
        '<span style="flex:1;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
          _esc(ev.location) + (ev.admin1 ? ', ' + _esc(ev.admin1) : '') +
        '</span>' +
        '<span style="font-size:10px;color:var(--muted);max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
          _esc(ev.event_type) +
        '</span>' +
        (fatal > 0 ? '<span style="font-size:11px;font-weight:700;color:#dc2626;min-width:20px;text-align:right;">' + fatal + '</span>' : '') +
      '</div>';
    }
    if (items.length > 100) {
      html += '<div style="padding:6px 14px;font-size:11px;color:var(--muted);">\u2026 ' +
        (items.length - 100) + ' ' + t("wz_acled_more", "more") + '</div>';
    }
    html += '</div>';
  }
  html += '</div></div>';
  content.innerHTML = html;

  // List ↔ Map hover
  document.querySelectorAll(".acled-row").forEach(function(row) {
    var idx = parseInt(row.dataset.idx);
    row.addEventListener("mouseenter", function() { _acledHighlight(idx, true); });
    row.addEventListener("mouseleave", function() { _acledHighlight(idx, false); });
    row.addEventListener("click", function() {
      var entry = _acledMarkers.find(function(m) { return m.idx === idx; });
      if (entry && WZ._liveMap) {
        WZ._liveMap.setView(entry.marker.getLatLng(), Math.max(WZ._liveMap.getZoom(), 8));
        entry.marker.openPopup();
      }
    });
  });
}

function _makeHighlighter(idx, active) {
  return function() { _acledHighlight(idx, active); };
}

function _acledHighlight(idx, active) {
  var entry = _acledMarkers.find(function(m) { return m.idx === idx; });
  if (entry) {
    if (active) {
      entry.marker.setStyle({ radius: entry.origRadius * 2, weight: 3, color: "#fff", fillOpacity: 0.95 });
      entry.marker.bringToFront();
    } else {
      entry.marker.setStyle({ radius: entry.origRadius, weight: entry.origRadius > 4 ? 2 : 1, color: entry.origColor, fillOpacity: 0.65 });
    }
  }
  var row = document.querySelector('.acled-row[data-idx="' + idx + '"]');
  if (row) {
    row.style.background = active ? "rgba(220,38,38,.1)" : "";
    if (active) row.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

function _esc(s) {
  if (!s) return "";
  var d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

WZ.registerPlugin("acled", {
  renderer: _renderACLEDLive,
  default_source: "acled",
});

})();
