/**
 * WZ Module: aircraft renderer, 3D, projection, heatmap, distance, parallel coords.
 */
(function() {
"use strict";
var WZ = window.WZ;

  // ── Plugin-Elemente aus dem Store in den Popup verschieben ──────────────
  function _acInjectElements() {
    var store = document.getElementById("wz-plugin-store");
    if (!store) return;
    var header = document.getElementById("wz-live-header");
    var fsBtn = document.getElementById("wz-live-fs-btn");
    // Header-Buttons (Projection, Heatmap) vor den Fullscreen-Button
    var projBtn = document.getElementById("wz-projection-btn");
    if (projBtn && projBtn.parentNode === store) header.insertBefore(projBtn, fsBtn);
    var heatBtn = document.getElementById("wz-heatmap-btn");
    if (heatBtn && heatBtn.parentNode === store) header.insertBefore(heatBtn, fsBtn);
    // Refresh-Bar nach dem Header
    var refreshBar = document.getElementById("wz-refresh-bar");
    if (refreshBar && refreshBar.parentNode === store) header.parentNode.insertBefore(refreshBar, header.nextSibling);
    // Seitenpanels in die Map-Row
    var mapRow = document.getElementById("wz-map-row");
    var proxPanel = document.getElementById("wz-proximity-panel");
    if (proxPanel && proxPanel.parentNode === store) mapRow.appendChild(proxPanel);
    var projPanel = document.getElementById("wz-projection-panel");
    if (projPanel && projPanel.parentNode === store) mapRow.appendChild(projPanel);
    // ParCoords + Resize-Handle nach wz-resize-map
    var resizeMap = document.getElementById("wz-resize-map");
    var pcInline = document.getElementById("wz-parcoords-inline");
    if (pcInline && pcInline.parentNode === store) resizeMap.parentNode.insertBefore(pcInline, resizeMap.nextSibling);
    var pcResize = document.getElementById("wz-resize-parcoords");
    if (pcResize && pcResize.parentNode === store) {
      var afterPc = pcInline.nextSibling;
      pcInline.parentNode.insertBefore(pcResize, afterPc);
    }
  }

  function _acReturnToStore() {
    var store = document.getElementById("wz-plugin-store");
    if (!store) return;
    ["wz-projection-btn","wz-heatmap-btn","wz-refresh-bar",
     "wz-proximity-panel","wz-projection-panel",
     "wz-parcoords-inline","wz-resize-parcoords"].forEach(function(id) {
      var el = document.getElementById(id);
      if (el && el.parentNode !== store) store.appendChild(el);
    });
  }

  // ── Flugzeuge rendern ──────────────────────────────────────────────────
  function _renderAircraftLive(data) {
    _acInjectElements();
    const items = data.items || [];
    WZ._liveAircraftItems = items;
    const anomCount = items.filter(a => a.anomaly_score > 0).length;
    document.getElementById("wz-live-count").textContent =
      items.length + " aircraft" + (anomCount ? ` · ${anomCount} anomalies` : "");
    if (WZ._liveMarkers) WZ._liveMarkers.clearLayers();
    _acMarkerByIdx = [];
    // 3D-Button einblenden
    const _btn3d = document.getElementById('wz-3d-btn');
    if (_btn3d) _btn3d.style.display = items.length ? 'block' : 'none';
    // 3D-View aktualisieren falls aktiv
    _wzUpdate3DEntities();

    items.forEach((a, idx) => {
      const color = WZ._anomalyColor(a.anomaly_score || 0);
      const size = a.anomaly_score >= 30 ? 24 : a.anomaly_score >= 15 ? 21 : 18;
      const icon = L.divIcon({
        className: "",
        html: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" style="transform:rotate(${a.heading || 0}deg);filter:drop-shadow(0 1px 2px rgba(0,0,0,.5));cursor:pointer;">
          <path d="M12 2 L16 20 L12 16 L8 20 Z" fill="${color}" stroke="rgba(0,0,0,.3)" stroke-width=".5"/>
        </svg>`,
        iconSize: [size, size],
        iconAnchor: [size/2, size/2],
      });
      const m = L.marker([a.lat, a.lon], { icon: icon, _origIcon: icon, _origSize: size, _origColor: color, _heading: a.heading || 0 });
      _acMarkerByIdx[idx] = m;
      const alt = a.alt_m != null ? Math.round(a.alt_m) + " m" : "–";
      const spd = a.velocity != null ? Math.round(a.velocity * 3.6) + " km/h" : "–";
      let popupHtml =
        `<strong>${WZ._esc(a.callsign || a.icao24)}</strong>${WZ._anomalyBadge(a.anomaly_score)}<br>` +
        `${WZ._esc(a.desc || a.type)}<br>` +
        `Alt: ${alt} · Speed: ${spd}<br>`;
      if (a.anomaly_flags && a.anomaly_flags.length) {
        popupHtml += `<span style="color:#ef4444;font-size:11px;">⚠ ${a.anomaly_flags.join(", ")}</span><br>`;
      }
      popupHtml += `<a href="#" onclick="event.preventDefault();wzShowAircraftDetail(${idx})" style="font-size:11px;">${t('wz_show_details_arrow','Show details \u2192')}</a>`;
      m.bindPopup(popupHtml, { maxWidth: 280 });
      if (WZ._liveMarkers) WZ._liveMarkers.addLayer(m);
    });

    if (WZ._liveMap && WZ._liveMarkers && WZ._liveMarkers.getLayers().length) {
      WZ._liveMap.fitBounds(WZ._liveMarkers.getBounds(), { padding: [30, 30], maxZoom: 12 });
    }
    WZ._updateZoneTimeLabel(items);

    // Tabelle
    const content = document.getElementById("wz-live-content");
    if (!items.length) {
      content.innerHTML = `<p style="color:var(--muted);text-align:center;padding:12px;">${t('wz_aircraft_empty','No aircraft found in this zone.')}</p>`;
      return;
    }
    // Sticky-Header: Button + Tabellenkopf außerhalb des Scrollbereichs
    const stickyEl = document.getElementById("wz-live-sticky");
    stickyEl.innerHTML = `
      <div style="display:flex;align-items:center;padding:6px 8px 4px;gap:10px;">
        <button data-parcoords-btn onclick="wzToggleParCoords()" style="background:var(--accent1);color:#fff;border:none;border-radius:6px;
          padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:6px;">
          ${t('wz_aircraft_analyse','⫼ Analyse Air Traffic')}
        </button>
        <span id="wz-ac-count" style="font-size:12px;color:var(--muted);">${items.length} ${t('wz_aircraft_count_zone','aircraft in zone')}</span>
      </div>
      <table style="width:100%;font-size:12px;border-collapse:collapse;table-layout:fixed;">
        <colgroup>
          <col style="width:44px;"><col style="width:72px;"><col style="width:90px;"><col style="width:70px;">
          <col style="width:56px;"><col style="width:72px;"><col style="width:70px;"><col style="width:82px;">
          <col style="width:50px;"><col>
        </colgroup>
        <thead><tr style="border-bottom:2px solid var(--border);color:var(--muted);text-align:left;">
          <th style="padding:6px 8px;">Score</th>
          <th style="padding:6px 8px;">${t('wz_aircraft_th_usage','Usage')}</th>
          <th style="padding:6px 8px;">${t('wz_aircraft_th_callsign','Callsign')}</th>
          <th style="padding:6px 8px;">${t('wz_aircraft_th_country','Country')}</th>
          <th style="padding:6px 8px;">Type</th>
          <th style="padding:6px 8px;">Reg.</th>
          <th style="padding:6px 8px;">${t('wz_aircraft_th_alt','Alt.')}</th>
          <th style="padding:6px 8px;">${t('wz_aircraft_th_speed','Speed')}</th>
          <th style="padding:6px 8px;">${t('wz_aircraft_th_hdg','Hdg.')}</th>
          <th style="padding:6px 8px;">${t('wz_aircraft_th_anomalies','Anomalies')}</th>
        </tr></thead>
      </table>`;
    stickyEl.style.display = "";

    // Im Fullscreen-Side-by-Side: Button ausblenden, ParCoords auto-öffnen
    if (WZ._fsSideBySide) {
      const pcBtn = stickyEl.querySelector("[data-parcoords-btn]");
      if (pcBtn) pcBtn.style.display = "none";
      if (!WZ._parCoordsOpen) setTimeout(() => wzShowParallelCoords(), 50);
    }

    content.innerHTML = `
      <table style="width:100%;font-size:12px;border-collapse:collapse;table-layout:fixed;">
        <colgroup>
          <col style="width:44px;"><col style="width:72px;"><col style="width:90px;"><col style="width:70px;">
          <col style="width:56px;"><col style="width:72px;"><col style="width:70px;"><col style="width:82px;">
          <col style="width:50px;"><col>
        </colgroup>
        <tbody>${items.map((a, idx) => {
          const sc = a.anomaly_score || 0;
          const rowBg = sc >= 30 ? "rgba(239,68,68,.12)" : sc >= 15 ? "rgba(249,115,22,.08)" : sc >= 5 ? "rgba(234,179,8,.06)" : "";
          return `
          <tr style="border-bottom:1px solid var(--border);background:${rowBg};cursor:pointer;"
              onclick="wzShowAircraftDetail(${idx})" title="${t('wz_show_details','Show details')}"
              onmouseenter="wzHighlightMarker(${idx})" onmouseleave="wzUnhighlightMarker(${idx})">
            <td style="padding:5px 8px;text-align:center;">${WZ._anomalyBadge(sc) || '<span style="color:var(--muted);">–</span>'}</td>
            <td style="padding:5px 8px;text-align:center;">${WZ._usageBadge(a.usage)}</td>
            <td style="padding:5px 8px;font-weight:600;">${WZ._esc(a.callsign || "–")}</td>
            <td style="padding:5px 8px;font-size:11px;">${WZ._esc(a.country || "–")}</td>
            <td style="padding:5px 8px;font-size:11px;color:var(--muted);">${WZ._esc(a.type || "–")}</td>
            <td style="padding:5px 8px;font-size:11px;">${WZ._esc(a.reg || "–")}</td>
            <td style="padding:5px 8px;">${a.alt_m != null ? Math.round(a.alt_m) + " m" : "–"}</td>
            <td style="padding:5px 8px;">${a.velocity != null ? Math.round(a.velocity * 3.6) + " km/h" : "–"}</td>
            <td style="padding:5px 8px;">${a.heading != null ? Math.round(a.heading) + "°" : "–"}</td>
            <td style="padding:5px 8px;font-size:11px;color:#ef4444;max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
                title="${WZ._esc((a.anomaly_flags||[]).join(', '))}">${a.anomaly_flags && a.anomaly_flags.length ? WZ._esc(a.anomaly_flags.join(", ")) : '<span style="color:var(--muted);">–</span>'}</td>
          </tr>`;
        }).join("")}
        </tbody>
      </table>`;
    // ── Auto-Kollisionscheck beim Laden ──────────────────────────────────
    setTimeout(() => _autoCollisionCheck(items), 100);
  }

  // Automatischer Kollisionswarnung auf der Karte
  let _autoCollisionPopups = [];

  function _autoCollisionCheck(items) {
    // Alte Popups entfernen
    _autoCollisionPopups.forEach(p => { if (WZ._liveMap) WZ._liveMap.removeLayer(p); });
    _autoCollisionPopups = [];
    if (!items || items.length < 2 || !WZ._liveMap) return;

    // Nur Flugzeuge mit Navigationsdaten
    const ac = items.filter(a =>
      a.lat != null && a.lon != null && a.velocity != null && a.heading != null
    );
    if (ac.length < 2) return;

    // Kollisionen über 1 Stunde berechnen (nutzt bestehende Funktion)
    const collisions = _projFindCollisions(ac);
    // Nur kritische Annäherungen < 100m
    const critical = collisions.filter(c => c.dist3dKm < 0.1);
    if (!critical.length) return;

    critical.forEach(c => {
      // Kollisionspunkt berechnen
      const posA = _projCalcPos(c.a.lat, c.a.lon, c.a.heading, c.a.velocity * c.t);
      const posB = _projCalcPos(c.b.lat, c.b.lon, c.b.heading, c.b.velocity * c.t);
      const midLat = (posA.lat + posB.lat) / 2;
      const midLon = (posA.lon + posB.lon) / 2;

      const nameA = c.a.callsign || c.a.icao24 || "?";
      const nameB = c.b.callsign || c.b.icao24 || "?";
      const distM = Math.round(c.dist3dKm * 1000);
      const tMin = Math.floor(c.t / 60);
      const tSec = c.t % 60;
      const tLabel = tMin > 0
        ? `${tMin} min${tSec ? " " + tSec + " s" : ""}`
        : `${tSec} s`;

      // Countdown-Popup auf der Karte
      const popup = L.popup({
        closeButton: true,
        autoClose: false,
        closeOnClick: false,
        className: "wz-collision-popup",
        offset: [0, -5],
      })
        .setLatLng([midLat, midLon])
        .setContent(
          `<div data-collision-zoom data-cz-a-lat="${c.a.lat}" data-cz-a-lon="${c.a.lon}"
                data-cz-b-lat="${c.b.lat}" data-cz-b-lon="${c.b.lon}"
                style="background:#dc2626;color:#fff;padding:8px 12px;border-radius:8px;font-family:sans-serif;
                min-width:180px;box-shadow:0 4px 16px rgba(220,38,38,.5);cursor:pointer;">
            <div style="font-size:13px;font-weight:800;margin-bottom:4px;">⚠ COLLISION RISK</div>
            <div style="font-size:12px;font-weight:600;margin-bottom:2px;">${WZ._esc(nameA)} ↔ ${WZ._esc(nameB)}</div>
            <div style="font-size:11px;opacity:.9;" data-collision-dist data-col-t="${c.t}"
                 data-col-a-lat="${c.a.lat}" data-col-a-lon="${c.a.lon}" data-col-a-hdg="${c.a.heading}"
                 data-col-a-vel="${c.a.velocity}" data-col-a-alt="${c.a.alt_m||0}"
                 data-col-b-lat="${c.b.lat}" data-col-b-lon="${c.b.lon}" data-col-b-hdg="${c.b.heading}"
                 data-col-b-vel="${c.b.velocity}" data-col-b-alt="${c.b.alt_m||0}">~${distM} m · Δ${Math.round(c.dAltM)} m alt</div>
            <div style="font-size:14px;font-weight:800;margin-top:4px;" data-collision-countdown="${c.t}">T−${tLabel}</div>
          </div>`
        )
        .openOn(WZ._liveMap);

      // openOn schließt andere Popups → addTo verwenden für mehrere
      if (_autoCollisionPopups.length > 0) {
        popup.remove();
        popup.addTo(WZ._liveMap);
      }
      _autoCollisionPopups.push(popup);
    });

    // Klick auf Collision-Banner → auf die beiden Maschinen zoomen
    if (!WZ._collisionClickBound) {
      WZ._collisionClickBound = true;
      document.addEventListener("click", function(e) {
        var el = e.target.closest("[data-collision-zoom]");
        if (!el || !WZ._liveMap) return;
        var aLat = parseFloat(el.getAttribute("data-cz-a-lat"));
        var aLon = parseFloat(el.getAttribute("data-cz-a-lon"));
        var bLat = parseFloat(el.getAttribute("data-cz-b-lat"));
        var bLon = parseFloat(el.getAttribute("data-cz-b-lon"));
        WZ._liveMap.fitBounds([[aLat, aLon], [bLat, bLon]],
          { padding: [60, 60], maxZoom: 14, animate: true, duration: 0.7 });
      });
    }

    // Countdown + Live-Distanz aktualisieren (jede Sekunde)
    if (WZ._collisionCountdownInterval) clearInterval(WZ._collisionCountdownInterval);
    const startTime = Date.now();
    WZ._collisionCountdownInterval = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      const els = document.querySelectorAll("[data-collision-countdown]");
      if (!els.length) { clearInterval(WZ._collisionCountdownInterval); return; }
      // Countdown aktualisieren
      els.forEach(el => {
        const tCollision = parseFloat(el.getAttribute("data-collision-countdown"));
        const remaining = Math.max(0, tCollision - elapsed);
        if (remaining <= 0) {
          el.textContent = "⚠ NOW";
          el.style.color = "#fbbf24";
          return;
        }
        const m = Math.floor(remaining / 60);
        const s = Math.round(remaining % 60);
        el.textContent = "T−" + (m > 0 ? m + " min " : "") + s + " s";
      });
      // Live-Distanz berechnen: projizierte Position zum aktuellen Zeitpunkt
      document.querySelectorAll("[data-collision-dist]").forEach(el => {
        const aLat = parseFloat(el.getAttribute("data-col-a-lat"));
        const aLon = parseFloat(el.getAttribute("data-col-a-lon"));
        const aHdg = parseFloat(el.getAttribute("data-col-a-hdg"));
        const aVel = parseFloat(el.getAttribute("data-col-a-vel"));
        const aAlt = parseFloat(el.getAttribute("data-col-a-alt"));
        const bLat = parseFloat(el.getAttribute("data-col-b-lat"));
        const bLon = parseFloat(el.getAttribute("data-col-b-lon"));
        const bHdg = parseFloat(el.getAttribute("data-col-b-hdg"));
        const bVel = parseFloat(el.getAttribute("data-col-b-vel"));
        const bAlt = parseFloat(el.getAttribute("data-col-b-alt"));
        // elapsed = Echtzeit-Sekunden → projizierte Sim-Sekunden (synchron zum Countdown)
        const tCollision = parseFloat(el.getAttribute("data-col-t"));
        const simElapsed = Math.min(elapsed, tCollision);
        const posA = _projCalcPos(aLat, aLon, aHdg, aVel * simElapsed);
        const posB = _projCalcPos(bLat, bLon, bHdg, bVel * simElapsed);
        const horizKm = WZ._haversineKm(posA.lat, posA.lon, posB.lat, posB.lon);
        const dAltKm = Math.abs(aAlt - bAlt) / 1000;
        const dist3dM = Math.round(Math.sqrt(horizKm * horizKm + dAltKm * dAltKm) * 1000);
        const dAltM = Math.round(Math.abs(aAlt - bAlt));
        el.textContent = "~" + dist3dM + " m · Δ" + dAltM + " m alt";
      });
    }, 1000);
  }

  // Cleanup bei Live-Schließen
  WZ._onLiveClose.push(function() {
    _autoCollisionPopups.forEach(p => { if (WZ._liveMap) WZ._liveMap.removeLayer(p); });
    _autoCollisionPopups = [];
    if (WZ._collisionCountdownInterval) { clearInterval(WZ._collisionCountdownInterval); WZ._collisionCountdownInterval = null; }
  });

  // ── Marker-Highlight bei Tabellen-Hover ────────────────────────────────
  let _acMarkerByIdx = [];
  let _proxPairs = [];
  let _highlightCircle = null;
  let _parCoordsHighlightByIdx = null;  // set by _drawParallelCoords

  window._proxZoom = function(pi) {
    const p = _proxPairs[pi];
    if (!p || !WZ._liveMap) return;
    WZ._liveMap.fitBounds([[p.a.lat, p.a.lon], [p.b.lat, p.b.lon]],
      { padding: [60, 60], maxZoom: 14, animate: true, duration: 0.7 });
  };

  window._proxHighlight = function(pi, on) {
    const p = _proxPairs[pi];
    if (!p) return;
    [p.allIdxA, p.allIdxB].forEach(idx => {
      const m = _acMarkerByIdx[idx];
      if (!m) return;
      if (on) {
        const size = 28;
        const hdg = m.options._heading || 0;
        m.setIcon(L.divIcon({
          className: "",
          html: `<svg width="${size}" height="${size}" viewBox="0 0 24 24"
            style="transform:rotate(${hdg}deg);filter:drop-shadow(0 0 5px #ef4444);">
            <path d="M12 2 L16 20 L12 16 L8 20 Z" fill="#ef4444" stroke="#fff" stroke-width="1.5"/>
          </svg>`,
          iconSize: [size, size],
          iconAnchor: [size/2, size/2],
        }));
      } else {
        m.setIcon(m.options._origIcon);
      }
    });
  };

  window.wzHighlightMarker = function(idx) {
    // Also highlight in parallel coords
    if (_parCoordsHighlightByIdx) _parCoordsHighlightByIdx(idx);
    const a = WZ._liveAircraftItems[idx];
    if (!a) return;

    // 3D-Ansicht: Cesium-Entity hervorheben
    if (_cesium3DActive && _cesiumViewer) {
      const entity = _cesiumEntitiesByIdx[idx];
      if (entity && entity.billboard) {
        const svgHL = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 24 24'><path d='M12 2 L16 20 L12 16 L8 20 Z' fill='white' stroke='%233b82f6' stroke-width='1.5'/></svg>`;
        entity.billboard.image = svgHL;
        entity.billboard.scale = 2.0;
        entity.billboard.color = Cesium.Color.WHITE;
      }
      return; // Leaflet-Highlight überspringen wenn 3D aktiv
    }

    const m = _acMarkerByIdx[idx];
    if (!m || !WZ._liveMap) return;

    // Größeres, helles Icon
    const hlSize = 32;
    const hlIcon = L.divIcon({
      className: "",
      html: `<svg width="${hlSize}" height="${hlSize}" viewBox="0 0 24 24" style="transform:rotate(${a.heading || 0}deg);
              filter:drop-shadow(0 0 8px #3b82f6) drop-shadow(0 0 16px #3b82f6);cursor:pointer;transition:all .15s ease;">
              <path d="M12 2 L16 20 L12 16 L8 20 Z" fill="#fff" stroke="rgba(0,0,0,.4)" stroke-width=".5"/>
            </svg>`,
      iconSize: [hlSize, hlSize],
      iconAnchor: [hlSize/2, hlSize/2],
    });
    m.setIcon(hlIcon);
    m.setZIndexOffset(1000);

    // Pulsierender Ring
    if (_highlightCircle) { WZ._liveMap.removeLayer(_highlightCircle); }
    _highlightCircle = L.circleMarker([a.lat, a.lon], {
      radius: 22, color: "#3b82f6", weight: 3, fillColor: "#3b82f6",
      fillOpacity: 0.15, className: "wz-pulse-ring"
    }).addTo(WZ._liveMap);
  };

  window.wzUnhighlightMarker = function(idx) {
    // Clear parallel coords highlight
    if (_parCoordsHighlightByIdx) _parCoordsHighlightByIdx(-1);

    // 3D-Ansicht: Cesium-Entity zurücksetzen
    if (_cesium3DActive && _cesiumViewer) {
      const entity = _cesiumEntitiesByIdx[idx];
      if (entity && entity.billboard) {
        entity.billboard.image = entity._origSvg;
        entity.billboard.scale = 1.3;
        entity.billboard.color = Cesium.Color.WHITE;
      }
      return;
    }

    const m = _acMarkerByIdx[idx];
    if (!m) return;
    // Original-Icon wiederherstellen
    if (m.options._origIcon) {
      m.setIcon(m.options._origIcon);
      m.setZIndexOffset(0);
    }
    if (_highlightCircle && WZ._liveMap) {
      WZ._liveMap.removeLayer(_highlightCircle);
      _highlightCircle = null;
    }
  };

  // ── Distanzmodus (D-Taste) ─────────────────────────────────────────────
  let _distMode = 0;       // 0=aus, 1=warte auf 1. Maschine, 2=1. gewählt → Linie folgt, 3=fixiert
  let _distLineLayer = null;
  let _distAcA = null;     // erste Maschine
  let _distAcB = null;     // zweite Maschine
  let _distMouseLatLng = null;   // immer aktuelle Mausposition auf der Karte
  let _distHoverCircle = null;   // Hover-Ring um nächste Maschine
  let _distHoverItem = null;     // aktuell gehoverete Maschine

  function _wzDistReset() {
    _distMode = 0;
    _distAcA = null;
    _distAcB = null;
    if (_distLineLayer && WZ._liveMap) { WZ._liveMap.removeLayer(_distLineLayer); _distLineLayer = null; }
    if (_distHoverCircle && WZ._liveMap) { WZ._liveMap.removeLayer(_distHoverCircle); _distHoverCircle = null; }
    const infoEl = document.getElementById("wz-dist-info");
    if (infoEl) infoEl.style.display = "none";
    _distHoverItem = null;
    if (WZ._liveMap) WZ._liveMap.getContainer().style.cursor = "";
  }

  // ── 3D-Modus (Cesium.js) ──────────────────────────────────────────────
  let _cesiumViewer = null;
  let _cesium3DActive = false;
  let _cesiumEntitiesByIdx = [];

  function _loadCesiumLib(cb, errcb) {
    if (window.Cesium) { cb(); return; }
    // unpkg mit pinned Version – zuverlässig verfügbar
    const BASE = 'https://unpkg.com/cesium@1.111.0/Build/Cesium/';
    window.CESIUM_BASE_URL = BASE;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = BASE + 'Widgets/widgets.css';
    document.head.appendChild(link);
    const script = document.createElement('script');
    script.src = BASE + 'Cesium.js';
    script.onload = cb;
    script.onerror = errcb || (() => {});
    document.head.appendChild(script);
  }

  window.wzToggle3D = function() {
    const cesiumEl = document.getElementById('wz-cesium-container');
    const btn = document.getElementById('wz-3d-btn');
    if (_cesium3DActive) {
      _cesium3DActive = false;
      if (cesiumEl) cesiumEl.style.display = 'none';
      if (btn) { btn.textContent = '⬡ 3D'; btn.style.background = 'rgba(15,23,42,.85)'; }
      if (WZ._liveMap) WZ._liveMap.invalidateSize();
      return;
    }
    if (btn) { btn.textContent = t('wz_3d_loading','⌛ Loading…'); btn.style.background = 'rgba(30,30,60,.9)'; btn.disabled = true; }
    _loadCesiumLib(
      () => {  // success
        _cesium3DActive = true;
        if (cesiumEl) cesiumEl.style.display = '';
        if (btn) { btn.textContent = '⬡ 2D'; btn.style.background = 'rgba(124,58,237,.85)'; btn.disabled = false; }
        // requestAnimationFrame: Container erst rendern lassen, dann Cesium init
        requestAnimationFrame(() => requestAnimationFrame(() => _wzInitCesium(cesiumEl)));
      },
      () => {  // error
        if (btn) { btn.textContent = '⬡ 3D'; btn.style.background = 'rgba(15,23,42,.85)'; btn.disabled = false; }
        alert(t('wz_cesium_error','Could not load Cesium.js. Please check your internet connection.'));
      }
    );
  };

  function _wzInitCesium(container) {
    if (_cesiumViewer) {
      _wzUpdate3DEntities();
      return;
    }
    try {
      // Dummy-Token damit Cesium nicht sofort abbricht; Ion-Ressourcen werden
      // nicht genutzt, da wir eigene Imagery + Terrain setzen.
      Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder';

      _cesiumViewer = new Cesium.Viewer(container, {
        terrainProvider: new Cesium.EllipsoidTerrainProvider(),
        baseLayerPicker: false, geocoder: false, homeButton: false,
        sceneModePicker: false, navigationHelpButton: false,
        animation: false, timeline: false, fullscreenButton: false,
        infoBox: false, selectionIndicator: false,
      });

      // Eigene OSM-Imagery einsetzen (Ion-Bildlayer entfernen)
      _cesiumViewer.imageryLayers.removeAll();
      _cesiumViewer.imageryLayers.addImageryProvider(
        new Cesium.UrlTemplateImageryProvider({
          url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
          maximumLevel: 19,
          credit: '© OpenStreetMap contributors',
        })
      );

      // Kredite und UI-Extras ausblenden
      const creditContainer = _cesiumViewer.cesiumWidget.creditContainer;
      if (creditContainer) creditContainer.style.display = 'none';

      _cesiumViewer.scene.skyBox.show = false;
      _cesiumViewer.scene.sun.show = false;
      _cesiumViewer.scene.moon.show = false;
      _cesiumViewer.scene.skyAtmosphere.show = false;
      _cesiumViewer.scene.globe.enableLighting = false;
      _cesiumViewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#1e293b');
    } catch(e) {
      console.error('Cesium init Fehler:', e);
      const btn = document.getElementById('wz-3d-btn');
      if (btn) { btn.textContent = '⬡ 3D'; btn.style.background = 'rgba(15,23,42,.85)'; btn.disabled = false; }
      _cesium3DActive = false;
      container.style.display = 'none';
      return;
    }
    _wzUpdate3DEntities();
  }

  function _wzUpdate3DEntities() {
    if (!_cesiumViewer || !_cesium3DActive) return;
    _cesiumViewer.entities.removeAll();
    _cesiumEntitiesByIdx = [];
    const items = WZ._liveAircraftItems;
    if (!items.length) return;

    items.forEach((ac, idx) => {
      if (ac.lat == null || ac.lon == null) return;
      const alt   = ac.alt_m || 0;
      const sc    = ac.anomaly_score || 0;
      const color = sc >= 30 ? '#ef4444' : sc >= 15 ? '#f97316' : sc >= 5 ? '#eab308' : '#f59e0b';
      const hdg   = ac.heading || 0;
      const pos   = Cesium.Cartesian3.fromDegrees(ac.lon, ac.lat, alt);
      const posG  = Cesium.Cartesian3.fromDegrees(ac.lon, ac.lat, 0);
      const c     = Cesium.Color.fromCssColorString(color);
      const enc   = color.replace('#', '%23');
      const svg   = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><path d='M12 2 L16 20 L12 16 L8 20 Z' fill='${enc}' stroke='rgba(0,0,0,0.6)' stroke-width='0.8'/></svg>`;

      const entity = _cesiumViewer.entities.add({
        position: pos,
        billboard: {
          image: svg, scale: 1.3,
          rotation: Cesium.Math.toRadians(-hdg),
          alignedAxis: Cesium.Cartesian3.UNIT_Z,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: (ac.callsign || ac.icao24 || '?').trim(),
          font: '11px monospace',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -18),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 600000),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        polyline: {
          positions: [posG, pos],
          width: 1,
          material: new Cesium.ColorMaterialProperty(c.withAlpha(0.3)),
          arcType: Cesium.ArcType.NONE,
        },
      });
      entity._origSvg = svg;
      entity._origColor = color;
      _cesiumEntitiesByIdx[idx] = entity;
    });

    // Zone-Umriss einzeichnen
    const zone3d = WZ._zones.find(z => z.id === WZ._liveZoneId);
    let zoneBounds = null;
    if (zone3d && zone3d.geometry) {
      try {
        const b = L.geoJSON(zone3d.geometry).getBounds();
        zoneBounds = { south: b.getSouth(), north: b.getNorth(),
                       west: b.getWest(), east: b.getEast(),
                       cLat: b.getCenter().lat, cLon: b.getCenter().lng };
        const zCol = Cesium.Color.fromCssColorString(WZ.ZONE_COLORS[zone3d.zone_type] || '#3b82f6').withAlpha(0.85);
        const geom = zone3d.geometry;
        const rings = geom.type === 'Polygon'      ? [geom.coordinates[0]]
                    : geom.type === 'MultiPolygon' ? geom.coordinates.map(p => p[0])
                    : null;
        if (rings) rings.forEach(ring => {
          _cesiumViewer.entities.add({
            polyline: {
              positions: ring.map(([ln, lt]) => Cesium.Cartesian3.fromDegrees(ln, lt, 0)),
              width: 2,
              material: new Cesium.PolylineDashMaterialProperty({ color: zCol, dashLength: 18 }),
              clampToGround: true,
            }
          });
        });
      } catch(_) {}
    }

    // Kamera: Zone + Maschinen gemeinsam in den Blick nehmen, Blick zum Horizont
    const validAc = items.filter(a => a.lat != null && a.lon != null);
    const allLats = validAc.map(a => a.lat);
    const allLons = validAc.map(a => a.lon);
    if (zoneBounds) {
      allLats.push(zoneBounds.south, zoneBounds.north);
      allLons.push(zoneBounds.west, zoneBounds.east);
    }
    if (!allLats.length) return;

    const centerLat = (Math.min(...allLats) + Math.max(...allLats)) / 2;
    const centerLon = (Math.min(...allLons) + Math.max(...allLons)) / 2;
    const span      = Math.max(Math.max(...allLats) - Math.min(...allLats),
                               Math.max(...allLons) - Math.min(...allLons));
    const altM      = Math.max(span * 111000 * 0.35, 8000);
    const offsetDeg = span * 0.9 + 1.0;

    _cesiumViewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(centerLon, centerLat - offsetDeg, altM),
      orientation: {
        heading: 0,
        pitch: Cesium.Math.toRadians(-6),   // flacher Blick – Horizont sichtbar
        roll: 0,
      },
      duration: 1.5,
    });
  }

  function _wzDestroyCesium() {
    if (_cesiumViewer) { try { _cesiumViewer.destroy(); } catch(_) {} _cesiumViewer = null; }
    _cesium3DActive = false;
    const cesiumEl = document.getElementById('wz-cesium-container');
    if (cesiumEl) cesiumEl.style.display = 'none';
    const btn = document.getElementById('wz-3d-btn');
    if (btn) { btn.textContent = '⬡ 3D'; btn.style.background = 'rgba(15,23,42,.85)'; btn.style.display = 'none'; }
  }

  function _wzDistItems() {
    return WZ._liveAircraftItems.length ? WZ._liveAircraftItems : (WZ._liveVesselItems || []);
  }

  function _wzDistFindNearest(latlng, exclude) {
    const items = _wzDistItems();
    if (!items.length) return null;
    let best = null, bestDist = Infinity;
    items.forEach(a => {
      if (a === exclude) return;
      if (a.lat == null || a.lon == null) return;
      const d = WZ._haversineKm(latlng.lat, latlng.lng, a.lat, a.lon);
      if (d < bestDist) { bestDist = d; best = a; }
    });
    return best;
  }

  // Prüft ob Zoom-Level nah genug ist (Legende ≤ ~10 km)
  function _wzDistIsZoomedIn() {
    if (!WZ._liveMap) return false;
    return WZ._liveMap.getZoom() >= 10;
  }

  // Hover-Ring um die nächste Maschine anzeigen/aktualisieren
  function _wzDistUpdateHover() {
    if (!WZ._liveMap || !_distMouseLatLng) return;
    if (_distMode !== 1 && _distMode !== 2) {
      if (_distHoverCircle) { WZ._liveMap.removeLayer(_distHoverCircle); _distHoverCircle = null; _distHoverItem = null; }
      return;
    }
    if (!_wzDistIsZoomedIn()) {
      if (_distHoverCircle) { WZ._liveMap.removeLayer(_distHoverCircle); _distHoverCircle = null; _distHoverItem = null; }
      return;
    }

    const exclude = _distMode === 2 ? null : _distAcA;
    const nearest = _wzDistFindNearest(_distMouseLatLng, exclude);
    if (!nearest || nearest === _distHoverItem) return;
    _distHoverItem = nearest;

    if (_distHoverCircle) WZ._liveMap.removeLayer(_distHoverCircle);
    _distHoverCircle = L.circleMarker([nearest.lat, nearest.lon], {
      radius: 20, color: "#a855f7", weight: 3, fillColor: "#a855f7",
      fillOpacity: 0.12, className: "wz-pulse-ring"
    }).addTo(WZ._liveMap);
  }

  function _wzDistDrawLine() {
    if (!WZ._liveMap || !_distAcA) return;
    if (_distLineLayer) { WZ._liveMap.removeLayer(_distLineLayer); _distLineLayer = null; }

    let endLatLng, labelHtml;

    if (_distMode === 3 && _distAcB) {
      // Fixiert auf zweite Maschine
      endLatLng = L.latLng(_distAcB.lat, _distAcB.lon);
      const horizKm = WZ._haversineKm(_distAcA.lat, _distAcA.lon, _distAcB.lat, _distAcB.lon);
      const altA = _distAcA.alt_m || 0;
      const altB = _distAcB.alt_m || 0;
      const dAlt = altB - altA;
      const dist3d = Math.sqrt((horizKm * 1000) ** 2 + dAlt ** 2);
      const spdA = _distAcA.velocity != null ? _distAcA.velocity * 3.6 : null;
      const spdB = _distAcB.velocity != null ? _distAcB.velocity * 3.6 : null;
      const spdAv = _distAcA.speed != null ? _distAcA.speed : null;
      const spdBv = _distAcB.speed != null ? _distAcB.speed : null;

      let distStr = dist3d >= 1000 ? (dist3d / 1000).toFixed(2) + " km" : Math.round(dist3d) + " m";
      const nameA = _distAcA.callsign || _distAcA.name || _distAcA.icao24 || _distAcA.mmsi || "?";
      const nameB = _distAcB.callsign || _distAcB.name || _distAcB.icao24 || _distAcB.mmsi || "?";
      labelHtml = `<div style="background:rgba(30,30,40,.92);color:#fff;padding:10px 18px;border-radius:8px;
        font-size:13px;font-weight:500;border:2px solid #a855f7;min-width:260px;
        box-shadow:0 2px 12px rgba(0,0,0,.5);pointer-events:none;line-height:1.7;">
        3D Distance: ${distStr}
        <br><span style="color:#93c5fd;">Alt. diff.: ${dAlt >= 0 ? "+" : ""}${Math.round(dAlt)} m</span>`;
      if (spdA != null && spdB != null) {
        const dSpd = Math.round(spdB - spdA);
        labelHtml += `<br><span style="color:#fbbf24;">Speed diff.: ${dSpd >= 0 ? "+" : ""}${dSpd} km/h</span>`;
        // Kollisionszeit-Berechnung
        const distKm = dist3d / 1000;
        const closingSpd = spdA + spdB;  // frontal aufeinander zu
        const chaseSpd = Math.abs(spdA - spdB);  // Verfolgung
        let collisionHtml = "";
        if (closingSpd > 0) {
          const tFrontalH = distKm / closingSpd;
          const tFrontalSec = tFrontalH * 3600;
          const frontalStr = tFrontalSec < 60 ? Math.round(tFrontalSec) + " s"
            : tFrontalSec < 3600 ? (tFrontalSec / 60).toFixed(1) + " min"
            : (tFrontalH).toFixed(1) + " h";
          collisionHtml += `<br><span style="color:#f87171;">⚠ Frontal: ${frontalStr}</span>`;
        }
        if (chaseSpd > 0) {
          const tChaseH = distKm / chaseSpd;
          const tChaseSec = tChaseH * 3600;
          const chaseStr = tChaseSec < 60 ? Math.round(tChaseSec) + " s"
            : tChaseSec < 3600 ? (tChaseSec / 60).toFixed(1) + " min"
            : (tChaseH).toFixed(1) + " h";
          const faster = spdA > spdB ? nameA : nameB;
          collisionHtml += `<br><span style="color:#fb923c;">⚠ Pursuit: ${chaseStr} <span style="font-size:11px;color:#d1d5db;">(${WZ._esc(faster)} catching up)</span></span>`;
        }
        labelHtml += collisionHtml;
      } else if (spdAv != null && spdBv != null) {
        const spdAkn = parseFloat(spdAv);
        const spdBkn = parseFloat(spdBv);
        const dSpd = (spdBkn - spdAkn).toFixed(1);
        labelHtml += `<br><span style="color:#fbbf24;">Speed diff.: ${dSpd >= 0 ? "+" : ""}${dSpd} kn</span>`;
        // Kollisionszeit für Schiffe (kn → km/h: * 1.852)
        const spdAkmh = spdAkn * 1.852;
        const spdBkmh = spdBkn * 1.852;
        const distKm = dist3d / 1000;
        const closingSpd = spdAkmh + spdBkmh;
        const chaseSpd = Math.abs(spdAkmh - spdBkmh);
        let collisionHtml = "";
        if (closingSpd > 0) {
          const tH = distKm / closingSpd;
          const tMin = tH * 60;
          const frontalStr = tMin < 60 ? tMin.toFixed(1) + " min" : tH.toFixed(1) + " h";
          collisionHtml += `<br><span style="color:#f87171;">⚠ Frontal: ${frontalStr}</span>`;
        }
        if (chaseSpd > 0) {
          const tH = distKm / chaseSpd;
          const tMin = tH * 60;
          const chaseStr = tMin < 60 ? tMin.toFixed(1) + " min" : tH.toFixed(1) + " h";
          collisionHtml += `<br><span style="color:#fb923c;">⚠ Pursuit: ${chaseStr}</span>`;
        }
        labelHtml += collisionHtml;
      }
      labelHtml += `<br><span style="color:#d1d5db;">${WZ._esc(nameA)} → ${WZ._esc(nameB)}</span>`;
      labelHtml += `</div>`;
    } else if (_distMode === 2 && _distMouseLatLng) {
      // Linie von 1. Maschine zum Mauszeiger mit Live-Distanz
      endLatLng = _distMouseLatLng;
      const horizKm = WZ._haversineKm(_distAcA.lat, _distAcA.lon, endLatLng.lat, endLatLng.lng);
      let distStr = horizKm >= 1 ? horizKm.toFixed(2) + " km" : Math.round(horizKm * 1000) + " m";
      const nameA = _distAcA.callsign || _distAcA.name || _distAcA.icao24 || _distAcA.mmsi || "?";
      labelHtml = `<div style="background:rgba(30,30,40,.92);color:#fff;padding:10px 18px;border-radius:8px;
        font-size:13px;font-weight:500;border:2px solid #a855f7;min-width:260px;
        box-shadow:0 2px 12px rgba(0,0,0,.5);pointer-events:none;line-height:1.7;">
        2D Distance: ${distStr}<br><span style="color:#d1d5db;">from ${WZ._esc(nameA)}</span></div>`;
    } else {
      return;
    }

    _distLineLayer = L.polyline(
      [L.latLng(_distAcA.lat, _distAcA.lon), endLatLng],
      { color: "#a855f7", weight: 3, dashArray: "8 6", opacity: 0.9 }
    ).addTo(WZ._liveMap);

    // Info-Box als festes Overlay in der Kartenecke (nie im Weg)
    let infoEl = document.getElementById("wz-dist-info");
    if (!infoEl) {
      infoEl = document.createElement("div");
      infoEl.id = "wz-dist-info";
      infoEl.style.cssText = "position:absolute;bottom:30px;left:10px;z-index:1000;pointer-events:none;";
      WZ._liveMap.getContainer().appendChild(infoEl);
    }
    infoEl.innerHTML = labelHtml;
    infoEl.style.display = "";
  }

  // Maschine wählen (1. oder 2.)
  function _wzDistPick(latlng) {
    if (_distMode === 1) {
      // 1. Maschine wählen
      _distAcA = _wzDistFindNearest(latlng, null);
      if (_distAcA) {
        _distMode = 2;
      }
    } else if (_distMode === 2) {
      // 2. Maschine wählen
      const picked = _wzDistFindNearest(latlng, _distAcA);
      if (picked && picked !== _distAcA) {
        _distAcB = picked;
        _distMode = 3;
        if (WZ._liveMap) WZ._liveMap.getContainer().style.cursor = "";
        if (_distHoverCircle) { WZ._liveMap.removeLayer(_distHoverCircle); _distHoverCircle = null; }
        _wzDistDrawLine();
      }
    }
  }

  window.wzToggleDistMode = function() {
    if (!WZ._liveAircraftItems.length) return;  // nur für Flugzeug-Zonen
    if (_distMode > 0) { _wzDistReset(); return; }
    _distMode = 1;
    _distAcA = null;
    _distAcB = null;
    if (WZ._liveMap) WZ._liveMap.getContainer().style.cursor = "crosshair";
  };

  // Tastatur-Handler: "D" wählt die nächste Maschine zur aktuellen Mausposition
  document.addEventListener("keydown", function(e) {
    if (e.key !== "d" && e.key !== "D") return;
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable) return;
    if (!WZ._liveMap) return;
    if (!WZ._liveAircraftItems.length) return;  // nur für Flugzeug-Zonen
    const overlay = document.getElementById("wz-live-overlay");
    if (!overlay || overlay.style.display === "none") return;

    if (_distMode === 0) {
      // Nur aktiv wenn Dichtemessung läuft
      if (!WZ._heatActive) return;
      _distMode = 1;
      if (WZ._liveMap) WZ._liveMap.getContainer().style.cursor = "crosshair";
      if (_distMouseLatLng) _wzDistPick(_distMouseLatLng);
    } else if (_distMode === 1 && _distMouseLatLng) {
      _wzDistPick(_distMouseLatLng);
    } else if (_distMode === 2 && _distMouseLatLng) {
      _wzDistPick(_distMouseLatLng);
    } else if (_distMode === 3) {
      _wzDistReset();
    }
  });

  // Karte-Klick wählt ebenfalls Maschine (exportiert für wz_core.js)
  window._wzDistMapClick = function(e) {
    if (_distMode === 1 || _distMode === 2) {
      _wzDistPick(e.latlng);
    }
  }

  // Mausbewegung: immer tracken, Linie + Hover aktualisieren (exportiert für wz_core.js)
  window._wzDistMouseMove = function(e) {
    _distMouseLatLng = e.latlng;
    if (_distMode === 2 && _distAcA) {
      _wzDistDrawLine();
    }
    if (_distMode === 1 || _distMode === 2) {
      _wzDistUpdateHover();
    }
  }

  // ── Flugzeug-Detail-Popup ──────────────────────────────────────────────
  window.wzShowAircraftDetail = function(idx) {
    const a = WZ._liveAircraftItems[idx];
    if (!a) return;

    const sc = a.anomaly_score || 0;
    const borderColor = WZ._anomalyColor(sc);
    const alt = a.alt_m != null ? Math.round(a.alt_m).toLocaleString() + " m" : "–";
    const altGeo = a.alt_geo_m != null ? Math.round(a.alt_geo_m).toLocaleString() + " m" : "–";
    const spd = a.velocity != null ? Math.round(a.velocity * 3.6) + " km/h" : "–";
    const ias = a.ias != null ? Math.round(a.ias * 3.6) + " km/h" : "–";
    const tas = a.tas != null ? Math.round(a.tas * 3.6) + " km/h" : "–";
    const vr = a.vert_rate != null ? (a.vert_rate > 0 ? "+" : "") + a.vert_rate.toFixed(1) + " m/s" : "–";
    const mach = a.mach != null ? "M " + a.mach.toFixed(3) : "–";
    const navAlt = a.nav_alt != null ? Math.round(a.nav_alt).toLocaleString() + " m" : "–";

    // Nächste Maschine berechnen (3D-Distanz inkl. Höhe)
    let nearestDist = Infinity, nearestAc = null;
    if (a.lat != null && a.lon != null) {
      const altA = a.alt_m || 0;
      WZ._liveAircraftItems.forEach((b, j) => {
        if (j === idx || b.lat == null || b.lon == null) return;
        const horizM = WZ._haversineKm(a.lat, a.lon, b.lat, b.lon) * 1000;
        const dAlt = (b.alt_m || 0) - altA;
        const dist3d = Math.sqrt(horizM * horizM + dAlt * dAlt);
        if (dist3d < nearestDist) { nearestDist = dist3d; nearestAc = b; }
      });
    }
    const nearestStr = nearestAc
      ? `${nearestDist < 1000 ? Math.round(nearestDist) + " m" : (nearestDist / 1000).toFixed(1) + " km"} → <strong>${WZ._esc(nearestAc.callsign || nearestAc.reg || nearestAc.icao24)}</strong>`
      : "–";

    // Detail-Overlay erstellen
    let existing = document.getElementById("wz-aircraft-detail");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "wz-aircraft-detail";
    overlay.style.cssText = "position:fixed;inset:0;z-index:10003;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;";
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };

    const hasMap = a.lat != null && a.lon != null;

    overlay.innerHTML = `
      <div style="background:var(--surface);border:1px solid var(--border);border-top:3px solid ${borderColor};
                  border-radius:12px;width:94%;max-width:1000px;max-height:85vh;overflow-y:auto;
                  box-shadow:0 12px 40px rgba(0,0,0,.4);padding:0;">
        <!-- Header -->
        <div style="padding:14px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;">
          <div style="font-size:22px;transform:rotate(${(a.heading || 0) - 90}deg);color:${borderColor};">✈</div>
          <div style="flex:1;">
            <div style="font-size:16px;font-weight:700;">${WZ._esc(a.callsign || t('wz_unknown','Unknown'))} ${WZ._anomalyBadge(sc)}</div>
            <div style="font-size:12px;color:var(--muted);">${WZ._esc(a.operator || a.desc || a.type || t('wz_aircraft_unknown_type','Unknown type'))}${a.country ? ' · ' + WZ._esc(a.country) : ''} · ${WZ._esc(a.reg || t('wz_aircraft_no_reg','no reg.'))}</div>
          </div>
          <button onclick="document.getElementById('wz-aircraft-detail').remove()"
                  style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:20px;padding:4px;">✕</button>
        </div>

        <!-- Karte + Daten nebeneinander -->
        <div style="display:flex;min-height:0;">
          ${hasMap ? `
          <!-- Karte (links, groß) -->
          <div id="wz-detail-map" style="flex:1 1 55%;min-height:380px;border-right:1px solid var(--border);"></div>` : ""}

          <!-- Daten (rechts, einzelne Spalte) -->
          <div style="${hasMap ? 'flex:0 0 320px;' : 'flex:1;'}overflow-y:auto;max-height:70vh;">
            ${sc > 0 ? `
            <!-- Anomalie-Info -->
            <div style="margin:10px 12px;padding:8px 12px;background:${sc >= 30 ? 'rgba(239,68,68,.1)' : sc >= 15 ? 'rgba(249,115,22,.08)' : 'rgba(234,179,8,.06)'};
                        border:1px solid ${borderColor}33;border-radius:8px;">
              <div style="font-size:12px;font-weight:600;color:${borderColor};margin-bottom:3px;">
                ⚠ Anomaly Score: ${sc}/100
              </div>
              <ul style="margin:0;padding:0 0 0 16px;font-size:11px;color:var(--text);">
                ${(a.anomaly_flags || []).map(f => `<li>${WZ._esc(f)}</li>`).join("")}
              </ul>
            </div>` : ""}

            <!-- Daten: Label + Wert untereinander -->
            <div style="padding:8px 12px 14px;display:grid;grid-template-columns:auto 1fr;gap:1px 10px;font-size:12px;">
              ${_detailCell("ICAO24", a.icao24)}
              ${_detailCell("Callsign", a.callsign || "–")}
              ${_detailCell("Usage", WZ._usageBadge(a.usage))}
              ${_detailCell("Airline", a.operator || "–")}
              ${_detailCell("Country", a.country || "–")}
              ${_detailCell("Type", a.desc || a.type || "–")}
              ${_detailCell("Registration", a.reg || "–")}
              ${_detailCell("Squawk", a.squawk || "–")}
              ${_detailCell("Category", a.category || "–")}
              <div style="grid-column:1/-1;border-top:1px solid var(--border);margin:4px 0;"></div>
              ${_detailCell("Baro. Alt.", alt)}
              ${_detailCell("Geo. Alt.", altGeo)}
              ${_detailCell("Nav. Alt.", navAlt)}
              ${_detailCell("GS", spd)}
              ${_detailCell("IAS", ias)}
              ${_detailCell("TAS", tas)}
              ${_detailCell("Mach", mach)}
              ${_detailCell("Heading", a.heading != null ? Math.round(a.heading) + "°" : "–")}
              ${_detailCell("Mag. Hdg.", a.mag_heading != null ? Math.round(a.mag_heading) + "°" : "–")}
              ${_detailCell("Vert. Rate", vr)}
              <div style="grid-column:1/-1;border-top:1px solid var(--border);margin:4px 0;"></div>
              ${_detailCell("Position", a.lat.toFixed(5) + ", " + a.lon.toFixed(5))}
              ${_detailCell("QNH", a.nav_qnh != null ? a.nav_qnh + " hPa" : "–")}
              ${_detailCell("RSSI", a.rssi != null ? a.rssi + " dBFS" : "–")}
              ${_detailCell("Last seen", a.seen != null ? a.seen.toFixed(1) + "s" : "–")}
              ${_detailCell("Local time", a.seen != null ? WZ._geoLocalTime(Date.now() - a.seen * 1000, a.lon, true) : '–')}
              ${_detailCell("Messages", a.messages != null ? a.messages.toLocaleString() : "–")}
              ${_detailCell("On ground", a.on_ground ? "Yes" : "No")}
              ${_detailCell("Emergency", a.emergency !== "none" ? '<span style="color:#ef4444;font-weight:600;">'+WZ._esc(a.emergency)+'</span>' : "–")}
              <div style="grid-column:1/-1;border-top:1px solid var(--border);margin:4px 0;"></div>
              ${_detailCell("Nearest aircraft", nearestStr)}
            </div>
          </div>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    // ── Mini-Karte mit Flugzeug + Kursvektor initialisieren ──
    if (hasMap) {
      setTimeout(() => {
        const mapEl = document.getElementById("wz-detail-map");
        if (!mapEl) return;
        const isDark = document.documentElement.getAttribute("data-theme") !== "light";
        const tileUrl = isDark
          ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";

        const detailMap = L.map(mapEl, { zoomControl: false, attributionControl: false }).setView([a.lat, a.lon], 10);
        L.tileLayer(tileUrl, { maxZoom: 18 }).addTo(detailMap);
        L.control.scale({ metric: true, imperial: false }).addTo(detailMap);

        // Flugzeug-Marker
        const acColor = WZ._anomalyColor(sc);
        const acIcon = L.divIcon({
          className: "",
          html: `<div style="transform:rotate(${(a.heading || 0) - 90}deg);font-size:28px;color:${acColor};
                  text-shadow:0 2px 6px rgba(0,0,0,.5);filter:drop-shadow(0 0 4px ${acColor}55);">✈</div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        });
        L.marker([a.lat, a.lon], { icon: acIcon }).addTo(detailMap);

        // Reichweiten-Kreise (30 min / 60 min)
        const spdKmhForCircles = a.velocity ? a.velocity * 3.6 : 0;
        const radius30m = spdKmhForCircles * 0.5 * 1000;  // km → m
        const radius60m = spdKmhForCircles * 1.0 * 1000;
        if (radius60m > 2000) {
          L.circle([a.lat, a.lon], {
            radius: radius60m, color: acColor, weight: 1, opacity: 0.25,
            fillColor: acColor, fillOpacity: 0.03, dashArray: "4 6"
          }).addTo(detailMap);
          // 60min-Label oben am Kreis
          const labelLat60 = a.lat + (radius60m / 111320);
          L.marker([labelLat60, a.lon], {
            icon: L.divIcon({
              className: "",
              html: `<div style="font-size:9px;color:${acColor};opacity:0.6;white-space:nowrap;text-align:center;">60 min</div>`,
              iconSize: [40, 12], iconAnchor: [20, 12]
            })
          }).addTo(detailMap);
        }
        if (radius30m > 1000) {
          L.circle([a.lat, a.lon], {
            radius: radius30m, color: acColor, weight: 1.5, opacity: 0.35,
            fillColor: acColor, fillOpacity: 0.05, dashArray: "4 4"
          }).addTo(detailMap);
          // 30min-Label oben am Kreis
          const labelLat30 = a.lat + (radius30m / 111320);
          L.marker([labelLat30, a.lon], {
            icon: L.divIcon({
              className: "",
              html: `<div style="font-size:9px;color:${acColor};opacity:0.7;white-space:nowrap;text-align:center;">30 min</div>`,
              iconSize: [40, 12], iconAnchor: [20, 12]
            })
          }).addTo(detailMap);
        }

        // Kursvektor mit 30min/60min-Projektion zeichnen
        if (a.heading != null) {
          const hdg = a.heading;
          const spdKmh = a.velocity ? a.velocity * 3.6 : 0;
          const rad = hdg * Math.PI / 180;
          const cosLat = Math.cos(a.lat * Math.PI / 180);

          // Positionen bei 30 und 60 Minuten berechnen
          function _projectPos(km) {
            return [
              a.lat + (km / 111.32) * Math.cos(rad),
              a.lon + (km / (111.32 * cosLat)) * Math.sin(rad)
            ];
          }
          const dist30 = spdKmh * 0.5;   // km in 30 min
          const dist60 = spdKmh * 1.0;   // km in 60 min
          const pos30 = _projectPos(dist30);
          const pos60 = _projectPos(dist60);

          // Gestrichelte Kurslinie bis 60 min
          if (dist60 > 0) {
            L.polyline([[a.lat, a.lon], pos60], {
              color: acColor, weight: 2, opacity: 0.6, dashArray: "6 4"
            }).addTo(detailMap);
          }



          // Karte an Kreise + Projektion anpassen
          const rKm = Math.max(dist60, spdKmhForCircles * 1.0);
          if (rKm > 2) {
            const dDeg = rKm / 111.32;
            detailMap.fitBounds([
              [a.lat - dDeg, a.lon - dDeg / cosLat],
              [a.lat + dDeg, a.lon + dDeg / cosLat]
            ], { padding: [30, 30], maxZoom: 11 });
          }
        }

        // ── Nächste Maschine schwarz blinkend auf der Mini-Karte ──
        if (nearestAc && nearestAc.lat != null && nearestAc.lon != null) {
          const nbIcon = L.divIcon({
            className: "",
            html: `<div class="wz-nearest-blink"><svg width="20" height="20" viewBox="0 0 24 24"
              style="transform:rotate(${nearestAc.heading || 0}deg);
                     filter:drop-shadow(0 0 4px #fff) drop-shadow(0 1px 3px rgba(0,0,0,.9));">
              <path d="M12 2 L16 20 L12 16 L8 20 Z" fill="#0f172a" stroke="#fff" stroke-width="2"/>
            </svg></div>`,
            iconSize: [20, 20],
            iconAnchor: [10, 10],
          });
          L.marker([nearestAc.lat, nearestAc.lon], { icon: nbIcon, interactive: false }).addTo(detailMap);

          // Verbindungslinie zur nächsten Maschine
          L.polyline([[a.lat, a.lon], [nearestAc.lat, nearestAc.lon]], {
            color: "#94a3b8", weight: 1.5, dashArray: "5 5", opacity: 0.7, interactive: false,
          }).addTo(detailMap);

          // Karte so zoomen, dass beide Maschinen sichtbar sind
          detailMap.fitBounds(
            [[a.lat, a.lon], [nearestAc.lat, nearestAc.lon]],
            { padding: [40, 40], maxZoom: 12 }
          );
        }

        setTimeout(() => detailMap.invalidateSize(), 100);

        // Karte aufräumen wenn Overlay geschlossen wird
        const obs = new MutationObserver(() => {
          if (!document.getElementById("wz-aircraft-detail")) {
            detailMap.remove();
            obs.disconnect();
          }
        });
        obs.observe(document.body, { childList: true });
      }, 50);
    }
  };

  function _detailRow(label, value) {
    return `<div style="padding:4px 0;color:var(--muted);font-size:11px;">${WZ._esc(label)}</div>
            <div style="padding:4px 0;font-weight:500;">${value}</div>`;
  }
  function _detailCell(label, value) {
    return `<div style="padding:3px 0;color:var(--muted);font-size:10px;white-space:nowrap;">${WZ._esc(label)}</div>
            <div style="padding:3px 0;font-weight:500;font-size:12px;">${value}</div>`;
  }

  // ── Dichtekarte (Heatmap) ─────────────────────────────────────────────
WZ._heatLayer = null;
WZ._heatActive = false;

  // ── OSM-Overlay in Vollbildansicht ──────────────────────────────────
  let _satFsOsmActive = false;
  let _satFsOsmMap = null;

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


  window.wzRefreshLive = async function() {
    if (!WZ._liveZoneId) return;
    const wasProj = _projActive;
    const btn = document.getElementById("wz-refresh-btn");
    if (btn) { btn.disabled = true; btn.innerHTML = '&#x21bb; Loading…'; }
    await WZ._fetchLiveData(WZ._liveZoneId);
    if (btn) { btn.disabled = false; btn.innerHTML = '&#x21bb; Aktualisieren'; }
    if (wasProj) wzToggleProjection();
  };

  window.wzToggleHeatmap = function() {
    if (!WZ._liveMap) return;
    const btn = document.getElementById("wz-heatmap-btn");
    const proxPanel = document.getElementById("wz-proximity-panel");

    if (WZ._heatActive) {
      if (WZ._heatLayer) { WZ._liveMap.removeLayer(WZ._heatLayer); WZ._heatLayer = null; }
      WZ._heatActive = false;
      if (btn) { btn.style.background = "#0891b2"; btn.textContent = "🌡 Density Map"; }
      if (proxPanel) proxPanel.style.display = "none";
      _wzDistReset();
      WZ._liveMap.invalidateSize();
      return;
    }

    const allItems = WZ._liveAircraftItems.length ? WZ._liveAircraftItems : WZ._liveVesselItems;
    if (!allItems || !allItems.length) return;

    const isAircraft = WZ._liveAircraftItems.length > 0;
    const items = isAircraft ? allItems.filter(a => a.velocity != null && (a.velocity * 3.6) > 400) : allItems;
    if (!items.length) return;

    const CRIT_KM = 1.0;
    const WARN_KM = 5.0;
    const NEAR_KM = 30.0;

    // Paarweiser Vergleich – jedes Paar nur einmal
    const pairs = [];   // { a, b, dist3d, horizKm, dAltM, idxA, idxB, allIdxA, allIdxB }
    const minDistFor = new Array(items.length).fill(Infinity);

    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      if (a.lat == null || a.lon == null) continue;
      const altA = (a.alt_m || 0) / 1000;
      for (let j = i + 1; j < items.length; j++) {
        const b = items[j];
        if (b.lat == null || b.lon == null) continue;
        const horizKm = WZ._haversineKm(a.lat, a.lon, b.lat, b.lon);
        const dAltKm  = ((b.alt_m || 0) / 1000) - altA;
        const dist3d  = Math.sqrt(horizKm * horizKm + dAltKm * dAltKm);
        if (dist3d < minDistFor[i]) minDistFor[i] = dist3d;
        if (dist3d < minDistFor[j]) minDistFor[j] = dist3d;
        if (dist3d <= CRIT_KM) {
          pairs.push({ a, b, dist3d, horizKm, dAltM: Math.abs(dAltKm * 1000), idxA: i, idxB: j,
            allIdxA: allItems.indexOf(a), allIdxB: allItems.indexOf(b) });
        }
      }
    }
    pairs.sort((x, y) => x.dist3d - y.dist3d);
    _proxPairs = pairs;

    // Kreise zeichnen
    WZ._heatLayer = L.layerGroup();
    items.forEach((a, i) => {
      if (a.lat == null || a.lon == null) return;
      const d = minDistFor[i];
      let color, fillOpacity, weight, radiusM;
      if (d <= CRIT_KM) {
        color = "#ef4444"; fillOpacity = 0.45; weight = 1.5;
        radiusM = (CRIT_KM / 2) * 1000;
      } else if (d <= WARN_KM) {
        color = "#f97316"; fillOpacity = 0.20; weight = 1;
        radiusM = (WARN_KM / 2) * 1000;
      } else if (d <= NEAR_KM) {
        color = "#eab308"; fillOpacity = 0.08; weight = 0.5;
        radiusM = (NEAR_KM / 2) * 1000;
      } else { return; }
      L.circle([a.lat, a.lon], {
        radius: radiusM, color, fillColor: color, fillOpacity, weight,
        opacity: 0.7, interactive: false,
      }).addTo(WZ._heatLayer);
    });
    WZ._heatLayer.addTo(WZ._liveMap);

    // Proximity-Panel befüllen
    if (proxPanel) {
      const title = document.getElementById("wz-prox-title");
      const list  = document.getElementById("wz-prox-list");
      if (title) title.textContent = pairs.length
        ? `${pairs.length} critical pair${pairs.length > 1 ? "s" : ""} < 1 km`
        : "No critical proximity";
      if (list) {
        if (!pairs.length) {
          list.innerHTML = `<div style="padding:16px 12px;color:var(--muted);text-align:center;font-size:11px;">
            No aircraft closer than 1 km</div>`;
        } else {
          list.innerHTML = pairs.map((p, pi) => {
            const nameA = p.a.callsign || p.a.name || p.a.icao24 || p.a.mmsi || "?";
            const nameB = p.b.callsign || p.b.name || p.b.icao24 || p.b.mmsi || "?";
            const distStr = p.dist3d < 1 ? Math.round(p.dist3d * 1000) + " m" : p.dist3d.toFixed(2) + " km";
            const horizStr = p.horizKm < 1 ? Math.round(p.horizKm * 1000) + " m" : p.horizKm.toFixed(2) + " km";
            const dAltStr = Math.round(p.dAltM) + " m";
            return `<div onclick="_proxZoom(${pi})"
              style="padding:8px 12px;border-bottom:1px solid var(--border);cursor:pointer;
                     background:rgba(239,68,68,.07);transition:background .1s;"
              onmouseenter="this.style.background='rgba(239,68,68,.16)';_proxHighlight(${pi},true)"
              onmouseleave="this.style.background='rgba(239,68,68,.07)';_proxHighlight(${pi},false)">
              <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px;">
                <span style="background:#ef4444;color:#fff;font-size:9px;font-weight:700;
                  padding:1px 5px;border-radius:3px;">⚠ ${distStr}</span>
              </div>
              <div style="font-weight:700;font-size:12px;color:var(--text);">${WZ._esc(nameA)}</div>
              <div style="font-size:10px;color:var(--muted);">↕ ${WZ._esc(nameB)}</div>
              <div style="font-size:10px;color:var(--muted);margin-top:2px;">
                Horiz.: ${horizStr} · Alt. diff.: ${dAltStr}
              </div>
            </div>`;
          }).join("");
        }
      }
      proxPanel.style.display = "flex";
      WZ._liveMap.invalidateSize();
    }

    WZ._heatActive = true;
    if (btn) { btn.style.background = "#065f6c"; btn.textContent = t('wz_btn_heatmap_off','🌡 Density Map Off'); }
    // Dist-Hover automatisch aktivieren (lila Ring beim Hovern, D = Maschine wählen)
    if (WZ._liveAircraftItems.length && _distMode === 0) {
      _distMode = 1;
      if (WZ._liveMap) WZ._liveMap.getContainer().style.cursor = "crosshair";
    }
  };

  // ── Stundenprojektion ────────────────────────────────────────────────
  let _projActive         = false;
  let _projAnimFrame      = null;
  let _projAnimStart      = null;
  let _projGhostLayer     = null;
  let _projTrailLayer     = null;
  let _projCollisionLayer = null;
  let _projHoverLayer     = null;
  let _projPlayFn         = null;   // set inside wzToggleProjection, called by wzProjPlay
  let _projAircraft       = null;   // Referenz auf das aircraft-Array der laufenden Projektion
  let _projGhostMarkersRef = null;  // Referenz auf ghostMarkers der laufenden Projektion

  const _PROJ_SIM_S    = 3600;   // 1 Stunde Simulation
  const _PROJ_SPEED    = 100;    // 100-fache Echtzeit → 36 s real für 1 Std. Sim
  const _PROJ_STEP_S   = 30;     // Kollisionsprüfung alle 30 s Simzeit
  const _PROJ_DIST3D_KM = 1.0;   // 3D-Kollisionsschwellwert (≤1000m → gelb, ≤100m → rot)

  // Geodätische Vorwärtsberechnung: Startpunkt + Kurs + Distanz → neues lat/lon
  function _projCalcPos(lat, lon, headingDeg, distM) {
    const R = 6371000;
    const d = distM / R;
    const hdg = headingDeg * Math.PI / 180;
    const lat1 = lat * Math.PI / 180;
    const lon1 = lon * Math.PI / 180;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(d) +
      Math.cos(lat1) * Math.sin(d) * Math.cos(hdg)
    );
    const lon2 = lon1 + Math.atan2(
      Math.sin(hdg) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    );
    return {
      lat: lat2 * 180 / Math.PI,
      lon: ((lon2 * 180 / Math.PI) + 540) % 360 - 180,
    };
  }

  // Kollisionen über die gesamte 1-Std.-Simulation vorberechnen (3D-Distanz)
  function _projFindCollisions(aircraft) {
    const results = new Map();  // key "i,j" → nächstes / engste Ereignis
    for (let t = _PROJ_STEP_S; t <= _PROJ_SIM_S; t += _PROJ_STEP_S) {
      const pos = aircraft.map(a =>
        _projCalcPos(a.lat, a.lon, a.heading, a.velocity * t)
      );
      for (let i = 0; i < aircraft.length; i++) {
        const altA = aircraft[i].alt_m || 0;
        for (let j = i + 1; j < aircraft.length; j++) {
          const altB    = aircraft[j].alt_m || 0;
          const horizKm = WZ._haversineKm(pos[i].lat, pos[i].lon, pos[j].lat, pos[j].lon);
          const dAltKm  = Math.abs(altA - altB) / 1000;
          const dist3dKm = Math.sqrt(horizKm * horizKm + dAltKm * dAltKm);
          if (dist3dKm <= _PROJ_DIST3D_KM) {
            const key = `${i},${j}`;
            const ex = results.get(key);
            if (!ex || t < ex.t || (t === ex.t && dist3dKm < ex.dist3dKm)) {
              results.set(key, { i, j, dist3dKm, horizKm, dAltM: Math.abs(altA - altB), t,
                a: aircraft[i], b: aircraft[j] });
            }
          }
        }
      }
    }
    return Array.from(results.values()).sort((x, y) => x.t - y.t || x.dist3dKm - y.dist3dKm);
  }

  // Kollisionsliste rendern
  function _projRenderCollisions(collisions) {
    const header = document.getElementById("wz-proj-result-header");
    const list   = document.getElementById("wz-proj-collision-list");
    if (!header || !list) return;
    header.style.display = "";
    if (!collisions.length) {
      header.textContent = t('wz_no_collisions','No collisions projected');
      header.style.color = "var(--muted)";
      list.innerHTML = `<div style="padding:16px 12px;color:var(--muted);text-align:center;font-size:11px;line-height:1.5;">
        No aircraft come within<br>&lt;\u00a01\u00a0km 3D distance over 1\u00a0hour.</div>`;
      return;
    }
    header.style.color = "#ef4444";
    header.textContent = `${collisions.length} collision risk${collisions.length !== 1 ? "s" : ""}`;
    list.innerHTML = collisions.map((c, ci) => {
      const nameA   = WZ._esc(c.a.callsign || c.a.icao24 || "?");
      const nameB   = WZ._esc(c.b.callsign || c.b.icao24 || "?");
      const tMin    = Math.floor(c.t / 60);
      const tSec    = c.t % 60;
      const tLabel  = tMin > 0
        ? `${tMin}\u00a0min${tSec ? "\u00a0" + tSec + "\u00a0s" : ""}`
        : `${tSec}\u00a0s`;
      const distStr = c.dist3dKm < 1
        ? Math.round(c.dist3dKm * 1000) + "\u00a0m"
        : c.dist3dKm.toFixed(2) + "\u00a0km";
      const altStr  = Math.round(c.dAltM) + "\u00a0m";
      const color   = c.dist3dKm < 0.1 ? "#ef4444" : "#f97316";
      const bgAlpha = c.dist3dKm < 0.1 ? "rgba(239,68,68,.06)" : "rgba(249,115,22,.06)";
      return `<div data-ci="${ci}" style="padding:8px 12px;border-bottom:1px solid var(--border);background:${bgAlpha};cursor:pointer;">
        <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px;">
          <span style="background:${color};color:#fff;font-size:9px;font-weight:700;
                padding:1px 5px;border-radius:3px;">⚠ T+${tLabel}</span>
          <span style="font-size:10px;color:var(--muted);">${distStr}\u00a0·\u00a0Δ${altStr}</span>
        </div>
        <div style="font-weight:700;font-size:12px;color:var(--text);">${nameA}</div>
        <div style="font-size:10px;color:var(--muted);">↕ ${nameB}</div>
      </div>`;
    }).join("");
  }

  // Hover-Interaktion auf der Kollisionsliste
  function _projBindHovers(collisions, aircraft, ghostMarkers) {
    const list = document.getElementById("wz-proj-collision-list");
    if (!list) return;
    list.querySelectorAll("[data-ci]").forEach(el => {
      const ci = parseInt(el.getAttribute("data-ci"), 10);
      const c  = collisions[ci];
      if (!c) return;
      const idxA = aircraft.indexOf(c.a);
      const idxB = aircraft.indexOf(c.b);
      const mA   = ghostMarkers[idxA];
      const mB   = ghostMarkers[idxB];

      el.addEventListener("mouseenter", () => {
        el.style.filter = "brightness(1.35)";
        if (!WZ._liveMap) return;
        if (!_projHoverLayer) _projHoverLayer = L.layerGroup().addTo(WZ._liveMap);
        else _projHoverLayer.clearLayers();

        // Kollisionspunkt (Mittelpunkt der beiden Positionen beim Kollisionszeitpunkt)
        const posA = _projCalcPos(c.a.lat, c.a.lon, c.a.heading, c.a.velocity * c.t);
        const posB = _projCalcPos(c.b.lat, c.b.lon, c.b.heading, c.b.velocity * c.t);

        // Orange Hervorhebungsringe um die Ghost-Marker
        if (mA) L.circleMarker([mA.getLatLng().lat, mA.getLatLng().lng],
          { radius: 18, color: "#f97316", weight: 2.5, fill: false, interactive: false })
          .addTo(_projHoverLayer);
        if (mB) L.circleMarker([mB.getLatLng().lat, mB.getLatLng().lng],
          { radius: 18, color: "#f97316", weight: 2.5, fill: false, interactive: false })
          .addTo(_projHoverLayer);

        // Rote gestrichelte Linien: Startposition → Kollisionspunkt (kreuzendes X)
        L.polyline([[c.a.lat, c.a.lon], [posA.lat, posA.lon]],
          { color: "#ef4444", weight: 2, dashArray: "6,4", opacity: 0.85, interactive: false })
          .addTo(_projHoverLayer);
        L.polyline([[c.b.lat, c.b.lon], [posB.lat, posB.lon]],
          { color: "#ef4444", weight: 2, dashArray: "6,4", opacity: 0.85, interactive: false })
          .addTo(_projHoverLayer);
      });

      el.addEventListener("mouseleave", () => {
        el.style.filter = "";
        if (_projHoverLayer) { _projHoverLayer.clearLayers(); }
      });

      el.addEventListener("click", () => {
        if (!WZ._liveMap) return;
        const posA   = _projCalcPos(c.a.lat, c.a.lon, c.a.heading, c.a.velocity * c.t);
        const posB   = _projCalcPos(c.b.lat, c.b.lon, c.b.heading, c.b.velocity * c.t);
        const midLat = (posA.lat + posB.lat) / 2;
        const midLon = (posA.lon + posB.lon) / 2;
        const curA   = mA ? [mA.getLatLng().lat, mA.getLatLng().lng] : [c.a.lat, c.a.lon];
        const curB   = mB ? [mB.getLatLng().lat, mB.getLatLng().lng] : [c.b.lat, c.b.lon];
        const bounds = L.latLngBounds([curA, curB, [midLat, midLon]]);
        WZ._liveMap.fitBounds(bounds, { padding: [60, 60], maxZoom: 12 });
      });
    });
  }

  // Animation stoppen und Ressourcen freigeben
  function _wzProjStop() {
    if (_projAnimFrame) { cancelAnimationFrame(_projAnimFrame); _projAnimFrame = null; }
    _projAnimStart = null;
    _projPlayFn          = null;
    _projAircraft        = null;
    _projGhostMarkersRef = null;
    _projActive          = false;
    if (_projGhostLayer && WZ._liveMap) WZ._liveMap.removeLayer(_projGhostLayer);
    _projGhostLayer = null;
    if (_projTrailLayer && WZ._liveMap) WZ._liveMap.removeLayer(_projTrailLayer);
    _projTrailLayer = null;
    if (_projCollisionLayer && WZ._liveMap) WZ._liveMap.removeLayer(_projCollisionLayer);
    _projCollisionLayer = null;
    if (_projHoverLayer && WZ._liveMap) WZ._liveMap.removeLayer(_projHoverLayer);
    _projHoverLayer = null;
    // ParCoords-Blinken stoppen und Farben zurücksetzen
    if (_projBlinkInterval) { clearInterval(_projBlinkInterval); _projBlinkInterval = null; }
    _projCollisionAcMap = null;
    _projBlinkOn = true;
    if (_parCoordsRedrawFn) _parCoordsRedrawFn();
    // Echte Maschinen wieder einblenden
    if (WZ._liveMarkers && WZ._liveMap) WZ._liveMarkers.addTo(WZ._liveMap);
    const btn = document.getElementById("wz-projection-btn");
    if (btn) { btn.style.background = "var(--accent1)"; btn.textContent = t('wz_btn_projection_on','🕐 Hourly Projection'); }
  }

  window.wzToggleProjection = function() {
    if (!WZ._liveMap) return;
    const panel   = document.getElementById("wz-projection-panel");
    const projBtn = document.getElementById("wz-projection-btn");

    if (_projActive) {
      _wzProjStop();
      if (panel) panel.style.display = "none";
      WZ._liveMap.invalidateSize();
      return;
    }

    // Nur Flugzeuge mit vollständigen Navigationsdaten, ≥ 400 km/h und (falls aktiv) im ParCoords-Filter
    const aircraft = (WZ._liveAircraftItems || []).filter((a, idx) =>
      a.lat != null && a.lon != null && a.velocity != null && a.heading != null
        && (a.velocity * 3.6) >= 400
        && (!_parCoordsActiveSet || _parCoordsActiveSet.has(idx))
    );
    if (!aircraft.length) return;

    _projActive = true;
    if (projBtn) { projBtn.style.background = "#5b21b6"; projBtn.textContent = t('wz_btn_projection_off','🕐 Projection Off'); }

    // Kollisionen vorberechnen
    const collisions = _projFindCollisions(aircraft);

    // ParCoords-Kollisionsfärbung aufbauen und Blinken starten
    _projCollisionAcMap = new Map();
    collisions.forEach(c => {
      const idxA = WZ._liveAircraftItems.indexOf(c.a);
      const idxB = WZ._liveAircraftItems.indexOf(c.b);
      const sev  = c.dist3dKm < 0.1 ? 'red' : 'orange';
      if (idxA >= 0) { const cur = _projCollisionAcMap.get(idxA); if (!cur || sev === 'red') _projCollisionAcMap.set(idxA, sev); }
      if (idxB >= 0) { const cur = _projCollisionAcMap.get(idxB); if (!cur || sev === 'red') _projCollisionAcMap.set(idxB, sev); }
    });
    if (_projCollisionAcMap.size > 0 && WZ._parCoordsOpen) {
      if (_projBlinkInterval) clearInterval(_projBlinkInterval);
      _projBlinkInterval = setInterval(() => {
        _projBlinkOn = !_projBlinkOn;
        if (_parCoordsRedrawFn) _parCoordsRedrawFn();
      }, 600);
    }

    // Zonengrenzen für Simzeit-Label vorab berechnen (Längengrade → Zeitzone)
    let _projZoneBounds = null;
    try {
      const zone = WZ._zones.find(z => z.id === WZ._liveZoneId);
      if (zone && zone.geometry) _projZoneBounds = L.geoJSON(zone.geometry).getBounds();
    } catch (_) {}

    // Ghost-Marker-Layer (lila, halbtransparent)
    _projGhostLayer = L.layerGroup().addTo(WZ._liveMap);
    _projTrailLayer = L.layerGroup().addTo(WZ._liveMap);

    const ghostMarkers = aircraft.map(a => {
      const icon = L.divIcon({
        className: "",
        html: `<svg width="18" height="18" viewBox="0 0 24 24"
                    style="transform:rotate(${a.heading}deg);opacity:0.6;">
          <path d="M12 2 L16 20 L12 16 L8 20 Z" fill="#a78bfa"
                stroke="rgba(0,0,0,.3)" stroke-width=".5"/>
        </svg>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });
      const m = L.marker([a.lat, a.lon], { icon, interactive: false, zIndexOffset: -100 });
      m.addTo(_projGhostLayer);
      m._projAc = a;
      return m;
    });

    // Referenzen für spätere Filter-Aktualisierung merken
    _projAircraft        = aircraft;
    _projGhostMarkersRef = ghostMarkers;

    // Panel öffnen und Kollisionsliste befüllen
    _projRenderCollisions(collisions);
    _projBindHovers(collisions, aircraft, ghostMarkers);
    if (panel) panel.style.display = "flex";
    WZ._liveMap.invalidateSize();

    // Kritische Kollisionen (< 100m) als rote Popups auf der Karte anzeigen
    _autoCollisionCheck(aircraft);

    // UI zurücksetzen
    const playIcon  = document.getElementById("wz-proj-play-icon");
    const playLabel = document.getElementById("wz-proj-play-label");
    const progWrap  = document.getElementById("wz-proj-progress-wrap");
    const progBar   = document.getElementById("wz-proj-progress-bar");
    const timeLabel = document.getElementById("wz-proj-time-label");
    if (playIcon)  playIcon.textContent  = "▶";
    if (playLabel) playLabel.textContent = t('wz_start_simulation','Start Simulation');
    if (progWrap)  progWrap.style.display = "";
    if (progBar)   progBar.style.width = "0%";
    if (timeLabel) timeLabel.textContent = "0:00 / 60:00";
    // Kollisionsmarker sofort auf dem Progress-Bar anzeigen
    var marksInit = document.getElementById("wz-proj-collision-marks");
    if (marksInit) {
      marksInit.innerHTML = "";
      collisions.forEach(function(c) {
        var pct = (c.t / _PROJ_SIM_S) * 100;
        var isCrit = c.dist3dKm < 0.1;
        var clr = isCrit ? "#ef4444" : "#f97316";
        var nameA = c.a.callsign || c.a.icao24 || "?";
        var nameB = c.b.callsign || c.b.icao24 || "?";
        var tMin = Math.floor(c.t / 60);
        var tSec = c.t % 60;
        var tLbl = tMin > 0 ? tMin + "m" + (tSec ? " " + tSec + "s" : "") : tSec + "s";
        var distM = Math.round(c.dist3dKm * 1000);
        var mark = document.createElement("div");
        mark.style.cssText = "position:absolute;top:-3px;width:3px;height:12px;border-radius:1px;" +
          "background:" + clr + ";left:" + pct + "%;transform:translateX(-50%);" +
          "pointer-events:auto;cursor:default;box-shadow:0 0 4px " + clr + ";";
        mark.title = nameA + " \u2194 " + nameB + " · ~" + distM + " m · T+" + tLbl;
        marksInit.appendChild(mark);
      });
    }

    // wzProjPlay wird vom HTML-Button aufgerufen; closure über ghostMarkers + collisions
    _projPlayFn = function() {
      if (!_projActive) return;

      // Läuft → Stopp/Reset
      if (_projAnimFrame) {
        cancelAnimationFrame(_projAnimFrame);
        _projAnimFrame = null;
        _projAnimStart = null;
        ghostMarkers.forEach(m => m.setLatLng([m._projAc.lat, m._projAc.lon]));
        if (_projTrailLayer) _projTrailLayer.clearLayers();
        if (_projCollisionLayer && WZ._liveMap) { WZ._liveMap.removeLayer(_projCollisionLayer); _projCollisionLayer = null; }
        // Listeneintrag-Hintergründe zurücksetzen
        const listR = document.getElementById("wz-proj-collision-list");
        if (listR) listR.querySelectorAll("[data-ci]").forEach(el => {
          const ci = parseInt(el.getAttribute("data-ci"), 10);
          const c  = collisions[ci];
          if (!c) return;
          el.style.background = c.dist3dKm < 0.1 ? "rgba(239,68,68,.06)" : "rgba(249,115,22,.06)";
        });
        // Echte Maschinen wieder einblenden, Zonenzeit-Label zurücksetzen
        if (WZ._liveMarkers && WZ._liveMap) WZ._liveMarkers.addTo(WZ._liveMap);
        WZ._updateZoneTimeLabel(WZ._liveAircraftItems);
        if (playIcon)  playIcon.textContent  = "▶";
        if (playLabel) playLabel.textContent = t('wz_start_simulation','Start Simulation');
        if (progBar)   progBar.style.width = "0%";
        if (timeLabel) timeLabel.textContent = "0:00 / 60:00";
        return;
      }

      // Start: echte Maschinen ausblenden, nur Ghost-Marker zeigen
      if (WZ._liveMarkers && WZ._liveMap) WZ._liveMap.removeLayer(WZ._liveMarkers);
      if (playIcon)  playIcon.textContent  = "⏸";
      if (playLabel) playLabel.textContent = t('wz_proj_running','Running…');
      if (_projTrailLayer) _projTrailLayer.clearLayers();

      // Alten Kollisionsmarker-Layer entfernen (bei Neustart nach Simulationsende)
      if (_projCollisionLayer && WZ._liveMap) { WZ._liveMap.removeLayer(_projCollisionLayer); _projCollisionLayer = null; }

      // Listeneintrag-Hintergründe zurücksetzen
      const list = document.getElementById("wz-proj-collision-list");
      if (list) list.querySelectorAll("[data-ci]").forEach(el => {
        const ci = parseInt(el.getAttribute("data-ci"), 10);
        const c  = collisions[ci];
        if (!c) return;
        el.style.background = c.dist3dKm < 0.1 ? "rgba(239,68,68,.06)" : "rgba(249,115,22,.06)";
      });

      // Kollisionsmarker-Layer (blinkende rote Punkte)
      _projCollisionLayer = L.layerGroup().addTo(WZ._liveMap);
      const triggered = new Set();   // ci-Indizes bereits gesetzter Kollisionsmarker

      // Eine Polylinie pro Maschine für den Pfad
      const trails = ghostMarkers.map(m => {
        const line = L.polyline([[m._projAc.lat, m._projAc.lon]], {
          color: "#a78bfa", weight: 1.5, opacity: 0.4, dashArray: "5,5", interactive: false,
        });
        line.addTo(_projTrailLayer);
        return line;
      });

      let _projAnimStartWall = null;   // Date.now() beim ersten Frame (für Simzeit-Uhr)

      // Zonenzeit-Label in-place aktualisieren (kein Neuaufbau des Markers nötig)
      function _projUpdateZtLabel(simWallMs) {
        const el = document.getElementById("wz-zt-inner");
        if (!el || !_projZoneBounds) return;
        const wLon = _projZoneBounds.getWest();
        const eLon = _projZoneBounds.getEast();
        const cLon = _projZoneBounds.getCenter().lng;
        const wTz  = Math.round(wLon / 15);
        const eTz  = Math.round(eLon / 15);
        el.textContent = wTz !== eTz
          ? `⟳ ${WZ._geoLocalTime(simWallMs, wLon, false)} – ${WZ._geoLocalTime(simWallMs, eLon, false)} Uhr`
          : `⟳ ${WZ._geoLocalTime(simWallMs, cLon, false)} Uhr`;
      }

      function animate(now) {
        if (!_projAnimStart) { _projAnimStart = now; _projAnimStartWall = Date.now(); }
        const realSec = (now - _projAnimStart) / 1000;
        const simSec  = Math.min(realSec * _PROJ_SPEED, _PROJ_SIM_S);
        const simWall = _projAnimStartWall + simSec * 1000;

        // Ghost-Marker bewegen
        ghostMarkers.forEach((m, i) => {
          const a   = m._projAc;
          const pos = _projCalcPos(a.lat, a.lon, a.heading, a.velocity * simSec);
          m.setLatLng([pos.lat, pos.lon]);
          trails[i].addLatLng([pos.lat, pos.lon]);
        });

        // Zonenzeit-Label auf simulierte Uhrzeit setzen
        _projUpdateZtLabel(simWall);

        // Kollisionsmarker setzen sobald Simzeit den Kollisionszeitpunkt erreicht
        collisions.forEach((c, ci) => {
          if (triggered.has(ci) || simSec < c.t) return;
          triggered.add(ci);
          const listEl = document.querySelector(`#wz-proj-collision-list [data-ci="${ci}"]`);
          if (listEl) listEl.style.background = c.dist3dKm < 0.1 ? "rgba(239,68,68,.45)" : "rgba(249,115,22,.45)";
          const posA   = _projCalcPos(c.a.lat, c.a.lon, c.a.heading, c.a.velocity * c.t);
          const posB   = _projCalcPos(c.b.lat, c.b.lon, c.b.heading, c.b.velocity * c.t);
          const midLat = (posA.lat + posB.lat) / 2;
          const midLon = (posA.lon + posB.lon) / 2;
          const nameA  = c.a.callsign || c.a.icao24 || "?";
          const nameB  = c.b.callsign || c.b.icao24 || "?";
          const tMin   = Math.floor(c.t / 60);
          const tSec   = c.t % 60;
          const tLabel = tMin > 0 ? `${tMin} min` : `${tSec} s`;
          // Äußerer blinkender Ring + innerer Punkt (rot ≤100m 3D, orange ≤1000m)
          const clrRing = c.dist3dKm < 0.1 ? "#ef4444" : "#f97316";
          const clrBg   = c.dist3dKm < 0.1 ? "rgba(239,68,68,.25)" : "rgba(249,115,22,.25)";
          const clrGlow = c.dist3dKm < 0.1 ? "rgba(239,68,68,.5)"  : "rgba(249,115,22,.5)";
          const icon = L.divIcon({
            className: "",
            html: `<div style="position:relative;width:0;height:0;">
              <div class="wz-nearest-blink" style="position:absolute;
                   transform:translate(-50%,-50%);width:32px;height:32px;border-radius:50%;
                   background:${clrBg};border:2px solid ${clrRing};
                   box-shadow:0 0 10px 4px ${clrGlow};"></div>
              <div style="position:absolute;transform:translate(-50%,-50%);
                   width:10px;height:10px;border-radius:50%;background:${clrRing};
                   border:2px solid #fff;"></div>
            </div>`,
            iconSize: [0, 0],
            iconAnchor: [0, 0],
          });
          L.marker([midLat, midLon], { icon, zIndexOffset: 600 })
            .bindTooltip(`<b>⚠ Kollision T+${tLabel}</b><br>${WZ._esc(nameA)} ↔ ${WZ._esc(nameB)}`,
              { direction: "top", offset: [0, -8] })
            .addTo(_projCollisionLayer);
        });

        const pct  = (simSec / _PROJ_SIM_S) * 100;
        const sMin = Math.floor(simSec / 60);
        const sSec = Math.floor(simSec % 60);
        if (progBar)   progBar.style.width = pct + "%";
        if (timeLabel) timeLabel.textContent = `${sMin}:${String(sSec).padStart(2, "0")} / 60:00`;

        if (simSec < _PROJ_SIM_S) {
          _projAnimFrame = requestAnimationFrame(animate);
        } else {
          _projAnimFrame = null;
          _projAnimStart = null;
          // Echte Maschinen wieder einblenden und Zonenzeit-Label zurücksetzen
          if (WZ._liveMarkers && WZ._liveMap) WZ._liveMarkers.addTo(WZ._liveMap);
          WZ._updateZoneTimeLabel(WZ._liveAircraftItems);
          if (playIcon)  playIcon.textContent  = "↺";
          if (playLabel) playLabel.textContent = t('wz_proj_restart','Restart');
        }
      }

      _projAnimFrame = requestAnimationFrame(animate);
    };
  };

  // Play-Button im HTML ruft diese Funktion auf
  window.wzProjPlay = function() {
    if (_projPlayFn) _projPlayFn();
  };

  // ── Parallele Koordinaten ─────────────────────────────────────────────
WZ._parCoordsOpen = false;
  let _parCoordsFilterFn = null;   // current brush filter function, set by _drawParallelCoords
  let _parCoordsActiveSet = null;  // aktuell aktiver Filterset (Set von WZ._liveAircraftItems-Indizes)
  let _parCoordsResetFn = null;    // reset all brushes
  let _parCoordsRedrawFn = null;   // extern aufrufbar: linePaths neu bauen + canvas neu zeichnen
  let _projCollisionAcMap = null;  // Map<WZ._liveAircraftItems-Index → 'red'|'orange'> für ParCoords-Färbung
  let _projBlinkOn = true;         // Blink-Zustand für Kollisionslinien
  let _projBlinkInterval = null;   // setInterval-Handle

  window.wzToggleParCoords = function() {
    const panel = document.getElementById("wz-parcoords-inline");
    if (WZ._parCoordsOpen) {
      // Im Side-by-Side-Modus nicht schließen
      if (WZ._fsSideBySide) return;
      panel.style.display = "none";
      document.getElementById("wz-resize-parcoords").style.display = "none";
      WZ._parCoordsOpen = false;
      _parCoordsFilterFn = null;
      _parCoordsHighlightByIdx = null;
      _applyParCoordsFilter(null);  // remove filter
      const btn = document.querySelector("[data-parcoords-btn]");
      if (btn) { btn.style.background = "var(--accent1)"; btn.textContent = "⫼ Analyse Air Traffic"; }
    } else {
      wzShowParallelCoords();
    }
  };

  window.wzShowParallelCoords = function() {
    const items = WZ._liveAircraftItems;
    if (!items || !items.length) return;

    const panel = document.getElementById("wz-parcoords-inline");
    panel.style.display = "";
    document.getElementById("wz-resize-parcoords").style.display = "";
    WZ._parCoordsOpen = true;

    const btn = document.querySelector("[data-parcoords-btn]");
    if (btn) { btn.style.background = "#dc2626"; btn.textContent = "⫼ Close Analysis"; }

    setTimeout(() => {
      _drawParallelCoords(items);
      if (WZ._liveMap) WZ._liveMap.invalidateSize();
      // Blink-Interval starten falls Projektion mit Kollisionen aktiv
      if (_projCollisionAcMap && _projCollisionAcMap.size > 0 && !_projBlinkInterval) {
        _projBlinkInterval = setInterval(() => {
          _projBlinkOn = !_projBlinkOn;
          if (_parCoordsRedrawFn) _parCoordsRedrawFn();
        }, 600);
      }
    }, 30);
  };

  window.wzResetParCoordsBrushes = function() {
    if (_parCoordsResetFn) _parCoordsResetFn();
  };

  // Apply parallel coordinates filter to map markers and table rows
  function _applyParCoordsFilter(filterSet) {
    _parCoordsActiveSet = filterSet;   // für Projektion merken
    // filterSet is a Set of item indices that pass the brushes, or null to show all
    const items = WZ._liveAircraftItems;
    if (!items || !items.length) return;

    // Update map markers
    items.forEach((a, idx) => {
      const marker = _acMarkerByIdx[idx];
      if (!marker) return;
      if (!filterSet) {
        // No filter — show all
        marker.setOpacity(1);
      } else {
        marker.setOpacity(filterSet.has(idx) ? 1 : 0.12);
      }
    });

    // Update table rows
    const tbody = document.querySelector("#wz-live-content table tbody");
    if (tbody) {
      const rows = tbody.querySelectorAll("tr");
      rows.forEach((row, idx) => {
        if (!filterSet) {
          row.style.display = "";
        } else {
          row.style.display = filterSet.has(idx) ? "" : "none";
        }
      });
    }

    // Update aircraft count above table
    const acCountEl = document.getElementById("wz-ac-count");
    if (acCountEl) {
      if (filterSet) {
        acCountEl.innerHTML = `<strong>${filterSet.size}</strong> of ${items.length} aircraft shown`;
      } else {
        acCountEl.textContent = `${items.length} aircraft in zone`;
      }
    }

    // Update filter count display
    const countEl = document.getElementById("wz-parcoords-filter-count");
    const resetBtn = document.getElementById("wz-parcoords-reset-btn");
    if (filterSet) {
      if (countEl) countEl.textContent = `${filterSet.size} / ${items.length} filtered`;
      if (resetBtn) resetBtn.style.display = "";
    } else {
      if (countEl) countEl.textContent = "";
      if (resetBtn) resetBtn.style.display = "none";
    }

    // Kollisionsliste neu berechnen wenn Projektion aktiv
    if (_projActive && _projAircraft && _projGhostMarkersRef) {
      const filteredAc = _projAircraft.filter(a => {
        const idx = (WZ._liveAircraftItems || []).indexOf(a);
        return idx < 0 || !filterSet || filterSet.has(idx);
      });
      const newCollisions = _projFindCollisions(filteredAc);
      _projRenderCollisions(newCollisions);
      _projBindHovers(newCollisions, _projAircraft, _projGhostMarkersRef);
      _projCollisionAcMap = new Map();
      newCollisions.forEach(c => {
        const sev = c.dist3dKm < 0.1 ? 'red' : 'orange';
        [c.a, c.b].forEach(ac => {
          const i = (WZ._liveAircraftItems || []).indexOf(ac);
          if (i >= 0 && (!_projCollisionAcMap.has(i) || sev === 'red')) _projCollisionAcMap.set(i, sev);
        });
      });
      if (_parCoordsRedrawFn) _parCoordsRedrawFn();
    }
  }

  function _drawParallelCoords(items) {
    const canvas = document.getElementById("wz-parcoords-canvas");
    const body = document.getElementById("wz-parcoords-body");
    if (!canvas || !body) return;

    const W = body.clientWidth - 20;
    const H = Math.max(180, body.clientHeight - 8);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    const padTop = 48, padBot = 30, padLeft = 30, padRight = 30;
    const plotH = H - padTop - padBot;
    const brushW = 18;

    // Länder-Index aufbauen
    const _countries = [...new Set(items.map(a => a.country || "?").filter(Boolean))].sort();
    const _countryIdx = {}; _countries.forEach((c, i) => _countryIdx[c] = i);

    // Achsen-Definitionen (Reihenfolge veränderbar)
    let axes = [
      { key: "anomaly_score", label: "Score",     fmt: v => Math.round(v) },
      { key: "usage_num",     label: "Usage",     fmt: v => (["PRIV","CIV","COM","MIL"])[Math.round(v)] || "?",
        ticks: [0,1,2,3], tickLabels: ["PRIV","CIV","COM","MIL"] },
      { key: "country_num",   label: "Country",    fmt: v => _countries[Math.round(v)] || "?",
        ticks: _countries.map((_,i) => i), tickLabels: _countries },
      { key: "alt_m",         label: "Alt. (m)",  fmt: v => Math.round(v).toLocaleString(),
        rangeHL: { from: 9000, to: 12800, color: "rgba(34,197,94,.12)", border: "rgba(34,197,94,.35)", label: "Cruise altitude" } },
      { key: "velocity_kmh",  label: "Speed (km/h)", fmt: v => Math.round(v) },
      { key: "heading",       label: "Hdg. (°)",  fmt: v => Math.round(v) },
      { key: "vert_rate",     label: "Vert.rate (m/s)", fmt: v => v.toFixed(1) },
      { key: "rssi",           label: "Signal (dBFS)", fmt: v => v != null ? Math.round(v) : "?" },
    ];

    // Daten vorbereiten
    const data = items.map(a => ({
      raw: a,
      anomaly_score: a.anomaly_score || 0,
      usage_num: ({private:0, civil:1, commercial:2, military:3})[a.usage] ?? 1,
      country_num: _countryIdx[a.country || "?"] ?? 0,
      alt_m: a.alt_m != null ? a.alt_m : null,
      velocity_kmh: a.velocity != null ? a.velocity * 3.6 : null,
      heading: a.heading != null ? a.heading : null,
      vert_rate: a.vert_rate != null ? a.vert_rate : null,
      rssi: a.rssi != null ? a.rssi : null,
    }));

    // Min/Max pro Achse
    function computeMinMax() {
      axes.forEach(ax => {
        if (ax.brushY0 === undefined) { ax.brushY0 = null; ax.brushY1 = null; }
        let vals = data.map(d => d[ax.key]).filter(v => v != null);
        if (!vals.length) vals = [0];
        ax.min = Math.min(...vals);
        ax.max = Math.max(...vals);
        if (ax.max === ax.min) { ax.max += 1; ax.min -= 1; }
      });
    }
    computeMinMax();

    const isDark = document.documentElement.getAttribute("data-theme") !== "light";
    const textColor = isDark ? "#aaa" : "#666";
    const axisColor = isDark ? "#555" : "#ccc";
    const brushColor = isDark ? "rgba(59,130,246,.25)" : "rgba(59,130,246,.18)";
    const brushBorder = "#3b82f6";

    function axisSpacing() { return (W - padLeft - padRight) / (axes.length - 1); }
    function axisX(i) { return padLeft + i * axisSpacing(); }
    function valToY(ax, v) {
      if (v == null) return null;
      return padTop + plotH - ((v - ax.min) / (ax.max - ax.min)) * plotH;
    }
    function yToVal(ax, y) {
      return ax.min + (1 - (y - padTop) / plotH) * (ax.max - ax.min);
    }

    // Prüfe ob Datenpunkt alle Brush-Filter passiert
    function passesBrushes(d) {
      for (let i = 0; i < axes.length; i++) {
        const ax = axes[i];
        if (ax.brushY0 == null) continue;
        const v = d[ax.key];
        if (v == null) return false;
        const y = valToY(ax, v);
        const yMin = Math.min(ax.brushY0, ax.brushY1);
        const yMax = Math.max(ax.brushY0, ax.brushY1);
        if (y < yMin || y > yMax) return false;
      }
      return true;
    }

    function hasBrushes() {
      return axes.some(ax => ax.brushY0 != null);
    }

    // Berechne Linien-Punkte
    function buildLinePaths() {
      return data.map((d, di) => {
        const sc = d.anomaly_score;
        const color = sc >= 30 ? "rgba(239,68,68," : sc >= 15 ? "rgba(249,115,22," : sc >= 5 ? "rgba(234,179,8," : "rgba(59,130,246,";
        const points = axes.map((ax, i) => {
          const y = valToY(ax, d[ax.key]);
          return y != null ? { x: axisX(i), y } : null;
        });
        return { d, points, color, active: passesBrushes(d) };
      });
    }

    let linePaths = buildLinePaths();
    let highlighted = null;
    let pulsePhase = 0;
    let pulseRAF = null;

    // Sync brush filter to map markers + table
    function _syncFilter() {
      if (!hasBrushes()) {
        _applyParCoordsFilter(null);
        return;
      }
      const activeSet = new Set();
      linePaths.forEach((lp, i) => {
        if (lp.active) activeSet.add(items.indexOf(lp.d.raw));
      });
      _applyParCoordsFilter(activeSet);
    }

    // Register reset function for external "Reset" button
    _parCoordsResetFn = function() {
      axes.forEach(ax => { ax.brushY0 = null; ax.brushY1 = null; });
      linePaths = buildLinePaths();
      draw();
      _syncFilter();
    };

    // Externe Funktion: Linien-Farben neu aufbauen und canvas neu zeichnen
    _parCoordsRedrawFn = function() {
      linePaths = buildLinePaths();
      draw();
    };

    // External highlight by item index (from table hover)
    _parCoordsHighlightByIdx = function(idx) {
      if (idx < 0 || idx == null) {
        if (highlighted) { highlighted = null; draw(); }
        return;
      }
      const item = items[idx];
      if (!item) return;
      const lp = linePaths.find(lp => lp.d.raw === item);
      if (lp && lp !== highlighted) {
        highlighted = lp;
        draw();
      }
    };

    // Highlight table row from parallel coords hover
    let _hlRowIdx = -1;
    function _highlightTableRow(idx) {
      const tbody = document.querySelector("#wz-live-content table tbody");
      if (!tbody) return;
      if (_hlRowIdx >= 0) {
        const prev = tbody.querySelectorAll("tr")[_hlRowIdx];
        if (prev) { prev.style.outline = ""; prev.style.background = prev.dataset.origBg || ""; }
      }
      _hlRowIdx = idx;
      if (idx >= 0) {
        const row = tbody.querySelectorAll("tr")[idx];
        if (row) {
          if (!row.dataset.origBg) row.dataset.origBg = row.style.background || "";
          row.style.background = "rgba(124,58,237,.18)";
          row.style.outline = "1px solid rgba(124,58,237,.5)";
        }
      }
    }

    function startPulse() {
      if (pulseRAF) return;
      function tick() {
        pulsePhase = (pulsePhase + 0.07) % (Math.PI * 2);
        draw();
        pulseRAF = requestAnimationFrame(tick);
      }
      pulseRAF = requestAnimationFrame(tick);
    }
    function stopPulse() {
      if (pulseRAF) { cancelAnimationFrame(pulseRAF); pulseRAF = null; }
      pulsePhase = 0;
    }

    // ── Interaktions-State (vor draw() nötig) ──
    let dragAxis = null;
    let dragStartX = 0;
    let dragOrigOrder = null;
    let brushAxis = null;
    let brushStartY = 0;
    let brushMoving = null;
    let mode = null;  // "drag" | "brush" | "brushmove" | null

    // ── Zeichnen ──
    function draw() {
      ctx.clearRect(0, 0, W, H);

      // Achsen + Labels
      axes.forEach((ax, i) => {
        const x = axisX(i);
        const isDragging = mode === "drag" && dragAxis === i;
        const pulseAlpha = isDragging ? 0.5 + 0.5 * Math.sin(pulsePhase) : 0;

        // Achsenlinie
        if (isDragging) {
          ctx.strokeStyle = `rgba(239,68,68,${0.3 + 0.7 * pulseAlpha})`;
          ctx.lineWidth = 3;
        } else {
          ctx.strokeStyle = axisColor;
          ctx.lineWidth = 1;
        }
        ctx.beginPath(); ctx.moveTo(x, padTop); ctx.lineTo(x, padTop + plotH); ctx.stroke();

        // Glow-Effekt bei Drag
        if (isDragging) {
          ctx.save();
          ctx.strokeStyle = `rgba(239,68,68,${0.15 * pulseAlpha})`;
          ctx.lineWidth = 12;
          ctx.beginPath(); ctx.moveTo(x, padTop); ctx.lineTo(x, padTop + plotH); ctx.stroke();
          ctx.restore();
        }

        // Label
        ctx.fillStyle = isDragging ? `rgba(239,68,68,${0.5 + 0.5 * pulseAlpha})` : textColor;
        ctx.font = "bold 11px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(ax.label, x, padTop - 22);
        // Drag-Hinweis
        ctx.fillStyle = isDragging ? `rgba(239,68,68,${0.4 + 0.6 * pulseAlpha})` : (isDark ? "#666" : "#bbb");
        ctx.font = "9px system-ui, sans-serif";
        ctx.fillText("⇔", x, padTop - 10);

        // Werte an der Achse
        ctx.fillStyle = isDragging ? `rgba(239,68,68,${0.5 + 0.5 * pulseAlpha})` : textColor;
        if (ax.ticks && ax.tickLabels) {
          // Diskrete Achse: alle Ticks + Labels
          ctx.font = "9px system-ui, sans-serif";
          ctx.textAlign = "right";
          ax.ticks.forEach((tv, ti) => {
            const ty = valToY(ax, tv);
            if (ty == null) return;
            // Tick-Strich
            ctx.strokeStyle = isDragging ? `rgba(239,68,68,0.4)` : axisColor;
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(x - 4, ty); ctx.lineTo(x + 4, ty); ctx.stroke();
            // Label
            ctx.fillStyle = isDragging ? `rgba(239,68,68,${0.5 + 0.5 * pulseAlpha})` : textColor;
            const lbl = ax.tickLabels[ti] || "";
            ctx.fillText(lbl.length > 8 ? lbl.slice(0,7) + "…" : lbl, x - 7, ty + 3);
          });
          ctx.textAlign = "center";
        } else {
          ctx.font = "10px system-ui, sans-serif";
          ctx.fillText(ax.fmt(ax.max), x, padTop - 1);
          ctx.fillText(ax.fmt(ax.min), x, padTop + plotH + 14);
        }

        // Range-Highlight (z.B. Reiseflughöhe)
        if (ax.rangeHL) {
          const hl = ax.rangeHL;
          const yFrom = valToY(ax, hl.to);  // higher value = lower y
          const yTo = valToY(ax, hl.from);   // lower value = higher y
          if (yFrom != null && yTo != null) {
            const yTop = Math.max(padTop, Math.min(yFrom, yTo));
            const yBot = Math.min(padTop + plotH, Math.max(yFrom, yTo));
            if (yBot > yTop) {
              ctx.fillStyle = hl.color;
              ctx.fillRect(x - brushW, yTop, brushW * 2, yBot - yTop);
              ctx.strokeStyle = hl.border;
              ctx.lineWidth = 1;
              ctx.setLineDash([3, 3]);
              ctx.strokeRect(x - brushW, yTop, brushW * 2, yBot - yTop);
              ctx.setLineDash([]);
              // Label
              ctx.save();
              ctx.font = "8px system-ui, sans-serif";
              ctx.fillStyle = hl.border;
              ctx.textAlign = "left";
              ctx.fillText(hl.label, x + brushW + 3, yTop + (yBot - yTop) / 2 + 3);
              ctx.restore();
            }
          }
        }

        // Brush-Bereich zeichnen
        if (ax.brushY0 != null) {
          const yMin = Math.min(ax.brushY0, ax.brushY1);
          const yMax = Math.max(ax.brushY0, ax.brushY1);
          ctx.fillStyle = brushColor;
          ctx.fillRect(x - brushW / 2, yMin, brushW, yMax - yMin);
          ctx.strokeStyle = brushBorder;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(x - brushW / 2, yMin, brushW, yMax - yMin);

          // Wert-Labels am Brush
          ctx.fillStyle = brushBorder;
          ctx.font = "bold 9px system-ui, sans-serif";
          ctx.textAlign = "left";
          const vHi = ax.fmt(yToVal(ax, yMin));
          const vLo = ax.fmt(yToVal(ax, yMax));
          ctx.fillText(vHi, x + brushW / 2 + 3, yMin + 3);
          ctx.fillText(vLo, x + brushW / 2 + 3, yMax + 3);
          ctx.textAlign = "center";
        }
      });

      const useBrush = hasBrushes();

      // 1) Inaktive Linien (grau/gedimmt)
      linePaths.forEach(lp => {
        if (lp === highlighted) return;
        if (useBrush && lp.active) return; // aktive später in Rot
        const dimByHover = highlighted && lp !== highlighted;
        const alpha = (useBrush || dimByHover) ? "0.06)" : "0.8)";
        ctx.strokeStyle = lp.color + alpha;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        let started = false;
        lp.points.forEach(p => {
          if (!p) { started = false; return; }
          if (!started) { ctx.moveTo(p.x, p.y); started = true; }
          else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();
      });

      // 2) Aktive (gefilterte) Linien in Rot
      if (useBrush) {
        linePaths.forEach(lp => {
          if (!lp.active || lp === highlighted) return;
          ctx.strokeStyle = "rgba(239,68,68,0.7)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          let started = false;
          lp.points.forEach(p => {
            if (!p) { started = false; return; }
            if (!started) { ctx.moveTo(p.x, p.y); started = true; }
            else ctx.lineTo(p.x, p.y);
          });
          ctx.stroke();
        });
      }

      // 3) Hover-Highlight oben drauf
      if (highlighted) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 5;
        ctx.beginPath();
        let started = false;
        highlighted.points.forEach(p => {
          if (!p) { started = false; return; }
          if (!started) { ctx.moveTo(p.x, p.y); started = true; }
          else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();

        ctx.strokeStyle = useBrush && highlighted.active ? "rgba(239,68,68,1)" : highlighted.color + "1)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        started = false;
        highlighted.points.forEach(p => {
          if (!p) { started = false; return; }
          if (!started) { ctx.moveTo(p.x, p.y); started = true; }
          else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();

        highlighted.points.forEach(p => {
          if (!p) return;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
          ctx.fillStyle = useBrush && highlighted.active ? "rgba(239,68,68,1)" : highlighted.color + "1)";
          ctx.fill();
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        });
      }

      // Gefilterte Anzahl anzeigen wenn Brush aktiv
      if (useBrush) {
        const active = linePaths.filter(lp => lp.active).length;
        ctx.fillStyle = brushBorder;
        ctx.font = "bold 11px system-ui, sans-serif";
        ctx.textAlign = "right";
        ctx.fillText(`${active} / ${linePaths.length} filtered`, W - padRight, padTop - 30);
        ctx.textAlign = "center";
      }

      // Kollisions-Linien: separater Pass mit Glow + hoher Sichtbarkeit
      if (_projCollisionAcMap && _projCollisionAcMap.size > 0) {
        linePaths.forEach(lp => {
          const acIdx = items.indexOf(lp.d.raw);
          const sev = _projCollisionAcMap.get(acIdx);
          if (!sev) return;
          const rgb = sev === 'red' ? "239,68,68" : "249,115,22";
          const mainAlpha = _projBlinkOn ? 1 : 0.07;
          const glowAlpha = _projBlinkOn ? 0.35 : 0;
          const drawLine = (w, a) => {
            ctx.lineWidth = w;
            ctx.strokeStyle = `rgba(${rgb},${a})`;
            ctx.beginPath();
            let s = false;
            lp.points.forEach(p => {
              if (!p) { s = false; return; }
              if (!s) { ctx.moveTo(p.x, p.y); s = true; } else ctx.lineTo(p.x, p.y);
            });
            ctx.stroke();
          };
          drawLine(14, glowAlpha);  // äußerer Glow
          drawLine(4,  mainAlpha);  // Hauptlinie
        });
      }
    }

    draw();

    // ── Interaktion: Drag (Achsen vertauschen), Brush, Hover ──
    function findAxis(mx) {
      const sp = axisSpacing();
      for (let i = 0; i < axes.length; i++) {
        if (Math.abs(axisX(i) - mx) < sp * 0.35) return i;
      }
      return -1;
    }

    function isOnBrushHandle(ax, axIdx, mx, my) {
      if (ax.brushY0 == null) return false;
      const x = axisX(axIdx);
      if (Math.abs(mx - x) > brushW) return false;
      const yMin = Math.min(ax.brushY0, ax.brushY1);
      const yMax = Math.max(ax.brushY0, ax.brushY1);
      return my >= yMin - 4 && my <= yMax + 4;
    }

    canvas.onmousedown = function(e) {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const axIdx = findAxis(mx);

      // Label-Bereich = Drag zum Vertauschen
      if (my < padTop - 5 && axIdx >= 0) {
        mode = "drag";
        dragAxis = axIdx;
        dragStartX = mx;
        dragOrigOrder = axes.map(a => a.key);
        canvas.style.cursor = "grabbing";
        startPulse();
        return;
      }

      // Auf bestehendem Brush = Brush verschieben
      if (axIdx >= 0 && isOnBrushHandle(axes[axIdx], axIdx, mx, my)) {
        mode = "brushmove";
        brushMoving = {
          axIdx,
          startY0: axes[axIdx].brushY0,
          startY1: axes[axIdx].brushY1,
          grabY: my
        };
        canvas.style.cursor = "ns-resize";
        return;
      }

      // Auf Achse = neuen Brush starten
      if (axIdx >= 0 && my >= padTop && my <= padTop + plotH) {
        mode = "brush";
        brushAxis = axIdx;
        brushStartY = my;
        axes[axIdx].brushY0 = my;
        axes[axIdx].brushY1 = my;
        canvas.style.cursor = "crosshair";
        return;
      }
    };

    canvas.onmousemove = function(e) {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      if (mode === "drag" && dragAxis != null) {
        // Welche Achse liegt am nächsten zur aktuellen Maus-X?
        let targetIdx = dragAxis;
        let minDist = Infinity;
        for (let i = 0; i < axes.length; i++) {
          const d = Math.abs(axisX(i) - mx);
          if (d < minDist) { minDist = d; targetIdx = i; }
        }
        if (targetIdx !== dragAxis) {
          const moved = axes.splice(dragAxis, 1)[0];
          axes.splice(targetIdx, 0, moved);
          dragAxis = targetIdx;
          linePaths = buildLinePaths();
          draw();
        }
        return;
      }

      if (mode === "brush" && brushAxis != null) {
        const clamped = Math.max(padTop, Math.min(padTop + plotH, my));
        axes[brushAxis].brushY1 = clamped;
        linePaths = buildLinePaths();
        draw();
        _syncFilter();
        return;
      }

      if (mode === "brushmove" && brushMoving) {
        const dy = my - brushMoving.grabY;
        let y0 = brushMoving.startY0 + dy;
        let y1 = brushMoving.startY1 + dy;
        const yMin = Math.min(y0, y1);
        const yMax = Math.max(y0, y1);
        if (yMin < padTop) { const shift = padTop - yMin; y0 += shift; y1 += shift; }
        if (yMax > padTop + plotH) { const shift = yMax - padTop - plotH; y0 -= shift; y1 -= shift; }
        axes[brushMoving.axIdx].brushY0 = y0;
        axes[brushMoving.axIdx].brushY1 = y1;
        linePaths = buildLinePaths();
        draw();
        _syncFilter();
        return;
      }

      // Hover (kein Drag/Brush aktiv)
      if (!mode) {
        // Cursor anpassen
        const axIdx = findAxis(mx);
        if (my < padTop - 5 && axIdx >= 0) {
          canvas.style.cursor = "grab";
        } else if (axIdx >= 0 && isOnBrushHandle(axes[axIdx], axIdx, mx, my)) {
          canvas.style.cursor = "ns-resize";
        } else if (axIdx >= 0 && my >= padTop && my <= padTop + plotH) {
          canvas.style.cursor = "crosshair";
        } else {
          canvas.style.cursor = "default";
        }

        // Linien-Hover
        let closest = null, closestDist = 20;
        linePaths.forEach(lp => {
          if (hasBrushes() && !lp.active) return;
          lp.points.forEach(p => {
            if (!p) return;
            const d = Math.abs(p.x - mx) + Math.abs(p.y - my);
            if (d < closestDist) { closestDist = d; closest = lp; }
          });
        });

        if (closest !== highlighted) {
          // Unhighlight previous
          if (highlighted) {
            const prevIdx = items.indexOf(highlighted.d.raw);
            if (prevIdx >= 0 && typeof wzUnhighlightMarker === "function") wzUnhighlightMarker(prevIdx);
          }
          highlighted = closest;
          draw();
          // Highlight new on map + table
          if (highlighted) {
            const newIdx = items.indexOf(highlighted.d.raw);
            if (newIdx >= 0 && typeof wzHighlightMarker === "function") wzHighlightMarker(newIdx);
            _highlightTableRow(newIdx);
          } else {
            _highlightTableRow(-1);
          }

          const tip = document.getElementById("wz-parcoords-tooltip");
          if (highlighted) {
            const a = highlighted.d.raw;
            const d = highlighted.d;
            tip.style.display = "block";
            tip.style.left = (mx + 14) + "px";
            tip.style.top = (my - 10) + "px";
            const usageMap = {private:"Privat",civil:"Zivil",commercial:"Kommerziell",military:"Militär"};
            tip.innerHTML = `<strong style="font-size:12px;">${WZ._esc(a.callsign || "–")}</strong> <span style="color:var(--muted);">${WZ._esc(a.reg || "")}</span>
              ${a.type ? `<br><span style="color:var(--muted);">Typ:</span> ${WZ._esc(a.type)}` : ""}
              ${a.operator ? `<br><span style="color:var(--muted);">Betreiber:</span> ${WZ._esc(a.operator)}` : ""}
              <br><span style="color:var(--muted);">Score:</span> <strong>${a.anomaly_score || 0}</strong>
              &nbsp;·&nbsp;<span style="color:var(--muted);">Nutzung:</span> ${usageMap[a.usage] || a.usage || "–"}
              <br><span style="color:var(--muted);">Land:</span> ${WZ._esc(a.country || "–")}
              &nbsp;·&nbsp;<span style="color:var(--muted);">Höhe:</span> ${a.alt_m != null ? Math.round(a.alt_m).toLocaleString() + " m" : "–"}
              <br><span style="color:var(--muted);">Geschw.:</span> ${a.velocity != null ? Math.round(a.velocity * 3.6) + " km/h" : "–"}
              &nbsp;·&nbsp;<span style="color:var(--muted);">Kurs:</span> ${a.heading != null ? Math.round(a.heading) + "°" : "–"}
              <br><span style="color:var(--muted);">Vert.rate:</span> ${a.vert_rate != null ? a.vert_rate.toFixed(1) + " m/s" : "–"}
              &nbsp;·&nbsp;<span style="color:var(--muted);">Signal:</span> ${a.rssi != null ? Math.round(a.rssi) + " dBFS" : "–"}
              ${a.anomaly_flags && a.anomaly_flags.length ? "<br><span style='color:#ef4444;font-size:10px;'>" + WZ._esc(a.anomaly_flags.join(", ")) + "</span>" : ""}`;
          } else {
            tip.style.display = "none";
          }
        } else if (highlighted) {
          const tip = document.getElementById("wz-parcoords-tooltip");
          tip.style.left = (mx + 14) + "px";
          tip.style.top = (my - 10) + "px";
        }
      }
    };

    let wasDragging = false;

    canvas.onmouseup = function(e) {
      wasDragging = mode != null;
      if (mode === "brush" && brushAxis != null) {
        const ax = axes[brushAxis];
        // Zu kleiner Brush = Brush löschen (Klick ohne Ziehen)
        if (Math.abs(ax.brushY0 - ax.brushY1) < 5) {
          ax.brushY0 = null;
          ax.brushY1 = null;
          linePaths = buildLinePaths();
          draw();
          _syncFilter();
          wasDragging = false; // war nur ein Klick, kein echtes Drag
        }
      }
      _syncFilter();
      stopPulse();
      mode = null;
      dragAxis = null;
      brushAxis = null;
      brushMoving = null;
      canvas.style.cursor = "default";
    };

    canvas.onmouseleave = function() {
      if (highlighted) {
        const idx = items.indexOf(highlighted.d.raw);
        if (idx >= 0 && typeof wzUnhighlightMarker === "function") wzUnhighlightMarker(idx);
      }
      _highlightTableRow(-1);
      stopPulse();
      highlighted = null;
      draw();
      const tip = document.getElementById("wz-parcoords-tooltip");
      if (tip) tip.style.display = "none";
      if (mode) {
        mode = null; dragAxis = null; brushAxis = null; brushMoving = null;
      }
    };

    // Doppelklick auf Achse = Brush löschen
    canvas.ondblclick = function(e) {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const axIdx = findAxis(mx);
      if (axIdx >= 0 && axes[axIdx].brushY0 != null) {
        axes[axIdx].brushY0 = null;
        axes[axIdx].brushY1 = null;
        linePaths = buildLinePaths();
        draw();
        _syncFilter();
      }
    };

    // Klick öffnet Detail (nur bei echtem Klick, nicht nach Drag/Brush)
    canvas.onclick = function(e) {
      if (wasDragging) { wasDragging = false; return; }
      if (!highlighted) return;
      const idx = items.indexOf(highlighted.d.raw);
      if (idx >= 0) wzShowAircraftDetail(idx);
    };
  }


  // ── Callback registrations ─────────────────────────────────────────
  WZ._onLiveClose.push(function() {
    _wzDistReset();
    WZ._parCoordsOpen = false;
    _parCoordsFilterFn = null;
    _parCoordsResetFn = null;
    _parCoordsHighlightByIdx = null;
    _wzProjStop();
    _wzDestroyCesium();
    _acReturnToStore();
  });

  WZ._onLiveReset.push(function() {
    if (WZ._heatLayer && WZ._liveMap) { WZ._liveMap.removeLayer(WZ._heatLayer); WZ._heatLayer = null; }
    WZ._heatActive = false;
    var heatBtn = document.getElementById("wz-heatmap-btn");
    if (heatBtn) { heatBtn.style.background = '#0891b2'; heatBtn.textContent = t('wz_btn_heatmap_on','🌡 Density Map'); }
    _wzProjStop();
    var _projPanelReset = document.getElementById("wz-projection-panel");
    if (_projPanelReset) _projPanelReset.style.display = "none";
    var _dmb2 = document.getElementById("wz-dist-mapbtn");
    if (_dmb2) _dmb2.style.display = "none";
    _wzDistReset();
  });

  WZ._onResizeParcoords.push(function() {
    if (WZ._parCoordsOpen) _drawParallelCoords(WZ._liveAircraftItems);
  });

  // ── Fullscreen Side-by-Side (Aircraft only) ──────────────────────────
  WZ._onFullscreenChange.push(function(isLiveOverlayFS) {
    var isWide = window.innerWidth >= 1200;
    // Nur aktiv wenn Aircraft-Plugin gerade angezeigt wird
    var isAircraft = document.getElementById("wz-parcoords-inline");

    if (isLiveOverlayFS && isWide && isAircraft) {
      WZ._fsSideBySide = true;
      setTimeout(function() {
        var box = document.getElementById("wz-live-box");
        var parcoords = document.getElementById("wz-parcoords-inline");
        var resizeH = document.getElementById("wz-resize-parcoords");
        var sticky = document.getElementById("wz-live-sticky");
        var body = document.getElementById("wz-live-body");
        if (!box || !parcoords || !sticky || !body) return;

        var row = document.createElement("div");
        row.id = "wz-fs-row";
        var right = document.createElement("div");
        right.id = "wz-lower-right";
        right.className = "wz-fs-right";

        // Höhe: Unterkante Karte bis Unterkante Box
        var boxRect = box.getBoundingClientRect();
        var mapRow = document.getElementById("wz-map-row");
        var refBottom = mapRow ? mapRow.getBoundingClientRect().bottom : boxRect.top;
        var underMap = document.getElementById("wz-under-map-bar");
        if (underMap && underMap.offsetHeight > 0) refBottom = underMap.getBoundingClientRect().bottom;
        var availH = boxRect.bottom - refBottom;
        row.style.cssText = "display:flex;flex-direction:row;height:" + availH + "px;overflow:hidden;";

        parcoords.parentNode.insertBefore(row, parcoords);
        row.appendChild(parcoords);
        if (resizeH) resizeH.style.display = "none";
        right.appendChild(sticky);
        right.appendChild(body);
        row.appendChild(right);

        var pcBtn = document.querySelector("[data-parcoords-btn]");
        if (pcBtn) pcBtn.style.display = "none";

        if (!WZ._parCoordsOpen && window.wzShowParallelCoords) wzShowParallelCoords();

        parcoords.style.width = "50%";
        parcoords.style.height = "100%";
        parcoords.style.flex = "none";
        parcoords.style.display = "flex";
        parcoords.style.flexDirection = "column";
        parcoords.style.borderRight = "1px solid var(--border)";
        parcoords.style.overflow = "hidden";
        var pcBody = document.getElementById("wz-parcoords-body");
        if (pcBody) { pcBody.style.flex = "1"; pcBody.style.height = "0"; pcBody.style.minHeight = "0"; }
        var closeBtn = parcoords.querySelector("[data-parcoords-close]");
        if (closeBtn) closeBtn.style.display = "none";

        setTimeout(function() {
          if (WZ._onResizeParcoords) WZ._onResizeParcoords.forEach(function(fn) { fn(); });
        }, 150);
      }, 200);
    } else if (WZ._fsSideBySide) {
      WZ._fsSideBySide = false;
      var row = document.getElementById("wz-fs-row");
      var box2 = document.getElementById("wz-live-box");
      if (row && box2) {
        var parcoords = document.getElementById("wz-parcoords-inline");
        var resizeH = document.getElementById("wz-resize-parcoords");
        var sticky = document.getElementById("wz-live-sticky");
        var body = document.getElementById("wz-live-body");
        row.parentNode.insertBefore(parcoords, row);
        if (resizeH) row.parentNode.insertBefore(resizeH, row);
        row.parentNode.insertBefore(sticky, row);
        row.parentNode.insertBefore(body, row);
        var right = document.getElementById("wz-lower-right");
        if (right) right.remove();
        row.remove();
        parcoords.style.cssText = "display:none;height:320px;min-height:80px;flex-shrink:0;overflow:hidden;background:var(--surface);position:relative;";
        var pcBody = document.getElementById("wz-parcoords-body");
        if (pcBody) { pcBody.style.flex = ""; pcBody.style.height = ""; pcBody.style.minHeight = ""; }
        var closeBtn = parcoords.querySelector("[data-parcoords-close]");
        if (closeBtn) closeBtn.style.display = "";
      }
      var pcBtn2 = document.querySelector("[data-parcoords-btn]");
      if (pcBtn2) pcBtn2.style.display = "";
      if (WZ._parCoordsOpen && window.wzToggleParCoords) wzToggleParCoords();
    }
  });

  WZ.registerPlugin("aircraft", {
    renderer: _renderAircraftLive,
    has_heatmap: true,
    has_projection: true,
    has_refresh_bar: true,
    default_source: "adsbexchange",
  });

})();
