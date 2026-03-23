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

  function _fmtD(d) {
    if (!d) return "";
    var iso = d.length <= 10 ? d + "T00:00" : d;
    return window.fmtDate ? window.fmtDate(iso) : (window.fmtDateOnly ? window.fmtDateOnly(iso) : d.slice(0, 10));
  }

  function _ensureSidePanel(ctx) {
    var panel = document.getElementById("wx-side-panel");
    if (!panel && ctx.mapRowEl) {
      panel = document.createElement("div");
      panel.id = "wx-side-panel";
      panel.style.cssText = "width:380px;flex-shrink:0;border-left:1px solid var(--border);background:var(--surface);display:flex;flex-direction:column;overflow-y:auto;padding:14px;font-size:12px;";
      ctx.mapRowEl.appendChild(panel);
    }
    if (panel) panel.style.display = "flex";
    return panel;
  }

  function _renderWeatherLive(data) {
    var ctx = WZ._currentCtx;
    if (ctx && ctx.mapEl) ctx.mapEl.style.height = "clamp(380px,65vh,750px)";
    if (ctx.countEl) ctx.countEl.textContent = "";
    if (WZ._liveMarkers) WZ._liveMarkers.clearLayers();

    var map = WZ._liveMap;
    var panel = _ensureSidePanel(ctx);

    // If historical data (time focus), render differently
    if (data.historical) {
      _renderWeatherHistorical(data, ctx, panel);
      return;
    }

    var w = data.weather || {};
    var alerts = data.alerts || [];

    // ── Weather marker on map ──
    if (map) {
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

    // ── Side panel content ──
    if (!panel) return;
    var html = '';

    // Current conditions
    html += '<h4 style="margin:0 0 8px;font-size:14px;font-weight:600;">' + t('wz_weather_current','Current Conditions') + '</h4>';
    if (w.source_station) html += '<div style="font-size:11px;color:var(--muted);margin-bottom:6px;">Station: <strong style="color:var(--text);">' + WZ._esc(w.source_station) + '</strong></div>';
    if (w.timestamp) html += '<div style="font-size:10px;color:var(--muted);margin-bottom:8px;">' + _fmtDT(w.timestamp) + '</div>';

    var rows = [];
    if (w.temperature != null) rows.push([t('wz_weather_temp','Temperature'), w.temperature + ' \u00b0C']);
    if (w.humidity != null) rows.push([t('wz_weather_humidity','Humidity'), w.humidity + ' %']);
    if (w.wind_speed != null) rows.push([t('wz_weather_wind','Wind'), w.wind_speed + ' km/h' + (w.wind_dir != null ? ' (' + w.wind_dir + '\u00b0)' : '')]);
    if (w.pressure != null) rows.push([t('wz_weather_pressure','Pressure'), w.pressure + ' hPa']);
    if (w.precipitation != null) rows.push([t('wz_weather_precip','Precipitation'), w.precipitation + ' mm']);
    if (w.cloud_cover != null) rows.push([t('wz_weather_clouds','Cloud cover'), w.cloud_cover + ' %']);
    if (w.visibility != null) rows.push([t('wz_weather_visibility','Visibility'), (w.visibility / 1000).toFixed(1) + ' km']);
    if (w.dew_point != null) rows.push([t('wz_weather_dew','Dew point'), w.dew_point + ' \u00b0C']);

    if (rows.length) {
      html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
      rows.forEach(function(r) {
        html += '<tr style="border-bottom:1px solid var(--border);"><td style="padding:4px 0;color:var(--muted);">' + r[0] + '</td><td style="padding:4px 0;text-align:right;font-weight:600;color:var(--text);">' + r[1] + '</td></tr>';
      });
      html += '</table>';
    }

    // Warnings
    if (alerts.length) {
      html += '<div style="margin-top:14px;"><h4 style="margin:0 0 8px;font-size:14px;font-weight:600;color:#f59e0b;">' + t('wz_weather_warnings','Warnings') + ' (' + alerts.length + ')</h4>';
      alerts.forEach(function(a) {
        html += '<div style="padding:8px;margin-bottom:6px;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);border-radius:6px;font-size:11px;">' +
          '<div style="font-weight:700;color:#f59e0b;">' + WZ._esc(a.event || a.headline || '') + '</div>' +
          (a.description ? '<div style="margin-top:4px;color:var(--text);">' + WZ._esc(a.description).substring(0, 200) + '</div>' : '') +
        '</div>';
      });
      html += '</div>';
    }

    // Water levels / gauges
    var gauges = data.gauges || [];
    if (gauges.length) {
      html += '<div style="margin-top:14px;"><h4 style="margin:0 0 8px;font-size:14px;font-weight:600;">' + t('wz_weather_gauges','Water Levels') + '</h4>';
      gauges.forEach(function(g) {
        var clr = (g.level_cm != null && g.warn_level_cm != null && g.level_cm >= g.warn_level_cm) ? '#ef4444' : 'var(--text)';
        html += '<div style="padding:6px 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">' +
          '<div><div style="font-weight:600;color:var(--text);">' + WZ._esc(g.name || g.station || '') + '</div>' +
          (g.water ? '<div style="font-size:10px;color:var(--muted);">' + WZ._esc(g.water) + '</div>' : '') + '</div>' +
          '<div style="text-align:right;"><span style="font-size:16px;font-weight:800;color:' + clr + ';">' + (g.level_cm != null ? g.level_cm + ' cm' : '\u2013') + '</span>' +
          (g.trend ? '<div style="font-size:10px;color:var(--muted);">' + WZ._esc(g.trend) + '</div>' : '') + '</div></div>';
      });
      html += '</div>';
    }

    // 7-Day History chart
    html += '<div style="padding:10px 0;flex:1;min-height:0;overflow-y:auto;">';
    html += '<h4 style="margin:0 0 8px;font-size:12px;font-weight:600;">' + t('wz_weather_history','7-Day History') + '</h4>';
    html += '<div id="wx-history-chart" style="position:relative;height:140px;"><div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--muted);font-size:11px;">' + t('wz_weather_loading_hist','Loading...') + '</div></div>';
    html += '<div style="display:flex;gap:4px;margin-top:8px;flex-wrap:wrap;">';
    var types = [
      {id:"temperatur", label: t("wz_weather_btn_temp","Temp."), clr:"#ef4444"},
      {id:"niederschlag", label: t("wz_weather_btn_precip","Precip."), clr:"#3b82f6"},
      {id:"sturm", label: t("wz_weather_btn_gusts","Gusts"), clr:"#f59e0b"},
    ];
    types.forEach(function(tp, i) {
      html += '<button onclick="_wxLoadHistory(\'' + tp.id + '\')" class="wx-type-btn" data-type="' + tp.id + '" style="font-size:10px;padding:3px 8px;border:1px solid var(--border);border-radius:4px;cursor:pointer;background:' + (i === 0 ? tp.clr : 'var(--surface2)') + ';color:' + (i === 0 ? '#fff' : 'var(--muted)') + ';font-weight:600;">' + tp.label + '</button>';
    });
    html += '</div></div>';

    panel.innerHTML = html;

    setTimeout(function() { if (WZ._liveMap) WZ._liveMap.invalidateSize(); }, 200);

    // Auto-load temperature history
    _wxLoadHistory("temperatur");
  }

  // ── Historical weather renderer (Time Focus) ──
  function _renderWeatherHistorical(data, ctx, panel) {
    if (WZ._liveMap && WZ._addTimeFocusMarker) WZ._addTimeFocusMarker(WZ._liveMap);

    if (!panel) return;

    var tf = data.time_focus || {};
    var html = '';

    // Header
    html += '<div style="margin-bottom:12px;padding:8px 10px;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.25);border-radius:6px;">';
    html += '<div style="font-size:13px;font-weight:700;color:#f59e0b;">Time Focus: ' + WZ._esc(tf.title || "") + '</div>';
    html += '<div style="font-size:12px;color:var(--muted);">' + _fmtD(tf.from) + (tf.to && tf.to !== tf.from ? ' \u2013 ' + _fmtD(tf.to) : '') + '</div>';
    html += '</div>';
    html += '<div style="font-size:12px;color:var(--muted);margin-bottom:12px;">' + t("wz_weather_hist_period", "Historische Wetterdaten") + ': ' + _fmtD(data.date_from) + ' \u2013 ' + _fmtD(data.date_to) + '</div>';

    // Render each data type as sparkline
    var series = [
      { key: "history_temp", label: t("wz_weather_btn_temp", "Temperatur"), unit: "\u00b0C", color: "#ef4444" },
      { key: "history_rain", label: t("wz_weather_btn_precip", "Niederschlag"), unit: "mm", color: "#3b82f6" },
      { key: "history_wind", label: t("wz_weather_btn_gusts", "Wind/B\u00f6en"), unit: "km/h", color: "#f59e0b" },
    ];
    series.forEach(function(s) {
      var items = data[s.key] || [];
      if (!items.length) return;
      var vals = items.map(function(d) { return d.value || 0; });
      var minV = Math.min.apply(null, vals), maxV = Math.max.apply(null, vals);
      var range = maxV - minV || 1;
      var cW = 340, cH = 100;
      var points = vals.map(function(v, i) {
        return ((i / Math.max(vals.length - 1, 1)) * cW).toFixed(1) + "," + (cH - ((v - minV) / range) * (cH - 6) - 3).toFixed(1);
      }).join(" ");
      html += '<div style="margin-bottom:18px;">';
      html += '<div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:6px;">' + s.label + '</div>';
      html += '<svg viewBox="0 0 ' + cW + ' ' + cH + '" style="width:100%;height:' + cH + 'px;display:block;">';
      html += '<polyline points="' + points + '" fill="none" stroke="' + s.color + '" stroke-width="2.5"/>';
      if (tf.from) {
        var d0 = new Date(items[0].date).getTime(), d1 = new Date(items[items.length - 1].date).getTime();
        var dtf = new Date(tf.from.length <= 10 ? tf.from + "T12:00:00" : tf.from).getTime();
        if (dtf >= d0 && dtf <= d1 && d1 > d0) {
          var tfX = ((dtf - d0) / (d1 - d0)) * cW;
          html += '<line x1="' + tfX.toFixed(1) + '" y1="0" x2="' + tfX.toFixed(1) + '" y2="' + cH + '" stroke="#f59e0b" stroke-width="2" stroke-dasharray="4,3" opacity="0.8"/>';
        }
      }
      html += '</svg>';
      html += '<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-top:4px;">';
      html += '<span>' + _fmtD(items[0].date) + '</span>';
      html += '<span style="font-weight:700;color:' + s.color + ';">min ' + minV.toFixed(1) + ' / max ' + maxV.toFixed(1) + ' ' + s.unit + '</span>';
      html += '<span>' + _fmtD(items[items.length - 1].date) + '</span>';
      html += '</div></div>';
    });

    panel.innerHTML = html;
    setTimeout(function() { if (WZ._liveMap) WZ._liveMap.invalidateSize(); }, 200);
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
    if (panel) { panel.remove(); }
  });

  WZ.registerPlugin('weather', {
    renderer: _renderWeatherLive,
    default_source: "dwd",
    has_live_map: true,
    live_box_height: "70vh",
  });

  // Collect Config
  WZ._collectConfigs["weather"] = {
    fields: function(saved) {
      saved = saved || {};
      return '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px;">Parameter</label>'
        + '<div style="display:flex;flex-wrap:wrap;gap:4px;">'
        + '<label style="font-size:10px;color:var(--text);display:flex;align-items:center;gap:3px;"><input type="checkbox" class="wz-cc-field" data-key="temperature" ' + (saved.temperature !== false ? 'checked' : '') + '> Temperatur</label>'
        + '<label style="font-size:10px;color:var(--text);display:flex;align-items:center;gap:3px;"><input type="checkbox" class="wz-cc-field" data-key="precipitation" ' + (saved.precipitation !== false ? 'checked' : '') + '> Niederschlag</label>'
        + '<label style="font-size:10px;color:var(--text);display:flex;align-items:center;gap:3px;"><input type="checkbox" class="wz-cc-field" data-key="wind" ' + (saved.wind ? 'checked' : '') + '> Wind</label>'
        + '</div>';
    },
    read: function(container) {
      var cfg = {};
      container.querySelectorAll('.wz-cc-field[type="checkbox"]').forEach(function(cb) {
        cfg[cb.getAttribute("data-key")] = cb.checked;
      });
      return cfg;
    }
  };

  // Collect Renderer
  WZ._collectRenderers["weather"] = {
    renderHTML: function(data, cardId) {
      var h = "";
      var w = data.weather;
      if (w) {
        h += '<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:10px;">';
        if (w.temperature != null) h += '<div style="text-align:center;"><div style="font-size:22px;font-weight:800;color:#06b6d4;">' + w.temperature + '\u00b0C</div><div style="font-size:9px;color:var(--muted);">Temperatur</div></div>';
        if (w.humidity != null) h += '<div style="text-align:center;"><div style="font-size:22px;font-weight:800;color:#3b82f6;">' + w.humidity + '%</div><div style="font-size:9px;color:var(--muted);">Feuchte</div></div>';
        if (w.wind_speed != null) h += '<div style="text-align:center;"><div style="font-size:22px;font-weight:800;color:#f59e0b;">' + w.wind_speed + ' km/h</div><div style="font-size:9px;color:var(--muted);">Wind</div></div>';
        if (w.pressure != null) h += '<div style="text-align:center;"><div style="font-size:22px;font-weight:800;color:var(--text);">' + w.pressure + ' hPa</div><div style="font-size:9px;color:var(--muted);">Druck</div></div>';
        if (w.precipitation != null) h += '<div style="text-align:center;"><div style="font-size:22px;font-weight:800;color:#22c55e;">' + w.precipitation + ' mm</div><div style="font-size:9px;color:var(--muted);">Niederschlag</div></div>';
        if (w.cloud_cover != null) h += '<div style="text-align:center;"><div style="font-size:22px;font-weight:800;color:#94a3b8;">' + w.cloud_cover + '%</div><div style="font-size:9px;color:var(--muted);">Bew\u00f6lkung</div></div>';
        h += '</div>';
        if (w.condition) h += '<div style="font-size:12px;color:var(--muted);margin-bottom:6px;">Bedingung: ' + WZ._esc(w.condition) + '</div>';
      }
      if (!w && data.historical) {
        h += '<div style="font-size:11px;color:var(--muted);margin-bottom:6px;">Historische Daten (Time Focus)</div>';
      }
      if (data.alerts && data.alerts.length) {
        data.alerts.forEach(function(a) {
          var _atxt = (a.headline || a.event || a.description || "").replace(/&amp;/g, "&");
          h += '<div style="padding:6px 10px;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);border-radius:6px;margin-bottom:4px;font-size:11px;color:#ef4444;">\u26a0 ' + WZ._esc(_atxt) + '</div>';
        });
      }
      // Historical charts
      var hasHistory = (data.history_temp && data.history_temp.length) || (data.history_rain && data.history_rain.length) || (data.history_wind && data.history_wind.length);
      if (hasHistory) {
        h += '<div style="position:relative;height:160px;margin-top:8px;"><canvas id="' + cardId + '-wx-chart"></canvas></div>';
      }
      if (!w && !hasHistory) h += '<div style="font-size:11px;color:var(--muted);">Keine Wetterdaten verf\u00fcgbar.</div>';
      return h;
    },
    afterRender: function(data, cardId) {
      if (!window.Chart) return;
      var hasHistory = (data.history_temp && data.history_temp.length) || (data.history_rain && data.history_rain.length);
      if (!hasHistory) return;
      var canvas = document.getElementById(cardId + "-wx-chart");
      if (!canvas) return;
      var fmtD = WZ._fmtDate || function(s) { return s ? String(s).slice(0,10) : ""; };
      var datasets = [], allLabels = {};
      // Collect all dates
      [data.history_temp, data.history_rain, data.history_wind].forEach(function(arr) {
        (arr || []).forEach(function(pt) { if (pt.date) allLabels[pt.date] = true; });
      });
      var labels = Object.keys(allLabels).sort();
      // Temperature
      if (data.history_temp && data.history_temp.length) {
        var tMap = {}; data.history_temp.forEach(function(pt) { tMap[pt.date] = pt.value; });
        datasets.push({ label: "Temperatur (\u00b0C)", data: labels.map(function(d) { return tMap[d] != null ? tMap[d] : null; }), borderColor: "#06b6d4", borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.3, yAxisID: "yTemp" });
      }
      // Rain
      if (data.history_rain && data.history_rain.length) {
        var rMap = {}; data.history_rain.forEach(function(pt) { rMap[pt.date] = pt.value; });
        datasets.push({ label: "Niederschlag (mm)", data: labels.map(function(d) { return rMap[d] != null ? rMap[d] : null; }), borderColor: "#22c55e", backgroundColor: "rgba(34,197,94,.15)", borderWidth: 1, type: "bar", yAxisID: "yRain" });
      }
      if (!datasets.length) return;
      var scales = { x: { ticks: { font: { size: 8 }, color: "#888", maxTicksLimit: 10, callback: function(v,i) { return fmtD(labels[i]); } }, grid: { display: false } } };
      if (datasets.some(function(d) { return d.yAxisID === "yTemp"; })) {
        scales.yTemp = { position: "left", ticks: { font: { size: 8 }, color: "#06b6d4" }, grid: { color: "rgba(100,100,100,.1)" }, title: { display: true, text: "\u00b0C", color: "#06b6d4", font: { size: 9 } } };
      }
      if (datasets.some(function(d) { return d.yAxisID === "yRain"; })) {
        scales.yRain = { position: "right", ticks: { font: { size: 8 }, color: "#22c55e" }, grid: { drawOnChartArea: false }, title: { display: true, text: "mm", color: "#22c55e", font: { size: 9 } } };
      }
      // Focus time plugin
      var wxPlugins = [];
      var tf = data.time_focus;
      if (tf && tf.from) {
        var tfFrom = tf.from.slice(0,10), tfTo = (tf.to || tf.from).slice(0,10);
        wxPlugins.push({
          id: 'wxFocus',
          afterDraw: function(chart) {
            var xScale = chart.scales.x, ctx2 = chart.ctx;
            var fi = -1, ti = -1;
            for (var j = 0; j < labels.length; j++) { if (labels[j] >= tfFrom && fi === -1) fi = j; if (labels[j] <= tfTo) ti = j; }
            if (fi === -1) return;
            var x1 = xScale.getPixelForValue(fi), x2 = xScale.getPixelForValue(ti);
            var top = chart.chartArea.top, bottom = chart.chartArea.bottom;
            ctx2.save();
            ctx2.fillStyle = 'rgba(245,158,11,.1)';
            ctx2.fillRect(Math.min(x1,x2)-2, top, Math.abs(x2-x1)+4, bottom-top);
            var xC = (x1+x2)/2;
            ctx2.beginPath(); ctx2.moveTo(xC,top); ctx2.lineTo(xC,bottom);
            ctx2.strokeStyle = '#f59e0b'; ctx2.lineWidth = 1.5; ctx2.setLineDash([4,3]); ctx2.stroke();
            ctx2.fillStyle = '#f59e0b'; ctx2.font = 'bold 9px sans-serif'; ctx2.textAlign = 'center';
            ctx2.fillText(tf.title || 'Event', xC, top-4);
            ctx2.restore();
          }
        });
      }
      new Chart(canvas.getContext("2d"), {
        type: "line", data: { labels: labels, datasets: datasets }, plugins: wxPlugins,
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, position: "bottom", labels: { font: { size: 8 }, boxWidth: 8, padding: 4 } } }, scales: scales, interaction: { intersect: false, mode: "index" } }
      });
    }
  };

})();
