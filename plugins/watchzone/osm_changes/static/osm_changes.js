/**
 * WZ Module: OpenStreetMap Changes renderer.
 */
(function() {
"use strict";
var WZ = window.WZ;
var t = window._t || function(k, fb) { return fb; };

var _osmMarkers = [];

function _renderOSMLive(data) {
  var items = data.items || [];
  var newCount = data.new_count || 0;
  var tagCounts = data.tag_counts || {};
  var topUsers = data.top_users || [];

  document.getElementById("wz-live-count").textContent =
    (data.count || 0) + " " + t("wz_osm_count", "changes (30 days)") +
    (newCount > 0 ? " \u00b7 " + newCount + " " + t("wz_osm_new", "new") : "");

  if (WZ._liveMarkers) WZ._liveMarkers.clearLayers();
  _osmMarkers = [];

  // Map markers
  if (WZ._liveMap && items.length) {
    for (var i = 0; i < items.length; i++) {
      var el = items[i];
      if (el.lat == null || el.lon == null) continue;
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
          '<span>' + _esc(el.timestamp) + '</span>' +
        '</div></div>'
      );
      WZ._liveMarkers.addLayer(circle);
      _osmMarkers.push({ marker: circle, idx: i, origRadius: r, origColor: color });

      circle.on("mouseover", _makeHL(i, true));
      circle.on("mouseout",  _makeHL(i, false));
    }
  }

  var content = document.getElementById("wz-live-content");
  var html = '<div style="padding:12px 16px;">';

  // Stats bar
  html += '<div style="margin-bottom:12px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 16px;">';
  html += '<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;">';
  html += '<div style="text-align:center;">' +
    '<div style="font-size:22px;font-weight:800;color:var(--text);">' + (data.count || 0) + '</div>' +
    '<div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Gesamt</div></div>';
  if (newCount > 0) {
    html += '<div style="text-align:center;">' +
      '<div style="font-size:22px;font-weight:800;color:#22c55e;">' + newCount + '</div>' +
      '<div style="font-size:10px;color:var(--muted);text-transform:uppercase;">' + t("wz_osm_new","New") + '</div></div>';
  }
  // Tag breakdown
  var tags = Object.keys(tagCounts).sort(function(a,b) { return tagCounts[b] - tagCounts[a]; });
  for (var ti = 0; ti < Math.min(tags.length, 6); ti++) {
    html += '<div style="text-align:center;">' +
      '<div style="font-size:16px;font-weight:700;color:var(--text);">' + tagCounts[tags[ti]] + '</div>' +
      '<div style="font-size:9px;color:var(--muted);max-width:70px;overflow:hidden;text-overflow:ellipsis;">' + _esc(tags[ti]) + '</div></div>';
  }
  html += '</div></div>';

  // Top contributors
  if (topUsers.length) {
    html += '<div style="margin-bottom:12px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 16px;">';
    html += '<div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:6px;">' + t("wz_osm_users","Mappers") + '</div>';
    html += '<div style="display:flex;gap:6px;flex-wrap:wrap;">';
    for (var u = 0; u < topUsers.length; u++) {
      html += '<span style="font-size:11px;padding:2px 8px;border-radius:4px;background:var(--bg);border:1px solid var(--border);">' +
        _esc(topUsers[u].user) + ' <strong>' + topUsers[u].edits + '</strong></span>';
    }
    html += '</div></div>';
  }

  // Change list
  html += '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;">';
  html += '<div style="padding:10px 14px;border-bottom:1px solid var(--border);font-size:12px;font-weight:600;">' +
    t("wz_osm_header","Recent OSM changes") + '</div>';

  if (!items.length) {
    html += '<div style="padding:20px;text-align:center;color:var(--muted);font-size:12px;">' +
      t("wz_osm_empty","No changes in this region.") + '</div>';
  } else {
    html += '<div id="osm-list" style="max-height:300px;overflow-y:auto;">';
    var showMax = Math.min(items.length, 80);
    for (var j = 0; j < showMax; j++) {
      var it = items[j];
      html += '<div class="osm-row" data-idx="' + j + '" ' +
        'style="display:flex;align-items:center;gap:8px;padding:5px 14px;border-bottom:1px solid var(--border);' +
        'font-size:11px;cursor:pointer;transition:background .15s;">' +
        '<span style="width:8px;height:8px;border-radius:50%;background:' + (it.color||"#64748b") + ';flex-shrink:0;"></span>' +
        (it.is_new ? '<span style="font-size:9px;background:#22c55e20;color:#22c55e;padding:0 4px;border-radius:2px;">NEW</span>' : '') +
        '<span style="color:var(--muted);font-size:10px;min-width:65px;">' + _esc(it.timestamp.slice(0,10)) + '</span>' +
        '<span style="min-width:70px;color:' + (it.color||"#64748b") + ';font-weight:600;">' + _esc(it.category) + '</span>' +
        '<span style="flex:1;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
          _esc(it.name || it.tag_value || it.type + " " + it.id) + '</span>' +
        '<span style="color:var(--muted);font-size:10px;">' + _esc(it.user) + '</span>' +
      '</div>';
    }
    if (items.length > showMax) {
      html += '<div style="padding:6px 14px;font-size:11px;color:var(--muted);">\u2026 ' +
        (items.length - showMax) + ' ' + t("wz_osm_more","more") + '</div>';
    }
    html += '</div>';
  }
  html += '</div></div>';
  content.innerHTML = html;

  // Hover
  document.querySelectorAll(".osm-row").forEach(function(row) {
    var idx = parseInt(row.dataset.idx);
    row.addEventListener("mouseenter", function() { _osmHL(idx, true); });
    row.addEventListener("mouseleave", function() { _osmHL(idx, false); });
    row.addEventListener("click", function() {
      var entry = _osmMarkers.find(function(m) { return m.idx === idx; });
      if (entry && WZ._liveMap) {
        WZ._liveMap.setView(entry.marker.getLatLng(), Math.max(WZ._liveMap.getZoom(), 14));
        entry.marker.openPopup();
      }
    });
  });
}

function _makeHL(idx, active) { return function() { _osmHL(idx, active); }; }

function _osmHL(idx, active) {
  var entry = _osmMarkers.find(function(m) { return m.idx === idx; });
  if (entry) {
    if (active) {
      entry.marker.setStyle({ radius: entry.origRadius * 2.5, weight: 3, color: "#fff", fillOpacity: 0.95 });
      entry.marker.bringToFront();
    } else {
      entry.marker.setStyle({ radius: entry.origRadius, weight: entry.origRadius > 4 ? 2 : 1, color: entry.origColor, fillOpacity: entry.origRadius > 4 ? 0.8 : 0.5 });
    }
  }
  var row = document.querySelector('.osm-row[data-idx="' + idx + '"]');
  if (row) {
    row.style.background = active ? "rgba(124,179,66,.1)" : "";
    if (active) row.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

function _esc(s) {
  if (!s) return "";
  var d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

WZ.registerPlugin("osm_changes", {
  renderer: _renderOSMLive,
  default_source: "overpass",
});

})();
