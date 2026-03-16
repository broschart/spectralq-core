/**
 * WZ Module: vessel renderer.
 */
(function() {
"use strict";
var WZ = window.WZ;

  // ── Schiffe rendern ────────────────────────────────────────────────────
  WZ._liveVesselItems = [];

  function _vesselUsageBadge(usage) {
    const map = {
      military:   {label: "MIL",   bg: "#dc2626"},
      government: {label: "GOV",   bg: "var(--accent1)"},
      passenger:  {label: "PAX",   bg: "#2563eb"},
      cargo:      {label: "CARGO", bg: "#d97706"},
      tanker:     {label: "TANK",  bg: "#b45309"},
      fishing:    {label: "FISH",  bg: "#16a34a"},
      tug:        {label: "TUG",   bg: "#6b7280"},
      sailing:    {label: "SAIL",  bg: "#0891b2"},
      pleasure:   {label: "SPORT", bg: "#0891b2"},
      hsc:        {label: "HSC",   bg: "#e11d48"},
      pilot:      {label: "PILOT", bg: "var(--accent1)"},
      other:      {label: "SONST", bg: "#6b7280"},
    };
    const m = map[usage] || map.other;
    return `<span style="display:inline-block;background:${m.bg};color:#fff;
              font-size:9px;font-weight:700;padding:1px 5px;border-radius:6px;white-space:nowrap;">${m.label}</span>`;
  }

  function _vesselColor(usage) {
    const map = { military:"#dc2626", government:"var(--accent1)", passenger:"#2563eb",
      cargo:"#d97706", tanker:"#b45309", fishing:"#16a34a", tug:"#6b7280",
      sailing:"#0891b2", pleasure:"#0891b2", hsc:"#e11d48", pilot:"var(--accent1)" };
    return map[usage] || "#3b82f6";
  }

  function _renderVesselLive(data) {
    const items = data.items || [];
    WZ._liveVesselItems = items;
    const anomCount = items.filter(v => v.anomaly_score > 0).length;
    document.getElementById("wz-live-count").textContent =
      items.length + " " + t('wz_vessel_ships','vessels') + (anomCount ? ` (${anomCount} ${t('wz_vessel_anomalous','anomalous')})` : "");
    if (WZ._liveMarkers) WZ._liveMarkers.clearLayers();

    items.forEach((v, idx) => {
      const sc = v.anomaly_score || 0;
      const col = sc >= 30 ? "#ef4444" : sc >= 15 ? "#f97316" : sc >= 5 ? "#eab308" : _vesselColor(v.usage);
      const icon = L.divIcon({
        className: "",
        html: `<div style="transform:rotate(${v.course || 0}deg);font-size:16px;color:${col};text-shadow:0 1px 3px rgba(0,0,0,.6);cursor:pointer;">&#9875;</div>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });
      const m = L.marker([v.lat, v.lon], { icon: icon });
      m.on("click", () => wzShowVesselDetail(idx));
      if (WZ._liveMarkers) WZ._liveMarkers.addLayer(m);
    });

    if (WZ._liveMap && WZ._liveMarkers && WZ._liveMarkers.getLayers().length) {
      WZ._liveMap.fitBounds(WZ._liveMarkers.getBounds(), { padding: [30, 30], maxZoom: 12 });
    }
    WZ._updateZoneTimeLabel(items);

    const content = document.getElementById("wz-live-content");
    if (!items.length) {
      content.innerHTML = `<p style="color:var(--muted);text-align:center;padding:12px;">${t('wz_vessel_empty','No vessels found in this zone.')}</p>`;
      return;
    }
    content.innerHTML = `
      <div style="display:flex;justify-content:flex-start;padding:6px 8px 2px;">
        <button onclick="wzShowVesselParCoords()" style="background:var(--accent1);color:#fff;border:none;border-radius:6px;
          padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:6px;">
          ${t('wz_vessel_analyse','⫼ Analyse Vessel Traffic')}
        </button>
      </div>
      <table style="width:100%;font-size:12px;border-collapse:collapse;">
        <thead><tr style="border-bottom:2px solid var(--border);color:var(--muted);text-align:left;">
          <th style="padding:6px 8px;width:32px;">Score</th>
          <th style="padding:6px 8px;">${t('wz_vessel_th_type','Type')}</th>
          <th style="padding:6px 8px;">Name</th>
          <th style="padding:6px 8px;">MMSI</th>
          <th style="padding:6px 8px;">${t('wz_vessel_th_flag','Flag')}</th>
          <th style="padding:6px 8px;">${t('wz_vessel_th_speed','Speed')}</th>
          <th style="padding:6px 8px;">${t('wz_vessel_th_course','Course')}</th>
          <th style="padding:6px 8px;">${t('wz_vessel_th_dest','Dest.')}</th>
          <th style="padding:6px 8px;">${t('wz_vessel_th_anomalies','Anomalies')}</th>
        </tr></thead>
        <tbody>${items.map((v, idx) => {
          const sc = v.anomaly_score || 0;
          const rowBg = sc >= 30 ? "rgba(239,68,68,.12)" : sc >= 15 ? "rgba(249,115,22,.08)" : sc >= 5 ? "rgba(234,179,8,.06)" : "";
          return `
          <tr style="border-bottom:1px solid var(--border);background:${rowBg};cursor:pointer;"
              onclick="wzShowVesselDetail(${idx})" title="${t('wz_show_details','Show details')}">
            <td style="padding:5px 8px;text-align:center;">${WZ._anomalyBadge(sc) || '<span style="color:var(--muted);">–</span>'}</td>
            <td style="padding:5px 8px;text-align:center;">${_vesselUsageBadge(v.usage)}</td>
            <td style="padding:5px 8px;font-weight:600;">${WZ._esc(v.name || "–")}</td>
            <td style="padding:5px 8px;color:var(--muted);">${WZ._esc(String(v.mmsi))}</td>
            <td style="padding:5px 8px;">${WZ._esc(v.flag || "–")}</td>
            <td style="padding:5px 8px;">${v.speed != null ? v.speed + " kn" : "–"}</td>
            <td style="padding:5px 8px;">${v.course != null ? Math.round(v.course) + "°" : "–"}</td>
            <td style="padding:5px 8px;">${WZ._esc(v.dest || "–")}</td>
            <td style="padding:5px 8px;font-size:11px;color:#ef4444;max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
                title="${WZ._esc((v.anomaly_flags||[]).join(', '))}">${v.anomaly_flags && v.anomaly_flags.length ? WZ._esc(v.anomaly_flags.join(", ")) : '<span style="color:var(--muted);">–</span>'}</td>
          </tr>`;
        }).join("")}
        </tbody>
      </table>`;
  }

  // ── Schiffs-Detail-Popup ───────────────────────────────────────────────
  window.wzShowVesselDetail = function(idx) {
    const v = WZ._liveVesselItems[idx];
    if (!v) return;

    const sc = v.anomaly_score || 0;
    const borderColor = WZ._anomalyColor(sc);
    const vCol = _vesselColor(v.usage);
    const spd = v.speed != null ? v.speed + " kn" : "–";
    const spdKmh = v.speed != null ? (v.speed * 1.852).toFixed(1) + " km/h" : "–";

    let existing = document.getElementById("wz-vessel-detail");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "wz-vessel-detail";
    overlay.style.cssText = "position:fixed;inset:0;z-index:10003;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;";
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };

    const hasMap = v.lat != null && v.lon != null;

    overlay.innerHTML = `
      <div style="background:var(--surface);border:1px solid var(--border);border-top:3px solid ${sc > 0 ? borderColor : vCol};
                  border-radius:12px;width:94%;max-width:1000px;max-height:85vh;overflow-y:auto;
                  box-shadow:0 12px 40px rgba(0,0,0,.4);padding:0;">
        <!-- Header -->
        <div style="padding:14px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;">
          <div style="font-size:22px;transform:rotate(${(v.course || 0)}deg);color:${vCol};">&#9875;</div>
          <div style="flex:1;">
            <div style="font-size:16px;font-weight:700;">${WZ._esc(v.name || t('wz_unknown','Unknown'))} ${WZ._anomalyBadge(sc)} ${_vesselUsageBadge(v.usage)}</div>
            <div style="font-size:12px;color:var(--muted);">MMSI: ${WZ._esc(String(v.mmsi))} · ${WZ._esc(v.flag || t('wz_vessel_no_flag','no flag'))}${v.dest ? " → " + WZ._esc(v.dest) : ""}</div>
          </div>
          <button onclick="document.getElementById('wz-vessel-detail').remove()"
                  style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:20px;padding:4px;">✕</button>
        </div>

        <!-- Karte + Daten nebeneinander -->
        <div style="display:flex;min-height:0;">
          ${hasMap ? `
          <div id="wz-vessel-detail-map" style="flex:1 1 55%;min-height:380px;border-right:1px solid var(--border);"></div>` : ""}

          <div style="${hasMap ? 'flex:0 0 320px;' : 'flex:1;'}overflow-y:auto;max-height:70vh;">
            ${sc > 0 ? `
            <div style="margin:10px 12px;padding:8px 12px;background:${sc >= 30 ? 'rgba(239,68,68,.1)' : sc >= 15 ? 'rgba(249,115,22,.08)' : 'rgba(234,179,8,.06)'};
                        border:1px solid ${borderColor}33;border-radius:8px;">
              <div style="font-size:12px;font-weight:600;color:${borderColor};margin-bottom:3px;">
                ⚠ Anomaly Score: ${sc}/100
              </div>
              <ul style="margin:0;padding:0 0 0 16px;font-size:11px;color:var(--text);">
                ${(v.anomaly_flags || []).map(f => '<li>' + WZ._esc(f) + '</li>').join("")}
              </ul>
            </div>` : ""}

            <div style="padding:8px 12px 14px;display:grid;grid-template-columns:auto 1fr;gap:1px 10px;font-size:12px;">
              ${WZ._detailCell("Name", v.name || "–")}
              ${WZ._detailCell("MMSI", String(v.mmsi))}
              ${WZ._detailCell(t('wz_vessel_usage_label','Usage'), _vesselUsageBadge(v.usage))}
              ${WZ._detailCell(t('wz_vessel_type_label','Vessel type'), String(v.type || "–"))}
              ${WZ._detailCell(t('wz_vessel_flag_label','Flag'), v.flag || "–")}
              <div style="grid-column:1/-1;border-top:1px solid var(--border);margin:4px 0;"></div>
              ${WZ._detailCell(t('wz_vessel_speed_label','Speed'), spd + " (" + spdKmh + ")")}
              ${WZ._detailCell(t('wz_vessel_course_label','Course'), v.course != null ? Math.round(v.course) + "°" : "–")}
              ${WZ._detailCell("Position", v.lat.toFixed(5) + ", " + v.lon.toFixed(5))}
              <div style="grid-column:1/-1;border-top:1px solid var(--border);margin:4px 0;"></div>
              ${WZ._detailCell(t('wz_vessel_dest_label','Destination'), v.dest || "–")}
              <div style="grid-column:1/-1;border-top:1px solid var(--border);margin:4px 0;"></div>
              ${WZ._detailCell(t('wz_vessel_localtime_label','Local time'), v.seen != null
                ? WZ._geoLocalTime(Date.now() - v.seen * 1000, v.lon, false) + t('wz_clock_suffix','')
                : WZ._geoLocalTime(Date.now(), v.lon, false) + t('wz_clock_suffix','') + t('wz_fetch_time_suffix',''))}
            </div>
          </div>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    // Karte mit Schiff + Kursvektor + Reichweitenkreise
    if (hasMap) {
      setTimeout(() => {
        const mapEl = document.getElementById("wz-vessel-detail-map");
        if (!mapEl) return;
        const isDark = document.documentElement.getAttribute("data-theme") !== "light";
        const tileUrl = isDark
          ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
        const detailMap = L.map(mapEl, { zoomControl: true, attributionControl: false });
        L.tileLayer(tileUrl, { maxZoom: 18 }).addTo(detailMap);
        L.control.scale({ metric: true, imperial: false }).addTo(detailMap);

        // Schiffs-Marker
        const markerIcon = L.divIcon({
          className: "",
          html: `<div style="font-size:28px;transform:rotate(${v.course || 0}deg);color:${vCol};
                  text-shadow:0 2px 6px rgba(0,0,0,.5);">&#9875;</div>`,
          iconSize: [28, 28], iconAnchor: [14, 14],
        });
        L.marker([v.lat, v.lon], { icon: markerIcon }).addTo(detailMap);

        // Kursvektor + Reichweitenkreise
        const spdMs = v.speed != null ? v.speed * 0.514444 : 0;  // kn → m/s
        const heading = v.course || 0;

        if (spdMs > 0.5) {
          const dist30 = spdMs * 1800 / 1000;  // km in 30 min
          const dist60 = spdMs * 3600 / 1000;  // km in 60 min
          const R = 6371;
          const lat1 = v.lat * Math.PI / 180;
          const lon1 = v.lon * Math.PI / 180;
          const brng = heading * Math.PI / 180;

          function project(distKm) {
            const d = distKm / R;
            const lat2 = Math.asin(Math.sin(lat1)*Math.cos(d) + Math.cos(lat1)*Math.sin(d)*Math.cos(brng));
            const lon2 = lon1 + Math.atan2(Math.sin(brng)*Math.sin(d)*Math.cos(lat1), Math.cos(d)-Math.sin(lat1)*Math.sin(lat2));
            return [lat2*180/Math.PI, lon2*180/Math.PI];
          }

          const pos30 = project(dist30);
          const pos60 = project(dist60);

          // Gestrichelte Kurslinie
          L.polyline([[v.lat, v.lon], pos60], {
            color: vCol, weight: 2, dashArray: "8,6", opacity: 0.7
          }).addTo(detailMap);

          // Reichweitenkreise (30 + 60 min)
          L.circle([v.lat, v.lon], {
            radius: dist30 * 1000, color: vCol, weight: 1, dashArray: "6,4",
            fillColor: vCol, fillOpacity: 0.04, interactive: false,
          }).addTo(detailMap);
          L.circle([v.lat, v.lon], {
            radius: dist60 * 1000, color: vCol, weight: 1, dashArray: "6,4",
            fillColor: vCol, fillOpacity: 0.02, interactive: false,
          }).addTo(detailMap);

          // Karte auf Reichweite zoomen
          const dDeg = dist60 / 111.32 * 1.3;
          const cosLat = Math.cos(v.lat * Math.PI / 180);
          detailMap.fitBounds([
            [v.lat - dDeg, v.lon - dDeg / cosLat],
            [v.lat + dDeg, v.lon + dDeg / cosLat]
          ], { padding: [30, 30], maxZoom: 11 });
        } else {
          detailMap.setView([v.lat, v.lon], 12);
        }

        setTimeout(() => detailMap.invalidateSize(), 100);

        const obs = new MutationObserver(() => {
          if (!document.getElementById("wz-vessel-detail")) {
            detailMap.remove();
            obs.disconnect();
          }
        });
        obs.observe(document.body, { childList: true });
      }, 50);
    }
  };

  // ── Schiffs-Parallele-Koordinaten ──────────────────────────────────────
  window.wzShowVesselParCoords = function() {
    const items = WZ._liveVesselItems;
    if (!items || !items.length) return;

    let existing = document.getElementById("wz-vessel-parcoords-overlay");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "wz-vessel-parcoords-overlay";
    overlay.style.cssText = "position:fixed;inset:0;z-index:10002;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;";
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };

    overlay.innerHTML = `
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;
                  width:96%;max-width:1400px;max-height:90vh;overflow:hidden;
                  box-shadow:0 12px 40px rgba(0,0,0,.4);display:flex;flex-direction:column;">
        <div style="padding:12px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;">
          <span style="font-size:15px;font-weight:700;flex:1;">Schiffsverkehr-Analyse – ${items.length} Schiffe</span>
          <button onclick="document.getElementById('wz-vessel-parcoords-overlay').remove()"
                  style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:20px;padding:4px;">✕</button>
        </div>
        <div id="wz-vessel-parcoords-body" style="flex:1;overflow:auto;padding:10px 20px 20px;position:relative;">
          <canvas id="wz-vessel-parcoords-canvas"></canvas>
          <div id="wz-vessel-parcoords-tooltip" style="display:none;position:absolute;z-index:10;background:var(--surface);
            border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:11px;
            box-shadow:0 4px 12px rgba(0,0,0,.3);pointer-events:none;white-space:nowrap;"></div>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    setTimeout(() => _drawVesselParCoords(items), 30);
  };

  function _drawVesselParCoords(items) {
    const canvas = document.getElementById("wz-vessel-parcoords-canvas");
    const body = document.getElementById("wz-vessel-parcoords-body");
    if (!canvas || !body) return;

    const W = body.clientWidth - 40;
    const H = Math.max(420, Math.min(600, window.innerHeight * 0.6));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    const padTop = 48, padBot = 30, padLeft = 30, padRight = 30;
    const plotH = H - padTop - padBot;
    const brushW = 18;

    const _USAGE_MAP = {fishing:0,pleasure:1,sailing:2,tug:3,other:4,pilot:5,hsc:6,government:7,passenger:8,cargo:9,tanker:10,military:11};

    let axes = [
      { key: "anomaly_score", label: "Score",      fmt: v => Math.round(v) },
      { key: "usage_num",     label: "Nutzung",    fmt: v => (["FISH","SPORT","SAIL","TUG","SONST","PILOT","HSC","GOV","PAX","CARGO","TANK","MIL"])[Math.round(v)] || "?" },
      { key: "speed_kn",      label: "Geschw. (kn)", fmt: v => v.toFixed(1) },
      { key: "course",        label: "Kurs (°)",   fmt: v => Math.round(v) },
    ];

    const data = items.map(v => ({
      raw: v,
      anomaly_score: v.anomaly_score || 0,
      usage_num: _USAGE_MAP[v.usage] ?? 4,
      speed_kn: v.speed != null ? parseFloat(v.speed) : null,
      course: v.course != null ? v.course : null,
    }));

    // State vars (before draw)
    let dragAxis = null, dragStartX = 0, dragOrigOrder = null;
    let brushAxis = null, brushStartY = 0, brushMoving = null;
    let mode = null;
    let pulsePhase = 0, pulseRAF = null;

    function startPulse() {
      if (pulseRAF) return;
      function tick() { pulsePhase = (pulsePhase + 0.07) % (Math.PI * 2); draw(); pulseRAF = requestAnimationFrame(tick); }
      pulseRAF = requestAnimationFrame(tick);
    }
    function stopPulse() { if (pulseRAF) { cancelAnimationFrame(pulseRAF); pulseRAF = null; } pulsePhase = 0; }

    function computeMinMax() {
      axes.forEach(ax => {
        if (ax.brushY0 === undefined) { ax.brushY0 = null; ax.brushY1 = null; }
        let vals = data.map(d => d[ax.key]).filter(v => v != null);
        if (!vals.length) vals = [0];
        ax.min = Math.min(...vals); ax.max = Math.max(...vals);
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
    function valToY(ax, v) { if (v == null) return null; return padTop + plotH - ((v - ax.min) / (ax.max - ax.min)) * plotH; }
    function yToVal(ax, y) { return ax.min + (1 - (y - padTop) / plotH) * (ax.max - ax.min); }

    function passesBrushes(d) {
      for (let i = 0; i < axes.length; i++) {
        const ax = axes[i]; if (ax.brushY0 == null) continue;
        const v = d[ax.key]; if (v == null) return false;
        const y = valToY(ax, v);
        const yMin = Math.min(ax.brushY0, ax.brushY1), yMax = Math.max(ax.brushY0, ax.brushY1);
        if (y < yMin || y > yMax) return false;
      }
      return true;
    }
    function hasBrushes() { return axes.some(ax => ax.brushY0 != null); }

    function buildLinePaths() {
      return data.map((d, di) => {
        const sc = d.anomaly_score;
        const color = sc >= 30 ? "rgba(239,68,68," : sc >= 15 ? "rgba(249,115,22," : sc >= 5 ? "rgba(234,179,8," : "rgba(59,130,246,";
        const points = axes.map((ax, i) => { const y = valToY(ax, d[ax.key]); return y != null ? { x: axisX(i), y } : null; });
        return { d, points, color, active: passesBrushes(d) };
      });
    }

    let linePaths = buildLinePaths();
    let highlighted = null;

    function draw() {
      ctx.clearRect(0, 0, W, H);
      axes.forEach((ax, i) => {
        const x = axisX(i);
        const isDragging = mode === "drag" && dragAxis === i;
        const pulseAlpha = isDragging ? 0.5 + 0.5 * Math.sin(pulsePhase) : 0;
        if (isDragging) { ctx.strokeStyle = `rgba(239,68,68,${0.3 + 0.7 * pulseAlpha})`; ctx.lineWidth = 3; }
        else { ctx.strokeStyle = axisColor; ctx.lineWidth = 1; }
        ctx.beginPath(); ctx.moveTo(x, padTop); ctx.lineTo(x, padTop + plotH); ctx.stroke();
        if (isDragging) { ctx.save(); ctx.strokeStyle = `rgba(239,68,68,${0.15 * pulseAlpha})`; ctx.lineWidth = 12; ctx.beginPath(); ctx.moveTo(x, padTop); ctx.lineTo(x, padTop + plotH); ctx.stroke(); ctx.restore(); }
        ctx.fillStyle = isDragging ? `rgba(239,68,68,${0.5 + 0.5 * pulseAlpha})` : textColor;
        ctx.font = "bold 11px system-ui, sans-serif"; ctx.textAlign = "center";
        ctx.fillText(ax.label, x, padTop - 22);
        ctx.fillStyle = isDragging ? `rgba(239,68,68,${0.4 + 0.6 * pulseAlpha})` : (isDark ? "#666" : "#bbb");
        ctx.font = "9px system-ui, sans-serif"; ctx.fillText("⇔", x, padTop - 10);
        ctx.fillStyle = isDragging ? `rgba(239,68,68,${0.5 + 0.5 * pulseAlpha})` : textColor;
        ctx.font = "10px system-ui, sans-serif";
        ctx.fillText(ax.fmt(ax.max), x, padTop - 1);
        ctx.fillText(ax.fmt(ax.min), x, padTop + plotH + 14);
        if (ax.brushY0 != null) {
          const yMin = Math.min(ax.brushY0, ax.brushY1), yMax = Math.max(ax.brushY0, ax.brushY1);
          ctx.fillStyle = brushColor; ctx.fillRect(x - brushW/2, yMin, brushW, yMax - yMin);
          ctx.strokeStyle = brushBorder; ctx.lineWidth = 1.5; ctx.strokeRect(x - brushW/2, yMin, brushW, yMax - yMin);
          ctx.fillStyle = brushBorder; ctx.font = "bold 9px system-ui, sans-serif"; ctx.textAlign = "left";
          ctx.fillText(ax.fmt(yToVal(ax, yMin)), x + brushW/2 + 3, yMin + 3);
          ctx.fillText(ax.fmt(yToVal(ax, yMax)), x + brushW/2 + 3, yMax + 3);
          ctx.textAlign = "center";
        }
      });
      const useBrush = hasBrushes();
      linePaths.forEach(lp => {
        if (lp === highlighted) return;
        if (useBrush && lp.active) return;
        const alpha = (useBrush || (highlighted && lp !== highlighted)) ? "0.06)" : "0.35)";
        ctx.strokeStyle = lp.color + alpha; ctx.lineWidth = 1.5; ctx.beginPath();
        let s = false; lp.points.forEach(p => { if (!p) { s = false; return; } if (!s) { ctx.moveTo(p.x, p.y); s = true; } else ctx.lineTo(p.x, p.y); }); ctx.stroke();
      });
      if (useBrush) {
        linePaths.forEach(lp => {
          if (!lp.active || lp === highlighted) return;
          ctx.strokeStyle = "rgba(239,68,68,0.7)"; ctx.lineWidth = 2; ctx.beginPath();
          let s = false; lp.points.forEach(p => { if (!p) { s = false; return; } if (!s) { ctx.moveTo(p.x, p.y); s = true; } else ctx.lineTo(p.x, p.y); }); ctx.stroke();
        });
      }
      if (highlighted) {
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 5; ctx.beginPath();
        let s = false; highlighted.points.forEach(p => { if (!p) { s = false; return; } if (!s) { ctx.moveTo(p.x, p.y); s = true; } else ctx.lineTo(p.x, p.y); }); ctx.stroke();
        ctx.strokeStyle = useBrush && highlighted.active ? "rgba(239,68,68,1)" : highlighted.color + "1)"; ctx.lineWidth = 3; ctx.beginPath();
        s = false; highlighted.points.forEach(p => { if (!p) { s = false; return; } if (!s) { ctx.moveTo(p.x, p.y); s = true; } else ctx.lineTo(p.x, p.y); }); ctx.stroke();
        highlighted.points.forEach(p => { if (!p) return; ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI*2); ctx.fillStyle = useBrush && highlighted.active ? "rgba(239,68,68,1)" : highlighted.color + "1)"; ctx.fill(); ctx.strokeStyle="#fff"; ctx.lineWidth=1.5; ctx.stroke(); });
      }
      if (useBrush) {
        const active = linePaths.filter(lp => lp.active).length;
        ctx.fillStyle = brushBorder; ctx.font = "bold 11px system-ui, sans-serif"; ctx.textAlign = "right";
        ctx.fillText(`${active} / ${linePaths.length} filtered`, W - padRight, padTop - 30); ctx.textAlign = "center";
      }
      if (WZ._projCollisionAcMap && WZ._projCollisionAcMap.size > 0) {
        linePaths.forEach(lp => {
          const acIdx = items.indexOf(lp.d.raw);
          const sev = WZ._projCollisionAcMap.get(acIdx);
          if (!sev) return;
          const rgb = sev === 'red' ? "239,68,68" : "249,115,22";
          const mainAlpha = WZ._projBlinkOn ? 1 : 0.07;
          const glowAlpha = WZ._projBlinkOn ? 0.35 : 0;
          const drawLine = (w, a) => {
            ctx.lineWidth = w; ctx.strokeStyle = `rgba(${rgb},${a})`; ctx.beginPath();
            let s = false; lp.points.forEach(p => { if (!p) { s = false; return; } if (!s) { ctx.moveTo(p.x, p.y); s = true; } else ctx.lineTo(p.x, p.y); }); ctx.stroke();
          };
          drawLine(14, glowAlpha);
          drawLine(4,  mainAlpha);
        });
      }
    }
    draw();

    function findAxis(mx) { const sp = axisSpacing(); for (let i = 0; i < axes.length; i++) { if (Math.abs(axisX(i) - mx) < sp * 0.35) return i; } return -1; }
    function isOnBrushHandle(ax, axIdx, mx, my) { if (ax.brushY0 == null) return false; const x = axisX(axIdx); if (Math.abs(mx - x) > brushW) return false; const yMin = Math.min(ax.brushY0, ax.brushY1), yMax = Math.max(ax.brushY0, ax.brushY1); return my >= yMin - 4 && my <= yMax + 4; }

    canvas.onmousedown = function(e) {
      const rect = canvas.getBoundingClientRect(); const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const axIdx = findAxis(mx);
      if (my < padTop - 5 && axIdx >= 0) { mode = "drag"; dragAxis = axIdx; dragStartX = mx; dragOrigOrder = axes.map(a => a.key); canvas.style.cursor = "grabbing"; startPulse(); return; }
      if (axIdx >= 0 && isOnBrushHandle(axes[axIdx], axIdx, mx, my)) { mode = "brushmove"; brushMoving = { axIdx, startY0: axes[axIdx].brushY0, startY1: axes[axIdx].brushY1, grabY: my }; canvas.style.cursor = "ns-resize"; return; }
      if (axIdx >= 0 && my >= padTop && my <= padTop + plotH) { mode = "brush"; brushAxis = axIdx; brushStartY = my; axes[axIdx].brushY0 = my; axes[axIdx].brushY1 = my; canvas.style.cursor = "crosshair"; return; }
    };
    canvas.onmousemove = function(e) {
      const rect = canvas.getBoundingClientRect(); const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      if (mode === "drag" && dragAxis != null) {
        let targetIdx = dragAxis, minDist = Infinity;
        for (let i = 0; i < axes.length; i++) { const d = Math.abs(axisX(i) - mx); if (d < minDist) { minDist = d; targetIdx = i; } }
        if (targetIdx !== dragAxis) { const moved = axes.splice(dragAxis, 1)[0]; axes.splice(targetIdx, 0, moved); dragAxis = targetIdx; linePaths = buildLinePaths(); draw(); } return;
      }
      if (mode === "brush" && brushAxis != null) { axes[brushAxis].brushY1 = Math.max(padTop, Math.min(padTop + plotH, my)); linePaths = buildLinePaths(); draw(); return; }
      if (mode === "brushmove" && brushMoving) {
        const dy = my - brushMoving.grabY; let y0 = brushMoving.startY0 + dy, y1 = brushMoving.startY1 + dy;
        const yMin = Math.min(y0,y1), yMax = Math.max(y0,y1);
        if (yMin < padTop) { const sh = padTop - yMin; y0 += sh; y1 += sh; }
        if (yMax > padTop+plotH) { const sh = yMax - padTop - plotH; y0 -= sh; y1 -= sh; }
        axes[brushMoving.axIdx].brushY0 = y0; axes[brushMoving.axIdx].brushY1 = y1; linePaths = buildLinePaths(); draw(); return;
      }
      if (!mode) {
        const axIdx = findAxis(mx);
        if (my < padTop - 5 && axIdx >= 0) canvas.style.cursor = "grab";
        else if (axIdx >= 0 && isOnBrushHandle(axes[axIdx], axIdx, mx, my)) canvas.style.cursor = "ns-resize";
        else if (axIdx >= 0 && my >= padTop && my <= padTop + plotH) canvas.style.cursor = "crosshair";
        else canvas.style.cursor = "default";
        let closest = null, closestDist = 20;
        linePaths.forEach(lp => { if (hasBrushes() && !lp.active) return; lp.points.forEach(p => { if (!p) return; const d = Math.abs(p.x-mx)+Math.abs(p.y-my); if (d < closestDist) { closestDist = d; closest = lp; } }); });
        if (closest !== highlighted) {
          highlighted = closest; draw();
          const tip = document.getElementById("wz-vessel-parcoords-tooltip");
          if (highlighted) {
            const vv = highlighted.d.raw;
            tip.style.display = "block"; tip.style.left = (mx+14)+"px"; tip.style.top = (my-10)+"px";
            tip.innerHTML = `<strong>${WZ._esc(vv.name || "–")}</strong> ${WZ._esc(String(vv.mmsi))}
              <br>${_vesselUsageBadge(vv.usage)} · ${vv.speed != null ? vv.speed + " kn" : "–"} · ${WZ._esc(vv.flag || "")}
              ${vv.anomaly_flags && vv.anomaly_flags.length ? "<br><span style='color:#ef4444;'>"+WZ._esc(vv.anomaly_flags.join(", "))+"</span>" : ""}`;
          } else { tip.style.display = "none"; }
        } else if (highlighted) { const tip = document.getElementById("wz-vessel-parcoords-tooltip"); tip.style.left = (mx+14)+"px"; tip.style.top = (my-10)+"px"; }
      }
    };
    let wasDragging = false;
    canvas.onmouseup = function(e) {
      wasDragging = mode != null;
      if (mode === "brush" && brushAxis != null) { const ax = axes[brushAxis]; if (Math.abs(ax.brushY0 - ax.brushY1) < 5) { ax.brushY0 = null; ax.brushY1 = null; linePaths = buildLinePaths(); draw(); wasDragging = false; } }
      stopPulse(); mode = null; dragAxis = null; brushAxis = null; brushMoving = null; canvas.style.cursor = "default";
    };
    canvas.onmouseleave = function() { stopPulse(); highlighted = null; draw(); const tip = document.getElementById("wz-vessel-parcoords-tooltip"); if (tip) tip.style.display = "none"; if (mode) { mode = null; dragAxis = null; brushAxis = null; brushMoving = null; } };
    canvas.ondblclick = function(e) { const rect = canvas.getBoundingClientRect(); const mx = e.clientX - rect.left, my = e.clientY - rect.top; const axIdx = findAxis(mx); if (axIdx >= 0 && axes[axIdx].brushY0 != null) { axes[axIdx].brushY0 = null; axes[axIdx].brushY1 = null; linePaths = buildLinePaths(); draw(); } };
    canvas.onclick = function(e) { if (wasDragging) { wasDragging = false; return; } if (!highlighted) return; const idx = items.indexOf(highlighted.d.raw); if (idx >= 0) wzShowVesselDetail(idx); };
  }

WZ.registerPlugin('vessel', {
  renderer: _renderVesselLive,
  has_heatmap: true,
  has_refresh_bar: true,
  default_source: "vesselfinder",
});
})();
