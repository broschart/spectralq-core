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
    document.getElementById("wz-live-count").textContent =
      `Sentinel-2 \u00b7 ${data.date_from} ${t('wz_sat_to','to')} ${data.date_to}` + (data.cropped ? " " + t('wz_sat_cropped','(cropped)') : "");

    if (WZ._liveMarkers) WZ._liveMarkers.clearLayers();

    // ── Layout: Karte volle Höhe links, Info-Panel rechts ──
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
    // Alles unterhalb Karte ausblenden
    ["wz-live-body","wz-under-map-bar","wz-resize-map","wz-live-sticky"].forEach(function(id) {
      var el = document.getElementById(id); if (el) el.style.display = "none";
    });

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

    // ── Seitenpanel erstellen ──
    var panel = document.getElementById("sat-side-panel");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "sat-side-panel";
      panel.style.cssText = "width:360px;flex-shrink:0;border-left:1px solid var(--border);background:var(--surface);display:flex;flex-direction:column;overflow-y:auto;";
      mapRow.appendChild(panel);
    }
    panel.style.display = "flex";

    var html = '<div style="padding:16px;">';

    // Vorschaubild
    if (imgSrc) {
      html += `<div style="margin-bottom:14px;cursor:pointer;" onclick="wzSatFullscreen(document.getElementById('wz-sat-img'))">
        <img id="wz-sat-img" src="${imgSrc}" style="width:100%;border-radius:8px;border:1px solid var(--border);" title="${t('wz_sat_click_fullscreen','Click for fullscreen')}" />
      </div>`;
    }

    // Metadaten
    html += `<h4 style="margin:0 0 10px;font-size:14px;font-weight:600;">${t('wz_sat_true_color','Sentinel-2 True-Color')}</h4>`;
    html += '<div style="font-size:12px;line-height:2;color:var(--text);">';
    html += `<div>${t('wz_sat_period','Period:')} <strong>${WZ._esc(data.date_from)} \u2013 ${WZ._esc(data.date_to)}</strong></div>`;
    html += `<div>${t('wz_sat_zone_label','Zone:')} <strong>${WZ._esc(data.zone_name)}</strong></div>`;
    if (data.bbox) html += `<div style="color:var(--muted);font-size:11px;">BBox: ${data.bbox.map(function(v){return v.toFixed(4);}).join(", ")}</div>`;
    if (data.cropped) html += `<div style="color:#f59e0b;font-size:11px;">${t('wz_sat_crop_warning','Region clipped to max. 2\u00d7\u00b02\u00b0')}</div>`;
    html += '</div>';

    // Aktions-Buttons
    html += '<div style="margin-top:16px;display:flex;flex-direction:column;gap:8px;">';
    if (imgSrc) {
      html += `<button onclick="wzSatFullscreen(document.getElementById('wz-sat-img'))"
        style="font-size:12px;font-weight:600;color:#fff;background:var(--accent1);
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


  WZ._onLiveClose.push(function() {
    var panel = document.getElementById("sat-side-panel");
    if (panel) { panel.style.display = "none"; panel.innerHTML = ""; }
  });

  WZ.registerPlugin('satellite', {
    renderer: _renderSatelliteLive,
    show_permanent_labels: true,
    auto_fit_bounds: true,
    default_source: "sentinel",
    open_button_label: "Image",
    open_button_i18n: "wz_btn_image",
    live_title_prefix: "Satellite Image:",
    live_title_i18n: "wz_live_prefix_satellite",
    live_box_max_width: "1400px",
    openStrategy: "preload",
  });

})();
