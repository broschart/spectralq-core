/**
 * WZ Module: Wikipedia article edit monitoring.
 */
(function() {
"use strict";
var WZ = window.WZ;
var t = window._t || function(k, fb) { return fb; };

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
        '<button id="wz-awik-add" style="padding:8px 20px;background:#636363;color:#fff;border:none;border-radius:7px;' +
        'font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;flex-shrink:0;">' +
          t("wz_wiki_add", "+ Add") +
        '</button>' +
      '</div>' +
      '<div id="wz-awik-err" style="display:none;margin-top:8px;font-size:12px;color:#f87171;"></div>' +
    '</div>' +
  '</div>';

  document.body.appendChild(modal);

  // Close
  document.getElementById("wz-awik-close").onclick = function() { modal.remove(); };
  modal.addEventListener("click", function(e) { if (e.target === modal) modal.remove(); });

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
      try {
        var r = await fetch("/api/watchzones", {
          method: "POST", headers: {"Content-Type": "application/json"},
          body: JSON.stringify({
            name: nameVal,
            zone_type: "wikipedia",
            geometry: geometry,
            config: { articles: [_selectedTitle], lang: lang },
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


// ── Live Renderer ────────────────────────────────────────────────
function _renderWikipediaLive(data) {
  document.getElementById("wz-live-count").textContent =
    data.count != null ? data.count + " " + t("wz_wiki_live_edits", "Edits") : "";

  // Hide map for Wikipedia (no geo data)
  var mapRow = document.getElementById("wz-map-row");
  if (mapRow) mapRow.style.display = "none";
  var resizeMap = document.getElementById("wz-resize-map");
  if (resizeMap) resizeMap.style.display = "none";

  var content = document.getElementById("wz-live-content");
  var articles = data.articles || [];
  var lang = data.lang || "de";

  if (!articles.length) {
    content.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);">' +
      t("wz_wiki_live_no_edits", "No edits in period") + '</div>';
    return;
  }

  var html = '<div style="padding:12px 16px;">';

  for (var i = 0; i < articles.length; i++) {
    var art = articles[i];
    if (art.error === "not_found") {
      html += '<div style="padding:10px;margin-bottom:8px;background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.3);border-radius:8px;font-size:12px;color:#f87171;">' +
        art.article + ' — ' + t("wz_wiki_no_results", "Not found") + '</div>';
      continue;
    }
    if (art.error) {
      html += '<div style="padding:10px;margin-bottom:8px;background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.3);border-radius:8px;font-size:12px;color:#f87171;">' +
        art.article + ' — ' + art.error + '</div>';
      continue;
    }

    var wikiTitle = art.wiki_title || art.article;
    var totalEdits = art.total_edits || 0;
    var series = art.series || [];
    var totalSize = 0;
    for (var s = 0; s < series.length; s++) totalSize += (series[s].size_delta || 0);
    var avgEdits = series.length > 0 ? (totalEdits / 30).toFixed(1) : "0";
    var sizeSign = totalSize >= 0 ? "+" : "";

    // Article card
    html += '<div style="margin-bottom:12px;background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;">';

    // Header
    html += '<div style="padding:10px 14px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px;">' +
      '<span style="font-size:13px;font-weight:700;color:var(--text);">' + wikiTitle + '</span>' +
      '<span style="font-size:10px;color:var(--muted);background:var(--bg);padding:2px 6px;border-radius:4px;">' + lang + '.wikipedia</span>' +
      '<span style="flex:1;"></span>' +
      '<a href="https://' + lang + '.wikipedia.org/wiki/' + encodeURIComponent(wikiTitle.replace(/ /g, "_")) + '" target="_blank" rel="noopener"' +
      ' style="font-size:11px;color:var(--accent1);text-decoration:none;">' + t("wz_wiki_open_article", "Open article") + ' \u2197</a>' +
    '</div>';

    // Stats row
    html += '<div style="padding:10px 14px;display:flex;gap:16px;flex-wrap:wrap;">';
    html += '<div style="text-align:center;">' +
      '<div style="font-size:22px;font-weight:800;color:' + (totalEdits > 10 ? '#f59e0b' : 'var(--text)') + ';">' + totalEdits + '</div>' +
      '<div style="font-size:10px;color:var(--muted);text-transform:uppercase;">' + t("wz_wiki_total", "Total") + ' ' + t("wz_wiki_live_edits", "Edits") + '</div>' +
    '</div>';
    html += '<div style="text-align:center;">' +
      '<div style="font-size:22px;font-weight:800;color:var(--text);">' + avgEdits + '</div>' +
      '<div style="font-size:10px;color:var(--muted);text-transform:uppercase;">' + t("wz_wiki_daily_avg", "Daily average") + '</div>' +
    '</div>';
    html += '<div style="text-align:center;">' +
      '<div style="font-size:22px;font-weight:800;color:' + (totalSize >= 0 ? '#22c55e' : '#ef4444') + ';">' + sizeSign + _formatBytes(totalSize) + '</div>' +
      '<div style="font-size:10px;color:var(--muted);text-transform:uppercase;">' + t("wz_wiki_live_size", "Size change") + '</div>' +
    '</div>';
    html += '</div>';

    // Sparkline bar chart (last 30 days)
    if (series.length > 0) {
      html += '<div style="padding:4px 14px 10px;">';
      html += '<div style="font-size:10px;color:var(--muted);margin-bottom:4px;">' + t("wz_wiki_live_edits", "Edits") + ' · ' + t("wz_wiki_live_period", "last 30 days") + '</div>';
      html += _buildSparkBars(series);
      html += '</div>';
    }

    html += '</div>'; // card end
  }

  html += '</div>';
  content.innerHTML = html;
}

function _buildSparkBars(series) {
  var maxEdits = 1;
  for (var i = 0; i < series.length; i++) {
    if (series[i].edits > maxEdits) maxEdits = series[i].edits;
  }

  var html = '<div style="display:flex;align-items:flex-end;gap:1px;height:40px;">';
  for (var i = 0; i < series.length; i++) {
    var d = series[i];
    var h = Math.max(2, Math.round((d.edits / maxEdits) * 36));
    var clr = d.edits === 0 ? "var(--border)" :
              d.edits >= maxEdits * 0.8 ? "#f59e0b" :
              d.edits >= maxEdits * 0.4 ? "#636363" : "var(--muted)";
    var dateLabel = d.date.substring(5); // MM-DD
    html += '<div title="' + d.date + ': ' + d.edits + ' edits, ' + (d.size_delta >= 0 ? '+' : '') + d.size_delta + ' B"' +
      ' style="flex:1;min-width:0;height:' + h + 'px;background:' + clr + ';border-radius:2px 2px 0 0;transition:height .2s;"></div>';
  }
  html += '</div>';
  return html;
}

function _formatBytes(bytes) {
  var abs = Math.abs(bytes);
  if (abs < 1024) return bytes + " B";
  if (abs < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}


// ── Register Plugin ──────────────────────────────────────────────
WZ.registerPlugin("wikipedia", {
  renderer: _renderWikipediaLive,
  has_map: false,
});

})();
