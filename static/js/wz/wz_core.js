/**
 * WZ Core — shared state, maps, zone CRUD, live popup, traceroute.
 * Requires window.WZ namespace to be set up by template.
 */
(function() {
"use strict";
const WZ = window.WZ;

  // ── Map Styles ─────────────────────────────────────────────────────────
  const _MAP_STYLES = {
    street:    { label: "Street",    url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" },
    dark:      { label: "Dark",      url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" },
    light:     { label: "Light",     url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" },
    satellite: { label: "Satellite", url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" },
    terrain:   { label: "Terrain",   url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png" },
    osm:       { label: "OpenStreetMap", url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" },
  };
  function _tileUrl(styleId) {
    return (_MAP_STYLES[styleId] || _MAP_STYLES.street).url;
  }
  WZ._MAP_STYLES = _MAP_STYLES;

  // ── Map Distance Measurement (D key) ──────────────────────────────────
  var _distMap = null;
  var _distMarkerA = null;
  var _distMarkerB = null;
  var _distLine = null;
  var _distCircle = null;
  var _distPanel = null;
  var _distPhase = 0;  // 0=off, 1=A set+tracking, 2=locked, waiting for exit
  var _distMoveHandler = null;

  function _distCleanup() {
    if (_distMoveHandler && _distMap) _distMap.off("mousemove", _distMoveHandler);
    if (_distMarkerA && _distMap) _distMap.removeLayer(_distMarkerA);
    if (_distMarkerB && _distMap) _distMap.removeLayer(_distMarkerB);
    if (_distLine && _distMap) _distMap.removeLayer(_distLine);
    if (_distCircle && _distMap) _distMap.removeLayer(_distCircle);
    _distMarkerA = _distMarkerB = _distLine = _distCircle = null;
    _distMoveHandler = null;
    _distPhase = 0;
    _distMap = null;
    var badge = document.getElementById("wz-dist-badge");
    if (badge) badge.remove();
    var panel = document.getElementById("wz-dist-panel");
    if (panel) panel.remove();
  }

  function _distFmtTime(hours) {
    if (hours < 1/60) return "< 1 Min.";
    if (hours < 1) return Math.round(hours * 60) + " Min.";
    if (hours < 24) return Math.floor(hours) + " Std. " + Math.round((hours % 1) * 60) + " Min.";
    return Math.floor(hours / 24) + " Tage " + Math.round(hours % 24) + " Std.";
  }

  function _distCalcHtml(meters) {
    var km = meters / 1000;
    var distStr = km >= 1 ? km.toFixed(1) + ' km' : Math.round(meters) + ' m';
    var speeds = [
      { icon: "\u25CB", label: "Gehen",    kmh: 5   },
      { icon: "\u25CB", label: "Fahrrad",  kmh: 20  },
      { icon: "\u25CB", label: "Auto",     kmh: 120 },
    ];
    if (km > 50) speeds.push({ icon: "\u25CB", label: "Flugzeug", kmh: 900 });
    var tc = "#ccc";
    var h = '<div style="font-weight:700;font-size:16px;color:#8b5cf6;margin-bottom:6px;">' + distStr + '</div>';
    speeds.forEach(function(sp) {
      var hours = km / sp.kmh;
      h += '<div style="display:flex;align-items:center;gap:8px;margin:3px 0;font-size:12px;">' +
        '<span style="color:' + tc + ';min-width:80px;">' + sp.icon + ' ' + sp.label + '</span>' +
        '<span style="color:' + tc + ';font-weight:600;min-width:90px;">' + _distFmtTime(hours) + '</span>' +
        '<span style="color:rgba(255,255,255,.25);font-size:10px;">' + sp.kmh + ' km/h</span></div>';
    });
    return h;
  }

  function _distUpdateLine(latlng) {
    if (!_distMarkerA || !_distMap) return;
    var a = _distMarkerA.getLatLng();
    if (_distLine) _distMap.removeLayer(_distLine);
    _distLine = L.polyline([a, latlng], { color: '#8b5cf6', weight: 2, dashArray: '6,5', opacity: 0.7 }).addTo(_distMap);
    if (_distMarkerB) _distMap.removeLayer(_distMarkerB);
    _distMarkerB = L.circleMarker(latlng, { radius: 5, fillColor: '#8b5cf6', color: '#fff', weight: 2, fillOpacity: 0.8 }).addTo(_distMap);
    // Radius circle
    var meters = a.distanceTo(latlng);
    if (_distCircle) _distMap.removeLayer(_distCircle);
    if (meters > 10) {
      _distCircle = L.circle(a, { radius: meters, color: '#8b5cf6', weight: 1.5, fillOpacity: 0.04, dashArray: '6,4', interactive: false }).addTo(_distMap);
    }
    // Update panel
    var panel = document.getElementById("wz-dist-panel");
    if (panel && meters > 10) panel.innerHTML = _distCalcHtml(meters);
  }

  function _distAddUI(map) {
    // Badge
    var old = document.getElementById("wz-dist-badge");
    if (old) old.remove();
    var badge = document.createElement("div");
    badge.id = "wz-dist-badge";
    badge.style.cssText = "position:absolute;top:10px;left:50%;transform:translateX(-50%);z-index:1000;" +
      "background:rgba(139,92,246,.9);color:#fff;padding:4px 14px;border-radius:6px;" +
      "font-size:11px;font-weight:700;pointer-events:none;white-space:nowrap;";
    map.getContainer().style.position = "relative";
    map.getContainer().appendChild(badge);
    // Panel (top-right)
    var oldP = document.getElementById("wz-dist-panel");
    if (oldP) oldP.remove();
    var panel = document.createElement("div");
    panel.id = "wz-dist-panel";
    panel.style.cssText = "position:absolute;top:10px;right:60px;z-index:1000;" +
      "background:rgba(40,40,50,.92);border:1px solid rgba(139,92,246,.4);border-radius:8px;" +
      "padding:10px 14px;pointer-events:none;min-width:180px;";
    map.getContainer().appendChild(panel);
  }

  function _distSetBadge(text) {
    var badge = document.getElementById("wz-dist-badge");
    if (badge) badge.textContent = "\u2194 " + text;
  }

  function _distFindMap() {
    // 1. Try the current live map (from any open popup)
    if (WZ._liveMap) {
      try {
        var container = WZ._liveMap.getContainer();
        if (container && container.offsetParent !== null) return WZ._liveMap;
      } catch(e) {}
    }
    // 2. Try internet health map
    if (window._ihLeafletMap) {
      try {
        var c2 = window._ihLeafletMap.getContainer();
        if (c2 && c2.offsetParent !== null) return window._ihLeafletMap;
      } catch(e) {}
    }
    // 3. Try panel maps
    for (var p in _maps) {
      try {
        var c3 = _maps[p].getContainer();
        if (c3 && c3.offsetParent !== null) return _maps[p];
      } catch(e) {}
    }
    // 4. Fallback: any visible leaflet container
    var found = null;
    document.querySelectorAll(".leaflet-container").forEach(function(el) {
      if (found) return;
      if (el.offsetParent !== null && el._leaflet_id) found = el._leaflet_map || null;
    });
    return found;
  }

  document.addEventListener("keydown", function(e) {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    var tag = document.activeElement ? document.activeElement.tagName : "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (e.key === "Escape" && _distPhase > 0) { _distCleanup(); return; }
    if (e.key !== "d" && e.key !== "D") return;

    if (_distPhase === 0) {
      // 1st D: find map, set start at current mouse position
      var map = _distFindMap();
      if (!map) return;
      _distMap = map;
      _distAddUI(map);
      // Get current mouse position on map
      var center = map.getCenter();
      _distMarkerA = L.circleMarker(center, { radius: 6, fillColor: '#8b5cf6', color: '#fff', weight: 2, fillOpacity: 1 }).addTo(map);
      _distPhase = 1;
      _distSetBadge("Maus bewegen \u00b7 D = fixieren");
      // Track mouse
      _distMoveHandler = function(ev) { _distUpdateLine(ev.latlng); };
      map.on("mousemove", _distMoveHandler);
      // Also update start marker to mouse position on first move
      var _firstMove = true;
      var _origHandler = _distMoveHandler;
      _distMoveHandler = function(ev) {
        if (_firstMove) {
          _firstMove = false;
          _distMarkerA.setLatLng(ev.latlng);
        }
        _origHandler(ev);
      };
      map.off("mousemove", _origHandler);
      map.on("mousemove", _distMoveHandler);
    } else if (_distPhase === 1) {
      // 2nd D: lock endpoint
      _distMap.off("mousemove", _distMoveHandler);
      _distMoveHandler = null;
      _distPhase = 2;
      _distSetBadge("D = beenden");
    } else if (_distPhase === 2) {
      // 3rd D: exit
      _distCleanup();
    }
  });

  // ── Time Focus Location Marker (shared for all maps) ───────────────────
  WZ._addTimeFocusMarker = function(map) {
    if (!WZ._liveZoneId || !map) return;
    var z = (WZ._zones || []).find(function(z) { return z.id === WZ._liveZoneId; });
    if (!z || !z.config || !z.config.time_focus) return;
    var tf = z.config.time_focus;
    if (tf.lat == null || tf.lon == null) return;
    var icon = L.divIcon({
      className: "",
      html: '<div style="background:#f59e0b;color:#000;font-size:10px;font-weight:700;' +
        'padding:3px 8px;border-radius:5px;white-space:nowrap;width:max-content;' +
        'box-shadow:0 2px 8px rgba(0,0,0,.4);display:flex;align-items:center;gap:4px;">' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>' +
        WZ._esc(tf.title || "Event") + '</div>',
      iconSize: [0, 0], iconAnchor: [0, 15],
    });
    L.marker([tf.lat, tf.lon], { icon: icon }).addTo(map)
      .bindPopup('<div style="font-size:12px;"><strong>' + WZ._esc(tf.title || "") + '</strong>' +
        (tf.location_name ? '<br>' + WZ._esc(tf.location_name) : '') +
        '<br><span style="color:var(--muted);">' + WZ._esc(tf.from || "") +
        (tf.to && tf.to !== tf.from ? ' \u2013 ' + WZ._esc(tf.to) : '') + '</span></div>');
  };

  // ── State ──────────────────────────────────────────────────────────────
  let _activePanel = "global";
  const _maps = {};        // panel → L.Map
  const _drawLayers = {};  // panel → L.FeatureGroup (drawn items)
  const _drawCtrls = {};   // panel → L.Control.Draw
  WZ._zones = [];       // loaded from API
  let _allProjects = [];
  let _savedView = {};     // panel → {center, zoom}  (vor Hover gespeichert)
  let _anchoredZoneId = null; // Zone-ID die per Klick verankert wurde

  // Plugin-IDs und Farben aus Backend-Registry
  const _WZ_PLUGIN_IDS = WZ.PLUGIN_IDS;

  // ── Plugin-Capability-System ────────────────────────────────────────
  const _pluginDefaults = {
    has_map: true,               // hat eine Karte im Panel (false für website, censys)
    has_live_map: true,          // zeigt Karte im Live-Popup
    mix_global_zones: true,      // globale Zonen einmischen
    show_permanent_labels: false,// permanente Labels auf Karte
    auto_fit_bounds: false,      // Karte automatisch auf Zonen zentrieren
    has_heatmap: false,          // Heatmap-Button im Live-Popup
    has_projection: false,       // Projektions-Button im Live-Popup
    has_refresh_bar: false,      // Refresh-Leiste im Live-Popup
    default_source: null,        // Default-Source für neue Zonen
    zone_badge: null,            // fn(z) → HTML für Badge in Zonenliste
    open_button_label: "Live",   // Button-Label in Zonenliste
    open_button_i18n: "wz_btn_live",
    extra_buttons: null,         // fn(z) → HTML für Extra-Buttons
    live_title_prefix: "Live Data:",
    live_title_i18n: "wz_live_prefix_live",
    live_box_max_width: "1400px",
    live_box_height: null,       // Override: "auto", "60vh" etc. (default: 95vh)
    openStrategy: null,          // "preload" | "spinner" | null (default)
    custom_overlay: null,        // fn(zoneId, zone) — Plugin rendert eigenes Overlay komplett
    max_area_sqm: null,          // Maximale Zonenfläche in m² (null = unbegrenzt)
    skip_loading_indicator: false, // Loading-Spinner überspringen (z.B. Website)
    marker_color: null,          // Override Marker-Farbe für Point-Geometrien
    point_popup: null,           // fn(zone, server) → Popup-HTML für Point-Marker
  };

  function _pluginCfg(pluginId) {
    const cfg = WZ._plugins[pluginId];
    if (!cfg) return _pluginDefaults;
    var merged = Object.assign({}, _pluginDefaults, cfg);
    // Plugins ohne eigene Karte mischen keine globalen Zonen ein (außer explizit gesetzt)
    if (!merged.has_map && !cfg.mix_global_zones) merged.mix_global_zones = false;
    return merged;
  }

  // ── PopupContext: Per-Plugin Popup-Instanz ────────────────────────────
  // Klont das Template und gibt ein Context-Objekt zurück
  function _createPopupCtx(zoneId, pluginId, cfg) {
    var tpl = document.getElementById("wz-popup-tpl");
    if (!tpl) { console.error("wz-popup-tpl template not found"); return null; }
    var clone = tpl.content.cloneNode(true);
    var overlayEl = clone.querySelector('[data-role="overlay"]');

    // Eindeutige IDs auf Basis der zoneId vergeben
    var uid = "wz-pop-" + zoneId + "-" + Date.now();
    overlayEl.id = uid;

    // Rolle→Element-Mapping aufbauen
    var _el = {};
    overlayEl.querySelectorAll("[data-role]").forEach(function(e) {
      _el[e.getAttribute("data-role")] = e;
    });

    // Compat: Legacy-IDs auf geklonte Elemente setzen (für alte Plugins)
    var _legacyIds = {
      "overlay": "wz-live-overlay",
      "spinner": "wz-live-spinner",
      "spinner-text": "wz-live-spinner-text",
      "box": "wz-live-box",
      "header": "wz-live-header",
      "title": "wz-live-title",
      "count": "wz-live-count",
      "hdr-spacer": "wz-live-hdr-spacer",
      "wide-btn": "wz-live-wide-btn",
      "fs-btn": "wz-live-fs-btn",
      "zoom-btn": "wz-live-zoom-btn",
      "map-row": "wz-map-row",
      "map": "wz-live-map",
      "under-map-bar": "wz-under-map-bar",
      "resize-map": "wz-resize-map",
      "sticky": "wz-live-sticky",
      "body": "wz-live-body",
      "loading": "wz-live-loading",
      "error": "wz-live-error",
      "content": "wz-live-content",
    };
    Object.keys(_legacyIds).forEach(function(role) {
      if (_el[role]) _el[role].id = _legacyIds[role];
    });

    var _abortCtrl = new AbortController();

    var ctx = {
      uid: uid,
      zoneId: zoneId,
      pluginId: pluginId,
      overlayEl: overlayEl,
      boxEl: _el["box"],
      spinnerEl: _el["spinner"],
      spinnerTextEl: _el["spinner-text"],
      mapEl: _el["map"],
      mapRowEl: _el["map-row"],
      contentEl: _el["content"],
      countEl: _el["count"],
      titleEl: _el["title"],
      headerEl: _el["header"],
      stickyEl: _el["sticky"],
      underMapBar: _el["under-map-bar"],
      bodyEl: _el["body"],
      loadingEl: _el["loading"],
      errorEl: _el["error"],
      resizeMapEl: _el["resize-map"],
      fsBtnEl: _el["fs-btn"],
      map: null,      // Leaflet-Instanz, wird von _initLiveMap gesetzt
      markers: null,  // L.LayerGroup, wird von _initLiveMap gesetzt
      _abortCtrl: _abortCtrl,
      close: function() {
        // Reset zoom/wide/lupe modes
        if (_lupeActive) { _el["zoom-btn"].click(); }
        ctx.boxEl.style.paddingLeft = "";
        var fsEl = document.fullscreenElement || document.webkitFullscreenElement;
        if (fsEl) { try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch(e) {} }
        // Plugin-spezifisches Cleanup
        var _pluginCfgObj = WZ._plugins[pluginId];
        if (_pluginCfgObj && typeof _pluginCfgObj.onClose === "function") {
          try { _pluginCfgObj.onClose(ctx); } catch(e) { console.error("onClose error:", e); }
        }
        // Legacy _onLiveClose Callbacks ausführen
        WZ._onLiveClose.forEach(function(fn) { try { fn(); } catch(e) {} });
        WZ._onLiveClose = [];
        // AbortController abbrechen
        _abortCtrl.abort();
        // Fullscreen beenden
        var _fsEl = document.fullscreenElement || document.webkitFullscreenElement;
        if (_fsEl && overlayEl.contains(_fsEl)) {
          (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        }
        // Traceroute stoppen
        if (typeof _wzTracerouteStop === "function") _wzTracerouteStop();
        // Map zerstören
        if (ctx.map) { ctx.map.remove(); ctx.map = null; }
        // DOM entfernen → alle Event-Listener werden automatisch GC'd
        if (overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
        // Aus aktiven Popups löschen
        WZ._activePopups.delete(zoneId);
        // Legacy-Globals zurücksetzen
        if (WZ._currentCtx === ctx) {
          WZ._currentCtx = null;
          WZ._liveMap = null;
          WZ._liveZoneId = null;
        }
        // Plugin-Store Elemente zurückschieben (Legacy)
        if (typeof _wsReturnToStore === "function") _wsReturnToStore();
      },
    };

    // Event-Handler auf geklonten Elementen verdrahten
    overlayEl.addEventListener("click", function(e) {
      if (e.target === overlayEl) ctx.close();
    });
    _el["close-btn"].addEventListener("click", function() { ctx.close(); });

    // Wide mode: full browser width without fullscreen API
    var _wideMode = false;
    var _wideSaved = null;
    _el["wide-btn"].addEventListener("click", function() {
      if (_wideMode) {
        // Restore
        if (_wideSaved) {
          ctx.boxEl.style.width = _wideSaved.width;
          ctx.boxEl.style.maxWidth = _wideSaved.maxWidth;
          ctx.boxEl.style.borderRadius = _wideSaved.borderRadius;
        }
        _wideMode = false;
        _el["wide-btn"].style.color = "var(--muted)";
      } else {
        _wideSaved = { width: ctx.boxEl.style.width, maxWidth: ctx.boxEl.style.maxWidth, borderRadius: ctx.boxEl.style.borderRadius };
        ctx.boxEl.style.width = "100%";
        ctx.boxEl.style.maxWidth = "100%";
        ctx.boxEl.style.borderRadius = "0";
        _wideMode = true;
        _el["wide-btn"].style.color = "#06b6d4";
      }
      setTimeout(function() { if (WZ._liveMap) WZ._liveMap.invalidateSize(); }, 200);
    });

    // Normal fullscreen
    _el["fs-btn"].addEventListener("click", function() {
      wzToggleFullscreen(ctx.boxEl);
    });

    // Zoom/Lupe mode — magnifying panel on left side of popup
    var _lupeActive = false;
    var _lupePanel = null;
    var _lupeCanvas = null;
    var _lupeZoom = 3;
    var _lupeBusy = false;
    var _lupeShot = null;
    var _lupeInterval = null;

    function _lupeCapture() {
      if (_lupeBusy || !_lupeActive || typeof html2canvas === "undefined") return;
      _lupeBusy = true;
      html2canvas(ctx.boxEl, { backgroundColor: null, scale: 1, logging: false, useCORS: true,
        ignoreElements: function(el) { return el === _lupePanel; }
      }).then(function(c) { _lupeShot = c; _lupeBusy = false; _lupeDraw(); }).catch(function() { _lupeBusy = false; });
    }

    function _lupeDraw() {
      if (!_lupeActive || !_lupeShot || !_lupeCanvas) return;
      var pw = _lupePanel.clientWidth, ph = _lupePanel.clientHeight;
      if (!pw || !ph) return;
      var dpr = window.devicePixelRatio || 1;
      if (_lupeCanvas.width !== pw * dpr || _lupeCanvas.height !== ph * dpr) {
        _lupeCanvas.width = pw * dpr; _lupeCanvas.height = ph * dpr;
        _lupeCanvas.style.width = pw + "px"; _lupeCanvas.style.height = ph + "px";
      }
      var c2 = _lupeCanvas.getContext("2d");
      // Scale mouse coords relative to box
      var boxR = ctx.boxEl.getBoundingClientRect();
      var mx = _lupeMX - boxR.left, my = _lupeMY - boxR.top;
      var srcW = pw / _lupeZoom, srcH = ph / _lupeZoom;
      var sx = (mx / boxR.width) * _lupeShot.width - (srcW * dpr / 2);
      var sy = (my / boxR.height) * _lupeShot.height - (srcH * dpr / 2);
      c2.clearRect(0, 0, pw * dpr, ph * dpr);
      c2.drawImage(_lupeShot, sx, sy, srcW * dpr, srcH * dpr, 0, 0, pw * dpr, ph * dpr);
      // Crosshair
      c2.strokeStyle = "rgba(239,68,68,.35)"; c2.lineWidth = 1;
      c2.beginPath(); c2.moveTo(pw * dpr / 2, 0); c2.lineTo(pw * dpr / 2, ph * dpr); c2.stroke();
      c2.beginPath(); c2.moveTo(0, ph * dpr / 2); c2.lineTo(pw * dpr, ph * dpr / 2); c2.stroke();
    }

    var _lupeMX = 0, _lupeMY = 0;
    function _lupeMouseMove(e) { _lupeMX = e.clientX; _lupeMY = e.clientY; if (_lupeActive && _lupeShot) _lupeDraw(); }

    _el["zoom-btn"].addEventListener("click", function() {
      _lupeActive = !_lupeActive;
      if (_lupeActive) {
        // Create lupe panel
        _lupePanel = document.createElement("div");
        _lupePanel.style.cssText = "position:absolute;left:0;top:0;bottom:0;width:45%;z-index:10;background:var(--bg);border-right:2px solid var(--border);overflow:hidden;";
        _lupeCanvas = document.createElement("canvas");
        _lupeCanvas.style.cssText = "display:block;width:100%;height:100%;";
        _lupePanel.appendChild(_lupeCanvas);
        var info = document.createElement("span");
        info.style.cssText = "position:absolute;bottom:8px;left:50%;transform:translateX(-50%);font-size:10px;color:var(--muted);opacity:.5;pointer-events:none;";
        info.textContent = "Lupe " + _lupeZoom + "\u00d7";
        _lupePanel.appendChild(info);
        ctx.boxEl.style.position = "relative";
        ctx.boxEl.insertBefore(_lupePanel, ctx.boxEl.firstChild);
        // Offset content
        ctx.boxEl.style.paddingLeft = "46%";
        _el["zoom-btn"].style.color = "#f59e0b";
        document.addEventListener("mousemove", _lupeMouseMove);
        _lupeCapture();
        _lupeInterval = setInterval(_lupeCapture, 1500);
      } else {
        // Remove lupe
        if (_lupePanel && _lupePanel.parentNode) _lupePanel.parentNode.removeChild(_lupePanel);
        _lupePanel = null; _lupeCanvas = null; _lupeShot = null;
        ctx.boxEl.style.paddingLeft = "";
        _el["zoom-btn"].style.color = "var(--muted)";
        document.removeEventListener("mousemove", _lupeMouseMove);
        if (_lupeInterval) { clearInterval(_lupeInterval); _lupeInterval = null; }
      }
      setTimeout(function() { if (WZ._liveMap) WZ._liveMap.invalidateSize(); }, 200);
    });

    // In DOM einfügen
    document.body.appendChild(overlayEl);

    // In aktive Popups registrieren
    WZ._activePopups.set(zoneId, ctx);

    // Legacy-Globals setzen (Compat-Shim)
    WZ._currentCtx = ctx;
    WZ._liveZoneId = zoneId;

    return ctx;
  }

  // Compat: wzToggleFullscreen akzeptiert jetzt auch ein Element direkt
  var _origWzToggleFullscreen = window.wzToggleFullscreen;
  window.wzToggleFullscreen = function(elOrId) {
    if (typeof elOrId === "string") {
      // Legacy: ID-String → Element suchen (zuerst im aktuellen Popup-Context)
      var el = document.getElementById(elOrId);
      if (el && _origWzToggleFullscreen) return _origWzToggleFullscreen(elOrId);
    }
    if (elOrId && elOrId.nodeType) {
      // Neues API: Element direkt
      var fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      if (fsEl) {
        (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      } else {
        (elOrId.requestFullscreen || elOrId.webkitRequestFullscreen).call(elOrId);
      }
    }
  };

  // "global" als Pseudo-Plugin registrieren
  WZ._plugins["global"] = {
    show_permanent_labels: true,
    auto_fit_bounds: true,
    mix_global_zones: false,
    default_source: "global",
  };

  // ── Panel-Umschaltung ─────────────────────────────────────────────────
  window.wzSelectPanel = function(panel) {
    _anchoredZoneId = null;
    _savedView = {};
    _highlightRow(null);
    _activePanel = panel;
    document.querySelectorAll(".wz-sidebar-item").forEach(el => {
      el.classList.toggle("active", el.dataset.panel === panel);
    });
    document.querySelectorAll(".wz-panel").forEach(el => {
      el.style.display = el.id === "panel-" + panel ? "" : "none";
    });
    // Update group headers: highlight only if collapsed and contains active plugin
    document.querySelectorAll(".wz-sidebar-group").forEach(grp => {
      var header = grp.querySelector(".wz-sidebar-group-header");
      var body = grp.querySelector(".wz-sidebar-group-body");
      if (!header || !body) return;
      var isClosed = body.style.display === "none";
      var hasActive = !!grp.querySelector('.wz-sidebar-item[data-panel="' + panel + '"]');
      var showHighlight = isClosed && hasActive;
      header.style.background = showHighlight ? "rgba(0,136,204,.1)" : "rgba(255,255,255,.02)";
      // Update label color
      var labelSpan = header.querySelectorAll("span")[1];
      if (labelSpan) labelSpan.style.color = showHighlight ? "#0088cc" : "";
      // Update/remove plugin name badge
      var badge = header.querySelector(".wz-group-active-badge");
      if (showHighlight) {
        var activeItem = grp.querySelector('.wz-sidebar-item[data-panel="' + panel + '"] span');
        var name = activeItem ? activeItem.textContent : panel;
        if (!badge) {
          badge = document.createElement("span");
          badge.className = "wz-group-active-badge";
          badge.style.cssText = "font-size:9px;color:#0088cc;margin-right:4px;";
          header.insertBefore(badge, header.lastElementChild);
        }
        badge.textContent = name;
      } else if (badge) {
        badge.remove();
      }
    });
    // Karte initialisieren / invalidieren
    if (!_maps[panel]) {
      _initMap(panel);
    } else {
      setTimeout(() => _maps[panel].invalidateSize(), 50);
    }
  };

  // ── Karten-Initialisierung ────────────────────────────────────────────
  function _initMap(panel) {
    if (_maps[panel]) return;  // Doppel-Init verhindern
    const elId = "wz-map-" + panel;
    const el = document.getElementById(elId);
    if (!el) return;

    // Unsichtbare Panels können keine Map rendern — warten
    const panelEl = document.getElementById("panel-" + panel);
    if (panelEl && (panelEl.style.display === "none" || panelEl.offsetParent === null)) {
      return;  // wird bei wzSelectPanel erneut versucht
    }

    // Container muss sichtbare Höhe haben — erzwingen + Reflow auslösen
    if (el.offsetHeight < 50) {
      el.style.height = "500px";
      void el.offsetHeight;  // synchroner Reflow erzwingen
    }

    const map = L.map(elId, { zoomControl: false }).setView([48.2, 11.8], 5);
    L.control.zoom({ position: "topright" }).addTo(map);
    var _panelTileLayer = L.tileLayer(_tileUrl("street"), {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
    }).addTo(map);
    L.control.scale({ metric: true, imperial: false }).addTo(map);

    // Map style selector control
    var _styleCtrl = L.Control.extend({
      onAdd: function() {
        var d = L.DomUtil.create("div");
        d.style.cssText = "background:rgba(40,40,50,.85);border-radius:6px;padding:2px;display:flex;gap:1px;";
        L.DomEvent.disableClickPropagation(d);
        Object.keys(_MAP_STYLES).forEach(function(sid) {
          var b = L.DomUtil.create("button", "", d);
          b.textContent = _MAP_STYLES[sid].label;
          b.style.cssText = "background:none;border:none;color:rgba(255,255,255,.5);padding:3px 7px;font-size:9px;cursor:pointer;border-radius:4px;font-weight:600;";
          if (sid === "street") b.style.background = "rgba(255,255,255,.12)";
          b.onclick = function() {
            _panelTileLayer.setUrl(_tileUrl(sid));
            d.querySelectorAll("button").forEach(function(x) { x.style.background = "none"; });
            b.style.background = "rgba(255,255,255,.12)";
          };
        });
        return d;
      }
    });
    new _styleCtrl({ position: "bottomleft" }).addTo(map);

    // Address search control
    var _searchCtrl = L.Control.extend({
      onAdd: function() {
        var d = L.DomUtil.create("div");
        d.style.cssText = "display:flex;gap:0;";
        L.DomEvent.disableClickPropagation(d);
        var inp = L.DomUtil.create("input", "", d);
        inp.type = "text";
        inp.placeholder = t("wz_search_placeholder", "Adresse / Ort suchen\u2026");
        inp.style.cssText = "width:200px;padding:5px 10px;border:1px solid var(--border);border-right:none;" +
          "border-radius:6px 0 0 6px;font-size:12px;background:rgba(40,40,50,.9);color:#e2e8f0;outline:none;";
        var btn = L.DomUtil.create("button", "", d);
        btn.textContent = "\u2315";
        btn.style.cssText = "padding:5px 10px;border:1px solid var(--border);border-radius:0 6px 6px 0;" +
          "background:var(--accent3);color:#fff;cursor:pointer;font-size:14px;font-weight:700;";
        var _searchMarker = null;
        var doSearch = function() {
          var q = inp.value.trim();
          if (!q) return;
          btn.textContent = "\u2026";
          fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(q))
            .then(function(r) { return r.json(); })
            .then(function(data) {
              btn.textContent = "\u2315";
              if (!data || !data.length) { inp.style.borderColor = "#ef4444"; return; }
              inp.style.borderColor = "var(--border)";
              var lat = parseFloat(data[0].lat), lon = parseFloat(data[0].lon);
              map.setView([lat, lon], 13);
              if (_searchMarker) map.removeLayer(_searchMarker);
              _searchMarker = L.marker([lat, lon]).addTo(map)
                .bindPopup('<b>' + (data[0].display_name || q) + '</b>').openPopup();
            })
            .catch(function() { btn.textContent = "\u2315"; });
        };
        btn.onclick = doSearch;
        inp.addEventListener("keydown", function(e) { if (e.key === "Enter") doSearch(); });
        return d;
      }
    });
    new _searchCtrl({ position: "topleft" }).addTo(map);

    const drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);
    _drawLayers[panel] = drawnItems;

    // Eigene Draw-Buttons mit Text (statt Leaflet.Draw-Toolbar)
    const drawBox = L.control({ position: "topleft" });
    drawBox.onAdd = function() {
      const div = L.DomUtil.create("div", "wz-draw-buttons");
      div.innerHTML = `
        <button class="wz-draw-btn" data-mode="rectangle">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="3" width="14" height="10" rx="1"/></svg>
          ${t('wz_draw_zone','Zone zeichnen')}
        </button>`;
      L.DomEvent.disableClickPropagation(div);
      div.querySelectorAll("button").forEach(btn => {
        btn.addEventListener("click", () => {
          const opts = { shapeOptions: { color: WZ.ZONE_COLORS[panel], weight: 1.5, fillOpacity: .25 }, showArea: false, metric: true };
          const drawer = new L.Draw.Rectangle(map, opts);
          drawer.enable();
          _showCrosshair(map);
          _wzStartAreaTooltip(map, panel);
        });
      });
      return div;
    };
    drawBox.addTo(map);
    _drawCtrls[panel] = drawBox;

    map.on(L.Draw.Event.CREATED, function(e) {
      _hideCrosshair(map);
      _wzStopAreaTooltip(map);
      var layer = e.layer;
      // Fläche an der Zone anzeigen
      _wzShowLayerArea(layer, map);

      // Prüfe Flächenlimit für das aktuelle Plugin
      var _cfg = _pluginCfg(panel);
      if (_cfg.max_area_sqm) {
        var latlngs = layer._latlngs ? (layer._latlngs[0] || layer._latlngs) : [];
        var area = latlngs.length >= 3 ? _wzCalcArea(latlngs) : 0;
        if (area > _cfg.max_area_sqm) {
          // Zone zu groß – rot blinken lassen
          layer.setStyle({ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.15, weight: 2 });
          drawnItems.addLayer(layer);
          var blinks = 0;
          var blinkTimer = setInterval(function() {
            layer.setStyle({ fillOpacity: blinks % 2 === 0 ? 0.3 : 0.05 });
            blinks++;
            if (blinks >= 8) {
              clearInterval(blinkTimer);
              drawnItems.removeLayer(layer);
            }
          }, 300);
          // Hinweis-Tooltip
          var center = layer.getBounds ? layer.getBounds().getCenter() : latlngs[0];
          var maxArea = _cfg.max_area_sqm >= 1e6 ? (_cfg.max_area_sqm / 1e6).toFixed(1) + ' km\u00b2' : Math.round(_cfg.max_area_sqm).toLocaleString('de-DE') + ' m\u00b2';
          var warn = L.tooltip({ permanent: true, direction: 'center', className: 'wz-area-warn' })
            .setLatLng(center)
            .setContent('<span style="font-size:12px;font-weight:700;color:#ef4444;text-shadow:0 1px 3px rgba(0,0,0,.8);background:rgba(0,0,0,.7);padding:4px 10px;border-radius:5px;">' +
              t('wz_zone_too_large','Zone zu gro\u00df') + ' (max ' + maxArea + ')</span>')
            .addTo(map);
          setTimeout(function() { map.removeLayer(warn); }, 3500);
          return;
        }
      }

      drawnItems.addLayer(layer);
      _saveNewZone(panel, layer);
    });
    map.on("draw:drawstop", function() { _hideCrosshair(map); _wzStopAreaTooltip(map); });

    _maps[panel] = map;
    _renderZonesOnMap(panel);

    // Leaflet braucht invalidateSize — mehrfach, da Layout noch nicht stabil sein kann
    map.invalidateSize();
    setTimeout(function() { map.invalidateSize(); }, 50);
    setTimeout(function() { map.invalidateSize(); }, 300);
    setTimeout(function() { map.invalidateSize(); }, 1000);
  }

  // ── Fadenkreuz-Linien im Zeichenmodus ─────────────────────────────────
  // ── Flächenberechnung beim Zeichnen ──
  // ── Globale Fullscreen-Funktion für Custom-Overlays ──
  // CSS für Fullscreen-Modus injizieren
  (function() {
    var s = document.createElement('style');
    s.textContent =
      ':fullscreen { width:100vw !important; max-width:100vw !important; height:100vh !important; max-height:100vh !important; border-radius:0 !important; border:none !important; box-shadow:none !important; background:var(--surface) !important; }' +
      ':fullscreen #wz-ac-panel { width:42% !important; }';
    document.head.appendChild(s);
  })();

  // Fullscreen-Button HTML (wiederverwendbar)
  WZ._fsButtonHtml = function(boxId) {
    return '<button id="wz-live-fs-btn" onclick="wzToggleOverlayFS(\'' + boxId + '\')" title="Vollbild" ' +
      'style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px;padding:4px;">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>' +
      '</svg></button>';
  };

  window.wzToggleOverlayFS = function(boxId) {
    var box = document.getElementById(boxId);
    if (!box) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      box.requestFullscreen().catch(function(){});
    }
  };
  document.addEventListener('fullscreenchange', function() {
    // Map-Höhe explizit setzen und invalidieren
    function _fixFS() {
      var mapEl = document.querySelector('#wz-live-map') || document.querySelector('[id$="-map"]');
      var mapRow = mapEl ? mapEl.parentElement : null;
      if (mapRow && mapEl) {
        var h = mapRow.clientHeight;
        if (h > 100) mapEl.style.height = h + 'px';
      }
      if (WZ._liveMap) WZ._liveMap.invalidateSize();
    }
    setTimeout(_fixFS, 100);
    setTimeout(_fixFS, 300);
    setTimeout(_fixFS, 600);
    // ParCoords nach Fullscreen-Wechsel neu zeichnen (Plugin-Hook)
    setTimeout(function() {
      if (WZ._onResizeParcoords) WZ._onResizeParcoords.forEach(function(fn) { fn(); });
    }, 400);
  });

  function _wzFormatArea(sqm) {
    if (sqm >= 1e6) return (sqm / 1e6).toLocaleString('de-DE', {minimumFractionDigits:2, maximumFractionDigits:2}) + ' km\u00b2';
    return Math.round(sqm).toLocaleString('de-DE') + ' m\u00b2';
  }

  function _wzCalcArea(latlngs) {
    // Gauss-Formel auf Ellipsoid (vereinfacht: L.GeometryUtil oder manuell)
    if (typeof L.GeometryUtil !== 'undefined' && L.GeometryUtil.geodesicArea) {
      return L.GeometryUtil.geodesicArea(latlngs);
    }
    // Fallback: Leaflet.Draw readableArea nutzt L.GeometryUtil intern
    // Manuell: Sphärische Berechnung
    var RAD = Math.PI / 180, R = 6371000;
    var n = latlngs.length;
    if (n < 3) return 0;
    var total = 0;
    for (var i = 0; i < n; i++) {
      var j = (i + 1) % n;
      total += (latlngs[j].lng - latlngs[i].lng) * RAD *
               (2 + Math.sin(latlngs[i].lat * RAD) + Math.sin(latlngs[j].lat * RAD));
    }
    return Math.abs(total * R * R / 2);
  }

  var _areaTooltip = null;
  var _areaMouseHandler = null;

  function _wzStartAreaTooltip(map, pluginId) {
    _wzStopAreaTooltip(map);
    var _maxArea = pluginId ? (_pluginCfg(pluginId).max_area_sqm || null) : null;
    var _blinkTimer = null;
    var _blinkState = false;
    map._wzBlinkCleanup = function() { if (_blinkTimer) { clearInterval(_blinkTimer); _blinkTimer = null; } };

    _areaTooltip = L.DomUtil.create('div', 'wz-area-tooltip', map.getContainer());
    _areaTooltip.style.cssText = 'position:absolute;z-index:1000;pointer-events:none;' +
      'background:rgba(0,0,0,.8);color:#fff;padding:4px 10px;border-radius:5px;' +
      'font-size:12px;font-weight:600;font-family:sans-serif;white-space:nowrap;display:none;';

    _areaMouseHandler = function(e) {
      if (!_areaTooltip) return;
      var drawingLayers = [];
      map.eachLayer(function(l) {
        if (l.editing && l.editing._enabled) drawingLayers.push(l);
        if (l._latlngs && l.options && l.options.dashArray) drawingLayers.push(l);
      });

      _areaTooltip.style.left = (e.containerPoint.x + 16) + 'px';
      _areaTooltip.style.top = (e.containerPoint.y - 10) + 'px';

      if (drawingLayers.length) {
        var ll = drawingLayers[drawingLayers.length - 1];
        var pts = ll._latlngs ? (ll._latlngs[0] || ll._latlngs) : [];
        if (pts.length >= 2) {
          var area = _wzCalcArea(pts);
          if (area > 0) {
            var tooLarge = _maxArea && area > _maxArea;
            _areaTooltip.textContent = _wzFormatArea(area) + (tooLarge ? ' \u26a0 ' + t('wz_zone_too_large','Zone zu gro\u00df!') : '');
            _areaTooltip.style.background = tooLarge ? 'rgba(239,68,68,.9)' : 'rgba(0,0,0,.8)';
            _areaTooltip.style.display = 'block';
            // Zeichnungslayer rot blinken wenn zu groß
            if (tooLarge && !_blinkTimer) {
              _blinkTimer = setInterval(function() {
                _blinkState = !_blinkState;
                if (ll.setStyle) ll.setStyle({ color: _blinkState ? '#ef4444' : '#ff8888', fillOpacity: _blinkState ? 0.2 : 0.05 });
              }, 300);
            } else if (!tooLarge && _blinkTimer) {
              clearInterval(_blinkTimer); _blinkTimer = null; _blinkState = false;
              if (ll.setStyle) ll.setStyle({ color: WZ.ZONE_COLORS[pluginId] || '#3b82f6', fillOpacity: 0.25 });
            }
            return;
          }
        }
      }
      _areaTooltip.style.display = 'none';
    };
    map.on('mousemove', _areaMouseHandler);
  }

  function _wzStopAreaTooltip(map) {
    if (_areaMouseHandler) { map.off('mousemove', _areaMouseHandler); _areaMouseHandler = null; }
    if (_areaTooltip) { _areaTooltip.remove(); _areaTooltip = null; }
    // Blink-Timer bereinigen (falls noch aktiv)
    map._wzBlinkCleanup && map._wzBlinkCleanup();
  }

  function _wzShowLayerArea(layer, map) {
    // Area is shown in the draw tooltip (top-left), no center label needed
  }

  function _showCrosshair(map) {
    const container = map.getContainer();
    if (container.querySelector(".wz-crosshair-h")) return; // schon aktiv
    const hLine = document.createElement("div");
    hLine.className = "wz-crosshair-h";
    const vLine = document.createElement("div");
    vLine.className = "wz-crosshair-v";
    container.appendChild(hLine);
    container.appendChild(vLine);
    container.style.cursor = "crosshair";

    function onMove(e) {
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      hLine.style.top = y + "px";
      vLine.style.left = x + "px";
    }
    container.addEventListener("mousemove", onMove);
    container._wzCrosshairCleanup = function() {
      container.removeEventListener("mousemove", onMove);
    };
  }

  function _hideCrosshair(map) {
    const container = map.getContainer();
    const h = container.querySelector(".wz-crosshair-h");
    const v = container.querySelector(".wz-crosshair-v");
    if (h) h.remove();
    if (v) v.remove();
    if (container._wzCrosshairCleanup) {
      container._wzCrosshairCleanup();
      delete container._wzCrosshairCleanup;
    }
    container.style.cursor = "";
  }

  // ── Zeichnen starten (Button-Klick → Rechteck-Modus aktivieren) ─────
  window.wzStartDraw = function(panel) {
    if (!_maps[panel]) {
      _initMap(panel);
      setTimeout(() => wzStartDraw(panel), 300);
      return;
    }
    const map = _maps[panel];
    // Programmatisch den Rechteck-Zeichenmodus starten
    new L.Draw.Rectangle(map, {
      shapeOptions: { color: WZ.ZONE_COLORS[panel], weight: 3, fillOpacity: .25 }
    }).enable();
  };

  // ── Zonen CRUD ────────────────────────────────────────────────────────
  async function _loadZones() {
    try {
      const r = await fetch("/api/watchzones");
      if (!r.ok) return;
      const data = await r.json();
      WZ._zones.length = 0;
      WZ._zones.push(...data);
      // Enrich time_focus with event color if missing
      try {
        const evts = await fetch("/api/events").then(function(r2) { return r2.ok ? r2.json() : []; });
        WZ._zones.forEach(function(z) {
          if (z.config && z.config.time_focus && z.config.time_focus.event_id && !z.config.time_focus.color) {
            var ev = evts.find(function(e) { return e.id === z.config.time_focus.event_id; });
            if (ev && ev.color) z.config.time_focus.color = ev.color;
          }
        });
      } catch(_) {}
      _renderAllZones();
    } catch(e) { console.error("WZ load error:", e); }
  }

  function _renderAllZones() {
    _WZ_PLUGIN_IDS.forEach(panel => {
      _renderZoneList(panel);
      if (_maps[panel]) _renderZonesOnMap(panel);
    });
  }
  WZ._renderAllZones = _renderAllZones;

  // Zonen für ein Panel filtern: eigene Zonen + aktive globale Zonen
  function _activeProjectId() {
    const sel = document.getElementById("hdr-wz-project");
    return sel && sel.value ? parseInt(sel.value) : null;
  }
  function _zonesForPanel(panel) {
    const pid = _activeProjectId();
    const byProject = z => !pid || !z.project_id || z.project_id === pid;
    if (panel === "global") return WZ._zones.filter(z => z.zone_type === "global" && byProject(z));
    const own = WZ._zones.filter(z => z.zone_type === panel && byProject(z));
    if (!_pluginCfg(panel).mix_global_zones) return own;
    const globals = WZ._zones.filter(z => z.zone_type === "global" && byProject(z));
    return [...globals, ...own];
  }

  function _renderZonesOnMap(panel) {
    const drawnItems = _drawLayers[panel];
    if (!drawnItems) return;
    drawnItems.clearLayers();
    const filtered = _zonesForPanel(panel);
    filtered.forEach(z => {
      if (!z.geometry || !z.geometry.type) return;
      try {
        const isGlobal = z.zone_type === "global";
        const color = isGlobal && panel !== "global" ? WZ.ZONE_COLORS.global : WZ.ZONE_COLORS[panel];
        const layer = L.geoJSON(z.geometry, {
          style: { color: color, weight: isGlobal && panel !== "global" ? 1 : 1.5,
                   fillOpacity: isGlobal && panel !== "global" ? .10 : .22,
                   dashArray: isGlobal && panel !== "global" ? "6 4" : null }
        });
        layer.eachLayer(l => {
          l._wzId = z.id;
          l.bindTooltip((isGlobal && panel !== "global" ? "🌐 " : "") + (z.name || "Zone"), { sticky: true, className: "wz-tooltip" });
        });
        drawnItems.addLayer(layer);
        // Permanentes Label oben links über der Zone
        {
          const bbox = WZ._geoBbox(z.geometry);
          if (bbox) {
            const lat = bbox[3];
            const lon = bbox[0];
            // Fläche berechnen
            let areaStr = '';
            try {
              const coords = z.geometry.coordinates;
              if (coords && coords[0]) {
                const pts = coords[0].map(c => L.latLng(c[1], c[0]));
                const area = _wzCalcArea(pts);
                if (area > 0) areaStr = ' \u00b7 ' + _wzFormatArea(area);
              }
            } catch(ae) {}
            const label = L.marker([lat, lon], {
              icon: L.divIcon({
                className: "wz-label-icon",
                html: `<div style="background:${color};color:#fff;font-size:10px;font-weight:600;
                  padding:1px 6px;border-radius:3px;white-space:nowrap;width:max-content;
                  box-shadow:0 1px 3px rgba(0,0,0,.35);pointer-events:none;">${isGlobal && panel !== "global" ? "\ud83c\udf10 " : ""}${WZ._esc(z.name || "Zone")}${areaStr}</div>`,
                iconSize: [0, 0], iconAnchor: [0, 22],
              }),
              interactive: false,
            });
            drawnItems.addLayer(label);
          }
        }
      } catch(e) { console.warn("GeoJSON parse error:", e); }
    });
    // Hint ein/ausblenden
    const hint = document.getElementById("wz-hint-" + panel);
    if (hint) hint.style.display = filtered.length ? "none" : "block";
    // Karte auf Zonen zentrieren (konfigurierbar per Plugin)
    if (_pluginCfg(panel).auto_fit_bounds && filtered.length && _maps[panel]) {
      try { _maps[panel].fitBounds(drawnItems.getBounds(), { padding: [30, 30], maxZoom: 10 }); } catch(e) {}
    }
  }

  function _renderZoneList(panel) {
    const container = document.getElementById("wz-zones-" + panel);
    if (!container) return;
    const filtered = _zonesForPanel(panel);
    // Hint ein/ausblenden (für Panels ohne Karte, z.B. website)
    if (!_maps[panel]) {
      const hint = document.getElementById("wz-hint-" + panel);
      if (hint) hint.style.display = filtered.length ? "none" : "block";
      // 2-column layout for panels without map
      container.classList.add("wz-zone-list-2col");
    }
    if (!filtered.length) {
      container.innerHTML = "";
      return;
    }
    container.innerHTML = filtered.map(z => {
      const isGlobal = z.zone_type === "global";
      const showingInTyped = isGlobal && panel !== "global";
      const _zCfg = showingInTyped ? _pluginCfg(panel) : _pluginCfg(z.zone_type);
      const _btnLabel = t(_zCfg.open_button_i18n, _zCfg.open_button_label);
      const _badge = _zCfg.zone_badge ? _zCfg.zone_badge(z) : "";
      const _extraBtns = (!showingInTyped && !isGlobal && _zCfg.extra_buttons) ? _zCfg.extra_buttons(z) : "";
      const _hoverPanel = showingInTyped ? panel : z.zone_type;
      const _dateStr = z.created_at ? (window.fmtDateOnly ? window.fmtDateOnly(z.created_at) : z.created_at.slice(0,10)) : "";
      const _menuId = `wz-menu-${z.id}-${panel}`;
      return `
      <div class="wz-zone-row" data-id="${z.id}" ${showingInTyped ? 'style="border-left:3px solid #8b5cf6;"' : ""}
           onmouseenter="wzHoverZone(${z.id},'${_hoverPanel}')"
           onmouseleave="wzUnhoverZone('${_hoverPanel}')"
           onclick="wzAnchorZone(${z.id},'${_hoverPanel}',event)">
        <span class="wz-zone-name" ${showingInTyped ? '' : `ondblclick="wzRenameZone(${z.id}, this)"`}>
          ${showingInTyped ? '<span style="color:#8b5cf6;font-size:10px;margin-right:4px;">&#127760;</span>' : ""}${WZ._esc(z.name)}</span>
        ${_badge}
        ${z.config && z.config.time_focus ? '<span style="font-size:9px;color:'+(z.config.time_focus.color||"#f59e0b")+';font-weight:600;white-space:nowrap;" title="Time Focus: '+WZ._esc(z.config.time_focus.title||"")+' ('+WZ._esc(z.config.time_focus.from||"")+')">'+WZ._esc(z.config.time_focus.from||"").slice(0,10)+'</span>' : ''}
        <span class="badge ${z.active ? 'badge-green' : 'badge-red'}" style="cursor:pointer;" title="${t('wz_tt_toggle','Enable/Disable')}" onclick="event.stopPropagation();wzToggleZone(${z.id})">${z.active ? t('wz_active','Active') : t('wz_inactive','Inactive')}</span>
        <div class="wz-zone-actions" onclick="event.stopPropagation()">
          ${showingInTyped
            ? `<button title="${t('wz_fetch_live','Fetch live data')}" onclick="wzOpenLive(${z.id},'${panel}')"
                  style="background:var(--accent3);color:#fff;border-radius:6px;padding:4px 14px;font-size:12px;font-weight:600;">
                ${_btnLabel}</button>`
            : (isGlobal
              ? `<button title="${t('wz_collect','Daten sammeln')}" onclick="wzCollectData(${z.id})"
                    style="background:var(--accent3);color:#fff;border-radius:6px;padding:4px 14px;font-size:12px;font-weight:600;">
                  ${z.config && z.config._last_collect ? t('wz_btn_recollect','Erneut sammeln') : t('wz_btn_collect','Sammeln')}</button>`
              + (z.config && z.config._last_collect
                ? `<button title="${t('wz_last_collect','Letzte Sammlung')}: ${z.config._last_collect.date || ''}" onclick="wzShowLastCollect(${z.id})"
                      style="background:none;border:1px solid var(--accent3);color:var(--accent3);border-radius:6px;padding:4px 10px;font-size:11px;font-weight:600;margin-left:4px;">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px;margin-right:3px;"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>${z.config._last_collect.date || ''}</button>`
                : '')
              : `<button title="${t('wz_fetch_live','Fetch live data')}" onclick="wzOpenLive(${z.id})"
                  style="background:var(--accent3);color:#fff;border-radius:6px;padding:4px 14px;font-size:12px;font-weight:600;">
                ${_btnLabel}</button>
               ${_extraBtns}`)}
          <div class="wz-zone-menu">
            <button onclick="event.stopPropagation();wzToggleMenu('${_menuId}')"
              style="background:none;border:none;color:var(--muted);cursor:pointer;padding:4px 6px;border-radius:4px;font-size:16px;font-weight:700;line-height:1;letter-spacing:1px;"
              onmouseover="this.style.background='rgba(255,255,255,.08)'" onmouseout="this.style.background='none'">&middot;&middot;&middot;</button>
            <div class="wz-zone-menu-dropdown" id="${_menuId}">
              ${_dateStr ? `<div style="padding:6px 12px;font-size:10px;color:var(--muted);">${t('wz_created','Erstellt')}: ${_dateStr}</div>` : ""}
              ${z.config && z.config.time_focus ? `<div style="padding:4px 12px;font-size:10px;color:${z.config.time_focus.color||'#f59e0b'};font-weight:600;">Time Focus: ${WZ._esc(z.config.time_focus.title || "")}</div>` : ""}
              <button class="wz-menu-item" onclick="event.stopPropagation();wzToggleMenu('${_menuId}');wzSetTimeFocus(${z.id})">
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="8" cy="8" r="6"/><path d="M8 4v4l3 2"/></svg>
                ${z.config && z.config.time_focus ? t('wz_change_tf','Time Focus \u00e4ndern') : t('wz_set_tf','Time Focus setzen')}</button>
              <div class="wz-menu-sep"></div>
              ${showingInTyped
                ? `<button class="wz-menu-item" style="opacity:.4;cursor:not-allowed;" onclick="event.stopPropagation();alert('${t('wz_edit_global_hint','Only editable under Global Zones')}')">
                    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M11.5 2.5l2 2L5 13H3v-2L11.5 2.5z"/></svg>
                    ${t('wz_tt_edit','Edit')}</button>`
                : `<button class="wz-menu-item" onclick="event.stopPropagation();wzToggleMenu('${_menuId}');wzEditZone(${z.id},'${z.zone_type}')">
                    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M11.5 2.5l2 2L5 13H3v-2L11.5 2.5z"/></svg>
                    ${t('wz_tt_edit','Edit')}</button>`}
              <div class="wz-menu-sep"></div>
              ${showingInTyped
                ? `<button class="wz-menu-item danger" style="opacity:.4;cursor:not-allowed;" onclick="event.stopPropagation();alert('${t('wz_delete_global_hint','Only deletable under Global Zones')}')">
                    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3"><polyline points="3,4.5 13,4.5"/><path d="M6.5 4.5V3h3v1.5"/><rect x="4.5" y="4.5" width="7" height="9" rx="1"/></svg>
                    ${t('wz_tt_delete','Delete')}</button>`
                : `<button class="wz-menu-item danger" onclick="event.stopPropagation();wzToggleMenu('${_menuId}');wzDeleteZone(${z.id})">
                    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3"><polyline points="3,4.5 13,4.5"/><path d="M6.5 4.5V3h3v1.5"/><rect x="4.5" y="4.5" width="7" height="9" rx="1"/></svg>
                    ${t('wz_tt_delete','Delete')}</button>`}
            </div>
          </div>
        </div>
      </div>`;
    }).join("");
  }

  WZ._esc = function(s) {
    const d = document.createElement("div");
    d.textContent = s || "";
    return d.innerHTML;
  }

  // "..." menu toggle + click-outside close
  window.wzSetTimeFocus = async function(zoneId) {
    var z = WZ._zones.find(function(z2) { return z2.id === zoneId; });
    if (!z) return;
    // Fetch ALL events (not filtered by project, so all events are available as time focus)
    var events = [];
    try {
      var evR = await fetch("/api/events");
      if (evR.ok) events = await evR.json();
    } catch(e) {}

    var currentTf = z.config && z.config.time_focus ? z.config.time_focus.event_id : null;
    var opts = '<option value="">' + t("wz_no_time_focus", "-- Kein Time Focus --") + '</option>';
    events.forEach(function(ev) {
      var dateInfo = ev.start_dt || "";
      if (ev.end_dt) dateInfo += " \u2013 " + ev.end_dt;
      opts += '<option value="' + ev.id + '"' + (ev.id === currentTf ? ' selected' : '') + '>' + WZ._esc(ev.title) + ' (' + dateInfo + ')</option>';
    });

    // Simple modal
    var ov = document.createElement("div");
    ov.style.cssText = "position:fixed;inset:0;z-index:20000;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;";
    ov.innerHTML =
      '<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px 24px;width:min(400px,90vw);box-shadow:0 12px 40px rgba(0,0,0,.5);">' +
        '<h3 style="margin:0 0 12px;font-size:14px;font-weight:700;">Time Focus</h3>' +
        '<select id="wz-tf-select" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font-size:12px;box-sizing:border-box;">' + opts + '</select>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">' +
          '<button id="wz-tf-cancel" style="padding:6px 16px;border:1px solid var(--border);border-radius:6px;background:none;color:var(--muted);cursor:pointer;font-size:12px;">' + t("btn_cancel","Abbrechen") + '</button>' +
          '<button id="wz-tf-save" style="padding:6px 16px;border:none;border-radius:6px;background:var(--accent3);color:#fff;cursor:pointer;font-size:12px;font-weight:600;">' + t("btn_save","Speichern") + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);

    var _resolve2;
    var p2 = new Promise(function(res) { _resolve2 = res; });
    document.getElementById("wz-tf-cancel").onclick = function() { _resolve2(null); };
    document.getElementById("wz-tf-save").onclick = function() { _resolve2(document.getElementById("wz-tf-select").value); };
    ov.addEventListener("click", function(e) { if (e.target === ov) _resolve2(null); });

    var evIdStr = await p2;
    ov.remove();
    if (evIdStr === null) return;

    var cfg = z.config || {};
    if (evIdStr) {
      var ev = events.find(function(e) { return e.id === parseInt(evIdStr); });
      if (ev) {
        cfg.time_focus = { event_id: ev.id, title: ev.title, from: ev.start_dt, to: ev.end_dt || ev.start_dt, color: ev.color || "#f59e0b" };
        if (ev.lat != null && ev.lon != null) {
          cfg.time_focus.lat = ev.lat; cfg.time_focus.lon = ev.lon;
          cfg.time_focus.location_name = ev.location_name || "";
        }
      }
    } else {
      delete cfg.time_focus;
    }

    try {
      var r = await fetch("/api/watchzones/" + zoneId, {
        method: "PUT", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ config: cfg })
      });
      if (r.ok) {
        var updated = await r.json();
        var idx = WZ._zones.findIndex(function(z3) { return z3.id === zoneId; });
        if (idx >= 0) WZ._zones[idx] = updated;
        _renderAllZones();
      }
    } catch(e) { console.error("Set time focus error:", e); }
  };

  window.wzToggleMenu = function(menuId) {
    var dd = document.getElementById(menuId);
    if (!dd) return;
    var isOpen = dd.classList.contains("open");
    // Close all open menus first
    document.querySelectorAll(".wz-zone-menu-dropdown.open").forEach(function(el) { el.classList.remove("open"); });
    if (!isOpen) {
      // Position fixed relative to the "..." button
      var btn = dd.parentElement.querySelector("button");
      if (btn) {
        var r = btn.getBoundingClientRect();
        dd.style.right = (window.innerWidth - r.right) + "px";
        dd.style.bottom = (window.innerHeight - r.top + 4) + "px";
      }
      dd.classList.add("open");
    }
  };
  document.addEventListener("click", function() {
    document.querySelectorAll(".wz-zone-menu-dropdown.open").forEach(function(el) { el.classList.remove("open"); });
  });


  async function _saveNewZone(panel, layer) {
    var geo;
    try { geo = layer.toGeoJSON().geometry; } catch(e) { console.error("GeoJSON error:", e); return; }

    // Fetch ALL events for time focus dropdown
    var events = [];
    try {
      var evR = await fetch("/api/events");
      if (evR.ok) events = await evR.json();
    } catch(e) { /* ignore */ }

    // Show modal dialog instead of prompt()
    var _resolve;
    var promise = new Promise(function(res) { _resolve = res; });

    var ov = document.createElement("div");
    ov.style.cssText = "position:fixed;inset:0;z-index:20000;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;";
    var evOptions = '<option value="">' + t("wz_no_time_focus", "-- Kein Time Focus --") + '</option>';
    events.forEach(function(ev) {
      var dateInfo = ev.start_dt || "";
      if (ev.end_dt) dateInfo += " \u2013 " + ev.end_dt;
      evOptions += '<option value="' + ev.id + '">' + WZ._esc(ev.title) + ' (' + dateInfo + ')</option>';
    });
    ov.innerHTML =
      '<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px 24px;width:min(420px,90vw);box-shadow:0 12px 40px rgba(0,0,0,.5);">' +
        '<h3 style="margin:0 0 14px;font-size:15px;font-weight:700;color:var(--text);">' + t("wz_new_zone_title", "Neue Zone anlegen") + '</h3>' +
        '<div style="margin-bottom:12px;">' +
          '<label style="font-size:12px;font-weight:600;color:var(--muted);display:block;margin-bottom:4px;">' + t("wz_zone_name_label", "Name") + '</label>' +
          '<input id="wz-newzone-name" type="text" value="' + t("wz_zone_name_default", "New Zone") + '" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font-size:13px;box-sizing:border-box;">' +
        '</div>' +
        '<div style="margin-bottom:16px;">' +
          '<label style="font-size:12px;font-weight:600;color:var(--muted);display:block;margin-bottom:4px;">' + t("wz_time_focus_label", "Time Focus (optional)") + '</label>' +
          '<select id="wz-newzone-event" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font-size:12px;box-sizing:border-box;">' +
            evOptions +
          '</select>' +
          '<div style="font-size:10px;color:var(--muted);margin-top:4px;">' + t("wz_time_focus_hint", "Wird als Zeitvoreinstellung f\u00fcr Plugins mit historischen Daten verwendet.") + '</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;">' +
          '<button type="button" id="wz-newzone-cancel" style="padding:6px 16px;border:1px solid var(--border);border-radius:6px;background:none;color:var(--muted);cursor:pointer;font-size:12px;">' + t("btn_cancel", "Abbrechen") + '</button>' +
          '<button type="button" id="wz-newzone-save" style="padding:6px 16px;border:none;border-radius:6px;background:var(--accent3);color:#fff;cursor:pointer;font-size:12px;font-weight:600;">' + t("btn_create", "Anlegen") + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    // Prevent Leaflet from consuming clicks on the modal
    ov.querySelector('div').addEventListener('mousedown', function(e) { e.stopPropagation(); });
    ov.querySelector('div').addEventListener('click', function(e) { e.stopPropagation(); });

    document.getElementById("wz-newzone-name").select();
    document.getElementById("wz-newzone-cancel").onclick = function() { _resolve(null); };
    document.getElementById("wz-newzone-save").onclick = function() {
      var n = document.getElementById("wz-newzone-name").value.trim();
      var evId = document.getElementById("wz-newzone-event").value;
      _resolve({ name: n, eventId: evId ? parseInt(evId) : null });
    };
    document.getElementById("wz-newzone-name").addEventListener("keydown", function(e) {
      if (e.key === "Enter") document.getElementById("wz-newzone-save").click();
      if (e.key === "Escape") _resolve(null);
    });
    ov.addEventListener("click", function(e) { if (e.target === ov) _resolve(null); });

    var result = await promise;
    ov.remove();

    if (!result) {
      // Cancel → remove drawn zone
      const map = _maps[panel];
      if (map) map.eachLayer(l => { if (l === layer) map.removeLayer(l); });
      return;
    }

    var zoneName = result.name || "Neue Zone";
    var timeFocus = null;
    if (result.eventId) {
      var ev = events.find(function(e) { return e.id === result.eventId; });
      if (ev) {
        timeFocus = { event_id: ev.id, title: ev.title, from: ev.start_dt, to: ev.end_dt || ev.start_dt };
        if (ev.lat != null && ev.lon != null) {
          timeFocus.lat = ev.lat;
          timeFocus.lon = ev.lon;
          timeFocus.location_name = ev.location_name || "";
        }
      }
    }

    var zoneConfig = { source: _pluginCfg(panel).default_source || panel };
    if (timeFocus) zoneConfig.time_focus = timeFocus;

    var _projectId = document.getElementById("hdr-wz-project")?.value || null;
    try {
      const r = await fetch("/api/watchzones", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          name: zoneName,
          zone_type: panel,
          geometry: geo,
          config: zoneConfig,
          project_id: _projectId ? parseInt(_projectId) : null,
        })
      });
      if (r.ok) {
        const z = await r.json();
        WZ._zones.push(z);
        _renderAllZones();
      } else {
        var errText = await r.text().catch(function() { return ""; });
        alert("Save failed (" + r.status + "): " + errText);
      }
    } catch(e) { alert("Save zone error: " + e.message); console.error("Save zone error:", e); }
  }

  async function _deleteZone(id) {
    try {
      await fetch("/api/watchzones/" + id, { method: "DELETE" });
      // Traceroute-Historie aus localStorage entfernen
      try { localStorage.removeItem(_wzTrHistKey(id)); } catch(_) {}
      const idx = WZ._zones.findIndex(z => z.id === id);
      if (idx >= 0) WZ._zones.splice(idx, 1);
      _renderAllZones();
    } catch(e) { console.error("Delete zone error:", e); }
  }

  window.wzDeleteZone = function(id) {
    if (!confirm("Zone wirklich löschen?")) return;
    _deleteZone(id);
  };

  window.wzToggleZone = async function(id) {
    const z = WZ._zones.find(z => z.id === id);
    if (!z) return;
    try {
      const r = await fetch("/api/watchzones/" + id, {
        method: "PUT",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ active: !z.active })
      });
      if (r.ok) {
        const updated = await r.json();
        const idx = WZ._zones.findIndex(z => z.id === id);
        if (idx >= 0) WZ._zones[idx] = updated;
        _renderAllZones();
      }
    } catch(e) { console.error("Toggle zone error:", e); }
  };

  // Time-Focus-Location-Marker (wird bei Hover gesetzt/entfernt)
  var _tfLocMarker = null;

  window.wzFocusZone = function(id, panelOverride) {
    const z = WZ._zones.find(z => z.id === id);
    if (!z || !z.geometry) return;
    const map = _maps[panelOverride || z.zone_type];
    if (!map) return;
    // Alten TF-Marker entfernen
    if (_tfLocMarker) { _tfLocMarker.remove(); _tfLocMarker = null; }
    try {
      const layer = L.geoJSON(z.geometry);
      map.fitBounds(layer.getBounds(), { padding: [40, 40], maxZoom: 12 });
    } catch(e) {}
    // Time-Focus-Location anzeigen
    var tf = z.config && z.config.time_focus;
    if (tf && tf.lat && tf.lon) {
      var label = tf.title || 'Focus';
      _tfLocMarker = L.marker([tf.lat, tf.lon], {
        icon: L.divIcon({
          className: '',
          html: '<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%);">' +
            '<div style="background:#f59e0b;color:#000;font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.3);">' +
            WZ._esc(label) + '</div>' +
            '<div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid #f59e0b;"></div></div>',
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        }),
        interactive: false,
      }).addTo(map);
    }
  };

  // ── Hover-Zoom auf Zonen ────────────────────────────────────────────────
  window.wzHoverZone = function(id, panel) {
    if (_anchoredZoneId) return;          // verankert → kein Hover-Zoom
    const map = _maps[panel];
    if (!map) return;
    // Aktuellen View sichern (nur einmal pro Hover-Sequenz)
    if (!_savedView[panel]) {
      _savedView[panel] = { center: map.getCenter(), zoom: map.getZoom() };
    }
    wzFocusZone(id, panel);
    // Aktive Row hervorheben
    _highlightRow(id);
  };

  window.wzUnhoverZone = function(panel) {
    if (_anchoredZoneId) return;          // verankert → nichts restaurieren
    // TF-Location-Marker entfernen
    if (_tfLocMarker) { _tfLocMarker.remove(); _tfLocMarker = null; }
    const map = _maps[panel];
    const sv = _savedView[panel];
    if (map && sv) {
      map.setView(sv.center, sv.zoom, { animate: true });
      _savedView[panel] = null;
    }
    _highlightRow(null);
  };

  window.wzAnchorZone = function(id, panel, evt) {
    const map = _maps[panel];
    if (!map) return;
    if (_anchoredZoneId === id) {
      // Gleiche Zone nochmal geklickt → Verankerung lösen, zurückzoomen
      _anchoredZoneId = null;
      const sv = _savedView[panel];
      if (sv) {
        map.setView(sv.center, sv.zoom, { animate: true });
        _savedView[panel] = null;
      }
      _highlightRow(null);
    } else {
      // Neue Zone verankern
      if (!_savedView[panel]) {
        _savedView[panel] = { center: map.getCenter(), zoom: map.getZoom() };
      }
      _anchoredZoneId = id;
      wzFocusZone(id, panel);
      _highlightRow(id);
    }
  };

  function _highlightRow(activeId) {
    document.querySelectorAll(".wz-zone-row").forEach(row => {
      const rid = parseInt(row.dataset.id);
      if (activeId && rid === activeId) {
        row.style.outline = "2px solid var(--accent3)";
        row.style.outlineOffset = "-2px";
      } else {
        row.style.outline = "";
        row.style.outlineOffset = "";
      }
    });
  }

  window.wzRenameZone = async function(id, el) {
    const z = WZ._zones.find(z => z.id === id);
    if (!z) return;
    const input = document.createElement("input");
    input.className = "wz-inline-edit";
    input.value = z.name;
    el.replaceWith(input);
    input.focus();
    input.select();

    const finish = async () => {
      const newName = input.value.trim() || z.name;
      try {
        const r = await fetch("/api/watchzones/" + id, {
          method: "PUT",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({ name: newName })
        });
        if (r.ok) {
          const updated = await r.json();
          const idx = WZ._zones.findIndex(z => z.id === id);
          if (idx >= 0) WZ._zones[idx] = updated;
        }
      } catch(e) {}
      _renderAllZones();
    };
    input.addEventListener("blur", finish);
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") input.blur();
      if (e.key === "Escape") { input.value = z.name; input.blur(); }
    });
  };

  // ── Zonen-Geometrie bearbeiten ───────────────────────────────────────
  let _editingZoneId = null;
  let _editingLayers = [];   // Leaflet-Layers die gerade editierbar sind
  let _editOrigGeo = null;   // Original-Geometrie zum Wiederherstellen

  window.wzEditZone = function(id, panel) {
    if (_editingZoneId) return;  // schon im Edit-Modus
    const z = WZ._zones.find(z => z.id === id);
    if (!z || !z.geometry) return;
    const map = _maps[panel];
    if (!map) {
      // Kein Karten-Panel (z.B. website) → nur Rename anbieten
      const row = document.querySelector(`.wz-zone-row[data-id="${id}"] .wz-zone-name`);
      if (row) wzRenameZone(id, row);
      return;
    }

    _editingZoneId = id;
    _editOrigGeo = JSON.parse(JSON.stringify(z.geometry));

    // Zone auf Karte fokussieren
    wzFocusZone(id, panel);

    // Alle Layer dieser Zone editierbar machen
    const drawnItems = _drawLayers[panel];
    if (drawnItems) {
      drawnItems.eachLayer(l => {
        if (l._wzId === id && l.editing) {
          l.editing.enable();
          _editingLayers.push(l);
        }
        // GeoJSON-Gruppen: Sublayers prüfen
        if (l._wzId === id && l.eachLayer) {
          l.eachLayer(sub => {
            if (sub.editing) {
              sub.editing.enable();
              _editingLayers.push(sub);
            }
          });
        }
      });
    }

    // Edit-Bar einblenden
    _showEditBar(id, panel);
  };

  function _showEditBar(zoneId, panel) {
    let bar = document.getElementById("wz-edit-bar");
    if (bar) bar.remove();
    bar = document.createElement("div");
    bar.id = "wz-edit-bar";
    bar.style.cssText = "display:flex;align-items:center;gap:8px;padding:8px 16px;background:color-mix(in srgb, var(--accent3) 12%, var(--surface));border:1px solid var(--accent3);border-radius:8px;margin:8px 20px;";
    bar.innerHTML = `
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="var(--accent3)" stroke-width="1.5"><path d="M11.5 2.5l2 2L5 13H3v-2L11.5 2.5z"/></svg>
      <span style="flex:1;font-size:12px;font-weight:600;color:var(--accent3);">${t('wz_editing_zone','Editing zone — drag handles to reshape')}</span>
      <button onclick="wzEditSave('${panel}')" style="background:var(--accent3);color:#fff;border:none;border-radius:6px;padding:5px 16px;font-size:12px;font-weight:600;cursor:pointer;">${t('wz_edit_save','Save')}</button>
      <button onclick="wzEditCancel('${panel}')" style="background:var(--surface);color:var(--muted);border:1px solid var(--border);border-radius:6px;padding:5px 12px;font-size:12px;cursor:pointer;">${t('wz_edit_cancel','Cancel')}</button>`;
    // Vor die Zone-Liste einfügen
    const container = document.getElementById("wz-zones-" + panel);
    if (container) container.parentNode.insertBefore(bar, container);
  }

  window.wzEditSave = async function(panel) {
    if (!_editingZoneId) return;
    // Geometrie aus dem editierten Layer extrahieren
    const drawnItems = _drawLayers[panel];
    let newGeo = null;
    if (drawnItems) {
      drawnItems.eachLayer(l => {
        if (newGeo) return;
        if (l._wzId === _editingZoneId) {
          try { newGeo = l.toGeoJSON().geometry || l.toGeoJSON(); } catch(e) {}
        }
      });
    }
    if (newGeo) {
      // Feature → Geometry, FeatureCollection → erster Feature
      if (newGeo.type === "Feature") newGeo = newGeo.geometry;
      if (newGeo.type === "FeatureCollection" && newGeo.features && newGeo.features.length)
        newGeo = newGeo.features[0].geometry;
      try {
        const r = await fetch("/api/watchzones/" + _editingZoneId, {
          method: "PUT",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({ geometry: newGeo })
        });
        if (r.ok) {
          const updated = await r.json();
          const idx = WZ._zones.findIndex(z => z.id === _editingZoneId);
          if (idx >= 0) WZ._zones[idx] = updated;
        }
      } catch(e) { console.error("Save geometry error:", e); }
    }
    _exitEditMode(panel);
  };

  window.wzEditCancel = function(panel) {
    // Original-Geometrie wiederherstellen
    if (_editingZoneId && _editOrigGeo) {
      const idx = WZ._zones.findIndex(z => z.id === _editingZoneId);
      if (idx >= 0) WZ._zones[idx].geometry = _editOrigGeo;
    }
    _exitEditMode(panel);
  };

  function _exitEditMode(panel) {
    _editingLayers.forEach(l => { try { l.editing.disable(); } catch(e) {} });
    _editingLayers = [];
    _editingZoneId = null;
    _editOrigGeo = null;
    const bar = document.getElementById("wz-edit-bar");
    if (bar) bar.remove();
    _renderAllZones();
  }

  // ── Projekte laden ────────────────────────────────────────────────────
  async function _loadProjects() {
    try {
      const r = await fetch("/api/projects");
      if (!r.ok) { console.error("WZ _loadProjects: fetch failed", r.status); return; }
      _allProjects = await r.json();
      console.log("WZ _loadProjects: got", _allProjects.length, "projects");
      const sel = document.getElementById("hdr-wz-project");
      if (!sel) { console.error("WZ _loadProjects: #hdr-wz-project not found"); return; }
      // Vorhandene dynamische Optionen entfernen (bei erneutem Aufruf)
      while (sel.options.length > (sel.querySelector("option[value='']") ? 1 : 0)) {
        sel.remove(sel.options.length - 1);
      }
      const isSuper = sel.querySelector("option[value='']") !== null;
      _allProjects.forEach(p => {
        const o = document.createElement("option");
        o.value = p.id;
        o.textContent = p.name;
        sel.appendChild(o);
      });
      // Restore last selected project from localStorage
      var savedPid = localStorage.getItem("wz_project_id");
      if (savedPid && Array.from(sel.options).some(o => o.value === savedPid)) {
        sel.value = savedPid;
      } else if (!isSuper && _allProjects.length) {
        sel.value = _allProjects[0].id;
      }
      // Save on change
      sel.addEventListener("change", function() {
        localStorage.setItem("wz_project_id", sel.value);
      });
      // Falls Zonen schon geladen sind, neu rendern mit Projektfilter
      if (WZ._zones.length) _renderAllZones();
    } catch(e) { console.error("WZ _loadProjects error:", e); }
  }

  // ── Live-Daten Popup ──────────────────────────────────────────────────
WZ._liveZoneId = null;
WZ._liveMap = null;
WZ._liveMarkers = null;
WZ._wzWebsiteHistPromise = null;  // Parallel-Prefetch für Wayback-Kalender

WZ._liveAsType = null;  // for global zones viewed in typed panel context

  // Fullscreen loading spinner
  function _wzShowFullSpinner(label) {
    var ov = document.getElementById("wz-loading-overlay");
    if (!ov) return;
    document.getElementById("wz-loading-text").textContent = label || "Lade Daten …";
    ov.style.display = "flex";
  }
  function _wzHideFullSpinner() {
    var ov = document.getElementById("wz-loading-overlay");
    if (ov) ov.style.display = "none";
  }

  window.wzOpenLive = function(zoneId, asType) {
    // Vorheriges Popup schließen
    if (WZ._currentCtx) {
      WZ._currentCtx.close();
    }

    WZ._liveAsType = asType || null;
    const z = WZ._zones.find(z => z.id === zoneId);
    if (!z) return;

    const effectiveType = asType || z.zone_type;
    const _cfg = _pluginCfg(effectiveType);
    const _liveLabel = t(_cfg.live_title_i18n || 'wz_spinner_loading', _cfg.live_title_prefix || 'Lade Daten') + ' — ' + (z.name || 'Zone') + ' …';

    // Custom Overlay: Plugin rendert alles selbst (Legacy-Pfad)
    if (_cfg.custom_overlay) {
      _wzShowFullSpinner(_liveLabel);
      WZ._liveZoneId = zoneId;
      setTimeout(function() {
        _cfg.custom_overlay(zoneId, z);
        _wzHideFullSpinner();
      }, 50);
      return;
    }

    // PopupContext erstellen (klont Template, setzt Legacy-IDs)
    var ctx = _createPopupCtx(zoneId, effectiveType, _cfg);
    if (!ctx) return;

    var _titleText = t(_cfg.live_title_i18n, _cfg.live_title_prefix) + " " + (z.name || "Zone");

    // Strategy: "preload" — Daten im Hintergrund laden, dann Popup zeigen
    if (_cfg.openStrategy === "preload") {
      ctx.overlayEl.style.display = "none";
      _wzShowFullSpinner(_liveLabel);
      WZ._fetchLiveData(zoneId).then(() => {
        _wzHideFullSpinner();
        ctx.overlayEl.style.display = "flex";
        ctx.boxEl.style.maxWidth = _cfg.live_box_max_width;
        ctx.boxEl.style.width = "96%";
        var _h2 = _cfg.live_box_height || "95vh";
        ctx.boxEl.style.height = _h2; ctx.boxEl.style.maxHeight = _h2;
        ctx.titleEl.textContent = _titleText;
        ctx.loadingEl.style.display = "none";
        ctx.contentEl.style.display = "block";
        ctx.bodyEl.style.display = "flex";
        var _showMap2 = _cfg.has_live_map !== false;
        ctx.mapRowEl.style.display = _showMap2 ? "flex" : "none";
        ctx.resizeMapEl.style.display = _showMap2 ? "" : "none";
        const heatBtn = document.getElementById("wz-heatmap-btn");
        if (heatBtn) heatBtn.style.display = "none";
        if (_showMap2) {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              try { _initLiveMap(z); } catch(e) {}
              if (WZ._satLiveMapOverlay) WZ._satLiveMapOverlay();
              setTimeout(() => { if (WZ._liveMap) WZ._liveMap.invalidateSize(); }, 300);
            });
          });
        }
      }).catch((e) => {
        _wzHideFullSpinner();
        if (ctx.overlayEl.parentNode) ctx.close();
        alert(t('wz_load_error_prefix','Error loading:') + " " + (e.message || e));
      });
      return;
    }

    // Strategy: "spinner" — Spinner im Popup zeigen
    if (_cfg.openStrategy === "spinner") {
      ctx.boxEl.style.display = "none";
      ctx.spinnerEl.style.display = "flex";
      ctx.spinnerTextEl.textContent =
        t(_cfg.live_title_i18n, _cfg.live_title_prefix) + ' \u2013 ' + (z.name || (z.config && z.config.url) || "Zone") + " \u2026";
      if (typeof _wzTracerouteStop === "function") _wzTracerouteStop();
      _wzTracerouteZoneId = null;
      WZ._wzWebsiteHistPromise = null;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          ctx.boxEl.style.maxWidth = _cfg.live_box_max_width;
          ctx.boxEl.style.width = "96%";
          var _hSp = _cfg.live_box_height || "95vh";
          ctx.boxEl.style.height = _hSp; ctx.boxEl.style.maxHeight = _hSp;
          ctx.titleEl.textContent = _titleText;
          ctx.countEl.textContent = "";
          ctx.errorEl.style.display = "none";
          ctx.contentEl.style.display = "block";
          ctx.loadingEl.style.display = "none";
          var _spShowMap = _cfg.has_live_map !== false;
          ctx.mapRowEl.style.display = _spShowMap ? "flex" : "none";
          if (!_spShowMap) {
            ctx.mapEl.style.height = "0"; ctx.mapEl.style.minHeight = "0";
          }
          ctx.bodyEl.style.display = "flex";
          ctx.resizeMapEl.style.display = _spShowMap ? "" : "none";
          ctx.underMapBar.style.display = "none";
          if (_cfg.skip_loading_indicator) {
            const renderer = WZ._renderers[effectiveType];
            var _initData = { zone_id: zoneId, count: null, items: [] };
            if (z.config) {
              var _zTf = z.config.time_focus;
              if (!_zTf && z.project_id) {
                var _gzones = WZ._zones.filter(function(gz) { return gz.zone_type === "global" && gz.project_id === z.project_id; });
                for (var _gi = 0; _gi < _gzones.length; _gi++) {
                  if (_gzones[_gi].config && _gzones[_gi].config.time_focus) { _zTf = _gzones[_gi].config.time_focus; break; }
                }
              }
              if (_zTf) _initData.time_focus = _zTf;
              if (z.config.url) _initData.url = z.config.url;
              if (_zTf && _zTf.from) {
                var _tfDt = new Date(_zTf.from.slice(0,10) + "T12:00:00");
                var _tfFrom = new Date(_tfDt); _tfFrom.setDate(_tfFrom.getDate() - 15);
                var _tfTo = new Date(_tfDt); _tfTo.setDate(_tfTo.getDate() + 15);
                _initData.date_from = _tfFrom.toISOString().slice(0,10);
                _initData.date_to = _tfTo.toISOString().slice(0,10);
              }
            }
            if (renderer) renderer(_initData);
          } else {
            WZ._fetchLiveData(zoneId);
          }
        });
      });
      return;
    }

    // Default strategy — Popup versteckt, Fullscreen-Spinner, Overlay nach Daten-Load
    ctx.overlayEl.style.display = "none";
    _wzShowFullSpinner(_liveLabel);
    if (typeof _wzTracerouteStop === "function") _wzTracerouteStop();
    _wzTracerouteZoneId = null;

    WZ._pendingLiveCfg = {
      maxWidth: _cfg.live_box_max_width,
      height: _cfg.live_box_height || "95vh",
      showMap: _cfg.has_live_map !== false,
      title: _titleText,
      zone: z,
      ctx: ctx,
    };

    WZ._fetchLiveData(zoneId);
  };

  // ── Website-Plugin-Elemente aus Store in Popup verschieben ──────────
  function _wsInjectElements() {
    var store = document.getElementById("wz-plugin-store");
    if (!store) return;
    // Map-Insets (Cesium 3D, Hop HUD) in die Map
    var map = document.getElementById("wz-live-map");
    var cesium = document.getElementById("wz-cesium-container");
    if (cesium && cesium.parentNode === store) map.appendChild(cesium);
    var hud = document.getElementById("wz-hop-hud");
    if (hud && hud.parentNode === store) map.appendChild(hud);
    // Trace-Panel in die Map-Row
    var mapRow = document.getElementById("wz-map-row");
    var trace = document.getElementById("wz-trace-panel");
    if (trace && trace.parentNode === store) mapRow.appendChild(trace);
    // Undermap-Buttons
    var underMap = document.getElementById("wz-under-map-bar");
    var histBtn = document.getElementById("wz-hist-btn");
    if (histBtn && histBtn.parentNode === store) underMap.appendChild(histBtn);
    var trBtn = document.getElementById("wz-traceroute-btn");
    if (trBtn && trBtn.parentNode === store) underMap.appendChild(trBtn);
  }

  function _wsReturnToStore() {
    var store = document.getElementById("wz-plugin-store");
    if (!store) return;
    ["wz-cesium-container","wz-hop-hud","wz-trace-panel",
     "wz-hist-btn","wz-traceroute-btn"].forEach(function(id) {
      var el = document.getElementById(id);
      if (el && el.parentNode !== store) store.appendChild(el);
    });
  }

  window.wzOpenTraceroute = function(zoneId) {
    // Vorheriges Popup schließen
    if (WZ._currentCtx) WZ._currentCtx.close();

    WZ._liveAsType = null;
    const z = WZ._zones.find(z => z.id === zoneId);
    if (!z) return;

    var _cfg = _pluginCfg("website");
    var ctx = _createPopupCtx(zoneId, "website", _cfg);
    if (!ctx) return;

    _wsInjectElements();
    ctx.boxEl.style.maxWidth = "1400px";
    ctx.boxEl.style.height = "90vh";
    ctx.boxEl.style.maxHeight = "90vh";
    ctx.titleEl.textContent = t('wz_live_prefix_server','Server:') + " " + (z.name || "Zone");
    ctx.countEl.textContent = "";
    // Karte zeigen, Body ausblenden
    ctx.mapRowEl.style.display = "flex";
    ctx.mapRowEl.style.flex = "1";
    ctx.mapRowEl.style.minHeight = "0";
    ctx.bodyEl.style.display = "none";
    // Traceroute-Bar einblenden
    ctx.underMapBar.style.display = "flex";
    _wzTracerouteZoneId = zoneId;
    _wzTrHistBtnUpdate(zoneId);

    // Karte + Trace-Panel füllen den gesamten verfügbaren Platz via Flex
    ctx.boxEl.classList.add("wz-map-fill");
    ctx.mapEl.style.height = "100%";
    // Trace-Panel: flex-layout aktivieren damit die Hop-Liste scrollbar wird
    const trPanel = document.getElementById("wz-trace-panel");
    if (trPanel) trPanel.style.display = "flex";

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        _initLiveMap(z);
        _wzTracerouteSyncHeight();
        setTimeout(() => {
          if (WZ._liveMap) WZ._liveMap.invalidateSize();
          wzStartTraceroute();
        }, 300);
      });
    });
  };

  // ── Traceroute ───────────────────────────────────────────────────────────
  let _wzTracerouteZoneId = null;
  let _wzTracerouteEvtSrc = null;
  let _wzTracerouteLayer  = null;
  let _wzTracerouteHops      = [];
  let _wzTracerouteMarkers   = {};
  let _wzTracerouteAnomalies = []; // { type, hop, msg, color }
  let _wzHopEnrichment = {};       // ip → { whois, bgp }

  // ── Hop-HUD (Hover- und Slow-Mo-Overlay unten auf der Karte) ─────────────
  function _wzHudShow(hopNum) {
    const hud = document.getElementById('wz-hop-hud');
    if (!hud) return;
    const d = _wzTracerouteHops.find(h => h.hop === hopNum);
    if (!d) { hud.style.display = 'none'; return; }

    const loc  = [d.city, d.country].filter(Boolean).join(', ');
    const enr  = d.ip ? (_wzHopEnrichment[d.ip] || {}) : {};
    const org  = enr.whois && (enr.whois.org || enr.whois.netname);
    const cc   = enr.whois && enr.whois.country ? `[${enr.whois.country}]` : '';
    const pfx  = enr.bgp && enr.bgp.prefix;
    const anomalies = _wzTracerouteAnomalies.filter(a => a.hop === hopNum);

    // Farbcode für den Hop (konsistent mit Marker-Farbe)
    const isLast = hopNum === (_wzTracerouteHops.filter(h=>h.ip).pop() || {}).hop;
    const hopColor = d.routingAnomaly ? '#f59e0b' : (isLast ? '#22c55e' : '#06b6d4');

    // ── Progressbars: Kilometer + Zeit ───────────────────────────────────────
    // Kilometerfortschritt: kumulierte Distanz bis zu diesem Hop / Gesamtstrecke
    const geoHops = _wzTracerouteHops.filter(h => h.lat != null && h.lng != null);
    let cumKm = 0, totalKmRoute = 0;
    for (let i = 1; i < geoHops.length; i++) {
      const seg = WZ._haversineKm(geoHops[i-1].lat, geoHops[i-1].lng, geoHops[i].lat, geoHops[i].lng);
      totalKmRoute += seg;
      if (geoHops[i].hop <= hopNum) cumKm += seg;
    }
    const kmPct  = totalKmRoute > 0 ? Math.round(cumKm / totalKmRoute * 100) : 0;

    // Zeitfortschritt: RTT dieses Hops / RTT letzter Hop
    const lastRttHop = [..._wzTracerouteHops].filter(h => h.ip && parseFloat(h.rtt) > 0).pop();
    const totalRtt   = lastRttHop ? parseFloat(lastRttHop.rtt) : 0;
    const hopRtt     = parseFloat(d.rtt) || 0;
    const rttPct     = totalRtt > 0 ? Math.round(hopRtt / totalRtt * 100) : 0;

    function bar(pct, color, label, value, total, unit, idKey) {
      return `
        <div style="display:flex;align-items:center;gap:8px;margin-top:7px;">
          <span style="font-size:9px;color:rgba(255,255,255,.45);min-width:52px;white-space:nowrap;">${label}</span>
          <div style="flex:1;height:5px;background:rgba(255,255,255,.12);border-radius:3px;overflow:hidden;min-width:80px;">
            <div id="wz-hud-${idKey}-bar" style="height:100%;width:${pct}%;background:${color};border-radius:3px;"></div>
          </div>
          <span id="wz-hud-${idKey}-val" style="font-size:9px;color:${color};min-width:80px;white-space:nowrap;">
            ${value} <span style="color:rgba(255,255,255,.3);">/ ${total} ${unit}</span>
          </span>
          <span id="wz-hud-${idKey}-pct" style="font-size:9px;color:rgba(255,255,255,.4);min-width:28px;text-align:right;">${pct}%</span>
        </div>`;
    }

    hud.innerHTML = `
      <div style="display:flex;align-items:baseline;gap:16px;flex-wrap:wrap;">
        <span style="font-size:28px;font-weight:900;color:${hopColor};line-height:1;min-width:48px;">#${d.hop}</span>
        <span style="font-size:18px;font-weight:700;color:#fff;font-family:monospace;">
          ${d.ip ? WZ._esc(d.ip) : '<span style="color:rgba(255,255,255,.4);">* * *</span>'}
        </span>
        ${d.rtt ? `<span style="font-size:15px;color:#a78bfa;font-weight:700;">${WZ._esc(d.rtt)}</span>` : ''}
        ${loc ? `<span style="font-size:13px;color:rgba(255,255,255,.7);">&#x1F4CD; ${WZ._esc(loc)}</span>` : ''}
      </div>
      <div style="display:flex;gap:20px;flex-wrap:wrap;margin-top:5px;align-items:center;">
        ${d.asn ? `<span style="font-size:11px;color:rgba(255,255,255,.55);">${WZ._esc(d.asn)}</span>` : ''}
        ${org   ? `<span style="font-size:11px;color:rgba(255,255,255,.55);">&#x1F3E2; ${WZ._esc(org)} ${cc}</span>` : ''}
        ${pfx   ? `<span style="font-size:10px;color:rgba(255,255,255,.4);font-family:monospace;">${WZ._esc(pfx)}</span>` : ''}
        ${d.rdns && d.rdns !== d.ip ? `<span style="font-size:10px;color:rgba(255,255,255,.4);font-family:monospace;">${WZ._esc(d.rdns)}</span>` : ''}
        ${anomalies.map(a => `<span style="font-size:10px;color:${a.color};font-weight:700;">⚠ ${WZ._esc(a.msg.replace(/^Hop \d+[:\s]*/,'').substring(0,60))}…</span>`).join('')}
      </div>
      ${totalKmRoute > 0 ? bar(kmPct,  '#06b6d4', 'Distanz', Math.round(cumKm).toLocaleString('de-DE')+' km', Math.round(totalKmRoute).toLocaleString('de-DE'), 'km', 'km') : ''}
      ${totalRtt     > 0 ? bar(rttPct, '#a78bfa', 'Latenz',  hopRtt.toFixed(1)+' ms', totalRtt.toFixed(1), 'ms', 'rtt') : ''}`;

    hud.style.display = 'block';
    hud.style.opacity = '1';
  }

  function _wzHudHide() {
    const hud = document.getElementById('wz-hop-hud');
    if (hud) { hud.style.opacity = '0'; setTimeout(() => { if (hud.style.opacity === '0') hud.style.display = 'none'; }, 200); }
  }
  function _wzHudUpdateBars(kmCur, kmTotal, rttCur, rttTotal) {
    if (kmTotal > 0) {
      const p = Math.min(100, kmCur / kmTotal * 100);
      const b = document.getElementById('wz-hud-km-bar');
      const v = document.getElementById('wz-hud-km-val');
      const c = document.getElementById('wz-hud-km-pct');
      if (b) b.style.width = p.toFixed(1) + '%';
      if (v) { const tn = v.firstChild; if (tn) tn.textContent = Math.round(kmCur).toLocaleString('de-DE') + ' km '; }
      if (c) c.textContent = Math.round(p) + '%';
    }
    if (rttTotal > 0) {
      const p = Math.min(100, rttCur / rttTotal * 100);
      const b = document.getElementById('wz-hud-rtt-bar');
      const v = document.getElementById('wz-hud-rtt-val');
      const c = document.getElementById('wz-hud-rtt-pct');
      if (b) b.style.width = p.toFixed(1) + '%';
      if (v) { const tn = v.firstChild; if (tn) tn.textContent = rttCur.toFixed(1) + ' ms '; }
      if (c) c.textContent = Math.round(p) + '%';
    }
  }

  // ── Slow-Mo state ─────────────────────────────────────────────────────────
  let _wzSlowMoActive = false;
  let _wzSlowMoFrame  = null;
  let _wzSlowMoDot    = null;   // L.circleMarker – roter Punkt
  let _wzSlowMoGlow   = null;   // L.circleMarker – Glanz-Ring
  let _wzSlowMoState  = null;

  function _wzSlowMoStop() {
    _wzSlowMoActive = false;
    if (_wzSlowMoFrame) { cancelAnimationFrame(_wzSlowMoFrame); _wzSlowMoFrame = null; }
    if (_wzSlowMoDot  && WZ._liveMap) { WZ._liveMap.removeLayer(_wzSlowMoDot);  _wzSlowMoDot  = null; }
    if (_wzSlowMoGlow && WZ._liveMap) { WZ._liveMap.removeLayer(_wzSlowMoGlow); _wzSlowMoGlow = null; }
    _wzSlowMoState = null;
    _wzHudHide();
    const b = document.getElementById('wz-slowmo-btn');
    if (b) { b.innerHTML = '<svg width="16" height="16" viewBox="0 0 18 18" fill="white" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0"><polygon points="4,2 16,9 4,16"/></svg><span>×1000</span>'; b.style.background = 'var(--accent3)'; b.disabled = false; }
  }

  window.wzToggleSlowMo = function() {
    if (_wzSlowMoActive) { _wzSlowMoStop(); return; }
    if (!WZ._liveMap) return;
    const geoHops = _wzTracerouteHops.filter(h => h.lat != null && h.lng != null);
    if (geoHops.length < 2) return;

    const SLOWDOWN = 1000;
    // Pre-compute total route km + total rtt for progress bars
    let _smTotalKm = 0;
    const _smSegKms = [];
    for (let i = 0; i < geoHops.length - 1; i++) {
      const km = WZ._haversineKm(geoHops[i].lat, geoHops[i].lng, geoHops[i+1].lat, geoHops[i+1].lng);
      _smSegKms.push(km);
      _smTotalKm += km;
    }
    const _smLastRttHop = [..._wzTracerouteHops].filter(h => h.ip && parseFloat(h.rtt) > 0).pop();
    const _smTotalRtt = _smLastRttHop ? parseFloat(_smLastRttHop.rtt) : 0;

    const segments = [];
    let cumKm = 0, cumAnimMs = 0;
    for (let i = 0; i < geoHops.length - 1; i++) {
      const h0 = geoHops[i], h1 = geoHops[i + 1];
      const rtt0 = parseFloat(h0.rtt) || 0;
      const rtt1 = parseFloat(h1.rtt) || 0;
      // Einseitige Latenz zwischen diesen Hops, skaliert mit 1000x Slowdown
      const oneWayMs = Math.max(1, (rtt1 - rtt0) / 2);
      const segKm    = _smSegKms[i];
      const travelMs = Math.max(500, Math.min(7000, oneWayMs * SLOWDOWN));
      const dwellMs  = Math.max(350, Math.min(2000, oneWayMs * SLOWDOWN * 0.3));
      segments.push({
        from:        [h0.lat, h0.lng],
        to:          [h1.lat, h1.lng],
        travelMs,
        dwellMs,
        hopNum:      h1.hop,
        rttDelta:    Math.round(oneWayMs * 2 * 10) / 10,
        city:        h1.city || '',
        country:     h1.country || '',
        cumKmBase:   cumKm,
        segKm,
        cumAnimBase: cumAnimMs,  // Gesamtzeit aller vorherigen Segmente (travel+dwell)
      });
      cumKm     += segKm;
      cumAnimMs += travelMs + dwellMs;
    }
    const _smTotalAnimMs = cumAnimMs;

    // Dot + Glow starten an erstem Hop
    const start = L.latLng(geoHops[0].lat, geoHops[0].lng);
    _wzSlowMoDot = L.circleMarker(start, {
      radius: 8, color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.92, weight: 2.5,
    }).addTo(WZ._liveMap);
    _wzSlowMoGlow = L.circleMarker(start, {
      radius: 14, color: '#ef4444', fillColor: 'transparent', weight: 1.5, opacity: 0.35,
    }).addTo(WZ._liveMap);

    _wzSlowMoActive = true;
    _wzSlowMoState  = { segments, segIdx: 0, phase: 'travel', phaseStart: null,
                        totalKmRoute: _smTotalKm, totalRtt: _smTotalRtt,
                        totalAnimMs: _smTotalAnimMs, lastShownSeg: -1 };

    const smBtn = document.getElementById('wz-slowmo-btn');
    if (smBtn) { smBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="white" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="12" height="12" rx="2"/></svg><span>Stop</span>'; smBtn.style.background = 'rgba(239,68,68,0.9)'; }

    function easeInOut(t) { return t < 0.5 ? 2*t*t : -1 + (4 - 2*t)*t; }

    function frame(ts) {
      if (!_wzSlowMoActive) return;
      const S = _wzSlowMoState;
      if (!S.phaseStart) S.phaseStart = ts;
      const elapsed = ts - S.phaseStart;
      const seg = S.segments[S.segIdx];

      if (S.phase === 'travel') {
        // HUD einblenden sobald neues Segment beginnt
        if (S.lastShownSeg !== S.segIdx) {
          S.lastShownSeg = S.segIdx;
          _wzHudShow(seg.hopNum);
        }
        const t   = Math.min(elapsed / seg.travelMs, 1);
        const te  = easeInOut(t);
        const ll  = L.latLng(
          seg.from[0] + (seg.to[0] - seg.from[0]) * te,
          seg.from[1] + (seg.to[1] - seg.from[1]) * te
        );
        _wzSlowMoDot.setLatLng(ll);
        _wzSlowMoGlow.setLatLng(ll);
        // Leichtes Pulsieren während der Fahrt
        _wzSlowMoDot.setStyle({ fillOpacity: 0.72 + Math.sin(ts / 160) * 0.22 });
        _wzSlowMoGlow.setStyle({ radius: 13 + Math.sin(ts / 220) * 3, opacity: 0.12 + Math.sin(ts / 300) * 0.08 });
        // Progressbars fließend animieren
        const kmCur  = seg.cumKmBase + seg.segKm * te;
        // Latenz-Bar: streng monoton via kumulierter Animationszeit (travel+dwell) → nie rückwärts
        const timeFrac = S.totalAnimMs > 0
          ? Math.min(1, (seg.cumAnimBase + elapsed) / S.totalAnimMs) : t;
        const rttCur = timeFrac * S.totalRtt;
        _wzHudUpdateBars(kmCur, S.totalKmRoute, rttCur, S.totalRtt);
        // Karte nachführen wenn Punkt den sichtbaren Bereich verlässt
        if (t > 0.25 && !WZ._liveMap.getBounds().pad(-0.12).contains(ll))
          WZ._liveMap.panTo(ll, { animate: true, duration: 0.7 });
        if (t >= 1) {
          S.phase = 'dwell'; S.phaseStart = ts;
          _wzSlowMoDot.setStyle({ fillColor: '#fb923c', color: '#fb923c' });
          // Korrespondierende Listenzeile hervorheben
          _wzListHighlight(seg.hopNum, true);
        }

      } else { // dwell – pulsieren am Knotenpunkt
        const t  = Math.min(elapsed / seg.dwellMs, 1);
        const r  = 8  + Math.sin(t * Math.PI) * 10;
        const gr = 16 + Math.sin(t * Math.PI) * 16;
        _wzSlowMoDot.setStyle({ radius: r, fillOpacity: 0.95 - t * 0.25 });
        _wzSlowMoGlow.setStyle({ radius: gr, opacity: (1 - t) * 0.55 });
        // Latenz-Bar läuft auch während Dwell weiter (Zeit vergeht gleichförmig)
        if (S.totalAnimMs > 0) {
          const dwellFrac = Math.min(1, (seg.cumAnimBase + seg.travelMs + elapsed) / S.totalAnimMs);
          _wzHudUpdateBars(seg.cumKmBase + seg.segKm, S.totalKmRoute, dwellFrac * S.totalRtt, S.totalRtt);
        }
        if (t >= 1) {
          // Hervorhebung zurücksetzen
          _wzListHighlight(seg.hopNum, false);
          S.segIdx++;
          if (S.segIdx >= S.segments.length) {
            // Animation abgeschlossen
            _wzSlowMoStop();
            _wzHudHide();
            const b2 = document.getElementById('wz-slowmo-btn');
            if (b2) { b2.innerHTML = '<svg width="16" height="16" viewBox="0 0 18 18" fill="white" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0"><polygon points="4,2 16,9 4,16"/></svg><span>×1000</span>'; b2.style.background = 'var(--accent3)'; }
            return;
          }
          S.phase = 'travel'; S.phaseStart = ts;
          _wzSlowMoDot.setStyle({ radius: 8, fillColor: '#ef4444', color: '#ef4444', fillOpacity: 0.92 });
          _wzSlowMoGlow.setStyle({ radius: 14, opacity: 0.35 });
        }
      }
      _wzSlowMoFrame = requestAnimationFrame(frame);
    }
    _wzSlowMoFrame = requestAnimationFrame(frame);
  };

  function _wzTracerouteStop() {
    _wzSlowMoStop();
    if (_wzTracerouteEvtSrc) { _wzTracerouteEvtSrc.close(); _wzTracerouteEvtSrc = null; }
    if (_wzTracerouteLayer && WZ._liveMap) { WZ._liveMap.removeLayer(_wzTracerouteLayer); _wzTracerouteLayer = null; }
    _wzTracerouteHops = [];
    _wzTracerouteMarkers = {};
    _wzTracerouteAnomalies = [];
    const panel = document.getElementById("wz-trace-panel");
    if (panel) panel.style.display = "none";
    const old = document.getElementById('wz-map-plaus');
    if (old) old.remove();
    if (WZ._liveMap) setTimeout(() => { if (WZ._liveMap) WZ._liveMap.invalidateSize(); }, 50);
    const smBtn = document.getElementById('wz-slowmo-btn');
    if (smBtn) smBtn.style.display = 'none';
    const btn = document.getElementById("wz-traceroute-btn");
    if (btn) { btn.innerHTML = "&#x25B6; Traceroute"; btn.style.background = "var(--accent3)"; btn.style.borderColor = "var(--accent3)"; btn.style.color = "#fff"; }
  }

  function _wzTracerouteDraw() {
    if (!WZ._liveMap) return;
    if (_wzTracerouteLayer) { WZ._liveMap.removeLayer(_wzTracerouteLayer); _wzTracerouteLayer = null; }
    const geo = L.featureGroup().addTo(WZ._liveMap);
    _wzTracerouteLayer = geo;
    _wzTracerouteMarkers = {};
    const pts = _wzTracerouteHops.filter(h => h.lat != null && h.lng != null);
    if (pts.length > 1)
      L.polyline(pts.map(h => [h.lat, h.lng]), { color: '#06b6d4', weight: 2.5, opacity: 0.85, dashArray: '6 4' }).addTo(geo);
    pts.forEach((h, idx) => {
      const isLast = idx === pts.length - 1;
      const col = h.routingAnomaly ? '#f59e0b' : (isLast ? '#22c55e' : '#06b6d4');
      const icon = L.divIcon({
        html: `<div data-tr-hop="${h.hop}" style="background:${col};color:#fff;border-radius:50%;width:22px;height:22px;
                   display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;
                   border:2px solid rgba(255,255,255,.7);box-shadow:0 1px 4px rgba(0,0,0,.4);
                   transition:transform .15s,box-shadow .15s;">${h.hop}</div>`,
        className: '', iconSize: [22, 22], iconAnchor: [11, 11]
      });
      const loc = [h.city, h.country].filter(Boolean).join(', ');
      const m = L.marker([h.lat, h.lng], { icon })
        .bindPopup(`<b>Hop ${h.hop}</b><br>${h.ip}<br>${loc ? loc + '<br>' : ''}${h.rtt}`)
        .addTo(geo);
      m.on('mouseover', () => _wzListHighlight(h.hop, true));
      m.on('mouseout',  () => _wzListHighlight(h.hop, false));
      _wzTracerouteMarkers[h.hop] = m;
    });
    if (pts.length > 0) {
      WZ._liveMap.fitBounds(L.latLngBounds(pts.map(h => [h.lat, h.lng])), { padding: [32, 32], maxZoom: 8 });
    }
  }

  function _wzTracerouteHighlight(hop, on) {
    const m = _wzTracerouteMarkers[hop];
    if (!m) return;
    const el = m.getElement && m.getElement();
    const div = el && el.querySelector('[data-tr-hop]');
    if (!div) return;
    if (on) {
      div.style.transform = 'scale(1.5)';
      div.style.boxShadow = '0 0 0 3px rgba(255,255,255,.9), 0 2px 8px rgba(0,0,0,.5)';
      div.style.zIndex = '999';
      // Karte verschieben falls Marker nicht sichtbar
      if (WZ._liveMap) {
        const ll = m.getLatLng();
        if (!WZ._liveMap.getBounds().contains(ll)) {
          WZ._liveMap.panTo(ll, { animate: true, duration: 0.4 });
        }
      }
    } else {
      div.style.transform = '';
      div.style.boxShadow = '0 1px 4px rgba(0,0,0,.4)';
      div.style.zIndex = '';
    }
  }

  function _wzListHighlight(hop, on) {
    const list = document.getElementById("wz-trace-list");
    if (!list) return;
    const row = list.querySelector(`[data-tr-hop="${hop}"]`);
    if (!row) return;
    if (on) {
      row.style.background = 'var(--surface2)';
      row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else {
      row.style.background = '';
    }
  }

  function _wzTracerouteSyncHeight() {
    const panel  = document.getElementById("wz-trace-panel");
    const lst    = document.getElementById("wz-trace-list");
    if (!lst) return;
    // Panel füllt die volle Höhe der map-row via Flex
    if (panel) { panel.style.height = "100%"; panel.style.display = "flex"; }
    lst.style.overflowY = "auto";
    if (WZ._liveMap) WZ._liveMap.invalidateSize();
  }

  function _wzFmtKm(km) {
    return km >= 100 ? Math.round(km).toLocaleString('de-DE') + ' km'
                     : km.toFixed(1) + ' km';
  }

  window.wzStartTraceroute = function() {
    if (!_wzTracerouteZoneId) return;
    _wzTracerouteStop();

    const panel   = document.getElementById("wz-trace-panel");
    const header  = document.getElementById("wz-trace-header");
    const list    = document.getElementById("wz-trace-list");
    const summBox = document.getElementById("wz-trace-summary");
    if (panel)   panel.style.display = "flex";
    if (header)  header.textContent = "Traceroute …";
    if (list)    list.innerHTML = "";
    if (summBox) { summBox.innerHTML = ""; summBox.style.display = "none"; }
    setTimeout(() => { _wzTracerouteSyncHeight(); if (WZ._liveMap) WZ._liveMap.invalidateSize(); }, 80);

    const btn = document.getElementById("wz-traceroute-btn");
    if (btn) {
      btn.innerHTML = "▶ Traceroute";
      btn.disabled = true;
      btn.style.opacity = "0.45";
      btn.style.cursor = "not-allowed";
    }
    if (list) list.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px 0;gap:16px;">
      <div style="width:44px;height:44px;border:4px solid rgba(255,255,255,.15);border-top-color:#06b6d4;border-radius:50%;animation:wz-spin 0.75s linear infinite;"></div>
      <div style="color:var(--fg,#e2e8f0);font-size:13px;font-weight:600;letter-spacing:.3px;">Tracerouting …</div>
      <div style="color:var(--muted);font-size:10px;opacity:.65;">Hops werden ermittelt</div>
    </div>`;

    let totalKm = 0;

    const es = new EventSource(`/api/watchzones/${_wzTracerouteZoneId}/traceroute`);
    _wzTracerouteEvtSrc = es;

    es.onmessage = e => {
      const d = JSON.parse(e.data);

      if (d.type === 'start') {
        if (header) header.textContent = `Traceroute → ${d.target}`;
        // Spinner bleibt stehen bis der erste Hop eintrifft

      } else if (d.type === 'hop') {
        // Spinner beim ersten Hop entfernen
        if (_wzTracerouteHops.length === 0 && list) list.innerHTML = "";
        // Distanz zum vorherigen Hop berechnen
        const prevGeo = [..._wzTracerouteHops].reverse().find(h => h.lat != null);
        let segKm = null;
        if (prevGeo && d.lat != null)
          segKm = WZ._haversineKm(prevGeo.lat, prevGeo.lng, d.lat, d.lng);
        if (segKm != null) totalKm += segKm;

        _wzTracerouteHops.push(d);
        _wzTracerouteDraw();

        if (list) {
          const loc = [d.city, d.country].filter(Boolean).join(', ');
          const hop = d.hop;
          const row = document.createElement('div');
          row.dataset.trHop = hop;
          if (d.ip) row.dataset.trIp = d.ip;
          row.style.cssText = "padding:5px 10px;border-bottom:1px solid var(--border);display:grid;grid-template-columns:22px 1fr auto;gap:6px;align-items:center;cursor:default;transition:background .1s;";
          row.innerHTML = `
            <span style="color:#06b6d4;font-weight:700;text-align:right;">${hop}</span>
            <div>
              <div style="color:var(--text);">${d.ip ? WZ._esc(d.ip) : '<span style="color:var(--muted);">*</span>'}</div>
              ${loc ? `<div style="color:var(--muted);font-size:10px;">${WZ._esc(loc)}</div>` : ''}
              ${segKm != null ? `<div style="color:rgba(6,182,212,.7);font-size:10px;">+${_wzFmtKm(segKm)}</div>` : ''}
              ${d.rdns && d.rdns !== d.ip ? `<div style="color:var(--muted);font-size:9px;font-family:monospace;">${WZ._esc(d.rdns)}</div>` : ''}
              ${d.asn ? `<div style="color:var(--muted);font-size:9px;">${WZ._esc(d.asn)}</div>` : ''}
              ${d.ts ? `<div style="color:var(--muted);font-size:9px;">${d.ts.replace('T',' ')}</div>` : ''}
            </div>
            <span style="color:var(--muted);white-space:nowrap;font-size:10px;">${WZ._esc(d.rtt)}</span>`;
          row.addEventListener('mouseenter', () => {
            row.style.background = 'var(--surface2)';
            _wzTracerouteHighlight(hop, true);
            _wzHudShow(hop);
          });
          row.addEventListener('mouseleave', () => {
            row.style.background = '';
            _wzTracerouteHighlight(hop, false);
            _wzHudHide();
          });
          list.appendChild(row);

          // ── Geografischer Umweg ──────────────────────────────────────────
          const geoHopsSoFar = _wzTracerouteHops.filter(h => h.lat != null && h.lng != null);
          if (geoHopsSoFar.length >= 3 && d.lat != null) {
            const prev2 = geoHopsSoFar[geoHopsSoFar.length - 3];
            const prev1 = geoHopsSoFar[geoHopsSoFar.length - 2];
            const curr  = geoHopsSoFar[geoHopsSoFar.length - 1];
            const d1 = WZ._haversineKm(prev2.lat, prev2.lng, prev1.lat, prev1.lng);
            const d2 = WZ._haversineKm(prev1.lat, prev1.lng, curr.lat, curr.lng);
            const directDist = WZ._haversineKm(prev2.lat, prev2.lng, curr.lat, curr.lng);
            if (d1 + d2 > directDist * 2.5 && d1 + d2 > 800) {
              d.routingAnomaly = true;
              row.querySelector('div').insertAdjacentHTML('afterbegin',
                '<div style="margin-bottom:3px;"><span style="background:#f59e0b;color:#000;font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;">&#x26A0; Umweg</span></div>');
              _wzTracerouteAnomalies.push({ type: 'umweg', hop: d.hop, color: '#f59e0b',
                msg: `Hop ${d.hop}: Geografischer Umweg – Pfad (${Math.round(d1+d2)} km) deutlich länger als Direktroute (${Math.round(directDist)} km).` });
            }
          }

          // ── RTT-Sprung ───────────────────────────────────────────────────
          const prevRttHop = [..._wzTracerouteHops].slice(0, -1).reverse().find(h => h.ip && parseFloat(h.rtt) > 0);
          const currRtt = parseFloat(d.rtt);
          if (prevRttHop && d.ip && !isNaN(currRtt)) {
            const prevRtt = parseFloat(prevRttHop.rtt);
            const jump = currRtt - prevRtt;
            if (jump >= 80) {
              const col = jump >= 150 ? '#ef4444' : '#f59e0b';
              const label = jump >= 150 ? '&#x26A0; RTT +' + Math.round(jump) + 'ms (Kontinentalwechsel?)' : '&#x26A0; RTT +' + Math.round(jump) + 'ms';
              row.querySelector('div').insertAdjacentHTML('beforeend',
                `<div style="color:${col};font-size:9px;font-weight:700;">${label}</div>`);
              _wzTracerouteAnomalies.push({ type: 'rtt', hop: d.hop, color: col,
                msg: `Hop ${d.hop}: RTT-Sprung +${Math.round(jump)} ms (${prevRtt.toFixed(1)} → ${currRtt.toFixed(1)} ms)${jump >= 150 ? ' – möglicher Kontinentalwechsel' : ''}.` });
            }
          }

          // ── Anonyme Hop-Sequenz ──────────────────────────────────────────
          if (d.ip) {
            const allHops = _wzTracerouteHops;
            let anonCount = 0;
            for (let i = allHops.length - 2; i >= 0; i--) {
              if (!allHops[i].ip) anonCount++; else break;
            }
            if (anonCount >= 2) {
              const firstAnonHop = allHops[allHops.length - 1 - anonCount];
              const anonRow = list.querySelector(`[data-tr-hop="${firstAnonHop.hop}"]`);
              if (anonRow && !anonRow.dataset.anonFlagged) {
                anonRow.dataset.anonFlagged = '1';
                const col = anonCount >= 4 ? '#ef4444' : '#f59e0b';
                // RTT-Delta: Zeit und geografische Reichweite der anonymen Sequenz
                const hopBefore = allHops[allHops.length - 2 - anonCount];
                const rttBefore = hopBefore && parseFloat(hopBefore.rtt) > 0 ? parseFloat(hopBefore.rtt) : null;
                const rttAfter  = parseFloat(d.rtt) > 0 ? parseFloat(d.rtt) : null;
                let anonTimePart = '';
                let anonTimeMsg  = '';
                if (rttBefore != null && rttAfter != null && rttAfter > rttBefore) {
                  const delta = rttAfter - rttBefore;
                  const maxKm  = Math.round(delta / 2 * 200);
                  anonTimePart = ` (~${Math.round(delta)} ms, Reichweite ≤ ${maxKm.toLocaleString('de-DE')} km)`;
                  anonTimeMsg  = ` – verbrauchte RTT ~${Math.round(delta)} ms, max. Reichweite ~${maxKm.toLocaleString('de-DE')} km (Lichtgeschw. Glasfaser)`;
                } else if (rttBefore == null && rttAfter != null) {
                  const maxKm = Math.round(rttAfter / 2 * 200);
                  anonTimePart = ` (≤ ${maxKm.toLocaleString('de-DE')} km ab Quelle)`;
                  anonTimeMsg  = ` – max. Reichweite ab Quelle ~${maxKm.toLocaleString('de-DE')} km`;
                }
                const verdict = anonCount >= 4
                  ? '&#x1F6AB; ' + anonCount + ' anonyme Hops – geschlossenes Netz?' + anonTimePart
                  : '&#x26A0; ' + anonCount + ' anonyme Hops' + anonTimePart;
                anonRow.insertAdjacentHTML('afterend',
                  `<div style="padding:3px 10px 3px 32px;font-size:9px;font-weight:700;color:${col};background:color-mix(in srgb,${col} 8%,var(--surface));border-bottom:1px solid var(--border);">${verdict}</div>`);
                _wzTracerouteAnomalies.push({ type: 'anon', hop: firstAnonHop.hop, color: col,
                  msg: `Hops ${firstAnonHop.hop}–${d.hop - 1}: ${anonCount} anonyme Hops${anonCount >= 4 ? ' – mögliches geschlossenes/militärisches Netz' : ''}${anonTimeMsg}.` });
              }
            }
          }

          list.scrollTop = list.scrollHeight;
          _wzTracerouteSyncHeight();
        }

      } else if (d.type === 'done' || d.type === 'error') {
        es.close(); _wzTracerouteEvtSrc = null;
        const ok = d.type === 'done';
        if (btn) {
          btn.innerHTML = ok ? "&#x21BA; Traceroute wiederholen" : "&#x25B6; Traceroute (Fehler)";
          btn.disabled = false;
          btn.style.opacity = "";
          btn.style.cursor = "";
          if (!ok) { btn.style.background = "#ef4444"; btn.style.borderColor = "#ef4444"; }
          else { btn.style.background = "var(--accent3)"; btn.style.borderColor = ""; }
        }
        if (header) header.textContent = (header.textContent || '').replace('Traceroute →', ok ? 'Traceroute ✓' : 'Traceroute ✗');

        // Zusammenfassung sticky am unteren Ende des Panels
        if (ok) {
          const lastRtt = parseFloat((_wzTracerouteHops.filter(h => h.ip).pop() || {}).rtt || '');
          const summBox = document.getElementById("wz-trace-summary");
          if (summBox) {
            summBox.style.display = "block";
            summBox.innerHTML = `
              <div style="padding:8px 10px;background:var(--surface2);display:flex;gap:16px;flex-wrap:wrap;color:var(--muted);">
                <span>&#x2714; <strong style="color:var(--text);">${_wzTracerouteHops.filter(h=>h.ip).length}</strong> Hops</span>
                ${totalKm > 0 ? `<span>&#x1F30D; <strong style="color:#06b6d4;">~${_wzFmtKm(totalKm)}</strong></span>` : ''}
                ${!isNaN(lastRtt) ? `<span>&#x23F1; <strong style="color:#a78bfa;">${lastRtt.toFixed(1)} ms</strong> RTT</span>` : ''}
              </div>`;
          }
          if (list) list.scrollTop = list.scrollHeight;
          _wzTracerouteSyncHeight();
          _wzTraceroutePlausibility(lastRtt, totalKm);
          // Slow-Mo-Button einblenden (nur wenn Geo-Daten vorhanden)
          if (_wzTracerouteHops.filter(h => h.lat != null).length >= 2) {
            const smBtn = document.getElementById('wz-slowmo-btn');
            if (smBtn) smBtn.style.display = 'flex';
          }
          // Lauf in History speichern (localStorage)
          const _trEntry = {
            ts:           new Date().toISOString(),
            hops:         _wzTracerouteHops.length,
            hopsVisible:  _wzTracerouteHops.filter(h => h.ip).length,
            hopsAnon:     _wzTracerouteHops.filter(h => !h.ip).length,
            rttLast:      isNaN(lastRtt) ? null : Math.round(lastRtt * 10) / 10,
            totalKm:      Math.round(totalKm),
            anomRtt:      _wzTracerouteAnomalies.filter(a => a.type === 'rtt').length,
            anomUmweg:    _wzTracerouteAnomalies.filter(a => a.type === 'umweg').length,
            anomAnon:     _wzTracerouteAnomalies.filter(a => a.type === 'anon').length,
          };
          _wzTrHistSave(_wzTracerouteZoneId, _trEntry);
          _wzTrHistBtnUpdate(_wzTracerouteZoneId);
          // Ergebnis serverseitig speichern, dann Enrichment, dann Anomalien nachpatchen
          const _trZoneId = _wzTracerouteZoneId;
          const _trPayloadBase = {
            target:       d.target || '',
            hops:         _wzTracerouteHops,
            total_km:     Math.round(totalKm * 10) / 10,
            last_rtt:     isNaN(lastRtt) ? null : Math.round(lastRtt * 10) / 10,
            hops_count:   _wzTracerouteHops.length,
            hops_visible: _wzTracerouteHops.filter(h => h.ip).length,
            hops_anon:    _wzTracerouteHops.filter(h => !h.ip).length,
          };
          fetch(`/api/watchzones/${_trZoneId}/traceroute-result`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ..._trPayloadBase, anomalies: _wzTracerouteAnomalies })
          }).then(r => r.ok ? r.json() : null).then(saved => {
            // ── Forensische Anreicherung (WHOIS + BGP) im Hintergrund ──────────
            _wzEnrichHops(list).then(() => {
              // Nach Enrichment: Anomalien inkl. BGP-Befunde nachpatchen
              if (!saved) return;
              fetch(`/api/watchzones/${_trZoneId}/traceroute-result/${saved.id}`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ anomalies: _wzTracerouteAnomalies, hops: _wzTracerouteHops })
              }).catch(() => {});
            });
          }).catch(() => { _wzEnrichHops(list); });
        }
      }
    };
    es.onerror = () => {
      if (!_wzTracerouteEvtSrc) return; // done/error already handled – connection closed normally
      es.close(); _wzTracerouteEvtSrc = null;
      if (btn) { btn.innerHTML = "&#x25B6; Traceroute"; btn.disabled = false; btn.style.opacity = ""; btn.style.cursor = ""; btn.style.background = "var(--accent3)"; btn.style.borderColor = "var(--accent3)"; btn.style.color = "#fff"; }
    };
  };

  async function _wzTraceroutePlausibility(lastRtt, totalKm) {
    const summBox = document.getElementById("wz-trace-summary");
    if (!summBox) return;
    const zone = WZ._zones.find(z => z.id === _wzTracerouteZoneId);
    const server = (zone && zone.config && zone.config.server) || {};

    // Erste und letzte geolokalisierten Hops bestimmen
    const geoHops = _wzTracerouteHops.filter(h => h.lat != null && h.lng != null);
    if (geoHops.length < 1) return;
    const firstHop = geoHops[0];
    const lastHop  = geoHops[geoHops.length - 1];

    // Server-Koordinaten ermitteln (config oder frische Abfrage)
    let sLat = server.lat != null ? server.lat : null;
    let sLng = server.lng != null ? server.lng : null;
    let sCity = server.city || '', sCountry = server.country || '';

    if ((sLat == null) && server.ip) {
      try {
        const geo = await fetch(`https://ip-api.com/json/${server.ip}?fields=status,lat,lon,city,country`)
          .then(r => r.json());
        if (geo.status === 'success') {
          sLat = geo.lat; sLng = geo.lon;
          sCity = sCity || geo.city; sCountry = sCountry || geo.country;
        }
      } catch(_) {}
    }

    const sLabel = [sCity, sCountry].filter(Boolean).join(', ') || server.ip || '–';
    const aLabel = [lastHop.city, lastHop.country].filter(Boolean).join(', ') || lastHop.ip || '–';

    // Physikalische RTT-Erwartung (Lichtgeschwindigkeit in Glasfaser ≈ 200 000 km/s)
    let distToStated = null, rttMin = null, rttTyp = null;
    let distLastHopToServer = null;
    if (sLat != null) {
      distToStated = WZ._haversineKm(firstHop.lat, firstHop.lng, sLat, sLng);
      distLastHopToServer = WZ._haversineKm(lastHop.lat, lastHop.lng, sLat, sLng);
      rttMin = Math.round(2 * distToStated / 200);   // ms – physikalisches Minimum
      rttTyp = Math.round(rttMin * 1.5 + 10);        // ms – typisch mit Overhead
    }

    // Bewertung
    let color, icon, verdict;
    const hasRtt = !isNaN(lastRtt) && lastRtt > 0;

    // Primärer Check: Ist der letzte Hop weit vom behaupteten Serverstandort entfernt?
    if (distLastHopToServer != null && distLastHopToServer > 3000) {
      color = '#f59e0b'; icon = '⚠';
      verdict = `Letzter Traceroute-Hop in <strong>${aLabel}</strong> (ca. ${Math.round(distLastHopToServer).toLocaleString('de-DE')} km vom GeoIP-Standort ${sLabel} entfernt). Der Datenverkehr endet in einer anderen Region – <strong>CDN/Anycast wahrscheinlich.</strong>${hasRtt ? ` RTT: ${lastRtt.toFixed(1)} ms.` : ''}`;
    } else if (distToStated != null && hasRtt) {
      if (lastRtt < rttMin * 0.55 && distToStated > 2000) {
        color = '#f59e0b'; icon = '⚠';
        verdict = `Gemessene RTT (${lastRtt.toFixed(1)} ms) ist <strong>physikalisch nicht erreichbar</strong> für ${Math.round(distToStated).toLocaleString('de-DE')} km – Minimum wäre ${rttMin} ms. <strong>CDN/Anycast wahrscheinlich.</strong>`;
      } else if (lastRtt < rttMin * 0.85 && distToStated > 1000) {
        color = '#f59e0b'; icon = '⚠';
        verdict = `RTT (${lastRtt.toFixed(1)} ms) liegt unter dem physikalischen Minimum für ${Math.round(distToStated).toLocaleString('de-DE')} km (Minimum ${rttMin} ms, typisch ${rttMin}–${rttTyp} ms). <strong>CDN/Anycast möglich.</strong>`;
      } else {
        color = '#22c55e'; icon = '✓';
        verdict = `RTT (${lastRtt.toFixed(1)} ms) ist <strong>plausibel</strong> für ${Math.round(distToStated).toLocaleString('de-DE')} km (erwartet ${rttMin}–${rttTyp} ms). Letzter Hop: ${aLabel}.`;
      }
    } else if (sCountry && lastHop.country && sCountry.toLowerCase() !== lastHop.country.toLowerCase()) {
      color = '#f59e0b'; icon = '⚠';
      verdict = `Letzter Traceroute-Hop in <strong>${aLabel}</strong>, GeoIP-Eintrag zeigt <strong>${sLabel}</strong>. Abweichende Länder – möglicher CDN/Anycast-Einsatz.`;
    } else if (sLabel !== '–') {
      color = '#22c55e'; icon = '✓';
      verdict = `Traceroute-Endpunkt (${aLabel}) stimmt mit Serverstandort (${sLabel}) überein.`;
    } else return;

    // Plausibilität in den Karten-Overlay (unterhalb Server-Standort)
    const infoEl = document.getElementById('wz-map-info');
    if (infoEl) {
      infoEl.style.display = 'block';
      const old = infoEl.querySelector('#wz-map-plaus');
      if (old) old.remove();
      const plausDiv = document.createElement('div');
      plausDiv.id = 'wz-map-plaus';
      plausDiv.style.cssText = `margin-top:6px;background:color-mix(in srgb,${color} 10%,var(--surface));border:1px solid ${color};border-radius:8px;padding:10px 12px;font-size:11px;line-height:1.6;box-shadow:0 2px 6px rgba(0,0,0,.25);`;
      const asns = [...new Set(_wzTracerouteHops.filter(h => h.asn).map(h => h.asn))];
      plausDiv.innerHTML = `
        <div style="font-weight:700;color:${color};margin-bottom:5px;">${icon} Plausibilitätsprüfung</div>
        <table style="width:100%;border-collapse:collapse;margin-bottom:6px;color:var(--muted);">
          <tr><td style="padding:1px 0;white-space:nowrap;">GeoIP-Standort&nbsp;</td>
              <td style="color:var(--text);font-weight:600;">${WZ._esc(sLabel)}</td></tr>
          <tr><td style="padding:1px 0;">Letzter Hop&nbsp;</td>
              <td style="color:var(--text);font-weight:600;">${WZ._esc(aLabel)}</td></tr>
          ${distLastHopToServer != null ? `
          <tr><td style="padding:1px 0;white-space:nowrap;">Hop → GeoIP&nbsp;</td>
              <td style="color:${distLastHopToServer > 3000 ? '#f59e0b' : '#06b6d4'};font-weight:600;">~${Math.round(distLastHopToServer).toLocaleString('de-DE')} km</td></tr>` : ''}
          ${distToStated != null ? `
          <tr><td style="padding:1px 0;">Distanz (gesamt)&nbsp;</td>
              <td style="color:#06b6d4;font-weight:600;">~${Math.round(distToStated).toLocaleString('de-DE')} km</td></tr>
          <tr><td style="padding:1px 0;">RTT-Erwartung&nbsp;</td>
              <td style="color:var(--muted);">${rttMin}–${rttTyp} ms</td></tr>` : ''}
          ${hasRtt ? `
          <tr><td style="padding:1px 0;">Gemessene RTT&nbsp;</td>
              <td style="color:#a78bfa;font-weight:600;">${lastRtt.toFixed(1)} ms</td></tr>` : ''}
        </table>
        ${asns.length ? `<div style="color:var(--muted);font-size:10px;margin-bottom:6px;line-height:1.6;"><span style="color:var(--text);font-weight:600;">ASNs:</span><br>${asns.map(a => WZ._esc(a)).join('<br>')}</div>` : ''}
        <div style="color:${color};line-height:1.5;">${verdict}</div>
        ${_wzTracerouteAnomalies.length ? `<div style="margin-top:8px;border-top:1px solid var(--border);padding-top:6px;">
          <div style="font-weight:700;font-size:10px;color:var(--muted);margin-bottom:4px;">Erkannte Anomalien</div>
          ${_wzTracerouteAnomalies.map(a => `<div style="color:${a.color};font-size:10px;line-height:1.5;margin-bottom:3px;">⚠ ${WZ._esc(a.msg)}</div>`).join('')}
        </div>` : ''}`;
      infoEl.appendChild(plausDiv);
    }
    _wzTracerouteSyncHeight();
  }

  // ── Traceroute History (localStorage) ────────────────────────────────────────
  const _TR_HIST_MAX = 100;
  function _wzTrHistKey(zoneId) { return `wz_tr_hist_${zoneId}`; }
  function _wzTrHistLoad(zoneId) {
    try { return JSON.parse(localStorage.getItem(_wzTrHistKey(zoneId)) || '[]'); } catch { return []; }
  }
  function _wzTrHistSave(zoneId, entry) {
    const h = _wzTrHistLoad(zoneId);
    h.push(entry);
    if (h.length > _TR_HIST_MAX) h.splice(0, h.length - _TR_HIST_MAX);
    localStorage.setItem(_wzTrHistKey(zoneId), JSON.stringify(h));
  }
  function _wzTrHistBtnUpdate(zoneId) {
    const btn = document.getElementById('wz-hist-btn');
    if (!btn) return;
    const h = _wzTrHistLoad(zoneId);
    btn.style.display = h.length > 0 ? 'inline-flex' : 'none';
  }

  // ── Forensische Hop-Anreicherung (WHOIS + BGP) ───────────────────────────
  async function _wzEnrichHops(list) {
    if (!list) return;
    _wzHopEnrichment = {};  // Reset für diesen Lauf
    const uniqueIps = [...new Set(_wzTracerouteHops.filter(h => h.ip).map(h => h.ip))];

    // Ziel-IP für BGP-Hijack-Check (letzter Hop mit IP)
    const destHop = [..._wzTracerouteHops].reverse().find(h => h.ip);
    const destAsnNum = destHop ? parseInt((destHop.asn || '').replace(/^AS/i,'')) : null;

    for (const ip of uniqueIps) {
      try {
        const data = await fetch(`/api/ip/forensics?ip=${encodeURIComponent(ip)}`).then(r => r.json());
        // In globalem Dict speichern (für HUD)
        _wzHopEnrichment[ip] = { whois: data.whois || {}, bgp: data.bgp || {} };
        const rows = list.querySelectorAll(`[data-tr-ip="${ip}"]`);
        rows.forEach(row => {
          const info = row.querySelector('div'); // zweite Spalte
          if (!info) return;

          // WHOIS: Org + Registrierungsland
          if (data.whois && (data.whois.org || data.whois.netname)) {
            const el = document.createElement('div');
            el.style.cssText = 'color:var(--muted);font-size:9px;margin-top:1px;';
            const org = WZ._esc(data.whois.org || data.whois.netname || '');
            const cc  = data.whois.country ? ` [${WZ._esc(data.whois.country)}]` : '';
            el.innerHTML = `&#x1F3E2; ${org}${cc}`;
            info.appendChild(el);
          }

          // Abuse-Kontakt
          if (data.whois && data.whois.abuse) {
            const el = document.createElement('div');
            el.style.cssText = 'color:var(--muted);font-size:9px;';
            el.innerHTML = `&#x2709; <a href="mailto:${WZ._esc(data.whois.abuse)}" style="color:inherit;">${WZ._esc(data.whois.abuse)}</a>`;
            info.appendChild(el);
          }

          // BGP Prefix
          if (data.bgp && data.bgp.prefix) {
            const el = document.createElement('div');
            el.style.cssText = 'color:var(--muted);font-size:9px;font-family:monospace;';
            el.textContent = data.bgp.prefix + (data.bgp.announced ? '' : ' ⚠ nicht annonciert');
            info.appendChild(el);
          }

          // BGP Holder (falls abweichend vom ip-api ASN)
          const bgpAsns = data.bgp && data.bgp.asns || [];
          const hop     = _wzTracerouteHops.find(h => h.ip === ip);
          const trAsnNum = hop ? parseInt((hop.asn || '').replace(/^AS/i,'')) : null;
          if (bgpAsns.length > 0 && trAsnNum && bgpAsns[0].asn !== trAsnNum) {
            // BGP-Routing weicht vom beobachteten ASN ab
            const el = document.createElement('div');
            el.style.cssText = 'color:#f59e0b;font-size:9px;font-weight:700;margin-top:2px;';
            el.textContent = `⚠ BGP-AS${bgpAsns[0].asn} (${bgpAsns[0].holder || ''}) ≠ beobachtet AS${trAsnNum}`;
            info.appendChild(el);
            // Als Anomalie eintragen (nur einmal)
            if (!_wzTracerouteAnomalies.find(a => a.type==='bgp' && a.hop===hop.hop)) {
              _wzTracerouteAnomalies.push({
                type: 'bgp', hop: hop.hop, color: '#f59e0b',
                msg: `Hop ${hop.hop} (${ip}): BGP-Routing-Anomalie – BGP-Origin AS${bgpAsns[0].asn} (${bgpAsns[0].holder || '?'}) weicht vom beobachteten AS${trAsnNum} ab. Mögliches BGP-Hijacking oder Anycast.`
              });
              // Plausibilitätspanel neu rendern mit aktualisierten Anomalien
              const infoEl = document.getElementById('wz-map-info');
              const lastRttHop = [..._wzTracerouteHops].reverse().find(h => h.ip && parseFloat(h.rtt) > 0);
              if (infoEl && lastRttHop) _wzTraceroutePlausibility(parseFloat(lastRttHop.rtt), 0);
            }
          }
        });
      } catch(e) { /* RIPE Stat nicht erreichbar, still fail */ }
    }
  }

  window.wzOpenHistModal = function() {
    const zoneId = _wzTracerouteZoneId;
    const hist = _wzTrHistLoad(zoneId);
    const modal = document.getElementById('wz-hist-modal');
    const countEl = document.getElementById('wz-hist-count');
    if (countEl) countEl.textContent = `${hist.length} Durchlauf${hist.length !== 1 ? 'e' : ''}`;
    if (modal) modal.style.display = 'flex';
    // Reset state when zone changes
    const wrap = document.getElementById('wz-parcoords-wrap');
    if (wrap && wrap._pcS && wrap._pcS.zoneId !== zoneId) {
      if (wrap._pcCleanup) { wrap._pcCleanup(); wrap._pcCleanup = null; }
      wrap._pcS = null;
    }
    _wzRenderParcoords(hist, zoneId);
  };

  window.wzCloseHistModal = function() {
    var _fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (_fsEl && _fsEl.id === 'wz-hist-modal') {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    }
    const modal = document.getElementById('wz-hist-modal');
    if (modal) modal.style.display = 'none';
    const tt = document.getElementById('wz-hist-tooltip');
    if (tt) tt.style.display = 'none';
    const wrap = document.getElementById('wz-parcoords-wrap');
    if (wrap && wrap._pcCleanup) { wrap._pcCleanup(); wrap._pcCleanup = null; }
  };

  function _wzRenderParcoords(hist, zoneId) {
    const wrap = document.getElementById('wz-parcoords-wrap');
    if (!wrap) return;
    if (hist.length === 0) {
      wrap.innerHTML = '<div style="color:var(--muted);text-align:center;padding:60px 0;">Noch keine gespeicherten Daten vorhanden.</div>';
      return;
    }

    // ── Axis definitions ─────────────────────────────────────────────────────
    const AXES_DEF = [
      { key:'ts',          label:['Zeit'],             num: v => new Date(v).getTime(), fmtTick: v => window.fmtDateOnly ? window.fmtDateOnly(new Date(v).toISOString()) : new Date(v).toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'}) },
      { key:'hops',        label:['Hops','gesamt'],    num: v => v??0, fmtTick: v => String(v) },
      { key:'hopsVisible', label:['Hops','sichtbar'],  num: v => v??0, fmtTick: v => String(v) },
      { key:'hopsAnon',    label:['Anonyme','Hops'],   num: v => v??0, fmtTick: v => String(v) },
      { key:'rttLast',     label:['RTT','(ms)'],       num: v => v??0, fmtTick: v => Math.round(v)+' ms' },
      { key:'totalKm',     label:['Distanz','(km)'],   num: v => v??0, fmtTick: v => Math.round(v).toLocaleString('de-DE') },
      { key:'anomRtt',     label:['RTT-','Sprünge'],   num: v => v??0, fmtTick: v => String(v) },
      { key:'anomUmweg',   label:['Geo-','Umwege'],    num: v => v??0, fmtTick: v => String(v) },
      { key:'anomAnon',    label:['Anon-','Seq.'],     num: v => v??0, fmtTick: v => String(v) },
    ];

    // ── Layout ───────────────────────────────────────────────────────────────
    const W  = Math.max(wrap.clientWidth || 900, 700);
    const H  = 440, MT = 64, MB = 44, ML = 30, MR = 30;
    const plotW = W - ML - MR, plotH = H - MT - MB;

    // ── Persistent state (survives re-renders within same session) ───────────
    if (!wrap._pcS || wrap._pcS.zoneId !== zoneId || !wrap._pcS.axes)
      wrap._pcS = { zoneId, axes: AXES_DEF.slice(), brushes: {} };
    const S = wrap._pcS;

    // ── Helpers ───────────────────────────────────────────────────────────────
    const N   = S.axes.length;
    const axX = i => N <= 1 ? ML + plotW/2 : ML + (i/(N-1)) * plotW;

    // Domain per key (computed from AXES_DEF so it doesn't change during reorder)
    const dom = {};
    AXES_DEF.forEach(ax => {
      const vals = hist.map(r => ax.num(r[ax.key] ?? 0));
      dom[ax.key] = { min: Math.min(...vals), max: Math.max(...vals) };
    });

    const toY = (val, key) => {
      const {min, max} = dom[key];
      return max === min ? MT+plotH/2 : MT + plotH - ((val-min)/(max-min)) * plotH;
    };
    const clampY  = y => Math.max(MT, Math.min(MT+plotH, y));
    const linePts = run => S.axes.map((ax,i) =>
      `${axX(i).toFixed(1)},${toY(ax.num(run[ax.key]??0), ax.key).toFixed(1)}`).join(' ');
    const lineColor = (idx, total) => {
      const t = total<=1 ? 1 : idx/(total-1);
      return `rgba(${Math.round(100+t*24)},${Math.round(100-t*42)},${Math.round(110+t*127)},${(0.3+0.7*t).toFixed(2)})`;
    };

    // ── SVG builder ───────────────────────────────────────────────────────────
    function buildSVG() {
      let s = `<svg id="wz-pc-svg" width="${W}" height="${H}" style="display:block;user-select:none;">`;

      // Horizontal grid
      for (let g=0; g<=4; g++) {
        const gy = (MT + g/4*plotH).toFixed(1);
        s += `<line x1="${ML}" y1="${gy}" x2="${ML+plotW}" y2="${gy}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>`;
      }

      // Polylines (oldest → newest, newest on top)
      hist.forEach((run, ri) => {
        const sw = ri === hist.length-1 ? '2.5' : '1.2';
        s += `<polyline data-ri="${ri}" class="wz-pc-line" points="${linePts(run)}" fill="none" stroke="${lineColor(ri,hist.length)}" stroke-width="${sw}" stroke-linejoin="round" style="cursor:pointer;transition:opacity .08s;"/>`;
      });

      // Axes
      S.axes.forEach((ax, i) => {
        const x   = axX(i).toFixed(1);
        const xn  = parseFloat(x);
        const hasBr = !!S.brushes[ax.key];

        // Axis line
        s += `<line x1="${x}" y1="${MT}" x2="${x}" y2="${MT+plotH}" stroke="${hasBr?'var(--accent3)':'rgba(255,255,255,0.2)'}" stroke-width="${hasBr?'2':'1.5'}"/>`;
        s += `<line x1="${xn-3}" y1="${MT}" x2="${xn+3}" y2="${MT}" stroke="rgba(255,255,255,0.25)" stroke-width="1"/>`;
        s += `<line x1="${xn-3}" y1="${MT+plotH}" x2="${xn+3}" y2="${MT+plotH}" stroke="rgba(255,255,255,0.25)" stroke-width="1"/>`;

        // Min/max tick labels
        const {min,max} = dom[ax.key];
        s += `<text x="${x}" y="${MT+plotH+14}" text-anchor="middle" fill="rgba(255,255,255,0.3)" font-size="9" font-family="sans-serif">${ax.fmtTick(min)}</text>`;
        if (max !== min)
          s += `<text x="${x}" y="${MT-3}" text-anchor="middle" fill="rgba(255,255,255,0.3)" font-size="9" font-family="sans-serif">${ax.fmtTick(max)}</text>`;

        // Brush rect + range labels
        const br = S.brushes[ax.key];
        if (br) {
          const by0 = Math.min(br.y0,br.y1), by1 = Math.max(br.y0,br.y1);
          s += `<rect id="wz-brush-${ax.key}" x="${xn-8}" y="${by0.toFixed(1)}" width="16" height="${(by1-by0).toFixed(1)}" fill="rgba(124,58,237,0.28)" stroke="var(--accent3)" stroke-width="1.5" rx="2" pointer-events="none"/>`;
          const vTop = min + (1-(by0-MT)/plotH)*(max-min);
          const vBot = min + (1-(by1-MT)/plotH)*(max-min);
          const lx = xn < W-60 ? xn+11 : xn-11;
          const ta = xn < W-60 ? 'start' : 'end';
          s += `<text x="${lx}" y="${by0+4}" text-anchor="${ta}" fill="#a78bfa" font-size="9" font-family="sans-serif">${ax.fmtTick(vTop)}</text>`;
          s += `<text x="${lx}" y="${by1+4}" text-anchor="${ta}" fill="#a78bfa" font-size="9" font-family="sans-serif">${ax.fmtTick(vBot)}</text>`;
        }

        // Label (drag handle visual)
        const lc = hasBr ? '#a78bfa' : 'rgba(255,255,255,0.75)';
        s += `<text x="${x}" y="${MT-40}" text-anchor="middle" fill="${lc}" font-size="10" font-weight="600" font-family="sans-serif" pointer-events="none">`;
        ax.label.forEach((ln,li) => s += `<tspan x="${x}" dy="${li===0?0:13}">${ln}</tspan>`);
        s += `</text>`;
        // Drag indicator
        s += `<text x="${x}" y="${MT-6}" text-anchor="middle" fill="rgba(255,255,255,0.22)" font-size="11" pointer-events="none">⠿</text>`;
      });

      // Interaction targets (on top, transparent)
      const zoneW = N > 1 ? Math.min(Math.max(28, plotW/(N-1)*0.65), 80) : 80;
      S.axes.forEach((ax, i) => {
        const x = axX(i);
        // Drag handle above plot
        s += `<rect class="wz-ax-drag" data-ai="${i}" x="${(x-zoneW/2).toFixed(1)}" y="${MT-64}" width="${zoneW.toFixed(1)}" height="58" fill="transparent" style="cursor:grab;"/>`;
        // Brush zone within plot
        s += `<rect class="wz-ax-brush" data-ai="${i}" x="${(x-12).toFixed(1)}" y="${MT}" width="24" height="${plotH}" fill="transparent" style="cursor:crosshair;"/>`;
      });

      s += '</svg>';
      return s;
    }

    // ── Apply brush filter ────────────────────────────────────────────────────
    function applyFilter() {
      const svg = wrap.querySelector('#wz-pc-svg');
      if (!svg) return;
      const hasBr = Object.keys(S.brushes).length > 0;
      svg.querySelectorAll('.wz-pc-line').forEach(line => {
        if (!hasBr) { line.style.opacity = '1'; return; }
        const run  = hist[parseInt(line.dataset.ri)];
        const pass = !Object.entries(S.brushes).some(([key, br]) => {
          const ax = S.axes.find(a => a.key === key);
          if (!ax) return false;
          const sy   = toY(ax.num(run[key]??0), key);
          const yMin = Math.min(br.y0, br.y1), yMax = Math.max(br.y0, br.y1);
          return sy < yMin || sy > yMax;
        });
        line.style.opacity = pass ? '1' : '0.04';
        if (!pass) line.setAttribute('stroke-width', '0.5');
      });
      // Update filter count hint
      const countEl = document.getElementById('wz-hist-count');
      if (countEl) {
        const active = hist.filter((run, ri) => {
          const line = wrap.querySelector(`.wz-pc-line[data-ri="${ri}"]`);
          return !line || line.style.opacity !== '0.04';
        });
        const total = hist.length;
        countEl.textContent = hasBr
          ? `${active.length} von ${total} Durchläufen`
          : `${total} Durchlauf${total!==1?'e':''}`;
      }
    }

    // ── Gap index for drag-drop ───────────────────────────────────────────────
    function gapIdxAt(x) {
      for (let i = 0; i < N; i++) {
        if (x < axX(i) + (i < N-1 ? (axX(i+1)-axX(i))/2 : 20)) return i;
      }
      return N;
    }
    function gapX(gIdx) {
      if (gIdx <= 0)  return axX(0) - 22;
      if (gIdx >= N)  return axX(N-1) + 22;
      return (axX(gIdx-1) + axX(gIdx)) / 2;
    }

    // ── Full render ───────────────────────────────────────────────────────────
    function render() {
      if (wrap._pcCleanup) { wrap._pcCleanup(); wrap._pcCleanup = null; }
      wrap.innerHTML = buildSVG();
      applyFilter();
      attachEvents();
    }

    // ── Events ────────────────────────────────────────────────────────────────
    function attachEvents() {
      const svg     = wrap.querySelector('#wz-pc-svg');
      if (!svg) return;
      const tooltip = document.getElementById('wz-hist-tooltip');
      let drag  = null;  // { ai, x0, svgLeft, ghost, dropMark, targetGap }
      let brush = null;  // { ai, key, y0, svgTop, rect }

      // ── Tooltip on polyline hover ─────────────────────────────────────────
      svg.querySelectorAll('.wz-pc-line').forEach(line => {
        line.addEventListener('mouseenter', ev => {
          if (drag || brush) return;
          const run = hist[parseInt(line.dataset.ri)];
          svg.querySelectorAll('.wz-pc-line').forEach(l => l.style.opacity = '0.08');
          line.style.opacity = '1'; line.setAttribute('stroke-width','3');
          if (!tooltip) return;
          const d  = new Date(run.ts);
          tooltip.style.display = 'block';
          tooltip.innerHTML = `
            <div style="font-weight:700;color:var(--text);margin-bottom:5px;">${window.fmtDate ? window.fmtDate(run.ts) : d.toLocaleString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}</div>
            <div>Hops: <b>${run.hops}</b> (${run.hopsVisible} sichtbar / ${run.hopsAnon} anonym)</div>
            ${run.rttLast!=null?`<div>RTT: <b>${run.rttLast} ms</b></div>`:''}
            ${run.totalKm?`<div>Distanz: <b>${run.totalKm.toLocaleString('de-DE')} km</b></div>`:''}
            <div style="margin-top:4px;color:var(--muted);font-size:10px;">Anomalien: RTT-Spr. ${run.anomRtt} · Umwege ${run.anomUmweg} · Anon-Seq. ${run.anomAnon}</div>`;
          tooltip.style.left = (ev.clientX+14)+'px'; tooltip.style.top = (ev.clientY-10)+'px';
        });
        line.addEventListener('mousemove', ev => {
          if (tooltip && tooltip.style.display!=='none') {
            tooltip.style.left=(ev.clientX+14)+'px'; tooltip.style.top=(ev.clientY-10)+'px';
          }
        });
        line.addEventListener('mouseleave', () => {
          if (drag||brush) return;
          applyFilter();
          if (tooltip) tooltip.style.display = 'none';
        });
      });

      // ── Axis drag ─────────────────────────────────────────────────────────
      svg.querySelectorAll('.wz-ax-drag').forEach(h => {
        h.addEventListener('mousedown', ev => {
          ev.preventDefault();
          const ai = parseInt(h.dataset.ai);
          const ns = 'http://www.w3.org/2000/svg';
          // Ghost: dashed purple line following mouse
          const ghost = document.createElementNS(ns,'line');
          Object.entries({y1:MT-10, y2:MT+plotH, stroke:'var(--accent3)', 'stroke-width':'2',
            'stroke-dasharray':'5,3', opacity:'0.85', 'pointer-events':'none'}).forEach(([k,v])=>ghost.setAttribute(k,v));
          const gx = axX(ai).toFixed(1); ghost.setAttribute('x1',gx); ghost.setAttribute('x2',gx);
          svg.appendChild(ghost);
          // Drop target indicator
          const dropMark = document.createElementNS(ns,'line');
          Object.entries({y1:MT-10, y2:MT+plotH, stroke:'var(--accent3)', 'stroke-width':'3',
            opacity:'0.4', 'pointer-events':'none'}).forEach(([k,v])=>dropMark.setAttribute(k,v));
          const dm = axX(ai).toFixed(1); dropMark.setAttribute('x1',dm); dropMark.setAttribute('x2',dm);
          svg.appendChild(dropMark);
          drag = { ai, x0: ev.clientX, svgLeft: svg.getBoundingClientRect().left, ghost, dropMark, targetGap: ai };
          h.style.cursor = 'grabbing';
        });
      });

      // ── Brush zone ────────────────────────────────────────────────────────
      svg.querySelectorAll('.wz-ax-brush').forEach(bz => {
        bz.addEventListener('mousedown', ev => {
          if (drag) return;
          ev.preventDefault();
          const ai  = parseInt(bz.dataset.ai);
          const ax  = S.axes[ai];
          const svgT = svg.getBoundingClientRect().top;
          const y0  = clampY(ev.clientY - svgT);
          // Create brush rect element
          const rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
          rect.setAttribute('id',`wz-brush-${ax.key}`);
          rect.setAttribute('fill','rgba(124,58,237,0.28)');
          rect.setAttribute('stroke','var(--accent3)'); rect.setAttribute('stroke-width','1.5');
          rect.setAttribute('rx','2'); rect.setAttribute('pointer-events','none');
          rect.setAttribute('x',(axX(ai)-8).toFixed(1)); rect.setAttribute('width','16');
          rect.setAttribute('y',y0.toFixed(1)); rect.setAttribute('height','0');
          // Remove existing brush rect for this key if any
          const old = svg.querySelector(`#wz-brush-${ax.key}`);
          if (old) old.remove();
          svg.appendChild(rect);
          brush = { ai, key: ax.key, y0, svgTop: svgT, rect };
        });
      });

      // ── Document-level move + up ──────────────────────────────────────────
      const onMove = ev => {
        if (drag) {
          const relX   = ev.clientX - drag.svgLeft;
          drag.ghost.setAttribute('x1', relX.toFixed(1));
          drag.ghost.setAttribute('x2', relX.toFixed(1));
          const gi = gapIdxAt(relX);
          drag.targetGap = gi;
          const dx = gapX(gi).toFixed(1);
          drag.dropMark.setAttribute('x1', dx);
          drag.dropMark.setAttribute('x2', dx);
        }
        if (brush) {
          const y1  = clampY(ev.clientY - brush.svgTop);
          const by0 = Math.min(brush.y0, y1), by1 = Math.max(brush.y0, y1);
          brush.rect.setAttribute('y',  by0.toFixed(1));
          brush.rect.setAttribute('height', (by1-by0).toFixed(1));
          S.brushes[brush.key] = { y0: brush.y0, y1 };
          applyFilter();
        }
      };

      const onUp = ev => {
        if (drag) {
          const dx = ev.clientX - drag.x0;
          if (Math.abs(dx) > 8) {
            const moved   = S.axes.splice(drag.ai, 1)[0];
            let   insertAt = drag.targetGap;
            if (insertAt > drag.ai) insertAt--;
            insertAt = Math.max(0, Math.min(insertAt, S.axes.length));
            S.axes.splice(insertAt, 0, moved);
          }
          drag = null;
          render();
          return;
        }
        if (brush) {
          const finalY1 = S.brushes[brush.key]?.y1 ?? brush.y0;
          if (Math.abs(finalY1 - brush.y0) < 5) delete S.brushes[brush.key];
          brush = null;
          render();
        }
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
      wrap._pcCleanup = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);
        if (tooltip) tooltip.style.display = 'none';
      };
    }

    render();
  }

  window.wzCloseLive = function(zoneId) {
    // Wenn eine spezifische zoneId angegeben, diesen Context schließen
    if (zoneId && WZ._activePopups.has(zoneId)) {
      WZ._activePopups.get(zoneId).close();
      return;
    }
    // Sonst: aktuellen Context schließen
    if (WZ._currentCtx) {
      WZ._currentCtx.close();
      return;
    }
    // Fallback: Legacy-Cleanup falls kein Context existiert (custom_overlay etc.)
    var _fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (_fsEl) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    }
    if (typeof _wzTracerouteStop === "function") _wzTracerouteStop();
    WZ._onLiveClose.forEach(function(fn) { try { fn(); } catch(e) {} });
    WZ._onLiveClose = [];
    if (typeof _wsReturnToStore === "function") _wsReturnToStore();
    if (WZ._liveMap) { WZ._liveMap.remove(); WZ._liveMap = null; }
    WZ._liveZoneId = null;
  };


  function _initLiveMap(zone) {
    const el = document.getElementById("wz-live-map");
    if (WZ._liveMap) { WZ._liveMap.remove(); WZ._liveMap = null; }
    WZ._liveZoneTimeLabel = null;

    var isDark = document.documentElement.getAttribute("data-theme") !== "light";
    var _savedStyle = isDark ? "dark" : "light";
    var _liveTileUrl = _tileUrl(_savedStyle);

    WZ._liveMap = L.map(el, { zoomControl: false }).setView([48.2, 11.8], 5);
    L.control.zoom({ position: 'topright' }).addTo(WZ._liveMap);
    var _liveTileLayer = L.tileLayer(_liveTileUrl, { maxZoom: 18 }).addTo(WZ._liveMap);
    L.control.scale({ metric: true, imperial: false, position: 'topright' }).addTo(WZ._liveMap);

    // Map style selector on live map
    var _liveStyleCtrl = L.Control.extend({
      onAdd: function() {
        var d = L.DomUtil.create("div");
        d.style.cssText = "background:rgba(40,40,50,.85);border-radius:6px;padding:2px;display:flex;gap:1px;";
        L.DomEvent.disableClickPropagation(d);
        Object.keys(_MAP_STYLES).forEach(function(sid) {
          var b = L.DomUtil.create("button", "", d);
          b.textContent = _MAP_STYLES[sid].label;
          b.style.cssText = "background:none;border:none;color:rgba(255,255,255,.5);padding:3px 7px;font-size:9px;cursor:pointer;border-radius:4px;font-weight:600;";
          if (sid === _savedStyle) b.style.background = "rgba(255,255,255,.12)";
          b.onclick = function() {
            _liveTileLayer.setUrl(_tileUrl(sid));
            d.querySelectorAll("button").forEach(function(x) { x.style.background = "none"; });
            b.style.background = "rgba(255,255,255,.12)";
          };
        });
        return d;
      }
    });
    new _liveStyleCtrl({ position: "bottomleft" }).addTo(WZ._liveMap);

    // Address search on live map
    var _liveSearchCtrl = L.Control.extend({
      onAdd: function() {
        var d = L.DomUtil.create("div");
        d.style.cssText = "display:flex;gap:0;";
        L.DomEvent.disableClickPropagation(d);
        var inp = L.DomUtil.create("input", "", d);
        inp.type = "text";
        inp.placeholder = t("wz_search_placeholder", "Adresse / Ort suchen\u2026");
        inp.style.cssText = "width:180px;padding:4px 8px;border:1px solid rgba(255,255,255,.15);border-right:none;" +
          "border-radius:6px 0 0 6px;font-size:11px;background:rgba(40,40,50,.85);color:#e2e8f0;outline:none;";
        var btn = L.DomUtil.create("button", "", d);
        btn.textContent = "\u2315";
        btn.style.cssText = "padding:4px 8px;border:1px solid rgba(255,255,255,.15);border-radius:0 6px 6px 0;" +
          "background:var(--accent3);color:#fff;cursor:pointer;font-size:13px;font-weight:700;";
        var _sm = null;
        var doS = function() {
          var q = inp.value.trim();
          if (!q) return;
          btn.textContent = "\u2026";
          fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(q))
            .then(function(r) { return r.json(); })
            .then(function(data) {
              btn.textContent = "\u2315";
              if (!data || !data.length) { inp.style.borderColor = "#ef4444"; return; }
              inp.style.borderColor = "rgba(255,255,255,.15)";
              var lat = parseFloat(data[0].lat), lon = parseFloat(data[0].lon);
              WZ._liveMap.setView([lat, lon], 13);
              if (_sm) WZ._liveMap.removeLayer(_sm);
              _sm = L.marker([lat, lon]).addTo(WZ._liveMap)
                .bindPopup('<b>' + (data[0].display_name || q) + '</b>').openPopup();
            })
            .catch(function() { btn.textContent = "\u2315"; });
        };
        btn.onclick = doS;
        inp.addEventListener("keydown", function(e) { if (e.key === "Enter") doS(); });
        return d;
      }
    });
    new _liveSearchCtrl({ position: "topleft" }).addTo(WZ._liveMap);

    // Info-Overlay oben links (Server-Standort + Plausibilität)
    const _infoCtrl = L.Control.extend({
      onAdd() {
        const d = L.DomUtil.create('div');
        d.id = 'wz-map-info';
        d.style.cssText = 'display:none;max-width:210px;pointer-events:none;';
        return d;
      }
    });
    new _infoCtrl({ position: 'topleft' }).addTo(WZ._liveMap);

    // Slow-Mo-Button oben mittig direkt in den Map-Container
    (function() {
      const mapEl = document.getElementById('wz-live-map');
      if (!mapEl) return;
      const btn = document.createElement('button');
      btn.id = 'wz-slowmo-btn';
      btn.onclick = wzToggleSlowMo;
      btn.style.cssText = `
        display:none;position:absolute;top:12px;left:50%;transform:translateX(-50%);
        z-index:1000;background:var(--accent3);border:none;border-radius:999px;color:#fff;
        padding:0 16px 0 10px;height:38px;gap:8px;
        cursor:pointer;align-items:center;justify-content:center;
        backdrop-filter:blur(6px);box-shadow:0 2px 14px rgba(124,58,237,.55);
        transition:background .15s;white-space:nowrap;font-size:12px;font-weight:700;letter-spacing:.3px;`;
      btn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 18 18" fill="white" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0">
          <polygon points="4,2 16,9 4,16"/>
        </svg>
        <span>×1000</span>`;
      mapEl.appendChild(btn);
      btn.addEventListener('mousedown', e => e.stopPropagation());
      btn.addEventListener('dblclick',  e => e.stopPropagation());

      // 3D-Toggle-Button (unten rechts auf der Karte)
      const btn3d = document.createElement('button');
      btn3d.id = 'wz-3d-btn';
      btn3d.onclick = wzToggle3D;
      btn3d.style.cssText = `
        display:none;position:absolute;bottom:12px;right:10px;z-index:1001;
        background:rgba(15,23,42,.85);border:1px solid rgba(255,255,255,.2);border-radius:8px;
        color:#e2e8f0;padding:5px 12px;font-size:11px;font-weight:700;letter-spacing:.5px;
        cursor:pointer;backdrop-filter:blur(6px);box-shadow:0 2px 10px rgba(0,0,0,.4);
        transition:background .15s;white-space:nowrap;`;
      btn3d.textContent = '⬡ 3D';
      mapEl.appendChild(btn3d);
      btn3d.addEventListener('mousedown', e => e.stopPropagation());
      btn3d.addEventListener('dblclick',  e => e.stopPropagation());
    })();

    WZ._liveMarkers = L.featureGroup().addTo(WZ._liveMap);

    // Distanzmodus-Events (aircraft-spezifisch, optional)
    if (typeof window._wzDistMapClick === "function")
      WZ._liveMap.on("click", window._wzDistMapClick);
    if (typeof window._wzDistMouseMove === "function")
      WZ._liveMap.on("mousemove", window._wzDistMouseMove);

    // Zone-Umriss/Punkt anzeigen
    if (zone.geometry && zone.geometry.type) {
      const color = WZ.ZONE_COLORS[zone.zone_type] || "#3b82f6";
      if (zone.geometry.type === "Point") {
        // Server-Standort als Marker
        const [lon, lat] = zone.geometry.coordinates;
        const server = (zone.config && zone.config.server) || {};
        const label = [server.city, server.country].filter(Boolean).join(", ") || "Server";
        const markerColor = _pluginCfg(zone.zone_type).marker_color || color;
        const marker = L.marker([lat, lon], {
          icon: L.divIcon({
            className: "",
            html: `<div style="background:${markerColor};color:#fff;font-size:11px;font-weight:700;
              padding:4px 10px;border-radius:6px;white-space:nowrap;width:max-content;
              box-shadow:0 2px 8px rgba(0,0,0,.4);display:flex;align-items:center;gap:5px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
              ${WZ._esc(label)}</div>`,
            iconSize: [0, 0], iconAnchor: [0, 15],
          })
        }).addTo(WZ._liveMap);
        if (server.ip || server.org || server.isp) {
          marker.bindPopup(`<div style="font-size:12px;line-height:1.6;">
            <strong>${t('wz_website_server_location','Server Location')}</strong><br>
            ${server.ip ? 'IP: <code>' + WZ._esc(server.ip) + '</code><br>' : ''}
            ${server.city ? t('wz_website_server_city','City:') + ' ' + WZ._esc(server.city) + '<br>' : ''}
            ${server.country ? t('wz_website_server_country','Country:') + ' ' + WZ._esc(server.country) + '<br>' : ''}
            ${server.org ? 'Org: ' + WZ._esc(server.org) + '<br>' : ''}
            ${server.isp ? 'ISP: ' + WZ._esc(server.isp) + '<br>' : ''}
            ${server.as_name ? 'AS: ' + WZ._esc(server.as_name) : ''}
          </div>`);
        }
        WZ._liveMap.setView([lat, lon], 6);
      } else {
        const layer = L.geoJSON(zone.geometry, {
          style: { color: color, weight: 2, fillOpacity: .08, dashArray: "6 4" }
        }).addTo(WZ._liveMap);
        WZ._liveMap.fitBounds(layer.getBounds(), { padding: [20, 20] });
      }
    }
    // Time Focus location marker
    WZ._addTimeFocusMarker(WZ._liveMap);

    setTimeout(() => WZ._liveMap.invalidateSize(), 150);
  }

WZ._lastSatData = null; // letztes Satelliten-Ergebnis für Map-Overlay

  // Satellitenbild-Overlay auf Live-Map nachtragen
  WZ._satLiveMapOverlay = function() {
    if (!WZ._liveMap || !WZ._liveMarkers || !WZ._lastSatData || !WZ._lastSatData.image_b64 || !WZ._lastSatData.bbox) return;
    const bb = WZ._lastSatData.bbox;
    const bounds = L.latLngBounds([bb[1], bb[0]], [bb[3], bb[2]]);
    const imgUrl = "data:image/png;base64," + WZ._lastSatData.image_b64;
    WZ._liveMarkers.addLayer(L.imageOverlay(imgUrl, bounds, { opacity: 0.9, interactive: false }));
    WZ._liveMap.fitBounds(bounds, { padding: [20, 20] });
  }

  WZ._fetchLiveData = async function(zoneId) {
    var ctx = WZ._currentCtx;
    if (!ctx) return;
    var isSatPreload = ctx.overlayEl.style.display === "none";
    const zoneType = (WZ._zones.find(z => z.id === zoneId) || {}).zone_type;
    const _fetchCfg = _pluginCfg(zoneType);
    const _isSpinner = _fetchCfg.openStrategy === "spinner";
    const skipLoadingIndicator = isSatPreload || _fetchCfg.skip_loading_indicator;
    var _hasFullSpinner = WZ._pendingLiveCfg != null;
    if (!skipLoadingIndicator && !_hasFullSpinner) {
      ctx.loadingEl.style.display = "block";
      ctx.errorEl.style.display = "none";
      ctx.contentEl.style.display = "none";
    } else if (!isSatPreload) {
      ctx.loadingEl.style.display = "none";
      ctx.errorEl.style.display = "none";
      ctx.contentEl.style.display = "block";
    }

    try {
      const liveUrl = "/api/watchzones/" + zoneId + "/live" + (WZ._liveAsType ? "?as_type=" + WZ._liveAsType : "");
      const r = await fetch(liveUrl, { signal: ctx._abortCtrl.signal });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Fehler " + r.status);

      const _liveCfg = _pluginCfg(data.zone_type);
      const _isSpinnerActual = _liveCfg.openStrategy === "spinner";
      // Reset module state via callbacks
      WZ._onLiveReset.forEach(function(fn) { fn(); });

      // Preload-Strategie: Daten speichern für späteres Overlay
      if (_liveCfg.openStrategy === "preload") WZ._lastSatData = data;

      // Setup box BEFORE rendering so charts get correct dimensions
      if (ctx.overlayEl.style.display !== "flex") {
        var _pc = WZ._pendingLiveCfg;
        if (_pc) {
          ctx.boxEl.style.display = "flex";
          ctx.boxEl.style.maxWidth = _pc.maxWidth;
          ctx.boxEl.style.width = "96%";
          ctx.boxEl.style.height = _pc.height;
          ctx.boxEl.style.maxHeight = _pc.height;
          ctx.titleEl.textContent = _pc.title;
          ctx.loadingEl.style.display = "none";
          ctx.contentEl.style.display = "block";
          ctx.bodyEl.style.display = "flex";
          ctx.mapRowEl.style.display = _pc.showMap ? "flex" : "none";
          ctx.resizeMapEl.style.display = _pc.showMap ? "" : "none";
          if (!_pc.showMap) {
            ctx.mapEl.style.height = "0"; ctx.mapEl.style.minHeight = "0";
          }
          ctx.underMapBar.style.display = "none";
          ctx.spinnerEl.style.display = "none";
          WZ._pendingLiveCfg = null;
        }
        ctx.overlayEl.style.display = "flex";
        _wzHideFullSpinner();
      }

      // Map initialisieren falls nötig (Default-Strategy)
      if (_liveCfg.has_live_map !== false && !WZ._liveMap && ctx.mapRowEl.style.display !== "none") {
        var _zone = WZ._zones.find(function(z) { return z.id === zoneId; });
        if (_zone) {
          try { _initLiveMap(_zone); } catch(e) { console.error("_initLiveMap error:", e); }
        }
      }

      // Dispatch to registered renderer
      const renderer = WZ._renderers[data.zone_type];
      if (renderer) {
        if (_liveCfg.openStrategy === "preload" && isSatPreload) {
          // Skip rendering during preload
        } else {
          renderer(data);
        }
      }
      // Re-apply plugin box width after renderer
      if (_liveCfg.live_box_max_width) {
        ctx.boxEl.style.maxWidth = _liveCfg.live_box_max_width;
        ctx.boxEl.style.width = "96%";
      }
      // Plugin-Capabilities: Header-Buttons nach Injection sichtbar machen
      const heatBtn = document.getElementById("wz-heatmap-btn");
      if (heatBtn) heatBtn.style.display = _liveCfg.has_heatmap ? "inline-flex" : "none";
      const projBtn = document.getElementById("wz-projection-btn");
      if (projBtn) projBtn.style.display = _liveCfg.has_projection ? "inline-flex" : "none";
      const refreshBar = document.getElementById("wz-refresh-bar");
      if (refreshBar) {
        refreshBar.style.display = _liveCfg.has_refresh_bar ? "flex" : "none";
        const tsEl = document.getElementById("wz-refresh-ts");
        if (tsEl && _liveCfg.has_refresh_bar) tsEl.textContent = "Stand: " + (window.fmtTimeOnly ? window.fmtTimeOnly(new Date().toISOString()) : new Date().toLocaleTimeString('de-DE', {hour:'2-digit', minute:'2-digit', second:'2-digit'}));
      }
      if (!skipLoadingIndicator) {
        ctx.loadingEl.style.display = "none";
        ctx.contentEl.style.display = "block";
      }
      // Spinner→Box-Übergang für Spinner-Plugins
      if (_isSpinner || _isSpinnerActual) {
        ctx.spinnerEl.style.display = "none";
        ctx.boxEl.style.display = "flex";
        requestAnimationFrame(function() {
          setTimeout(function() { if (WZ._liveMap) WZ._liveMap.invalidateSize(); }, 300);
        });
      }
    } catch(e) {
      if (e.name === "AbortError") return; // Fetch wurde abgebrochen (Popup geschlossen)
      console.error("WZ._fetchLiveData Fehler:", e);
      _wzHideFullSpinner();
      if (ctx.overlayEl.style.display !== "flex") ctx.overlayEl.style.display = "flex";
      if (_isSpinner) {
        ctx.spinnerEl.style.display = "none";
        ctx.boxEl.style.display = "flex";
      }
      ctx.loadingEl.style.display = "none";
      ctx.errorEl.style.display = "block";
      ctx.errorEl.textContent = e.message || t('wz_unknown_error','Unknown error');
    }
  }

  // ── Daten sammeln (Global Zones) ────────────────────────────────────

  // Plugin-specific config field definitions
  // Each plugin registers its collect config via WZ._collectConfigs[pluginId] in its own JS file
  WZ._collectConfigs = {};

  window.wzShowLastCollect = function(zoneId) {
    var z = WZ._zones.find(function(zz) { return zz.id === zoneId; });
    if (!z || !z.config || !z.config._last_collect) { alert("Keine gespeicherte Sammlung vorhanden."); return; }
    var lc = z.config._last_collect;
    _wzRenderCollectResults(z, lc.collected || [], lc.errors || [], true);
  };

  window.wzCollectData = function(zoneId) {
    var z = WZ._zones.find(function(zz) { return zz.id === zoneId; });
    if (!z) return;
    var savedPluginCfg = (z.config && z.config.plugins) || {};

    var pluginIds = _WZ_PLUGIN_IDS.filter(function(p) { return p !== "global"; });

    var ov = document.getElementById("wz-collect-overlay");
    if (!ov) {
      ov = document.createElement("div");
      ov.id = "wz-collect-overlay";
      ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:10001;display:flex;align-items:center;justify-content:center;";
      ov.addEventListener("click", function(ev) { if (ev.target === ov) ov.style.display = "none"; });
      document.body.appendChild(ov);
    }

    var h = '<div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:24px 28px;width:94%;max-width:700px;max-height:88vh;overflow-y:auto;box-shadow:0 12px 40px rgba(0,0,0,.5);">';
    h += '<div style="display:flex;align-items:center;margin-bottom:16px;">';
    h += '<div style="flex:1;"><h3 style="margin:0;font-size:16px;color:var(--text);">Daten sammeln</h3>';
    h += '<span style="font-size:11px;color:var(--muted);">Zone: ' + WZ._esc(z.name) + '</span></div>';
    h += '<button onclick="document.getElementById(\'wz-collect-overlay\').style.display=\'none\'" style="border:none;background:none;color:var(--muted);cursor:pointer;font-size:20px;">&times;</button></div>';

    // Plugin list with checkboxes + expandable config
    h += '<div id="wz-collect-plugins" style="margin-bottom:16px;">';
    pluginIds.forEach(function(pid) {
      var meta = (WZ._plugins[pid] || {});
      var label = _wzPluginLabel(pid);
      var color = WZ.ZONE_COLORS[pid] || "#888";
      var hasConfig = !!WZ._collectConfigs[pid];
      var prevChecked = savedPluginCfg[pid] ? ' checked' : '';

      h += '<div style="border:1px solid var(--border);border-radius:8px;margin-bottom:6px;background:var(--bg);overflow:hidden;">';
      h += '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;">';
      h += '<input type="checkbox" value="' + pid + '" class="wz-collect-cb"' + prevChecked + ' style="accent-color:' + color + ';">';
      h += '<span style="color:' + color + ';font-weight:600;font-size:12px;flex:1;">' + WZ._esc(label) + '</span>';
      if (hasConfig) {
        h += '<button class="wz-cc-toggle" data-target="wz-cc-' + pid + '" data-cb="' + pid + '" onclick="var t=document.getElementById(this.getAttribute(\'data-target\'));t.style.display=t.style.display===\'none\'?\'block\':\'none\';this.textContent=t.style.display===\'none\'?\'\u25b6 Konfig\':\'\u25bc Konfig\';if(t.style.display===\'block\'){var cb=document.querySelector(\'.wz-collect-cb[value=\\\'\'+this.dataset.cb+\'\\\']\');if(cb)cb.checked=true;}" '
          + 'style="border:1px solid var(--border);background:none;color:var(--muted);cursor:pointer;font-size:10px;padding:2px 8px;border-radius:4px;">'
          + (savedPluginCfg[pid] ? '\u25bc Konfig' : '\u25b6 Konfig') + '</button>';
      }
      h += '</div>';

      // Config panel (expandable)
      if (hasConfig) {
        var savedCfg = savedPluginCfg[pid] || {};
        h += '<div id="wz-cc-' + pid + '" data-plugin="' + pid + '" style="display:' + (savedPluginCfg[pid] ? 'block' : 'none') + ';padding:6px 12px 10px 36px;border-top:1px solid var(--border);background:rgba(0,0,0,.1);">';
        h += WZ._collectConfigs[pid].fields(savedCfg);
        h += '</div>';
      }
      h += '</div>';
    });
    h += '</div>';

    // Select all / none
    h += '<div style="margin-bottom:16px;display:flex;gap:8px;">';
    h += '<button onclick="document.querySelectorAll(\'.wz-collect-cb\').forEach(function(c){c.checked=true;})" style="border:1px solid var(--border);background:none;color:var(--muted);cursor:pointer;font-size:11px;padding:3px 10px;border-radius:4px;">Alle</button>';
    h += '<button onclick="document.querySelectorAll(\'.wz-collect-cb\').forEach(function(c){c.checked=false;})" style="border:1px solid var(--border);background:none;color:var(--muted);cursor:pointer;font-size:11px;padding:3px 10px;border-radius:4px;">Keine</button>';
    h += '</div>';

    // Action buttons
    h += '<div style="display:flex;gap:10px;justify-content:flex-end;">';
    h += '<button id="wz-collect-save-cfg" style="padding:8px 18px;border:1px solid var(--border);border-radius:6px;background:none;color:var(--muted);cursor:pointer;font-size:12px;" title="Plugin-Konfiguration speichern ohne zu sammeln">Konfig speichern</button>';
    h += '<button onclick="document.getElementById(\'wz-collect-overlay\').style.display=\'none\'" style="padding:8px 18px;border:1px solid var(--border);border-radius:6px;background:none;color:var(--muted);cursor:pointer;font-size:12px;">Abbrechen</button>';
    h += '<button id="wz-collect-start" style="padding:8px 24px;border:none;border-radius:6px;background:var(--accent3);color:#fff;cursor:pointer;font-size:12px;font-weight:600;">Konfig speichern &amp; Sammeln</button>';
    h += '</div>';

    h += '<div id="wz-collect-results" style="display:none;margin-top:16px;border-top:1px solid var(--border);padding-top:16px;"></div>';
    h += '</div>';
    ov.innerHTML = h;
    ov.style.display = "flex";

    // Auto-check plugin checkbox when config panel is interacted with
    document.querySelectorAll("[id^='wz-cc-'][data-plugin]").forEach(function(panel) {
      panel.addEventListener("input", function() {
        var pid = panel.getAttribute("data-plugin");
        var cb = document.querySelector('.wz-collect-cb[value="' + pid + '"]');
        if (cb && !cb.checked) cb.checked = true;
      });
      panel.addEventListener("change", function() {
        var pid = panel.getAttribute("data-plugin");
        var cb = document.querySelector('.wz-collect-cb[value="' + pid + '"]');
        if (cb && !cb.checked) cb.checked = true;
      });
    });

    // Read plugin configs from UI
    function _readPluginConfigs() {
      var cfgs = {};
      document.querySelectorAll(".wz-collect-cb:checked").forEach(function(cb) {
        var pid = cb.value;
        var configPanel = document.getElementById("wz-cc-" + pid);
        if (configPanel && WZ._collectConfigs[pid]) {
          cfgs[pid] = WZ._collectConfigs[pid].read(configPanel);
        } else {
          cfgs[pid] = {};
        }
      });
      return cfgs;
    }

    // Save config to zone
    function _savePluginConfig(callback) {
      var cfgs = _readPluginConfigs();
      var newConfig = Object.assign({}, z.config || {}, { plugins: cfgs });
      fetch("/api/watchzones/" + zoneId, {
        method: "PUT",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ config: newConfig })
      }).then(function(r) {
        if (r.ok) {
          z.config = newConfig;
          if (callback) callback();
        } else { alert("Fehler beim Speichern der Konfiguration"); }
      }).catch(function(e) { alert("Fehler: " + e.message); });
    }

    // Save config only
    document.getElementById("wz-collect-save-cfg").addEventListener("click", function() {
      _savePluginConfig(function() {
        var btn = document.getElementById("wz-collect-save-cfg");
        if (btn) { btn.textContent = "Gespeichert!"; btn.style.color = "#22c55e"; setTimeout(function() { btn.textContent = "Konfig speichern"; btn.style.color = "var(--muted)"; }, 2000); }
      });
    });

    // Save config + collect
    document.getElementById("wz-collect-start").addEventListener("click", function() {
      var selected = [];
      document.querySelectorAll(".wz-collect-cb:checked").forEach(function(cb) { selected.push(cb.value); });
      if (!selected.length) { alert("Bitte mindestens ein Plugin ausw\u00e4hlen."); return; }
      _savePluginConfig(function() {
        _wzDoCollect(zoneId, z, selected);
        // Scroll to bottom to show progress bar
        var ov = document.getElementById("wz-collect-overlay");
        if (ov) { var inner = ov.querySelector("div"); if (inner) inner.scrollTop = inner.scrollHeight; }
      });
    });
  };

  function _wzDoCollect(zoneId, zone, pluginIds) {
    var btn = document.getElementById("wz-collect-start");
    var results = document.getElementById("wz-collect-results");
    var total = pluginIds.length;
    if (btn) { btn.disabled = true; btn.textContent = "Sammle Daten\u2026"; }

    // Progress bar
    var progressHtml = '<div style="padding:20px;"><div style="font-size:12px;color:var(--muted);margin-bottom:8px;">Sammle Daten von ' + total + ' Plugins\u2026</div>'
      + '<div style="background:var(--border);border-radius:4px;height:8px;overflow:hidden;margin-bottom:8px;">'
      + '<div id="wz-collect-progress-bar" style="width:0%;height:100%;background:#06b6d4;border-radius:4px;transition:width .3s;"></div></div>'
      + '<div id="wz-collect-progress-text" style="font-size:11px;color:var(--muted);">0 / ' + total + '</div></div>';
    if (results) { results.style.display = "block"; results.innerHTML = progressHtml; }

    var collected = [];
    var errors = [];
    var done = 0;

    function _updateProgress(pluginLabel) {
      done++;
      var bar = document.getElementById("wz-collect-progress-bar");
      var txt = document.getElementById("wz-collect-progress-text");
      var pct = Math.round((done / total) * 100);
      if (bar) bar.style.width = pct + "%";
      if (txt) txt.textContent = done + ' / ' + total + (pluginLabel ? ' \u2014 ' + pluginLabel : '');
    }

    pluginIds.forEach(function(pid) {
      var url = "/api/watchzones/" + zoneId + "/live?as_type=" + pid;
      fetch(url).then(function(r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }).then(function(data) {
        collected.push({ plugin: pid, data: data });
      }).catch(function(e) {
        errors.push({ plugin: pid, error: e.message || "Fehler" });
      }).finally(function() {
        _updateProgress(_wzPluginLabel(pid));
        if (done >= total) _wzRenderCollectResults(zone, collected, errors);
      });
    });
  }

  function _wzPluginLabel(pid) {
    return (WZ.PLUGIN_LABELS && WZ.PLUGIN_LABELS[pid]) || pid;
  }

  function _wzFmtDate(s) {
    if (!s) return "";
    if (window.fmtDateOnly) return window.fmtDateOnly(String(s).replace(" ", "T"));
    return String(s).slice(0, 10);
  }

  function _wzRenderCollectResults(zone, collected, errors, _isReplay) {
    var btn = document.getElementById("wz-collect-start");
    if (btn) { btn.disabled = false; btn.textContent = "Erneut sammeln"; }

    var _collectDate = "";
    if (!_isReplay) {
      // Close the collect config dialog
      var collectOv = document.getElementById("wz-collect-overlay");
      if (collectOv) collectOv.style.display = "none";

      // Save results to zone config
      _collectDate = new Date().toLocaleString("de-DE", {day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});
      var _savePayload = {
        date: _collectDate,
        collected: collected.map(function(r) { return { plugin: r.plugin, data: r.data }; }),
        errors: errors,
      };
      var newConfig = Object.assign({}, zone.config || {}, { _last_collect: _savePayload });
      fetch("/api/watchzones/" + zone.id, {
        method: "PUT",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ config: newConfig })
      }).then(function(r) {
        if (r.ok) {
          zone.config = newConfig;
          _renderAllZones();
        }
      });
    } else {
      _collectDate = (zone.config && zone.config._last_collect && zone.config._last_collect.date) || "";
    }

    // Open results in a full-screen overlay
    var rov = document.getElementById("wz-collect-results-overlay");
    if (!rov) {
      rov = document.createElement("div");
      rov.id = "wz-collect-results-overlay";
      rov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:10002;display:flex;align-items:center;justify-content:center;";
      rov.addEventListener("click", function(ev) { if (ev.target === rov) rov.style.display = "none"; });
      document.body.appendChild(rov);
    }
    rov.style.display = "flex";
    var results = rov;
    // Use inner container
    var _ts = Date.now();

    var h = '<div id="wz-collect-results-box" style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:20px 24px;width:96%;max-width:1400px;max-height:92vh;overflow-y:auto;box-shadow:0 12px 40px rgba(0,0,0,.5);">';
    h += '<div style="display:flex;align-items:center;margin-bottom:16px;">';
    h += '<div style="flex:1;"><h3 style="margin:0;font-size:16px;color:var(--text);">Ergebnisse \u2014 ' + WZ._esc(zone.name) + '</h3>'
      + (_collectDate ? '<div style="font-size:10px;color:#22c55e;margin-top:2px;">\u2713 ' + (_isReplay ? 'Sammlung vom ' : 'Gespeichert am ') + _collectDate + '</div>' : '') + '</div>';
    // Wide mode button
    h += '<button id="wz-cr-wide-btn" title="Volle Breite" style="border:none;background:none;color:var(--muted);cursor:pointer;padding:4px;">'
      + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
      + '<path d="M18 8l4 4-4 4"/><path d="M6 8l-4 4 4 4"/><line x1="2" y1="12" x2="22" y2="12"/></svg></button>';
    // Fullscreen button
    h += '<button id="wz-cr-fs-btn" title="Vollbild" style="border:none;background:none;color:var(--muted);cursor:pointer;padding:4px;">'
      + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
      + '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg></button>';
    // Zoom fullscreen button
    h += '<button id="wz-cr-zoom-btn" title="Lupen-Vollbild" style="border:none;background:none;color:var(--muted);cursor:pointer;padding:4px;margin-right:8px;">'
      + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
      + '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg></button>';
    h += '<button onclick="document.getElementById(\'wz-collect-results-overlay\').style.display=\'none\'" style="border:none;background:none;color:var(--muted);cursor:pointer;font-size:22px;">&times;</button></div>';

    // Summary bar
    var totalItems = 0, totalAnomalies = 0;
    collected.forEach(function(r) {
      totalItems += r.data.count || r.data.total || (r.data.items ? r.data.items.length : 0);
      var a = r.data.anomalies || (r.data.items ? r.data.items.reduce(function(acc,it){return acc.concat(it.anomalies||[]);}, []) : []);
      totalAnomalies += a.length;
    });
    h += '<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;">';
    h += '<span style="font-size:11px;padding:3px 10px;border-radius:12px;background:rgba(34,197,94,.15);color:#22c55e;">' + collected.length + ' Plugins</span>';
    h += '<span style="font-size:11px;padding:3px 10px;border-radius:12px;background:rgba(6,182,212,.15);color:#06b6d4;">' + totalItems + ' Datenpunkte</span>';
    if (totalAnomalies) h += '<span style="font-size:11px;padding:3px 10px;border-radius:12px;background:rgba(239,68,68,.15);color:#ef4444;">' + totalAnomalies + ' Anomalien</span>';
    if (errors.length) h += '<span style="font-size:11px;padding:3px 10px;border-radius:12px;background:rgba(239,68,68,.15);color:#ef4444;">' + errors.length + ' fehlgeschlagen</span>';
    h += '</div>';

    // Fullscreen style toggle
    var _collectFsHandler = function() {
      var box = document.getElementById("wz-collect-results-box");
      if (!box) return;
      var isFs = document.fullscreenElement === box;
      if (isFs) {
        box.style.maxWidth = "100%"; box.style.maxHeight = "100%"; box.style.width = "100%";
        box.style.borderRadius = "0"; box.style.height = "100vh";
      } else {
        box.style.maxWidth = "1400px"; box.style.maxHeight = "92vh"; box.style.width = "96%";
        box.style.borderRadius = "14px"; box.style.height = "";
      }
      // Resize all mini maps in collect cards
      box.querySelectorAll("[id$='-map']").forEach(function(mapEl) {
        mapEl.style.height = isFs ? "300px" : "400px";
      });
      // Invalidate Leaflet maps after resize
      setTimeout(function() {
        box.querySelectorAll(".leaflet-container").forEach(function(el) {
          if (el._leaflet_id && el._leaflet_map) el._leaflet_map.invalidateSize();
        });
      }, 200);
    };
    document.addEventListener("fullscreenchange", _collectFsHandler);

    var _mapId = "wz-collect-map-" + Date.now(); // kept for reference in overview map init

    // Plugin-specific rendering via registered renderers or generic fallback
    collected.sort(function(a, b) { return a.plugin.localeCompare(b.plugin); });
    h += '<div style="column-width:380px;column-gap:14px;">';
    collected.forEach(function(r) {
      var label = _wzPluginLabel(r.plugin);
      var color = WZ.ZONE_COLORS[r.plugin] || "#888";
      var data = r.data;
      var cardId = "wz-cr-" + r.plugin + "-" + _ts;

      h += '<div id="' + cardId + '" style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:14px 18px;margin-bottom:14px;break-inside:avoid;border-left:3px solid ' + color + ';">';

      // Header (always rendered by framework)
      h += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">';
      h += '<span style="font-size:14px;font-weight:700;color:' + color + ';">' + WZ._esc(label) + '</span>';
      var count = data.count || data.total || (data.items ? data.items.length : 0);
      if (count) h += '<span style="font-size:11px;color:var(--muted);">' + count + ' Eintr\u00e4ge</span>';
      var anomalies = data.anomalies || (data.items ? data.items.reduce(function(acc,it){return acc.concat(it.anomalies||[]);}, []) : []);
      if (anomalies.length) h += '<span style="font-size:11px;padding:2px 8px;border-radius:10px;background:rgba(239,68,68,.15);color:#ef4444;">' + anomalies.length + ' Anomalien</span>';
      if (data.start && data.end) h += '<span style="font-size:10px;color:var(--muted);">' + _wzFmtDate(data.start) + ' \u2013 ' + _wzFmtDate(data.end) + '</span>';
      h += '<button onclick="document.getElementById(\'wz-collect-results-overlay\').style.display=\'none\';document.getElementById(\'wz-collect-overlay\').style.display=\'none\';wzOpenLive(' + zone.id + ',\'' + r.plugin + '\')" '
        + 'style="margin-left:auto;border:1px solid ' + color + ';background:none;color:' + color + ';cursor:pointer;font-size:10px;padding:3px 10px;border-radius:4px;font-weight:600;">Live \u00f6ffnen</button>';
      h += '</div>';

      // Plugin-specific body: use registered renderer or generic fallback
      var renderer = WZ._collectRenderers[r.plugin] || WZ._collectRenderers[data.zone_type];
      if (renderer && renderer.renderHTML) {
        h += renderer.renderHTML(data, cardId, zone);
      } else {
        h += WZ._collectGenericHTML(data, cardId);
      }

      if (data.error) h += '<div style="font-size:11px;color:#ef4444;margin-top:6px;">' + WZ._esc(data.error) + '</div>';
      h += '</div>';
    });
    h += '</div>';

    // Errors
    if (errors.length) {
      h += '<div style="margin-top:14px;">';
      errors.forEach(function(e) {
        var elabel = _wzPluginLabel(e.plugin);
        h += '<div style="background:var(--bg);border:1px solid rgba(239,68,68,.3);border-radius:8px;padding:8px 14px;margin-bottom:6px;border-left:3px solid #ef4444;">';
        h += '<span style="font-size:12px;font-weight:600;color:#ef4444;">' + WZ._esc(elabel) + '</span>';
        h += '<span style="font-size:11px;color:var(--muted);margin-left:8px;">' + WZ._esc(e.error) + '</span>';
        h += '</div>';
      });
      h += '</div>';
    }

    h += '</div>'; // close main container
    results.innerHTML = h;

    // Wire up view mode buttons
    var _crBox = document.getElementById("wz-collect-results-box");
    var _crWideMode = false, _crWideSaved = null;
    var _crWideBtn = document.getElementById("wz-cr-wide-btn");
    var _crFsBtn = document.getElementById("wz-cr-fs-btn");
    var _crZoomBtn = document.getElementById("wz-cr-zoom-btn");

    if (_crWideBtn) _crWideBtn.addEventListener("click", function() {
      if (_crWideMode) {
        if (_crWideSaved) { _crBox.style.width = _crWideSaved.w; _crBox.style.maxWidth = _crWideSaved.mw; _crBox.style.borderRadius = _crWideSaved.br; }
        _crWideMode = false; _crWideBtn.style.color = "var(--muted)";
      } else {
        _crWideSaved = { w: _crBox.style.width, mw: _crBox.style.maxWidth, br: _crBox.style.borderRadius };
        _crBox.style.width = "100%"; _crBox.style.maxWidth = "100%"; _crBox.style.borderRadius = "0";
        _crWideMode = true; _crWideBtn.style.color = "#06b6d4";
      }
    });

    if (_crFsBtn) _crFsBtn.addEventListener("click", function() {
      var fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      if (fsEl === _crBox) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); }
      else { (_crBox.requestFullscreen || _crBox.webkitRequestFullscreen).call(_crBox); }
    });

    // Lupe mode for results
    var _crLupeActive = false, _crLupePanel = null, _crLupeCanvas = null, _crLupeShot = null, _crLupeBusy = false, _crLupeIv = null;
    var _crLupeMX = 0, _crLupeMY = 0, _crLupeZoom = 3;
    function _crLupeCapture() {
      if (_crLupeBusy || !_crLupeActive || typeof html2canvas === "undefined") return;
      _crLupeBusy = true;
      html2canvas(_crBox, { backgroundColor: null, scale: 1, logging: false, useCORS: true,
        ignoreElements: function(el) { return el === _crLupePanel; }
      }).then(function(c) { _crLupeShot = c; _crLupeBusy = false; _crLupeDraw(); }).catch(function() { _crLupeBusy = false; });
    }
    function _crLupeDraw() {
      if (!_crLupeActive || !_crLupeShot || !_crLupeCanvas) return;
      var pw = _crLupePanel.clientWidth, ph = _crLupePanel.clientHeight;
      if (!pw || !ph) return;
      var dpr = window.devicePixelRatio || 1;
      if (_crLupeCanvas.width !== pw * dpr || _crLupeCanvas.height !== ph * dpr) { _crLupeCanvas.width = pw * dpr; _crLupeCanvas.height = ph * dpr; }
      var c2 = _crLupeCanvas.getContext("2d");
      var boxR = _crBox.getBoundingClientRect();
      var mx = _crLupeMX - boxR.left, my = _crLupeMY - boxR.top;
      var srcW = pw / _crLupeZoom, srcH = ph / _crLupeZoom;
      var sx = (mx / boxR.width) * _crLupeShot.width - (srcW * dpr / 2);
      var sy = (my / boxR.height) * _crLupeShot.height - (srcH * dpr / 2);
      c2.clearRect(0, 0, pw * dpr, ph * dpr);
      c2.drawImage(_crLupeShot, sx, sy, srcW * dpr, srcH * dpr, 0, 0, pw * dpr, ph * dpr);
      c2.strokeStyle = "rgba(239,68,68,.35)"; c2.lineWidth = 1;
      c2.beginPath(); c2.moveTo(pw * dpr / 2, 0); c2.lineTo(pw * dpr / 2, ph * dpr); c2.stroke();
      c2.beginPath(); c2.moveTo(0, ph * dpr / 2); c2.lineTo(pw * dpr, ph * dpr / 2); c2.stroke();
    }
    function _crLupeMM(e) { _crLupeMX = e.clientX; _crLupeMY = e.clientY; if (_crLupeActive && _crLupeShot) _crLupeDraw(); }
    if (_crZoomBtn) _crZoomBtn.addEventListener("click", function() {
      _crLupeActive = !_crLupeActive;
      if (_crLupeActive) {
        _crLupePanel = document.createElement("div");
        _crLupePanel.style.cssText = "position:absolute;left:0;top:0;bottom:0;width:45%;z-index:10;background:var(--bg);border-right:2px solid var(--border);overflow:hidden;";
        _crLupeCanvas = document.createElement("canvas");
        _crLupeCanvas.style.cssText = "display:block;width:100%;height:100%;";
        _crLupePanel.appendChild(_crLupeCanvas);
        var info = document.createElement("span");
        info.style.cssText = "position:absolute;bottom:8px;left:50%;transform:translateX(-50%);font-size:10px;color:var(--muted);opacity:.5;pointer-events:none;";
        info.textContent = "Lupe " + _crLupeZoom + "\u00d7";
        _crLupePanel.appendChild(info);
        _crBox.style.position = "relative"; _crBox.style.paddingLeft = "46%";
        _crBox.insertBefore(_crLupePanel, _crBox.firstChild);
        _crZoomBtn.style.color = "#f59e0b";
        document.addEventListener("mousemove", _crLupeMM);
        _crLupeCapture(); _crLupeIv = setInterval(_crLupeCapture, 1500);
      } else {
        if (_crLupePanel && _crLupePanel.parentNode) _crLupePanel.parentNode.removeChild(_crLupePanel);
        _crLupePanel = null; _crLupeCanvas = null; _crLupeShot = null;
        _crBox.style.paddingLeft = "";
        _crZoomBtn.style.color = "var(--muted)";
        document.removeEventListener("mousemove", _crLupeMM);
        if (_crLupeIv) { clearInterval(_crLupeIv); _crLupeIv = null; }
      }
    });

    // Post-render: call plugin-specific afterRender hooks (delay for DOM readiness)
    setTimeout(function() {
      collected.forEach(function(r) {
        var cardId = "wz-cr-" + r.plugin + "-" + _ts;
        var cardEl = document.getElementById(cardId);
        if (!cardEl) return;
        var renderer = WZ._collectRenderers[r.plugin] || WZ._collectRenderers[r.data.zone_type];
        if (renderer && renderer.afterRender) {
          renderer.afterRender(r.data, cardId, cardEl);
        } else {
          // Generic: init maps for items with lat/lon
          WZ._collectGenericAfterRender(r, cardId, cardEl);
        }
      });
    }, 600);
  }

  // ── Generic collect renderer (fallback) ──
  WZ._collectRenderers = {};

  WZ._collectGenericHTML = function(data, cardId) {
    var h = "";
    // Images
    if (data.image_b64) {
      h += '<img src="data:image/png;base64,' + data.image_b64 + '" style="width:100%;border-radius:6px;margin-bottom:8px;cursor:pointer;border:1px solid var(--border);" onclick="window.open(this.src,\'_blank\')">';
      if (data.date_from && data.date_to) h += '<div style="font-size:10px;color:var(--muted);margin-bottom:6px;">' + _wzFmtDate(data.date_from) + ' \u2013 ' + _wzFmtDate(data.date_to) + '</div>';
    }
    if (data.image_url) {
      h += '<img src="' + WZ._esc(data.image_url) + '" style="width:100%;border-radius:6px;margin-bottom:8px;border:1px solid var(--border);">';
    }
    // Time focus images
    if (data.time_focus_images && data.time_focus_images.length) {
      h += '<div style="display:flex;gap:8px;overflow-x:auto;margin-bottom:8px;">';
      data.time_focus_images.forEach(function(tfi) {
        var imgSrc = tfi.image_b64 ? ("data:image/png;base64," + tfi.image_b64) : (tfi.image_url || "");
        if (!imgSrc) return;
        var tfLabel = tfi.label === "before" ? "Vorher" : tfi.label === "focus" ? "Ereignis" : "Nachher";
        h += '<div style="flex:1;min-width:0;text-align:center;">';
        h += '<img src="' + imgSrc + '" style="width:100%;border-radius:6px;border:1px solid var(--border);cursor:pointer;" onclick="window.open(this.src,\'_blank\')">';
        h += '<div style="font-size:10px;color:var(--muted);margin-top:3px;">' + tfLabel + (tfi.date ? " \u2014 " + _wzFmtDate(tfi.date) : "") + '</div>';
        if (tfi.brightness != null) h += '<div style="font-size:10px;color:#f59e0b;">Helligkeit: ' + tfi.brightness.toFixed(1) + '</div>';
        h += '</div>';
      });
      h += '</div>';
    }
    // Geo map placeholder
    var hasGeo = data.items && data.items.some(function(it) { return it.lat != null; });
    if (hasGeo) h += '<div id="' + cardId + '-map" style="height:400px;border-radius:6px;margin-bottom:8px;"></div>';
    // Items table
    if (data.items && data.items.length) {
      h += '<table style="width:100%;font-size:11px;border-collapse:collapse;">';
      var fi = data.items[0], cols = [];
      if (fi.name) cols.push({k:"name",l:"Name"}); else if (fi.title) cols.push({k:"title",l:"Titel"}); else if (fi.country) cols.push({k:"country",l:"Land"});
      if (fi.date) cols.push({k:"date",l:"Datum"});
      if (fi.magnitude != null) cols.push({k:"magnitude",l:"Mag."});
      if (fi.value != null) cols.push({k:"value",l:"Wert"});
      if (fi.mean_ndvi != null) cols.push({k:"mean_ndvi",l:"NDVI"});
      if (fi.health != null) cols.push({k:"health",l:"Health"});
      if (fi.status) cols.push({k:"status",l:"Status"});
      if (fi.radio) cols.push({k:"radio",l:"Typ"});
      if (!cols.length) cols.push({k:"_i",l:"#"});
      h += '<thead><tr style="border-bottom:1px solid var(--border);color:var(--muted);">';
      cols.forEach(function(c){h+='<th style="text-align:left;padding:3px 6px;font-weight:600;">'+c.l+'</th>';});
      h += '</tr></thead><tbody>';
      data.items.slice(0, 10).forEach(function(it, i) {
        h += '<tr style="border-bottom:1px solid rgba(255,255,255,.05);">';
        cols.forEach(function(c){ var v=c.k==="_i"?i+1:it[c.k]; if(c.k==="health"&&v!=null)v=Math.round(v)+"%"; if(c.k==="date"&&v)v=_wzFmtDate(v); if(c.k==="mean_ndvi"&&v!=null)v=v.toFixed(3); h+='<td style="padding:3px 6px;">'+WZ._esc(String(v!=null?v:"\u2014").substring(0,60))+'</td>'; });
        h += '</tr>';
      });
      h += '</tbody></table>';
      if (data.items.length > 10) h += '<div style="font-size:10px;color:var(--muted);margin-top:4px;">+ ' + (data.items.length-10) + ' weitere</div>';
    }
    return h;
  };

  WZ._collectGenericAfterRender = function(r, cardId, cardEl) {
    if (!window.L) return;
    var mapEl = cardEl.querySelector("[id$='-map']");
    if (!mapEl || mapEl._leaflet_id) return;
    var color = WZ.ZONE_COLORS[r.plugin] || "#888";
    var m = L.map(mapEl, { zoomControl: false }).setView([30, 10], 2);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png", { maxZoom: 18 }).addTo(m);
    var bounds = [];
    (r.data.items || []).forEach(function(it) {
      if (it.lat != null && it.lon != null) {
        L.circleMarker([it.lat, it.lon], { radius: 5, color: color, fillColor: color, fillOpacity: 0.5, weight: 1 })
          .bindTooltip('<strong>' + WZ._esc(it.name || it.title || it.country || "") + '</strong>').addTo(m);
        bounds.push([it.lat, it.lon]);
      }
    });
    if (bounds.length) { try { m.fitBounds(bounds, { padding: [20, 20], maxZoom: 10 }); } catch(e) {} }
  };

  // Make _wzFmtDate available for plugins
  WZ._fmtDate = _wzFmtDate;

  // ── Anomalie-Farbe ──────────────────────────────────────────────────
  WZ._anomalyColor = function(score) {
    if (score >= 30) return "#ef4444";   // rot
    if (score >= 15) return "#f97316";   // orange
    if (score >= 5)  return "#eab308";   // gelb
    return "#f59e0b";                     // normal (amber)
  }
  WZ._anomalyBadge = function(score) {
    if (score === 0) return "";
    const bg = WZ._anomalyColor(score);
    return `<span style="display:inline-block;background:${bg};color:#fff;font-size:10px;font-weight:700;
              padding:1px 6px;border-radius:8px;margin-left:6px;">${score}</span>`;
  }

  WZ._usageBadge = function(usage) {
    const map = {
      military:   {label: "MIL",  bg: "#dc2626", icon: "🎖"},
      commercial: {label: "COM",  bg: "#2563eb", icon: "✈"},
      private:    {label: "PRIV", bg: "#16a34a", icon: "🛩"},
      civil:      {label: "ZIV",  bg: "#6b7280", icon: "✈"},
    };
    const m = map[usage] || map.civil;
    return `<span style="display:inline-flex;align-items:center;gap:2px;background:${m.bg};color:#fff;
              font-size:9px;font-weight:700;padding:1px 5px;border-radius:6px;white-space:nowrap;">${m.icon} ${m.label}</span>`;
  }

  // Aktuell gespeicherte Live-Items für Detail-Popup
WZ._liveAircraftItems = [];

  // ── Zeitspanne der Live-Daten als Label auf dem Zone-Polygon ────────────
WZ._liveZoneTimeLabel = null;

  // Local time at geographic location, using longitude-based UTC offset
  WZ._geoLocalTime = function(utcMs, lon, seconds) {
    const offH = Math.round((lon || 0) / 15);
    const d = new Date(utcMs + offH * 3600000);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    if (seconds) return `${hh}:${mm}:${String(d.getUTCSeconds()).padStart(2, '0')}`;
    return `${hh}:${mm}`;
  }

  WZ._updateZoneTimeLabel = function(items) {
    if (WZ._liveZoneTimeLabel && WZ._liveMap) { WZ._liveMap.removeLayer(WZ._liveZoneTimeLabel); WZ._liveZoneTimeLabel = null; }
    if (!WZ._liveMap) return;
    const zone = WZ._zones.find(z => z.id === WZ._liveZoneId);
    if (!zone || !zone.geometry || zone.geometry.type === "Point") return;

    let neLat, neLon, westLon, eastLon, centerLon;
    try {
      const bounds = L.geoJSON(zone.geometry).getBounds();
      neLat    = bounds.getNorth();
      neLon    = bounds.getEast();
      westLon  = bounds.getWest();
      eastLon  = bounds.getEast();
      centerLon = bounds.getCenter().lng;
    } catch { return; }

    const now = Date.now();
    const westTz = Math.round(westLon / 15);
    const eastTz = Math.round(eastLon / 15);
    let label;
    if (westTz !== eastTz) {
      const vonStr = WZ._geoLocalTime(now, westLon, false);
      const bisStr = WZ._geoLocalTime(now, eastLon, false);
      label = `${vonStr} Uhr – ${bisStr} Uhr`;
    } else {
      label = `${WZ._geoLocalTime(now, centerLon, false)} Uhr`;
    }

    const color = WZ.ZONE_COLORS[zone.zone_type] || '#3b82f6';
    WZ._liveZoneTimeLabel = L.marker([neLat, neLon], {
      icon: L.divIcon({
        className: '',
        html: `<div style="display:inline-block;transform:translateX(-100%);padding-bottom:6px;pointer-events:none;">
          <div id="wz-zt-inner" style="background:${color}cc;color:#fff;font-size:10px;font-weight:700;
            padding:3px 10px;border-radius:4px;white-space:nowrap;
            box-shadow:0 1px 4px rgba(0,0,0,.4);">${label}</div>
        </div>`,
        iconSize: [0, 0], iconAnchor: [0, 34],
      }),
      interactive: false, zIndexOffset: 200,
    }).addTo(WZ._liveMap);
  }


  // ── Shared Utilities (moved from type modules) ──────────────────────
  WZ._haversineKm = function(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  WZ._geoBbox = function(geo) {
    const coords = [];
    function extract(obj) {
      if (Array.isArray(obj)) {
        if (obj.length >= 2 && typeof obj[0] === "number") coords.push(obj);
        else obj.forEach(extract);
      }
    }
    extract((geo || {}).coordinates || []);
    if (!coords.length) return null;
    const lons = coords.map(c => c[0]);
    const lats = coords.map(c => c[1]);
    return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
  }


  // ── Resize Handles ───────────────────────────────────────────────────
  ;(function() {
    let _resizing = null;

    function getAboveElement(handle) {
      const type = handle.dataset.resize;
      if (type === "map") return document.getElementById("wz-live-map");
      if (type === "parcoords") return document.getElementById("wz-parcoords-inline");
      return null;
    }

    document.querySelectorAll(".wz-resize-handle").forEach(handle => {
      handle.addEventListener("mousedown", function(e) {
        e.preventDefault();
        const above = getAboveElement(handle);
        if (!above || above.style.display === "none") return;
        _resizing = {
          handle: handle,
          above: above,
          startY: e.clientY,
          startH: above.offsetHeight,
        };
        handle.classList.add("active");
        document.body.style.cursor = "ns-resize";
        document.body.style.userSelect = "none";
      });
    });

    function _onResizeMove(e) {
      if (!_resizing) return;
      const dy = e.clientY - _resizing.startY;
      const newH = Math.max(80, _resizing.startH + dy);
      _resizing.above.style.height = newH + "px";
      if (_resizing.above.id === "wz-live-map" && WZ._liveMap) {
        WZ._liveMap.invalidateSize();
      }
      if (_resizing.above.id === "wz-parcoords-inline") {
        WZ._onResizeParcoords.forEach(function(fn) { fn(); });
      }
    }
    function _onResizeUp() {
      if (!_resizing) return;
      _resizing.handle.classList.remove("active");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (_resizing.above.id === "wz-live-map" && WZ._liveMap) {
        WZ._liveMap.invalidateSize();
      }
      if (_resizing.above.id === "wz-parcoords-inline") {
        WZ._onResizeParcoords.forEach(function(fn) { fn(); });
      }
      _resizing = null;
    }
    // Events auf window registrieren – funktioniert auch im Fullscreen
    window.addEventListener("mousemove", _onResizeMove);
    window.addEventListener("mouseup", _onResizeUp);
  })();


  // ── Fullscreen-Hook: Traceroute-Layout anpassen ─────────────────────
  WZ._onFullscreenChange.push(function(isLiveOverlayFS) {
    // Nur relevant wenn Traceroute aktiv ist
    if (!_wzTracerouteZoneId) return;
    setTimeout(function() {
      _wzTracerouteSyncHeight();
      if (WZ._liveMap) WZ._liveMap.invalidateSize();
    }, 200);
  });

  // ── Init ──────────────────────────────────────────────────────────────
  // Map-Init für das initiale Panel erfolgt via wzSelectPanel("global")
  // im Template (window.load Event), damit CSS-Layout garantiert fertig ist.
  document.getElementById("hdr-wz-project")
    ?.addEventListener("change", () => _renderAllZones());
  _loadProjects();
  _loadZones();

})();
