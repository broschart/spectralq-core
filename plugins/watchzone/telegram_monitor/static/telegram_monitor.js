/**
 * WZ Module: Telegram Keyword Monitor renderer.
 */
(function() {
"use strict";
var WZ = window.WZ;
var t = window._t || function(k, fb) { return fb; };

var TG_COLORS = ["#0088cc", "#29b6f6", "#5c6bc0", "#26a69a", "#7e57c2"];

var _TGM_STOP = new Set([
  // DE
  "der","die","das","und","oder","aber","denn","weil","wenn","dass","als","wie","nach","vor","mit","von","für","auf","aus","bei",
  "den","dem","des","ein","eine","einer","eines","einem","einen","sich","nicht","auch","noch","nur","schon","sehr","mehr","kann",
  "wird","wurde","werden","hat","hatte","haben","sein","seine","seinem","seiner","seinen","ist","sind","war","waren","wird","zum",
  "zur","ins","über","unter","durch","zwischen","gegen","ohne","bis","seit","während","diesem","dieser","dieses","diese","jetzt",
  "hier","dort","dann","doch","mal","man","ich","wir","sie","ihr","ihm","ihn","uns","mir","mich","dir","dich","er","es","du",
  "alle","alles","allem","allen","aller","viele","andere","anderen","anderer","andere","ersten","erste","erster","wurde","können",
  "muss","müssen","soll","sollen","will","wollen","darf","dürfen","etwa","immer","wieder","ganz","neue","neuen","neuer","neues",
  "keine","keinen","keiner","kein","damit","daher","also","dabei","darauf","daran","darin","davon","dazu","jedoch","sowie",
  // EN
  "the","and","for","that","this","with","from","are","was","has","have","but","not","its","all","will","been","can","more",
  "about","would","could","should","their","there","they","them","than","then","these","those","which","where","when","what",
  "who","whom","whose","into","your","you","our","out","just","also","very","much","many","some","any","each","every","other",
  "most","only","over","such","after","before","between","through","during","being","had","did","does","done","going","come",
  "said","says","say","like","make","made","take","get","got","know","think","see","want","way","may","own","back","year",
  "new","now","one","two","first","last","long","great","little","own","old","right","big","high","well","here","why","how",
  "a","an","to","of","is","it","be","as","at","by","or","if","no","up","he","we","do","so","my","me","am","his","her","she",
  // RU
  "на","не","по","за","от","это","что","как","или","из","его","все","при","для","так","уже","но","он","она","они","был","быть",
  "она","оно","мы","вы","их","ее","её","ему","ей","нас","вас","нам","вам","ним","ней","себя","себе","собой","свой","свою",
  "это","эта","этот","эти","этого","этой","этих","этим","этому","тот","та","те","того","той","тех","тем","тому",
  "который","которая","которое","которые","которого","которой","которых","которым","которому",
  "будет","было","были","быть","есть","нет","мне","меня","мной","тебя","тебе","тобой",
  "где","когда","если","чтобы","потому","поэтому","также","тоже","очень","можно","нужно","надо","более","менее",
  "свои","свою","свое","своё","своего","своей","своих","своим","своему","между","через","после","перед","около",
  "только","ещё","еще","даже","просто","здесь","там","тут","сейчас","теперь","всегда","никогда","иногда",
  // UA
  "та","що","як","але","або","чи","не","на","за","від","до","по","при","для","без","про","над","під","між",
  // Common noise
  "http","https","www","com","org","net","html","pic","twitter","telegram","channel","chat","bot","news",
]);

function _renderTelegramMonitorLive(data) {
  var ctx = WZ._currentCtx;
  // Hide the core live map (we use our own geo map)
  var _coreMapRow = ctx.mapRowEl;
  if (_coreMapRow) _coreMapRow.style.display = "none";
  var _resizeMap = ctx.resizeMapEl;
  if (_resizeMap) _resizeMap.style.display = "none";

  var results = data.results || [];
  var keywords = data.keywords || [];
  var totalAll = data.count || 0;
  var days = data.days || 7;
  // Adjust days display for time focus (days = padding on each side)
  var daysLabel = data.time_focus ? (days + ' + ' + days + ' ' + t("wz_tgm_days","Tage")) : (days + ' ' + t("wz_tgm_days","Tage"));

  var countEl = ctx.countEl;
  countEl.textContent =
    totalAll.toLocaleString() + " " + t("wz_tgm_total", "Total") +
    " \u00b7 " + keywords.length + " " + t("wz_tgm_keywords", "Keywords") +
    " \u00b7 " + daysLabel;

  // Force full width + fix body flex shrinking content
  var lb = ctx.boxEl;
  if (lb) lb.classList.add("wz-live-fullwidth");
  var _body = ctx.bodyEl;
  if (_body) _body.style.display = "block";

  // AI Analyse button in header
  var _existingAiBtn = document.getElementById("tgm-ai-analyze-btn");
  if (_existingAiBtn) _existingAiBtn.remove();
  var aiBtn = document.createElement("button");
  aiBtn.id = "tgm-ai-analyze-btn";
  aiBtn.style.cssText = "margin-left:10px;padding:4px 14px;border:none;border-radius:6px;background:linear-gradient(135deg,#0088cc,#5c6bc0);color:#fff;cursor:pointer;font-size:11px;font-weight:600;vertical-align:middle;";
  aiBtn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px;margin-right:4px;"><path d="M21 3L1 11l7 2 2 7 4-5 5 3z"/></svg>KI-Analyse';
  countEl.parentNode.insertBefore(aiBtn, countEl.nextSibling);

  // AI button click handler (attached directly to DOM element)
  window._tgmAICtx = null; // will be set after content renders
  aiBtn.addEventListener("click", function() {
    aiBtn.disabled = true;
    aiBtn.innerHTML = '<span style="display:inline-block;animation:spin 1s linear infinite;">&#9696;</span> Analysiere…';
    var ctx = window._tgmAICtx || {};
    fetch("/api/ai-telegram-analyze", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        question: "__full_analysis__",
        project_id: ctx.project_id,
        zone_id: ctx.zone_id,
        zone_name: ctx.zone_name,
        messages: (ctx.messages || []).slice(0, 80).map(function(m) {
          return {date: m.date, text: m.text, translated: m.translated, src_lang: m.src_lang,
                  channel: m.channel, channel_username: m.channel_username};
        }),
        geo_locations: (ctx.geo_locations || []).slice(0, 30),
        geo_events: (ctx.geo_events || []).slice(0, 40),
        results: (ctx.results || []).map(function(r) {
          return {term: r.term, total: r.total, channels: r.channels};
        }),
        keywords: ctx.keywords,
        days: ctx.days,
        time_focus: ctx.time_focus,
        channels: ctx.channels,
      }),
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      aiBtn.disabled = false;
      aiBtn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px;margin-right:4px;"><path d="M21 3L1 11l7 2 2 7 4-5 5 3z"/></svg>KI-Analyse';
      if (d.ok) _showAnalysisPopup(d, ctx);
      else alert(d.error || "Fehler bei der KI-Analyse.");
    })
    .catch(function(e) {
      aiBtn.disabled = false;
      aiBtn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px;margin-right:4px;"><path d="M21 3L1 11l7 2 2 7 4-5 5 3z"/></svg>KI-Analyse';
      alert("Fehler: " + (e.message || ""));
    });
  });

  if (WZ._liveMarkers) WZ._liveMarkers.clearLayers();

  var content = ctx.contentEl;
  // Fix box height — no fixed height needed
  var _box = ctx.boxEl;
  if (_box) { _box.style.height = "auto"; _box.style.maxHeight = "95vh"; }
  // Hide map — Telegram doesn't use a map in the live popup
  var _mr = ctx.mapRowEl;
  if (_mr) { _mr.style.display = "none"; _mr.style.height = "0"; _mr.style.overflow = "hidden"; }
  var _lm = ctx.mapEl;
  if (_lm) { _lm.style.height = "0"; _lm.style.minHeight = "0"; _lm.style.flex = "none"; }
  var _umb = ctx.underMapBar;
  if (_umb) _umb.style.display = "none";
  var _rm = ctx.resizeMapEl;
  if (_rm) _rm.style.display = "none";

  if (data.error) {
    content.innerHTML = '<div style="padding:24px;text-align:center;color:#ef4444;">' + _esc(data.error) + '</div>';
    return;
  }

  var html = '<div style="padding:12px 16px;">';

  // Stats cards per keyword
  html += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;">';
  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    var color = TG_COLORS[i % TG_COLORS.length];
    var total = r.total || 0;
    var series = r.series || [];
    var dailyAvg = series.length ? Math.round(total / series.length) : 0;
    var peak = 0, peakDate = "";
    for (var s = 0; s < series.length; s++) {
      if (series[s].count > peak) { peak = series[s].count; peakDate = series[s].date; }
    }

    html += '<div style="flex:1;min-width:140px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 14px;border-left:3px solid ' + color + ';">';
    html += '<div style="font-size:13px;font-weight:700;color:' + color + ';margin-bottom:6px;">' + _esc(r.term || "?") + '</div>';
    html += '<div style="display:flex;gap:12px;flex-wrap:wrap;">';
    html += '<div><div style="font-size:18px;font-weight:800;color:var(--text);">' + total.toLocaleString() + '</div>' +
            '<div style="font-size:9px;color:var(--muted);">' + t("wz_tgm_total","Total") + '</div></div>';
    html += '<div><div style="font-size:14px;font-weight:700;color:var(--muted);">' + dailyAvg + '</div>' +
            '<div style="font-size:9px;color:var(--muted);">' + t("wz_tgm_daily_avg","⌀/day") + '</div></div>';
    if (peak > 0) {
      html += '<div><div style="font-size:14px;font-weight:700;color:#ef4444;">' + peak + '</div>' +
              '<div style="font-size:9px;color:var(--muted);">' + t("wz_tgm_peak","Peak") + ' ' + peakDate.slice(5) + '</div></div>';
    }
    html += '</div></div>';
  }
  html += '</div>';

  // Geo map + timeline
  var geoLocs = data.geo_locations || [];
  var geoEvents = data.geo_events || [];

  // Build posting events from results (for calendar, even without geodata)
  var _postingEvents = [];
  results.forEach(function(r) {
    (r.messages || []).forEach(function(m) {
      if (m.date) _postingEvents.push({ time: m.date, snippet: (m.text || '').slice(0, 40), place: null });
    });
  });

  var hasCalendarData = geoEvents.length > 0 || _postingEvents.length > 0;

  html += '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 16px;margin-bottom:14px;">';
  if (geoLocs.length) {
    html += '<div style="font-size:12px;font-weight:600;margin-bottom:8px;">' + t("wz_tgm_geo_map","Erwähnte Orte") + ' (' + geoLocs.length + ')</div>';
  }
  html += '<div style="display:flex;gap:12px;">';
  // Map (left, flexible) — only if geo data exists
  if (geoLocs.length) {
    html += '<div style="flex:1;min-width:0;"><div id="tgm-geo-map" style="height:450px;border-radius:8px;"></div></div>';
  }
  // Calendar (right or full width if no map)
  if (hasCalendarData) {
    var calStyle = geoLocs.length
      ? 'width:280px;flex-shrink:0;overflow-y:auto;max-height:450px;'
      : 'flex:1;overflow-y:auto;max-height:450px;';
    var calCount = geoEvents.length || _postingEvents.length;
    html += '<div id="tgm-calendar" style="' + calStyle + '">';
    html += '<div style="font-size:10px;font-weight:600;color:var(--muted);margin-bottom:4px;">' + t("wz_tgm_timeline","Zeitleiste") + ' (' + calCount + ')</div>';
    // Event time switch (only if time_focus exists)
    if (data.time_focus && data.time_focus.from) {
      html += '<div id="tgm-event-switch" style="display:flex;gap:2px;margin-bottom:6px;">';
      html += '<button data-tf-mode="before" style="flex:1;padding:3px 0;border:1px solid var(--border);border-radius:4px 0 0 4px;background:var(--bg);color:var(--muted);cursor:pointer;font-size:9px;font-weight:600;">Vor Event</button>';
      html += '<button data-tf-mode="both" style="flex:1;padding:3px 0;border:1px solid var(--border);border-left:none;border-right:none;background:var(--accent3);color:#fff;cursor:pointer;font-size:9px;font-weight:600;">Beide</button>';
      html += '<button data-tf-mode="after" style="flex:1;padding:3px 0;border:1px solid var(--border);border-radius:0 4px 4px 0;background:var(--bg);color:var(--muted);cursor:pointer;font-size:9px;font-weight:600;">Nach Event</button>';
      html += '</div>';
    }
    html += '<div id="tgm-cal-grid"></div>';
    html += '</div>';
  }
  html += '</div>';
  html += '</div>';

  // Filter banner (hidden initially)
  html += '<div id="tgm-filter-banner" style="display:none;margin-bottom:10px;padding:6px 12px;border-radius:8px;background:rgba(0,136,204,.15);border:1px solid rgba(0,136,204,.3);display:none;align-items:center;gap:8px;">';
  html += '<span style="font-size:11px;color:var(--text);">Gefiltert nach: <strong id="tgm-filter-place"></strong></span>';
  html += '<button id="tgm-filter-clear" style="margin-left:auto;border:none;background:none;color:#0088cc;cursor:pointer;font-size:11px;font-weight:600;">Filter aufheben</button>';
  html += '</div>';

  // Dynamic sections (re-rendered on filter)
  html += '<div id="tgm-dynamic-chart"></div>';
  html += '<div id="tgm-dynamic-heatmap"></div>';

  // Collect all messages
  var allMsgs = window._tgmAllMsgs = [];
  results.forEach(function(r) {
    (r.messages || []).forEach(function(m) {
      m._term = r.term;
      allMsgs.push(m);
    });
  });
  allMsgs.sort(function(a, b) { return a.date > b.date ? -1 : a.date < b.date ? 1 : 0; });

  // Dynamic containers for filtered content
  html += '<div id="tgm-dynamic-msgs"></div>';

  // No results → short message, skip everything else
  if (!results.length || totalAll === 0) {
    html += '<div style="padding:30px 20px;text-align:center;color:var(--muted);font-size:13px;">'
      + 'Es wurden keine Inhalte zu den angegebenen Parametern gefunden.</div>';
    html += '</div>';
    content.innerHTML = html;
    return;
  }


  html += '</div>';
  content.innerHTML = html;

  // Set AI context for header button
  window._tgmAICtx = {
    zone_id: data.zone_id,
    zone_name: data.zone_name,
    messages: allMsgs,
    geo_locations: geoLocs,
    geo_events: geoEvents,
    results: results,
    keywords: keywords,
    days: days,
    time_focus: data.time_focus || null,
    channels: data.channels || [],
  };
  try {
    var _z = WZ._zones.find(function(z) { return z.id === data.zone_id; });
    if (_z) window._tgmAICtx.project_id = _z.project_id;
  } catch(e) {}

  // Event time switch handler
  window._tgmEventMode = "both";
  var evSwitch = document.getElementById("tgm-event-switch");
  if (evSwitch) {
    evSwitch.querySelectorAll('button').forEach(function(btn) {
      btn.addEventListener('click', function() {
        window._tgmEventMode = btn.dataset.tfMode;
        // Update button styles
        evSwitch.querySelectorAll('button').forEach(function(b) {
          var active = b.dataset.tfMode === window._tgmEventMode;
          b.style.background = active ? 'var(--accent3)' : 'var(--bg)';
          b.style.color = active ? '#fff' : 'var(--muted)';
        });
        // Apply filter
        _tgmApplyEventTimeFilter();
      });
    });
  }

  // Render geo map + timeline (deferred — Leaflet needs a visible container)
  if (geoLocs.length && window.L) {
    var _geoData = geoLocs;
    var _geoEvts = geoEvents;
    function _initTgmGeoMap() {
      var mapEl = document.getElementById("tgm-geo-map");
      if (!mapEl || mapEl._leaflet_id) return;
      if (mapEl.offsetHeight < 10) {
        setTimeout(_initTgmGeoMap, 200);
        return;
      }
      var map = L.map(mapEl, {zoomControl: true, boxZoom: false}).setView([48, 35], 4);
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png", {
        maxZoom: 18, attribution: ""
      }).addTo(map);

      // Custom pane for hitboxes (above everything)
      map.createPane('hitboxPane');
      map.getPane('hitboxPane').style.zIndex = 650;

      // Click on empty map area → clear place filter
      map.on('click', function() {
        if ((window._tgmFilterPlaces || []).length) {
          _tgmApplyFilter(null);
        }
      });

      // Place markers (keyed by place name for highlight)
      var markersByPlace = window._tgmMarkers = {};
      var bounds = [];
      _geoData.forEach(function(loc) {
        var radius = Math.min(Math.max(loc.count || 1, 8), 30);
        // Invisible larger hitbox for easier clicking (custom pane above everything)
        var hitbox = L.circleMarker([loc.lat, loc.lon], {
          radius: Math.max(radius + 12, 20),
          color: "transparent",
          fillColor: "transparent",
          fillOpacity: 0,
          weight: 0,
          interactive: true,
          bubblingMouseEvents: false,
          pane: "hitboxPane",
        }).addTo(map);
        // Visible marker
        var circle = L.circleMarker([loc.lat, loc.lon], {
          radius: radius,
          color: "#0088cc",
          fillColor: "#0088cc",
          fillOpacity: 0.5,
          weight: 1,
        }).addTo(map);
        var popup = '<div style="font-size:12px;max-width:280px;">'
          + '<strong>' + _esc(loc.place) + '</strong>'
          + '<div style="color:#888;font-size:10px;">' + _esc(loc.display || '') + '</div>'
          + (loc.count > 1 ? '<div style="color:#0088cc;font-size:11px;font-weight:600;">' + loc.count + 'x ' + t("wz_tgm_mentioned","erwähnt") + '</div>' : '')
          + (loc.snippet ? '<div style="margin-top:4px;font-size:10px;color:#ccc;line-height:1.4;">' + _esc(loc.snippet) + '</div>' : '')
          + (loc.date ? '<div style="font-size:9px;color:#666;margin-top:2px;">' + _fmtDt(loc.date) + '</div>' : '')
          + '</div>';
        hitbox.bindTooltip(popup, {
          direction: 'right',
          offset: [40, 0],
          opacity: 0.95,
          className: 'tgm-marker-tooltip',
          sticky: false,
        });
        // Click → filter (Shift+Click = add to multi-filter)
        (function(placeName) {
          function _handleClick(e) {
            if (e.originalEvent && e.originalEvent.shiftKey) {
              _tgmToggleMultiFilter(placeName);
            } else {
              _tgmApplyFilter(placeName);
            }
          }
          hitbox.on('click', _handleClick);
          circle.on('click', _handleClick);
        })(loc.place.split(", ")[0]);
        // Store reference for filter highlighting (visible circle + hitbox pair)
        circle._hitbox = hitbox;
        circle._placeNames = loc.place.split(", ").map(function(p) { return p.toLowerCase(); });
        loc.place.split(", ").forEach(function(p) { markersByPlace[p] = circle; });
        bounds.push([loc.lat, loc.lon]);
      });

      if (bounds.length) {
        try { map.fitBounds(bounds, {padding: [30, 30], maxZoom: 8}); } catch(e) {}
      }
      setTimeout(function() { map.invalidateSize(); }, 300);
      setTimeout(function() { map.invalidateSize(); }, 800);

      // Timeline rendering
      if (_geoEvts.length) {
        _renderCalendar(map, markersByPlace, _geoEvts);
      }
    }

    function _renderCalendar(map, markersByPlace, events) {
      var grid = document.getElementById("tgm-cal-grid");
      if (!grid || !events.length) return;

      // Group events by mentioned date AND posted date
      var byDate = {};      // mentioned dates → events
      var byPosted = {};    // posted dates → events
      var placeColors = {};
      var colorIdx = 0;
      events.forEach(function(ev) {
        var day = (ev.time || "").slice(0, 10);
        if (day) {
          if (!byDate[day]) byDate[day] = [];
          byDate[day].push(ev);
        }
        var pDay = (ev.posted || "").slice(0, 10);
        if (pDay) {
          if (!byPosted[pDay]) byPosted[pDay] = [];
          byPosted[pDay].push(ev);
        }
        if (ev.place && !placeColors[ev.place]) {
          placeColors[ev.place] = TG_COLORS[colorIdx % TG_COLORS.length];
          colorIdx++;
        }
      });

      // Combine all dates for range calculation
      var allCalDays = {};
      Object.keys(byDate).forEach(function(d) { allCalDays[d] = true; });
      Object.keys(byPosted).forEach(function(d) { allCalDays[d] = true; });
      var days = Object.keys(allCalDays).sort();
      if (!days.length) return;

      // Range: first to last day
      var dStart = new Date(days[0] + "T00:00:00");
      var dEnd = new Date(days[days.length - 1] + "T00:00:00");
      // Extend to full weeks (Mon-Sun)
      while (dStart.getDay() !== 1) dStart.setDate(dStart.getDate() - 1);
      while (dEnd.getDay() !== 0) dEnd.setDate(dEnd.getDate() + 1);

      // Weekday headers
      var weekdays = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
      var html = '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:1px;">';
      // Initial month label
      html += '<div style="grid-column:1/-1;font-size:9px;font-weight:700;color:var(--text);padding:2px 0 1px;">'
        + ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'][dStart.getMonth()]
        + ' ' + dStart.getFullYear() + '</div>';
      weekdays.forEach(function(wd) {
        html += '<div style="text-align:center;font-size:8px;color:var(--muted);padding:1px 0;font-weight:600;">' + wd + '</div>';
      });

      // Month names
      var _monthNames = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
        'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

      // Day cells
      var cur = new Date(dStart);
      var today = new Date().toISOString().slice(0, 10);
      var lastMonth = dStart.getMonth();
      while (cur <= dEnd) {
        var iso = cur.toISOString().slice(0, 10);
        // Month header row when month changes (on Monday)
        if (cur.getMonth() !== lastMonth && cur.getDay() === 1) {
          lastMonth = cur.getMonth();
          html += '<div style="grid-column:1/-1;font-size:9px;font-weight:700;color:var(--text);padding:4px 0 1px;'
            + (lastMonth !== new Date(dStart).getMonth() ? 'border-top:1px solid var(--border);margin-top:4px;' : '') + '">'
            + _monthNames[cur.getMonth()] + ' ' + cur.getFullYear() + '</div>';
          // Re-render weekday headers after month label
          weekdays.forEach(function(wd) {
            html += '<div style="text-align:center;font-size:8px;color:var(--muted);padding:1px 0;font-weight:600;">' + wd + '</div>';
          });
        }
        var evts = byDate[iso] || [];
        var postEvts = byPosted[iso] || [];
        var isInRange = iso >= days[0] && iso <= days[days.length - 1];
        var isToday = iso === today;
        var hasEvents = evts.length > 0;
        var hasPostings = postEvts.length > 0;
        var hasAny = hasEvents || hasPostings;

        var bgColor = hasEvents ? 'rgba(0,136,204,.12)' : (hasPostings ? 'rgba(245,158,11,.08)' : (isInRange ? 'var(--bg)' : 'transparent'));
        var borderColor = isToday ? '#0088cc' : (hasEvents ? 'rgba(0,136,204,.3)' : (hasPostings ? 'rgba(245,158,11,.25)' : 'transparent'));

        html += '<div data-day="' + iso + '" style="position:relative;min-height:22px;padding:1px 2px;border-radius:3px;'
          + 'background:' + bgColor + ';'
          + 'border:1px solid ' + borderColor + ';'
          + 'cursor:' + (hasAny ? 'pointer' : 'default') + ';">';

        // Day number
        html += '<div style="font-size:8px;color:' + (isInRange ? 'var(--text)' : 'var(--muted)') + ';'
          + (isToday ? 'font-weight:700;' : '') + '">' + cur.getDate() + '</div>';

        // Dots: mentioned events (circles) + posted events (squares)
        if (hasAny) {
          html += '<div style="display:flex;flex-wrap:wrap;gap:1px;margin-top:1px;">';
          evts.forEach(function(ev) {
            var c = ev.place ? (placeColors[ev.place] || '#0088cc') : '#888';
            var label = ev.place ? ev.place : (ev.snippet || '').slice(0, 40);
            html += '<div title="' + _esc(label) + ' — ' + _fmtT(ev.time) + (ev.time_raw ? ' (' + _esc(ev.time_raw) + ')' : '') + '" '
              + 'style="width:5px;height:5px;border-radius:50%;background:' + c + ';"></div>';
          });
          // Posting markers (only those not already shown as mentioned)
          postEvts.forEach(function(ev) {
            var pDay = (ev.time || "").slice(0, 10);
            if (pDay === iso) return; // already shown as mention dot
            html += '<div title="Gepostet: ' + _esc(ev.place || (ev.snippet || '').slice(0, 30)) + '" '
              + 'style="width:5px;height:5px;border-radius:1px;background:#f59e0b;"></div>';
          });
          html += '</div>';
        }

        html += '</div>';
        cur.setDate(cur.getDate() + 1);
      }
      html += '</div>';

      // Legend (below calendar)
      var uniquePlaces = Object.keys(placeColors);
      if (uniquePlaces.length) {
        html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">';
        uniquePlaces.slice(0, 10).forEach(function(place) {
          html += '<span style="display:inline-flex;align-items:center;gap:3px;font-size:10px;color:var(--muted);">'
            + '<span style="width:8px;height:8px;border-radius:50%;background:' + placeColors[place] + ';flex-shrink:0;"></span>'
            + _esc(place) + '</span>';
        });
        html += '</div>';
      }
      // Hover hint
      html += '<div style="display:flex;gap:10px;margin-top:6px;font-size:10px;color:var(--muted);">';
      html += '<span style="display:inline-flex;align-items:center;gap:3px;"><span style="width:12px;border-top:2px solid #0088cc;"></span>Erwähnt</span>';
      html += '<span style="display:inline-flex;align-items:center;gap:3px;"><span style="width:12px;border-top:2px dashed #f59e0b;"></span>Gepostet</span>';
      html += '</div>';

      grid.innerHTML = html;

      // Interaction: hover on day → highlight markers + posting days
      var prevHighlights = [];
      var prevPostedCells = [];
      grid.querySelectorAll('[data-day]').forEach(function(cell) {
        var day = cell.dataset.day;
        var evts = byDate[day] || [];
        var pEvts = byPosted[day] || [];
        if (!evts.length && !pEvts.length) return;

        cell.addEventListener('mouseenter', function() {
          cell.style.outline = '2px solid #0088cc';

          // Highlight map markers for this day (mentions + postings)
          prevHighlights.forEach(function(m) { m.setStyle({color: "#0088cc", fillColor: "#0088cc", weight: 1}); });
          prevHighlights = [];
          var allDayEvts = evts.concat(pEvts);
          allDayEvts.forEach(function(ev) {
            if (!ev.place) return;
            var marker = markersByPlace[ev.place];
            if (marker && prevHighlights.indexOf(marker) === -1) {
              marker.setStyle({color: "#ff4444", fillColor: "#ff4444", weight: 3});
              marker.bringToFront();
              prevHighlights.push(marker);
            }
          });

          // Highlight posting days in calendar
          prevPostedCells.forEach(function(c) { c.style.outline = ''; });
          prevPostedCells = [];
          var postedDays = {};
          evts.forEach(function(ev) {
            if (ev.posted) {
              var pDay = ev.posted.slice(0, 10);
              if (pDay && pDay !== day) postedDays[pDay] = true;
            }
          });
          Object.keys(postedDays).forEach(function(pDay) {
            var pCell = grid.querySelector('[data-day="' + pDay + '"]');
            if (pCell) {
              pCell.style.outline = '2px dashed #f59e0b';
              prevPostedCells.push(pCell);
            }
          });
        });

        cell.addEventListener('mouseleave', function() {
          cell.style.outline = '';
          prevHighlights.forEach(function(m) { m.setStyle({color: "#0088cc", fillColor: "#0088cc", weight: 1}); });
          prevHighlights = [];
          prevPostedCells.forEach(function(c) { c.style.outline = ''; });
          prevPostedCells = [];
        });

        cell.addEventListener('click', function() {
          // Zoom to fit all places of this day (mentions + postings)
          var dayBounds = [];
          evts.concat(pEvts).forEach(function(ev) {
            if (ev.lat && ev.lon) dayBounds.push([ev.lat, ev.lon]);
          });
          if (dayBounds.length === 1) {
            map.flyTo(dayBounds[0], 8, {duration: 0.5});
            var firstEv = evts[0] || pEvts[0];
            var marker = firstEv && firstEv.place ? markersByPlace[firstEv.place] : null;
            if (marker) marker.openPopup();
          } else if (dayBounds.length > 1) {
            map.flyToBounds(dayBounds, {padding: [30, 30], maxZoom: 8, duration: 0.5});
          }
        });
      });
    }
    // Start polling for visibility — retry up to 5 seconds
    var _geoRetries = 0;
    function _tryInitGeo() {
      _geoRetries++;
      _initTgmGeoMap();
      if (_geoRetries < 25 && document.getElementById("tgm-geo-map") && !document.getElementById("tgm-geo-map")._leaflet_id) {
        setTimeout(_tryInitGeo, 200);
      }
    }
    setTimeout(_tryInitGeo, 100);
  } else if (hasCalendarData) {
    // No geo data, but we have posting events → render calendar standalone
    setTimeout(function() {
      _renderCalendarStandalone(_postingEvents, geoEvents, data);
    }, 100);
  }

  function _renderCalendarStandalone(postEvts, geoEvts, data) {
    var grid = document.getElementById("tgm-cal-grid");
    if (!grid) return;
    var allEvts = geoEvts.concat(postEvts);
    if (!allEvts.length) return;

    // Determine date range from results series
    var days = [];
    results.forEach(function(r) {
      (r.series || []).forEach(function(s) { if (s.date && days.indexOf(s.date) === -1) days.push(s.date); });
    });
    days.sort();
    if (!days.length) return;

    var dStart = new Date(days[0] + "T00:00:00");
    var dEnd = new Date(days[days.length - 1] + "T00:00:00");
    // Expand to full weeks
    dStart.setDate(dStart.getDate() - dStart.getDay() + 1);
    dEnd.setDate(dEnd.getDate() + (7 - dEnd.getDay()));

    // Group by posted date
    var byPosted = {};
    postEvts.forEach(function(ev) {
      var d = (ev.time || "").slice(0, 10);
      if (d) { if (!byPosted[d]) byPosted[d] = []; byPosted[d].push(ev); }
    });

    var today = new Date().toISOString().slice(0, 10);
    var weekdays = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
    var _monthNames = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

    var html = '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;">';
    weekdays.forEach(function(wd) {
      html += '<div style="text-align:center;font-size:8px;color:var(--muted);padding:1px 0;font-weight:600;">' + wd + '</div>';
    });

    var cur = new Date(dStart);
    var lastMonth = -1;
    while (cur <= dEnd) {
      var iso = cur.toISOString().slice(0, 10);
      if (cur.getMonth() !== lastMonth && cur.getDay() === 1) {
        lastMonth = cur.getMonth();
        html += '<div style="grid-column:1/-1;font-size:9px;font-weight:700;color:var(--text);padding:4px 0 1px;">'
          + _monthNames[cur.getMonth()] + ' ' + cur.getFullYear() + '</div>';
        weekdays.forEach(function(wd) {
          html += '<div style="text-align:center;font-size:8px;color:var(--muted);padding:1px 0;font-weight:600;">' + wd + '</div>';
        });
      }
      var postEvtsDay = byPosted[iso] || [];
      var isInRange = iso >= days[0] && iso <= days[days.length - 1];
      var isToday = iso === today;
      var hasPostings = postEvtsDay.length > 0;
      var bgColor = hasPostings ? 'rgba(245,158,11,.08)' : (isInRange ? 'var(--bg)' : 'transparent');
      var borderColor = isToday ? 'var(--accent3)' : (hasPostings ? 'rgba(245,158,11,.25)' : 'transparent');

      html += '<div data-day="' + iso + '" style="position:relative;min-height:22px;padding:1px 2px;border-radius:3px;'
        + 'background:' + bgColor + ';border:1px solid ' + borderColor + ';'
        + 'cursor:' + (hasPostings ? 'pointer' : 'default') + ';">';
      html += '<div style="font-size:8px;color:' + (isInRange ? 'var(--text)' : 'var(--muted)') + ';'
        + (isToday ? 'font-weight:700;' : '') + '">' + cur.getDate() + '</div>';
      if (hasPostings) {
        html += '<div style="font-size:8px;font-weight:600;color:#f59e0b;">' + postEvtsDay.length + '</div>';
      }
      html += '</div>';
      cur.setDate(cur.getDate() + 1);
    }
    html += '</div>';
    grid.innerHTML = html;
  }

  // Initial render of dynamic sections (chart, heatmap, messages)
  _tgmApplyFilter(null);

  // Filter clear button
  var filterClearBtn = document.getElementById("tgm-filter-clear");
  if (filterClearBtn) {
    filterClearBtn.addEventListener("click", function() {
      window._tgmFilterDates = [];
      _tgmApplyFilter(null);
    });
  }

  // OLD CHART/HEATMAP CODE BELOW — KEPT FOR REFERENCE, SKIP
  if (false && window.Chart && results.some(function(r) { return r.series && r.series.length; })) {
    var canvas = document.getElementById("tgm-chart");
    if (!canvas) return;

    // Build unified date labels
    var allDates = {};
    results.forEach(function(r) {
      (r.series || []).forEach(function(pt) { allDates[pt.date] = true; });
    });
    var labels = Object.keys(allDates).sort();

    // Per-keyword datasets
    var datasets = results.map(function(r, idx) {
      var color = TG_COLORS[idx % TG_COLORS.length];
      var dateMap = {};
      (r.series || []).forEach(function(pt) { dateMap[pt.date] = pt.count; });
      return {
        label: r.term || "?",
        data: labels.map(function(d) { return dateMap[d] || 0; }),
        borderColor: color,
        backgroundColor: color + "20",
        borderWidth: 1.5,
        pointRadius: labels.length > 60 ? 0 : 2,
        pointHoverRadius: 4,
        fill: false,
        tension: 0.3,
      };
    });

    // Total volume dataset (stacked sum, filled area)
    if (results.length > 1) {
      var totalData = labels.map(function(d) {
        var sum = 0;
        results.forEach(function(r) {
          (r.series || []).forEach(function(pt) { if (pt.date === d) sum += pt.count; });
        });
        return sum;
      });
      datasets.unshift({
        label: t("wz_tgm_total", "Gesamt"),
        data: totalData,
        borderColor: "rgba(255,255,255,.3)",
        backgroundColor: "rgba(255,255,255,.06)",
        borderWidth: 1,
        borderDash: [4, 3],
        pointRadius: 0,
        fill: true,
        tension: 0.3,
        order: 10,
      });
    }

    // Group messages by date for click handler
    var _msgsByDate = {};
    allMsgs.forEach(function(m) {
      var day = (m.date || "").slice(0, 10);
      if (!day) return;
      if (!_msgsByDate[day]) _msgsByDate[day] = [];
      _msgsByDate[day].push(m);
    });

    var tgmChart = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: { labels: labels, datasets: datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: true, labels: { font: { size: 10 }, boxWidth: 10 } } },
        scales: {
          x: { ticks: { maxTicksLimit: 12, font: { size: 9 }, color: "#888", callback: function(val, idx) { return _fmtD(labels[idx]); } }, grid: { display: false } },
          y: { min: 0, ticks: { font: { size: 9 }, color: "#888", stepSize: 1 }, grid: { color: "rgba(100,100,100,.1)" } },
        },
        interaction: { intersect: false, mode: "index" },
        onClick: function(evt) {
          var points = tgmChart.getElementsAtEventForMode(evt, 'index', {intersect: false}, false);
          if (!points || !points.length) return;
          var idx = points[0].index;
          var clickedDate = labels[idx];
          if (!clickedDate) return;
          var cachedMsgs = _msgsByDate[clickedDate] || [];
          if (cachedMsgs.length) {
            _showDayDetail(clickedDate, cachedMsgs);
          } else {
            _fetchDayDetail(clickedDate, keywords.join(","));
          }
        },
      },
    });
  }

  // ── Term Heatmap rendern ──
  if (allMsgs.length >= 2) {
    var heatEl = document.getElementById("tgm-heatmap");
    if (heatEl) {
      (function() {
        // Count words per day
        var dayWords = {}; // day → {word → count}
        var globalWords = {}; // word → total
        allMsgs.forEach(function(m) {
          var day = (m.date || "").slice(0, 10);
          if (!day) return;
          if (!dayWords[day]) dayWords[day] = {};
          var text = (m.translated || m.text || "").toLowerCase();
          text = text.replace(/https?:\/\/\S+/g, " ").replace(/@\S+/g, " ").replace(/[^\p{L}\p{N}\s]/gu, " ");
          text.split(/\s+/).forEach(function(w) {
            if (w.length >= 3 && !_TGM_STOP.has(w) && !/^\d+$/.test(w)) {
              dayWords[day][w] = (dayWords[day][w] || 0) + 1;
              globalWords[w] = (globalWords[w] || 0) + 1;
            }
          });
        });

        var hmDays = Object.keys(dayWords).sort();
        if (hmDays.length < 2) return;

        // Top 15 terms by total frequency
        var topTerms = Object.keys(globalWords)
          .sort(function(a, b) { return globalWords[b] - globalWords[a]; })
          .slice(0, 15);

        if (!topTerms.length) return;

        // Find max cell value for color scaling
        var maxCell = 1;
        topTerms.forEach(function(w) {
          hmDays.forEach(function(d) {
            var v = (dayWords[d] || {})[w] || 0;
            if (v > maxCell) maxCell = v;
          });
        });

        // Build table
        var h = '<table style="border-collapse:collapse;width:100%;font-size:10px;">';
        // Header row: days
        h += '<tr><td style="padding:2px 6px;font-weight:600;color:var(--muted);position:sticky;left:0;background:var(--surface);z-index:1;"></td>';
        hmDays.forEach(function(d) {
          h += '<td style="padding:2px 4px;text-align:center;color:var(--muted);font-size:8px;white-space:nowrap;writing-mode:vertical-lr;height:50px;">' + _fmtD(d) + '</td>';
        });
        h += '</tr>';

        // Term rows
        topTerms.forEach(function(word) {
          h += '<tr>';
          h += '<td style="padding:2px 6px;font-weight:500;color:var(--text);white-space:nowrap;position:sticky;left:0;background:var(--surface);z-index:1;border-right:1px solid var(--border);">' + _esc(word) + '</td>';
          hmDays.forEach(function(d) {
            var val = (dayWords[d] || {})[word] || 0;
            var intensity = val > 0 ? Math.round((val / maxCell) * 100) : 0;
            var bg = val > 0 ? 'rgba(0,136,204,' + (0.1 + (intensity / 100) * 0.8).toFixed(2) + ')' : 'transparent';
            h += '<td data-hm-word="' + _esc(word) + '" data-hm-day="' + d + '" style="padding:0;text-align:center;min-width:20px;height:20px;background:' + bg + ';border-radius:2px;'
              + (val > 0 ? 'cursor:pointer;' : '') + '"'
              + ' title="' + _esc(word) + ' — ' + _fmtD(d) + ': ' + val + 'x">';
            if (val > 0) h += '<span style="font-size:8px;color:#fff;font-weight:600;pointer-events:none;">' + val + '</span>';
            h += '</td>';
          });
          h += '</tr>';
        });
        h += '</table>';

        heatEl.innerHTML = h;

        // Click handler: show matching messages for word+day
        heatEl.addEventListener('click', function(e) {
          var td = e.target.closest('[data-hm-word]');
          if (!td) return;
          var word = td.dataset.hmWord;
          var day = td.dataset.hmDay;
          if (!word || !day) return;

          // Find messages from this day containing this word
          var wordLower = word.toLowerCase();
          var matching = allMsgs.filter(function(m) {
            if ((m.date || "").slice(0, 10) !== day) return false;
            var text = (m.translated || m.text || "").toLowerCase();
            return text.indexOf(wordLower) !== -1;
          });

          if (!matching.length) return;

          // Build popup
          var popup = document.getElementById("tgm-hm-popup");
          if (!popup) {
            popup = document.createElement("div");
            popup.id = "tgm-hm-popup";
            popup.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:99999;display:flex;align-items:center;justify-content:center;";
            popup.addEventListener("click", function(ev) { if (ev.target === popup) popup.style.display = "none"; });
            document.body.appendChild(popup);
          }

          var ph = '<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px 20px;'
            + 'width:90%;max-width:600px;max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.4);">';
          ph += '<div style="display:flex;align-items:center;margin-bottom:10px;">';
          ph += '<strong style="font-size:13px;color:var(--text);flex:1;">"' + _esc(word) + '" — ' + _fmtD(day) + ' (' + matching.length + ')</strong>';
          ph += '<button onclick="document.getElementById(\'tgm-hm-popup\').style.display=\'none\'" style="border:none;background:none;color:var(--muted);cursor:pointer;font-size:18px;">&times;</button>';
          ph += '</div>';

          matching.forEach(function(m) {
            var text = m.translated || m.text || "";
            // Highlight the word
            var re = new RegExp("(" + word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "gi");
            var highlighted = _esc(text).replace(re, '<mark style="background:#0088cc;color:#fff;padding:0 2px;border-radius:2px;">$1</mark>');

            ph += '<div style="padding:8px 0;border-bottom:1px solid var(--border);">';
            ph += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">';
            if (m.channel_username) {
              ph += '<a href="https://t.me/' + _esc(m.channel_username) + '" target="_blank" rel="noopener" style="color:#0088cc;text-decoration:none;font-weight:600;font-size:11px;">@' + _esc(m.channel_username) + '</a>';
            } else if (m.channel) {
              ph += '<span style="font-weight:600;font-size:11px;color:var(--text);">' + _esc(m.channel) + '</span>';
            }
            if (m.src_lang && m.src_lang !== "unknown") {
              ph += '<span style="font-size:8px;padding:1px 4px;border-radius:3px;background:rgba(255,255,255,.08);color:var(--muted);">' + _esc(m.src_lang.toUpperCase()) + '</span>';
            }
            ph += '<span style="margin-left:auto;font-size:9px;color:var(--muted);">' + _fmtDt(m.date) + '</span>';
            ph += '</div>';
            ph += '<div style="font-size:12px;color:var(--text);line-height:1.5;">' + highlighted + '</div>';
            if (m.translated && m.text && m.translated !== m.text) {
              ph += '<div style="font-size:10px;color:var(--muted);font-style:italic;border-left:2px solid var(--border);padding-left:8px;margin-top:4px;">' + _esc(m.text) + '</div>';
            }
            ph += '</div>';
          });

          ph += '</div>';
          popup.innerHTML = ph;
          popup.style.display = "flex";
        });
      })();
    }
  }

}

