/**
 * WZ Core — shared state, maps, zone CRUD, live popup, traceroute.
 * Requires window.WZ namespace to be set up by template.
 */
(function() {
"use strict";
const WZ = window.WZ;

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
    skip_loading_indicator: false, // Loading-Spinner überspringen (z.B. Website)
    marker_color: null,          // Override Marker-Farbe für Point-Geometrien
    point_popup: null,           // fn(zone, server) → Popup-HTML für Point-Marker
  };

  function _pluginCfg(pluginId) {
    const cfg = WZ._plugins[pluginId];
    if (!cfg) return _pluginDefaults;
    var merged = Object.assign({}, _pluginDefaults, cfg);
    // Plugins ohne eigene Karte mischen keine globalen Zonen ein
    if (!merged.has_map) merged.mix_global_zones = false;
    return merged;
  }

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

    const tileUrl = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";

    const map = L.map(elId, { zoomControl: false }).setView([48.2, 11.8], 5);
    L.control.zoom({ position: "topright" }).addTo(map);
    L.tileLayer(tileUrl, {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com">CARTO</a>'
    }).addTo(map);
    L.control.scale({ metric: true, imperial: false }).addTo(map);

    const drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);
    _drawLayers[panel] = drawnItems;

    // Eigene Draw-Buttons mit Text (statt Leaflet.Draw-Toolbar)
    const drawBox = L.control({ position: "topleft" });
    drawBox.onAdd = function() {
      const div = L.DomUtil.create("div", "wz-draw-buttons");
      div.innerHTML = `
        <button class="wz-draw-btn" data-mode="polygon">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="8,1 15,6 12,15 4,15 1,6"/></svg>
          ${t('wz_draw_polygon','Draw Polygon Zone')}
        </button>
        <button class="wz-draw-btn" data-mode="rectangle">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="3" width="14" height="10" rx="1"/></svg>
          ${t('wz_draw_rectangle','Draw Rectangle Zone')}
        </button>`;
      L.DomEvent.disableClickPropagation(div);
      div.querySelectorAll("button").forEach(btn => {
        btn.addEventListener("click", () => {
          const mode = btn.dataset.mode;
          const opts = { shapeOptions: { color: WZ.ZONE_COLORS[panel], weight: 1.5, fillOpacity: .25 } };
          const drawer = mode === "polygon" ? new L.Draw.Polygon(map, opts) : new L.Draw.Rectangle(map, opts);
          drawer.enable();
          _showCrosshair(map);
        });
      });
      return div;
    };
    drawBox.addTo(map);
    _drawCtrls[panel] = drawBox;

    map.on(L.Draw.Event.CREATED, function(e) {
      _hideCrosshair(map);
      var layer = e.layer;
      drawnItems.addLayer(layer);
      _saveNewZone(panel, layer);
    });
    map.on("draw:drawstop", function() { _hideCrosshair(map); });

    _maps[panel] = map;
    _renderZonesOnMap(panel);

    // Leaflet braucht invalidateSize — mehrfach, da Layout noch nicht stabil sein kann
    map.invalidateSize();
    setTimeout(function() { map.invalidateSize(); }, 50);
    setTimeout(function() { map.invalidateSize(); }, 300);
    setTimeout(function() { map.invalidateSize(); }, 1000);
  }

  // ── Fadenkreuz-Linien im Zeichenmodus ─────────────────────────────────
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
            const lat = bbox[3];  // maxLat = Nordkante
            const lon = bbox[0];  // minLon = Westkante
            const label = L.marker([lat, lon], {
              icon: L.divIcon({
                className: "wz-label-icon",
                html: `<div style="background:${color};color:#fff;font-size:10px;font-weight:600;
                  padding:1px 6px;border-radius:3px;white-space:nowrap;width:max-content;
                  box-shadow:0 1px 3px rgba(0,0,0,.35);pointer-events:none;">${isGlobal && panel !== "global" ? "\ud83c\udf10 " : ""}${WZ._esc(z.name || "Zone")}</div>`,
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
      return `
      <div class="wz-zone-row" data-id="${z.id}" ${showingInTyped ? 'style="border-left:3px solid #8b5cf6;"' : ""}
           onmouseenter="wzHoverZone(${z.id},'${_hoverPanel}')"
           onmouseleave="wzUnhoverZone('${_hoverPanel}')"
           onclick="wzAnchorZone(${z.id},'${_hoverPanel}',event)">
        <span class="wz-zone-name" ${showingInTyped ? '' : `ondblclick="wzRenameZone(${z.id}, this)"`}>
          ${showingInTyped ? '<span style="color:#8b5cf6;font-size:10px;margin-right:4px;">&#127760;</span>' : ""}${WZ._esc(z.name)}</span>
        ${_badge}
        <span class="wz-zone-meta">${z.created_at ? (window.fmtDateOnly ? window.fmtDateOnly(z.created_at) : z.created_at.slice(0,10)) : ""}</span>
        <span class="badge ${z.active ? 'badge-green' : 'badge-red'}" style="cursor:pointer;" title="${t('wz_tt_toggle','Enable/Disable')}" onclick="event.stopPropagation();wzToggleZone(${z.id})">${z.active ? t('wz_active','Active') : t('wz_inactive','Inactive')}</span>
        <div class="wz-zone-actions" onclick="event.stopPropagation()">
          ${showingInTyped
            ? `<button title="${t('wz_fetch_live','Fetch live data')}" onclick="wzOpenLive(${z.id},'${panel}')"
                  style="background:var(--accent1);color:#fff;border-radius:6px;padding:4px 14px;font-size:12px;font-weight:600;">
                ${_btnLabel}</button>`
            : (isGlobal
              ? ``
              : `<button title="${t('wz_fetch_live','Fetch live data')}" onclick="wzOpenLive(${z.id})"
                  style="background:var(--accent1);color:#fff;border-radius:6px;padding:4px 14px;font-size:12px;font-weight:600;">
                ${_btnLabel}</button>
               ${_extraBtns}`)}
          ${showingInTyped
            ? `<button title="${t('wz_tt_edit_global','Only editable under Global Zones')}" onclick="alert(t('wz_edit_global_hint','This zone is a global zone and can only be edited under \\u0022Global Zones\\u0022.'))" style="cursor:not-allowed;background:none;border:none;color:var(--muted);opacity:.35;padding:5px;border-radius:5px;display:inline-flex;align-items:center;justify-content:center;"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 2.5l2 2L5 13H3v-2L11.5 2.5z"/></svg></button>`
            : `<button title="${t('wz_tt_edit','Edit')}" onclick="wzEditZone(${z.id},'${z.zone_type}')" style="cursor:pointer;background:none;border:none;color:var(--muted);padding:5px;border-radius:5px;display:inline-flex;align-items:center;justify-content:center;transition:background .1s,color .1s;" onmouseover="this.style.background='rgba(59,130,246,.1)';this.style.color='var(--accent1)'" onmouseout="this.style.background='none';this.style.color='var(--muted)'"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 2.5l2 2L5 13H3v-2L11.5 2.5z"/></svg></button>`}
          ${showingInTyped
            ? `<button title="${t('wz_tt_delete_global','Only deletable under Global Zones')}" onclick="alert(t('wz_delete_global_hint','This zone is a global zone and can only be deleted under \\u0022Global Zones\\u0022.'))" style="cursor:not-allowed;background:none;border:none;color:var(--muted);opacity:.35;padding:5px;border-radius:5px;display:inline-flex;align-items:center;justify-content:center;"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,4.5 13,4.5"/><path d="M6.5 4.5V3h3v1.5"/><rect x="4.5" y="4.5" width="7" height="9" rx="1"/><line x1="6.5" y1="7" x2="6.5" y2="11"/><line x1="9.5" y1="7" x2="9.5" y2="11"/></svg></button>`
            : `<button title="${t('wz_tt_delete','Delete')}" onclick="wzDeleteZone(${z.id})" style="cursor:pointer;background:none;border:none;color:rgba(239,68,68,.6);padding:5px;border-radius:5px;display:inline-flex;align-items:center;justify-content:center;transition:background .1s,color .1s;" onmouseover="this.style.background='rgba(239,68,68,.1)';this.style.color='#ef4444'" onmouseout="this.style.background='none';this.style.color='rgba(239,68,68,.6)'"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,4.5 13,4.5"/><path d="M6.5 4.5V3h3v1.5"/><rect x="4.5" y="4.5" width="7" height="9" rx="1"/><line x1="6.5" y1="7" x2="6.5" y2="11"/><line x1="9.5" y1="7" x2="9.5" y2="11"/></svg></button>`}
        </div>
      </div>`;
    }).join("");
  }

  WZ._esc = function(s) {
    const d = document.createElement("div");
    d.textContent = s || "";
    return d.innerHTML;
  }

  async function _saveNewZone(panel, layer) {
    var geo;
    try { geo = layer.toGeoJSON().geometry; } catch(e) { console.error("GeoJSON error:", e); return; }
    var name;
    try { name = prompt(t('wz_zone_name_prompt','Observation zone name:'), t('wz_zone_name_default','New Zone')); } catch(e) { console.error("Prompt error:", e); return; }
    if (name === null) {
      // Cancel gedrückt → gezeichnete Zone entfernen
      const map = _maps[panel];
      if (map) map.eachLayer(l => { if (l === layer) map.removeLayer(l); });
      return;
    }
    const zoneName = name.trim() || "Neue Zone";
    const projectId = document.getElementById("hdr-wz-project")?.value || null;
    try {
      const r = await fetch("/api/watchzones", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          name: zoneName,
          zone_type: panel,
          geometry: geo,
          config: { source: _pluginCfg(panel).default_source || panel },
          project_id: projectId ? parseInt(projectId) : null,
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

  window.wzFocusZone = function(id, panelOverride) {
    const z = WZ._zones.find(z => z.id === id);
    if (!z || !z.geometry) return;
    const map = _maps[panelOverride || z.zone_type];
    if (!map) return;
    try {
      const layer = L.geoJSON(z.geometry);
      map.fitBounds(layer.getBounds(), { padding: [40, 40], maxZoom: 12 });
    } catch(e) {}
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
        row.style.outline = "2px solid var(--accent1)";
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
    bar.style.cssText = "display:flex;align-items:center;gap:8px;padding:8px 16px;background:color-mix(in srgb, var(--accent1) 12%, var(--surface));border:1px solid var(--accent1);border-radius:8px;margin:8px 20px;";
    bar.innerHTML = `
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="var(--accent1)" stroke-width="1.5"><path d="M11.5 2.5l2 2L5 13H3v-2L11.5 2.5z"/></svg>
      <span style="flex:1;font-size:12px;font-weight:600;color:var(--accent1);">${t('wz_editing_zone','Editing zone — drag handles to reshape')}</span>
      <button onclick="wzEditSave('${panel}')" style="background:var(--accent1);color:#fff;border:none;border-radius:6px;padding:5px 16px;font-size:12px;font-weight:600;cursor:pointer;">${t('wz_edit_save','Save')}</button>
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
      if (!isSuper && _allProjects.length) sel.value = _allProjects[0].id;
      console.log("WZ _loadProjects: dropdown value =", sel.value, ", options =", sel.options.length);
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

  window.wzOpenLive = function(zoneId, asType) {
    WZ._liveZoneId = zoneId;
    WZ._liveAsType = asType || null;
    const z = WZ._zones.find(z => z.id === zoneId);
    if (!z) return;

    const effectiveType = asType || z.zone_type;
    const _cfg = _pluginCfg(effectiveType);

    // Strategy: "preload" — Daten im Hintergrund laden, dann Popup zeigen (z.B. Satellit)
    if (_cfg.openStrategy === "preload") {
      const loadOv = document.getElementById("wz-loading-overlay");
      document.getElementById("wz-loading-text").textContent =
        t(_cfg.live_title_i18n, _cfg.live_title_prefix) + ' \u201c' + (z.name || 'Zone') + '\u201d \u2026';
      loadOv.style.display = "flex";
      WZ._fetchLiveData(zoneId).then(() => {
        loadOv.style.display = "none";
        const overlay = document.getElementById("wz-live-overlay");
        overlay.style.display = "flex";
        document.getElementById("wz-live-box").style.maxWidth = _cfg.live_box_max_width;
        document.getElementById("wz-live-title").textContent =
          t(_cfg.live_title_i18n, _cfg.live_title_prefix) + " " + (z.name || "Zone");
        document.getElementById("wz-live-loading").style.display = "none";
        document.getElementById("wz-live-content").style.display = "block";
        const heatBtn = document.getElementById("wz-heatmap-btn");
        if (heatBtn) heatBtn.style.display = "none";
        // Inhalt rendern
        const renderer = WZ._renderers[effectiveType];
        if (WZ._lastSatData && renderer) renderer(WZ._lastSatData);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            _initLiveMap(z);
            if (WZ._satLiveMapOverlay) WZ._satLiveMapOverlay();
            setTimeout(() => { if (WZ._liveMap) WZ._liveMap.invalidateSize(); }, 300);
          });
        });
      }).catch((e) => {
        loadOv.style.display = "none";
        alert(t('wz_load_error_prefix','Error loading:') + " " + (e.message || e));
      });
      return;
    }

    const overlay = document.getElementById("wz-live-overlay");
    const liveBox = document.getElementById("wz-live-box");
    const spinner = document.getElementById("wz-live-spinner");
    overlay.style.display = "flex";

    // Strategy: "spinner" — Spinner zeigen, Box im Hintergrund vorbereiten (z.B. Website/Wayback)
    if (_cfg.openStrategy === "spinner") {
      liveBox.style.display = "none";
      spinner.style.display = "flex";
      document.getElementById("wz-live-spinner-text").textContent =
        t(_cfg.live_title_i18n, _cfg.live_title_prefix) + ' \u2013 ' + (z.name || (z.config && z.config.url) || "Zone") + " \u2026";
      _wzTracerouteStop();
      _wzTracerouteZoneId = null;
      WZ._wzWebsiteHistPromise = null;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          liveBox.style.maxWidth = _cfg.live_box_max_width;
          if (_cfg.live_box_height) { liveBox.style.height = _cfg.live_box_height; liveBox.style.maxHeight = _cfg.live_box_height; }
          document.getElementById("wz-live-title").textContent = t(_cfg.live_title_i18n, _cfg.live_title_prefix) + " " + (z.name || "Zone");
          document.getElementById("wz-live-count").textContent = "";
          document.getElementById("wz-live-error").style.display = "none";
          document.getElementById("wz-live-content").style.display = "block";
          document.getElementById("wz-live-loading").style.display = "none";
          document.getElementById("wz-map-row").style.display = "none";
          document.getElementById("wz-live-body").style.display = "flex";
          document.getElementById("wz-resize-map").style.display = "none";
          const underMapBar = document.getElementById("wz-under-map-bar");
          if (underMapBar) underMapBar.style.display = "none";
          const renderer = WZ._renderers[effectiveType];
          if (renderer) renderer({ zone_id: zoneId, count: null, items: [] });
        });
      });
      return;
    }

    // Default strategy — Popup sofort zeigen, Daten laden
    liveBox.style.display = "";
    spinner.style.display = "none";
    liveBox.style.maxWidth = _cfg.live_box_max_width;
    var _h = _cfg.live_box_height || "95vh";
    liveBox.style.height = _h; liveBox.style.maxHeight = _h;
    document.getElementById("wz-live-title").textContent = t(_cfg.live_title_i18n, _cfg.live_title_prefix) + " " + (z.name || "Zone");
    document.getElementById("wz-live-count").textContent = "";
    document.getElementById("wz-live-loading").style.display = "block";
    document.getElementById("wz-live-error").style.display = "none";
    document.getElementById("wz-live-content").style.display = "none";
    const _showMap = _cfg.has_live_map !== false;
    document.getElementById("wz-map-row").style.display = _showMap ? "flex" : "none";
    document.getElementById("wz-live-body").style.display = "flex";
    document.getElementById("wz-resize-map").style.display = _showMap ? "" : "none";
    const underMapBar = document.getElementById("wz-under-map-bar");
    if (underMapBar) underMapBar.style.display = "none";
    _wzTracerouteStop();
    _wzTracerouteZoneId = null;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try { _initLiveMap(z); } catch(e) { console.warn("_initLiveMap:", e); }
        WZ._fetchLiveData(zoneId);
        setTimeout(() => { if (WZ._liveMap) WZ._liveMap.invalidateSize(); }, 300);
      });
    });
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
    WZ._liveZoneId = zoneId;
    WZ._liveAsType = null;
    const z = WZ._zones.find(z => z.id === zoneId);
    if (!z) return;

    _wsInjectElements();
    const overlay = document.getElementById("wz-live-overlay");
    overlay.style.display = "flex";
    const liveBox = document.getElementById("wz-live-box");
    liveBox.style.maxWidth = "1400px";
    liveBox.style.height = "90vh";
    liveBox.style.maxHeight = "90vh";
    document.getElementById("wz-live-title").textContent = t('wz_live_prefix_server','Server:') + " " + (z.name || "Zone");
    document.getElementById("wz-live-count").textContent = "";
    // Karte zeigen, Wayback-Body ausblenden
    const mapRow = document.getElementById("wz-map-row");
    mapRow.style.display = "flex";
    mapRow.style.flex = "1";
    mapRow.style.minHeight = "0";
    document.getElementById("wz-live-body").style.display = "none";
    // Traceroute-Bar einblenden
    const underMapBar = document.getElementById("wz-under-map-bar");
    if (underMapBar) underMapBar.style.display = "flex";
    _wzTracerouteZoneId = zoneId;
    _wzTrHistBtnUpdate(zoneId);

    // Karte + Trace-Panel füllen den gesamten verfügbaren Platz via Flex
    liveBox.classList.add("wz-map-fill");
    mapRow.style.flex = "1";
    mapRow.style.minHeight = "0";
    mapRow.style.height = "";
    const mapEl = document.getElementById("wz-live-map");
    mapEl.style.height = "100%";
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
    if (b) { b.innerHTML = '<svg width="16" height="16" viewBox="0 0 18 18" fill="white" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0"><polygon points="4,2 16,9 4,16"/></svg><span>×1000</span>'; b.style.background = 'var(--accent1)'; b.disabled = false; }
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
            if (b2) { b2.innerHTML = '<svg width="16" height="16" viewBox="0 0 18 18" fill="white" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0"><polygon points="4,2 16,9 4,16"/></svg><span>×1000</span>'; b2.style.background = 'var(--accent1)'; }
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
    if (btn) { btn.innerHTML = "&#x25B6; Traceroute"; btn.style.background = "var(--accent1)"; btn.style.borderColor = "var(--accent1)"; btn.style.color = "#fff"; }
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
      <div style="position:relative;width:48px;height:48px;">
        <div style="position:absolute;inset:0;border:3px solid rgba(124,58,237,.15);border-radius:50%;"></div>
        <div style="position:absolute;inset:0;border:3px solid transparent;border-top-color:var(--accent1);border-radius:50%;animation:wz-spin .75s linear infinite;"></div>
        <div style="position:absolute;inset:8px;border:2px solid transparent;border-top-color:rgba(124,58,237,.45);border-radius:50%;animation:wz-spin .5s linear infinite reverse;"></div>
      </div>
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
          else { btn.style.background = "var(--accent1)"; btn.style.borderColor = ""; }
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
      if (btn) { btn.innerHTML = "&#x25B6; Traceroute"; btn.disabled = false; btn.style.opacity = ""; btn.style.cursor = ""; btn.style.background = "var(--accent1)"; btn.style.borderColor = "var(--accent1)"; btn.style.color = "#fff"; }
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
        s += `<line x1="${x}" y1="${MT}" x2="${x}" y2="${MT+plotH}" stroke="${hasBr?'var(--accent1)':'rgba(255,255,255,0.2)'}" stroke-width="${hasBr?'2':'1.5'}"/>`;
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
          s += `<rect id="wz-brush-${ax.key}" x="${xn-8}" y="${by0.toFixed(1)}" width="16" height="${(by1-by0).toFixed(1)}" fill="rgba(124,58,237,0.28)" stroke="var(--accent1)" stroke-width="1.5" rx="2" pointer-events="none"/>`;
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
          Object.entries({y1:MT-10, y2:MT+plotH, stroke:'var(--accent1)', 'stroke-width':'2',
            'stroke-dasharray':'5,3', opacity:'0.85', 'pointer-events':'none'}).forEach(([k,v])=>ghost.setAttribute(k,v));
          const gx = axX(ai).toFixed(1); ghost.setAttribute('x1',gx); ghost.setAttribute('x2',gx);
          svg.appendChild(ghost);
          // Drop target indicator
          const dropMark = document.createElementNS(ns,'line');
          Object.entries({y1:MT-10, y2:MT+plotH, stroke:'var(--accent1)', 'stroke-width':'3',
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
          rect.setAttribute('stroke','var(--accent1)'); rect.setAttribute('stroke-width','1.5');
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

  window.wzCloseLive = function() {
    // Nativen Fullscreen beenden falls aktiv
    var _fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (_fsEl) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    }
    _wzTracerouteStop();
    // Plugin-spezifische Aufräumarbeiten (verschiebt Elemente zurück in den Store)
    WZ._onLiveClose.forEach(function(fn) { fn(); });
    _wsReturnToStore();
    // Sichtbarkeit zurücksetzen für nächste Nutzung
    const mapRow = document.getElementById("wz-map-row");
    mapRow.style.display = "flex";
    mapRow.style.flex = "";
    mapRow.style.minHeight = "";
    mapRow.style.height = "";
    document.getElementById("wz-live-map").style.height = "clamp(200px,42vh,560px)";
    document.getElementById("wz-live-body").style.display = "flex";
    document.getElementById("wz-resize-map").style.display = "";
    const lb = document.getElementById("wz-live-box");
    lb.classList.remove("wz-map-fill");
    lb.style.height = "95vh";
    lb.style.maxHeight = "95vh";
    lb.style.maxWidth = "1400px";
    lb.style.width = "96%";
    document.getElementById("wz-live-overlay").style.display = "none";
    const _sp2 = document.getElementById("wz-live-spinner");
    const _bx2 = document.getElementById("wz-live-box");
    if (_sp2) _sp2.style.display = "none";
    if (_bx2) _bx2.style.display = "flex";
    const _stickyEl = document.getElementById("wz-live-sticky");
    if (_stickyEl) { _stickyEl.style.display = "none"; _stickyEl.innerHTML = ""; }
    const _umBar = document.getElementById("wz-under-map-bar");
    if (_umBar) _umBar.style.display = "none";
    if (WZ._liveMap) {
      WZ._liveMap.remove();
      WZ._liveMap = null;
    }
    WZ._liveZoneId = null;
  };


  function _initLiveMap(zone) {
    const el = document.getElementById("wz-live-map");
    if (WZ._liveMap) { WZ._liveMap.remove(); WZ._liveMap = null; }
    WZ._liveZoneTimeLabel = null;

    const isDark = document.documentElement.getAttribute("data-theme") !== "light";
    const tileUrl = isDark
      ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";

    WZ._liveMap = L.map(el, { zoomControl: false }).setView([48.2, 11.8], 5);
    L.control.zoom({ position: 'topright' }).addTo(WZ._liveMap);
    L.tileLayer(tileUrl, { maxZoom: 18 }).addTo(WZ._liveMap);
    L.control.scale({ metric: true, imperial: false, position: 'topright' }).addTo(WZ._liveMap);
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
        z-index:1000;background:var(--accent1);border:none;border-radius:999px;color:#fff;
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
    const liveOverlay = document.getElementById("wz-live-overlay");
    const isSatPreload = liveOverlay.style.display === "none";
    const zoneType = (WZ._zones.find(z => z.id === zoneId) || {}).zone_type;
    const _fetchCfg = _pluginCfg(zoneType);
    const skipLoadingIndicator = isSatPreload || _fetchCfg.skip_loading_indicator;
    if (!skipLoadingIndicator) {
      document.getElementById("wz-live-loading").style.display = "block";
      document.getElementById("wz-live-error").style.display = "none";
      document.getElementById("wz-live-content").style.display = "none";
    } else if (!isSatPreload) {
      document.getElementById("wz-live-loading").style.display = "none";
      document.getElementById("wz-live-error").style.display = "none";
      document.getElementById("wz-live-content").style.display = "block";
    }

    try {
      const liveUrl = "/api/watchzones/" + zoneId + "/live" + (WZ._liveAsType ? "?as_type=" + WZ._liveAsType : "");
      const r = await fetch(liveUrl);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Fehler " + r.status);

      const _liveCfg = _pluginCfg(data.zone_type);
      // Reset module state via callbacks
      WZ._onLiveReset.forEach(function(fn) { fn(); });

      // Preload-Strategie: Daten speichern für späteres Overlay
      if (_liveCfg.openStrategy === "preload") WZ._lastSatData = data;
      // Dispatch to registered renderer (injiziert Plugin-Elemente in den Popup)
      const renderer = WZ._renderers[data.zone_type];
      if (renderer) {
        if (_liveCfg.openStrategy === "preload" && isSatPreload) {
          // Skip rendering during preload
        } else {
          renderer(data);
        }
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
        document.getElementById("wz-live-loading").style.display = "none";
        document.getElementById("wz-live-content").style.display = "block";
      }
    } catch(e) {
      console.error("WZ._fetchLiveData Fehler:", e);
      if (!skipLoadingIndicator) {
        document.getElementById("wz-live-loading").style.display = "none";
        const errEl = document.getElementById("wz-live-error");
        errEl.style.display = "block";
        errEl.textContent = e.message || t('wz_unknown_error','Unknown error');
      } else {
        // Website/Sat-Preload: Fehler sichtbar machen
        document.getElementById("wz-live-loading").style.display = "none";
        const errEl = document.getElementById("wz-live-error");
        if (errEl) { errEl.style.display = "block"; errEl.textContent = e.message || t('wz_load_error_prefix','Error loading:'); }
      }
    }
  }

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

    document.addEventListener("mousemove", function(e) {
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
    });

    document.addEventListener("mouseup", function() {
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
    });
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
