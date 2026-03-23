/**
 * WZ Module: satellite fullscreen viewer and renderer.
 */
(function() {
"use strict";
var WZ = window.WZ;

  // ── Satellitenbild Vollbild ────────────────────────────────────────────
  // ── Satellit Vollbild mit Zoom-Auswahl ────────────────────────────────
  let _satFsBbox = null;        // aktuelle BBox des angezeigten Bildes
  let _satFsOrigBbox = null;    // Original-BBox der Zone (für Herauszoomen)
  let _satFsZoneId = null;      // Zone-ID für Update
  let _satFsBboxHistory = [];   // Zoom-Historie für Herauszoomen
  let _satFsTimestamp = "";     // Zeitstempel des aktuellen Bildes
  let _satFsRotation = 0;      // aktuelle Rotation in Grad
  let _satFsOsmActive = false;
  let _satFsOsmMap = null;

  // Maßstab berechnen: Breite der BBox in km
  function _satScaleKm(bbox) {
    if (!bbox) return 0;
    const latMid = (bbox[1] + bbox[3]) / 2;
    const lonSpan = bbox[2] - bbox[0];
    return lonSpan * 111.32 * Math.cos(latMid * Math.PI / 180);
  }

  function _satScaleLabel(bbox) {
    const km = _satScaleKm(bbox);
    if (km >= 1) return km.toFixed(1) + " km";
    return Math.round(km * 1000) + " m";
  }

  // Maßstabsbalken auf Canvas zeichnen
  function _satDrawScale(ctx, cw, ch, bbox) {
    if (!bbox) return;
    const totalKm = _satScaleKm(bbox);
    // Zielbreite: ~20% der Bildbreite
    const targetPx = cw * 0.2;
    const pxPerKm = cw / totalKm;
    // Schöne runde Zahl finden
    const rawKm = targetPx / pxPerKm;
    const nice = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
    let scaleKm = nice.find(n => n >= rawKm * 0.6) || rawKm;
    const scalePx = scaleKm * pxPerKm;
    const label = scaleKm >= 1 ? scaleKm + " km" : Math.round(scaleKm * 1000) + " m";

    const x = 16, y = ch - 20;
    ctx.save();
    // Hintergrund
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(x - 4, y - 18, scalePx + 8, 26);
    // Balken
    ctx.fillStyle = "#fff";
    ctx.fillRect(x, y, scalePx, 3);
    ctx.fillRect(x, y - 4, 2, 10);
    ctx.fillRect(x + scalePx - 2, y - 4, 2, 10);
    // Text
    ctx.font = "bold 11px sans-serif";
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.fillText(label, x + scalePx / 2, y - 5);
    ctx.restore();
  }

  // Zeitstempel + BBox-Info auf Canvas zeichnen
  function _satDrawInfo(ctx, cw) {
    ctx.save();
    const lines = [];
    if (_satFsTimestamp) lines.push(_satFsTimestamp);
    if (_satFsBbox) lines.push("BBox: " + _satFsBbox.map(v => v.toFixed(4)).join(", "));
    if (!lines.length) { ctx.restore(); return; }
    ctx.font = "11px sans-serif";
    ctx.textAlign = "right";
    let y = 18;
    lines.forEach(t => {
      const w = ctx.measureText(t).width;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(cw - w - 16, y - 12, w + 12, 17);
      ctx.fillStyle = "#ddd";
      ctx.fillText(t, cw - 10, y);
      y += 18;
    });
    ctx.restore();
  }

  function _satDrawOverlays(ctx, cw, ch, bbox) {
    _satDrawScale(ctx, cw, ch, bbox);
    _satDrawInfo(ctx, cw);
  }

  function _satFsUpdateButtons() {
    const bar = document.getElementById("wz-sat-fs-buttons");
    if (!bar) return;
    if (_satFsBboxHistory.length === 0) {
      bar.style.display = "none";
      return;
    }
    bar.style.display = "flex";
    // OSM-Map Bounds aktualisieren
    if (_satFsOsmActive && _satFsOsmMap && _satFsBbox) {
      const bb = _satFsBbox;
      _satFsOsmMap.fitBounds([[bb[1], bb[0]], [bb[3], bb[2]]]);
    }
  }

  // ── OSM-Overlay in Vollbildansicht ──────────────────────────────────
  window.wzSatFsToggleOsm = function() {
    const btn = document.getElementById("wz-sat-fs-osm-btn");
    const container = document.getElementById("wz-sat-fs-osm-map");
    if (!btn || !container) return;
    if (_satFsOsmActive) {
      container.style.display = "none";
      if (_satFsOsmMap) { _satFsOsmMap.remove(); _satFsOsmMap = null; }
      _satFsOsmActive = false;
      btn.style.background = "#64748b";
      btn.textContent = t('wz_sat_map_layer','Map Layer');
    } else {
      container.style.display = "block";
      if (!_satFsOsmMap) {
        _satFsOsmMap = L.map(container, {
          zoomControl: false, attributionControl: false,
          dragging: false, scrollWheelZoom: false, doubleClickZoom: false,
          boxZoom: false, keyboard: false, touchZoom: false,
        });
        L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
          { maxZoom: 19 }).addTo(_satFsOsmMap);
        L.control.scale({ metric: true, imperial: false }).addTo(_satFsOsmMap);
      }
      // Bounds aus aktueller BBox setzen
      if (_satFsBbox) {
        const bb = _satFsBbox;
        _satFsOsmMap.fitBounds([[bb[1], bb[0]], [bb[3], bb[2]]]);
      }
      _satFsOsmActive = true;
      btn.style.background = "#16a34a";
      btn.textContent = t('wz_sat_map_layer_on','Map Layer (on)');
      setTimeout(() => { if (_satFsOsmMap) _satFsOsmMap.invalidateSize(); }, 150);
    }
  };

  window.wzSatFullscreen = function(imgEl) {
    const zone = WZ._zones.find(z => z.id === WZ._liveZoneId);
    if (!zone) return;
    const geo = zone.geometry;
    const bbox = WZ._geoBbox(geo);
    if (!bbox) return;
    _satFsBbox = [...bbox];
    _satFsOrigBbox = [...bbox];
    _satFsZoneId = zone.id;
    _satFsBboxHistory = [];
    _satFsRotation = 0;
    _satFsOsmActive = false;
    if (_satFsOsmMap) { _satFsOsmMap.remove(); _satFsOsmMap = null; }
    const now = new Date();
    _satFsTimestamp = window.fmtDate ? window.fmtDate(now.toISOString()) : now.toLocaleDateString("de-DE") + " " + now.toLocaleTimeString("de-DE", {hour:"2-digit",minute:"2-digit"});

    let overlay = document.getElementById("wz-sat-fullscreen");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "wz-sat-fullscreen";
      overlay.style.cssText = "position:fixed;inset:0;z-index:20000;background:rgba(0,0,0,.92);" +
        "display:flex;align-items:center;justify-content:center;flex-direction:column;";
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = `
      <div id="wz-sat-fs-wrap" style="position:relative;display:inline-block;max-width:95vw;max-height:82vh;transition:transform .3s;">
        <img id="wz-sat-fs-img" src="${imgEl.src}" draggable="false"
             style="max-width:95vw;max-height:82vh;border-radius:8px;box-shadow:0 0 40px rgba(0,0,0,.6);display:block;user-select:none;" />
        <div id="wz-sat-fs-osm-map" style="display:none;position:absolute;inset:0;border-radius:8px;z-index:2;opacity:0.55;pointer-events:none;"></div>
        <canvas id="wz-sat-fs-canvas" style="position:absolute;inset:0;width:100%;height:100%;cursor:crosshair;border-radius:8px;z-index:3;"></canvas>
      </div>
      <div style="margin-top:10px;display:flex;gap:8px;align-items:center;justify-content:center;">
        <button onclick="wzSatFsRotate(-90)" title="${t('wz_sat_rotate_left','Rotate left')}"
          style="background:#374151;color:#fff;border:none;border-radius:6px;width:34px;height:34px;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;">&#x21B6;</button>
        <button id="wz-sat-fs-osm-btn" onclick="wzSatFsToggleOsm()" title="${t('wz_sat_toggle_layer','Toggle map layer')}"
          style="background:#64748b;color:#fff;border:none;border-radius:6px;padding:4px 14px;height:34px;font-size:12px;font-weight:600;cursor:pointer;">${t('wz_sat_map_layer','Map Layer')}</button>
        <button onclick="wzSatFsRotate(90)" title="${t('wz_sat_rotate_right','Rotate right')}"
          style="background:#374151;color:#fff;border:none;border-radius:6px;width:34px;height:34px;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;">&#x21B7;</button>
      </div>
      <div id="wz-sat-fs-buttons" style="display:none;margin-top:6px;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center;">
        <button onclick="wzSatFsZoomOut()" style="background:#374151;color:#fff;border:none;border-radius:6px;padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer;">
          ${t('wz_sat_zoom_out','Zoom Out')}
        </button>
        <button onclick="wzSatFsUpdateZone()" style="background:#0ea5e9;color:#fff;border:none;border-radius:6px;padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer;">
          ${t('wz_sat_update_zone','Update Watchzone')}
        </button>
        <button onclick="wzSatFsSaveNew()" style="background:#16a34a;color:#fff;border:none;border-radius:6px;padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer;">
          ${t('wz_sat_save_new','Save as New Watchzone')}
        </button>
      </div>
      <div style="margin-top:6px;color:#666;font-size:11px;">${t('wz_sat_draw_hint','Draw selection to zoom in · ESC to close')}</div>
      <div style="position:absolute;top:16px;right:24px;color:#fff;font-size:28px;cursor:pointer;opacity:.7;"
           onclick="document.getElementById('wz-sat-fullscreen').style.display='none'">&#10005;</div>`;
    overlay.style.display = "flex";

    const img = document.getElementById("wz-sat-fs-img");
    const canvas = document.getElementById("wz-sat-fs-canvas");

    requestAnimationFrame(() => {
      canvas.width = img.offsetWidth;
      canvas.height = img.offsetHeight;
      const ctx = canvas.getContext("2d");
      // Initiale Overlays
      _satDrawOverlays(ctx, canvas.width, canvas.height, _satFsBbox);

      let drawStart = null;
      let drawRect = null;

      canvas.addEventListener("mousedown", function(e) {
        if (e.button !== 0) return;
        // Rotation zurücksetzen damit Koordinaten stimmen
        if (_satFsRotation !== 0) {
          _satFsRotation = 0;
          const wrap = document.getElementById("wz-sat-fs-wrap");
          if (wrap) wrap.style.transform = "rotate(0deg)";
        }
        const rect = canvas.getBoundingClientRect();
        drawStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        drawRect = null;
      });

      canvas.addEventListener("mousemove", function(e) {
        if (!drawStart) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        drawRect = {
          x: Math.min(drawStart.x, x), y: Math.min(drawStart.y, y),
          w: Math.abs(x - drawStart.x), h: Math.abs(y - drawStart.y),
        };
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.clearRect(drawRect.x, drawRect.y, drawRect.w, drawRect.h);
        ctx.strokeStyle = "#0ea5e9";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(drawRect.x, drawRect.y, drawRect.w, drawRect.h);
        ctx.setLineDash([]);
        // Maßstab auch beim Zeichnen
        _satDrawOverlays(ctx, canvas.width, canvas.height, _satFsBbox);
      });

      canvas.addEventListener("mouseup", function(e) {
        if (!drawStart || !drawRect || drawRect.w < 10 || drawRect.h < 10) {
          drawStart = null; drawRect = null;
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          _satDrawOverlays(ctx, canvas.width, canvas.height, _satFsBbox);
          return;
        }
        const cw = canvas.width, ch = canvas.height;
        const bb = _satFsBbox;
        const lonMin = bb[0] + (drawRect.x / cw) * (bb[2] - bb[0]);
        const lonMax = bb[0] + ((drawRect.x + drawRect.w) / cw) * (bb[2] - bb[0]);
        const latMax = bb[3] - (drawRect.y / ch) * (bb[3] - bb[1]);
        const latMin = bb[3] - ((drawRect.y + drawRect.h) / ch) * (bb[3] - bb[1]);
        const newBbox = [lonMin, latMin, lonMax, latMax];
        drawStart = null; drawRect = null;
        _wzSatZoomTo(newBbox, img, canvas, ctx);
      });

      function onKey(e) {
        if (e.key === "Escape") {
          overlay.style.display = "none";
          document.removeEventListener("keydown", onKey);
        }
      }
      document.addEventListener("keydown", onKey);
    });
  };

  async function _wzSatZoomTo(newBbox, imgEl, canvas, ctx) {
    const bboxStr = newBbox.map(v => v.toFixed(6)).join(",");

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#fff";
    ctx.font = "16px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(t('wz_sat_loading','Loading satellite image …'), canvas.width / 2, canvas.height / 2);

    try {
      const today = new Date().toISOString().slice(0, 10);
      const ago30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const url = `/api/sentinel/image?bbox=${encodeURIComponent(bboxStr)}&from=${ago30}&to=${today}&width=1024&height=1024`;
      const r = await fetch(url);
      if (!r.ok) throw new Error("Fehler " + r.status);
      const blob = await r.blob();
      const imgUrl = URL.createObjectURL(blob);

      // Vorherige BBox in Historie speichern
      _satFsBboxHistory.push([..._satFsBbox]);
      _satFsBbox = newBbox;
      imgEl.src = imgUrl;
      const now = new Date();
      _satFsTimestamp = window.fmtDate ? window.fmtDate(now.toISOString()) : now.toLocaleDateString("de-DE") + " " + now.toLocaleTimeString("de-DE", {hour:"2-digit",minute:"2-digit"});

      // Nach Bild-Load Canvas + Overlays neu zeichnen
      imgEl.onload = function() {
        canvas.width = imgEl.offsetWidth;
        canvas.height = imgEl.offsetHeight;
        const newCtx = canvas.getContext("2d");
        _satDrawOverlays(newCtx, canvas.width, canvas.height, _satFsBbox);
        _satFsUpdateButtons();
      };
    } catch(e) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#ef4444";
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Error: " + e.message, canvas.width / 2, canvas.height / 2);
      setTimeout(() => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        _satDrawOverlays(ctx, canvas.width, canvas.height, _satFsBbox);
      }, 3000);
    }
  }

  // Herauszoomen: letzte BBox aus Historie
  window.wzSatFsRotate = function(deg) {
    _satFsRotation = (_satFsRotation + deg) % 360;
    const wrap = document.getElementById("wz-sat-fs-wrap");
    if (wrap) wrap.style.transform = "rotate(" + _satFsRotation + "deg)";
  };

  window.wzSatFsZoomOut = function() {
    if (!_satFsBboxHistory.length) return;
    const prevBbox = _satFsBboxHistory.pop();
    const img = document.getElementById("wz-sat-fs-img");
    const canvas = document.getElementById("wz-sat-fs-canvas");
    if (!img || !canvas) return;
    // Nicht in Historie pushen (wir gehen ja zurück)
    const bboxStr = prevBbox.map(v => v.toFixed(6)).join(",");
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#fff";
    ctx.font = "16px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(t('wz_sat_loading','Loading satellite image …'), canvas.width / 2, canvas.height / 2);

    const today = new Date().toISOString().slice(0, 10);
    const ago30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    fetch(`/api/sentinel/image?bbox=${encodeURIComponent(bboxStr)}&from=${ago30}&to=${today}&width=1024&height=1024`)
      .then(r => { if (!r.ok) throw new Error("Fehler"); return r.blob(); })
      .then(blob => {
        _satFsBbox = prevBbox;
        img.src = URL.createObjectURL(blob);
        const now = new Date();
        _satFsTimestamp = window.fmtDate ? window.fmtDate(now.toISOString()) : now.toLocaleDateString("de-DE") + " " + now.toLocaleTimeString("de-DE", {hour:"2-digit",minute:"2-digit"});
        img.onload = function() {
          canvas.width = img.offsetWidth;
          canvas.height = img.offsetHeight;
          const c = canvas.getContext("2d");
          _satDrawOverlays(c, canvas.width, canvas.height, _satFsBbox);
          _satFsUpdateButtons();
        };
      })
      .catch(e => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        _satDrawOverlays(ctx, canvas.width, canvas.height, _satFsBbox);
      });
  };

  // Watchzone auf aktuelle BBox anpassen
  window.wzSatFsUpdateZone = function() {
    if (!_satFsBbox || !_satFsZoneId) return;
    _wzSatUpdateZone(_satFsBbox);
  };

  // Als neue Watchzone speichern
  window.wzSatFsSaveNew = async function() {
    if (!_satFsBbox) return;
    const name = prompt("Name der neuen Satellit-Watchzone:", "Satellit-Zoom") || "Satellit-Zoom";
    const projectId = document.getElementById("hdr-wz-project")?.value || null;
    const [lonMin, latMin, lonMax, latMax] = _satFsBbox;
    const geo = {
      type: "Polygon",
      coordinates: [[[lonMin,latMin],[lonMax,latMin],[lonMax,latMax],[lonMin,latMax],[lonMin,latMin]]]
    };
    try {
      const r = await fetch("/api/watchzones", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          name, zone_type: "satellite", geometry: geo,
          config: { source: "sentinel" },
          project_id: projectId ? parseInt(projectId) : null,
        })
      });
      if (r.ok) {
        const z = await r.json();
        WZ._zones.push(z);
        WZ._renderAllZones();
      }
    } catch(e) { console.error("Save new zone error:", e); }
  };

  async function _wzSatUpdateZone(newBbox) {
    if (!_satFsZoneId) return;
    const [lonMin, latMin, lonMax, latMax] = newBbox;
    const newGeo = {
      type: "Polygon",
      coordinates: [[[lonMin,latMin],[lonMax,latMin],[lonMax,latMax],[lonMin,latMax],[lonMin,latMin]]]
    };
    try {
      const r = await fetch(`/api/watchzones/${_satFsZoneId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ geometry: newGeo }),
      });
      if (r.ok) {
        const z = WZ._zones.find(z => z.id === _satFsZoneId);
        if (z) z.geometry = newGeo;
        WZ._renderAllZones();
        if (WZ._liveZoneId === _satFsZoneId) WZ._fetchLiveData(_satFsZoneId);
      }
    } catch(e) { console.error("Zone update error:", e); }
  }

  // ── Satellitenbild rendern ──────────────────────────────────────────────
  function _renderSatelliteLive(data) {
    var ctx = WZ._currentCtx;
    if (ctx && ctx.mapEl) ctx.mapEl.style.height = "clamp(450px,75vh,850px)";
    var _countEl = ctx ? ctx.countEl : document.getElementById("wz-live-count");
    var _mapRowEl = ctx ? ctx.mapRowEl : document.getElementById("wz-map-row");
    _countEl.textContent =
      `Sentinel-2 \u00b7 ${data.date_from} ${t('wz_sat_to','to')} ${data.date_to}` + (data.cropped ? " " + t('wz_sat_cropped','(cropped)') : "");

    if (WZ._liveMarkers) WZ._liveMarkers.clearLayers();

    // Bild als Overlay auf der Karte
    var imgSrc = "";
    if (data.image_b64 && data.bbox) {
      var bb = data.bbox;
      var bounds = L.latLngBounds([bb[1], bb[0]], [bb[3], bb[2]]);
      imgSrc = "data:image/png;base64," + data.image_b64;
      if (WZ._liveMap) {
        var overlay = L.imageOverlay(imgSrc, bounds, { opacity: 0.9, interactive: false });
        WZ._liveMarkers.addLayer(overlay);
        WZ._liveMap.fitBounds(bounds, { padding: [20, 20] });
      }
    }

    // ── Seitenpanel ──
    var panel = document.getElementById("sat-side-panel");
    if (!panel) {
      var mapRow = _mapRowEl;
      if (mapRow) {
        panel = document.createElement("div");
        panel.id = "sat-side-panel";
        panel.style.cssText = "width:360px;flex-shrink:0;border-left:1px solid var(--border);background:var(--surface);display:flex;flex-direction:column;overflow-y:auto;";
        mapRow.appendChild(panel);
      }
    }
    if (panel) panel.style.display = "flex";

    var html = '<div style="padding:16px;">';

    // Date formatter
    var _satFmtDate = function(d) {
      if (!d) return "";
      var iso = d.length <= 10 ? d + "T00:00" : d;
      return window.fmtDate ? window.fmtDate(iso) : (window.fmtDateOnly ? window.fmtDateOnly(iso) : d);
    };

    // Vorschaubild
    if (imgSrc) {
      html += `<div style="margin-bottom:14px;cursor:pointer;" onclick="wzSatFullscreen(document.getElementById('wz-sat-img'))">
        <img id="wz-sat-img" src="${imgSrc}" style="width:100%;border-radius:8px;border:1px solid var(--border);" title="${t('wz_sat_click_fullscreen','Click for fullscreen')}" />
        <div id="sat-preview-date" style="font-size:13px;font-weight:600;color:var(--text);margin-top:6px;">${_satFmtDate(data.date_from)} \u2013 ${_satFmtDate(data.date_to)}</div>
      </div>`;
    }

    // Metadaten
    html += '<div style="font-size:12px;color:var(--text);margin-bottom:8px;">';
    html += `<div>${t('wz_sat_zone_label','Zone:')} <strong>${WZ._esc(data.zone_name)}</strong></div>`;
    if (data.cropped) html += `<div style="color:#f59e0b;font-size:11px;">${t('wz_sat_crop_warning','Region clipped to max. 2\u00d7\u00b02\u00b0')}</div>`;
    html += '</div>';

    // Time Focus comparison (3 images)
    if (data.time_focus_images && data.time_focus_images.length) {
      window._satTfImages = data.time_focus_images;
      window._satTfBbox = data.bbox;
      window._satFmtDate = _satFmtDate;
      var tf = data.time_focus || {};
      var _tfLabels = {before: t('wz_sat_tf_before','Vorher'), focus: t('wz_sat_tf_focus','Ereignis'), after: t('wz_sat_tf_after','Nachher')};
      html += '<div style="padding:10px 0;border-top:1px solid var(--border);border-bottom:1px solid var(--border);margin-bottom:10px;">';
      html += '<h4 style="margin:0 0 8px;font-size:13px;font-weight:600;">Time Focus: ' + WZ._esc(tf.title || "") + '</h4>';
      html += '<div style="display:flex;gap:6px;">';
      data.time_focus_images.forEach(function(img, idx) {
        var borderClr = img.label === 'focus' ? '#f59e0b' : 'var(--border)';
        html += '<div class="sat-tf-thumb" data-idx="' + idx + '" style="flex:1;text-align:center;cursor:pointer;border-radius:8px;padding:4px;transition:background .15s;" ' +
          'onclick="_satShowTfImage(' + idx + ')" ' +
          'onmouseover="this.style.background=\'rgba(14,165,233,.1)\'" onmouseout="this.style.background=\'none\'">';
        html += '<div style="font-size:9px;font-weight:700;color:' + (img.label === 'focus' ? '#f59e0b' : 'var(--muted)') + ';margin-bottom:3px;text-transform:uppercase;">' + (_tfLabels[img.label] || img.label) + '</div>';
        if (img.image_b64) {
          html += '<img src="data:image/png;base64,' + img.image_b64 + '" style="width:100%;border-radius:6px;border:2px solid ' + borderClr + ';display:block;" />';
        } else {
          html += '<div style="height:60px;background:#111;border-radius:6px;border:2px solid ' + borderClr + ';display:flex;align-items:center;justify-content:center;font-size:9px;color:var(--muted);">N/A</div>';
        }
        html += '<div style="font-size:11px;font-weight:600;color:' + (img.label === 'focus' ? '#f59e0b' : 'var(--text)') + ';margin-top:4px;">' + _satFmtDate(img.date) + '</div>';
        html += '</div>';
      });
      html += '</div></div>';
    }

    // Aktions-Buttons
    html += '<div style="margin-top:16px;display:flex;flex-direction:column;gap:8px;">';
    if (imgSrc) {
      html += `<button onclick="wzSatFullscreen(document.getElementById('wz-sat-img'))"
        style="font-size:12px;font-weight:600;color:#fff;background:var(--accent3);
        border:none;border-radius:6px;padding:8px 14px;cursor:pointer;width:100%;">${t('wz_sat_fullscreen_btn','Fullscreen / Zoom')}</button>`;
      html += `<a href="${imgSrc}" download="sentinel_${WZ._esc(data.zone_name || 'zone')}.png"
        style="display:block;text-align:center;font-size:12px;font-weight:600;color:#0ea5e9;
        border:1.5px solid #0ea5e9;border-radius:6px;padding:7px 14px;text-decoration:none;
        cursor:pointer;">${t('wz_sat_download','Download Image')}</a>`;
    }
    html += '</div>';

    if (!imgSrc) {
      html += `<div style="color:var(--muted);font-size:12px;padding:20px 0;text-align:center;">${t('wz_sat_no_image','No satellite image available.')}</div>`;
    }

    html += '</div>';
    panel.innerHTML = html;

    // Karte invalidieren
    setTimeout(function() { if (WZ._liveMap) WZ._liveMap.invalidateSize(); }, 200);
  }

  // Switch satellite map overlay + preview to a time-focus image
  window._satShowTfImage = function(idx) {
    var images = window._satTfImages;
    var bbox = window._satTfBbox;
    if (!images || !images[idx] || !images[idx].image_b64) return;
    var img = images[idx];
    var imgSrc = "data:image/png;base64," + img.image_b64;

    // Update map overlay
    if (WZ._liveMap && WZ._liveMarkers && (img.bbox || bbox)) {
      WZ._liveMarkers.clearLayers();
      var bb = img.bbox || bbox;
      var bounds = [[bb[1], bb[0]], [bb[3], bb[2]]];
      L.imageOverlay(imgSrc, bounds, { opacity: 0.9, interactive: false }).addTo(WZ._liveMarkers);
    }

    // Update preview image and date
    var previewImg = document.getElementById("wz-sat-img");
    if (previewImg) previewImg.src = imgSrc;
    var previewDate = document.getElementById("sat-preview-date");
    if (previewDate) previewDate.textContent = window._satFmtDate ? window._satFmtDate(img.date) : (img.date || "");

    // Highlight selected thumbnail
    document.querySelectorAll(".sat-tf-thumb").forEach(function(el) {
      el.style.background = "none";
      var i = el.querySelector("img");
      if (i) i.style.borderColor = "var(--border)";
    });
    var sel = document.querySelector('.sat-tf-thumb[data-idx="' + idx + '"]');
    if (sel) {
      sel.style.background = "rgba(14,165,233,.15)";
      var si = sel.querySelector("img");
      if (si) si.style.borderColor = "#f59e0b";
    }
  };

  WZ.registerPlugin('satellite', {
    renderer: _renderSatelliteLive,
    show_permanent_labels: true,
    auto_fit_bounds: true,
    default_source: "sentinel",
    open_button_label: "Image",
    open_button_i18n: "wz_btn_image",
    has_live_map: true,
    live_title_prefix: "Satellite Image:",
    live_title_i18n: "wz_live_prefix_satellite",
    live_box_max_width: "1400px",
    live_box_height: "68vh",
  });

  // Collect Renderer
  WZ._collectRenderers["satellite"] = {
    renderHTML: function(data, cardId) {
      var h = "";
      var fmtD = WZ._fmtDate || function(s) { return s ? String(s).slice(0,10) : ""; };
      var hasTfImages = data.time_focus_images && data.time_focus_images.some(function(tfi) { return tfi.image_b64; });
      if (hasTfImages) {
        // Focus time: show 3 comparison images, skip current
        h += '<div style="display:flex;gap:8px;overflow-x:auto;margin-bottom:8px;">';
        data.time_focus_images.forEach(function(tfi) {
          var imgSrc = tfi.image_b64 ? ("data:image/png;base64," + tfi.image_b64) : "";
          if (!imgSrc) return;
          var tfLabel = tfi.label === "before" ? "Vorher" : tfi.label === "focus" ? "Ereignis" : "Nachher";
          h += '<div style="flex:1;min-width:0;text-align:center;"><img src="' + imgSrc + '" style="width:100%;border-radius:6px;border:1px solid var(--border);cursor:pointer;" onclick="window.open(this.src,\'_blank\')">';
          h += '<div style="font-size:10px;color:var(--muted);margin-top:3px;">' + tfLabel + (tfi.date ? " \u2014 " + fmtD(tfi.date) : "") + '</div></div>';
        });
        h += '</div>';
      } else if (data.image_b64) {
        // No focus time: show current image
        h += '<img src="data:image/png;base64,' + data.image_b64 + '" style="width:100%;border-radius:6px;margin-bottom:8px;cursor:pointer;border:1px solid var(--border);" onclick="window.open(this.src,\'_blank\')" title="Satellitenaufnahme">';
        if (data.date_from && data.date_to) h += '<div style="font-size:10px;color:var(--muted);margin-bottom:6px;">Zeitfenster: ' + fmtD(data.date_from) + ' \u2013 ' + fmtD(data.date_to) + '</div>';
      }
      return h;
    }
  };

})();
