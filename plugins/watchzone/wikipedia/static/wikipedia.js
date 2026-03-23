/**
 * WZ Module: Wikipedia article edit monitoring.
 */
(function() {
"use strict";
var WZ = window.WZ;
var t = window.t || function(k, fb) { return fb; };

// ── Fullscreen-Layout CSS ──────────────────────────────────
(function() {
  var s = document.createElement('style');
  s.textContent =
    '.wz-wiki-bottom-row { display:flex; flex-direction:column; gap:0; }' +
    '.wz-wiki-bottom-panel { flex:1; min-width:0; }' +
    /* Fullscreen: gesamte Hierarchie auf flex umstellen */
    ':fullscreen #wz-live-body { display:flex; flex-direction:column; }' +
    ':fullscreen #wz-live-content { flex:1; display:flex !important; flex-direction:column; min-height:0; overflow-y:auto; }' +
    ':fullscreen #wz-live-content > .wz-wiki-article { flex:1; display:flex; flex-direction:column; min-height:0; }' +
    /* Äußerer Charts+Autoren-Flex wächst */
    ':fullscreen #wz-live-content > .wz-wiki-article > div:last-child { flex:1; display:flex; min-height:0; }' +
    /* Charts-Spalte als Flex-Column */
    ':fullscreen .wz-wiki-charts-col { display:flex; flex-direction:column; min-height:0; }' +
    /* Balkendiagramm: höher im Fullscreen */
    ':fullscreen .wz-wiki-bar-wrap { flex:0 0 auto; }' +
    ':fullscreen .wz-wiki-bar-wrap [id^="wz-wiki-bars-"] { height:320px !important; }' +
    ':fullscreen .wz-wiki-bar-wrap [id^="wz-wiki-yaxis-"], :fullscreen .wz-wiki-bar-wrap [id^="wz-wiki-yaxisr-"] { height:320px !important; }' +
    ':fullscreen .wz-wiki-bar-wrap svg[id^="wz-wiki-views-"] { height:320px !important; }' +
    /* Bottom-Row (Timeline + ParCoords) nebeneinander, füllt Restplatz */
    ':fullscreen .wz-wiki-bottom-row { flex-direction:row; gap:12px; flex:1; min-height:0; }' +
    ':fullscreen .wz-wiki-bottom-panel { flex:1; min-width:0; display:flex; flex-direction:column; min-height:0; }' +
    ':fullscreen .wz-wiki-bottom-panel > div:last-child { flex:1; height:auto !important; min-height:280px; }';
  document.head.appendChild(s);
})();

// ── Add Wikipedia Article Modal ──────────────────────────────────
window.wzAddWikipedia = function() {
  var mid = "wz-add-wiki-modal";
  var old = document.getElementById(mid);
  if (old) old.remove();

  var _selectedTitle = "";
  var _searchTimer = null;

  var modal = document.createElement("div");
  modal.id = mid;
  modal.style.cssText = "position:fixed;inset:0;z-index:10200;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;";

  modal.innerHTML =
    '<div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;' +
    'width:min(560px,95vw);max-height:80vh;display:flex;flex-direction:column;' +
    'box-shadow:0 20px 60px rgba(0,0,0,.6);overflow:hidden;">' +

    '<div style="padding:12px 18px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;flex-shrink:0;">' +
      '<span style="font-size:15px;font-weight:700;color:var(--text);">' + t("wz_wiki_modal_title", "Add Wikipedia Article") + '</span>' +
      '<span style="flex:1;"></span>' +
      '<button id="wz-awik-close" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:20px;line-height:1;">&#10005;</button>' +
    '</div>' +

    '<div style="padding:16px 18px 14px;border-bottom:1px solid var(--border);flex-shrink:0;">' +
      '<div style="display:flex;gap:10px;margin-bottom:10px;">' +
        '<div style="flex:1;">' +
          '<label style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px;">' + t("wz_wiki_lbl_search", "Article Search") + '</label>' +
          '<input id="wz-awik-search" type="text" placeholder="z.B. Ukraine, CERN, ..."' +
          ' style="width:100%;box-sizing:border-box;background:var(--bg);border:1px solid var(--border);border-radius:7px;' +
          'padding:8px 12px;font-size:13px;color:var(--text);outline:none;">' +
        '</div>' +
        '<div style="width:80px;">' +
          '<label style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px;">' + t("wz_wiki_lbl_lang", "Language") + '</label>' +
          '<select id="wz-awik-lang" style="width:100%;box-sizing:border-box;background:var(--bg);border:1px solid var(--border);border-radius:7px;' +
          'padding:8px 6px;font-size:13px;color:var(--text);outline:none;">' +
            '<option value="de">DE</option><option value="en">EN</option><option value="fr">FR</option>' +
            '<option value="es">ES</option><option value="ru">RU</option><option value="uk">UK</option>' +
            '<option value="zh">ZH</option><option value="ar">AR</option><option value="ja">JA</option>' +
          '</select>' +
        '</div>' +
      '</div>' +
      '<div id="wz-awik-results" style="max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:7px;background:var(--bg);display:none;"></div>' +
      '<div id="wz-awik-selected" style="display:none;margin-top:8px;padding:6px 10px;background:rgba(99,99,99,.15);border-radius:6px;font-size:12px;color:var(--text);"></div>' +
      '<div style="margin-top:10px;display:flex;gap:10px;align-items:flex-end;">' +
        '<div style="flex:1;">' +
          '<label style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px;">' + t("wz_wiki_lbl_name", "Watch Zone Name") + '</label>' +
          '<input id="wz-awik-name" type="text" placeholder="e.g. Ukraine-Artikel"' +
          ' style="width:100%;box-sizing:border-box;background:var(--bg);border:1px solid var(--border);border-radius:7px;' +
          'padding:8px 12px;font-size:13px;color:var(--text);outline:none;">' +
        '</div>' +
        '<button id="wz-awik-add" style="padding:8px 20px;background:var(--accent3);color:#fff;border:none;border-radius:7px;' +
        'font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;flex-shrink:0;">' +
          t("wz_wiki_add", "+ Add") +
        '</button>' +
      '</div>' +
      '<div style="margin-top:10px;">' +
        '<label style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px;">Time Focus (' + t("wz_optional","optional") + ')</label>' +
        '<select id="wz-awik-event" style="width:100%;box-sizing:border-box;background:var(--bg);border:1px solid var(--border);border-radius:7px;padding:6px 10px;font-size:12px;color:var(--text);">' +
          '<option value="">' + t("wz_no_time_focus","-- Kein Time Focus --") + '</option>' +
        '</select>' +
      '</div>' +
      '<div id="wz-awik-err" style="display:none;margin-top:8px;font-size:12px;color:#f87171;"></div>' +
    '</div>' +
  '</div>';

  document.body.appendChild(modal);

  // Close
  document.getElementById("wz-awik-close").onclick = function() { modal.remove(); };
  modal.addEventListener("click", function(e) { if (e.target === modal) modal.remove(); });

  // Load events for time focus
  (async function() {
    try {
      var projectId = document.getElementById("hdr-wz-project")?.value || null;
      var evUrl = "/api/events" + (projectId ? "?project_id=" + projectId : "");
      var evR = await fetch(evUrl);
      if (evR.ok) {
        var events = await evR.json();
        var sel = document.getElementById("wz-awik-event");
        events.forEach(function(ev) {
          var dateInfo = ev.start_dt || "";
          if (ev.end_dt) dateInfo += " \u2013 " + ev.end_dt;
          var opt = document.createElement("option");
          opt.value = ev.id;
          opt.textContent = ev.title + " (" + dateInfo + ")";
          sel.appendChild(opt);
        });
      }
    } catch(e) {}
  })();

  // Search with debounce
  var searchInput = document.getElementById("wz-awik-search");
  searchInput.addEventListener("input", function() {
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(function() { _doWikiSearch(); }, 400);
  });

  function _doWikiSearch() {
    var q = searchInput.value.trim();
    var lang = document.getElementById("wz-awik-lang").value;
    var resultsEl = document.getElementById("wz-awik-results");
    if (!q) { resultsEl.style.display = "none"; return; }

    resultsEl.style.display = "block";
    resultsEl.innerHTML = '<div style="padding:10px;color:var(--muted);font-size:12px;">' + t("wz_wiki_searching", "Searching \u2026") + '</div>';

    var url = "https://" + lang + ".wikipedia.org/w/api.php?action=query&list=search" +
      "&srsearch=" + encodeURIComponent(q) + "&srlimit=8&format=json&origin=*";

    fetch(url).then(function(r) { return r.json(); }).then(function(data) {
      var hits = (data.query || {}).search || [];
      if (!hits.length) {
        resultsEl.innerHTML = '<div style="padding:10px;color:var(--muted);font-size:12px;">' + t("wz_wiki_no_results", "No results") + '</div>';
        return;
      }
      var html = "";
      for (var i = 0; i < hits.length; i++) {
        var h = hits[i];
        html += '<div class="wz-wiki-search-item" data-title="' + h.title.replace(/"/g, "&quot;") + '"' +
          ' style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border);font-size:12px;' +
          'transition:background .1s;" onmouseover="this.style.background=\'var(--surface2)\'" onmouseout="this.style.background=\'\'">' +
          '<div style="font-weight:600;color:var(--text);">' + h.title + '</div>' +
          '<div style="color:var(--muted);font-size:11px;margin-top:2px;">' + (h.snippet || "").replace(/<[^>]+>/g, "").substring(0, 120) + '</div>' +
        '</div>';
      }
      resultsEl.innerHTML = html;

      // Click handler for results
      resultsEl.querySelectorAll(".wz-wiki-search-item").forEach(function(el) {
        el.addEventListener("click", function() {
          _selectedTitle = el.getAttribute("data-title");
          document.getElementById("wz-awik-selected").style.display = "block";
          document.getElementById("wz-awik-selected").textContent = "\u2713 " + _selectedTitle;
          resultsEl.style.display = "none";
          // Auto-fill name if not edited
          var nameEl = document.getElementById("wz-awik-name");
          if (!nameEl.dataset.edited) nameEl.value = _selectedTitle;
        });
      });
    }).catch(function() {
      resultsEl.innerHTML = '<div style="padding:10px;color:#f87171;font-size:12px;">Fehler bei der Suche</div>';
    });
  }

  // Name edited flag
  document.getElementById("wz-awik-name").addEventListener("input", function() {
    this.dataset.edited = "1";
  });

  // Add button
  document.getElementById("wz-awik-add").onclick = async function() {
    var errEl = document.getElementById("wz-awik-err");
    errEl.style.display = "none";

    if (!_selectedTitle) {
      errEl.textContent = t("wz_wiki_err_article", "Please select an article.");
      errEl.style.display = "block";
      return;
    }

    var lang = document.getElementById("wz-awik-lang").value;
    var nameVal = (document.getElementById("wz-awik-name").value || "").trim() || _selectedTitle;
    var projectId = document.getElementById("hdr-wz-project")?.value || null;

    // Check if zone for this plugin already exists → add article to existing
    var existingZone = WZ._zones.find(function(z) {
      return z.zone_type === "wikipedia" && z.name === nameVal;
    });

    if (existingZone) {
      // Add article to existing zone config
      var cfg = existingZone.config || {};
      var articles = cfg.articles || [];
      if (!articles.includes(_selectedTitle)) articles.push(_selectedTitle);
      cfg.articles = articles;
      cfg.lang = lang;
      try {
        var r = await fetch("/api/watchzones/" + existingZone.id, {
          method: "PATCH", headers: {"Content-Type": "application/json"},
          body: JSON.stringify({ config: cfg })
        });
        if (r.ok) {
          existingZone.config = cfg;
          WZ._renderAllZones();
          modal.remove();
        }
      } catch(e) { console.error("Update wiki zone error:", e); }
    } else {
      // Create new zone
      // Use a global geometry (no map polygon needed for Wikipedia)
      var geometry = { type: "Polygon", coordinates: [[[-180,-90],[180,-90],[180,90],[-180,90],[-180,-90]]] };
      var _wikiConfig = { articles: [_selectedTitle], lang: lang };
      // Time Focus
      var _wikiEvVal = document.getElementById("wz-awik-event")?.value;
      if (_wikiEvVal) {
        try {
          var _evR3 = await fetch("/api/events");
          if (_evR3.ok) {
            var _allEvts3 = await _evR3.json();
            var _selEv3 = _allEvts3.find(function(e) { return e.id === parseInt(_wikiEvVal); });
            if (_selEv3) {
              _wikiConfig.time_focus = { event_id: _selEv3.id, title: _selEv3.title, from: _selEv3.start_dt, to: _selEv3.end_dt || _selEv3.start_dt };
              if (_selEv3.lat != null && _selEv3.lon != null) {
                _wikiConfig.time_focus.lat = _selEv3.lat;
                _wikiConfig.time_focus.lon = _selEv3.lon;
                _wikiConfig.time_focus.location_name = _selEv3.location_name || "";
              }
            }
          }
        } catch(e) {}
      }
      try {
        var r = await fetch("/api/watchzones", {
          method: "POST", headers: {"Content-Type": "application/json"},
          body: JSON.stringify({
            name: nameVal,
            zone_type: "wikipedia",
            geometry: geometry,
            config: _wikiConfig,
            project_id: projectId ? parseInt(projectId) : null,
          })
        });
        if (r.ok) {
          var z = await r.json();
          WZ._zones.push(z);
          WZ._renderAllZones();
          modal.remove();
        }
      } catch(e) { console.error("Save wiki zone error:", e); }
    }
  };

  // Focus
  setTimeout(function() { searchInput.focus(); }, 60);
};


// ── Autoren-Farben ──
var _AUTHOR_COLORS = [
  '#06b6d4','#f59e0b','#8b5cf6','#22c55e','#ef4444','#ec4899',
  '#3b82f6','#14b8a6','#f97316','#a78bfa','#64748b','#84cc16',
  '#e879f9','#0ea5e9','#fb923c','#10b981','#f43f5e','#6366f1',
  '#facc15','#94a3b8'
];

function _repColor(score) {
  if (score == null) return '#64748b';
  if (score >= 70) return '#22c55e';
  if (score >= 50) return '#3b82f6';
  if (score >= 30) return '#f59e0b';
  if (score >= 15) return '#f97316';
  return '#ef4444';
}

function _repLabel(score) {
  if (score == null) return '–';
  if (score >= 70) return t('wz_wiki_rep_very_high','sehr hoch');
  if (score >= 50) return t('wz_wiki_rep_high','hoch');
  if (score >= 30) return t('wz_wiki_rep_medium','mittel');
  if (score >= 15) return t('wz_wiki_rep_low','niedrig');
  return t('wz_wiki_rep_very_low','sehr niedrig');
}

// UTC Stunde+Minute → Lokalzeit konvertieren
function _utcToLocal(date, hour, min) {
  var d = new Date(date + 'T' + String(hour).padStart(2,'0') + ':' + String(min).padStart(2,'0') + ':00Z');
  return { hour: d.getHours(), min: d.getMinutes() };
}

// ── Live Renderer ────────────────────────────────────────────────
function _renderWikipediaLive(data) {
  var _wkPeriod = "";
  if (data.time_focus && data.time_focus.from) {
    var _fd2 = function(d) { return window.fmtDateOnly ? window.fmtDateOnly(d.length <= 10 ? d + "T00:00" : d) : d.slice(0,10); };
    _wkPeriod = " \u00b7 " + _fd2(data.time_focus.from) + " \u2013 " + _fd2(data.time_focus.to || data.time_focus.from);
  }
  document.getElementById("wz-live-count").textContent =
    data.count != null ? data.count + " " + t("wz_wiki_live_edits", "Edits") + _wkPeriod : "";

  var mapRow = document.getElementById("wz-map-row");
  if (mapRow) mapRow.style.display = "none";
  var resizeMap = document.getElementById("wz-resize-map");
  if (resizeMap) resizeMap.style.display = "none";

  var content = document.getElementById("wz-live-content");
  if (content) content.style.padding = '4px 16px 12px';
  // Live-Box + Body auf volle Breite
  var liveBox = document.getElementById("wz-live-box");
  if (liveBox) liveBox.style.maxWidth = '1500px';
  var liveBody = document.getElementById("wz-live-body");
  if (liveBody) { liveBody.style.display = 'block'; liveBody.style.overflow = 'auto'; }
  var articles = data.articles || [];
  var lang = data.lang || "de";

  if (!articles.length) {
    content.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);">' +
      t("wz_wiki_live_no_edits", "No edits in period") + '</div>';
    return;
  }

  // Time Focus
  var _wikiTf = data.time_focus || null;
  var _wkFmtD = function(d) {
    if (!d) return "";
    var iso = d.length <= 10 ? d + "T00:00" : d;
    return window.fmtDate ? window.fmtDate(iso) : (window.fmtDateOnly ? window.fmtDateOnly(iso) : d.slice(0, 10));
  };

  var html = '<div>';

  // Time Focus badge
  if (_wikiTf) {
    var _tfcBadge = _wikiTf.color || '#f59e0b';
    html += '<div style="margin-bottom:8px;padding:6px 10px;background:' + _tfcBadge + '1a;border:1px solid ' + _tfcBadge + '40;border-radius:6px;">' +
      '<span style="font-size:12px;font-weight:700;color:' + _tfcBadge + ';">Time Focus: ' + WZ._esc(_wikiTf.title || "") + '</span>' +
      '<span style="font-size:11px;color:var(--muted);margin-left:6px;">' + _wkFmtD(_wikiTf.from || "") + (_wikiTf.to && _wikiTf.to !== _wikiTf.from ? ' \u2013 ' + _wkFmtD(_wikiTf.to) : '') + '</span>' +
    '</div>';
  }

  for (var ai = 0; ai < articles.length; ai++) {
    var art = articles[ai];
    if (art.error) {
      html += '<div style="padding:10px;margin-bottom:8px;background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.3);border-radius:8px;font-size:12px;color:#f87171;">' +
        (art.article || '') + ' — ' + (art.error === 'not_found' ? t("wz_wiki_no_results","Not found") : art.error) + '</div>';
      continue;
    }

    var wikiTitle = art.wiki_title || art.article;
    var totalEdits = art.total_edits || 0;
    var series = art.series || [];
    var authors = art.authors || [];
    var totalSize = 0;
    for (var s = 0; s < series.length; s++) totalSize += (series[s].size_delta || 0);
    var avgEdits = series.length > 0 ? (totalEdits / 30).toFixed(1) : "0";
    var sizeSign = totalSize >= 0 ? "+" : "";

    // Autoren-Farbzuordnung
    var authorColorMap = {};
    for (var ci = 0; ci < authors.length && ci < _AUTHOR_COLORS.length; ci++) {
      authorColorMap[authors[ci].user] = _AUTHOR_COLORS[ci];
    }

    // Article card
    html += '<div class="wz-wiki-article" style="margin-bottom:8px;">';

    // Header mit Zeitraum + Datepicker
    var _fd = typeof fmtDateOnly === 'function' ? fmtDateOnly : function(s){return s;};
    var dateFrom = series.length ? series[0].date : '';
    var dateTo = series.length ? series[series.length - 1].date : '';
    var dpId = 'wz-wiki-dp-' + ai + '-' + Date.now();
    html += '<div style="padding:8px 8px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
      '<span style="font-size:13px;font-weight:700;color:var(--text);">' + wikiTitle + '</span>' +
      '<span style="font-size:10px;color:var(--muted);background:var(--bg);padding:2px 6px;border-radius:4px;">' + lang + '.wikipedia</span>' +
      '<span style="font-size:11px;color:var(--muted);">' + _fd(dateFrom) + ' \u2013 ' + _fd(dateTo) + '</span>' +
      '<span style="position:relative;display:inline-block;">' +
        '<span id="' + dpId + '-label" style="font-size:11px;padding:2px 8px;border:1px solid var(--border);border-radius:5px;background:var(--surface);color:var(--text);cursor:pointer;white-space:nowrap;" title="' + t("wz_wiki_change_end","Enddatum \u00e4ndern") + '">' + _fd(dateTo) + '</span>' +
        '<input type="date" id="' + dpId + '" value="' + dateTo + '" max="' + new Date().toISOString().slice(0,10) + '"' +
        ' style="position:absolute;top:0;left:0;width:100%;height:100%;opacity:0;cursor:pointer;" />' +
      '</span>' +
      '<span style="flex:1;"></span>' +
      '<a href="https://' + lang + '.wikipedia.org/wiki/' + encodeURIComponent(wikiTitle.replace(/ /g, "_")) + '" target="_blank" rel="noopener"' +
      ' style="font-size:11px;color:var(--accent3);text-decoration:none;">' + t("wz_wiki_open_article", "Open article") + ' \u2197</a>' +
    '</div>';

    // Stats row
    html += '<div style="padding:8px 8px;display:flex;gap:16px;flex-wrap:wrap;">';
    html += '<div style="text-align:center;"><div style="font-size:22px;font-weight:800;color:' + (totalEdits > 10 ? '#f59e0b' : 'var(--text)') + ';">' + totalEdits + '</div>' +
      '<div style="font-size:10px;color:var(--muted);text-transform:uppercase;">' + t("wz_wiki_total","Total") + ' ' + t("wz_wiki_live_edits","Edits") + '</div></div>';
    html += '<div style="text-align:center;"><div style="font-size:22px;font-weight:800;color:var(--text);">' + avgEdits + '</div>' +
      '<div style="font-size:10px;color:var(--muted);text-transform:uppercase;">' + t("wz_wiki_daily_avg","Daily average") + '</div></div>';
    html += '<div style="text-align:center;"><div style="font-size:22px;font-weight:800;color:' + (totalSize >= 0 ? '#22c55e' : '#ef4444') + ';">' + sizeSign + _formatBytes(totalSize) + '</div>' +
      '<div style="font-size:10px;color:var(--muted);text-transform:uppercase;">' + t("wz_wiki_live_size","Size change") + '</div></div>';
    // Reverts
    var totalReverts = art.total_reverts || 0;
    if (totalReverts > 0) {
      html += '<div style="text-align:center;"><div style="font-size:22px;font-weight:800;color:#f97316;">' + totalReverts + '</div>' +
        '<div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Reverts</div></div>';
    }
    // Durchschnittliche Reputation
    var repScores = authors.filter(function(a){return a.reputation != null;}).map(function(a){return a.reputation;});
    if (repScores.length) {
      var avgRep = Math.round(repScores.reduce(function(s,v){return s+v;},0) / repScores.length);
      html += '<div style="text-align:center;"><div style="font-size:22px;font-weight:800;color:' + _repColor(avgRep) + ';">' + avgRep + '</div>' +
        '<div style="font-size:10px;color:var(--muted);text-transform:uppercase;">\u00d8 Reputation</div></div>';
    }
    html += '</div>';

    // ── Charts + Autorenliste side-by-side ──
    var barChartId = 'wz-wiki-bars-' + ai + '-' + Date.now();
    var authorListId = 'wz-wiki-aulist-' + ai + '-' + Date.now();
    var pcId = 'wz-wiki-pc-' + ai + '-' + Date.now();
    var barH = 220;

    if (series.length > 0 || authors.length) {
      html += '<div style="display:flex;gap:0;">';

      // Links: Diagramme
      html += '<div class="wz-wiki-charts-col" style="flex:1;min-width:0;">';
      var barModeId = 'wz-wiki-barmode-' + ai + '-' + Date.now();
      if (series.length > 0) {
        html += '<div class="wz-wiki-bar-wrap" style="padding:4px 0 4px;">';
        html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">' +
          '<span style="font-size:13px;color:var(--text);font-weight:600;">' + t("wz_wiki_edits_views","Bearbeitungen & Aufrufe") + ' \u00b7 ' +
          (series.length > 0 ? _wkFmtD(series[0].date) + ' \u2013 ' + _wkFmtD(series[series.length - 1].date) : t("wz_wiki_live_period","last 30 days")) + '</span>' +
          '<span style="flex:1;"></span>' +
          '<div id="' + barModeId + '" style="display:inline-flex;border:1px solid var(--border);border-radius:5px;overflow:hidden;font-size:10px;">' +
            '<button data-mode="authors" style="padding:2px 10px;background:var(--accent3);color:#fff;border:none;cursor:pointer;font-weight:600;">Autoren</button>' +
            '<button data-mode="reputation" style="padding:2px 10px;background:none;color:var(--muted);border:none;border-left:1px solid var(--border);cursor:pointer;">Reputation</button>' +
          '</div></div>';
        var viewsLineId = 'wz-wiki-views-' + ai + '-' + Date.now();
        var yAxisId = 'wz-wiki-yaxis-' + ai + '-' + Date.now();
        var yAxisRId = 'wz-wiki-yaxisr-' + ai + '-' + Date.now();
        var legendId = 'wz-wiki-legend-' + ai + '-' + Date.now();
        html += '<div style="display:flex;gap:0;">' +
          '<div id="' + yAxisId + '" style="width:28px;height:' + barH + 'px;display:flex;flex-direction:column;justify-content:space-between;align-items:flex-end;padding-right:4px;flex-shrink:0;"></div>' +
          '<div style="position:relative;flex:1;min-width:0;">' +
            '<div id="' + barChartId + '" style="display:flex;align-items:flex-end;gap:1px;height:' + barH + 'px;"></div>' +
            '<svg id="' + viewsLineId + '" style="position:absolute;top:0;left:0;width:100%;height:' + barH + 'px;pointer-events:none;"></svg>' +
          '</div>' +
          '<div id="' + yAxisRId + '" style="width:38px;height:' + barH + 'px;display:flex;flex-direction:column;justify-content:space-between;align-items:flex-start;padding-left:4px;flex-shrink:0;"></div>' +
        '</div>' +
        '<div id="' + legendId + '" style="display:flex;gap:12px;font-size:10px;color:var(--muted);margin-top:2px;padding-left:28px;"></div>';
        // Reputation-Legende (initial hidden)
        html += '<div id="' + barChartId + '-rep-legend" style="display:none;margin-top:4px;display:none;font-size:10px;color:var(--muted);">' +
          '<span style="display:inline-flex;align-items:center;gap:3px;margin-right:10px;"><span style="width:10px;height:10px;border-radius:2px;background:#22c55e;display:inline-block;"></span> \u226570 sehr hoch</span>' +
          '<span style="display:inline-flex;align-items:center;gap:3px;margin-right:10px;"><span style="width:10px;height:10px;border-radius:2px;background:#3b82f6;display:inline-block;"></span> \u226550 hoch</span>' +
          '<span style="display:inline-flex;align-items:center;gap:3px;margin-right:10px;"><span style="width:10px;height:10px;border-radius:2px;background:#f59e0b;display:inline-block;"></span> \u226530 mittel</span>' +
          '<span style="display:inline-flex;align-items:center;gap:3px;margin-right:10px;"><span style="width:10px;height:10px;border-radius:2px;background:#f97316;display:inline-block;"></span> \u226515 niedrig</span>' +
          '<span style="display:inline-flex;align-items:center;gap:3px;"><span style="width:10px;height:10px;border-radius:2px;background:#ef4444;display:inline-block;"></span> &lt;15 sehr niedrig</span>' +
        '</div>';
        html += '</div>';
      }
      // Timeline PC + Autoren-Analyse: im Fullscreen nebeneinander
      var tlPcId = 'wz-wiki-tlpc-' + ai + '-' + Date.now();
      var _hasTimeline = series.length > 1;
      var _hasPC = authors.length > 1;
      if (_hasTimeline || _hasPC) {
        html += '<div class="wz-wiki-bottom-row">';
        if (_hasTimeline) {
          html += '<div class="wz-wiki-bottom-panel" style="padding:4px 0 4px;">' +
            '<div style="font-size:13px;color:var(--text);margin-bottom:6px;font-weight:600;">' + t("wz_wiki_timeline","Edit-Timeline") + ' <span style="font-weight:400;font-size:11px;color:var(--muted);">\u2013 Jede Linie = ein Edit, Y = Uhrzeit</span></div>' +
            '<div id="' + tlPcId + '" style="width:100%;height:300px;overflow-x:auto;"></div></div>';
        }
        if (_hasPC) {
          html += '<div class="wz-wiki-bottom-panel" style="padding:4px 0 4px;">' +
            '<div style="font-size:13px;color:var(--text);margin-bottom:6px;font-weight:600;">' + t("wz_wiki_parcoords","Autoren-Analyse") + ' <span style="font-weight:400;font-size:11px;color:var(--muted);">\u2013 ' + t("wz_wiki_pc_hint","Achsen ziehen zum Filtern") + '</span></div>' +
            '<div id="' + pcId + '" style="width:100%;height:320px;"></div></div>';
        }
        html += '</div>';
      }
      html += '</div>';

      // Rechts: Autorenliste vertikal
      if (authors.length) {
        html += '<div id="' + authorListId + '" style="flex:0 0 170px;padding:4px 0 4px 8px;border-left:1px solid var(--border);overflow-y:auto;max-height:' + (barH + 360) + 'px;font-size:11px;">';
        html += '<div style="font-size:10px;color:var(--muted);margin-bottom:6px;font-weight:700;">' + t("wz_wiki_authors","Autoren") + ' (' + authors.length + ')</div>';
        for (var ali = 0; ali < authors.length; ali++) {
          var au = authors[ali];
          var clr = authorColorMap[au.user] || '#64748b';
          var revertBadge = au.reverts ? '<span style="font-size:9px;padding:1px 3px;border-radius:3px;background:#f9731622;color:#f97316;font-weight:600;">'+au.reverts+'rv</span>' : '';
          var repBadge = au.reputation != null
            ? '<span style="font-size:9px;padding:1px 3px;border-radius:3px;background:'+_repColor(au.reputation)+'22;color:'+_repColor(au.reputation)+';font-weight:600;">'+au.reputation+'</span>'
            : (au.is_ip ? '<span style="font-size:9px;color:var(--muted);">IP</span>' : '');
          var ageBadge = au.age_days != null
            ? '<span style="font-size:9px;color:var(--muted);" title="Account-Alter">' + (au.age_days >= 365 ? Math.floor(au.age_days/365)+'y' : au.age_days+'d') + '</span>'
            : '';
          html += '<div class="wz-wiki-author-item" data-user="' + au.user.replace(/"/g,'&quot;') + '"' +
            ' style="display:flex;align-items:center;gap:4px;padding:3px 2px;border-bottom:1px solid var(--border);cursor:pointer;transition:background .1s;"' +
            ' onmouseover="this.style.background=\'var(--surface2)\'" onmouseout="this.style.background=\'\'">' +
            '<div style="width:8px;height:8px;border-radius:2px;background:'+clr+';flex-shrink:0;"></div>' +
            '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text);" title="'+au.user+'">'+au.user+'</span>' +
            '<span style="font-size:10px;color:var(--muted);flex-shrink:0;">'+au.edits+'</span>' +
            revertBadge + repBadge + ageBadge +
          '</div>';
        }
        html += '</div>';
      }

      html += '</div>'; // flex row end
    }

    html += '</div>'; // card end

    // ── Post-render: Balkengrafik + Hover + Parallel Coordinates ──
    (function(_barId, _auListId, _pcId, _tlPcId, _barModeId, _series, _authors, _colorMap, _barH, _maxEdits, _authorColorMap, _viewsLineId, _viewsData, _yAxisId, _yAxisRId, _legendId) {

      var _barMode = 'authors'; // 'authors' | 'reputation'
      var _pcFilteredUsers = null; // null = kein Filter, Set = nur diese Autoren

      // Reputation-Lookup
      var _repMap = {};
      for (var ri = 0; ri < _authors.length; ri++) {
        if (_authors[ri].reputation != null) _repMap[_authors[ri].user] = _authors[ri].reputation;
      }

      function _renderBars(highlightUser) {
        var el = document.getElementById(_barId);
        if (!el) return;
        // Max berechnen – immer auf Basis aller (sichtbaren) Edits
        var maxE = 1;
        for (var si = 0; si < _series.length; si++) {
          var dayA = _series[si].authors || [];
          if (_pcFilteredUsers && !highlightUser) {
            var filteredSum = 0;
            for (var da = 0; da < dayA.length; da++) {
              if (_pcFilteredUsers.has(dayA[da].user)) filteredSum += dayA[da].edits;
            }
            if (filteredSum > maxE) maxE = filteredSum;
          } else {
            if (_series[si].edits > maxE) maxE = _series[si].edits;
          }
        }

        var _fd = typeof fmtDateOnly === 'function' ? fmtDateOnly : function(s){return s;};
        var bhtml = '';
        for (var bi = 0; bi < _series.length; bi++) {
          var day = _series[bi];
          var dayAuthors = day.authors || [];
          // PC-Filter anwenden
          if (!highlightUser && _pcFilteredUsers) {
            dayAuthors = dayAuthors.filter(function(a){return _pcFilteredUsers.has(a.user);});
          }
          var displayEdits = dayAuthors.reduce(function(s,a){return s+a.edits;},0);
          var totalH = displayEdits === 0 ? 2 : Math.max(4, Math.round((displayEdits / maxE) * (_barH - 8)));

          var segments = '';
          if (highlightUser && dayAuthors.length && displayEdits > 0) {
            // Alle Segmente zeigen, aber nur der highlighted in Farbe
            for (var da = 0; da < dayAuthors.length; da++) {
              var au = dayAuthors[da];
              var segH = Math.max(1, Math.round((au.edits / displayEdits) * totalH));
              var isHL = au.user === highlightUser;
              var clr = isHL ? (_authorColorMap[au.user] || '#64748b') : 'rgba(100,116,139,0.2)';
              segments += '<div style="width:100%;height:'+segH+'px;background:'+clr+';'+(da===0?'border-radius:2px 2px 0 0;':'')+'"></div>';
            }
          } else if (_barMode === 'reputation' && dayAuthors.length && displayEdits > 0) {
            // Reputations-Modus: Segmente nach Rep-Farbe
            for (var da = 0; da < dayAuthors.length; da++) {
              var au = dayAuthors[da];
              var segH = Math.max(1, Math.round((au.edits / displayEdits) * totalH));
              var rep = _repMap[au.user];
              var clr = rep != null ? _repColor(rep) : '#64748b';
              segments += '<div style="width:100%;height:'+segH+'px;background:'+clr+';'+(da===0?'border-radius:2px 2px 0 0;':'')+'" title="'+au.user+': Rep '+(rep!=null?rep:'?')+'"></div>';
            }
          } else if (dayAuthors.length && displayEdits > 0) {
            // Autoren-Modus
            for (var da = 0; da < dayAuthors.length; da++) {
              var au = dayAuthors[da];
              var segH = Math.max(1, Math.round((au.edits / displayEdits) * totalH));
              var clr = _authorColorMap[au.user] || '#64748b';
              segments += '<div style="width:100%;height:'+segH+'px;background:'+clr+';'+(da===0?'border-radius:2px 2px 0 0;':'')+'"></div>';
            }
          } else {
            segments = '<div style="width:100%;height:'+totalH+'px;background:'+(day.edits===0?'var(--border)':'#636363')+';border-radius:2px 2px 0 0;"></div>';
          }

          // Rep indicator
          var dayRep = null;
          if (!highlightUser && dayAuthors.length) {
            var drs = 0, drn = 0;
            for (var dr = 0; dr < dayAuthors.length; dr++) {
              for (var ar = 0; ar < _authors.length; ar++) {
                if (_authors[ar].user === dayAuthors[dr].user && _authors[ar].reputation != null) {
                  drs += _authors[ar].reputation * dayAuthors[dr].edits; drn += dayAuthors[dr].edits; break;
                }
              }
            }
            if (drn > 0) dayRep = Math.round(drs / drn);
          }

          bhtml += '<div style="flex:1;min-width:0;display:flex;flex-direction:column;justify-content:flex-end;height:'+(_barH+6)+'px;" title="'+_fd(day.date)+': '+displayEdits+' edits">' +
            '<div style="display:flex;flex-direction:column;justify-content:flex-end;">'+segments+'</div>' +
            '<div style="height:4px;margin-top:2px;border-radius:1px;background:'+(dayRep!=null?_repColor(dayRep):'transparent')+';opacity:.7;"></div>' +
          '</div>';
        }
        el.innerHTML = bhtml;
        // Y-Achse aktualisieren
        var yAxisEl = document.getElementById(_yAxisId);
        if (yAxisEl) {
          var ticks = 4;
          var yHtml = '';
          for (var yi = 0; yi <= ticks; yi++) {
            var val = Math.round(maxE * (1 - yi / ticks));
            yHtml += '<span style="font-size:9px;color:var(--muted);line-height:1;">' + val + '</span>';
          }
          yAxisEl.innerHTML = yHtml;
        }
        // Time Focus markers in bar chart
        if (_wikiTf && _wikiTf.from) {
          var _tfcBar = _wikiTf.color || '#f59e0b';
          var _tfBarFrom = _wikiTf.from.slice(0, 10);
          var _tfBarTo = (_wikiTf.to || _wikiTf.from).slice(0, 10);
          var _tfIdxFrom = -1, _tfIdxTo = -1;
          for (var _tbi = 0; _tbi < _series.length; _tbi++) {
            if (_series[_tbi].date === _tfBarFrom && _tfIdxFrom === -1) _tfIdxFrom = _tbi;
            if (_series[_tbi].date === _tfBarTo) _tfIdxTo = _tbi;
          }
          el.style.position = 'relative';
          // Band between start and end
          if (_tfIdxFrom >= 0 && _tfIdxTo >= 0 && _tfIdxFrom !== _tfIdxTo) {
            var _bandL = ((_tfIdxFrom / _series.length) * 100).toFixed(1);
            var _bandW = (((_tfIdxTo - _tfIdxFrom) / _series.length) * 100).toFixed(1);
            var _mkBand = document.createElement('div');
            _mkBand.style.cssText = 'position:absolute;left:' + _bandL + '%;top:0;width:' + _bandW + '%;height:100%;background:' + _tfcBar + ';opacity:.08;pointer-events:none;z-index:1;';
            el.appendChild(_mkBand);
          }
          // Start line
          if (_tfIdxFrom >= 0) {
            var _pctFrom = ((_tfIdxFrom / _series.length) * 100).toFixed(1);
            var _mkLine = document.createElement('div');
            _mkLine.style.cssText = 'position:absolute;left:' + _pctFrom + '%;top:0;width:0;height:100%;border-left:2px dashed ' + _tfcBar + ';opacity:.7;pointer-events:none;z-index:2;';
            el.appendChild(_mkLine);
            var _mkLabel = document.createElement('div');
            _mkLabel.style.cssText = 'position:absolute;left:' + _pctFrom + '%;top:-14px;transform:translateX(-50%);font-size:9px;font-weight:700;color:' + _tfcBar + ';pointer-events:none;white-space:nowrap;z-index:2;';
            _mkLabel.textContent = _wikiTf.title || 'Focus';
            el.appendChild(_mkLabel);
          }
          // End line (only for range events)
          if (_tfIdxTo >= 0 && _tfBarFrom !== _tfBarTo) {
            var _pctTo = ((_tfIdxTo / _series.length) * 100).toFixed(1);
            var _mkLine2 = document.createElement('div');
            _mkLine2.style.cssText = 'position:absolute;left:' + _pctTo + '%;top:0;width:0;height:100%;border-left:2px dashed ' + _tfcBar + ';opacity:.7;pointer-events:none;z-index:2;';
            el.appendChild(_mkLine2);
            var _mkLabel2 = document.createElement('div');
            _mkLabel2.style.cssText = 'position:absolute;left:' + _pctTo + '%;top:-14px;transform:translateX(-50%);font-size:9px;font-weight:700;color:' + _tfcBar + ';pointer-events:none;white-space:nowrap;z-index:2;';
            _mkLabel2.textContent = 'Ende';
            el.appendChild(_mkLabel2);
          }
        }
      }

      // Hover-Events auf Autorenliste
      function _setupHover() {
        var listEl = document.getElementById(_auListId);
        if (!listEl) return;
        listEl.querySelectorAll('.wz-wiki-author-item').forEach(function(item) {
          item.addEventListener('mouseenter', function() {
            _renderBars(item.dataset.user);
          });
          item.addEventListener('mouseleave', function() {
            _renderBars(null);
          });
        });
      }

      // Vertikaler Hover im Balkendiagramm
      function _setupBarHover() {
        var barEl = document.getElementById(_barId);
        if (!barEl) return;
        var wrapper = barEl.parentElement; // position:relative container
        // Hover-Linie + Tooltip erzeugen
        var hoverLine = document.createElement('div');
        hoverLine.style.cssText = 'position:absolute;top:0;width:1px;height:100%;background:var(--text);opacity:.35;pointer-events:none;z-index:3;display:none;';
        wrapper.appendChild(hoverLine);
        var hoverTip = document.createElement('div');
        hoverTip.style.cssText = 'position:absolute;top:-32px;transform:translateX(-50%);background:var(--surface);border:1px solid var(--border);border-radius:5px;padding:2px 8px;font-size:10px;color:var(--text);pointer-events:none;z-index:4;display:none;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.25);';
        wrapper.appendChild(hoverTip);

        // Dateformat-Helfer für Views
        var _viewsMap = {};
        if (_viewsData && _viewsData.length) {
          _viewsData.forEach(function(v) { _viewsMap[v.date] = v.views; });
        }

        barEl.addEventListener('mousemove', function(e) {
          var rect = barEl.getBoundingClientRect();
          var x = e.clientX - rect.left;
          var pct = x / rect.width;
          var idx = Math.min(Math.max(Math.round(pct * (_series.length - 1)), 0), _series.length - 1);
          var day = _series[idx];
          if (!day) return;
          var leftPct = ((idx + 0.5) / _series.length * 100).toFixed(1) + '%';
          hoverLine.style.left = leftPct;
          hoverLine.style.display = '';
          hoverTip.style.left = leftPct;
          hoverTip.style.display = '';
          var views = _viewsMap[day.date];
          var viewsStr = views != null ? ' \u00b7 ' + views.toLocaleString('de-DE') + ' Views' : '';
          hoverTip.textContent = _fd(day.date) + ': ' + (day.edits || 0) + ' Edits' + viewsStr;
        });
        barEl.addEventListener('mouseleave', function() {
          hoverLine.style.display = 'none';
          hoverTip.style.display = 'none';
        });
      }

      // Parallel Coordinates mit Brush-Filtern
      function _drawPC() {
        if (typeof d3 === 'undefined') return;
        var el = document.getElementById(_pcId);
        if (!el) return;

        var w = el.clientWidth || 600, h = 300;
        var margin = {top:28, right:20, bottom:16, left:20};
        var dims = ['edits','size_delta','reverts','age_days','reputation'];
        var dimLabels = {
          edits: t('wz_wiki_pc_edits','Edits'),
          size_delta: t('wz_wiki_pc_size','Umfang (B)'),
          reverts: 'Reverts',
          avg_hour: t('wz_wiki_pc_hour','\u00d8 Uhrzeit'),
          age_days: t('wz_wiki_pc_age','Profilalter (Tage)'),
          reputation: 'Reputation'
        };

        var items = _authors.map(function(a){return {
          user: a.user, edits: a.edits, size_delta: a.size_delta,
          reverts: a.reverts || 0,
          avg_hour: a.avg_hour != null ? a.avg_hour : 12,
          age_days: a.age_days != null ? a.age_days : 0,
          reputation: a.reputation != null ? a.reputation : -1
        };});

        var y = {};
        dims.forEach(function(dim) {
          var ext;
          if (dim === 'avg_hour') ext = [0, 23];
          else if (dim === 'reputation') ext = [0, 100];
          else {
            ext = d3.extent(items, function(d){return d[dim];});
            if (ext[0] === ext[1]) ext[1] = ext[0] + 1;
          }
          y[dim] = d3.scaleLinear().domain(ext).range([h - margin.bottom, margin.top]);
        });

        var x = d3.scalePoint().domain(dims).range([margin.left + 10, w - margin.right]).padding(0.08);
        var svg = d3.select(el).append('svg').attr('width', w).attr('height', h).style('font-family','sans-serif');

        // Brushes state
        var brushes = {};

        function _isSelected(d) {
          for (var dim in brushes) {
            var br = brushes[dim];
            if (!br) continue;
            var val = y[dim](d[dim]);
            if (val < br[0] || val > br[1]) return false;
          }
          return true;
        }

        function _updateVisibility() {
          var hasBrush = Object.keys(brushes).some(function(k){return !!brushes[k];});
          svg.selectAll('.pc-line').each(function() {
            var el = d3.select(this);
            var u = el.attr('data-user');
            var item = items.find(function(d){return d.user === u;});
            var sel = item && _isSelected(item);
            el.attr('stroke-opacity', hasBrush ? (sel ? 0.7 : 0.05) : 0.5);
            el.attr('stroke-width', hasBrush && sel ? 2.5 : 1.5);
          });
          svg.selectAll('.pc-dot').each(function() {
            var el = d3.select(this);
            var u = el.attr('data-user');
            var item = items.find(function(d){return d.user === u;});
            var sel = item && _isSelected(item);
            el.attr('fill-opacity', hasBrush ? (sel ? 0.9 : 0.05) : 0.7);
          });
          // Autorenliste dimmen
          var listEl = document.getElementById(_auListId);
          if (listEl) {
            listEl.querySelectorAll('.wz-wiki-author-item').forEach(function(item) {
              var u = item.dataset.user;
              var it = items.find(function(d){return d.user === u;});
              var sel = it && _isSelected(it);
              item.style.opacity = hasBrush ? (sel ? '1' : '0.2') : '1';
            });
          }
          // Balkengrafik + Timeline synchronisieren
          if (hasBrush) {
            _pcFilteredUsers = new Set(items.filter(_isSelected).map(function(d){return d.user;}));
          } else {
            _pcFilteredUsers = null;
          }
          _renderBars(null);
          // Timeline-Elemente dimmen
          var tlEl = document.getElementById(_tlPcId);
          if (tlEl) {
            var tlSvg = d3.select(tlEl).select('svg');
            if (!tlSvg.empty()) {
              tlSvg.selectAll('.tl-dot').each(function() {
                var el = d3.select(this);
                var u = el.attr('data-user');
                var sel = !hasBrush || (_pcFilteredUsers && _pcFilteredUsers.has(u));
                el.attr('fill-opacity', sel ? 0.7 : 0.05).attr('r', sel ? 3 : 1.5);
              });
              tlSvg.selectAll('.tl-line').each(function() {
                var el = d3.select(this);
                var u = el.attr('data-user');
                var sel = !hasBrush || (_pcFilteredUsers && _pcFilteredUsers.has(u));
                el.attr('stroke-opacity', sel ? 0.35 : 0.03).attr('stroke-width', sel ? 1.2 : 0.5);
              });
            }
          }
        }

        // Axes + Brushes
        dims.forEach(function(dim) {
          var ticks = dim === 'avg_hour' ? 6 : 5;
          var fmt = dim === 'avg_hour' ? function(v){return v+'h';} : null;
          var axis = d3.axisLeft(y[dim]).ticks(ticks);
          if (fmt) axis.tickFormat(fmt);
          var g = svg.append('g').attr('transform','translate('+x(dim)+',0)').call(axis);
          g.selectAll('text').attr('fill','#94a3b8').attr('font-size',9);
          g.selectAll('line,path').attr('stroke','#334155');
          svg.append('text').attr('x',x(dim)).attr('y',margin.top-14)
            .attr('text-anchor','middle').attr('fill','#94a3b8').attr('font-size',10).attr('font-weight',700)
            .text(dimLabels[dim]||dim);

          // Brush
          var brush = d3.brushY()
            .extent([[x(dim)-8, margin.top], [x(dim)+8, h-margin.bottom]])
            .on('brush end', function(event) {
              brushes[dim] = event.selection;
              _updateVisibility();
            });
          var bg = svg.append('g').attr('class','pc-brush').call(brush);
          bg.select('.overlay').attr('fill','transparent');
          bg.select('.selection').attr('fill','rgba(6,182,212,.2)').attr('stroke','#06b6d4').attr('rx',3);
        });

        // Lines
        var line = d3.line();
        items.forEach(function(d) {
          var coords = dims.map(function(dim){return [x(dim), y[dim](d[dim])];});
          svg.append('path').attr('d', line(coords))
            .attr('class','pc-line').attr('fill','none')
            .attr('stroke', _colorMap[d.user]||'#64748b')
            .attr('stroke-width',1.5).attr('stroke-opacity',0.5)
            .attr('data-user', d.user);
          coords.forEach(function(c) {
            svg.append('circle').attr('cx',c[0]).attr('cy',c[1]).attr('r',3)
              .attr('class','pc-dot')
              .attr('fill',_colorMap[d.user]||'#64748b').attr('fill-opacity',0.7)
              .attr('data-user', d.user);
          });
        });

        // Hover-Sync mit Autorenliste
        var listEl = document.getElementById(_auListId);
        if (listEl) {
          listEl.querySelectorAll('.wz-wiki-author-item').forEach(function(item) {
            item.addEventListener('mouseenter', function() {
              var u = item.dataset.user;
              svg.selectAll('.pc-line').each(function() {
                var el = d3.select(this);
                var isU = el.attr('data-user') === u;
                el.attr('stroke-opacity', isU ? 1 : 0.04);
                el.attr('stroke-width', isU ? 3.5 : 1);
              });
              svg.selectAll('.pc-dot').each(function() {
                var el = d3.select(this);
                var isU = el.attr('data-user') === u;
                el.attr('fill-opacity', isU ? 1 : 0.04);
              });
            });
            item.addEventListener('mouseleave', function() {
              _updateVisibility();
            });
          });
        }
      }

      // ── Autor-Klick: Popup mit Änderungsdetails ──
      function _showAuthorPopup(userName) {
        var popId = 'wz-wiki-author-pop';
        document.getElementById(popId)?.remove();

        // Edits dieses Autors aus allen Tagen sammeln
        var userEdits = [];
        for (var si = 0; si < _series.length; si++) {
          var el = _series[si].edits_list || [];
          for (var ei = 0; ei < el.length; ei++) {
            if (el[ei].user === userName) {
              var _loc2 = _utcToLocal(_series[si].date, el[ei].hour, el[ei].min);
              userEdits.push({ date: _series[si].date, hour: _loc2.hour, min: _loc2.min, size_delta: el[ei].size_delta, revert: el[ei].revert, comment: el[ei].comment || '' });
            }
          }
        }
        var authorInfo = _authors.find(function(a){return a.user === userName;}) || {};
        var clr = _authorColorMap[userName] || '#64748b';
        var _fd = typeof fmtDateOnly === 'function' ? fmtDateOnly : function(s){return s;};

        var pop = document.createElement('div');
        pop.id = popId;
        pop.style.cssText = 'position:fixed;inset:0;z-index:10500;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;';
        pop.onclick = function(e){ if(e.target===pop) pop.remove(); };

        var repHtml = authorInfo.reputation != null
          ? '<span style="padding:2px 8px;border-radius:4px;background:' + _repColor(authorInfo.reputation) + '22;color:' + _repColor(authorInfo.reputation) + ';font-weight:700;">Rep: ' + authorInfo.reputation + ' (' + _repLabel(authorInfo.reputation) + ')</span>'
          : (authorInfo.is_ip ? '<span style="color:var(--muted);">Anonyme IP</span>' : '');
        var ageHtml = authorInfo.age_days != null ? '<span style="color:var(--muted);">Account: ' + (authorInfo.age_days >= 365 ? Math.floor(authorInfo.age_days/365) + ' Jahre' : authorInfo.age_days + ' Tage') + '</span>' : '';

        var editsHtml = '';
        if (userEdits.length) {
          editsHtml = '<div style="max-height:400px;overflow-y:auto;margin-top:10px;">';
          editsHtml += '<table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr style="border-bottom:2px solid var(--border);">' +
            '<th style="text-align:left;padding:4px 8px;color:var(--muted);white-space:nowrap;">Datum</th>' +
            '<th style="text-align:left;padding:4px 8px;color:var(--muted);white-space:nowrap;">Uhrzeit</th>' +
            '<th style="text-align:right;padding:4px 8px;color:var(--muted);white-space:nowrap;">Umfang</th>' +
            '<th style="text-align:center;padding:4px 8px;color:var(--muted);">Rv</th>' +
            '<th style="text-align:left;padding:4px 8px;color:var(--muted);">' + t("wz_wiki_comment","\u00c4nderung") + '</th></tr></thead><tbody>';
          for (var i = 0; i < userEdits.length; i++) {
            var e = userEdits[i];
            var sizeClr = e.size_delta >= 0 ? '#22c55e' : '#ef4444';
            var sizeSign = e.size_delta >= 0 ? '+' : '';
            var commentEsc = (e.comment || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
            // Kommentar kürzen und Wiki-Links bereinigen
            commentEsc = commentEsc.replace(/\/\*\s*(.*?)\s*\*\//g, '<span style="color:var(--accent3);font-weight:600;">$1</span>');
            editsHtml += '<tr style="border-bottom:1px solid var(--border);">' +
              '<td style="padding:5px 8px;white-space:nowrap;">' + _fd(e.date) + '</td>' +
              '<td style="padding:5px 8px;white-space:nowrap;">' + String(e.hour).padStart(2,'0') + ':' + String(e.min).padStart(2,'0') + '</td>' +
              '<td style="padding:3px 8px;text-align:right;white-space:nowrap;color:' + sizeClr + ';">' + sizeSign + e.size_delta + ' B</td>' +
              '<td style="padding:3px 8px;text-align:center;">' + (e.revert ? '<span style="color:#f97316;">rv</span>' : '') + '</td>' +
              '<td style="padding:4px 8px;color:var(--text);max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + (e.comment||'').replace(/"/g,'&quot;') + '">' + (commentEsc || '<span style="opacity:.3;">\u2013</span>') + '</td></tr>';
          }
          editsHtml += '</tbody></table></div>';
        } else {
          editsHtml = '<div style="padding:12px;color:var(--muted);font-size:12px;">Keine Detail-Daten verfügbar.</div>';
        }

        pop.innerHTML = '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;' +
          'width:92%;max-width:820px;max-height:85vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.5);">' +
          '<div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px;">' +
            '<div style="width:12px;height:12px;border-radius:3px;background:' + clr + ';"></div>' +
            '<span style="font-size:14px;font-weight:700;color:var(--text);">' + userName + '</span>' +
            '<span style="font-size:11px;color:var(--muted);">' + (authorInfo.edits || 0) + ' Edits</span>' +
            '<span style="flex:1;"></span>' +
            '<button onclick="document.getElementById(\'' + popId + '\').remove()" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:18px;">&#10005;</button>' +
          '</div>' +
          '<div style="padding:10px 16px;display:flex;gap:12px;flex-wrap:wrap;font-size:13px;">' +
            repHtml + ageHtml +
            (authorInfo.reverts ? '<span style="color:#f97316;">Reverts: ' + authorInfo.reverts + '</span>' : '') +
          '</div>' +
          '<div style="padding:0 16px 14px;flex:1;overflow:auto;">' + editsHtml + '</div>' +
        '</div>';
        document.body.appendChild(pop);
      }

      // ── Timeline-PC: Tage als Achsen, Y = Uhrzeit, Farbe = Autor ──
      function _drawTimelinePC() {
        if (typeof d3 === 'undefined') return;
        var el = document.getElementById(_tlPcId);
        if (!el) return;

        // Alle Tage aus der Series (inkl. Tage ohne Edits)
        var allEdits = [];
        var daySet = [];
        for (var si = 0; si < _series.length; si++) {
          var d = _series[si];
          daySet.push(d.date);
          var el2 = d.edits_list || [];
          for (var ei = 0; ei < el2.length; ei++) {
            var _loc = _utcToLocal(d.date, el2[ei].hour, el2[ei].min);
            allEdits.push({ date: d.date, user: el2[ei].user, time: _loc.hour + _loc.min / 60,
              comment: el2[ei].comment || '', revid: el2[ei].revid, size_diff: el2[ei].size_diff });
          }
        }
        if (!allEdits.length || daySet.length < 2) {
          el.innerHTML = '<div style="color:var(--muted);padding:10px;font-size:11px;">Zu wenig Daten f\u00fcr Timeline.</div>';
          return;
        }

        var w = Math.max(el.clientWidth || 600, daySet.length * 24 + 80);
        var h = 280;
        var margin = {top:20, right:16, bottom:50, left:44};

        var svg = d3.select(el).append('svg').attr('width', w).attr('height', h).style('font-family','sans-serif');

        var x = d3.scalePoint().domain(daySet).range([margin.left, w - margin.right]).padding(0.3);
        var y = d3.scaleLinear().domain([0, 24]).range([margin.top, h - margin.bottom]);

        // X-Achse: Tage
        var _fdTl = typeof fmtDateOnly === 'function' ? fmtDateOnly : function(s){return s.slice(5);};
        var xAxis = svg.append('g').attr('transform','translate(0,' + (h-margin.bottom) + ')').call(d3.axisBottom(x).tickFormat(function(d){return _fdTl(d);}));
        xAxis.selectAll('text').attr('fill','#94a3b8').attr('font-size',10).attr('transform','rotate(-45)').attr('text-anchor','end');
        xAxis.selectAll('line,path').attr('stroke','#334155');

        // Y-Achse: Uhrzeit
        var yAxis = svg.append('g').attr('transform','translate('+margin.left+',0)').call(d3.axisLeft(y).ticks(6).tickFormat(function(v){return v+'h';}));
        yAxis.selectAll('text').attr('fill','#94a3b8').attr('font-size',11);
        yAxis.selectAll('line,path').attr('stroke','#334155');

        // Edits pro Autor gruppieren und Linien + Punkte zeichnen
        var editsByUser = {};
        allEdits.forEach(function(e) {
          if (x(e.date) == null) return;
          if (!editsByUser[e.user]) editsByUser[e.user] = [];
          editsByUser[e.user].push(e);
        });

        // Linien pro Autor (chronologisch verbunden)
        var line = d3.line().x(function(d){return x(d.date);}).y(function(d){return y(d.time);}).curve(d3.curveMonotoneX);
        Object.keys(editsByUser).forEach(function(user) {
          var pts = editsByUser[user].sort(function(a,b){return a.date < b.date ? -1 : a.date > b.date ? 1 : a.time - b.time;});
          if (pts.length > 1) {
            svg.append('path').attr('d', line(pts))
              .attr('fill','none').attr('stroke', _authorColorMap[user] || '#64748b')
              .attr('stroke-width', 1.2).attr('stroke-opacity', 0.35)
              .attr('data-user', user).attr('class','tl-line');
          }
        });

        // Punkte
        allEdits.forEach(function(e) {
          if (x(e.date) == null) return;
          var dot = svg.append('circle')
            .attr('cx', x(e.date)).attr('cy', y(e.time)).attr('r', 3)
            .attr('fill', _authorColorMap[e.user] || '#64748b')
            .attr('fill-opacity', 0.7)
            .attr('data-user', e.user).attr('class','tl-dot')
            .style('cursor', 'pointer');
          dot.append('title').text(e.user + ' ' + Math.floor(e.time) + ':' + String(Math.round((e.time%1)*60)).padStart(2,'0'));
          dot.on('click', function(event) {
            if (event) event.stopPropagation();
            // Remove existing popup
            var oldPopup = document.getElementById('wz-wiki-edit-popup');
            if (oldPopup) oldPopup.remove();
            var timeStr = String(Math.floor(e.time)).padStart(2,'0') + ':' + String(Math.round((e.time%1)*60)).padStart(2,'0');
            var _fdP = typeof fmtDateOnly === 'function' ? fmtDateOnly : function(s){return s;};
            var sizeDelta = '';
            if (e.size_diff != null) {
              sizeDelta = e.size_diff >= 0
                ? '<span style="color:#4ade80;">+' + e.size_diff + '</span>'
                : '<span style="color:#f87171;">' + e.size_diff + '</span>';
              sizeDelta += ' Bytes';
            }
            var diffLink = e.revid
              ? '<a href="https://' + lang + '.wikipedia.org/w/index.php?diff=' + e.revid + '" target="_blank" rel="noopener" style="color:#06b6d4;font-size:11px;">Diff anzeigen \u2197</a>'
              : '';
            var commentHtml = e.comment
              ? '<div style="font-size:10px;color:var(--muted);margin-top:4px;max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + WZ._esc(e.comment) + '">' + WZ._esc(e.comment) + '</div>'
              : '';
            var popup = document.createElement('div');
            popup.id = 'wz-wiki-edit-popup';
            popup.style.cssText = 'position:fixed;z-index:20000;background:rgba(40,40,50,.97);border:1px solid ' + (_authorColorMap[e.user] || '#64748b') + ';border-radius:10px;padding:14px 18px;box-shadow:0 8px 24px rgba(0,0,0,.5);max-width:380px;min-width:220px;';
            popup.innerHTML =
              '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">' +
                '<div style="width:12px;height:12px;border-radius:3px;background:' + (_authorColorMap[e.user] || '#64748b') + ';flex-shrink:0;"></div>' +
                '<strong style="font-size:14px;color:#e2e8f0;">' + WZ._esc(e.user) + '</strong>' +
                '<span style="flex:1;"></span>' +
                '<button onclick="this.closest(\'#wz-wiki-edit-popup\').remove()" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:14px;padding:0 2px;line-height:1;">\u2715</button>' +
              '</div>' +
              '<div style="font-size:13px;color:#94a3b8;margin-top:2px;">' + _fdP(e.date) + ' ' + timeStr + '</div>' +
              (sizeDelta ? '<div style="font-size:13px;margin-top:4px;">' + sizeDelta + '</div>' : '') +
              (e.comment ? '<div style="font-size:12px;color:var(--muted);margin-top:6px;max-width:340px;line-height:1.4;" title="' + WZ._esc(e.comment) + '">' + WZ._esc(e.comment) + '</div>' : '') +
              (diffLink ? '<div style="margin-top:8px;">' + diffLink.replace('font-size:11px','font-size:13px') + '</div>' : '');
            // Position near click
            var rect = event.target.getBoundingClientRect ? event.target.getBoundingClientRect() : {left:200,top:200};
            popup.style.left = (rect.left + 12) + 'px';
            popup.style.top = (rect.top - 20) + 'px';
            document.body.appendChild(popup);
            // Click outside to close
            setTimeout(function() {
              document.addEventListener('click', function _closeWikiPopup(ev) {
                if (!popup.contains(ev.target)) { popup.remove(); document.removeEventListener('click', _closeWikiPopup); }
              });
            }, 100);
          });
        });

        // Time Focus vertical marker (with time if available)
        if (_wikiTf && _wikiTf.from) {
          var _tfColor = _wikiTf.color || '#f59e0b';
          var _tfDateFrom = _wikiTf.from.slice(0, 10);
          var _tfDateTo = (_wikiTf.to || _wikiTf.from).slice(0, 10);
          // Find nearest date in scale domain if exact date not present
          var _dayArr = daySet.slice().sort();
          function _nearestX(dateStr) {
            var v = x(dateStr);
            if (v != null) return v;
            // Find nearest date in domain
            var best = null, bestDist = Infinity;
            for (var ni = 0; ni < _dayArr.length; ni++) {
              var dist = Math.abs(new Date(_dayArr[ni]) - new Date(dateStr));
              if (dist < bestDist) { bestDist = dist; best = _dayArr[ni]; }
            }
            return best ? x(best) : null;
          }
          var _tfXFrom = _nearestX(_tfDateFrom);
          var _tfXTo = _nearestX(_tfDateTo);
          var _tfYstart = margin.top;
          var _tfYend = h - margin.bottom;
          // Band between start and end (for range events with different days)
          if (_tfXFrom != null && _tfXTo != null && _tfDateFrom !== _tfDateTo) {
            svg.append('rect')
              .attr('x', Math.min(_tfXFrom, _tfXTo) - 1)
              .attr('y', _tfYstart)
              .attr('width', Math.abs(_tfXTo - _tfXFrom) + 2)
              .attr('height', _tfYend - _tfYstart)
              .attr('fill', _tfColor).attr('opacity', 0.1);
          }
          // Start marker
          if (_tfXFrom != null) {
            var _tfHasTime = _wikiTf.from.includes('T');
            var _tfHour = 12; // default: midday
            if (_tfHasTime) {
              var _tfTimeParts = _wikiTf.from.split('T')[1].split(':');
              _tfHour = parseInt(_tfTimeParts[0]) + (parseInt(_tfTimeParts[1] || 0) / 60);
            }
            var _tfYtime = y(_tfHour);
            var _tfCircle = svg.append('circle')
              .attr('cx', _tfXFrom).attr('cy', _tfYtime).attr('r', 5)
              .attr('fill', 'none').attr('stroke', _tfColor).attr('stroke-width', 2);
            (function(el) {
              var n = 0;
              var iv = setInterval(function() {
                el.attr('opacity', el.attr('opacity') === '1' ? '0' : '1');
                if (++n >= 6) { clearInterval(iv); el.attr('opacity', '1'); }
              }, 300);
            })(_tfCircle);
            svg.append('line')
              .attr('x1', _tfXFrom).attr('y1', _tfYstart)
              .attr('x2', _tfXFrom).attr('y2', _tfYend)
              .attr('stroke', _tfColor).attr('stroke-width', 2)
              .attr('stroke-dasharray', '4,3').attr('opacity', 0.8);
            var _tfLabel = (_wikiTf.title || 'Focus') + (_tfHasTime ? ' ' + _wikiTf.from.split('T')[1].slice(0,5) : '');
            svg.append('text')
              .attr('x', _tfXFrom).attr('y', margin.top - 6)
              .attr('text-anchor', 'middle').attr('fill', _tfColor)
              .attr('font-size', 9).attr('font-weight', 700)
              .text(_tfLabel);
          }
          // End marker (for range events — same or different day)
          var _tfIsRange = _wikiTf.to && _wikiTf.to !== _wikiTf.from;
          if (_tfXTo != null && _tfIsRange) {
            var _tfHasTimeEnd = _wikiTf.to && _wikiTf.to.includes('T');
            var _tfH2 = 12; // default: midday
            if (_tfHasTimeEnd) {
              var _tfTP2 = _wikiTf.to.split('T')[1].split(':');
              _tfH2 = parseInt(_tfTP2[0]) + (parseInt(_tfTP2[1] || 0) / 60);
            }
            var _tfYt2 = y(_tfH2);
            var _tfCircle2 = svg.append('circle')
              .attr('cx', _tfXTo).attr('cy', _tfYt2).attr('r', 5)
              .attr('fill', 'none').attr('stroke', _tfColor).attr('stroke-width', 2);
            (function(el) {
              var n = 0;
              var iv = setInterval(function() {
                el.attr('opacity', el.attr('opacity') === '1' ? '0' : '1');
                if (++n >= 6) { clearInterval(iv); el.attr('opacity', '1'); }
              }, 300);
            })(_tfCircle2);
            svg.append('line')
              .attr('x1', _tfXTo).attr('y1', _tfYstart)
              .attr('x2', _tfXTo).attr('y2', _tfYend)
              .attr('stroke', _tfColor).attr('stroke-width', 2)
              .attr('stroke-dasharray', '4,3').attr('opacity', 0.8);
            var _tfLabel2 = 'Ende' + (_tfHasTimeEnd ? ' ' + _wikiTf.to.split('T')[1].slice(0,5) : '');
            svg.append('text')
              .attr('x', _tfXTo).attr('y', margin.top - 6)
              .attr('text-anchor', 'middle').attr('fill', _tfColor)
              .attr('font-size', 9).attr('font-weight', 700)
              .text(_tfLabel2);
          }
        }

        // Horizontal hover line (shows time at cursor Y position)
        var _hoverLine = svg.append('line')
          .attr('x1', margin.left).attr('x2', w - margin.right)
          .attr('y1', 0).attr('y2', 0)
          .attr('stroke', 'rgba(255,255,255,.35)').attr('stroke-width', 1)
          .attr('stroke-dasharray', '4,3').style('display', 'none').attr('pointer-events', 'none');
        var _hoverLabelBg = svg.append('rect')
          .attr('x', 0).attr('y', 0).attr('width', margin.left).attr('height', 16)
          .attr('rx', 3).attr('fill', 'rgba(30,30,40,.9)')
          .style('display', 'none').attr('pointer-events', 'none');
        var _hoverLabel = svg.append('text')
          .attr('x', margin.left - 4).attr('y', 0)
          .attr('text-anchor', 'end').attr('fill', '#e2e8f0')
          .attr('font-size', 11).attr('font-weight', 700)
          .style('display', 'none').attr('pointer-events', 'none');
        // Invisible overlay rect for mouse tracking
        svg.append('rect')
          .attr('x', margin.left).attr('y', margin.top)
          .attr('width', w - margin.left - margin.right)
          .attr('height', h - margin.top - margin.bottom)
          .attr('fill', 'transparent')
          .style('cursor', 'crosshair')
          .on('click', function(event) {
            // Click auf nächstgelegenen Edit-Dot weiterleiten
            var coords = d3.pointer(event, svg.node());
            var best = null, bestDist = Infinity;
            svg.selectAll('.tl-dot').each(function() {
              var cx = +d3.select(this).attr('cx'), cy = +d3.select(this).attr('cy');
              var dist = Math.sqrt(Math.pow(coords[0]-cx,2) + Math.pow(coords[1]-cy,2));
              if (dist < bestDist) { bestDist = dist; best = this; }
            });
            if (best && bestDist < 20) {
              best.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: event.clientX, clientY: event.clientY }));
            }
          })
          .on('mousemove', function(event) {
            var coords = d3.pointer(event, svg.node());
            var mouseY = coords[1];
            var hourVal = y.invert(mouseY);
            if (hourVal < 0 || hourVal > 24) { _hoverLine.style('display', 'none'); _hoverLabel.style('display', 'none'); _hoverLabelBg.style('display', 'none'); return; }
            _hoverLine.attr('y1', mouseY).attr('y2', mouseY).style('display', null);
            var hh = Math.floor(hourVal), mm = Math.round((hourVal % 1) * 60);
            _hoverLabelBg.attr('y', mouseY - 9).style('display', null);
            _hoverLabel.attr('y', mouseY + 4).text(String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0')).style('display', null);
          })
          .on('mouseleave', function() {
            _hoverLine.style('display', 'none');
            _hoverLabel.style('display', 'none');
            _hoverLabelBg.style('display', 'none');
          });

        // ── Distance mode (D key) on edit timeline ──
        var _tlDistPhase = 0; // 0=off, 1=tracking, 2=locked
        var _tlDistStartY = null;
        var _tlDistSel = svg.append('rect')
          .attr('x', margin.left).attr('width', w - margin.left - margin.right)
          .attr('y', 0).attr('height', 0)
          .attr('fill', 'rgba(139,92,246,.15)').attr('stroke', '#8b5cf6').attr('stroke-width', 1.5)
          .attr('rx', 3).style('display', 'none').attr('pointer-events', 'none');
        var _tlDistPanel = null;
        var _tlDistBadge = null;

        function _tlDistFmtTime(hours) {
          if (hours < 1/60) return '< 1 Min.';
          if (hours < 1) return Math.round(hours * 60) + ' Min.';
          if (hours < 24) return Math.floor(hours) + ' Std. ' + Math.round((hours % 1) * 60) + ' Min.';
          return Math.floor(hours / 24) + ' Tage ' + Math.round(hours % 24) + ' Std.';
        }
        function _tlDistCalc(h1, h2) {
          var hours = Math.abs(h2 - h1);
          var speeds = [
            { label: 'Gehen', kmh: 5, color: '#22c55e' },
            { label: 'Fahrrad', kmh: 20, color: '#3b82f6' },
            { label: 'Auto', kmh: 120, color: '#f59e0b' },
            { label: 'Flugzeug', kmh: 900, color: '#8b5cf6' }
          ];
          var tip = '<div style="font-weight:700;font-size:14px;color:#8b5cf6;margin-bottom:6px;">' + _tlDistFmtTime(hours) + '</div>';
          speeds.forEach(function(sp) {
            var km = hours * sp.kmh;
            var fmt = km < 1 ? Math.round(km * 1000) + ' m' : (km >= 1000 ? Math.round(km).toLocaleString('de-DE') : Math.round(km)) + ' km';
            tip += '<div style="display:flex;align-items:center;gap:8px;margin:3px 0;font-size:12px;">' +
              '<span style="color:' + sp.color + ';font-weight:600;min-width:65px;">' + sp.label + '</span>' +
              '<span style="color:#e2e8f0;font-weight:600;min-width:80px;">' + fmt + '</span>' +
              '<span style="color:rgba(255,255,255,.3);font-size:10px;">' + sp.kmh + ' km/h</span></div>';
          });
          return tip;
        }
        function _tlDistExit() {
          _tlDistPhase = 0; _tlDistStartY = null;
          _tlDistSel.style('display', 'none');
          if (_tlDistPanel) { _tlDistPanel.remove(); _tlDistPanel = null; }
          if (_tlDistBadge) { _tlDistBadge.remove(); _tlDistBadge = null; }
        }
        function _tlDistUpdate(curY) {
          if (_tlDistStartY == null || _tlDistPhase !== 1) return;
          var yMin = Math.min(_tlDistStartY, curY), yMax = Math.max(_tlDistStartY, curY);
          _tlDistSel.attr('y', yMin).attr('height', Math.max(1, yMax - yMin)).style('display', null);
          var h1 = y.invert(_tlDistStartY), h2 = y.invert(curY);
          if (!_tlDistPanel) {
            _tlDistPanel = document.createElement('div');
            _tlDistPanel.style.cssText = 'position:absolute;right:10px;top:10px;z-index:1000;background:rgba(40,40,50,.92);border:1px solid rgba(139,92,246,.4);border-radius:8px;padding:10px 14px;pointer-events:none;min-width:180px;';
            el.style.position = 'relative';
            el.appendChild(_tlDistPanel);
          }
          _tlDistPanel.innerHTML = _tlDistCalc(h1, h2);
        }

        // Key handler for D
        var _tlKeyHandler = function(ev) {
          if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
          var tag = document.activeElement ? document.activeElement.tagName : '';
          if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
          if (ev.key === 'Escape' && _tlDistPhase > 0) { _tlDistExit(); return; }
          if (ev.key !== 'd' && ev.key !== 'D') return;
          // Only active when timeline is visible
          if (!el || !el.offsetParent) { document.removeEventListener('keydown', _tlKeyHandler); return; }

          if (_tlDistPhase === 0) {
            _tlDistPhase = 1;
            _tlDistStartY = null;
            if (!_tlDistBadge) {
              _tlDistBadge = document.createElement('div');
              _tlDistBadge.style.cssText = 'position:absolute;top:2px;left:50%;transform:translateX(-50%);z-index:1000;background:rgba(139,92,246,.9);color:#fff;padding:3px 12px;border-radius:5px;font-size:10px;font-weight:700;pointer-events:none;white-space:nowrap;';
              el.style.position = 'relative';
              el.appendChild(_tlDistBadge);
            }
            _tlDistBadge.textContent = '\u2194 Maus bewegen \u00b7 D = fixieren';
          } else if (_tlDistPhase === 1) {
            _tlDistPhase = 2;
            if (_tlDistBadge) _tlDistBadge.textContent = '\u2194 D = beenden';
          } else {
            _tlDistExit();
          }
        };
        document.addEventListener('keydown', _tlKeyHandler);

        // Track mouse for distance mode
        svg.on('mousemove.dist', function(event) {
          if (_tlDistPhase !== 1) return;
          var coords = d3.pointer(event, svg.node());
          var mouseY = coords[1];
          if (_tlDistStartY == null) _tlDistStartY = mouseY;
          _tlDistUpdate(mouseY);
        });

        // Hover-Sync
        var listEl = document.getElementById(_auListId);
        if (listEl) {
          listEl.querySelectorAll('.wz-wiki-author-item').forEach(function(item) {
            item.addEventListener('mouseenter', function() {
              var u = item.dataset.user;
              svg.selectAll('.tl-dot').each(function() {
                var isU = d3.select(this).attr('data-user') === u;
                d3.select(this).attr('fill-opacity', isU ? 1 : 0.05).attr('r', isU ? 5 : 2);
              });
              svg.selectAll('.tl-line').each(function() {
                var isU = d3.select(this).attr('data-user') === u;
                d3.select(this).attr('stroke-opacity', isU ? 0.8 : 0.05).attr('stroke-width', isU ? 2.5 : 1);
              });
            });
            item.addEventListener('mouseleave', function() {
              svg.selectAll('.tl-dot').attr('fill-opacity', 0.7).attr('r', 3);
              svg.selectAll('.tl-line').attr('stroke-opacity', 0.35).attr('stroke-width', 1.2);
            });
          });
        }
      }

      // ── Setup Click + Render ──
      function _setupAuthorClick() {
        var listEl = document.getElementById(_auListId);
        if (!listEl) return;
        listEl.querySelectorAll('.wz-wiki-author-item').forEach(function(item) {
          item.addEventListener('click', function() { _showAuthorPopup(item.dataset.user); });
        });
      }

      function _setupBarModeToggle() {
        var modeEl = document.getElementById(_barModeId);
        if (!modeEl) return;
        var repLegend = document.getElementById(_barId + '-rep-legend');
        modeEl.querySelectorAll('button').forEach(function(btn) {
          btn.addEventListener('click', function() {
            _barMode = btn.dataset.mode;
            modeEl.querySelectorAll('button').forEach(function(b) {
              b.style.background = b.dataset.mode === _barMode ? 'var(--accent3)' : 'none';
              b.style.color = b.dataset.mode === _barMode ? '#fff' : 'var(--muted)';
              b.style.fontWeight = b.dataset.mode === _barMode ? '600' : '400';
            });
            if (repLegend) repLegend.style.display = _barMode === 'reputation' ? 'block' : 'none';
            _renderBars(null);
          });
        });
      }

      // Verzögert rendern – warten bis Container sichtbar ist (display:block)
      function _waitVisible(cb) {
        var el = document.getElementById(_barId);
        if (el && el.clientWidth > 100) { cb(); return; }
        setTimeout(function(){ _waitVisible(cb); }, 50);
      }
      _waitVisible(function() {
          _renderBars(null);
          // Draw views line overlay + right Y axis
          (function(){
            var svgEl=document.getElementById(_viewsLineId);
            var legendEl=document.getElementById(_legendId);
            var yREl=document.getElementById(_yAxisRId);
            if(!svgEl||!_viewsData||!_viewsData.length||!_series.length) {
              if(legendEl) legendEl.innerHTML='<span style="display:flex;align-items:center;gap:3px;"><span style="width:12px;height:3px;background:var(--accent3);display:inline-block;border-radius:1px;"></span> Edits</span>';
              return;
            }
            var dateMap={};
            _viewsData.forEach(function(v){dateMap[v.date]=v.views;});
            var vals=_series.map(function(d){return dateMap[d.date]||0;});
            var maxV=Math.max.apply(null,vals)||1;
            var w=svgEl.clientWidth||svgEl.parentElement.clientWidth||400;
            var h=_barH;
            var pad=2;
            var points=vals.map(function(v,i){
              var x=(i/Math.max(_series.length-1,1))*w;
              var y=h-pad-((v/maxV)*(h-pad*2));
              return x.toFixed(1)+','+y.toFixed(1);
            }).join(' ');
            svgEl.setAttribute('viewBox','0 0 '+w+' '+h);
            svgEl.innerHTML='<polyline points="'+points+'" fill="none" stroke="#ff9f1c" stroke-width="2" opacity="0.8"/>';
            // Right Y axis (Views)
            if(yREl){
              var ticks=4;var yRHtml='';
              for(var yi=0;yi<=ticks;yi++){
                var val=Math.round(maxV*(1-yi/ticks));
                yRHtml+='<span style="font-size:9px;color:#ff9f1c;line-height:1;">'+val.toLocaleString("de-DE")+'</span>';
              }
              yREl.innerHTML=yRHtml;
            }
            // Legend
            if(legendEl){
              legendEl.innerHTML='<span style="display:flex;align-items:center;gap:3px;"><span style="width:12px;height:3px;background:var(--accent3);display:inline-block;border-radius:1px;"></span> Edits</span>'+
                '<span style="display:flex;align-items:center;gap:3px;"><span style="width:12px;height:3px;background:#ff9f1c;display:inline-block;border-radius:1px;"></span> Views</span>';
            }
          })();
          _setupHover();
          _setupBarHover();
          _setupAuthorClick();
          _setupBarModeToggle();
          function _drawAll() { _drawTimelinePC(); _drawPC(); }
          if (_authors.length > 1 || _series.length > 1) {
            if (typeof d3 !== 'undefined') { _drawAll(); }
            else {
              var sc = document.createElement('script');
              sc.src = 'https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js';
              sc.onload = function(){ requestAnimationFrame(_drawAll); };
              document.head.appendChild(sc);
            }
          }
        });
    })(barChartId, authorListId, pcId, tlPcId, barModeId, series, authors, authorColorMap, barH, 1, authorColorMap, viewsLineId, art.views || [], yAxisId, yAxisRId, legendId);
  }

  html += '</div>';
  content.innerHTML = html;

  // Datepicker-Events für Zeitraum-Änderung
  content.querySelectorAll('input[type="date"][id^="wz-wiki-dp-"]').forEach(function(dp) {
    dp.addEventListener('change', function() {
      var newEnd = dp.value;
      if (!newEnd) return;
      var labelEl = document.getElementById(dp.id + '-label');
      if (labelEl) labelEl.textContent = _fd(newEnd);
      // Daten neu laden via History-Endpoint
      var zoneId = data.zone_id;
      if (!zoneId) return;
      // Spinner anzeigen
      content.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px;gap:12px;">' +
        '<div style="width:32px;height:32px;border:3px solid var(--border);border-top-color:#06b6d4;border-radius:50%;animation:wz-spin .75s linear infinite;"></div>' +
        '<div style="font-size:12px;color:var(--muted);">' + t("wz_wiki_loading","Lade Daten \u2026") + '</div></div>';
      // History-Endpoint mit days-Parameter
      var endDate = new Date(newEnd + 'T12:00:00');
      var now = new Date();
      var diffDays = Math.round((now - endDate) / (1000*60*60*24));
      var totalDays = 30 + Math.max(0, diffDays);
      fetch('/api/watchzones/' + zoneId + '/wiki-history?days=' + totalDays)
        .then(function(r){return r.json();})
        .then(function(histData) {
          // Series auf den 30-Tage-Bereich bis newEnd filtern
          var endD = newEnd;
          var startD = new Date(endDate); startD.setDate(startD.getDate() - 29);
          var startStr = startD.toISOString().slice(0,10);
          var filtered = histData.articles || [];
          filtered.forEach(function(art) {
            if (art.series) {
              art.series = art.series.filter(function(s){return s.date >= startStr && s.date <= endD;});
              art.total_edits = art.series.reduce(function(sum,s){return sum + s.edits;}, 0);
            }
          });
          histData.count = filtered.reduce(function(s,a){return s + (a.total_edits||0);}, 0);
          histData.zone_id = zoneId;
          histData.lang = data.lang;
          _renderWikipediaLive(histData);
        })
        .catch(function(err) {
          content.innerHTML = '<div style="padding:24px;text-align:center;color:#f87171;">Fehler: ' + err.message + '</div>';
        });
    });
  });

  // fmtDateOnly helper für globalen Scope im Renderer
  var _fd = typeof fmtDateOnly === 'function' ? fmtDateOnly : function(s){return s;};
}

function _formatBytes(bytes) {
  var abs = Math.abs(bytes);
  if (abs < 1024) return bytes + " B";
  if (abs < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}


// ── Register Plugin ──────────────────────────────────────────────
// ── Wrapper-Renderer: Spinner → Fetch → Render ──
function _wikiSpinnerRenderer(initialData) {
  var ctx = WZ._currentCtx;
  var zoneId = initialData.zone_id;
  // Spinner einblenden
  var spinner = ctx.spinnerEl;
  var liveBox = ctx.boxEl;
  if (spinner) spinner.style.display = "flex";
  if (liveBox) liveBox.style.display = "none";
  var spinText = document.getElementById("wz-live-spinner-text");
  if (spinText) spinText.textContent = "Wikipedia \u2013 " + t("wz_wiki_loading","Lade Daten \u2026");

  // Daten laden
  fetch("/api/watchzones/" + zoneId + "/live" + (WZ._liveAsType ? "?as_type=" + WZ._liveAsType : ""))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      // Spinner aus, Box an
      if (spinner) spinner.style.display = "none";
      if (liveBox) { liveBox.style.display = ""; liveBox.style.maxWidth = "1500px"; }
      ctx.loadingEl.style.display = "none";
      ctx.contentEl.style.display = "block";
      // Eigentlichen Renderer aufrufen
      _renderWikipediaLive(data);
    })
    .catch(function(err) {
      if (spinner) spinner.style.display = "none";
      if (liveBox) liveBox.style.display = "";
      ctx.loadingEl.style.display = "none";
      ctx.contentEl.style.display = "block";
      ctx.contentEl.innerHTML =
        '<div style="padding:24px;text-align:center;color:#f87171;">Fehler: ' + err.message + '</div>';
    });
}

WZ.registerPlugin("wikipedia", {
  renderer: _wikiSpinnerRenderer,
  has_map: false,
  has_live_map: false,
  live_box_max_width: "1500px",
  openStrategy: "spinner",
  skip_loading_indicator: true,
});

// Collect Renderer
WZ._collectRenderers["wikipedia"] = {
  renderHTML: function(data, cardId) {
    var h = "", fmtD = WZ._fmtDate || function(s) { return s ? String(s).slice(0,10) : ""; };
    var articles = data.articles || [];
    if (!articles.length) { h += '<div style="font-size:11px;color:var(--muted);">Keine Artikeldaten.</div>'; return h; }
    articles.forEach(function(art, ai) {
      if (art.error) return;
      h += '<div style="' + (ai > 0 ? 'padding-top:8px;border-top:1px solid var(--border);margin-top:8px;' : '') + '">';
      var wikiTitle = art.wiki_title || art.title || "";
      var wikiLang = art.lang || data.lang || "de";
      h += '<div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:4px;">'
        + '<a href="https://' + wikiLang + '.wikipedia.org/wiki/' + encodeURIComponent(wikiTitle) + '" target="_blank" rel="noopener" style="color:#06b6d4;text-decoration:none;">' + WZ._esc(art.title || wikiTitle) + '</a>'
        + ' <span style="color:var(--muted);font-weight:400;font-size:10px;">(' + wikiLang + '.wikipedia.org)</span></div>';
      h += '<div style="display:flex;gap:12px;margin-bottom:6px;">';
      h += '<div style="text-align:center;"><div style="font-size:18px;font-weight:800;color:#06b6d4;">' + (art.total_edits || 0) + '</div><div style="font-size:9px;color:var(--muted);">Edits</div></div>';
      var totalViews = (art.views || []).reduce(function(s,v) { return s + (v.views || v.count || 0); }, 0);
      if (totalViews) h += '<div style="text-align:center;"><div style="font-size:18px;font-weight:800;color:#22c55e;">' + totalViews.toLocaleString() + '</div><div style="font-size:9px;color:var(--muted);">Views</div></div>';
      h += '</div>';
      // Chart
      var hasEdits = art.series && art.series.length > 1;
      var hasViews = art.views && art.views.length > 1;
      if (hasEdits || hasViews) h += '<div style="position:relative;height:120px;"><canvas id="' + cardId + '-wiki-' + ai + '"></canvas></div>';
      h += '</div>';
    });
    return h;
  },
  afterRender: function(data, cardId) {
    if (!window.Chart) return;
    var fmtD = WZ._fmtDate || function(s) { return s ? String(s).slice(0,10) : ""; };
    (data.articles || []).forEach(function(art, ai) {
      if (art.error) return;
      var canvas = document.getElementById(cardId + "-wiki-" + ai);
      if (!canvas) return;
      var allDates = {};
      (art.series || []).forEach(function(e) { if (e.date) allDates[e.date] = true; });
      (art.views || []).forEach(function(v) { if (v.date) allDates[v.date] = true; });
      var labels = Object.keys(allDates).sort();
      if (labels.length < 2) return;
      var datasets = [];
      if (art.series && art.series.length) {
        var eMap = {}; art.series.forEach(function(e) { eMap[e.date] = e.edits || e.count || 0; });
        datasets.push({ label: "Edits", data: labels.map(function(d) { return eMap[d] || 0; }), backgroundColor: "rgba(6,182,212,.4)", borderColor: "#06b6d4", borderWidth: 1, type: "bar", yAxisID: "yEdits" });
      }
      if (art.views && art.views.length) {
        var vMap = {}; art.views.forEach(function(v) { vMap[v.date] = v.views || v.count || 0; });
        datasets.push({ label: "Views", data: labels.map(function(d) { return vMap[d] || 0; }), borderColor: "#22c55e", borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.3, type: "line", yAxisID: "yViews" });
      }
      if (!datasets.length) return;
      var plugins = [];
      var tf = data.time_focus;
      if (tf && tf.from) {
        var tfFrom = tf.from.slice(0,10), tfTo = (tf.to || tf.from).slice(0,10);
        plugins.push({ id: 'wikiFocus' + ai, afterDraw: function(chart) {
          var xScale = chart.scales.x, ctx2 = chart.ctx;
          var fi = -1, ti = -1;
          for (var j = 0; j < labels.length; j++) { if (labels[j] >= tfFrom && fi === -1) fi = j; if (labels[j] <= tfTo) ti = j; }
          if (fi === -1) return;
          var x1 = xScale.getPixelForValue(fi), x2 = xScale.getPixelForValue(ti);
          var top = chart.chartArea.top, bottom = chart.chartArea.bottom;
          ctx2.save(); ctx2.fillStyle = 'rgba(245,158,11,.1)';
          ctx2.fillRect(Math.min(x1,x2)-2, top, Math.abs(x2-x1)+4, bottom-top);
          var xC = (x1+x2)/2; ctx2.beginPath(); ctx2.moveTo(xC,top); ctx2.lineTo(xC,bottom);
          ctx2.strokeStyle = '#f59e0b'; ctx2.lineWidth = 1.5; ctx2.setLineDash([4,3]); ctx2.stroke();
          ctx2.fillStyle = '#f59e0b'; ctx2.font = 'bold 9px sans-serif'; ctx2.textAlign = 'center';
          ctx2.fillText(tf.title || 'Event', xC, top-4); ctx2.restore();
        }});
      }
      var scales = { x: { ticks: { font: { size: 8 }, color: "#888", maxTicksLimit: 8 }, grid: { display: false } } };
      if (datasets.some(function(d) { return d.yAxisID === "yEdits"; })) scales.yEdits = { position: "left", ticks: { font: { size: 8 }, color: "#06b6d4", stepSize: 1 }, grid: { color: "rgba(100,100,100,.1)" }, title: { display: true, text: "Edits", color: "#06b6d4", font: { size: 9 } } };
      if (datasets.some(function(d) { return d.yAxisID === "yViews"; })) scales.yViews = { position: "right", ticks: { font: { size: 8 }, color: "#22c55e" }, grid: { drawOnChartArea: false }, title: { display: true, text: "Views", color: "#22c55e", font: { size: 9 } } };
      new Chart(canvas.getContext("2d"), {
        type: "bar", data: { labels: labels.map(function(d){return fmtD(d);}), datasets: datasets }, plugins: plugins,
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, position: "bottom", labels: { font: { size: 8 }, boxWidth: 8, padding: 4 } } }, scales: scales, interaction: { intersect: false, mode: "index" } }
      });
    });
  }
};

