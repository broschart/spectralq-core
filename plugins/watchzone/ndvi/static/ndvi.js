/**
 * WZ Module: ndvi renderer — side panel layout.
 */
(function() {
"use strict";
var WZ = window.WZ;

  function _fmtD(d) { return window.fmtDateOnly ? window.fmtDateOnly(d + "T00:00") : d; }

  var _ndviOverlay = null;
  var _ndviChangeOverlay = null;

  function _renderNdviLive(data) {
    var ctx = WZ._currentCtx;
    if (ctx && ctx.mapEl) ctx.mapEl.style.height = "clamp(450px,75vh,850px)";
    var _mapRowEl = ctx ? ctx.mapRowEl : document.getElementById("wz-map-row");
    if (WZ._liveMarkers) WZ._liveMarkers.clearLayers();

    var items = data.items || [];
    var map = WZ._liveMap;

    // ── NDVI-Bild als Overlay ──
    if (map && data.ndvi_image_b64 && data.ndvi_image_bbox) {
      var bb = data.ndvi_image_bbox;
      var bounds = L.latLngBounds([bb[1], bb[0]], [bb[3], bb[2]]);
      var imgSrc = "data:image/png;base64," + data.ndvi_image_b64;
      _ndviOverlay = L.imageOverlay(imgSrc, bounds, { opacity: 0.75 });
      _ndviOverlay.addTo(map);
      map.fitBounds(bounds, { padding: [20, 20] });
    }

    // ── Change-Detection Overlay (initial aus) ──
    if (map && data.change_image_b64 && data.change_bbox) {
      var cbb = data.change_bbox;
      var cBounds = L.latLngBounds([cbb[1], cbb[0]], [cbb[3], cbb[2]]);
      var cSrc = "data:image/png;base64," + data.change_image_b64;
      _ndviChangeOverlay = L.imageOverlay(cSrc, cBounds, { opacity: 0.85 });
      // Nicht sofort anzeigen – per Toggle
    }

    // ── Seitenpanel ──
    var panel = document.getElementById("ndvi-side-panel");
    if (!panel) {
      var mapRow = _mapRowEl;
      if (mapRow) {
        panel = document.createElement("div");
        panel.id = "ndvi-side-panel";
        panel.style.cssText = "width:380px;flex-shrink:0;border-left:1px solid var(--border);background:var(--surface);display:flex;flex-direction:column;overflow:hidden;";
        mapRow.appendChild(panel);
      }
    }
    if (panel) panel.style.display = "flex";

    if (!items.length) {
      panel.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);">' +
        t('wz_ndvi_empty','No NDVI data available. Copernicus credentials required.') + '</div>';
      return;
    }

    var vals = items.map(function(d) { return d.mean_ndvi; });
    var minV = Math.min.apply(null, vals), maxV = Math.max.apply(null, vals);
    var avg = vals.reduce(function(a, b) { return a + b; }, 0) / vals.length;
    var range = maxV - minV || 0.1;

    var html = '';

    // ── Layer-Toggle ──
    html += '<div style="padding:8px 14px;border-bottom:1px solid var(--border);display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;">';
    html += '<button id="ndvi-btn-ndvi" onclick="_ndviToggleLayer(\'ndvi\')" style="font-size:11px;padding:4px 10px;border-radius:5px;border:1px solid #16a34a;background:#16a34a;color:#fff;cursor:pointer;font-weight:600;">NDVI</button>';
    html += '<button id="ndvi-btn-change" onclick="_ndviToggleLayer(\'change\')" style="font-size:11px;padding:4px 10px;border-radius:5px;border:1px solid #ef4444;background:none;color:#ef4444;cursor:pointer;font-weight:600;">' + t('wz_ndvi_change','Change-Detection') + '</button>';
    html += '</div>';

    // ── Hotspot-Info ──
    var hs = data.hotspots || {};
    if (hs.decline_pct != null) {
      html += '<div style="padding:8px 14px;border-bottom:1px solid var(--border);flex-shrink:0;">';
      html += '<h4 style="margin:0 0 6px;font-size:13px;font-weight:600;">' + t('wz_ndvi_hotspots','Hotspot-Analyse') + '</h4>';
      html += '<div style="font-size:11px;color:var(--muted);margin-bottom:6px;">' + WZ._esc(hs.period_reference || '') + ' → ' + WZ._esc(hs.period_current || '') + '</div>';
      html += '<div style="display:flex;gap:10px;flex-wrap:wrap;font-size:12px;">';
      html += '<div style="text-align:center;"><div style="font-size:18px;font-weight:800;color:#ef4444;">' + (hs.decline_pct || 0) + '%</div><div style="font-size:9px;color:var(--muted);">' + t('wz_ndvi_decline','R\u00fcckgang') + '</div></div>';
      html += '<div style="text-align:center;"><div style="font-size:18px;font-weight:800;color:#3b82f6;">' + (hs.increase_pct || 0) + '%</div><div style="font-size:9px;color:var(--muted);">' + t('wz_ndvi_increase','Zunahme') + '</div></div>';
      html += '<div style="text-align:center;"><div style="font-size:18px;font-weight:800;color:var(--text);">' + (hs.mean_change || 0) + '</div><div style="font-size:9px;color:var(--muted);">\u00d8 \u0394NDVI</div></div>';
      html += '</div>';
      if (hs.decline_strong > 0) {
        html += '<div style="margin-top:6px;padding:6px 8px;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);border-radius:5px;font-size:11px;color:#ef4444;">';
        html += '\u26a0 ' + hs.decline_strong + ' Pixel mit starkem R\u00fcckgang (&gt;0.15)';
        html += '</div>';
      }
      html += '</div>';
    }

    // ── Sparkline ──
    var w = 400, h = 80;
    var points = vals.map(function(v, i) {
      return ((i / (vals.length - 1)) * w).toFixed(1) + "," + (h - ((v - minV) / range) * h).toFixed(1);
    }).join(" ");

    html += '<div style="padding:12px 14px;border-bottom:1px solid var(--border);flex-shrink:0;">';
    html += '<h4 style="margin:0 0 8px;font-size:13px;font-weight:600;">' + t('wz_ndvi_trend','NDVI Trend (90 Days)') + '</h4>';
    html += '<svg viewBox="0 0 ' + w + ' ' + h + '" style="width:100%;height:' + h + 'px;display:block;">';
    html += '<polyline points="' + points + '" fill="none" stroke="#16a34a" stroke-width="2"/>';
    // Time Focus marker
    var _tfZone = WZ._liveZoneId ? (WZ._zones || []).find(function(z) { return z.id === WZ._liveZoneId; }) : null;
    var _tf = _tfZone && _tfZone.config && _tfZone.config.time_focus ? _tfZone.config.time_focus : null;
    if (_tf && _tf.from && items.length > 1) {
      var _tfDate = _tf.from.slice(0, 10);
      var _d0 = new Date(items[0].date).getTime();
      var _d1 = new Date(items[items.length - 1].date).getTime();
      var _dtf = new Date(_tfDate).getTime();
      if (_dtf >= _d0 && _dtf <= _d1 && _d1 > _d0) {
        var _tfX = ((_dtf - _d0) / (_d1 - _d0)) * w;
        html += '<line x1="' + _tfX.toFixed(1) + '" y1="0" x2="' + _tfX.toFixed(1) + '" y2="' + h + '" stroke="#f59e0b" stroke-width="2" stroke-dasharray="4,3" opacity="0.8"/>';
        html += '<text x="' + (_tfX + 3).toFixed(1) + '" y="10" fill="#f59e0b" font-size="8" font-weight="700">' + WZ._esc(_tf.title || "Focus") + '</text>';
      }
    }
    html += '</svg>';
    html += '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--muted);margin-top:2px;">';
    html += '<span>' + _fmtD(items[0].date) + '</span><span>' + _fmtD(items[items.length - 1].date) + '</span>';
    html += '</div></div>';

    // ── Stats ──
    var curV = vals[vals.length - 1];
    var curClr = curV > 0.6 ? "#16a34a" : curV > 0.3 ? "#eab308" : curV > 0 ? "#f97316" : "#ef4444";
    html += '<div style="padding:10px 14px;border-bottom:1px solid var(--border);display:flex;gap:14px;flex-wrap:wrap;align-items:center;flex-shrink:0;">';
    html += '<div style="text-align:center;"><div style="font-size:22px;font-weight:800;color:' + curClr + ';">' + curV.toFixed(3) + '</div><div style="font-size:9px;color:var(--muted);text-transform:uppercase;">' + t('wz_ndvi_current','Current') + '</div></div>';
    html += '<div style="text-align:center;"><div style="font-size:22px;font-weight:800;color:var(--text);">' + maxV.toFixed(3) + '</div><div style="font-size:9px;color:var(--muted);text-transform:uppercase;">Max</div></div>';
    html += '<div style="text-align:center;"><div style="font-size:22px;font-weight:800;color:var(--text);">' + minV.toFixed(3) + '</div><div style="font-size:9px;color:var(--muted);text-transform:uppercase;">Min</div></div>';
    html += '<div style="text-align:center;"><div style="font-size:22px;font-weight:800;color:var(--text);">' + avg.toFixed(3) + '</div><div style="font-size:9px;color:var(--muted);text-transform:uppercase;">\u00d8</div></div>';
    html += '</div>';

    // ── Tabelle ──
    html += '<div style="display:flex;align-items:center;gap:6px;padding:6px 10px;border-bottom:2px solid var(--border);font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;flex-shrink:0;">';
    html += '<span style="min-width:100px;">' + t('wz_ndvi_th_date','Date') + '</span>';
    html += '<span style="min-width:70px;text-align:right;">NDVI</span>';
    html += '<span style="flex:1;">' + t('wz_ndvi_th_rating','Rating') + '</span></div>';

    html += '<div id="ndvi-list" style="flex:1;overflow-y:auto;min-height:0;font-size:11px;">';
    items.slice().reverse().forEach(function(d) {
      var v = d.mean_ndvi;
      var color = v > 0.6 ? "#16a34a" : v > 0.3 ? "#eab308" : v > 0 ? "#f97316" : "#ef4444";
      var label = v > 0.6 ? t('wz_ndvi_dense','Dense') : v > 0.3 ? t('wz_ndvi_moderate','Moderate') : v > 0 ? t('wz_ndvi_sparse','Sparse') : t('wz_ndvi_none','No Greenery');
      html += '<div style="display:flex;align-items:center;gap:6px;padding:5px 10px;border-bottom:1px solid var(--border);">';
      html += '<span style="color:var(--muted);min-width:100px;">' + _fmtD(d.date) + '</span>';
      html += '<span style="font-weight:700;color:' + color + ';min-width:70px;text-align:right;font-family:monospace;">' + v.toFixed(4) + '</span>';
      html += '<span style="color:' + color + ';font-size:10px;flex:1;">' + label + '</span></div>';
    });
    html += '</div>';

    // Legende
    html += '<div style="padding:8px 14px;border-top:1px solid var(--border);flex-shrink:0;font-size:10px;color:var(--muted);">';
    html += '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">';
    html += '<span style="display:inline-flex;align-items:center;gap:2px;"><span style="width:10px;height:10px;border-radius:2px;background:#005000;"></span> &gt;0.7</span>';
    html += '<span style="display:inline-flex;align-items:center;gap:2px;"><span style="width:10px;height:10px;border-radius:2px;background:#1a8c1a;"></span> 0.5-0.7</span>';
    html += '<span style="display:inline-flex;align-items:center;gap:2px;"><span style="width:10px;height:10px;border-radius:2px;background:#80cc20;"></span> 0.3-0.5</span>';
    html += '<span style="display:inline-flex;align-items:center;gap:2px;"><span style="width:10px;height:10px;border-radius:2px;background:#e6b30a;"></span> 0.15-0.3</span>';
    html += '<span style="display:inline-flex;align-items:center;gap:2px;"><span style="width:10px;height:10px;border-radius:2px;background:#e63000;"></span> &lt;0.15</span>';
    html += '</div></div>';

    panel.innerHTML = html;
    setTimeout(function() { if (WZ._liveMap) WZ._liveMap.invalidateSize(); }, 200);
  }

  // Layer-Toggle
  var _ndviActiveLayer = 'ndvi';
  window._ndviToggleLayer = function(layer) {
    var map = WZ._liveMap;
    if (!map) return;

    if (layer === 'ndvi') {
      if (_ndviChangeOverlay && map.hasLayer(_ndviChangeOverlay)) map.removeLayer(_ndviChangeOverlay);
      if (_ndviOverlay) { if (!map.hasLayer(_ndviOverlay)) _ndviOverlay.addTo(map); }
      _ndviActiveLayer = 'ndvi';
    } else {
      if (_ndviOverlay && map.hasLayer(_ndviOverlay)) map.removeLayer(_ndviOverlay);
      if (_ndviChangeOverlay) { if (!map.hasLayer(_ndviChangeOverlay)) _ndviChangeOverlay.addTo(map); }
      _ndviActiveLayer = 'change';
    }

    var btnN = document.getElementById('ndvi-btn-ndvi');
    var btnC = document.getElementById('ndvi-btn-change');
    if (btnN) { btnN.style.background = _ndviActiveLayer === 'ndvi' ? '#16a34a' : 'none'; btnN.style.color = _ndviActiveLayer === 'ndvi' ? '#fff' : '#16a34a'; }
    if (btnC) { btnC.style.background = _ndviActiveLayer === 'change' ? '#ef4444' : 'none'; btnC.style.color = _ndviActiveLayer === 'change' ? '#fff' : '#ef4444'; }
  };

  WZ._onLiveClose.push(function() {
    var panel = document.getElementById("ndvi-side-panel");
    if (panel) { panel.style.display = "none"; panel.innerHTML = ""; }
    _ndviOverlay = null;
    _ndviChangeOverlay = null;
    _ndviActiveLayer = 'ndvi';
  });

  WZ.registerPlugin('ndvi', {
    renderer: _renderNdviLive,
    default_source: "sentinel-ndvi",
    has_live_map: true,
    live_box_height: "68vh",
  });

  // Collect Renderer
  WZ._collectRenderers["ndvi"] = {
    renderHTML: function(data, cardId) {
      var h = "";
      var fmtD = WZ._fmtDate || function(s) { return s ? String(s).slice(0,10) : ""; };
      if (data.ndvi_image_b64) {
        h += '<div style="display:flex;gap:8px;margin-bottom:8px;">';
        h += '<div style="flex:1;text-align:center;"><img src="data:image/png;base64,' + data.ndvi_image_b64 + '" style="width:100%;border-radius:6px;border:1px solid var(--border);cursor:pointer;" onclick="window.open(this.src,\'_blank\')"><div style="font-size:10px;color:var(--muted);margin-top:2px;">NDVI-Karte</div></div>';
        if (data.change_image_b64) {
          h += '<div style="flex:1;text-align:center;"><img src="data:image/png;base64,' + data.change_image_b64 + '" style="width:100%;border-radius:6px;border:1px solid var(--border);cursor:pointer;" onclick="window.open(this.src,\'_blank\')"><div style="font-size:10px;color:var(--muted);margin-top:2px;">Ver\u00e4nderung</div></div>';
        }
        h += '</div>';
      }
      if (data.time_focus_images && data.time_focus_images.length) {
        h += '<div style="display:flex;gap:8px;overflow-x:auto;margin-bottom:8px;">';
        data.time_focus_images.forEach(function(tfi) {
          var imgSrc = tfi.image_b64 ? ("data:image/png;base64," + tfi.image_b64) : (tfi.image_url || "");
          if (!imgSrc) return;
          var tfLabel = tfi.label === "before" ? "Vorher" : tfi.label === "focus" ? "Ereignis" : "Nachher";
          h += '<div style="flex:1;min-width:0;text-align:center;"><img src="' + imgSrc + '" style="width:100%;border-radius:6px;border:1px solid var(--border);cursor:pointer;" onclick="window.open(this.src,\'_blank\')">';
          h += '<div style="font-size:10px;color:var(--muted);margin-top:3px;">' + tfLabel + (tfi.date ? " \u2014 " + fmtD(tfi.date) : "") + '</div></div>';
        });
        h += '</div>';
      }
      if (data.items && data.items.length) {
        h += '<div style="position:relative;height:180px;margin-bottom:10px;"><canvas id="' + cardId + '-ndvi-chart"></canvas></div>';
        h += '<table style="width:100%;font-size:11px;border-collapse:collapse;margin-bottom:8px;">';
        h += '<thead><tr style="border-bottom:1px solid var(--border);color:var(--muted);"><th style="text-align:left;padding:3px 8px;">Datum</th><th style="text-align:right;padding:3px 8px;">NDVI (Mittel)</th></tr></thead><tbody>';
        data.items.forEach(function(it) {
          var ndvi = it.mean_ndvi != null ? it.mean_ndvi.toFixed(3) : "\u2014";
          var ndviColor = it.mean_ndvi > 0.6 ? "#22c55e" : it.mean_ndvi > 0.3 ? "#f59e0b" : it.mean_ndvi > 0 ? "#06b6d4" : "#ef4444";
          h += '<tr style="border-bottom:1px solid rgba(255,255,255,.05);"><td style="padding:3px 8px;">' + fmtD(it.date) + '</td><td style="padding:3px 8px;text-align:right;color:' + ndviColor + ';font-weight:600;">' + ndvi + '</td></tr>';
        });
        h += '</tbody></table>';
      }
      if (data.hotspots && data.hotspots.length) h += '<div style="font-size:11px;color:#ef4444;margin-bottom:6px;">' + data.hotspots.length + ' Ver\u00e4nderungs-Hotspots</div>';
      return h;
    },
    afterRender: function(data, cardId, cardEl) {
      if (!window.Chart || !data.items || !data.items.length) return;
      var fmtD = WZ._fmtDate || function(s) { return s ? String(s).slice(0,10) : ""; };
      var canvas = document.getElementById(cardId + "-ndvi-chart");
      if (!canvas) return;
      var labels = data.items.map(function(it) { return fmtD(it.date); });
      var values = data.items.map(function(it) { return it.mean_ndvi != null ? it.mean_ndvi : null; });
      var colors = values.map(function(v) { return v == null ? "#888" : v > 0.6 ? "#22c55e" : v > 0.3 ? "#f59e0b" : v > 0 ? "#06b6d4" : "#ef4444"; });
      new Chart(canvas.getContext("2d"), {
        type: "line", data: { labels: labels, datasets: [{ label: "NDVI", data: values, borderColor: "#22c55e", backgroundColor: "rgba(34,197,94,.1)", borderWidth: 2, pointRadius: 4, pointBackgroundColor: colors, pointBorderColor: colors, fill: true, tension: 0.3, spanGaps: true }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: function(ctx) { return "NDVI: " + (ctx.parsed.y != null ? ctx.parsed.y.toFixed(3) : "\u2014"); } } } },
          scales: { x: { ticks: { font: { size: 8 }, color: "#888", maxTicksLimit: 8 }, grid: { display: false } }, y: { ticks: { font: { size: 8 }, color: "#888" }, grid: { color: "rgba(100,100,100,.1)" }, title: { display: true, text: "NDVI", color: "#22c55e", font: { size: 10 } } } },
          interaction: { intersect: false, mode: "index" } }
      });
    }
  };

})();