// ── Event-Zeit-Filter: vor/nach Focus-Time ──
function _tgmApplyEventTimeFilter() {
  var allMsgs = window._tgmAllMsgs || [];
  var mode = window._tgmEventMode || "both";
  var tf = (window._tgmAICtx || {}).time_focus;

  if (!tf || !tf.from || mode === "both") {
    // No filter — reset to full dataset and re-apply other filters
    window._tgmEventFiltered = null;
    _tgmUpdateFilter();
    return;
  }

  // Parse event datetime precisely
  var eventFrom = tf.from.replace("T", " ");
  var eventTo = (tf.to || tf.from).replace("T", " ");
  // Pad to comparable format YYYY-MM-DD HH:MM
  if (eventFrom.length === 10) eventFrom += " 00:00";
  if (eventTo.length === 10) eventTo += " 23:59";

  var filtered;
  if (mode === "before") {
    filtered = allMsgs.filter(function(m) {
      var d = (m.date || "").replace("T", " ");
      return d < eventFrom;
    });
  } else {  // "after"
    filtered = allMsgs.filter(function(m) {
      var d = (m.date || "").replace("T", " ");
      return d > eventTo;
    });
  }

  window._tgmEventFiltered = filtered;
  _tgmUpdateFilter();
}

// ── Geo-Filter: filtert Chart, Heatmap, Nachrichten nach Ort(en) ──
window._tgmFilterPlaces = [];  // array of active filter places

