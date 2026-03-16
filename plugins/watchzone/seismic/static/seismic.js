/**
 * WZ Module: seismic renderer — side panel + timeline playback + waveforms.
 */
(function() {
"use strict";
var WZ = window.WZ;

  let _seisMarkers = [];
  let _seisItems = [];
  let _seisPlayTimer = null;
  let _seisPlayIdx = 0;
  let _seisPlaying = false;

  // Datumsformatierung gemäß Admin-Einstellungen
  function _fmtD(dateStr) {
    if (!dateStr) return "";
    return window.fmtDateOnly ? window.fmtDateOnly(dateStr) : dateStr;
  }
  function _fmtDT(dateStr, timeStr) {
    if (!dateStr) return "";
    var iso = dateStr + "T" + (timeStr || "00:00:00");
    return window.fmtDate ? window.fmtDate(iso) : dateStr + " " + (timeStr || "").slice(0, 5);
  }

  // ── Seismik rendern ───────────────────────────────────────────────────
  function _renderSeismicLive(data) {
    const items = data.items || [];
    _seisItems = items;
    document.getElementById("wz-live-count").textContent =
      items.length + " " + t('wz_seismic_count','earthquakes (30 days)');
    if (WZ._liveMarkers) WZ._liveMarkers.clearLayers();
    _seisMarkers = [];
    _seisStop();

    const displayItems = items.slice(0, 200);

    // Karte auf volle Höhe strecken – Box, MapRow und Map müssen alle mitspielen
    const liveBox = document.getElementById("wz-live-box");
    if (liveBox) {
      liveBox.classList.add("wz-map-fill");
      liveBox.style.display = "flex";
      liveBox.style.flexDirection = "column";
      liveBox.style.height = "95vh";
      liveBox.style.maxHeight = "95vh";
    }
    const mapRow = document.getElementById("wz-map-row");
    if (mapRow) {
      mapRow.style.display = "flex";
      mapRow.style.flex = "1 1 0";
      mapRow.style.minHeight = "0";
      mapRow.style.height = "100%";
      mapRow.style.flexShrink = "1";
    }
    const mapEl = document.getElementById("wz-live-map");
    if (mapEl) {
      mapEl.style.height = "100%";
      mapEl.style.minHeight = "0";
      mapEl.style.flex = "1";
    }
    // Alles unterhalb der Karte ausblenden
    var _hideIds = ["wz-live-body","wz-under-map-bar","wz-resize-map","wz-live-sticky"];
    _hideIds.forEach(function(id) { var el = document.getElementById(id); if (el) el.style.display = "none"; });

    // ── Seitenpanel erstellen / wiederverwenden ──
    let panel = document.getElementById("seis-side-panel");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "seis-side-panel";
      panel.style.cssText = "width:420px;flex-shrink:0;border-left:1px solid var(--border);background:var(--surface);display:flex;flex-direction:column;overflow:hidden;";
      mapRow.appendChild(panel);
    }
    panel.style.display = "flex";

    // Chronologisch sortieren (älteste zuerst)
    const sorted = [...displayItems].sort((a, b) => {
      const ta = (a.date || '') + (a.time || '');
      const tb = (b.date || '') + (b.time || '');
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });
    const sortedIdxMap = sorted.map(s => displayItems.indexOf(s));

    // ── Panel-Inhalt ──
    let html = '';
    // Play-Bar
    html += `<div id="seis-play-bar" style="padding:8px 12px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px;flex-shrink:0;">
      <button id="seis-play-btn" onclick="_seisTogglePlay()" style="background:var(--accent1);color:#fff;border:none;border-radius:6px;padding:5px 14px;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:5px;">
        <span id="seis-play-icon">&#9654;</span> <span id="seis-play-label">${t('wz_seismic_play','Play')}</span>
      </button>
      <div id="seis-play-progress" style="flex:1;height:12px;background:var(--border);border-radius:3px;overflow:hidden;position:relative;">
        <div id="seis-play-fill" style="position:absolute;left:0;top:0;height:100%;width:0%;background:rgba(239,68,68,.25);border-radius:3px;transition:width .15s;z-index:1;"></div>
        <div id="seis-play-ticks" style="position:absolute;inset:0;z-index:2;"></div>
      </div>
      <span id="seis-play-date" style="font-size:11px;color:var(--muted);min-width:100px;text-align:right;"></span>
    </div>`;
    // Tabellenkopf
    html += `<div style="display:flex;align-items:center;gap:6px;padding:6px 10px;border-bottom:2px solid var(--border);font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;flex-shrink:0;">
      <span style="min-width:38px;">${t('wz_seismic_col_mag','Mag')}</span>
      <span style="flex:1;">${t('wz_seismic_col_place','Location')}</span>
      <span style="min-width:100px;">${t('wz_seismic_col_date','Date / Time')}</span>
      <span style="min-width:40px;text-align:right;">${t('wz_seismic_col_depth','Depth')}</span>
      <span style="min-width:28px;"></span>
    </div>`;
    // Scrollbare Liste
    html += '<div id="seis-list" style="flex:1;overflow-y:auto;min-height:0;font-size:11px;">';
    if (!displayItems.length) {
      html += `<div style="padding:20px;text-align:center;color:var(--muted);">${t('wz_seismic_empty','No earthquakes recorded in this region.')}</div>`;
    } else {
      displayItems.forEach((q, idx) => {
        const mag = q.magnitude || 0;
        const magColor = mag >= 5 ? "var(--danger)" : mag >= 3 ? "#f59e0b" : "var(--muted)";
        const seisBtn = q.event_id
          ? `<button onclick="event.stopPropagation();_seisLoadWaveform('${WZ._esc(q.event_id)}',${idx})" title="${t('wz_seismic_waveform','Seismogram')}" style="background:none;border:1px solid var(--border);border-radius:4px;color:var(--muted);cursor:pointer;padding:2px 6px;font-size:10px;flex-shrink:0;transition:color .15s,border-color .15s;" onmouseover="this.style.color='#ef4444';this.style.borderColor='#ef4444'" onmouseout="this.style.color='var(--muted)';this.style.borderColor='var(--border)'">\u223f</button>`
          : '';
        html += `<div class="seis-row" data-idx="${idx}"
          style="display:flex;align-items:center;gap:6px;padding:5px 10px;border-bottom:1px solid var(--border);
                 cursor:pointer;transition:background .15s;">
          <span style="font-weight:700;color:${magColor};min-width:38px;">M${mag.toFixed(1)}</span>
          <span style="flex:1;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${WZ._esc(q.place || t('wz_unknown','Unknown'))}</span>
          <span style="color:var(--muted);white-space:nowrap;min-width:100px;">${_fmtDT(q.date, q.time)}</span>
          <span style="color:var(--muted);min-width:40px;text-align:right;">${q.depth != null ? q.depth.toFixed(0) + "km" : ""}</span>
          ${seisBtn}
        </div>`;
      });
      if (items.length > 200) {
        html += `<div style="padding:6px 10px;font-size:10px;color:var(--muted);">\u2026 ${items.length - 200} ${t('wz_seismic_more','more')}</div>`;
      }
    }
    html += '</div>';
    // Seismogramm-Container
    html += `<div id="seis-waveform-wrap" style="display:none;border-top:1px solid var(--border);flex-shrink:0;max-height:40%;overflow-y:auto;padding:10px 12px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <h4 id="seis-wf-title" style="margin:0;font-size:12px;font-weight:600;flex:1;"></h4>
        <button onclick="document.getElementById('seis-waveform-wrap').style.display='none'" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:14px;">\u2715</button>
      </div>
      <div id="seis-wf-content"></div>
    </div>`;

    panel.innerHTML = html;

    // ── Beben-Ticks auf Progressbar ──
    if (sorted.length > 1) {
      var tickTs = sorted.map(function(q) {
        return new Date((q.date || "2000-01-01") + "T" + (q.time || "00:00:00") + "Z").getTime();
      });
      var tickMin = tickTs[0], tickMax = tickTs[tickTs.length - 1];
      var tickSpan = Math.max(1, tickMax - tickMin);
      var ticksEl = document.getElementById("seis-play-ticks");
      if (ticksEl) {
        var tickHtml = "";
        sorted.forEach(function(q, i) {
          var pct = ((tickTs[i] - tickMin) / tickSpan * 100).toFixed(2);
          var mag = q.magnitude || 0;
          var h = mag >= 5 ? 12 : mag >= 3 ? 8 : 5;
          var color = mag >= 5 ? "#dc2626" : mag >= 3 ? "#f59e0b" : "rgba(239,68,68,.5)";
          tickHtml += '<div style="position:absolute;left:' + pct + '%;top:' + (12 - h) + 'px;width:1.5px;height:' + h + 'px;background:' + color + ';border-radius:1px;"></div>';
        });
        ticksEl.innerHTML = tickHtml;
      }
    }

    // ── Marker auf Karte ──
    if (WZ._liveMap && displayItems.length) {
      displayItems.forEach((q, idx) => {
        if (q.lat == null || q.lon == null) return;
        const mag = q.magnitude || 0;
        const r = Math.max(4, mag * 3);
        const color = mag >= 5 ? "#dc2626" : mag >= 3 ? "#f59e0b" : "#ef4444";
        const circle = L.circleMarker([q.lat, q.lon], {
          radius: r, color: color, fillColor: color, fillOpacity: 0.6, weight: 1,
        });
        circle.bindPopup(
          `<strong>M${mag.toFixed(1)}</strong><br>${WZ._esc(q.place || "")}<br>` +
          `<span style="font-size:11px;color:#888;">${_fmtDT(q.date, q.time)} UTC \u00b7 ${t('wz_seismic_depth','Depth:')} ${q.depth != null ? q.depth.toFixed(1) + " km" : "?"}</span>`
        );
        WZ._liveMarkers.addLayer(circle);
        _seisMarkers.push({ marker: circle, idx, origRadius: r, origColor: color });
        circle.on("mouseover", () => _seisHighlight(idx, true));
        circle.on("mouseout",  () => _seisHighlight(idx, false));
      });
    }

    // ── Liste → Karte: Events ──
    panel.querySelectorAll(".seis-row").forEach(row => {
      const idx = parseInt(row.dataset.idx);
      row.addEventListener("mouseenter", () => _seisHighlight(idx, true));
      row.addEventListener("mouseleave", () => _seisHighlight(idx, false));
      row.addEventListener("click", () => {
        const entry = _seisMarkers.find(m => m.idx === idx);
        if (entry && WZ._liveMap) {
          WZ._liveMap.setView(entry.marker.getLatLng(), Math.max(WZ._liveMap.getZoom(), 8));
          entry.marker.openPopup();
        }
      });
    });

    setTimeout(() => { if (WZ._liveMap) WZ._liveMap.invalidateSize(); }, 200);

    panel._sortedItems = sorted;
    panel._sortedIdxMap = sortedIdxMap;
    panel._displayItems = displayItems;
  }

  // ── Highlight ─────────────────────────────────────────────────────────
  function _seisHighlight(idx, active) {
    const entry = _seisMarkers.find(m => m.idx === idx);
    if (entry) {
      if (active) {
        entry.marker.setStyle({ radius: entry.origRadius * 2, weight: 3, color: "#fff", fillOpacity: 0.9 });
        entry.marker.bringToFront();
      } else {
        entry.marker.setStyle({ radius: entry.origRadius, weight: 1, color: entry.origColor, fillOpacity: 0.6 });
      }
    }
    const row = document.querySelector(`.seis-row[data-idx="${idx}"]`);
    if (row) {
      row.style.background = active ? "rgba(239,68,68,.15)" : "";
      if (active) row.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  // ── Playback ──────────────────────────────────────────────────────────
  function _seisStop() {
    if (_seisPlayTimer) { clearTimeout(_seisPlayTimer); _seisPlayTimer = null; }
    _seisPlaying = false;
    _seisPlayIdx = 0;
    var btn = document.getElementById("seis-play-icon");
    var lbl = document.getElementById("seis-play-label");
    if (btn) btn.textContent = "\u25b6";
    if (lbl) lbl.textContent = t('wz_seismic_play','Play');
    var fill = document.getElementById("seis-play-fill");
    if (fill) fill.style.width = "0%";
    var dateEl = document.getElementById("seis-play-date");
    if (dateEl) dateEl.textContent = "";
    _seisMarkers.forEach(m => { m.marker.setStyle({ fillOpacity: 0.6, opacity: 1 }); });
    document.querySelectorAll(".seis-row").forEach(r => { r.style.opacity = "1"; r.style.background = ""; });
  }

  window._seisTogglePlay = function() {
    if (_seisPlaying) { _seisStop(); return; }
    var panel = document.getElementById("seis-side-panel");
    if (!panel || !panel._sortedItems || !panel._sortedItems.length) return;

    var sorted = panel._sortedItems;
    var idxMap = panel._sortedIdxMap;
    var total = sorted.length;

    // Zeitstempel in ms berechnen
    var timestamps = sorted.map(function(q) {
      return new Date((q.date || "2000-01-01") + "T" + (q.time || "00:00:00") + "Z").getTime();
    });
    var tMin = timestamps[0];
    var tMax = timestamps[total - 1];
    var realSpanMs = Math.max(1, tMax - tMin);
    // 30 Tage in 60 Sekunden → Skalierungsfaktor
    var PLAYBACK_DURATION_MS = 60000;
    var scale = PLAYBACK_DURATION_MS / realSpanMs;

    _seisPlaying = true;
    _seisPlayIdx = 0;
    var btn = document.getElementById("seis-play-icon");
    var lbl = document.getElementById("seis-play-label");
    if (btn) btn.textContent = "\u23f8";
    if (lbl) lbl.textContent = t('wz_seismic_stop','Stop');

    _seisMarkers.forEach(function(m) { m.marker.setStyle({ fillOpacity: 0, opacity: 0 }); });
    document.querySelectorAll(".seis-row").forEach(function(r) { r.style.opacity = "0.2"; });

    function _seisPlayStep() {
      if (!_seisPlaying || _seisPlayIdx >= total) { _seisStop(); return; }

      var q = sorted[_seisPlayIdx];
      var origIdx = idxMap[_seisPlayIdx];

      // Marker einblenden + Puls
      var entry = _seisMarkers.find(function(m) { return m.idx === origIdx; });
      if (entry) {
        entry.marker.setStyle({ fillOpacity: 0.8, opacity: 1, radius: entry.origRadius * 3, weight: 3, color: "#fff" });
        setTimeout(function() {
          if (entry) entry.marker.setStyle({ radius: entry.origRadius, weight: 1, color: entry.origColor });
        }, 400);
      }

      // Listenzeile highlighten
      var row = document.querySelector('.seis-row[data-idx="' + origIdx + '"]');
      if (row) {
        row.style.opacity = "1";
        row.style.background = "rgba(239,68,68,.2)";
        row.scrollIntoView({ block: "nearest", behavior: "smooth" });
        setTimeout(function() { if (row) row.style.background = ""; }, 400);
      }

      // Fortschritt
      var fill = document.getElementById("seis-play-fill");
      if (fill) fill.style.width = Math.round((_seisPlayIdx + 1) / total * 100) + "%";
      var dateEl = document.getElementById("seis-play-date");
      if (dateEl) dateEl.textContent = _fmtDT(q.date, q.time);

      _seisPlayIdx++;

      // Nächsten Schritt zeitproportional planen
      if (_seisPlayIdx < total) {
        var realGapMs = timestamps[_seisPlayIdx] - timestamps[_seisPlayIdx - 1];
        var delayMs = Math.max(20, Math.min(3000, realGapMs * scale));
        _seisPlayTimer = setTimeout(_seisPlayStep, delayMs);
      } else {
        // Letztes Beben → kurz warten, dann stoppen
        _seisPlayTimer = setTimeout(function() { _seisStop(); }, 1500);
      }
    }

    // Erstes Beben sofort anzeigen
    _seisPlayStep();
  };

  // ── Aufräumen ─────────────────────────────────────────────────────────
  WZ._onLiveClose.push(function() {
    _seisStop();
    var panel = document.getElementById("seis-side-panel");
    if (panel) { panel.style.display = "none"; panel.innerHTML = ""; }
  });

  // ── Seismogramm laden ─────────────────────────────────────────────────
  window._seisLoadWaveform = async function(eventId, idx) {
    var wrap = document.getElementById("seis-waveform-wrap");
    var titleEl = document.getElementById("seis-wf-title");
    var contentEl = document.getElementById("seis-wf-content");
    if (!wrap || !contentEl) return;

    var q = _seisItems[idx];
    wrap.style.display = "block";
    titleEl.textContent = '\u223f ' + t('wz_seismic_waveform','Seismogram') + ' \u2014 M' + (q && q.magnitude || 0).toFixed(1) + ' ' + ((q && q.place) || '');
    contentEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;padding:20px;gap:10px;">' +
      '<div style="width:20px;height:20px;border:2px solid var(--border);border-top-color:#ef4444;border-radius:50%;animation:wz-spin 0.75s linear infinite;"></div>' +
      '<span style="font-size:12px;color:var(--muted);">' + t('wz_seismic_loading_wf','Loading seismogram...') + '</span></div>';

    try {
      var detailUrl = (q && q.detail_url) || 'https://earthquake.usgs.gov/fdsnws/event/1/query?eventid=' + eventId + '&format=geojson';
      var resp = await fetch(detailUrl);
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      var detail = await resp.json();

      var props = detail.properties || {};
      var products = props.products || {};

      var imgUrl = null, imgLabel = "";

      // ShakeMap
      if (products["shakemap"] && products["shakemap"][0]) {
        var smContents = products["shakemap"][0].contents || {};
        var intKey = Object.keys(smContents).find(function(k) { return k.includes("intensity") && (k.endsWith(".jpg") || k.endsWith(".png")); });
        if (intKey) { imgUrl = smContents[intKey].url; imgLabel = "ShakeMap Intensity"; }
        if (!imgUrl) {
          var pgaKey = Object.keys(smContents).find(function(k) { return k.includes("pga") && (k.endsWith(".jpg") || k.endsWith(".png")); });
          if (pgaKey) { imgUrl = smContents[pgaKey].url; imgLabel = "ShakeMap PGA"; }
        }
      }

      // IRIS Waveform — nächste Station zum Epizentrum suchen
      var waveformHtml = "";
      if (q && q.lat != null && q.lon != null && q.time && q.date) {
        var startISO = q.date + "T" + q.time;
        var endMs = new Date(startISO + "Z").getTime() + 300000;
        var endISO = new Date(endMs).toISOString().slice(0, 19);

        // Stationsauswahl: IRIS fedcatalog für nächste Station
        var net = "IU", sta = "ANMO", loc = "00", cha = "BHZ";
        try {
          var stResp = await fetch('https://service.iris.edu/fdsnws/station/1/query?latitude=' + q.lat +
            '&longitude=' + q.lon + '&maxradius=30&channel=BHZ&level=station&format=text&limit=1&starttime=' + q.date);
          if (stResp.ok) {
            var stText = await stResp.text();
            var stLines = stText.trim().split('\n').filter(function(l) { return l && !l.startsWith('#'); });
            if (stLines.length > 0) {
              var parts = stLines[0].split('|');
              if (parts.length >= 4) { net = parts[0]; sta = parts[1]; loc = parts[2] || "--"; cha = parts[3] || "BHZ"; }
            }
          }
        } catch(_) {}

        var irisUrl = 'https://service.iris.edu/irisws/timeseries/1/query?net=' + net + '&sta=' + sta +
          '&loc=' + loc + '&cha=' + cha + '&starttime=' + q.date + 'T' + q.time +
          '&endtime=' + endISO + '&output=plot&width=800&height=250';

        waveformHtml = '<div style="margin-top:8px;">' +
          '<div style="font-size:10px;color:var(--muted);margin-bottom:3px;font-weight:600;">' +
          t('wz_seismic_wf_iris','Seismic Waveform') + ' (' + net + '.' + sta + '.' + cha + ')</div>' +
          '<img src="' + irisUrl + '" alt="Waveform" style="width:100%;border-radius:4px;border:1px solid var(--border);background:#fff;" ' +
          'onerror="this.parentElement.innerHTML=\'<span style=\\\'font-size:10px;color:var(--muted);\\\'>' +
          t('wz_seismic_wf_unavailable','Waveform not available for this event.') + '</span>\'">' +
          '</div>';
      }

      // DYFI
      var dyfiHtml = "";
      if (products["dyfi"] && products["dyfi"][0]) {
        var dyfiContents = products["dyfi"][0].contents || {};
        var dyfiKey = Object.keys(dyfiContents).find(function(k) { return (k.includes("ciim_geo") || k.includes("intensity")) && (k.endsWith(".jpg") || k.endsWith(".png")); });
        if (dyfiKey) {
          dyfiHtml = '<div style="margin-top:8px;">' +
            '<div style="font-size:10px;color:var(--muted);margin-bottom:3px;font-weight:600;">' + t('wz_seismic_dyfi','Community Reports (DYFI)') + '</div>' +
            '<img src="' + dyfiContents[dyfiKey].url + '" alt="DYFI" style="width:100%;border-radius:4px;border:1px solid var(--border);">' +
            '</div>';
        }
      }

      var resultHtml = "";
      if (imgUrl) {
        resultHtml += '<div>' +
          '<div style="font-size:10px;color:var(--muted);margin-bottom:3px;font-weight:600;">' + WZ._esc(imgLabel) + '</div>' +
          '<img src="' + imgUrl + '" alt="' + WZ._esc(imgLabel) + '" style="width:100%;border-radius:4px;border:1px solid var(--border);">' +
          '</div>';
      }
      resultHtml += waveformHtml + dyfiHtml;

      var felt = props.felt, cdi = props.cdi, mmi = props.mmi, tsunami = props.tsunami;
      var metaHtml = '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;font-size:10px;">';
      if (felt)    metaHtml += '<span style="color:var(--muted);">' + t('wz_seismic_felt','Felt:') + ' <strong style="color:var(--text);">' + felt + '</strong></span>';
      if (cdi)     metaHtml += '<span style="color:var(--muted);">CDI: <strong>' + cdi.toFixed(1) + '</strong></span>';
      if (mmi)     metaHtml += '<span style="color:var(--muted);">MMI: <strong>' + mmi.toFixed(1) + '</strong></span>';
      if (tsunami) metaHtml += '<span style="color:#ef4444;font-weight:700;">\u26a0 Tsunami</span>';
      metaHtml += '<a href="https://earthquake.usgs.gov/earthquakes/eventpage/' + WZ._esc(eventId) + '" target="_blank" rel="noopener" style="color:#06b6d4;text-decoration:none;margin-left:auto;">USGS \u2197</a>';
      metaHtml += '</div>';

      if (!resultHtml && !felt && !cdi) {
        resultHtml = '<div style="font-size:11px;color:var(--muted);padding:8px 0;">' + t('wz_seismic_no_detail','No detailed data available for this event.') + '</div>';
      }
      contentEl.innerHTML = resultHtml + metaHtml;
    } catch (e) {
      contentEl.innerHTML = '<div style="font-size:11px;color:var(--danger);padding:8px 0;">' + t('wz_seismic_wf_error','Error loading details:') + ' ' + WZ._esc(e.message) + '</div>';
    }
  };

  WZ.registerPlugin('seismic', { renderer: _renderSeismicLive, default_source: "usgs" });
})();
