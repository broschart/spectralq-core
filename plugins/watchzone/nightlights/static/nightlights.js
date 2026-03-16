/**
 * WZ Module: nightlights renderer — side panel layout.
 */
(function() {
"use strict";
var WZ = window.WZ;

  function _renderNightlightsLive(data) {
    document.getElementById("wz-live-count").textContent = "";
    if (WZ._liveMarkers) WZ._liveMarkers.clearLayers();

    var imgUrl = data.image_url || "";
    var brightness = data.mean_brightness;
    var dateStr = data.date || "";

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

    // ── Bild als Overlay auf Karte ──
    if (WZ._liveMap && imgUrl && data.bbox) {
      var bb = data.bbox;
      var imgOverlay = L.imageOverlay(imgUrl, [[bb[1], bb[0]], [bb[3], bb[2]]], { opacity: 0.7 });
      WZ._liveMarkers.addLayer(imgOverlay);
      WZ._liveMap.fitBounds([[bb[1], bb[0]], [bb[3], bb[2]]], { padding: [20, 20] });
    }

    // ── Seitenpanel ──
    var panel = document.getElementById("nl-side-panel");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "nl-side-panel";
      panel.style.cssText = "width:360px;flex-shrink:0;border-left:1px solid var(--border);background:var(--surface);display:flex;flex-direction:column;overflow-y:auto;";
      mapRow.appendChild(panel);
    }
    panel.style.display = "flex";

    var html = '<div style="padding:16px;">';

    // Vorschaubild
    if (imgUrl) {
      html += '<div style="margin-bottom:14px;">';
      html += '<img src="' + imgUrl + '" style="width:100%;border-radius:8px;background:#000;display:block;" />';
      html += '<div style="font-size:11px;color:var(--muted);margin-top:4px;">VIIRS Day/Night Band \u2014 ' + WZ._esc(dateStr) + '</div>';
      html += '</div>';
    }

    // Metadaten
    html += '<h4 style="margin:0 0 10px;font-size:14px;font-weight:600;">' + t('wz_nightlights_intensity','Light Intensity') + '</h4>';
    html += '<div style="font-size:12px;line-height:2;color:var(--text);">';
    if (brightness != null) {
      var bClr = brightness > 30 ? "#fbbf24" : brightness > 10 ? "#22c55e" : "var(--muted)";
      html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">';
      html += '<div style="font-size:32px;font-weight:800;color:' + bClr + ';">' + brightness.toFixed(1) + '</div>';
      html += '<div style="font-size:10px;color:var(--muted);text-transform:uppercase;">' + t('wz_nightlights_brightness','Mean Brightness') + '</div>';
      html += '</div>';
    }
    if (data.zone_name) {
      html += '<div>' + t('wz_nightlights_zone','Zone:') + ' <strong>' + WZ._esc(data.zone_name) + '</strong></div>';
    }
    if (data.bbox) {
      html += '<div style="color:var(--muted);font-size:11px;">BBox: ' + data.bbox.map(function(v){return v.toFixed(4);}).join(", ") + '</div>';
    }
    html += '</div>';

    // Hinweis
    html += '<div style="margin-top:16px;padding:10px 12px;background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.2);border-radius:8px;font-size:11px;color:var(--text);line-height:1.6;">';
    html += t('wz_nightlights_note','Brighter values = more artificial light.<br>Changes may indicate urbanisation, conflicts or power outages.');
    html += '</div>';

    // Download
    if (imgUrl) {
      html += '<div style="margin-top:14px;">';
      html += '<a href="' + imgUrl + '" download="nightlights_' + WZ._esc(data.zone_name || 'zone') + '.png" target="_blank" style="display:block;text-align:center;font-size:12px;font-weight:600;color:#fbbf24;border:1.5px solid #fbbf24;border-radius:6px;padding:7px 14px;text-decoration:none;">' + t('wz_nightlights_download','Download Image') + '</a>';
      html += '</div>';
    }

    html += '</div>';
    panel.innerHTML = html;

    setTimeout(function() { if (WZ._liveMap) WZ._liveMap.invalidateSize(); }, 200);
  }

  WZ._onLiveClose.push(function() {
    var panel = document.getElementById("nl-side-panel");
    if (panel) { panel.style.display = "none"; panel.innerHTML = ""; }
  });

  WZ.registerPlugin('nightlights', { renderer: _renderNightlightsLive, default_source: "viirs" });

})();