function _tgmApplyFilter(place) {
  // Single click: set filter to this place. null = clear all.
  if (place === null) {
    window._tgmFilterPlaces = [];
  } else {
    window._tgmFilterPlaces = [place];
  }
  _tgmUpdateFilter();
}

function _tgmToggleMultiFilter(place) {
  // Shift+Click: add/remove from multi-filter
  var idx = window._tgmFilterPlaces.indexOf(place);
  if (idx !== -1) {
    window._tgmFilterPlaces.splice(idx, 1);
  } else {
    window._tgmFilterPlaces.push(place);
  }
  _tgmUpdateFilter();
}

function _tgmUpdateFilter() {
  // Start with event-time-filtered messages if active, otherwise all
  var allMsgs = window._tgmEventFiltered || window._tgmAllMsgs || [];
  var places = window._tgmFilterPlaces;
  var hasFilter = places.length > 0;

  var banner = document.getElementById("tgm-filter-banner");
  if (banner) {
    if (hasFilter) {
      banner.style.display = "flex";
      document.getElementById("tgm-filter-place").textContent = places.join(", ");
    } else {
      banner.style.display = "none";
    }
  }

  // Filter messages: keep those that mention any of the filter places
  var filtered;
  if (hasFilter) {
    var pLowers = places.map(function(p) { return p.toLowerCase(); });
    filtered = allMsgs.filter(function(m) {
      var text = ((m.translated || "") + " " + (m.text || "")).toLowerCase();
      return pLowers.some(function(pl) { return text.indexOf(pl) !== -1; });
    });
  } else {
    filtered = allMsgs;
  }

  // Update map markers (deduplicate — same circle can appear under multiple keys)
  var markers = window._tgmMarkers || {};
  var seen = [];
  Object.keys(markers).forEach(function(p) {
    var m = markers[p];
    if (!m || seen.indexOf(m) !== -1) return;
    seen.push(m);
    if (!hasFilter) {
      m.setStyle({color: "#0088cc", fillColor: "#0088cc", fillOpacity: 0.5, weight: 1});
      m.setRadius(m._origRadius || 8);
    } else {
      var markerNames = m._placeNames || [p.toLowerCase()];
      var filterLowers = places.map(function(fp) { return fp.toLowerCase(); });
      var isActive = markerNames.some(function(mn) {
        return filterLowers.some(function(fl) {
          return mn === fl || mn.indexOf(fl) !== -1 || fl.indexOf(mn) !== -1;
        });
      });
      if (!m._origRadius) m._origRadius = m.getRadius();
      if (isActive) {
        m.setStyle({color: "#0088cc", fillColor: "#0088cc", fillOpacity: 0.6, weight: 2});
        m.setRadius(m._origRadius || 8);
        m.bringToFront();
      } else {
        m.setStyle({color: "#555", fillColor: "#555", fillOpacity: 0.15, weight: 1});
        m.setRadius(Math.max((m._origRadius || 8) * 0.6, 3));
      }
    }
  });

  // Also apply date filter if active
  var datePlaces = window._tgmFilterDates || [];
  if (datePlaces.length) {
    filtered = filtered.filter(function(m) {
      return datePlaces.indexOf((m.date || "").slice(0, 10)) !== -1;
    });
  }

  // Re-render chart
  _tgmRenderChart(filtered, hasFilter ? places.join(", ") : null);
  // Re-render heatmap (place-filtered but all dates visible)
  _tgmRenderHeatmap(hasFilter ? allMsgs.filter(function(m) {
    var text = ((m.translated || "") + " " + (m.text || "")).toLowerCase();
    return places.some(function(p) { return text.indexOf(p.toLowerCase()) !== -1; });
  }) : allMsgs);
  // Re-render messages
  _tgmRenderMessages(filtered);
}

