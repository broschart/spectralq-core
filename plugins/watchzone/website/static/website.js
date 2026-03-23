/**
 * WZ Module: website renderer + wayback calendar.
 */
(function() {
"use strict";
var WZ = window.WZ;

  // ── Website-Zonen (keine Karte, nur URL-Eingabe) ───────────────────────
  // ── URL-Schnellauswahl-Daten (lazy-loaded from external JSON) ──────────
  let _WZ_URL_DATA_CACHE = null;

  window.wzAddWebsite = async function() {
    const mid = 'wz-add-website-modal';
    document.getElementById(mid)?.remove();

    // ── Load URL data (cached after first fetch) ──
    if (!_WZ_URL_DATA_CACHE) {
      try {
        const r = await fetch('/static/data/wz_urls.json');
        _WZ_URL_DATA_CACHE = await r.json();
      } catch(e) {
        console.error('wz_urls.json laden fehlgeschlagen:', e);
        _WZ_URL_DATA_CACHE = {};
      }
    }
    const _WZ_URL_DATA = _WZ_URL_DATA_CACHE;

    const _CATS = [
      { id:'mil',  label: t('wz_website_cat_mil','Military') },
      { id:'pol',  label: t('wz_website_cat_pol','Politics') },
      { id:'news', label: t('wz_website_cat_news','News') },
      { id:'dis',  label: t('wz_website_cat_dis','Disaster Relief') },
      { id:'med',  label: t('wz_website_cat_med','Medicine') },
    ];
    let _regionNames;
    try { _regionNames = new Intl.DisplayNames([window._VT_LANG || 'en'], { type: 'region' }); } catch(e) { _regionNames = null; }

    let _selCountry = 'US';
    let _selCat     = 'news';

    const modal = document.createElement('div');
    modal.id = mid;
    modal.style.cssText = 'position:fixed;inset:0;z-index:10200;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;';

    modal.innerHTML = `
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;
                  width:min(920px,95vw);max-height:88vh;display:flex;flex-direction:column;
                  box-shadow:0 20px 60px rgba(0,0,0,.6);overflow:hidden;">

        <!-- Header -->
        <div style="padding:12px 18px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;flex-shrink:0;">
          <span style="font-size:15px;font-weight:700;color:var(--text);">${t('wz_website_modal_title','\uD83C\uDF10 Add Website')}</span>
          <span style="flex:1;"></span>
          <button id="wz-aws-close" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:20px;line-height:1;">&#10005;</button>
        </div>

        <!-- URL + Name inputs -->
        <div style="padding:16px 18px 14px;border-bottom:1px solid var(--border);flex-shrink:0;background:var(--surface);">
          <div style="margin-bottom:10px;">
            <label style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px;">${t('wz_website_lbl_url','Website URL')}</label>
            <input id="wz-aws-url" type="url" placeholder="https://example.com"
              style="width:100%;box-sizing:border-box;background:var(--bg);border:1px solid var(--border);border-radius:7px;
                     padding:8px 12px;font-size:13px;color:var(--text);outline:none;font-family:monospace;"
              oninput="(function(el){const hn=el.value.replace(/^https?:\/\//,'').split('/')[0].split('?')[0];if(hn&&!document.getElementById('wz-aws-name').dataset.edited)document.getElementById('wz-aws-name').value=hn;})(this)">
          </div>
          <div style="display:flex;gap:10px;align-items:flex-end;">
            <div style="flex:1;">
              <label style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px;">${t('wz_website_lbl_name','Watch Zone Name')}</label>
              <input id="wz-aws-name" type="text" placeholder="e.g. Pentagon"
                style="width:100%;box-sizing:border-box;background:var(--bg);border:1px solid var(--border);border-radius:7px;
                       padding:8px 12px;font-size:13px;color:var(--text);outline:none;"
                oninput="this.dataset.edited='1'">
            </div>
            <button id="wz-aws-add" style="padding:8px 20px;background:#0e7490;color:#fff;border:none;border-radius:7px;
                       font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;flex-shrink:0;">
              ${t('wz_website_add','+ Add')}
            </button>
          </div>
          <div style="margin-top:10px;">
            <label style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px;">Time Focus (${t('wz_optional','optional')})</label>
            <select id="wz-aws-event"
              style="width:100%;box-sizing:border-box;background:var(--bg);border:1px solid var(--border);border-radius:7px;
                     padding:6px 10px;font-size:12px;color:var(--text);">
              <option value="">${t('wz_no_time_focus','-- Kein Time Focus --')}</option>
            </select>
          </div>
          <div id="wz-aws-err" style="display:none;margin-top:8px;font-size:12px;color:#f87171;font-family:sans-serif;"></div>
        </div>

        <!-- Schnellauswahl label -->
        <div style="padding:10px 18px 0;flex-shrink:0;">
          <span style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;">${t('wz_website_quick_select','Quick Select')}</span>
        </div>

        <!-- Country chips -->
        <div id="wz-aws-countries" style="display:flex;flex-wrap:wrap;gap:6px;padding:8px 18px 10px;flex-shrink:0;overflow-x:auto;border-bottom:1px solid var(--border);"></div>

        <!-- Category tabs -->
        <div id="wz-aws-cats" style="display:flex;flex-wrap:wrap;border-bottom:1px solid var(--border);flex-shrink:0;background:var(--surface);"></div>

        <!-- URL grid -->
        <div id="wz-aws-grid" style="flex:1;overflow-y:auto;padding:12px 18px;"></div>

      </div>`;

    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
    document.getElementById('wz-aws-close').onclick = () => modal.remove();

    // ── Load events for time focus dropdown ──
    (async function() {
      try {
        var projectId = document.getElementById('hdr-wz-project')?.value || null;
        var evUrl = '/api/events' + (projectId ? '?project_id=' + projectId : '');
        var evR = await fetch(evUrl);
        if (evR.ok) {
          var events = await evR.json();
          var sel = document.getElementById('wz-aws-event');
          events.forEach(function(ev) {
            var dateInfo = ev.start_dt || '';
            if (ev.end_dt) dateInfo += ' \u2013 ' + ev.end_dt;
            var opt = document.createElement('option');
            opt.value = ev.id;
            opt.textContent = ev.title + ' (' + dateInfo + ')';
            sel.appendChild(opt);
          });
        }
      } catch(e) {}
    })();

    // ── Render countries ──
    const countriesEl = document.getElementById('wz-aws-countries');
    Object.entries(_WZ_URL_DATA).forEach(([code, c]) => {
      const chip = document.createElement('button');
      chip.dataset.code = code;
      chip.style.cssText = 'padding:4px 10px;border-radius:20px;border:1px solid var(--border);background:var(--surface2);cursor:pointer;font-size:12px;font-family:sans-serif;white-space:nowrap;color:var(--text);transition:all .12s;';
      const localName = (_regionNames && _regionNames.of(code)) || c.name;
      chip.innerHTML = `${c.flag} ${localName}`;
      chip.onclick = () => { _selCountry = code; _refreshCountryChips(); _refreshGrid(); };
      countriesEl.appendChild(chip);
    });

    // ── Render category tabs ──
    const catsEl = document.getElementById('wz-aws-cats');
    _CATS.forEach((cat, i) => {
      const btn = document.createElement('button');
      btn.dataset.cat = cat.id;
      btn.style.cssText = 'padding:8px 14px;background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;font-size:12px;font-family:sans-serif;white-space:nowrap;color:#a78bfa;transition:all .1s;';
      btn.textContent = cat.label;
      btn.onclick = () => { _selCat = cat.id; _refreshCatTabs(); _refreshGrid(); };
      catsEl.appendChild(btn);
    });

    function _refreshCountryChips() {
      countriesEl.querySelectorAll('button[data-code]').forEach(chip => {
        const active = chip.dataset.code === _selCountry;
        chip.style.background = active ? '#0e7490' : 'var(--surface2)';
        chip.style.color      = active ? '#fff' : 'var(--text)';
        chip.style.borderColor = active ? '#0e7490' : 'var(--border)';
      });
    }

    function _refreshCatTabs() {
      catsEl.querySelectorAll('button[data-cat]').forEach(btn => {
        const active = btn.dataset.cat === _selCat;
        btn.style.color          = active ? 'var(--text)' : '#a78bfa';
        btn.style.fontWeight     = active ? '700' : '400';
        btn.style.borderBottomColor = active ? '#a78bfa' : 'transparent';
      });
    }

    function _refreshGrid() {
      const gridEl = document.getElementById('wz-aws-grid');
      if (!gridEl) return;
      const country = _WZ_URL_DATA[_selCountry];
      const urls = (country?.cats?.[_selCat]) || [];

      if (!urls.length) {
        gridEl.innerHTML = `<div style="color:var(--muted);font-size:12px;padding:20px;text-align:center;font-family:sans-serif;">${t('wz_website_no_entries','No entries for this combination.')}</div>`;
        return;
      }

      gridEl.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;">` +
        urls.map(domain => {
          const full = 'https://' + domain;
          const esc = full.replace(/"/g, '&quot;');
          const domEsc = domain.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
          const dnEsc  = domain.replace(/'/g,"\\'");
          return `<div onmouseenter="this.style.borderColor='rgba(6,182,212,.5)';this.style.background='rgba(6,182,212,.07)';"
            onmouseleave="this.style.borderColor='var(--border)';this.style.background='var(--surface)';"
            style="display:flex;align-items:center;background:var(--surface);border:1px solid var(--border);
                   border-radius:8px;overflow:hidden;transition:background .1s,border-color .1s;">
            <button onclick="
                document.getElementById('wz-aws-url').value='${esc}';
                var nameEl=document.getElementById('wz-aws-name');
                if(!nameEl.dataset.edited)nameEl.value='${dnEsc}';
                document.getElementById('wz-aws-url').focus();"
              style="flex:1;text-align:left;padding:8px 10px;background:none;border:none;cursor:pointer;
                     font-size:12px;font-family:monospace;color:#06b6d4;word-break:break-all;min-width:0;"
              title="${t('wz_website_url_tooltip','Copy URL to input field')}">${domEsc}</button>
            <a href="${esc}" target="_blank" rel="noopener noreferrer"
              onclick="event.stopPropagation();"
              title="${t('wz_website_open_tooltip','Open in new tab')}"
              style="flex-shrink:0;display:flex;align-items:center;justify-content:center;
                     width:30px;height:100%;min-height:34px;border-left:1px solid var(--border);
                     color:var(--muted);text-decoration:none;font-size:13px;transition:color .1s;"
              onmouseenter="this.style.color='#06b6d4';"
              onmouseleave="this.style.color='var(--muted)';">&#8599;</a>
          </div>`;
        }).join('') + `</div>`;
    }

    _refreshCountryChips();
    _refreshCatTabs();
    _refreshGrid();

    // ── Hinzufügen-Button ──
    document.getElementById('wz-aws-add').onclick = async function() {
      const errEl = document.getElementById('wz-aws-err');
      const raw   = (document.getElementById('wz-aws-url').value || '').trim();
      if (!raw || raw === 'https://') { errEl.textContent = t('wz_website_err_url','Please enter a URL.'); errEl.style.display='block'; return; }

      const url = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
      let hostname;
      try { hostname = new URL(url).hostname; } catch { errEl.textContent = t('wz_website_err_invalid_url','Invalid URL.'); errEl.style.display='block'; return; }
      if (!hostname || hostname.indexOf('.') === -1) { errEl.textContent = t('wz_website_err_hostname','No valid hostname detected.'); errEl.style.display='block'; return; }
      errEl.style.display = 'none';

      const btn = document.getElementById('wz-aws-add');
      btn.disabled = true; btn.textContent = t('wz_website_checking','Checking\u2026');

      const loadOv  = document.getElementById('wz-loading-overlay');
      const loadTxt = document.getElementById('wz-loading-text');
      if (loadTxt) loadTxt.textContent = t('wz_website_checking','Checking\u2026') + ' ' + hostname;
      if (loadOv) loadOv.style.display = 'flex';

      let geometry = {}, serverInfo = {};
      try {
        const locR = await fetch('/api/resolve-domain-location', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ domain: url })
        });
        if (locR.ok) {
          const loc = await locR.json();
          serverInfo = loc;
          if (loc.lat && loc.lon) geometry = { type: 'Point', coordinates: [loc.lon, loc.lat] };
        } else {
          const err = await locR.json().catch(() => ({}));
          errEl.textContent = t('wz_website_err_resolve','Domain could not be resolved.') + ' ' + (err.error || '');
          errEl.style.display = 'block';
          return;
        }
      } catch(e) {
        errEl.textContent = t('wz_website_err_conn','Connection error:') + ' ' + (e.message || e);
        errEl.style.display = 'block';
        return;
      } finally {
        if (loadOv) loadOv.style.display = 'none';
        btn.disabled = false; btn.textContent = t('wz_website_add','+ Add');
      }

      const nameVal = (document.getElementById('wz-aws-name').value || '').trim() || hostname;
      const projectId = document.getElementById('hdr-wz-project')?.value || null;
      var _wzConfig = { source: 'wayback', url: url, server: serverInfo };

      // Time Focus from event dropdown
      var _evSelVal = document.getElementById('wz-aws-event')?.value;
      if (_evSelVal) {
        try {
          var _evR2 = await fetch('/api/events');
          if (_evR2.ok) {
            var _allEvts = await _evR2.json();
            var _selEv = _allEvts.find(function(e) { return e.id === parseInt(_evSelVal); });
            if (_selEv) {
              _wzConfig.time_focus = { event_id: _selEv.id, title: _selEv.title, from: _selEv.start_dt, to: _selEv.end_dt || _selEv.start_dt };
              if (_selEv.lat != null && _selEv.lon != null) {
                _wzConfig.time_focus.lat = _selEv.lat;
                _wzConfig.time_focus.lon = _selEv.lon;
                _wzConfig.time_focus.location_name = _selEv.location_name || '';
              }
            }
          }
        } catch(e) {}
      }

      try {
        const r = await fetch('/api/watchzones', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({
            name: nameVal,
            zone_type: 'website',
            geometry: geometry,
            config: _wzConfig,
            project_id: projectId ? parseInt(projectId) : null,
          })
        });
        if (r.ok) {
          const z = await r.json();
          WZ._zones.push(z);
          WZ._renderAllZones();
          modal.remove();
        }
      } catch(e) { console.error('Save website zone error:', e); }
    };

    // Focus URL input
    setTimeout(() => document.getElementById('wz-aws-url')?.focus(), 60);
  };

  function _renderWebsiteLive(data) {
    var ctx = WZ._currentCtx;
    // Map initial ausblenden (wird erst bei Traceroute sichtbar)
    if (ctx && ctx.mapRowEl) ctx.mapRowEl.style.display = "none";
    ctx.countEl.textContent =
      data.count != null ? data.count + " Snapshots" : "";
    if (WZ._liveMarkers) WZ._liveMarkers.clearLayers();

    const content = ctx.contentEl;
    const items = data.items || [];
    // Server-Info aus Zone-Config
    const zone = WZ._zones.find(z => z.id === data.zone_id);
    const server = (zone && zone.config && zone.config.server) || {};

    // Server-Info in Karten-Overlay
    const infoEl = document.getElementById('wz-map-info');
    if (infoEl) {
      if (server.ip) {
        infoEl.style.display = 'block';
        infoEl.innerHTML = `<div id="wz-map-server-info" style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:11px;line-height:1.7;box-shadow:0 2px 6px rgba(0,0,0,.25);">
          <div style="font-weight:700;color:var(--text);margin-bottom:4px;">${t('wz_website_server_location','Server Location')}</div>
          <div style="color:var(--muted);">IP: <code style="background:var(--bg);padding:1px 4px;border-radius:3px;color:var(--text);">${WZ._esc(server.ip)}</code></div>
          ${server.city    ? `<div style="color:var(--muted);">${t('wz_website_server_city','City:')} <strong style="color:var(--text);">${WZ._esc(server.city)}</strong></div>` : ''}
          ${server.country ? `<div style="color:var(--muted);">${t('wz_website_server_country','Country:')} <strong style="color:var(--text);">${WZ._esc(server.country)}</strong></div>` : ''}
          ${server.org     ? `<div style="color:var(--muted);">${WZ._esc(server.org)}</div>` : ''}
          ${server.isp     ? `<div style="color:var(--muted);">${WZ._esc(server.isp)}</div>` : ''}
        </div>`;
      } else {
        infoEl.style.display = 'none';
        infoEl.innerHTML = '';
      }
    }

    var _tf = data.time_focus || null;
    var _wbDateTo = _tf && _tf.from ? _tf.from.slice(0, 10) : new Date().toISOString().slice(0, 10);
    var _wbDateLabel = typeof fmtDateOnly === 'function' ? fmtDateOnly(_wbDateTo + "T00:00") : _wbDateTo;

    let html = '<div style="padding:8px;width:100%;box-sizing:border-box;">';

    // Time Focus badge
    if (_tf) {
      var _tfFmt = function(d) { return typeof fmtDate === 'function' ? fmtDate(d.length <= 10 ? d + "T00:00" : d) : d; };
      html += `<div style="margin-bottom:8px;padding:6px 10px;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.25);border-radius:6px;">
        <span style="font-size:12px;font-weight:700;color:#f59e0b;">Time Focus: ${WZ._esc(_tf.title || "")}</span>
        <span style="font-size:11px;color:var(--muted);margin-left:6px;">${_tfFmt(_tf.from || "")}${_tf.to && _tf.to !== _tf.from ? ' \u2013 ' + _tfFmt(_tf.to) : ''}</span>
      </div>`;
    }
    if (data.error_hint) {
      html += `<div style="margin-bottom:8px;padding:6px 10px;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.25);border-radius:6px;font-size:11px;color:#ef4444;">${WZ._esc(data.error_hint)}</div>`;
    }

    var _wbDateFrom = data.date_from ? data.date_from.slice(0,10) : new Date(new Date().getTime() - 29*86400000).toISOString().slice(0,10);
    var _wbFromLabel = typeof fmtDateOnly === 'function' ? fmtDateOnly(_wbDateFrom + 'T00:00') : _wbDateFrom;

    // Heatmap-Kalender + Balkendiagramm
    html += `<div style="background:var(--surface2);border-radius:8px;padding:14px;margin-bottom:12px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
        <h4 style="margin:0;font-size:13px;font-weight:600;">${t('wz_website_wb_calendar','Wayback Calendar')}</h4>
        <span style="font-size:12px;color:var(--text);font-weight:600;">${_wbFromLabel}</span>
        <span style="font-size:11px;color:var(--muted);">\u2013</span>
        <span style="position:relative;display:inline-block;">
          <span id="wz-wb-dp-label-${data.zone_id}"
                style="font-size:12px;padding:3px 10px;border:1px solid var(--border);border-radius:6px;
                       background:var(--surface);color:var(--text);cursor:pointer;display:inline-block;
                       user-select:none;white-space:nowrap;font-weight:600;"
                title="${t('wz_wb_pick_date','Enddatum wählen')}">${_wbDateLabel}</span>
          <input type="date" id="wz-wb-datepicker-${data.zone_id}"
                 value="${_wbDateTo}"
                 max="${new Date().toISOString().slice(0,10)}"
                 style="position:absolute;top:0;left:0;width:100%;height:100%;opacity:0;cursor:pointer;" />
        </span>
      </div>
      <div id="wz-wb-heatmap-${data.zone_id}"></div>
      <div id="wz-wb-size-wrap-${data.zone_id}" style="display:none;margin-top:14px;">
        <div style="font-size:11px;font-weight:700;color:var(--muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px;">${t('wz_website_page_size','Page Size (KB)')}</div>
        <canvas id="wz-wb-ch-size-${data.zone_id}" height="80"></canvas>
      </div>
    </div>`;

    // Snapshot-Liste mit Titeln
    html += `<div id="wz-wb-snaplist-${data.zone_id}" style="margin-top:4px;"></div>`;

    html += '</div>';
    content.innerHTML = html;
    _loadWebsiteHeatmap(data.zone_id, data.items || [], data.date_to ? data.date_to.slice(0,10) : null, data.date_from ? data.date_from.slice(0,10) : null);

    // Datepicker-Event
    const _dp = document.getElementById(`wz-wb-datepicker-${data.zone_id}`);
    const _dpLabel = document.getElementById(`wz-wb-dp-label-${data.zone_id}`);
    if (_dp) {
      _dp.addEventListener('change', () => {
        if (_dpLabel) {
          const _fd = typeof fmtDateOnly === 'function' ? fmtDateOnly : (s => s);
          _dpLabel.textContent = _fd(_dp.value);
        }
        _loadWebsiteHeatmap(data.zone_id, null, _dp.value);
      });
    }
  }

  // ── Wayback-Kalender: State + Filter-Logik ──────────────────────────────
  const _wbState = {};

  function _wbToggleDay(zoneId, date) {
    const st = _wbState[zoneId]; if (!st) return;
    if (!st.selDays) st.selDays = new Set();
    if (st.selDays.has(date)) st.selDays.delete(date); else st.selDays.add(date);
    if (st.selDays.size === 0) st.selDays = null;
    _renderWbCharts(zoneId);
  }

  function _wbToggleHour(zoneId, hour) {
    const st = _wbState[zoneId]; if (!st) return;
    if (!st.selHours) st.selHours = new Set();
    if (st.selHours.has(hour)) st.selHours.delete(hour); else st.selHours.add(hour);
    if (st.selHours.size === 0) st.selHours = null;
    _renderWbCharts(zoneId);
  }

  function _wbClearFilters(zoneId) {
    const st = _wbState[zoneId]; if (!st) return;
    st.selDays = null; st.selHours = null;
    _renderWbCharts(zoneId);
  }

  // Im IIFE-Scope definiert → global exponieren für onclick-Attribute
  window._wbToggleDay    = _wbToggleDay;
  window._wbToggleHour   = _wbToggleHour;
  window._wbClearFilters = _wbClearFilters;

  // ── Drag-Select ──────────────────────────────────────────────────────────
  let _wbActiveDrag = null;
  if (!document._wbGlobalMouseup) {
    document._wbGlobalMouseup = true;
    document.addEventListener('mouseup', () => {
      if (!_wbActiveDrag) return;
      const { zoneId, type, adding, pending } = _wbActiveDrag;
      _wbActiveDrag = null;
      const st = _wbState[zoneId];
      if (!st) return;
      const sel = type === 'day'
        ? (st.selDays  ? new Set(st.selDays)  : new Set())
        : (st.selHours ? new Set(st.selHours) : new Set());
      pending.forEach(k => { if (adding) sel.add(k); else sel.delete(k); });
      if (type === 'day') st.selDays  = sel.size ? sel : null;
      else                st.selHours = sel.size ? sel : null;
      _renderWbCharts(zoneId);
    });
  }

  function _wbAttachDragListeners(zoneId, container) {
    if (container._wbDragAttached) return;
    container._wbDragAttached = true;
    let rafPending = false;

    function applyVisual() {
      if (!_wbActiveDrag || _wbActiveDrag.zoneId !== zoneId) { rafPending = false; return; }
      const { type, adding, pending } = _wbActiveDrag;
      const st = _wbState[zoneId];
      if (!st) { rafPending = false; return; }
      const base = type === 'day'
        ? (st.selDays  ? new Set(st.selDays)  : new Set())
        : (st.selHours ? new Set(st.selHours) : new Set());
      const eff = new Set(base);
      pending.forEach(k => { if (adding) eff.add(k); else eff.delete(k); });
      const hasSel = eff.size > 0;
      if (type === 'day') {
        container.querySelectorAll('[data-wb-date]').forEach(el => {
          const isSel = eff.has(el.dataset.wbDate);
          el.style.opacity = hasSel ? (isSel ? '1' : '0.22') : '1';
          if (el.tagName && el.tagName.toLowerCase() !== 'rect') {
            el.style.border = isSel ? '2px solid rgba(6,182,212,1)' : '';
          }
        });
      } else {
        container.querySelectorAll('[data-wb-hour]').forEach(el => {
          const isSel = eff.has(parseInt(el.dataset.wbHour, 10));
          el.style.opacity = hasSel ? (isSel ? '1' : '0.18') : '1';
        });
      }
      rafPending = false;
    }
    function scheduleVisual() {
      if (!rafPending) { rafPending = true; requestAnimationFrame(applyVisual); }
    }
    function findKey(el) {
      let e = el;
      while (e && e !== container) {
        if (e.dataset) {
          if (e.dataset.wbDate) return { type: 'day', key: e.dataset.wbDate };
          if (e.dataset.wbHour !== undefined && e.dataset.wbHour !== '') return { type: 'hour', key: parseInt(e.dataset.wbHour, 10) };
        }
        e = e.parentElement;
      }
      return null;
    }
    container.addEventListener('mousedown', e => {
      const info = findKey(e.target);
      if (!info) return;
      e.preventDefault();
      const st = _wbState[zoneId];
      if (!st) return;
      const sel = info.type === 'day' ? st.selDays : st.selHours;
      const selSet = sel ? new Set(sel) : new Set();
      const adding = !selSet.has(info.key);
      _wbActiveDrag = { zoneId, type: info.type, adding, pending: new Set([info.key]) };
      scheduleVisual();
    });
    container.addEventListener('mouseover', e => {
      if (!_wbActiveDrag || _wbActiveDrag.zoneId !== zoneId) return;
      const info = findKey(e.target);
      if (!info || info.type !== _wbActiveDrag.type || _wbActiveDrag.pending.has(info.key)) return;
      _wbActiveDrag.pending.add(info.key);
      scheduleVisual();
    });
  }

  function _renderWbCharts(zoneId) {
    const container = document.getElementById(`wz-wb-heatmap-${zoneId}`);
    if (!container) return;
    const _fd  = typeof fmtDateOnly === 'function' ? fmtDateOnly : (s => s);
    const _fdt = typeof fmtDate === 'function' ? fmtDate : (s => s);
    const { days, allItems, selDays, selHours } = _wbState[zoneId];
    const hasDaySel = !!(selDays && selDays.size);
    const hasHourSel = !!(selHours && selHours.size);

    // Gefilterte Daten für jede Achse
    // byHour: gefiltert nach Stunden → genutzt von Heatmap + Tagesbalken
    // byDay:  gefiltert nach Tagen  → genutzt von Stundenbalken
    const byHour = hasHourSel ? allItems.filter(i => selHours.has(i.hour)) : allItems;
    const byDay  = hasDaySel  ? allItems.filter(i => selDays.has(i.date))  : allItems;
    const byBoth = allItems.filter(i =>
      (!hasDaySel  || selDays.has(i.date)) &&
      (!hasHourSel || selHours.has(i.hour))
    );

    // dayMap (nach Stunden gefiltert)
    const dayMapFH = {};
    byHour.forEach(i => { if (!dayMapFH[i.date]) dayMapFH[i.date] = []; dayMapFH[i.date].push(i); });

    // hourCounts (nach Tagen gefiltert)
    const hourCntsFD = new Array(24).fill(0);
    byDay.forEach(i => { if (i.hour >= 0 && i.hour < 24) hourCntsFD[i.hour]++; });

    const totalChanges = byBoth.length;
    const activeDays = new Set(byBoth.map(i => i.date)).size;
    const maxDayCount = Math.max(1, ...days.map(d => (dayMapFH[d.date] || []).length));
    const maxHourCount = Math.max(1, ...hourCntsFD);

    // Heatmap-Wochen aufbauen
    const firstDow = days[0].dow;
    const padded = [];
    for (let i = 0; i < firstDow; i++) padded.push(null);
    days.forEach(d => padded.push(d));
    while (padded.length % 7 !== 0) padded.push(null);
    const weeks = [];
    for (let c = 0; c < padded.length / 7; c++) weeks.push(padded.slice(c * 7, c * 7 + 7));

    const DAY_LABELS = t('wz_wb_day_labels','Mo,Tu,We,Th,Fr,Sa,Su').split(',');
    const CELL = 22, GAP = 4;
    const HMAP_H = (CELL + GAP) + 7 * CELL + 6 * GAP; // matches heatmap grid height

    // ── Heatmap ─────────────────────────────────────────────────────────────
    let heatmapHtml = `<div style="display:flex;gap:${GAP}px;align-items:flex-start;">`;
    heatmapHtml += `<div style="display:flex;flex-direction:column;gap:${GAP}px;margin-top:${CELL + GAP}px;">`;
    DAY_LABELS.forEach(l => {
      heatmapHtml += `<div style="height:${CELL}px;line-height:${CELL}px;font-size:10px;color:var(--muted);width:20px;text-align:right;padding-right:4px;">${l}</div>`;
    });
    heatmapHtml += `</div><div style="display:flex;flex-direction:column;gap:0;">`;
    let lastMonth = '';
    heatmapHtml += `<div style="display:flex;gap:${GAP}px;height:${CELL}px;align-items:center;margin-bottom:${GAP}px;">`;
    weeks.forEach(week => {
      const fr = week.find(d => d !== null);
      let lbl = '';
      if (fr) { const m = new Date(fr.date).toLocaleDateString('de-DE', {month:'short'}); if (m !== lastMonth) { lbl = m; lastMonth = m; } }
      heatmapHtml += `<div style="width:${CELL}px;font-size:10px;color:var(--muted);overflow:hidden;white-space:nowrap;">${lbl}</div>`;
    });
    heatmapHtml += `</div><div style="display:flex;gap:${GAP}px;">`;
    weeks.forEach(week => {
      heatmapHtml += `<div style="display:flex;flex-direction:column;gap:${GAP}px;">`;
      week.forEach(cell => {
        if (!cell) {
          heatmapHtml += `<div style="width:${CELL}px;height:${CELL}px;"></div>`;
        } else {
          const cnt = (dayMapFH[cell.date] || []).length;
          const isSel = hasDaySel && selDays.has(cell.date);
          const _isTfDay = _tf2 && _tf2.from && cell.date === _tf2.from.slice(0,10);
          const opacity = hasDaySel ? (isSel ? 1 : 0.22) : 1;
          const baseAlpha = cnt === 0 ? 0.07 : (0.25 + 0.75 * (cnt / maxDayCount));
          const bg = _isTfDay ? `rgba(245,158,11,${Math.max(0.3,baseAlpha).toFixed(2)})` : `rgba(6,182,212,${baseAlpha.toFixed(2)})`;
          const border = _isTfDay ? '2px solid #f59e0b' : (isSel ? '2px solid rgba(6,182,212,1)' : (cnt > 0 ? '1px solid rgba(6,182,212,0.5)' : '1px solid rgba(6,182,212,0.12)'));
          const title = `${_fd(cell.date)}${cnt > 0 ? ' \u2013 ' + cnt + ' Snapshot' + (cnt > 1 ? 's' : '') : ' \u2013 ' + t('wz_wb_no_snapshots','no snapshots')}`;
          heatmapHtml += `<div data-wb-date="${cell.date}" title="${WZ._esc(title)}" style="width:${CELL}px;height:${CELL}px;border-radius:3px;background:${bg};border:${border};cursor:pointer;box-sizing:border-box;opacity:${opacity};transition:opacity .12s,border .12s;"></div>`;
        }
      });
      heatmapHtml += `</div>`;
    });
    heatmapHtml += `</div></div></div>`;

    // Legende
    const legendHtml = `<div style="display:flex;align-items:center;gap:5px;margin-top:10px;font-size:11px;color:var(--muted);flex-wrap:wrap;">
      <span>${t('wz_wb_legend_less','Less')}</span>
      <div style="width:13px;height:13px;border-radius:2px;background:rgba(6,182,212,0.07);border:1px solid rgba(6,182,212,0.12);"></div>
      <div style="width:13px;height:13px;border-radius:2px;background:rgba(6,182,212,0.30);border:1px solid rgba(6,182,212,0.4);"></div>
      <div style="width:13px;height:13px;border-radius:2px;background:rgba(6,182,212,0.55);border:1px solid rgba(6,182,212,0.5);"></div>
      <div style="width:13px;height:13px;border-radius:2px;background:rgba(6,182,212,0.78);border:1px solid rgba(6,182,212,0.5);"></div>
      <div style="width:13px;height:13px;border-radius:2px;background:rgba(6,182,212,1.00);border:1px solid rgba(6,182,212,0.6);"></div>
      <span>${t('wz_wb_legend_more','More')}</span>
    </div>`;

    // ── Tagesbalken-SVG ──────────────────────────────────────────────────────
    const svgW = 600, svgH = HMAP_H, mt = 8, mr = 8, mb = 28, ml = 26;
    const chartW = svgW - ml - mr, chartH = svgH - mt - mb;
    const barSlot = chartW / Math.max(days.length, 1), barW = Math.max(2, barSlot - 1.5);
    const yTicks = maxDayCount <= 1 ? [0,1] : [0, Math.round(maxDayCount/2), maxDayCount];

    let svgHtml = `<svg viewBox="0 0 ${svgW} ${svgH}" preserveAspectRatio="none" style="width:100%;height:${HMAP_H}px;display:block;" xmlns="http://www.w3.org/2000/svg">`;
    yTicks.forEach(val => {
      const y = mt + chartH - (val / maxDayCount) * chartH;
      svgHtml += `<line x1="${ml}" y1="${y.toFixed(1)}" x2="${ml+chartW}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>`;
      svgHtml += `<text x="${(ml-3).toFixed(1)}" y="${(y+3).toFixed(1)}" text-anchor="end" font-size="9" fill="rgba(255,255,255,0.35)">${val}</text>`;
    });
    days.forEach((day, i) => {
      const cnt = (dayMapFH[day.date] || []).length;
      const x = ml + i * barSlot + (barSlot - barW) / 2;
      const bh = cnt > 0 ? Math.max(2, (cnt / maxDayCount) * chartH) : 1;
      const y = mt + chartH - bh;
      const isSel = hasDaySel && selDays.has(day.date);
      const opacity = hasDaySel ? (isSel ? 1 : 0.18) : 1;
      const alpha = cnt > 0 ? (0.30 + 0.70 * (cnt / maxDayCount)).toFixed(2) : '0.08';
      const stroke = isSel ? ` stroke="rgba(6,182,212,1)" stroke-width="1.5"` : '';
      const title = `${_fd(day.date)}: ${cnt} Snapshot${cnt !== 1 ? 's' : ''}`;
      svgHtml += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="1.5" fill="rgba(6,182,212,${alpha})" opacity="${opacity}" style="cursor:pointer;" data-wb-date="${day.date}"${stroke}><title>${WZ._esc(title)}</title></rect>`;
      var _labelStep = Math.max(1, Math.floor(days.length / 6));
      if (i % _labelStep === 0 || i === days.length - 1) {
        const [,mm,dd] = day.date.split('-');
        svgHtml += `<text x="${(ml+i*barSlot+barSlot/2).toFixed(1)}" y="${(svgH-mb+13).toFixed(1)}" text-anchor="middle" font-size="9" fill="rgba(255,255,255,0.35)">${dd}.${mm}.</text>`;
      }
    });
    // Time Focus marker on day bar chart
    var _z2 = WZ._zones.find(function(zz){return zz.id===zoneId;});
    var _tf2 = _z2&&_z2.config&&_z2.config.time_focus?_z2.config.time_focus:null;
    if(!_tf2&&_z2&&_z2.project_id){var _gz2=WZ._zones.filter(function(g){return g.zone_type==="global"&&g.project_id===_z2.project_id;});for(var _gi2=0;_gi2<_gz2.length;_gi2++){if(_gz2[_gi2].config&&_gz2[_gi2].config.time_focus){_tf2=_gz2[_gi2].config.time_focus;break;}}}
    if(_tf2&&_tf2.from){
      var _tfDateStr=_tf2.from.slice(0,10);
      var _tfIdx=days.findIndex(function(d){return d.date===_tfDateStr;});
      if(_tfIdx>=0){
        var _tfX2=ml+_tfIdx*barSlot+barSlot/2;
        svgHtml+=`<line x1="${_tfX2.toFixed(1)}" y1="${mt}" x2="${_tfX2.toFixed(1)}" y2="${(mt+chartH).toFixed(1)}" stroke="#f59e0b" stroke-width="2" stroke-dasharray="4,3" opacity="0.8"/>`;
        svgHtml+=`<text x="${_tfX2.toFixed(1)}" y="${(mt-3).toFixed(1)}" text-anchor="middle" font-size="8" font-weight="700" fill="#f59e0b">${WZ._esc(_tf2.title||"")}</text>`;
      }
    }
    svgHtml += `<line x1="${ml}" y1="${(mt+chartH).toFixed(1)}" x2="${ml+chartW}" y2="${(mt+chartH).toFixed(1)}" stroke="rgba(255,255,255,0.15)" stroke-width="1"/></svg>`;

    // ── Stundenbalken-SVG ────────────────────────────────────────────────────
    const hsvgW = 400, hsvgH = HMAP_H, hmt = 8, hmr = 8, hmb = 28, hml = 26;
    const hchartW = hsvgW - hml - hmr, hchartH = hsvgH - hmt - hmb;
    const hBarSlot = hchartW / 24, hBarW = Math.max(2, hBarSlot - 1);
    const hYTicks = maxHourCount <= 1 ? [0,1] : [0, Math.round(maxHourCount/2), maxHourCount];

    let tsvg = `<svg viewBox="0 0 ${hsvgW} ${hsvgH}" style="width:100%;height:${HMAP_H}px;display:block;" xmlns="http://www.w3.org/2000/svg">`;
    hYTicks.forEach(val => {
      const y = hmt + hchartH - (val / maxHourCount) * hchartH;
      tsvg += `<line x1="${hml}" y1="${y.toFixed(1)}" x2="${hml+hchartW}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>`;
      tsvg += `<text x="${(hml-3).toFixed(1)}" y="${(y+3).toFixed(1)}" text-anchor="end" font-size="9" fill="rgba(255,255,255,0.35)">${val}</text>`;
    });
    hourCntsFD.forEach((cnt, h) => {
      const x = hml + h * hBarSlot + (hBarSlot - hBarW) / 2;
      const bh = cnt > 0 ? Math.max(2, (cnt / maxHourCount) * hchartH) : 1;
      const y = hmt + hchartH - bh;
      const isSel = hasHourSel && selHours.has(h);
      const opacity = hasHourSel ? (isSel ? 1 : 0.18) : 1;
      const alpha = cnt > 0 ? (0.25 + 0.75 * (cnt / maxHourCount)).toFixed(2) : '0.07';
      const stroke = isSel ? ` stroke="rgba(6,182,212,1)" stroke-width="1.5"` : '';
      const title = `${String(h).padStart(2,'0')}:00 – ${cnt} Snapshot${cnt !== 1 ? 's' : ''}`;
      tsvg += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${hBarW.toFixed(1)}" height="${bh.toFixed(1)}" rx="1.5" fill="rgba(6,182,212,${alpha})" opacity="${opacity}" style="cursor:pointer;" data-wb-hour="${h}"${stroke}><title>${WZ._esc(title)}</title></rect>`;
      if (h % 4 === 0) {
        tsvg += `<text x="${(hml+h*hBarSlot+hBarSlot/2).toFixed(1)}" y="${(hsvgH-hmb+13).toFixed(1)}" text-anchor="middle" font-size="9" fill="rgba(255,255,255,0.35)">${String(h).padStart(2,'0')}h</text>`;
      }
    });
    tsvg += `<line x1="${hml}" y1="${(hmt+hchartH).toFixed(1)}" x2="${hml+hchartW}" y2="${(hmt+hchartH).toFixed(1)}" stroke="rgba(255,255,255,0.15)" stroke-width="1"/></svg>`;

    // ── Zusammenbauen ────────────────────────────────────────────────────────
    const selBadge = (hasDaySel || hasHourSel)
      ? ` <span style="color:#a78bfa;">(${t('wz_wb_filtered','filtered')})</span>` : '';
    const resetBtn = (hasDaySel || hasHourSel)
      ? `<button onclick="_wbClearFilters(${zoneId})" style="background:none;border:1px solid rgba(167,139,250,0.4);border-radius:6px;color:#a78bfa;padding:3px 10px;font-size:11px;font-weight:500;cursor:pointer;white-space:nowrap;">${t('wz_wb_reset_filter','\u2715 Reset Filter')}</button>`
      : '';
    // Summary in der Titelzeile der Outer-Box verankern
    if (container.parentElement) container.parentElement.style.position = 'relative';
    container.innerHTML = `
      <div style="position:absolute;top:14px;right:14px;display:flex;align-items:center;gap:8px;font-size:11px;color:#a78bfa;font-weight:400;">
        ${totalChanges} ${t('wz_wb_changes_on','changes on')} ${activeDays} ${t('wz_wb_days_in_period','Tagen in ' + days.length + ' Tagen')}${selBadge}
        ${resetBtn}
      </div>
      <div style="display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap;user-select:none;">
        <div style="flex-shrink:0;">
          ${heatmapHtml}
          ${legendHtml}
        </div>
        <div style="flex:2;min-width:300px;">
          <div style="font-size:11px;color:var(--muted);font-weight:600;margin-bottom:6px;padding-left:${(ml/svgW*100).toFixed(1)}%;">${t('wz_wb_per_day','Changes per Day')}</div>
          ${svgHtml}
        </div>
        <div style="flex:1;min-width:250px;">
          <div style="font-size:11px;color:var(--muted);font-weight:600;margin-bottom:6px;padding-left:${(hml/hsvgW*100).toFixed(1)}%;">${t('wz_wb_by_hour','Changes by Hour')}</div>
          ${tsvg}
        </div>
      </div>`;
    _wbAttachDragListeners(zoneId, container);

    // ── Snapshot-Liste mit Titeln ────────────────────────────────────────────
    const snapListEl = document.getElementById(`wz-wb-snaplist-${zoneId}`);
    if (snapListEl) {
      const listItems = [...byBoth].reverse(); // neueste zuerst
      const showAll = listItems.length <= 20 || !!(_wbState[zoneId] && _wbState[zoneId].snapShowAll);
      const visible = showAll ? listItems : listItems.slice(0, 20);

      if (!listItems.length) {
        snapListEl.innerHTML = '';
      } else {
        // Titeländerungen erkennen (in chronologischer Reihenfolge = byBoth)
        // byBoth ist aufsteigend, listItems ist absteigend → wir brauchen prev aus byBoth
        const titleMap = new Map(); // timestamp → {title_changed, prev_title}
        let pTitle = null;
        for (const it of byBoth) {
          const t = it.title || '';
          const changed = pTitle !== null && t !== pTitle && (t || pTitle);
          titleMap.set(it.timestamp || it.wayback_url, { title_changed: changed, prev_title: pTitle });
          pTitle = t;
        }

        const fmtBytes = b => {
          if (b == null) return '';
          if (Math.abs(b) < 1024) return b + ' B';
          if (Math.abs(b) < 1024*1024) return (b/1024).toFixed(1) + ' KB';
          return (b/1024/1024).toFixed(2) + ' MB';
        };
        const fmtDelta = d => {
          if (d == null) return '';
          const s = fmtBytes(Math.abs(d));
          return d >= 0 ? `<span style="color:#4ade80;">+${s}</span>` : `<span style="color:#f87171;">\u2212${s}</span>`;
        };

        let rows = visible.map(it => {
          const key = it.timestamp || it.wayback_url;
          const meta = titleMap.get(key) || {};
          const titleChanged = it.title_changed ?? meta.title_changed;
          const prevTitle    = it.prev_title   ?? meta.prev_title;
          const title = it.title || '';
          const time  = it.time  || (it.timestamp ? it.timestamp.slice(8,10)+':'+it.timestamp.slice(10,12) : '');
          const sizeStr = it.length != null ? fmtBytes(it.length) : '';
          const deltaStr = it.size_delta != null ? (it.size_delta >= 0 ? '+' : '\u2212') + fmtBytes(Math.abs(it.size_delta)) : '';
          const deltaColor = it.size_delta != null ? (it.size_delta >= 0 ? '#4ade80' : '#f87171') : 'var(--muted)';
          const titleBadge = titleChanged
            ? `<span style="background:rgba(251,191,36,.2);border:1px solid rgba(251,191,36,.5);color:#fbbf24;font-size:9px;font-weight:700;padding:1px 4px;border-radius:3px;">Title &#8635;</span> `
            : '';
          const tsAttr = (it.timestamp || '').replace(/"/g, '');
          return `<div onclick="_wbOpenSnapByTs(${zoneId},'${tsAttr}')"
            onmouseenter="this.style.background='rgba(6,182,212,0.08)';this.style.borderColor='rgba(6,182,212,0.4)';"
            onmouseleave="this.style.background='';this.style.borderColor='var(--border)';"
            style="border:1px solid var(--border);border-radius:7px;padding:9px 10px;cursor:pointer;
                   display:flex;flex-direction:column;gap:4px;transition:background .12s,border-color .12s;">
            <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;">
              <span style="font-size:11px;font-weight:700;color:var(--text);white-space:nowrap;">${WZ._esc(_fd(it.date))}</span>
              ${time ? `<span style="font-size:10px;color:var(--muted);white-space:nowrap;">${WZ._esc(time)}</span>` : ''}
              ${titleBadge}
            </div>
            ${title ? `<div style="font-size:11px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.35;">${WZ._esc(title)}</div>` : ''}
            <div style="display:flex;align-items:center;gap:6px;margin-top:2px;">
              ${sizeStr ? `<span style="font-size:10px;color:var(--muted);">${WZ._esc(sizeStr)}</span>` : ''}
              ${deltaStr ? `<span style="font-size:10px;color:${deltaColor};">${WZ._esc(deltaStr)}</span>` : ''}
            </div>
          </div>`;
        }).join('');

        const moreBtn = !showAll
          ? `<div style="padding:8px 10px;text-align:center;">
               <button onclick="_wbShowAllSnaps(${zoneId})"
                 style="background:none;border:1px solid var(--border);border-radius:6px;color:var(--muted);padding:4px 14px;font-size:11px;cursor:pointer;">
                 + ${listItems.length - 20} ${t('wz_wb_show_more_snaps','more snapshots')}
               </button>
             </div>` : '';

        snapListEl.innerHTML = `
          <div style="background:var(--surface2);border-radius:8px;overflow:hidden;">
            <div style="padding:10px 12px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px;">
              <span style="font-size:13px;font-weight:600;">${t('wz_wb_snapshots','Snapshots')}</span>
              <span style="font-size:11px;color:var(--muted);">${listItems.length} ${t('wz_wb_entries','entries')}${hasDaySel || hasHourSel ? ' (' + t('wz_wb_filtered','filtered') + ')' : ''}</span>
            </div>
            <div id="wz-wb-snaprows-${zoneId}"
                 style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:10px;">${rows}</div>
            ${moreBtn}
          </div>`;
      }
    }

  }

  function _renderWbSizeChart(zoneId) {
    const st = _wbState[zoneId];
    if (!st) return;
    const _fdt = typeof fmtDate === 'function' ? fmtDate : (s => s);
    const sizeWrap   = document.getElementById(`wz-wb-size-wrap-${zoneId}`);
    const sizeCanvas = document.getElementById(`wz-wb-ch-size-${zoneId}`);
    if (!sizeWrap || !sizeCanvas) return;
    if (st._sizeChart) { st._sizeChart.destroy(); st._sizeChart = null; }

    const allItems = st.allItems || [];
    const sizeItems = [...allItems]
      .sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''))
      .filter(it => it.length != null);
    if (!sizeItems.length) { sizeWrap.style.display = 'none'; return; }

    sizeWrap.style.display = 'block';
    const tickStyle = { color: 'rgba(148,163,184,.7)', font: { size: 10 } };
    const pageUrl = sizeItems.find(it => it.url)?.url || '';

    // Vertikale Hover-Linie + Time Focus marker
    var _z3 = WZ._zones.find(function(zz){return zz.id===zoneId;});
    var _tf3 = _z3&&_z3.config&&_z3.config.time_focus?_z3.config.time_focus:null;
    if(!_tf3&&_z3&&_z3.project_id){var _gz3=WZ._zones.filter(function(g){return g.zone_type==="global"&&g.project_id===_z3.project_id;});for(var _gi3=0;_gi3<_gz3.length;_gi3++){if(_gz3[_gi3].config&&_gz3[_gi3].config.time_focus){_tf3=_gz3[_gi3].config.time_focus;break;}}}
    var _tfDateStr3 = _tf3 && _tf3.from ? _tf3.from.slice(0,10) : null;

    const vertLinePlugin = {
      id: 'wbVertLine',
      afterDraw(chart) {
        const { ctx, chartArea } = chart;
        // Hover line
        if (chart._hoverIdx != null) {
          const meta = chart.getDatasetMeta(0);
          const pt = meta.data[chart._hoverIdx];
          if (pt) {
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(pt.x, chartArea.top);
            ctx.lineTo(pt.x, chartArea.bottom);
            ctx.strokeStyle = 'rgba(139,92,246,0.7)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 3]);
            ctx.stroke();
            ctx.restore();
          }
        }
        // Time Focus marker
        if (_tfDateStr3 && sizeItems.length) {
          var tfIdx = sizeItems.findIndex(function(it) { return it.date === _tfDateStr3; });
          if (tfIdx < 0) {
            // Find nearest date
            for (var _si = 0; _si < sizeItems.length; _si++) {
              if (sizeItems[_si].date >= _tfDateStr3) { tfIdx = _si; break; }
            }
          }
          if (tfIdx >= 0) {
            var meta2 = chart.getDatasetMeta(0);
            var pt2 = meta2.data[tfIdx];
            if (pt2) {
              ctx.save();
              ctx.beginPath();
              ctx.moveTo(pt2.x, chartArea.top);
              ctx.lineTo(pt2.x, chartArea.bottom);
              var _tfC = (_tf3 && _tf3.color) || '#f59e0b';
              ctx.strokeStyle = _tfC;
              ctx.lineWidth = 2;
              ctx.setLineDash([4, 3]);
              ctx.stroke();
              // Label
              ctx.fillStyle = _tfC;
              ctx.font = 'bold 9px system-ui';
              ctx.textAlign = 'center';
              ctx.fillText(_tf3.title || 'Focus', pt2.x, chartArea.top - 4);
              ctx.restore();
            }
          }
        }
      },
    };

    st._sizeChart = new Chart(sizeCanvas, {
      type: 'line',
      data: {
        labels: sizeItems.map(it => _fdt(it.date + (it.time ? 'T' + it.time : ''))),
        datasets: [{ data: sizeItems.map(it => +(it.length / 1024).toFixed(1)),
          borderColor: '#8b5cf6', backgroundColor: '#8b5cf618',
          borderWidth: 2, fill: true, tension: 0.3,
          pointRadius: 4, pointBackgroundColor: '#8b5cf6',
          pointHoverRadius: 7, pointHoverBackgroundColor: '#c4b5fd' }],
      },
      plugins: [vertLinePlugin],
      options: { responsive: true,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: true,
            callbacks: {
              footer: () => '\uD83D\uDDB1 Click to compare versions',
            },
            footerColor: '#06b6d4',
            footerFont: { size: 10, style: 'italic' },
          },
        },
        onHover(e, els, chart) {
          chart.canvas.style.cursor = els.length ? 'pointer' : 'default';
          const idx = els.length ? els[0].index : null;
          if (chart._hoverIdx !== idx) { chart._hoverIdx = idx; chart.draw(); }
        },
        scales: {
          x: { ticks: { ...tickStyle, maxRotation: 45 } },
          y: { ticks: { ...tickStyle, callback: v => v + ' KB' } },
        },
        onClick(e, els) {
          if (!els.length) return;
          const snap = sizeItems[els[0].index];
          if (!snap) return;
          const sorted = [...allItems].sort((a, b) => (a.timestamp||'').localeCompare(b.timestamp||''));
          const idx = sorted.findIndex(it => it.timestamp === snap.timestamp);
          _wbOpenDiff(zoneId, snap, sorted[idx - 1] || null, sorted[idx + 1] || null, pageUrl);
        },
      },
    });
  }

  window._wbShowAllSnaps = function(zoneId) {
    const st = _wbState[zoneId]; if (!st) return;
    st.snapShowAll = true;
    _renderWbCharts(zoneId);
  };

  window._wbOpenSnapByTs = function(zoneId, ts) {
    const st = _wbState[zoneId]; if (!st || !st.allItems) return;
    const sorted = [...st.allItems].sort((a, b) => (a.timestamp||'').localeCompare(b.timestamp||''));
    const idx = sorted.findIndex(it => it.timestamp === ts);
    if (idx < 0) return;
    const snap = sorted[idx];
    const pageUrl = snap.url || sorted.find(it => it.url)?.url || '';
    _wbOpenDiff(zoneId, snap, sorted[idx - 1] || null, sorted[idx + 1] || null, pageUrl);
  };



  function _wbExtractHour(item) {
    // Stunde aus timestamp-Feld oder als Fallback aus wayback_url
    if (item.timestamp && item.timestamp.length >= 10) {
      return parseInt(item.timestamp.slice(8, 10), 10);
    }
    const m = item.wayback_url && item.wayback_url.match(/\/web\/(\d{14})\//);
    return m ? parseInt(m[1].slice(8, 10), 10) : -1;
  }

  async function _loadWebsiteHeatmap(zoneId, liveItems, endDate, startDate) {
    const container = document.getElementById(`wz-wb-heatmap-${zoneId}`);
    if (!container) return;
    if (!document.getElementById('wz-spin-style')) {
      const s = document.createElement('style');
      s.id = 'wz-spin-style';
      s.textContent = '@keyframes wz-spin{to{transform:rotate(360deg)}}';
      document.head.appendChild(s);
    }

    const today = endDate ? new Date(endDate + 'T12:00:00') : new Date();
    const todayStr = today.toISOString().slice(0, 10);
    var dateFrom;
    if (startDate) {
      dateFrom = startDate;
    } else {
      const d30 = new Date(today); d30.setDate(d30.getDate() - 29);
      dateFrom = d30.toISOString().slice(0, 10);
    }

    // Range-Label aktualisieren
    const rangeLabel = document.getElementById(`wz-wb-range-label-${zoneId}`);
    if (rangeLabel) {
      const _fd = typeof fmtDateOnly === 'function' ? fmtDateOnly : (s => s);
      rangeLabel.textContent = `${_fd(dateFrom)} \u2013 ${_fd(todayStr)}`;
    }

    // Day array from dateFrom to todayStr
    const _dfrom = new Date(dateFrom + 'T12:00:00');
    const _dto = new Date(todayStr + 'T12:00:00');
    const _totalDays = Math.round((_dto - _dfrom) / 86400000) + 1;
    const days = [];
    for (let i = 0; i < _totalDays; i++) {
      const d = new Date(_dfrom); d.setDate(d.getDate() + i);
      const ds = d.toISOString().slice(0, 10);
      days.push({ date: ds, dow: (d.getDay() + 6) % 7 });
    }
    const daySet = new Set(days.map(d => d.date));

    // Großer zentrierter Spinner – Charts erst nach dem Laden zeigen
    container.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px 20px;gap:14px;">
        <div style="width:36px;height:36px;border:3px solid var(--border);border-top-color:#06b6d4;border-radius:50%;animation:wz-spin 0.75s linear infinite;"></div>
        <div style="font-size:13px;color:var(--muted);">Loading Wayback data \u2026</div>
      </div>`;

    // History-Daten – bei benutzerdefiniertem Datum immer frisch laden
    let allItems;
    try {
      const fetchPromise = endDate
        ? fetch(`/api/watchzones/${zoneId}/website-history?from=${dateFrom}&to=${todayStr}`)
            .then(r => r.ok ? r.json() : null).catch(() => null)
        : (WZ._wzWebsiteHistPromise ||
            fetch(`/api/watchzones/${zoneId}/website-history?from=${dateFrom}&to=${todayStr}`)
              .then(r => r.ok ? r.json() : null).catch(() => null));
      const resp = await fetchPromise;
      if (!endDate) WZ._wzWebsiteHistPromise = null;
      if (resp) {
        const histItems = (resp.data || []).map(i => ({ ...i, hour: _wbExtractHour(i) }));
        if (histItems.length > 0) { allItems = histItems; }
      }
    } catch(_) { if (!endDate) WZ._wzWebsiteHistPromise = null; }

    // Fallback auf Live-Daten wenn History leer oder fehlgeschlagen
    if (!allItems) {
      allItems = (liveItems || [])
        .filter(i => daySet.has(i.date))
        .map(i => ({ ...i, hour: _wbExtractHour(i) }));
    }

    _wbState[zoneId] = { days, allItems, selDays: null, selHours: null };
    document.getElementById("wz-live-count").textContent = allItems.length ? allItems.length + " Snapshots" : "";
    // Spinner ausblenden, Box einblenden
    const _sp = document.getElementById("wz-live-spinner");
    const _bx = document.getElementById("wz-live-box");
    if (_sp) _sp.style.display = "none";
    if (_bx) _bx.style.display = "flex";
    _renderWbCharts(zoneId);
    _renderWbSizeChart(zoneId);
  }

  WZ.registerPlugin('website', {
    renderer: _renderWebsiteLive,
    has_map: false,
    has_live_map: true,
    mix_global_zones: false,
    default_source: "wayback",
    open_button_label: "History",
    open_button_i18n: "wz_btn_history",
    live_title_prefix: "Wayback:",
    live_title_i18n: "wz_live_prefix_wayback",
    live_box_max_width: "1200px",
    openStrategy: "spinner",
    skip_loading_indicator: true,
    marker_color: "var(--accent3)",
    zone_badge: function(z) {
      if (z.config && z.config.url) {
        return '<span class="wz-zone-meta" style="color:#06b6d4;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' +
          WZ._esc(z.config.url) + '">' + WZ._esc(z.config.url) + '</span>';
      }
      return "";
    },
    extra_buttons: function(z) {
      return '<button title="' + t('wz_tt_server','Server analysis (traceroute)') + '" onclick="wzOpenTraceroute(' + z.id + ')"' +
        ' style="background:var(--accent3);color:#fff;border-radius:6px;padding:4px 14px;font-size:12px;font-weight:600;">' +
        t('wz_btn_server','Server (Live)') + '</button>';
    },
  });

  // Collect Renderer
  WZ._collectRenderers["website"] = {
    renderHTML: function(data, cardId) {
      var h = "", fmtD = WZ._fmtDate || function(s) { return s ? String(s).slice(0,10) : ""; };
      if (data.url) h += '<div style="font-size:11px;color:#06b6d4;margin-bottom:6px;word-break:break-all;">' + WZ._esc(data.url) + '</div>';
      if (data.items && data.items.length) {
        h += '<div style="position:relative;height:150px;margin-bottom:10px;"><canvas id="' + cardId + '-ws-chart"></canvas></div>';
        h += '<div style="display:flex;gap:14px;margin-bottom:8px;">';
        h += '<div style="text-align:center;"><div style="font-size:20px;font-weight:800;color:var(--text);">' + data.items.length + '</div><div style="font-size:9px;color:var(--muted);">Snapshots</div></div>';
        var _validLens = data.items.filter(function(it) { return it.length > 0; });
        var totalKb = _validLens.length ? (_validLens.reduce(function(s,it) { return s + it.length; }, 0) / _validLens.length) / 1024 : 0;
        h += '<div style="text-align:center;"><div style="font-size:20px;font-weight:800;color:var(--text);">' + Math.round(totalKb) + ' KB</div><div style="font-size:9px;color:var(--muted);">\u00d8 Gr\u00f6\u00dfe</div></div>';
        h += '</div>';
      } else {
        if (data.error_hint) {
          h += '<div style="padding:6px 10px;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);border-radius:6px;font-size:11px;color:#ef4444;">\u26a0 ' + WZ._esc(data.error_hint) + '</div>';
        } else {
          h += '<div style="font-size:11px;color:var(--muted);">Keine Snapshots gefunden.</div>';
        }
      }
      return h;
    },
    afterRender: function(data, cardId) {
      if (!window.Chart || !data.items || !data.items.length) return;
      var canvas = document.getElementById(cardId + "-ws-chart");
      if (!canvas) return;
      var fmtD = WZ._fmtDate || function(s) { return s ? String(s).slice(0,10) : ""; };
      // Group by day: count + avg size
      var byDay = {};
      data.items.forEach(function(it) {
        var d = it.date || "";
        if (!d && it.timestamp) d = it.timestamp.slice(0,4) + "-" + it.timestamp.slice(4,6) + "-" + it.timestamp.slice(6,8);
        if (!d) return;
        if (!byDay[d]) byDay[d] = { count: 0, totalLen: 0 };
        byDay[d].count++;
        byDay[d].totalLen += (it.length || 0);
      });
      var labels = Object.keys(byDay).sort();
      var counts = labels.map(function(d) { return byDay[d].count; });
      var sizes = labels.map(function(d) { return Math.round(byDay[d].totalLen / byDay[d].count / 1024 * 10) / 10; });
      // Focus time
      var plugins = [];
      var tf = data.time_focus;
      if (tf && tf.from) {
        var tfFrom = tf.from.slice(0,10), tfTo = (tf.to || tf.from).slice(0,10);
        plugins.push({ id: 'wsFocus', afterDraw: function(chart) {
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
      new Chart(canvas.getContext("2d"), {
        type: "bar", data: { labels: labels.map(function(d){return fmtD(d);}), datasets: [
          { label: "Snapshots", data: counts, backgroundColor: "rgba(6,182,212,.4)", borderColor: "#06b6d4", borderWidth: 1, yAxisID: "yCount" },
          { label: "Gr\u00f6\u00dfe (KB)", data: sizes, type: "line", borderColor: "#f59e0b", borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.3, yAxisID: "ySize" },
        ]}, plugins: plugins,
        options: { responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: true, position: "bottom", labels: { font: { size: 8 }, boxWidth: 8, padding: 4 } } },
          scales: { x: { ticks: { font: { size: 8 }, color: "#888", maxTicksLimit: 8 }, grid: { display: false } },
            yCount: { position: "left", ticks: { font: { size: 8 }, color: "#06b6d4", stepSize: 1 }, grid: { color: "rgba(100,100,100,.1)" }, title: { display: true, text: "Snapshots", color: "#06b6d4", font: { size: 9 } } },
            ySize: { position: "right", ticks: { font: { size: 8 }, color: "#f59e0b" }, grid: { drawOnChartArea: false }, title: { display: true, text: "KB", color: "#f59e0b", font: { size: 9 } } } },
          interaction: { intersect: false, mode: "index" } }
      });
    }
  };

  // Collect Config
  WZ._collectConfigs["website"] = {
    fields: function(saved) {
      saved = saved || {};
      var h = '';
      h += '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px;">Von bestehender Website-Zone \u00fcbernehmen</label>';
      h += '<select class="wz-cc-field" data-key="_import" onchange="var o=this.options[this.selectedIndex];if(o.dataset.url){this.closest(\'[id^=wz-cc-]\').querySelector(\'[data-key=url]\').value=o.dataset.url;}" style="width:100%;padding:4px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);font-size:11px;box-sizing:border-box;margin-bottom:6px;">';
      h += '<option value="">-- Manuell eingeben --</option>';
      (WZ._zones || []).forEach(function(z) {
        if (z.zone_type !== "website" || !z.config || !z.config.url) return;
        h += '<option value="' + z.id + '" data-url="' + WZ._esc(z.config.url) + '">' + WZ._esc(z.name) + ' (' + WZ._esc(z.config.url) + ')</option>';
      });
      h += '</select>';
      h += '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px;">Domain / URL</label>';
      h += '<input class="wz-cc-field" data-key="url" value="' + WZ._esc(saved.url || "") + '" placeholder="z.B. example.com" style="width:100%;padding:4px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);font-size:11px;box-sizing:border-box;">';
      return h;
    },
    read: function(container) {
      var inp = container.querySelector('[data-key="url"]');
      return { url: inp ? inp.value.trim() : "" };
    }
  };

})();
