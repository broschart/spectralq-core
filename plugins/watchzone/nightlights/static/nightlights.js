/**
 * WZ Module: nightlights renderer — side panel layout.
 */
(function() {
"use strict";
var WZ = window.WZ;

  function _renderNightlightsLive(data) {
    var ctx = WZ._currentCtx;
    if (ctx && ctx.mapEl) ctx.mapEl.style.height = "clamp(450px,75vh,850px)";
    var _mapRowEl = ctx ? ctx.mapRowEl : document.getElementById("wz-map-row");
    if (WZ._liveMarkers) WZ._liveMarkers.clearLayers();

    var imgUrl = data.image_url || "";
    var brightness = data.mean_brightness;
    var dateStr = data.date || "";

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
      var mapRow = _mapRowEl;
      if (mapRow) {
        panel = document.createElement("div");
        panel.id = "nl-side-panel";
        panel.style.cssText = "width:360px;flex-shrink:0;border-left:1px solid var(--border);background:var(--surface);display:flex;flex-direction:column;overflow-y:auto;";
        mapRow.appendChild(panel);
      }
    }
    if (panel) panel.style.display = "flex";

    var html = '<div style="padding:16px;">';

    // Vorschaubild
    var _nlFmtDate = function(d) {
      if (!d) return "";
      var iso = d.length <= 10 ? d + "T00:00" : d;
      return window.fmtDate ? window.fmtDate(iso) : (window.fmtDateOnly ? window.fmtDateOnly(iso) : d);
    };
    // Make _nlFmtDate available globally for click handler
    window._nlFmtDate = _nlFmtDate;
    if (imgUrl) {
      html += '<div style="margin-bottom:14px;">';
      html += '<img id="nl-preview-img" src="' + imgUrl + '" style="width:100%;border-radius:8px;background:#000;display:block;" />';
      html += '<div id="nl-preview-date" style="font-size:13px;font-weight:600;color:var(--text);margin-top:6px;">' + _nlFmtDate(dateStr) + '</div>';
      html += '</div>';
    }

    // Metadaten
    html += '<div style="font-size:12px;color:var(--text);margin-bottom:8px;">';
    if (data.zone_name) {
      html += '<div>' + t('wz_nightlights_zone','Zone:') + ' <strong>' + WZ._esc(data.zone_name) + '</strong></div>';
    }
    html += '</div>';

    // ── Time Focus comparison (3 images: before / focus / after) ──
    if (data.time_focus_images && data.time_focus_images.length) {
      // Store images globally for click handler
      window._nlTfImages = data.time_focus_images;
      window._nlTfBbox = data.bbox;
      var tf = data.time_focus || {};
      html += '<div style="padding:12px 14px;border-bottom:1px solid var(--border);">';
      html += '<h4 style="margin:0 0 8px;font-size:13px;font-weight:600;">Time Focus: ' + WZ._esc(tf.title || "") + '</h4>';
      html += '<div style="display:flex;gap:6px;">';
      var _tfLabels = {before: t('wz_nl_before','Vorher'), focus: t('wz_nl_focus','Ereignis'), after: t('wz_nl_after','Nachher')};
      data.time_focus_images.forEach(function(img, idx) {
        var borderClr = img.label === 'focus' ? '#f59e0b' : 'var(--border)';
        html += '<div class="nl-tf-thumb" data-idx="' + idx + '" style="flex:1;text-align:center;cursor:pointer;border-radius:8px;padding:4px;transition:background .15s;" ' +
          'onclick="_nlShowTfImage(' + idx + ')" ' +
          'onmouseover="this.style.background=\'rgba(251,191,36,.1)\'" onmouseout="this.style.background=\'none\'">';
        html += '<div style="font-size:9px;font-weight:700;color:' + (img.label === 'focus' ? '#f59e0b' : 'var(--muted)') + ';margin-bottom:3px;text-transform:uppercase;">' + (_tfLabels[img.label] || img.label) + '</div>';
        if (img.image_url) {
          html += '<img src="' + img.image_url + '" style="width:100%;border-radius:6px;border:2px solid ' + borderClr + ';background:#000;display:block;" />';
        } else {
          html += '<div style="height:60px;background:#111;border-radius:6px;border:2px solid ' + borderClr + ';display:flex;align-items:center;justify-content:center;font-size:9px;color:var(--muted);">N/A</div>';
        }
        html += '<div style="font-size:11px;font-weight:600;color:' + (img.label === 'focus' ? '#f59e0b' : 'var(--text)') + ';margin-top:6px;">' + _nlFmtDate(img.date) + '</div>';
        if (img.brightness != null) {
          var _bClr = img.brightness > 10 ? '#fbbf24' : (img.brightness > 2 ? '#a78bfa' : '#6b7280');
          html += '<div style="margin-top:4px;padding:4px 8px;background:rgba(255,255,255,.05);border:1px solid var(--border);border-radius:6px;text-align:center;">' +
            '<div style="font-size:20px;font-weight:800;color:' + _bClr + ';">' + img.brightness.toFixed(1) + '</div>' +
            '<div style="font-size:9px;color:var(--muted);margin-top:1px;">nW/cm\u00b2/sr</div>' +
          '</div>';
        }
        html += '</div>';
      });
      html += '</div></div>';
    }

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

  // Switch map overlay + preview to a time-focus image
  window._nlShowTfImage = function(idx) {
    var images = window._nlTfImages;
    var bbox = window._nlTfBbox;
    if (!images || !images[idx] || !images[idx].image_url) return;
    var img = images[idx];

    // Update map overlay
    if (WZ._liveMap && WZ._liveMarkers && bbox) {
      WZ._liveMarkers.clearLayers();
      var bounds = [[bbox[1], bbox[0]], [bbox[3], bbox[2]]];
      L.imageOverlay(img.image_url, bounds, { opacity: 0.7 }).addTo(WZ._liveMarkers);
    }

    // Update preview image and date in side panel
    var previewImg = document.getElementById("nl-preview-img");
    if (previewImg) previewImg.src = img.image_url;
    var previewDate = document.getElementById("nl-preview-date");
    if (previewDate) previewDate.textContent = window._nlFmtDate ? window._nlFmtDate(img.date) : (img.date || "");

    // Highlight selected thumbnail
    document.querySelectorAll(".nl-tf-thumb").forEach(function(el) {
      el.style.background = "none";
      var i = el.querySelector("img");
      if (i) i.style.borderColor = "var(--border)";
    });
    var sel = document.querySelector('.nl-tf-thumb[data-idx="' + idx + '"]');
    if (sel) {
      sel.style.background = "rgba(251,191,36,.15)";
      var si = sel.querySelector("img");
      if (si) si.style.borderColor = "#f59e0b";
    }
  };

  WZ.registerPlugin('nightlights', {
    renderer: _renderNightlightsLive,
    default_source: "viirs",
    has_live_map: true,
    live_title_prefix: "Nachtlichter",
    live_box_max_width: "1400px",
    live_box_height: "75vh",
  });

  // Collect Renderer
  WZ._collectRenderers["nightlights"] = {
    renderHTML: function(data, cardId) {
      var h = "";
      var fmtD = WZ._fmtDate || function(s) { return s ? String(s).slice(0,10) : ""; };
      var hasTfImages = data.time_focus_images && data.time_focus_images.some(function(tfi) { return tfi.image_b64 || tfi.image_url; });
      if (hasTfImages) {
        // Focus time: show 3 comparison images, skip current
        h += '<div style="display:flex;gap:8px;overflow-x:auto;margin-bottom:8px;">';
        data.time_focus_images.forEach(function(tfi) {
          var imgSrc = tfi.image_b64 ? ("data:image/png;base64," + tfi.image_b64) : (tfi.image_url || "");
          if (!imgSrc) return;
          var tfLabel = tfi.label === "before" ? "Vorher" : tfi.label === "focus" ? "Ereignis" : "Nachher";
          h += '<div style="flex:1;min-width:0;text-align:center;"><img src="' + imgSrc + '" style="width:100%;border-radius:6px;border:1px solid var(--border);cursor:pointer;" onclick="window.open(this.src,\'_blank\')">';
          h += '<div style="font-size:10px;color:var(--muted);margin-top:3px;">' + tfLabel + (tfi.date ? " \u2014 " + fmtD(tfi.date) : "") + '</div>';
          if (tfi.brightness != null) h += '<div style="font-size:10px;color:#f59e0b;">Helligkeit: ' + tfi.brightness.toFixed(1) + '</div>';
          h += '</div>';
        });
        h += '</div>';
      } else if (data.image_url) {
        // No focus time: show current image
        h += '<img src="' + (data.image_url || "").replace(/"/g,"&quot;") + '" style="width:100%;border-radius:6px;margin-bottom:8px;border:1px solid var(--border);">';
        h += '<div style="display:flex;gap:16px;margin-bottom:8px;">';
        if (data.mean_brightness != null) h += '<div style="font-size:13px;"><span style="color:var(--muted);">Helligkeit:</span> <strong style="color:#f59e0b;">' + data.mean_brightness.toFixed(2) + '</strong></div>';
        if (data.date) h += '<div style="font-size:13px;"><span style="color:var(--muted);">Datum:</span> <strong>' + fmtD(data.date) + '</strong></div>';
        h += '</div>';
      }
      return h;
    }
  };

})();