function _tgmRenderChart(msgs, filterPlace) {
  var el = document.getElementById("tgm-dynamic-chart");
  if (!el) return;

  // Build daily counts from messages
  var dayCounts = {};
  msgs.forEach(function(m) {
    var day = (m.date || "").slice(0, 10);
    if (day) dayCounts[day] = (dayCounts[day] || 0) + 1;
  });
  var rawDays = Object.keys(dayCounts).sort();

  if (rawDays.length < 1) { el.innerHTML = ""; return; }

  // Fill gaps: every day from first to last
  var chartDays = [];
  var cur = new Date(rawDays[0] + "T00:00:00");
  var end = new Date(rawDays[rawDays.length - 1] + "T00:00:00");
  while (cur <= end) {
    chartDays.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }

  var title = t("wz_tgm_header", "Erwähnungen");
  if (filterPlace) title += ' — ' + _esc(filterPlace);

  el.innerHTML = '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 16px;margin-bottom:14px;">'
    + '<div style="font-size:12px;font-weight:600;margin-bottom:8px;">' + title + '</div>'
    + '<div style="position:relative;width:100%;height:180px;"><canvas id="tgm-chart"></canvas></div>'
    + '</div>';

  var canvas = document.getElementById("tgm-chart");
  if (!canvas || !window.Chart) return;

  // Focus time annotation
  var tf = (window._tgmAICtx || {}).time_focus;
  var tfPlugin = {};
  if (tf && tf.from) {
    var tfFrom = tf.from.slice(0, 10);
    var tfTo = (tf.to || tf.from).slice(0, 10);
    tfPlugin = {
      id: 'tgmFocusLine',
      afterDraw: function(chart) {
        var xScale = chart.scales.x;
        var ctx2 = chart.ctx;
        var fromIdx = chartDays.indexOf(tfFrom);
        var toIdx = chartDays.indexOf(tfTo);
        // If exact date not in chart, find nearest
        if (fromIdx === -1) {
          for (var fi = 0; fi < chartDays.length; fi++) { if (chartDays[fi] >= tfFrom) { fromIdx = fi; break; } }
        }
        if (toIdx === -1) {
          for (var ti = chartDays.length - 1; ti >= 0; ti--) { if (chartDays[ti] <= tfTo) { toIdx = ti; break; } }
        }
        if (fromIdx === -1 && toIdx === -1) return;
        if (fromIdx === -1) fromIdx = toIdx;
        if (toIdx === -1) toIdx = fromIdx;
        var x1 = xScale.getPixelForValue(fromIdx);
        var x2 = xScale.getPixelForValue(toIdx);
        var top = chart.chartArea.top;
        var bottom = chart.chartArea.bottom;
        // Draw band
        ctx2.save();
        var _tfC = tf.color || '#f59e0b';
        ctx2.fillStyle = _tfC + '1f';
        ctx2.fillRect(Math.min(x1, x2) - 2, top, Math.abs(x2 - x1) + 4, bottom - top);
        // Draw center line
        var xCenter = (x1 + x2) / 2;
        ctx2.beginPath();
        ctx2.moveTo(xCenter, top);
        ctx2.lineTo(xCenter, bottom);
        ctx2.strokeStyle = _tfC;
        ctx2.lineWidth = 1.5;
        ctx2.setLineDash([4, 3]);
        ctx2.stroke();
        // Label
        ctx2.fillStyle = _tfC;
        ctx2.font = '9px sans-serif';
        ctx2.textAlign = 'center';
        ctx2.fillText(tf.title || 'Focus', xCenter, top - 4);
        ctx2.restore();
      }
    };
  }

  new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {
      labels: chartDays,
      datasets: [{
        label: filterPlace || t("wz_tgm_total", "Gesamt"),
        data: chartDays.map(function(d) { return dayCounts[d] || 0; }),
        borderColor: "#0088cc",
        backgroundColor: "rgba(0,136,204,.15)",
        borderWidth: 1.5,
        pointRadius: chartDays.length > 20 ? 0 : 2,
        fill: true,
        tension: 0.3,
      }],
    },
    plugins: [tfPlugin],
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { maxTicksLimit: 10, font: { size: 8 }, color: "#888", callback: function(v, i) { return _fmtD(chartDays[i]); } }, grid: { display: false } },
        y: { min: 0, ticks: { font: { size: 8 }, color: "#888", stepSize: 1 }, grid: { color: "rgba(100,100,100,.1)" } },
      },
    },
  });
}

