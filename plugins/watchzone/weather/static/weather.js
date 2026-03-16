/**
 * WZ Module: weather renderer — side panel + history chart.
 */
(function() {
"use strict";
var WZ = window.WZ;

  function _fmtDT(iso) {
    if (!iso) return "";
    return window.fmtDate ? window.fmtDate(iso) : iso.replace("T", " ").slice(0, 16);
  }

  function _renderWeatherLive(data) {
    document.getElementById("wz-live-count").textContent = "";
    if (WZ._liveMarkers) WZ._liveMarkers.clearLayers();

    var w = data.weather || {};
    var alerts = data.alerts || [];

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

    // ── Wetter-Marker auf Karte ──
    if (WZ._liveMap) {
      var z = WZ._zones.find(function(z) { return z.id === WZ._liveZoneId; });
      if (z && z.geometry) {
        var bbox = WZ._geoBbox(z.geometry);
        if (bbox) {
          var lat = (bbox[1] + bbox[3]) / 2;
          var lon = (bbox[0] + bbox[2]) / 2;
          var m = L.marker([lat, lon]);
          m.bindPopup('<strong>' + WZ._esc(w.source_station || t('wz_weather_station','Weather Station')) + '</strong><br>' +
            (w.temperature != null ? w.temperature + ' \u00b0C' : '')).openPopup();
          WZ._liveMarkers.addLayer(m);
        }
      }
    }

    // ── Seitenpanel ──
    var panel = document.getElementById("wx-side-panel");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "wx-side-panel";
      panel.style.cssText = "width:380px;flex-shrink:0;border-left:1px solid var(--border);background:var(--surface);display:flex;flex-direction:column;overflow:hidden;";
      mapRow.appendChild(panel);
    }
    panel.style.display = "flex";

    var html = '';

    // ── Aktuelle Bedingungen ──
    html += '<div style="padding:14px;border-bottom:1px solid var(--border);flex-shrink:0;">';
    html += '<h4 style="margin:0 0 8px;font-size:14px;font-weight:600;">' + t('wz_weather_current','Current Conditions') + '</h4>';
    if (w.source_station) html += '<div style="font-size:11px;color:var(--muted);margin-bottom:6px;">Station: <strong style="color:var(--text);">' + WZ._esc(w.source_station) + '</strong></div>';
    if (w.timestamp) html += '<div style="font-size:10px;color:var(--muted);margin-bottom:8px;">' + _fmtDT(w.timestamp) + ' UTC</div>';

    // Große Temperatur
    if (w.temperature != null) {
      html += '<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:10px;">';
      html += '<span style="font-size:36px;font-weight:800;color:var(--text);">' + w.temperature + '</span>';
      html += '<span style="font-size:16px;color:var(--muted);">\u00b0C</span>';
      if (w.condition) html += '<span style="font-size:12px;color:var(--muted);margin-left:auto;">' + WZ._esc(w.condition) + '</span>';
      html += '</div>';
    }

    // Messwerte als kompakte Tabelle
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;font-size:12px;line-height:1.8;">';
    if (w.humidity != null) html += '<div style="color:var(--muted);">' + t('wz_weather_humidity','Humidity:') + '</div><div><strong>' + w.humidity + ' %</strong></div>';
    if (w.wind_speed != null) html += '<div style="color:var(--muted);">' + t('wz_weather_wind','Wind:') + '</div><div><strong>' + w.wind_speed + ' km/h</strong>' + (w.wind_direction != null ? ' (' + w.wind_direction + '\u00b0)' : '') + '</div>';
    if (w.wind_gust != null) html += '<div style="color:var(--muted);">' + t('wz_weather_gusts','Gusts:') + '</div><div><strong>' + w.wind_gust + ' km/h</strong></div>';
    if (w.pressure != null) html += '<div style="color:var(--muted);">' + t('wz_weather_pressure','Pressure:') + '</div><div><strong>' + w.pressure + ' hPa</strong></div>';
    if (w.cloud_cover != null) html += '<div style="color:var(--muted);">' + t('wz_weather_clouds','Clouds:') + '</div><div><strong>' + w.cloud_cover + ' %</strong></div>';
    if (w.visibility != null) html += '<div style="color:var(--muted);">' + t('wz_weather_visibility','Visibility:') + '</div><div><strong>' + (w.visibility / 1000).toFixed(1) + ' km</strong></div>';
    if (w.dew_point != null) html += '<div style="color:var(--muted);">' + t('wz_weather_dew','Dew Point:') + '</div><div><strong>' + w.dew_point + ' \u00b0C</strong></div>';
    if (w.precipitation != null) html += '<div style="color:var(--muted);">' + t('wz_weather_precip','Precip.:') + '</div><div><strong>' + w.precipitation + ' mm</strong></div>';
    html += '</div></div>';

    // ── Warnungen ──
    html += '<div style="padding:10px 14px;border-bottom:1px solid var(--border);flex-shrink:0;">';
    html += '<h4 style="margin:0 0 6px;font-size:12px;font-weight:600;">' + t('wz_weather_warnings','Warnings') + ' (' + alerts.length + ')</h4>';
    if (!alerts.length) {
      html += '<div style="font-size:11px;color:var(--muted);">' + t('wz_weather_no_warnings','No active warnings.') + '</div>';
    } else {
      alerts.forEach(function(a) {
        var sevColor = a.severity === "extreme" ? "var(--danger)" : a.severity === "severe" ? "#f59e0b" : "var(--muted)";
        html += '<div style="margin-bottom:6px;padding:6px 8px;border-left:3px solid ' + sevColor + ';background:var(--surface2);border-radius:4px;">';
        html += '<div style="font-size:11px;font-weight:600;">' + WZ._esc(a.headline) + '</div>';
        html += '<div style="font-size:10px;color:var(--muted);">' + WZ._esc(a.event) + ' \u2013 ' + WZ._esc(a.severity) + '</div>';
        if (a.effective) html += '<div style="font-size:9px;color:var(--muted);">' + _fmtDT(a.effective) + ' \u2013 ' + _fmtDT(a.expires) + '</div>';
        html += '</div>';
      });
    }
    html += '</div>';

    // ── Historische Daten (7-Tage-Chart) ──
    html += '<div style="padding:10px 14px;flex:1;min-height:0;overflow-y:auto;">';
    html += '<h4 style="margin:0 0 8px;font-size:12px;font-weight:600;">' + t('wz_weather_history','7-Day History') + '</h4>';
    html += '<div id="wx-history-chart" style="position:relative;height:140px;"><div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--muted);font-size:11px;">' + t('wz_weather_loading_hist','Loading...') + '</div></div>';
    // Typ-Auswahl
    html += '<div style="display:flex;gap:4px;margin-top:8px;flex-wrap:wrap;">';
    var types = [
      {id:"temperatur", label: t("wz_weather_btn_temp","Temp."), clr:"#ef4444"},
      {id:"niederschlag", label: t("wz_weather_btn_precip","Precip."), clr:"#3b82f6"},
      {id:"sturm", label: t("wz_weather_btn_gusts","Gusts"), clr:"#f59e0b"},
    ];
    types.forEach(function(tp, i) {
      html += '<button onclick="_wxLoadHistory(\'' + tp.id + '\')" class="wx-type-btn" data-type="' + tp.id + '" style="font-size:10px;padding:3px 8px;border:1px solid var(--border);border-radius:4px;cursor:pointer;background:' + (i === 0 ? tp.clr : 'var(--surface2)') + ';color:' + (i === 0 ? '#fff' : 'var(--muted)') + ';font-weight:600;">' + tp.label + '</button>';
    });
    html += '</div>';
    html += '</div>';

    panel.innerHTML = html;

    setTimeout(function() { if (WZ._liveMap) WZ._liveMap.invalidateSize(); }, 200);

    // Auto-load temperature history
    _wxLoadHistory("temperatur");
  }

  // ── History Chart laden ──
  var _wxChart = null;
  var _wxHistColors = { temperatur: "#ef4444", niederschlag: "#3b82f6", sturm: "#f59e0b" };

  window._wxLoadHistory = async function(dataType) {
    var zoneId = WZ._liveZoneId;
    if (!zoneId) return;

    // Button-Styles aktualisieren
    document.querySelectorAll(".wx-type-btn").forEach(function(btn) {
      var active = btn.dataset.type === dataType;
      var clr = _wxHistColors[btn.dataset.type] || "var(--muted)";
      btn.style.background = active ? clr : "var(--surface2)";
      btn.style.color = active ? "#fff" : "var(--muted)";
    });

    var wrap = document.getElementById("wx-history-chart");
    if (!wrap) return;

    var now = new Date();
    var from = new Date(now); from.setDate(from.getDate() - 7);
    var toStr = now.toISOString().slice(0, 10);
    var fromStr = from.toISOString().slice(0, 10);

    wrap.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--muted);font-size:11px;">' + t('wz_weather_loading_hist','Loading...') + '</div>';

    try {
      var resp = await fetch('/api/watchzones/' + zoneId + '/weather-history?from=' + fromStr + '&to=' + toStr + '&type=' + dataType);
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      var result = await resp.json();
      var data = result.data || [];

      if (!data.length || !window.Chart) {
        wrap.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--muted);font-size:11px;">' + t('wz_weather_no_hist','No data') + '</div>';
        return;
      }

      wrap.innerHTML = '<canvas id="wx-hist-canvas" style="width:100%;height:100%;"></canvas>';
      var canvas = document.getElementById("wx-hist-canvas");
      var clr = _wxHistColors[dataType] || "#3b82f6";

      if (_wxChart) { _wxChart.destroy(); _wxChart = null; }
      _wxChart = new Chart(canvas.getContext("2d"), {
        type: "line",
        data: {
          labels: data.map(function(d) { return window.fmtDateOnly ? window.fmtDateOnly(d.date + "T00:00") : d.date; }),
          datasets: [{
            data: data.map(function(d) { return d.value; }),
            borderColor: clr,
            backgroundColor: clr + "18",
            borderWidth: 2,
            pointRadius: 2,
            pointBackgroundColor: clr,
            fill: true,
            tension: 0.3,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { font: { size: 9 }, maxRotation: 45 }, grid: { display: false } },
            y: { ticks: { font: { size: 9 } }, grid: { color: "rgba(100,100,100,.1)" } },
          },
        },
      });
    } catch (e) {
      wrap.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--danger);font-size:11px;">' + WZ._esc(e.message) + '</div>';
    }
  };

  WZ._onLiveClose.push(function() {
    if (_wxChart) { _wxChart.destroy(); _wxChart = null; }
    var panel = document.getElementById("wx-side-panel");
    if (panel) { panel.style.display = "none"; panel.innerHTML = ""; }
  });

  WZ.registerPlugin('weather', { renderer: _renderWeatherLive, default_source: "dwd" });

})();