// Collect Config
WZ._collectConfigs["wikipedia"] = {
  fields: function(saved) {
    saved = saved || {};
    var savedArticles = saved.articles || "";
    if (Array.isArray(savedArticles)) savedArticles = savedArticles.join(", ");
    var h = '';
    h += '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px;">Von bestehender Wikipedia-Zone \u00fcbernehmen</label>';
    h += '<select class="wz-cc-field" data-key="_import" onchange="var o=this.options[this.selectedIndex];if(o.dataset.articles){this.closest(\'[id^=wz-cc-]\').querySelector(\'[data-key=articles]\').value=o.dataset.articles;}" style="width:100%;padding:4px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);font-size:11px;box-sizing:border-box;margin-bottom:6px;">';
    h += '<option value="">-- Manuell eingeben --</option>';
    (WZ._zones || []).forEach(function(z) {
      if (z.zone_type !== "wikipedia" || !z.config || !z.config.articles) return;
      var arts = z.config.articles;
      if (Array.isArray(arts)) arts = arts.join(", ");
      h += '<option value="' + z.id + '" data-articles="' + WZ._esc(arts) + '">' + WZ._esc(z.name) + ' (' + WZ._esc(String(arts).substring(0, 50)) + ')</option>';
    });
    h += '</select>';
    h += '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px;">Wikipedia-Artikel (kommagetrennt)</label>';
    h += '<input class="wz-cc-field" data-key="articles" value="' + WZ._esc(savedArticles) + '" placeholder="z.B. Kyiv, Kramatorsk, Zaporizhzhia" style="width:100%;padding:4px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);font-size:11px;box-sizing:border-box;">';
    return h;
  },
  read: function(container) {
    var inp = container.querySelector('[data-key="articles"]');
    return { articles: inp ? inp.value.trim() : "" };
  }
};

})();