function _tgmRenderHeatmap(msgs) {
  var el = document.getElementById("tgm-dynamic-heatmap");
  if (!el) return;
  if (msgs.length < 2) { el.innerHTML = ""; return; }

  var dayWords = {};
  var globalWords = {};
  msgs.forEach(function(m) {
    var day = (m.date || "").slice(0, 10);
    if (!day) return;
    if (!dayWords[day]) dayWords[day] = {};
    var text = (m.translated || m.text || "").toLowerCase();
    text = text.replace(/https?:\/\/\S+/g, " ").replace(/@\S+/g, " ").replace(/[^\p{L}\p{N}\s]/gu, " ");
    text.split(/\s+/).forEach(function(w) {
      if (w.length >= 3 && !_TGM_STOP.has(w) && !/^\d+$/.test(w)) {
        dayWords[day][w] = (dayWords[day][w] || 0) + 1;
        globalWords[w] = (globalWords[w] || 0) + 1;
      }
    });
  });

  var hmDays = Object.keys(dayWords).sort();
  if (hmDays.length < 1) { el.innerHTML = ""; return; }
  var topTerms = Object.keys(globalWords).sort(function(a, b) { return globalWords[b] - globalWords[a]; }).slice(0, 15);
  if (!topTerms.length) { el.innerHTML = ""; return; }

  var maxCell = 1;
  topTerms.forEach(function(w) { hmDays.forEach(function(d) { var v = (dayWords[d] || {})[w] || 0; if (v > maxCell) maxCell = v; }); });

  var h = '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 16px;margin-bottom:14px;">';
  h += '<div style="font-size:12px;font-weight:600;margin-bottom:8px;">' + t("wz_tgm_heatmap", "Inhaltliche Entwicklung") + '</div>';
  h += '<div style="overflow-x:auto;"><table style="border-collapse:collapse;width:100%;font-size:10px;">';
  // Focus time range for highlighting
  var htf = (window._tgmAICtx || {}).time_focus;
  var htfFrom = htf && htf.from ? htf.from.slice(0, 10) : null;
  var htfTo = htf && htf.to ? htf.to.slice(0, 10) : htfFrom;
  function _isFocusDay(d) { return htfFrom && d >= htfFrom && d <= htfTo; }
  var _htfC = (htf && htf.color) || '#f59e0b';

  h += '<tr><td style="padding:2px 6px;position:sticky;left:0;background:var(--surface);z-index:1;"></td>';
  hmDays.forEach(function(d) {
    var isActive = window._tgmFilterDates && window._tgmFilterDates.indexOf(d) !== -1;
    var isFocus = _isFocusDay(d);
    h += '<td data-hm-date="' + d + '" style="padding:2px 4px;text-align:center;font-size:8px;white-space:nowrap;writing-mode:vertical-lr;height:50px;cursor:pointer;'
      + 'color:' + (isFocus ? _htfC : (isActive ? '#0088cc' : 'var(--muted)')) + ';'
      + 'font-weight:' + (isFocus || isActive ? '700' : '400') + ';'
      + 'background:' + (isActive ? 'rgba(0,136,204,.1)' : (isFocus ? _htfC + '14' : 'transparent')) + ';'
      + 'border-radius:3px;'
      + (isFocus ? 'border-bottom:2px solid ' + _htfC + ';' : '') + '"'
      + ' title="' + (isFocus ? '⚡ Focus Time — ' : '') + 'Klick: nach ' + _fmtD(d) + ' filtern">'
      + _fmtD(d) + '</td>';
  });
  h += '</tr>';
  topTerms.forEach(function(word) {
    h += '<tr><td style="padding:2px 6px;font-weight:500;color:var(--text);white-space:nowrap;position:sticky;left:0;background:var(--surface);z-index:1;border-right:1px solid var(--border);">' + _esc(word) + '</td>';
    hmDays.forEach(function(d) {
      var val = (dayWords[d] || {})[word] || 0;
      var isFocusCell = _isFocusDay(d);
      var bg = val > 0 ? 'rgba(0,136,204,' + (0.1 + (val / maxCell) * 0.8).toFixed(2) + ')' : (isFocusCell ? _htfC + '0a' : 'transparent');
      h += '<td data-hm-word="' + _esc(word) + '" data-hm-day="' + d + '" style="padding:0;text-align:center;min-width:20px;height:20px;background:' + bg + ';border-radius:2px;' + (val > 0 ? 'cursor:pointer;' : '') + '" title="' + _esc(word) + ' — ' + _fmtD(d) + ': ' + val + 'x">';
      if (val > 0) h += '<span style="font-size:8px;color:#fff;font-weight:600;pointer-events:none;">' + val + '</span>';
      h += '</td>';
    });
    h += '</tr>';
  });
  h += '</table></div></div>';
  el.innerHTML = h;

  // Store available dates for shift+click inversion
  window._tgmAllHeatmapDates = hmDays;

  // Heatmap click + drag handler
  if (!el._tgmClickBound) {
    el._tgmClickBound = true;

    // Drag state for date header range selection
    var _dragStart = null;
    var _dragging = false;

    el.addEventListener('mousedown', function(e) {
      var dateTd = e.target.closest('[data-hm-date]');
      if (dateTd && !e.shiftKey) {
        _dragStart = dateTd.dataset.hmDate;
        _dragging = false;
        e.preventDefault();
      }
    });

    el.addEventListener('mousemove', function(e) {
      if (!_dragStart) return;
      var dateTd = e.target.closest('[data-hm-date]');
      if (dateTd && dateTd.dataset.hmDate !== _dragStart) {
        _dragging = true;
        // Highlight range preview
        var allHeaders = el.querySelectorAll('[data-hm-date]');
        var startIdx = -1, endIdx = -1;
        allHeaders.forEach(function(h, i) {
          if (h.dataset.hmDate === _dragStart) startIdx = i;
          if (h.dataset.hmDate === dateTd.dataset.hmDate) endIdx = i;
        });
        if (startIdx > endIdx) { var tmp = startIdx; startIdx = endIdx; endIdx = tmp; }
        allHeaders.forEach(function(h, i) {
          if (i >= startIdx && i <= endIdx) {
            h.style.background = 'rgba(0,136,204,.2)';
            h.style.color = '#0088cc';
          } else {
            var isActive = window._tgmFilterDates && window._tgmFilterDates.indexOf(h.dataset.hmDate) !== -1;
            h.style.background = isActive ? 'rgba(0,136,204,.1)' : 'transparent';
            h.style.color = isActive ? '#0088cc' : '';
          }
        });
      }
    });

    document.addEventListener('mouseup', function(e) {
      if (!_dragStart) return;
      if (_dragging) {
        // Finish drag: select date range
        var dateTd = e.target.closest('[data-hm-date]');
        var endDate = dateTd ? dateTd.dataset.hmDate : _dragStart;
        var allHeaders = el.querySelectorAll('[data-hm-date]');
        var startIdx = -1, endIdx = -1;
        allHeaders.forEach(function(h, i) {
          if (h.dataset.hmDate === _dragStart) startIdx = i;
          if (h.dataset.hmDate === endDate) endIdx = i;
        });
        if (startIdx > endIdx) { var tmp = startIdx; startIdx = endIdx; endIdx = tmp; }
        window._tgmFilterDates = [];
        allHeaders.forEach(function(h, i) {
          if (i >= startIdx && i <= endIdx) {
            window._tgmFilterDates.push(h.dataset.hmDate);
          }
        });
        _tgmApplyDateFilter();
      }
      _dragStart = null;
      _dragging = false;
    });

    el.addEventListener('click', function(e) {
      // Skip if we just finished a drag
      if (_dragging) return;
      // Date header click → date filter
      var dateTd = e.target.closest('[data-hm-date]');
      if (dateTd) {
        var clickedDate = dateTd.dataset.hmDate;
        if (!clickedDate) return;
        _tgmToggleDateFilter(clickedDate, e.shiftKey);
        return;
      }
      // Word × day cell click → popup
      var td = e.target.closest('[data-hm-word]');
      if (!td) return;
      var word = td.dataset.hmWord, day = td.dataset.hmDay;
      if (!word || !day) return;
      var wLower = word.toLowerCase();
      var matching = (window._tgmAllMsgs || []).filter(function(m) {
        if ((m.date || "").slice(0, 10) !== day) return false;
        return ((m.translated || m.text || "").toLowerCase()).indexOf(wLower) !== -1;
      });
      if (matching.length) _tgmShowHeatmapPopup(word, day, matching);
    });
  }
}

// ── Datums-Filter aus Heatmap-Header ──
window._tgmFilterDates = [];

window._tgmAllHeatmapDates = []; // all available dates in heatmap

function _tgmToggleDateFilter(date, shiftKey) {
  if (shiftKey) {
    // Shift+click: select all OTHER dates (invert relative to clicked)
    var wasOnlyThis = window._tgmFilterDates.length === 1 && window._tgmFilterDates[0] === date;
    if (wasOnlyThis || window._tgmFilterDates.length === 0) {
      // Select all except this one
      window._tgmFilterDates = window._tgmAllHeatmapDates.filter(function(d) { return d !== date; });
    } else {
      // Select only this one (undo multi-select)
      window._tgmFilterDates = [date];
    }
  } else {
    // Single click: toggle this date
    var idx = window._tgmFilterDates.indexOf(date);
    if (idx !== -1) {
      window._tgmFilterDates.splice(idx, 1);
    } else {
      window._tgmFilterDates.push(date);
    }
  }
  _tgmApplyDateFilter();
}

function _tgmApplyDateFilter() {
  var allMsgs = window._tgmEventFiltered || window._tgmAllMsgs || [];
  var dates = window._tgmFilterDates;
  var hasDateFilter = dates.length > 0;
  var hasPlaceFilter = (window._tgmFilterPlaces || []).length > 0;

  // Apply both place and date filters
  var filtered = allMsgs;
  if (hasPlaceFilter) {
    var pLowers = window._tgmFilterPlaces.map(function(p) { return p.toLowerCase(); });
    filtered = filtered.filter(function(m) {
      var text = ((m.translated || "") + " " + (m.text || "")).toLowerCase();
      return pLowers.some(function(pl) { return text.indexOf(pl) !== -1; });
    });
  }
  if (hasDateFilter) {
    filtered = filtered.filter(function(m) {
      var day = (m.date || "").slice(0, 10);
      return dates.indexOf(day) !== -1;
    });
  }

  // Update banner
  var banner = document.getElementById("tgm-filter-banner");
  if (banner) {
    if (hasDateFilter || hasPlaceFilter) {
      banner.style.display = "flex";
      var parts = [];
      if (hasPlaceFilter) parts.push(window._tgmFilterPlaces.join(", "));
      if (hasDateFilter) parts.push(dates.map(function(d) { return _fmtD(d); }).join(", "));
      document.getElementById("tgm-filter-place").textContent = parts.join(" + ");
    } else {
      banner.style.display = "none";
    }
  }

  // Update map markers based on date filter
  var markers = window._tgmMarkers || {};
  if (hasDateFilter && !hasPlaceFilter) {
    // Find which places appear in the filtered messages
    var activePlaces = {};
    filtered.forEach(function(m) {
      var text = ((m.translated || "") + " " + (m.text || "")).toLowerCase();
      var seen2 = [];
      Object.keys(markers).forEach(function(p) {
        var mk = markers[p];
        if (!mk || seen2.indexOf(mk) !== -1) return;
        seen2.push(mk);
        var names = mk._placeNames || [p.toLowerCase()];
        names.forEach(function(n) {
          if (text.indexOf(n) !== -1) activePlaces[p] = true;
        });
      });
    });
    var seen3 = [];
    Object.keys(markers).forEach(function(p) {
      var m = markers[p];
      if (!m || seen3.indexOf(m) !== -1) return;
      seen3.push(m);
      if (!m._origRadius) m._origRadius = m.getRadius();
      if (activePlaces[p]) {
        m.setStyle({color: "#0088cc", fillColor: "#0088cc", fillOpacity: 0.6, weight: 2});
        m.setRadius(m._origRadius || 8);
      } else {
        m.setStyle({color: "#555", fillColor: "#555", fillOpacity: 0.15, weight: 1});
        m.setRadius(Math.max((m._origRadius || 8) * 0.6, 3));
      }
    });
  } else if (!hasDateFilter && !hasPlaceFilter) {
    // Reset all markers
    var seen4 = [];
    Object.keys(markers).forEach(function(p) {
      var m = markers[p];
      if (!m || seen4.indexOf(m) !== -1) return;
      seen4.push(m);
      m.setStyle({color: "#0088cc", fillColor: "#0088cc", fillOpacity: 0.5, weight: 1});
      m.setRadius(m._origRadius || 8);
    });
  }

  // Re-render chart + messages with combined filters
  _tgmRenderChart(filtered, hasPlaceFilter ? window._tgmFilterPlaces.join(", ") : null);
  _tgmRenderMessages(filtered);

  // Re-render heatmap with place-filtered msgs but always show all dates
  // (date filter only highlights headers, doesn't remove columns)
  var heatMsgs = allMsgs;
  if (hasPlaceFilter) {
    var pLowers2 = window._tgmFilterPlaces.map(function(p) { return p.toLowerCase(); });
    heatMsgs = allMsgs.filter(function(m) {
      var text = ((m.translated || "") + " " + (m.text || "")).toLowerCase();
      return pLowers2.some(function(pl) { return text.indexOf(pl) !== -1; });
    });
  }
  _tgmRenderHeatmap(heatMsgs);
}

function _tgmRenderMessages(msgs) {
  var el = document.getElementById("tgm-dynamic-msgs");
  if (!el) return;
  window._tgmLastMsgs = msgs;
  if (!msgs.length) { el.innerHTML = ""; return; }

  // Check for time_focus from zone config
  var _z = WZ._liveZoneId ? (WZ._zones || []).find(function(z) { return z.id === WZ._liveZoneId; }) : null;
  var tf = _z && _z.config && _z.config.time_focus ? _z.config.time_focus : null;
  var tfFrom = tf && tf.from ? tf.from.slice(0, 10) : null;
  var tfTo = tf && tf.to ? tf.to.slice(0, 10) : tfFrom;

  function _renderMsg(m, borderColor) {
    var hasTranslation = m.translated && m.translated !== m.text;
    var langBadge = m.src_lang && m.src_lang !== "unknown"
      ? '<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:rgba(255,255,255,.08);color:var(--muted);margin-left:6px;">' + _esc(m.src_lang.toUpperCase()) + '</span>' : '';
    var chLabel = m.channel_username
      ? '<a href="https://t.me/' + _esc(m.channel_username) + '" target="_blank" rel="noopener" style="color:#0088cc;text-decoration:none;font-weight:600;">@' + _esc(m.channel_username) + '</a>'
      : '<span style="font-weight:600;color:var(--text);">' + _esc(m.channel || "?") + '</span>';
    var r = '<div style="padding:8px 0;border-bottom:1px solid var(--border);' + (borderColor ? 'border-left:3px solid ' + borderColor + ';padding-left:10px;' : '') + '">';
    r += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">' + chLabel + langBadge;
    r += '<span style="margin-left:auto;font-size:10px;color:var(--muted);white-space:nowrap;">' + _fmtDt(m.date) + '</span></div>';
    if (hasTranslation) {
      r += '<div style="font-size:12px;color:var(--text);line-height:1.5;margin-bottom:4px;">' + _esc(m.translated) + '</div>';
      r += '<div style="font-size:11px;color:var(--muted);line-height:1.4;font-style:italic;border-left:2px solid var(--border);padding-left:8px;">' + _esc(m.text) + '</div>';
    } else {
      r += '<div style="font-size:12px;color:var(--text);line-height:1.5;">' + _esc(m.text) + '</div>';
    }
    r += '</div>';
    return r;
  }

  // Sort: default ascending (oldest first)
  var sortAsc = window._tgmSortAsc !== false;
  msgs.sort(function(a, b) { return sortAsc ? (a.date || "").localeCompare(b.date || "") : (b.date || "").localeCompare(a.date || ""); });

  var h = '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 16px;margin-bottom:14px;">';
  h += '<div style="display:flex;align-items:center;margin-bottom:10px;">';
  h += '<span style="font-size:12px;font-weight:600;flex:1;">' + t("wz_tgm_messages", "Nachrichten") + ' (' + msgs.length + ')</span>';
  h += '<button onclick="window._tgmSortAsc=!window._tgmSortAsc;if(window._tgmLastMsgs)_tgmRenderMessages(window._tgmLastMsgs);" style="border:1px solid var(--border);background:none;color:var(--muted);cursor:pointer;font-size:10px;padding:2px 8px;border-radius:4px;" title="Sortierung umkehren">' + (sortAsc ? '\u2191 \u00c4lteste zuerst' : '\u2193 Neueste zuerst') + '</button>';
  h += '</div>';

  if (tfFrom) {
    // Split into before / during / after
    var before = [], during = [], after = [];
    msgs.forEach(function(m) {
      var d = (m.date || "").slice(0, 10);
      if (d < tfFrom) before.push(m);
      else if (d > (tfTo || tfFrom)) after.push(m);
      else during.push(m);
    });

    // Before
    if (before.length) {
      h += '<div style="font-size:11px;font-weight:700;color:#06b6d4;margin-bottom:4px;">Vor dem Ereignis (' + before.length + ')</div>';
      before.forEach(function(m) { h += _renderMsg(m, "#06b6d4"); });
    }

    // Event marker line
    h += '<div style="display:flex;align-items:center;gap:8px;margin:12px 0;">';
    h += '<div style="flex:1;height:2px;background:linear-gradient(to right,transparent,#f59e0b,#f59e0b,transparent);"></div>';
    h += '<span style="font-size:11px;font-weight:700;color:#f59e0b;white-space:nowrap;">\u25cf ' + _esc(tf.title || "EREIGNIS") + ' (' + _fmtD(tfFrom) + ')</span>';
    h += '<div style="flex:1;height:2px;background:linear-gradient(to right,transparent,#f59e0b,#f59e0b,transparent);"></div>';
    h += '</div>';

    // During
    if (during.length) {
      h += '<div style="font-size:11px;font-weight:700;color:#f59e0b;margin-bottom:4px;">W\u00e4hrend des Ereignisses (' + during.length + ')</div>';
      during.forEach(function(m) { h += _renderMsg(m, "#f59e0b"); });
    }

    // After separator
    if (after.length && during.length) {
      h += '<div style="display:flex;align-items:center;gap:8px;margin:12px 0;">';
      h += '<div style="flex:1;height:1px;background:var(--border);"></div>';
      h += '<span style="font-size:10px;color:var(--muted);">Ende des Ereigniszeitraums</span>';
      h += '<div style="flex:1;height:1px;background:var(--border);"></div>';
      h += '</div>';
    }

    // After
    if (after.length) {
      h += '<div style="font-size:11px;font-weight:700;color:#8b5cf6;margin-bottom:4px;">Nach dem Ereignis (' + after.length + ')</div>';
      after.forEach(function(m) { h += _renderMsg(m, "#8b5cf6"); });
    }
  } else {
    // No focus time — flat list
    msgs.forEach(function(m) { h += _renderMsg(m, null); });
  }

  h += '</div>';
  el.innerHTML = h;
}

// Heatmap popup (reused from earlier)
function _tgmShowHeatmapPopup(word, day, msgs) {
  var popup = document.getElementById("tgm-hm-popup");
  if (!popup) {
    popup = document.createElement("div");
    popup.id = "tgm-hm-popup";
    popup.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:99999;display:flex;align-items:center;justify-content:center;";
    popup.addEventListener("click", function(ev) { if (ev.target === popup) popup.style.display = "none"; });
    document.body.appendChild(popup);
  }
  var ph = '<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px 20px;width:90%;max-width:600px;max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.4);">';
  ph += '<div style="display:flex;align-items:center;margin-bottom:10px;"><strong style="font-size:13px;color:var(--text);flex:1;">"' + _esc(word) + '" — ' + _fmtD(day) + ' (' + msgs.length + ')</strong>';
  ph += '<button onclick="document.getElementById(\'tgm-hm-popup\').style.display=\'none\'" style="border:none;background:none;color:var(--muted);cursor:pointer;font-size:18px;">&times;</button></div>';
  var re = new RegExp("(" + word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "gi");
  msgs.forEach(function(m) {
    var text = m.translated || m.text || "";
    var highlighted = _esc(text).replace(re, '<mark style="background:#0088cc;color:#fff;padding:0 2px;border-radius:2px;">$1</mark>');
    ph += '<div style="padding:8px 0;border-bottom:1px solid var(--border);">';
    if (m.channel_username) ph += '<a href="https://t.me/' + _esc(m.channel_username) + '" target="_blank" style="color:#0088cc;text-decoration:none;font-weight:600;font-size:11px;">@' + _esc(m.channel_username) + '</a> ';
    ph += '<span style="font-size:9px;color:var(--muted);">' + _fmtDt(m.date) + '</span>';
    ph += '<div style="font-size:12px;color:var(--text);line-height:1.5;margin-top:4px;">' + highlighted + '</div>';
    if (m.translated && m.text && m.translated !== m.text) ph += '<div style="font-size:10px;color:var(--muted);font-style:italic;border-left:2px solid var(--border);padding-left:8px;margin-top:4px;">' + _esc(m.text) + '</div>';
    ph += '</div>';
  });
  ph += '</div>';
  popup.innerHTML = ph;
  popup.style.display = "flex";
}

// ── KI-Analyse Popup ──
function _showAnalysisPopup(data, ctx) {
  var popup = document.getElementById("tgm-analysis-popup");
  if (!popup) {
    popup = document.createElement("div");
    popup.id = "tgm-analysis-popup";
    popup.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;align-items:center;justify-content:center;";
    popup.addEventListener("click", function(ev) { if (ev.target === popup) popup.style.display = "none"; });
    document.body.appendChild(popup);
  }

  // Render markdown — process line by line for reliable matching
  var rawLines = (data.answer || "").split("\n");
  var mdHtml = "";
  var inList = false;
  var inTable = false;
  for (var li = 0; li < rawLines.length; li++) {
    var line = rawLines[li];
    // Escape HTML entities in this line
    line = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // Horizontal rule → skip
    if (/^-{3,}$/.test(line.trim())) continue;
    // Bold + italic (before headings so they work inside headings too)
    line = line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    line = line.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // Headings
    if (/^### (.+)/.test(line)) {
      if (inList) { mdHtml += '</div>'; inList = false; }
      mdHtml += '<h4 style="margin:14px 0 6px;font-size:13px;font-weight:700;color:var(--text);border-bottom:1px solid var(--border);padding-bottom:4px;">' + line.replace(/^### /, '') + '</h4>';
      continue;
    }
    if (/^## (.+)/.test(line)) {
      if (inList) { mdHtml += '</div>'; inList = false; }
      mdHtml += '<h3 style="margin:18px 0 8px;font-size:15px;font-weight:700;color:var(--text);border-bottom:1px solid var(--border);padding-bottom:5px;">' + line.replace(/^## /, '') + '</h3>';
      continue;
    }
    if (/^# (.+)/.test(line)) {
      if (inList) { mdHtml += '</div>'; inList = false; }
      mdHtml += '<h2 style="margin:20px 0 10px;font-size:17px;font-weight:700;color:var(--text);">' + line.replace(/^# /, '') + '</h2>';
      continue;
    }
    // List items
    if (/^[-•] (.+)/.test(line)) {
      if (!inList) { mdHtml += '<div style="margin:4px 0;">'; inList = true; }
      mdHtml += '<div style="padding:2px 0 2px 18px;position:relative;"><span style="position:absolute;left:6px;color:var(--muted);">•</span>' + line.replace(/^[-•] /, '') + '</div>';
      continue;
    }
    if (/^\d+\. (.+)/.test(line)) {
      if (!inList) { mdHtml += '<div style="margin:4px 0;">'; inList = true; }
      var numMatch = line.match(/^(\d+)\. (.+)/);
      mdHtml += '<div style="padding:2px 0 2px 18px;">' + numMatch[1] + '. ' + numMatch[2] + '</div>';
      continue;
    }
    // End list if not a list item
    if (inList) { mdHtml += '</div>'; inList = false; }
    // Empty line = paragraph break
    if (line.trim() === '') {
      mdHtml += '<div style="height:6px;"></div>';
      continue;
    }
    // Table row: | col1 | col2 | col3 |
    if (/^\|(.+)\|$/.test(line.trim())) {
      if (inList) { mdHtml += '</div>'; inList = false; }
      var cells = line.trim().replace(/^\||\|$/g, '').split('|').map(function(c) { return c.trim(); });
      // Separator row (|---|---|---| ) → skip
      if (cells.every(function(c) { return /^[-:]+$/.test(c); })) {
        continue;
      }
      if (!inTable) {
        mdHtml += '<table style="border-collapse:collapse;width:100%;font-size:12px;margin:8px 0;">';
        inTable = true;
      }
      // Detect header: if next line is separator
      var nextLine = (li + 1 < rawLines.length) ? rawLines[li + 1].trim() : '';
      var isHeader = /^\|[-:|\s]+\|$/.test(nextLine);
      var tag = isHeader ? 'th' : 'td';
      var style = isHeader
        ? 'padding:5px 10px;border-bottom:2px solid var(--border);font-weight:700;text-align:left;color:var(--text);'
        : 'padding:4px 10px;border-bottom:1px solid var(--border);color:var(--text);';
      mdHtml += '<tr>';
      cells.forEach(function(c) { mdHtml += '<' + tag + ' style="' + style + '">' + c + '</' + tag + '>'; });
      mdHtml += '</tr>';
      continue;
    }
    // Close table if we were in one
    if (inTable) { mdHtml += '</table>'; inTable = false; }
    // Normal text
    mdHtml += '<div style="margin:2px 0;">' + line + '</div>';
  }
  if (inList) mdHtml += '</div>';
  if (inTable) mdHtml += '</table>';
  var md = mdHtml;

  var h = '<div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:24px 30px;'
    + 'width:94%;max-width:1000px;max-height:88vh;overflow-y:auto;box-shadow:0 12px 40px rgba(0,0,0,.5);">';

  // Header
  h += '<div style="display:flex;align-items:center;margin-bottom:16px;">';
  h += '<div style="flex:1;">';
  h += '<h2 style="margin:0;font-size:17px;color:var(--text);">KI-Analyse: ' + _esc(ctx.zone_name || 'Telegram') + '</h2>';
  h += '<span style="font-size:10px;color:var(--muted);">' + _esc(data.model || '') + ' — ' + (ctx.messages || []).length + ' Nachrichten, ' + (ctx.geo_locations || []).length + ' Orte</span>';
  h += '</div>';
  h += '<button onclick="document.getElementById(\'tgm-analysis-popup\').style.display=\'none\'" style="border:none;background:none;color:var(--muted);cursor:pointer;font-size:20px;line-height:1;">&times;</button>';
  h += '</div>';

  // Analysis content
  h += '<div style="font-size:13px;color:var(--text);line-height:1.7;">' + md + '</div>';

  // Action buttons
  h += '<div style="display:flex;gap:10px;margin-top:20px;padding-top:14px;border-top:1px solid var(--border);">';
  h += '<button id="tgm-save-slide-btn" style="padding:8px 18px;border:none;border-radius:6px;background:var(--accent3);color:#fff;cursor:pointer;font-size:12px;font-weight:600;">'
    + 'Als Projekt-Slide speichern</button>';
  h += '<button onclick="document.getElementById(\'tgm-analysis-popup\').style.display=\'none\'" '
    + 'style="padding:8px 18px;border:1px solid var(--border);border-radius:6px;background:none;color:var(--muted);cursor:pointer;font-size:12px;">Schließen</button>';
  h += '</div>';
  h += '</div>';

  popup.innerHTML = h;
  popup.style.display = "flex";

  // Save as slide handler
  var saveBtn = document.getElementById("tgm-save-slide-btn");
  if (saveBtn && ctx.project_id) {
    saveBtn.addEventListener("click", function() {
      saveBtn.disabled = true;
      saveBtn.textContent = "Speichere…";

      // Capture the chart canvas as image
      var chartImg = null;
      var chartCanvas = document.getElementById("tgm-chart");
      if (chartCanvas) {
        try { chartImg = chartCanvas.toDataURL("image/png"); } catch(e) {}
      }

      fetch("/api/ai-telegram-save-slide", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          project_id: ctx.project_id,
          zone_name: ctx.zone_name,
          analysis: data.answer,
          model: data.model,
          chart_image: chartImg,
          msg_count: (ctx.messages || []).length,
          geo_count: (ctx.geo_locations || []).length,
          keywords: ctx.keywords,
        }),
      })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.ok) {
          saveBtn.textContent = "Gespeichert!";
          saveBtn.style.background = "#4ade80";
        } else {
          saveBtn.textContent = d.error || "Fehler";
          saveBtn.style.background = "#ef4444";
        }
      })
      .catch(function() {
        saveBtn.textContent = "Fehler";
        saveBtn.style.background = "#ef4444";
      });
    });
  } else if (saveBtn && !ctx.project_id) {
    saveBtn.title = "Kein Projekt zugeordnet";
    saveBtn.style.opacity = "0.4";
    saveBtn.style.cursor = "not-allowed";
  }
}

// ── Tages-Detail: Nachrichten per API laden, dann Top-Begriffe zeigen ──
function _fetchDayDetail(date, keywordsStr) {
  var box = document.getElementById("tgm-day-detail");
  if (!box) return;
  box.style.display = '';
  box.innerHTML = '<div style="font-size:11px;color:var(--muted);"><span style="display:inline-block;animation:spin 1s linear infinite;margin-right:6px;">&#9696;</span>Lade Nachrichten für ' + _fmtD(date) + '…</div>';

  fetch('/api/telegram-day-messages?date=' + encodeURIComponent(date) + '&terms=' + encodeURIComponent(keywordsStr))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data.ok) {
        box.innerHTML = '<div style="font-size:11px;color:#ef4444;">' + _esc(data.error || 'Fehler') + '</div>';
        return;
      }
      _showDayDetail(date, data.messages || []);
    })
    .catch(function(e) {
      box.innerHTML = '<div style="font-size:11px;color:#ef4444;">Fehler: ' + _esc(e.message || '') + '</div>';
    });
}

function _showDayDetail(date, msgs) {
  var box = document.getElementById("tgm-day-detail");
  if (!box) return;

  if (!msgs.length) {
    box.style.display = '';
    box.innerHTML = '<div style="font-size:11px;color:var(--muted);">' + _fmtD(date) + ' — ' + t("wz_tgm_no_msgs_day", "Keine Nachrichten an diesem Tag.") + '</div>';
    return;
  }

  // Extract top terms from all messages of this day
  var wordCounts = {};
  msgs.forEach(function(m) {
    var text = (m.translated || m.text || "").toLowerCase();
    text = text.replace(/https?:\/\/\S+/g, " ").replace(/@\S+/g, " ").replace(/[^\p{L}\p{N}\s]/gu, " ");
    var words = text.split(/\s+/).filter(function(w) { return w.length >= 3 && !_TGM_STOP.has(w) && !/^\d+$/.test(w); });
    words.forEach(function(w) {
      wordCounts[w] = (wordCounts[w] || 0) + 1;
    });
  });

  // Sort by frequency, take top 10
  var sorted = Object.keys(wordCounts).sort(function(a, b) { return wordCounts[b] - wordCounts[a]; }).slice(0, 10);

  if (!sorted.length) {
    box.style.display = '';
    box.innerHTML = '<div style="font-size:11px;color:var(--muted);">' + _fmtD(date) + ' — Keine relevanten Begriffe gefunden.</div>';
    return;
  }

  var maxCount = wordCounts[sorted[0]];
  var html = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">';
  html += '<strong style="font-size:12px;color:var(--text);">' + _fmtD(date) + '</strong>';
  html += '<span style="font-size:10px;color:var(--muted);">' + msgs.length + ' ' + t("wz_tgm_messages","Nachrichten") + '</span>';
  html += '<button onclick="document.getElementById(\'tgm-day-detail\').style.display=\'none\'" style="margin-left:auto;border:none;background:none;color:var(--muted);cursor:pointer;font-size:14px;">&times;</button>';
  html += '</div>';

  html += '<div style="display:flex;flex-wrap:wrap;gap:6px;">';
  sorted.forEach(function(word, i) {
    var pct = Math.round((wordCounts[word] / maxCount) * 100);
    var opacity = 0.4 + (pct / 100) * 0.6;
    var size = 11 + Math.round((pct / 100) * 5);
    html += '<span style="padding:3px 10px;border-radius:12px;background:rgba(0,136,204,' + (opacity * 0.3).toFixed(2) + ');'
      + 'color:var(--text);font-size:' + size + 'px;font-weight:' + (i < 3 ? '700' : '500') + ';white-space:nowrap;"'
      + ' title="' + wordCounts[word] + 'x">'
      + _esc(word) + '<span style="font-size:9px;color:var(--muted);margin-left:3px;">' + wordCounts[word] + '</span>'
      + '</span>';
  });
  html += '</div>';

  box.style.display = '';
  box.innerHTML = html;
}

function _esc(s) {
  if (!s) return "";
  var d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function _fmtDt(s) {
  if (!s) return "";
  if (window.fmtDate) return window.fmtDate(s.replace(" ", "T"));
  return s;
}
function _fmtD(s) {
  if (!s) return "";
  if (window.fmtDateOnly) return window.fmtDateOnly(s.replace(" ", "T"));
  return s.slice(0, 10);
}
function _fmtT(s) {
  if (!s) return "";
  if (window.fmtTimeOnly) return window.fmtTimeOnly(s.replace(" ", "T"));
  return s.slice(11, 16);
}

// ── Custom Edit Handler for Telegram zones ──
var _origWzEditZone = window.wzEditZone;
window.wzEditZone = function(id, panel) {
  if (panel === "telegram_monitor") {
    _tgmEditZone(id);
    return;
  }
  if (_origWzEditZone) _origWzEditZone(id, panel);
};

function _tgmEditZone(id) {
  var z = WZ._zones.find(function(zz) { return zz.id === id; });
  if (!z) return;
  var cfg = z.config || {};

  // Reuse the create overlay with pre-filled values
  var ov = document.getElementById('tgm-create-overlay');
  ov.style.display = 'flex';

  // Pre-fill fields
  var kw = cfg.keywords || "";
  if (Array.isArray(kw)) kw = kw.join(", ");
  var channels = cfg.channels || [];
  if (Array.isArray(channels)) channels = channels.join(", ");

  document.getElementById('tgm-kw-input').value = kw;
  document.getElementById('tgm-channels-input').value = Array.isArray(channels) ? channels.join(", ") : channels;
  document.getElementById('tgm-name-input').value = z.name;
  document.getElementById('tgm-name-input').dataset.edited = '1';
  document.getElementById('tgm-days-input').value = String(cfg.days || 7);
  document.getElementById('tgm-preview').style.display = 'none';
  document.getElementById('tgm-kw-translate').style.display = 'none';

  // Set time focus if present
  var tfSel = document.getElementById('tgm-tf-event');
  if (cfg.time_focus && cfg.time_focus.event_id && tfSel) {
    // Load events first, then select
    fetch('/api/events').then(function(r) { return r.json(); }).then(function(evts) {
      var _fd = typeof fmtDateOnly === 'function' ? fmtDateOnly : function(s) { return s ? s.slice(0,10) : ''; };
      var html = '<option value="">-- Kein Time Focus --</option>';
      (evts || []).forEach(function(ev) {
        html += '<option value="' + ev.id + '" data-title="' + (ev.title||'').replace(/"/g,'&quot;') + '"'
          + ' data-from="' + (ev.start_dt||'') + '" data-to="' + (ev.end_dt||ev.start_dt||'') + '"'
          + (ev.lat ? ' data-lat="'+ev.lat+'" data-lon="'+ev.lon+'"' : '')
          + (ev.location_name ? ' data-loc="'+ev.location_name.replace(/"/g,'&quot;')+'"' : '')
          + '>' + _fd(ev.start_dt) + ' — ' + (ev.title||'').substring(0,50) + '</option>';
      });
      tfSel.innerHTML = html;
      tfSel.value = String(cfg.time_focus.event_id);
    });
  }

  // Change dialog title
  var titleEl = ov.querySelector('h3');
  if (titleEl) titleEl.textContent = 'Keyword-Gruppe bearbeiten';

  // Change save button to update mode
  var saveBtn = document.getElementById('tgm-save-btn');
  var origText = saveBtn.textContent;
  saveBtn.textContent = 'Speichern';

  // Replace save handler temporarily
  var newSave = saveBtn.cloneNode(true);
  saveBtn.parentNode.replaceChild(newSave, saveBtn);
  newSave.id = 'tgm-save-btn';

  newSave.addEventListener('click', function() {
    var newKw = document.getElementById('tgm-kw-input').value.trim();
    if (!newKw) { document.getElementById('tgm-kw-input').focus(); return; }
    var newName = document.getElementById('tgm-name-input').value.trim() || newKw.split(',')[0].trim();
    var newCh = document.getElementById('tgm-channels-input').value.trim();
    var newDays = parseInt(document.getElementById('tgm-days-input').value) || 7;

    var newConfig = JSON.parse(JSON.stringify(cfg));
    newConfig.keywords = newKw;
    newConfig.days = newDays;
    if (newCh) {
      newConfig.channels = newCh.split(',').map(function(c) { return c.trim().replace(/^@/, ''); }).filter(Boolean);
    } else {
      delete newConfig.channels;
    }

    // Time Focus
    var evSel = document.getElementById('tgm-tf-event');
    var evOpt = evSel.options[evSel.selectedIndex];
    if (evOpt && evOpt.value) {
      newConfig.time_focus = {
        event_id: parseInt(evOpt.value),
        title: evOpt.dataset.title || '',
        from: evOpt.dataset.from || '',
        to: evOpt.dataset.to || evOpt.dataset.from || '',
      };
      if (evOpt.dataset.lat) {
        newConfig.time_focus.lat = parseFloat(evOpt.dataset.lat);
        newConfig.time_focus.lon = parseFloat(evOpt.dataset.lon);
        newConfig.time_focus.location_name = evOpt.dataset.loc || '';
      }
    } else {
      delete newConfig.time_focus;
    }

    fetch('/api/watchzones/' + id, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name: newName, config: newConfig}),
    }).then(function(r) { return r.json(); }).then(function(updated) {
      if (updated.id) {
        var idx = WZ._zones.findIndex(function(zz) { return zz.id === id; });
        if (idx >= 0) WZ._zones[idx] = updated;
        WZ._renderAllZones();
        ov.style.display = 'none';
        // Restore title + button for next create
        if (titleEl) titleEl.textContent = 'Keyword-Gruppe anlegen';
        newSave.textContent = 'Anlegen';
      } else {
        alert(updated.error || 'Fehler beim Speichern');
      }
    });
  });

  // Restore on close
  ov.addEventListener('click', function _restore(e) {
    if (e.target === ov) {
      if (titleEl) titleEl.textContent = 'Keyword-Gruppe anlegen';
      newSave.textContent = 'Anlegen';
      ov.removeEventListener('click', _restore);
    }
  });
}

WZ.registerPlugin("telegram_monitor", {
  renderer: _renderTelegramMonitorLive,
  has_map: false,
  has_live_map: false,
  default_source: "telegram",
  live_box_max_width: "98vw",
  live_box_height: "auto",
  live_title_prefix: "Telegram",
  openStrategy: "spinner",
});

// Collect Config
WZ._collectConfigs["telegram_monitor"] = {
  fields: function(saved) {
    saved = saved || {};
    var h = '';
    // Import from existing Telegram zone
    h += '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px;">Bestehende Telegram-Zone verwenden</label>';
    h += '<select class="wz-cc-field" data-key="source_zone_id" style="width:100%;padding:4px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);font-size:11px;box-sizing:border-box;margin-bottom:6px;">';
    h += '<option value="">-- Keine (nur Suchbegriff) --</option>';
    (WZ._zones || []).forEach(function(z) {
      if (z.zone_type !== "telegram_monitor") return;
      var sel = saved.source_zone_id == z.id ? ' selected' : '';
      var channels = (z.config && z.config.channels) ? z.config.channels.length + ' Kan\u00e4le' : '';
      h += '<option value="' + z.id + '"' + sel + '>' + WZ._esc(z.name) + (channels ? ' (' + channels + ')' : '') + '</option>';
    });
    h += '</select>';
    // Search term
    h += '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px;">Suchbegriff</label>';
    h += '<input class="wz-cc-field" data-key="search" value="' + (saved.search || "").replace(/"/g,"&quot;") + '" placeholder="z.B. Explosion, Protest, Angriff" style="width:100%;padding:4px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);font-size:11px;box-sizing:border-box;margin-bottom:4px;">';
    h += '<div style="font-size:9px;color:var(--muted);">Durchsucht die Kan\u00e4le und Gruppen der ausgew\u00e4hlten Zone.</div>';
    return h;
  },
  read: function(container) {
    var cfg = {};
    var inp = container.querySelector('[data-key="search"]');
    if (inp) cfg.search = inp.value.trim();
    var sel = container.querySelector('[data-key="source_zone_id"]');
    if (sel && sel.value) cfg.source_zone_id = parseInt(sel.value);
    return cfg;
  }
};

// Collect Renderer
WZ._collectRenderers["telegram_monitor"] = {
  renderHTML: function(data, cardId) {
    var h = "", fmtD = WZ._fmtDate || function(s) { return s ? String(s).slice(0,10) : ""; };
    // Keywords + channels info
    if (data.keywords && data.keywords.length) {
      h += '<div style="font-size:11px;color:var(--muted);margin-bottom:6px;">Keywords: <strong style="color:var(--text);">' + data.keywords.map(function(k){return WZ._esc(k);}).join(', ') + '</strong>';
      if (data.channels && data.channels.length) h += ' \u2014 ' + data.channels.length + ' Kan\u00e4le';
      h += '</div>';
    }
    // Geo map
    if (data.geo_locations && data.geo_locations.length) {
      h += '<div id="' + cardId + '-map" style="height:400px;border-radius:6px;margin-bottom:8px;"></div>';
    }
    // Per-keyword results
    var results = data.results || [];
    if (results.length) {
      h += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px;">';
      results.forEach(function(r) {
        var total = r.total || (r.messages ? r.messages.length : 0);
        h += '<div style="text-align:center;"><div style="font-size:18px;font-weight:800;color:var(--text);">' + total + '</div><div style="font-size:9px;color:var(--muted);max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + WZ._esc(r.keyword || "") + '</div></div>';
      });
      h += '</div>';
    }
    // Collect all messages, deduplicate, sort (oldest first by default)
    var allMsgs = [];
    results.forEach(function(r) { (r.messages || []).forEach(function(m) { allMsgs.push(m); }); });
    var seen = {};
    allMsgs = allMsgs.filter(function(m) { var k = (m.date || "") + (m.text || "").substring(0,50); if (seen[k]) return false; seen[k] = true; return true; });
    allMsgs.sort(function(a,b) { return (a.date || "").localeCompare(b.date || ""); }); // ascending = oldest first

    var tf = data.time_focus;
    var tfFrom = tf && tf.from ? tf.from.slice(0,10) : null;
    var tfTo = tf && tf.to ? tf.to.slice(0,10) : tfFrom;

    if (allMsgs.length && tfFrom) {
      // Split into before / during / after focus time
      var before = [], during = [], after = [];
      allMsgs.forEach(function(m) {
        var d = (m.date || "").slice(0, 10);
        if (d < tfFrom) before.push(m);
        else if (d > (tfTo || tfFrom)) after.push(m);
        else during.push(m);
      });

      // Show balanced selection: half before, event, half after
      var maxPerSection = 5;
      // Render chronologically with event marker line inserted at the right place
      var showBefore = before.slice(-maxPerSection);
      var showDuring = during.slice(0, maxPerSection * 2);
      var showAfter = after.slice(0, maxPerSection);

      function _fmtDT(d) { if (!d) return ""; var ds = fmtD(d); var ts = String(d).replace("T"," ").substring(11,16); return ds + (ts && ts !== "00:00" ? " " + ts : ""); }

      // Before
      if (showBefore.length) {
        h += '<div style="font-size:10px;font-weight:700;color:#06b6d4;margin-bottom:4px;">Vor dem Ereignis (' + before.length + ')</div>';
        showBefore.forEach(function(m) {
          var txt = m.translated || m.text || "";
          h += '<div style="padding:4px 8px;margin-bottom:3px;border-left:2px solid #06b6d4;background:rgba(255,255,255,.02);border-radius:0 4px 4px 0;font-size:10px;">';
          h += '<span style="color:var(--muted);margin-right:6px;white-space:nowrap;">' + _fmtDT(m.date) + '</span>';
          h += '<span style="color:var(--muted);margin-right:6px;">' + WZ._esc((m.channel || m.chat || "").substring(0, 18)) + '</span>';
          h += '<span style="color:var(--text);">' + WZ._esc(txt.substring(0, 150)) + (txt.length > 150 ? "\u2026" : "") + '</span>';
          h += '</div>';
        });
        if (before.length > maxPerSection) h += '<div style="font-size:9px;color:var(--muted);margin-bottom:4px;">+ ' + (before.length - maxPerSection) + ' weitere</div>';
      }

      // Event marker line
      h += '<div style="display:flex;align-items:center;gap:8px;margin:10px 0;">';
      h += '<div style="flex:1;height:2px;background:linear-gradient(to right,transparent,#f59e0b,#f59e0b,transparent);"></div>';
      h += '<span style="font-size:10px;font-weight:700;color:#f59e0b;white-space:nowrap;">\u25cf EREIGNIS' + (tf.title ? ' \u2014 ' + WZ._esc(tf.title) : '') + ' (' + fmtD(tfFrom) + ')' + '</span>';
      h += '<div style="flex:1;height:2px;background:linear-gradient(to right,transparent,#f59e0b,#f59e0b,transparent);"></div>';
      h += '</div>';

      // During
      if (showDuring.length) {
        h += '<div style="font-size:10px;font-weight:700;color:#f59e0b;margin-bottom:4px;">W\u00e4hrend (' + during.length + ')</div>';
        showDuring.forEach(function(m) {
          var txt = m.translated || m.text || "";
          h += '<div style="padding:4px 8px;margin-bottom:3px;border-left:2px solid #f59e0b;background:rgba(245,158,11,.04);border-radius:0 4px 4px 0;font-size:10px;">';
          h += '<span style="color:var(--muted);margin-right:6px;white-space:nowrap;">' + _fmtDT(m.date) + '</span>';
          h += '<span style="color:var(--muted);margin-right:6px;">' + WZ._esc((m.channel || m.chat || "").substring(0, 18)) + '</span>';
          h += '<span style="color:var(--text);">' + WZ._esc(txt.substring(0, 150)) + (txt.length > 150 ? "\u2026" : "") + '</span>';
          h += '</div>';
        });
      }

      // After
      if (showAfter.length) {
        h += '<div style="font-size:10px;font-weight:700;color:#8b5cf6;margin-top:6px;margin-bottom:4px;">Nach dem Ereignis (' + after.length + ')</div>';
        showAfter.forEach(function(m) {
          var txt = m.translated || m.text || "";
          h += '<div style="padding:4px 8px;margin-bottom:3px;border-left:2px solid #8b5cf6;background:rgba(255,255,255,.02);border-radius:0 4px 4px 0;font-size:10px;">';
          h += '<span style="color:var(--muted);margin-right:6px;white-space:nowrap;">' + _fmtDT(m.date) + '</span>';
          h += '<span style="color:var(--muted);margin-right:6px;">' + WZ._esc((m.channel || m.chat || "").substring(0, 18)) + '</span>';
          h += '<span style="color:var(--text);">' + WZ._esc(txt.substring(0, 150)) + (txt.length > 150 ? "\u2026" : "") + '</span>';
          h += '</div>';
        });
        if (after.length > maxPerSection) h += '<div style="font-size:9px;color:var(--muted);">+ ' + (after.length - maxPerSection) + ' weitere</div>';
      }
    } else if (allMsgs.length) {
      // No focus time — simple list with translated text
      function _fmtDT2(d) { if (!d) return ""; var ds = fmtD(d); var ts = String(d).replace("T"," ").substring(11,16); return ds + (ts && ts !== "00:00" ? " " + ts : ""); }
      allMsgs.slice(0, 15).forEach(function(m) {
        var txt = m.translated || m.text || "";
        h += '<div style="padding:4px 8px;margin-bottom:3px;border-left:2px solid var(--border);background:rgba(255,255,255,.02);border-radius:0 4px 4px 0;font-size:10px;">';
        h += '<span style="color:var(--muted);margin-right:6px;white-space:nowrap;">' + _fmtDT2(m.date) + '</span>';
        h += '<span style="color:var(--muted);margin-right:6px;">' + WZ._esc((m.channel || m.chat || "").substring(0, 18)) + '</span>';
        h += '<span style="color:var(--text);">' + WZ._esc(txt.substring(0, 150)) + (txt.length > 150 ? "\u2026" : "") + '</span>';
        h += '</div>';
      });
      if (allMsgs.length > 15) h += '<div style="font-size:9px;color:var(--muted);margin-top:4px;">+ ' + (allMsgs.length - 15) + ' weitere</div>';
    } else {
      h += '<div style="font-size:11px;color:var(--muted);">Keine Nachrichten gefunden.</div>';
    }
    // Timeline chart
    if (allMsgs.length > 1) {
      h += '<div style="position:relative;height:120px;margin-top:8px;"><canvas id="' + cardId + '-tg-chart"></canvas></div>';
    }
    return h;
  },
  afterRender: function(data, cardId, cardEl) {
    // Build geo map
    if (window.L && data.geo_locations && data.geo_locations.length) {
      var mapEl = cardEl.querySelector("[id$='-map']");
      if (mapEl && !mapEl._leaflet_id) {
        var m = L.map(mapEl, { zoomControl: false }).setView([30, 10], 2);
        L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png", { maxZoom: 18 }).addTo(m);
        var bounds = [];
        data.geo_locations.forEach(function(g) {
          if (g.lat == null) return;
          L.circleMarker([g.lat, g.lon || g.lng], { radius: 5, color: "#8b5cf6", fillColor: "#8b5cf6", fillOpacity: 0.6, weight: 1 })
            .bindTooltip('<strong>' + WZ._esc(g.name || g.text || "") + '</strong>').addTo(m);
          bounds.push([g.lat, g.lon || g.lng]);
        });
        if (bounds.length) { try { m.fitBounds(bounds, { padding: [20, 20], maxZoom: 10 }); } catch(e) {} }
      }
    }
    // Timeline chart
    if (!window.Chart) return;
    var canvas = document.getElementById(cardId + "-tg-chart");
    if (!canvas) return;
    var fmtD = WZ._fmtDate || function(s) { return s ? String(s).slice(0,10) : ""; };
    // Collect all messages with dates
    var allMsgs = [];
    (data.results || []).forEach(function(r) { (r.messages || []).forEach(function(m) { if (m.date) allMsgs.push(m); }); });
    if (allMsgs.length < 2) return;
    // Count per day
    var dayCounts = {};
    allMsgs.forEach(function(m) { var d = m.date.slice(0,10); dayCounts[d] = (dayCounts[d] || 0) + 1; });
    var labels = Object.keys(dayCounts).sort();
    var values = labels.map(function(d) { return dayCounts[d]; });
    // Focus time plugin
    var plugins = [];
    var tf = data.time_focus;
    if (tf && tf.from) {
      var tfFrom = tf.from.slice(0,10), tfTo = (tf.to || tf.from).slice(0,10);
      plugins.push({
        id: 'tgFocus',
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
          ctx2.restore();
        }
      });
    }
    new Chart(canvas.getContext("2d"), {
      type: "bar", data: { labels: labels.map(function(d) { return fmtD(d); }), datasets: [{ label: "Erw\u00e4hnungen", data: values, backgroundColor: "rgba(139,92,246,.5)", borderColor: "#8b5cf6", borderWidth: 1 }] },
      plugins: plugins,
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
        scales: { x: { ticks: { font: { size: 8 }, color: "#888", maxTicksLimit: 10 }, grid: { display: false } }, y: { ticks: { font: { size: 8 }, color: "#888", stepSize: 1 }, grid: { color: "rgba(100,100,100,.1)" } } },
        interaction: { intersect: false, mode: "index" } }
    });
  }
};

})();
