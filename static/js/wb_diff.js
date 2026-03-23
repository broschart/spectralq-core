// wb_diff.js – Shared Seitenvergleich-Diff-Modal für events_watchzones & analysis
// Stellt window._wbOpenDiff bereit.
(function() {
  'use strict';

  // CSS für Lade-Spinner injizieren (einmalig)
  if (!document.getElementById('wz-spin-style')) {
    const s = document.createElement('style');
    s.id = 'wz-spin-style';
    s.textContent = '@keyframes wz-spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(s);
  }

  function _esc(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  // ── Reverse Lookup: Domains mit gleicher Tracking-ID ──
  window._wbReverseLookup = async function(btn) {
    const tid = btn.dataset.rlId;
    const targetId = btn.dataset.rlChip;
    const target = document.getElementById(targetId);
    if (!tid || !target) return;

    // Toggle: Wenn schon offen, schließen
    if (target.style.display !== 'none') {
      target.style.display = 'none';
      return;
    }

    target.style.display = 'block';
    target.innerHTML = `<div style="display:flex;align-items:center;gap:6px;padding:4px 0;">
      <div style="width:10px;height:10px;border:1.5px solid var(--border);border-top-color:#06b6d4;
           border-radius:50%;animation:wz-spin .75s linear infinite;flex-shrink:0;"></div>
      <span style="font-size:9px;color:var(--muted);">Suche Domains\u2026</span>
    </div>`;

    try {
      const r = await fetch(`/api/tracker-reverse-lookup?id=${encodeURIComponent(tid)}`);
      const data = await r.json();
      if (!r.ok || data.error) throw new Error(data.error || 'Fehler');

      const domains = data.domains || [];
      if (!domains.length) {
        target.innerHTML = '<div style="font-size:9px;color:var(--muted);padding:2px 0;">Keine weiteren Domains gefunden.</div>';
        return;
      }

      let html = '';
      const verified = domains.filter(d => d.verified);
      const unverified = domains.filter(d => !d.verified);

      function _domainLink(d, color) {
        const esc = _esc(d.domain);
        return `<div style="font-size:10px;padding:1px 0;display:flex;align-items:center;gap:4px;">
          <span style="color:${color};">${d.verified ? '&#x2713;' : '&#x25CB;'}</span>
          <a href="https://${esc}" target="_blank" rel="noopener"
             style="font-family:monospace;word-break:break-all;color:${d.verified ? 'var(--text)' : 'var(--muted)'};text-decoration:none;"
             onmouseover="this.style.textDecoration='underline';this.style.color='#06b6d4'"
             onmouseout="this.style.textDecoration='none';this.style.color='${d.verified ? 'var(--text)' : 'var(--muted)'}'">${esc}</a>
          <span style="font-size:8px;color:var(--muted);opacity:.6;">${_esc(d.source)}</span>
        </div>`;
      }
      if (verified.length) {
        html += `<div style="font-size:9px;font-weight:700;color:#4ade80;margin-bottom:2px;">Verifiziert (${verified.length})</div>`;
        html += verified.map(d => _domainLink(d, '#4ade80')).join('');
      }
      if (unverified.length) {
        html += `<div style="font-size:9px;font-weight:700;color:var(--muted);margin-top:4px;margin-bottom:2px;">Weitere Hinweise (${unverified.length})</div>`;
        html += unverified.map(d => _domainLink(d, 'var(--muted)')).join('');
      }
      target.innerHTML = html;
    } catch(err) {
      target.innerHTML = `<div style="font-size:9px;color:#f87171;">Fehler: ${_esc(err.message)}</div>`;
    }
  };

  const _TRACKERS = [
    { name:'Google Analytics 4',        color:'#facc15', patterns:[/\bG-[A-Z0-9]{6,12}\b/g, /googletagmanager\.com\/gtag\/js/g, /gtag\s*\(\s*['"]config['"]/g] },
    { name:'Google Analytics UA',       color:'#facc15', patterns:[/\bUA-\d{4,10}-\d{1,4}\b/g, /\bga\s*\(\s*['"]create['"]/g] },
    { name:'Google Tag Manager',        color:'#facc15', patterns:[/\bGTM-[A-Z0-9]{4,8}\b/g, /googletagmanager\.com\/gtm\.js/g] },
    { name:'Tealium',                   color:'#facc15', patterns:[/\butag\.js\b/g, /\butag_data\b/g, /\bwindow\.utag\b/g, /\/utag\.js/g] },
    { name:'Facebook Pixel',            color:'#3b82f6', patterns:[/\bfbq\s*\(/g, /facebook\.net\/[a-z_]+\/fbevents/g, /connect\.facebook\.net/g] },
    { name:'Facebook Domain Insights',  color:'#3b82f6', patterns:[/facebook\.com\/tr\//g, /fbds\.js/g, /facebook-domain-verification/g, /connect\.facebook\.net\/[a-z_]+\/sdk/g] },
    { name:'TikTok Pixel',         color:'#e879f9', patterns:[/\bttq\s*\(/g, /tiktok\.com\/i18n\/pixel/g] },
    { name:'LinkedIn Insight',     color:'#0ea5e9', patterns:[/\blinkedin\.com\/insight/g, /\b_linkedin_partner_id\b/g, /\bpartner_id\s*[:=]\s*['"]\d+['"]/g] },
    { name:'Twitter/X Pixel',      color:'#94a3b8', patterns:[/\btwq\s*\(/g, /static\.ads-twitter\.com/g] },
    { name:'Pinterest Tag',        color:'#ef4444', patterns:[/\bpintrk\s*\(/g, /ct\.pinterest\.com/g] },
    { name:'Hotjar',               color:'#f97316', patterns:[/\bhjid\s*[:=]\s*\d+/g, /hotjar\.com/g] },
    { name:'Matomo/Piwik',         color:'#22d3ee', patterns:[/\b_paq\s*\./g, /matomo\.(js|php)/g, /\bpiwik\b/gi] },
    { name:'HubSpot',              color:'#f97316', patterns:[/\bhs-analytics\b/g, /\b_hsq\s*\./g, /js\.hs-scripts\.com/g] },
    { name:'Segment',              color:'#8b5cf6', patterns:[/analytics\.js/g, /cdn\.segment\.(com|io)/g] },
    { name:'Intercom',             color:'#06b6d4', patterns:[/\bIntercom\s*\(/g, /widget\.intercom\.io/g] },
    { name:'Microsoft Clarity',    color:'#0284c7', patterns:[/\bclarity\s*\(\s*["']set["']/g, /clarity\.ms\/tag/g] },
    { name:'Criteo',               color:'#f59e0b', patterns:[/\bCriteo\b/g, /static\.criteo\.net/g] },
    { name:'Adobe Experience Cloud', color:'#e11d48', patterns:[/adobedtm\.com/g, /assets\.adobedtm\.com/g, /\b_satellite\b/g, /\balloy\s*\(/g, /launch-[a-f0-9]{10,}\.min\.js/g] },
    { name:'Adobe Analytics',       color:'#e11d48', patterns:[/\bs\.t\s*\(/g, /AppMeasurement/g, /omtrdc\.net/g, /sc\.omtrdc\.net/g, /2o7\.net/g, /\bs_account\b/g, /SiteCatalyst/g, /adobe_analytics/g] },
    { name:'Adobe Target',          color:'#e11d48', patterns:[/adobe\.target/g, /mbox\.js/g, /at\.js/g, /\bmboxCreate\s*\(/g, /tt\.omtrdc\.net/g] },
    { name:'Outbrain',             color:'#84cc16', patterns:[/amplify\.outbrain\.com/g, /\bobApi\b/g] },
    { name:'Taboola',              color:'#84cc16', patterns:[/\b_taboola\b/g, /trc\.taboola\.com/g] },
    { name:'Comscore',             color:'#64748b', patterns:[/scorecardresearch\.com/g, /\bCOMSCORE\b/g] },
    { name:'Chartbeat',            color:'#64748b', patterns:[/static\.chartbeat\.com/g, /\bCBQ\b/g] },
    { name:'Mouseflow',            color:'#10b981', patterns:[/mouseflow\.com/g, /\bwindow\.mouseflow\b/g, /\bmouseflow\s*\.\s*(init|record)\b/g] },
    { name:'FullStory',            color:'#10b981', patterns:[/fullstory\.com/g, /\bwindow\._fs_debug\b/g, /\bFS\s*\.\s*(event|identify|setUserVars)\b/g] },
    { name:'Lucky Orange',         color:'#10b981', patterns:[/luckyorange\.com/g, /\b__lo_cs_added\b/g] },
    { name:'Smartlook',            color:'#10b981', patterns:[/smartlook\.com/g, /\bsmartlook\s*\(\s*["']init["']/g, /smartlook-analytics\.io/g] },
    { name:'LogRocket',            color:'#10b981', patterns:[/logrocket\.com/g, /\bLogRocket\s*\.\s*init\b/g, /cdn\.logrocket\.io/g] },
    { name:'Inspectlet',           color:'#10b981', patterns:[/inspectlet\.com/g, /\b__insp_/g] },
    { name:'Crazy Egg',            color:'#f43f5e', patterns:[/crazyegg\.com/g, /\bCE2\b/g, /cetrk\.com/g] },
    { name:'VWO',                  color:'#f43f5e', patterns:[/\bvis_opt_base_url\b/g, /vwo\.com/g, /\b_vis_opt_/g, /wingify\.com/g] },
    { name:'Heap',                 color:'#f43f5e', patterns:[/heap\.io/g, /heapanalytics\.com/g, /\bwindow\.heap\b/g] },
    { name:'ContentSquare',        color:'#f43f5e', patterns:[/contentsquare\.com/g, /\b_uxa\b/g, /uxa\.io/g] },
    { name:'ClickTale',            color:'#f43f5e', patterns:[/clicktale\.net/g, /\bClickTale\s*\./g] },
    { name:'Mixpanel',             color:'#a78bfa', patterns:[/mixpanel\.com/g, /\bmixpanel\s*\.\s*(track|identify|init)\b/g] },
    { name:'Amplitude',            color:'#a78bfa', patterns:[/amplitude\.com/g, /cdn\.amplitude\.com/g, /\bamplitude\s*\.\s*(getInstance|logEvent)\b/g] },
    { name:'Plausible',            color:'#a78bfa', patterns:[/plausible\.io/g, /\bplausible\s*\(\s*["']pageview["']/g] },
    { name:'Pendo',                color:'#a78bfa', patterns:[/pendo\.io/g, /\bpendo\s*\.\s*(initialize|track)\b/g, /cdn\.pendo\.io/g] },
    { name:'Woopra',               color:'#a78bfa', patterns:[/woopra\.com/g, /\bwoopra\s*\.\s*(track|identify)\b/g] },
    { name:'Clicky',               color:'#a78bfa', patterns:[/getclicky\.com/g, /\bclicky\s*\.\s*(log|goal)\b/g] },
    { name:'INFOnline / IVW',       color:'#fb923c', patterns:[/infonline\.de/g, /ivwbox\.de/g, /ioam\.de/g, /\/iomm\//g, /\bIOMm\s*\(/g, /window\.IOMm\b/g, /agof\.de/g] },
    { name:'Piano Analytics',      color:'#fb923c', patterns:[/piano\.io/g, /atinternet\.com/g, /atinternet-solutions\.com/g, /tag\.aticdn\.net/g, /\bpa\s*\.\s*(sendEvent|setProperty)\b/g] },
    { name:'Emetriq',              color:'#fb923c', patterns:[/emetriq\.com/g, /\bemetriq\b/g] },
    { name:'ID5',                  color:'#fb923c', patterns:[/id5-sync\.com/g, /\bID5\s*\.\s*init\b/g] },
    { name:'Permutive',            color:'#fb923c', patterns:[/permutive\.com/g, /\bpermutive\s*\.\s*(addon|identify)\b/g] },
    { name:'LiveRamp',             color:'#fb923c', patterns:[/rlcdn\.com/g, /liveramp\.com/g, /\bfpid\b/g] },
    { name:'Lotame',               color:'#fb923c', patterns:[/lotame\.com/g, /bcp\.crwdcntrl\.net/g, /\blotame\b/g] },
    { name:'Nielsen',              color:'#64748b', patterns:[/cdn\.nielsen\.com/g, /\bNielsenMeasurement\b/g, /imrworldwide\.com/g] },
    { name:'Integral Ad Science',  color:'#64748b', patterns:[/iasds01\.com/g, /integralads\.com/g, /\bIAS\s*\./g] },
    { name:'DoubleVerify',         color:'#64748b', patterns:[/doubleverify\.com/g, /\bdv-pub\b/g] },
    { name:'Xandr / AppNexus',     color:'#64748b', patterns:[/adnxs\.com/g, /\bapnexus\b/gi, /acdn\.adnxs\.com/g] },
    { name:'Sourcepoint (CMP)',    color:'#475569', patterns:[/sourcepoint\.com/g, /\/cmp2\./g, /wrapperMessaging/g, /\b_sp_queue\b/g] },
    { name:'Usercentrics (CMP)',   color:'#475569', patterns:[/usercentrics\.eu/g, /usercentrics\.com/g, /\buc_settings\b/g] },
    { name:'OneTrust (CMP)',       color:'#475569', patterns:[/onetrust\.com/g, /optanon\.blob\.core\.windows/g, /\bOptanonWrapper\b/g] },
  ];

  function _scanRaw(lines) {
    const hits = new Map();
    for (const line of lines) {
      for (const tr of _TRACKERS) {
        for (const pat of tr.patterns) {
          pat.lastIndex = 0;
          let m;
          while ((m = pat.exec(line)) !== null) {
            const id = m[0].replace(/['"]/g,'').trim();
            const key = tr.name + '|' + id;
            if (!hits.has(key)) hits.set(key, { name: tr.name, color: tr.color, id });
          }
        }
      }
    }
    return hits;
  }

  window._wbOpenDiff = function(zoneId, snap, prevSnap, nextSnap, pageUrl) {
    const mid = 'wz-wb-diff-modal';
    const old = document.getElementById(mid);
    if (old) old.remove();

    const fmtSnap = s => {
      if (!s) return null;
      const iso = s.date + (s.time ? 'T' + s.time : 'T00:00');
      return typeof fmtDate === 'function' ? fmtDate(iso) : (s.date + (s.time ? ' ' + s.time.slice(0,5) : ''));
    };
    const tsLabel = fmtSnap(snap);

    const modal = document.createElement('div');
    modal.id = mid;
    modal.style.cssText = 'position:fixed;inset:0;z-index:10300;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;';

    const hasPrev = !!(prevSnap && prevSnap.timestamp);
    const hasNext = !!(nextSnap && nextSnap.timestamp);
    const btnBase = 'padding:5px 12px;border:1px solid var(--border);border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;';
    const btnActive = btnBase + 'background:#0e7490;color:#fff;border-color:#0e7490;';
    const btnInactive = btnBase + 'background:var(--surface2);color:var(--muted);';

    modal.innerHTML = `
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;
                  width:90vw;height:90vh;display:flex;flex-direction:column;
                  box-shadow:0 16px 48px rgba(0,0,0,.6);overflow:hidden;">
        <div style="padding:10px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px;flex-shrink:0;flex-wrap:wrap;">
          <span style="font-size:14px;font-weight:700;color:var(--text);white-space:nowrap;">Seitenvergleich</span>
          <span style="font-size:11px;color:var(--muted);">|</span>
          <span style="font-size:12px;font-weight:600;color:var(--text);white-space:nowrap;">&#128247; ${_esc(tsLabel)}</span>
          <span id="wz-diff-vs-label" style="font-size:11px;color:var(--muted);white-space:nowrap;"></span>
          <span style="flex:1;"></span>
          <button id="wz-diff-btn-prev" style="${hasPrev ? btnActive : btnInactive}" ${hasPrev ? '' : 'disabled'}>&#8592; Vergleich Vorheriger</button>
          <button id="wz-diff-btn-next" style="${hasNext ? btnInactive : btnInactive}" ${hasNext ? '' : 'disabled'}>Vergleich N\u00e4chster &#8594;</button>
          <div id="wz-diff-trans-wrap" style="position:relative;">
            <button id="wz-diff-btn-trans" disabled style="${btnInactive}opacity:.4;">🌐 Übersetzen</button>
            <div id="wz-diff-trans-menu" style="display:none;position:absolute;top:calc(100% + 4px);right:0;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:6px;z-index:1000;min-width:160px;box-shadow:0 4px 20px rgba(0,0,0,.5);"></div>
          </div>
          <a href="https://web.archive.org/web/${_esc(snap.timestamp)}/${_esc(pageUrl)}" target="_blank" rel="noopener"
             style="font-size:11px;color:#06b6d4;text-decoration:none;white-space:nowrap;">${typeof t === 'function' ? t('wz_diff_open_archive','Archivierte Website aufrufen') : 'Archivierte Website aufrufen'}</a>
          <span style="font-size:11px;color:var(--border);">|</span>
          <a href="${_esc(pageUrl)}" target="_blank" rel="noopener"
             style="font-size:11px;color:var(--muted);text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px;"
             title="${_esc(pageUrl)}">${_esc(pageUrl)}</a>
          <button onclick="document.getElementById('${mid}').remove()"
            style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:20px;line-height:1;flex-shrink:0;">&#10005;</button>
        </div>
        <div id="wz-wb-diff-body" style="flex:1;display:flex;align-items:center;justify-content:center;font-size:13px;color:var(--muted);">
          <div style="display:flex;flex-direction:column;align-items:center;gap:12px;">
            <div style="width:32px;height:32px;border:3px solid var(--border);border-top-color:#06b6d4;
                 border-radius:50%;animation:wz-spin 0.75s linear infinite;"></div>
            Lade Snapshot \u2026
          </div>
        </div>
      </div>`;
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);

    function _collectLines(sections, types, sign) {
      const lines = [];
      for (const sec of sections) {
        if (!types.includes(sec.type)) continue;
        for (const l of sec.lines) {
          if (l.startsWith('+++') || l.startsWith('---') || l.startsWith('@@')) continue;
          if (sign === '+' && l.startsWith('+')) lines.push(l.slice(1));
          if (sign === '-' && l.startsWith('-')) lines.push(l.slice(1));
        }
      }
      return lines;
    }
    function _collectDiffLines(sections, types) {
      const lines = [];
      for (const sec of sections) {
        if (!types.includes(sec.type)) continue;
        lines.push(...sec.lines);
      }
      return lines;
    }
    function _renderDiffLine(line) {
      const esc = line.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      if (line.startsWith('+++') || line.startsWith('---'))
        return `<div style="padding:1px 16px;color:var(--muted);white-space:pre-wrap;">${esc}</div>`;
      if (line.startsWith('+'))
        return `<div style="padding:1px 16px;background:rgba(74,222,128,.10);color:#4ade80;white-space:pre-wrap;">${esc}</div>`;
      if (line.startsWith('-'))
        return `<div style="padding:1px 16px;background:rgba(248,113,113,.10);color:#f87171;white-space:pre-wrap;">${esc}</div>`;
      if (line.startsWith('@@'))
        return `<div style="padding:1px 16px;color:#818cf8;white-space:pre-wrap;">${esc}</div>`;
      return `<div style="padding:1px 16px;color:var(--muted);white-space:pre-wrap;">${esc}</div>`;
    }

    async function _loadDiff(mode) {
      const refSnap = mode === 1 ? prevSnap : nextSnap;
      const vsLabel = document.getElementById('wz-diff-vs-label');
      if (vsLabel) vsLabel.textContent = refSnap ? ('vs. ' + fmtSnap(refSnap)) : '';

      const b1 = document.getElementById('wz-diff-btn-prev');
      const b2 = document.getElementById('wz-diff-btn-next');
      if (b1) b1.style.cssText = (mode === 1 && hasPrev ? btnActive : btnInactive) + (hasPrev ? '' : 'opacity:.4;cursor:default;');
      if (b2) b2.style.cssText = (mode === 2 && hasNext ? btnActive : btnInactive) + (hasNext ? '' : 'opacity:.4;cursor:default;');

      const body = document.getElementById('wz-wb-diff-body');
      if (!body) return;
      body.style.cssText = 'flex:1;display:flex;align-items:center;justify-content:center;font-size:13px;color:var(--muted);';
      body.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;gap:12px;">
        <div style="width:32px;height:32px;border:3px solid var(--border);border-top-color:#06b6d4;
             border-radius:50%;animation:wz-spin 0.75s linear infinite;"></div>
        Lade \u2026</div>`;

      try {
        let qs;
        if (mode === 1) {
          qs = new URLSearchParams({ ts: snap.timestamp });
          if (prevSnap && prevSnap.timestamp) qs.set('ts1', prevSnap.timestamp);
        } else {
          qs = new URLSearchParams({ ts: nextSnap.timestamp, ts1: snap.timestamp });
        }
        const r = await fetch(`/api/watchzones/${zoneId}/snapshot-diff?${qs}`);
        const data = await r.json();
        if (!r.ok || data.error) throw new Error(data.error || 'Fehler');

        body.innerHTML = '';
        const hasStats = (data.stats1 && Object.keys(data.stats1).length) || (data.keywords1 && data.keywords1.length);
        if ((!data.sections || data.sections.length === 0) && !hasStats) {
          body.style.cssText += 'display:flex;align-items:center;justify-content:center;';
          body.innerHTML = `<div style="color:var(--muted);font-size:13px;font-family:sans-serif;">${_esc(data.info || 'Keine Unterschiede gefunden.')}</div>`;
          return;
        }

        // ── Tracker: Client-Scan (Level 1) + Backend Levels 1–5 ──
        const _rawNew = [...(data.js_raw || []), ...(data.css_raw || [])];
        const _rawOld = [...(data.js_raw1 || []), ...(data.css_raw1 || [])];
        const _hitsNew = _scanRaw(_rawNew);
        const _hitsOld = _scanRaw(_rawOld);

        const _LEVEL_META = {
          1: { label:'Level 1', desc:'Direkt im HTML eingebunden', color:'148,163,184', chipColor:'#94a3b8' },
          2: { label:'Level 2', desc:'Via Tag Manager nachgeladen', color:'251,146,60',  chipColor:'#fb923c' },
          3: { label:'Level 3', desc:'Verschachtelte Container / Piggybacking', color:'239,68,68', chipColor:'#ef4444' },
          4: { label:'Level 4', desc:'Tiefere Verschachtelung', color:'168,85,247', chipColor:'#a855f7' },
          5: { label:'Level 5', desc:'Tiefste erkannte Ebene', color:'236,72,153', chipColor:'#ec4899' },
        };

        const _trkStruct2 = data.tracker_struct || {};
        const _trkStruct1 = data.tracker_struct1 || {};

        // Alle URLs aus allen Levels für Status-Vergleich sammeln
        const _allOldUrls = new Set();
        const _allNewUrls = new Set();
        for (let l = 1; l <= 5; l++) {
          for (const e of (_trkStruct1[`level${l}`] || [])) _allOldUrls.add(e.url);
          for (const e of (_trkStruct2[`level${l}`] || [])) _allNewUrls.add(e.url);
        }

        // Backend-Tracker-URLs → tiefstes zugewiesenes Level ermitteln
        // Wenn das Backend einen Tracker auf Level 2+ kennt,
        // soll der Client-Scan ihn NICHT auf Level 1 einstufen
        const _backendLevelMap = new Map(); // url → level
        for (let l = 2; l <= 5; l++) {
          for (const e of (_trkStruct2[`level${l}`] || [])) {
            const u = e.url.toLowerCase();
            if (!_backendLevelMap.has(u) || l < _backendLevelMap.get(u))
              _backendLevelMap.set(u, l);
          }
        }

        // Level-Hits dynamisch aufbauen
        const levelHits = {};
        for (let lvl = 1; lvl <= 5; lvl++) {
          const hits = [];
          const seen = new Set();
          const meta = _LEVEL_META[lvl];
          const newEntries = _trkStruct2[`level${lvl}`] || [];
          const oldEntries = _trkStruct1[`level${lvl}`] || [];

          // Level 1: Client-Scan-Ergebnisse — aber nur wenn das Backend
          // den Tracker nicht auf einem tieferen Level kennt
          if (lvl === 1) {
            for (const [key, h] of _hitsNew) {
              // Prüfen ob irgendein Backend-Level-2+ diesen Tracker enthält
              const id_lower = (h.id || '').toLowerCase();
              let claimedByDeeper = false;
              for (const [bUrl, bLvl] of _backendLevelMap) {
                if (id_lower && (bUrl.includes(id_lower) || id_lower.includes(bUrl))) {
                  claimedByDeeper = true; break;
                }
              }
              if (!claimedByDeeper) {
                hits.push({ ...h, status: _hitsOld.has(key) ? 'unchanged' : 'new', level: 1 });
                seen.add(h.id);
              }
            }
            for (const [key, h] of _hitsOld) {
              if (!_hitsNew.has(key) && !seen.has(h.id)) {
                const id_lower = (h.id || '').toLowerCase();
                let claimedByDeeper = false;
                for (const [bUrl, bLvl] of _backendLevelMap) {
                  if (id_lower && (bUrl.includes(id_lower) || id_lower.includes(bUrl))) {
                    claimedByDeeper = true; break;
                  }
                }
                if (!claimedByDeeper) {
                  hits.push({ ...h, status: 'removed', level: 1 }); seen.add(h.id);
                }
              }
            }

            // Tag-Manager-Einträge: direkte → Level 1, verschachtelte (via ...) → Level 2+
            for (const tm of (_trkStruct2.tag_managers || [])) {
              if (!seen.has(tm)) {
                const wasOld = (_trkStruct1.tag_managers || []).includes(tm);
                const viaMatch = tm.match(/\(via (.+)\)/);
                if (!viaMatch) {
                  // Direkt im HTML → Level 1
                  hits.push({ name: 'Tag Manager', color: '#fb923c', id: tm, status: wasOld ? 'unchanged' : 'new', level: 1 });
                  seen.add(tm);
                }
                // Verschachtelte werden unten bei ihrem Level eingeordnet
              }
            }
            for (const tm of (_trkStruct1.tag_managers || [])) {
              if (!seen.has(tm) && !(_trkStruct2.tag_managers || []).includes(tm)) {
                const viaMatch = tm.match(/\(via (.+)\)/);
                if (!viaMatch) {
                  hits.push({ name: 'Tag Manager', color: '#fb923c', id: tm, status: 'removed', level: 1 });
                  seen.add(tm);
                }
              }
            }
          }

          // Backend-Daten ergänzen
          for (const e of newEntries) {
            if (!seen.has(e.url)) {
              const wasOld = _allOldUrls.has(e.url);
              hits.push({ name: lvl === 1 ? 'Script' : `L${lvl}`, color: meta.chipColor, id: e.url, via: e.via, status: wasOld ? 'unchanged' : 'new', level: lvl });
              seen.add(e.url);
            }
          }
          for (const e of oldEntries) {
            if (!seen.has(e.url) && !_allNewUrls.has(e.url)) {
              hits.push({ name: lvl === 1 ? 'Script' : `L${lvl}`, color: meta.chipColor, id: e.url, via: e.via, status: 'removed', level: lvl });
            }
          }

          // Verschachtelte Tag-Manager auf Level 2+ einsortieren
          if (lvl >= 2) {
            for (const tm of (_trkStruct2.tag_managers || [])) {
              const viaMatch = tm.match(/\(via (.+)\)/);
              if (viaMatch && !seen.has(tm)) {
                // Tiefe bestimmen: Level 2 für direkt verschachtelte, 3+ für tiefere
                const parentId = viaMatch[1];
                // Prüfen ob der Parent auf dem vorherigen Level ist
                const parentLevel = levelHits[lvl - 1] || [];
                if (parentLevel.some(h => h.id === parentId || h.id.includes(parentId))) {
                  const cleanId = tm.replace(/\s*\(via .+\)/, '');
                  const wasOld = (_trkStruct1.tag_managers || []).includes(tm);
                  hits.push({ name: 'Tag Manager', color: meta.chipColor, id: cleanId, via: parentId, status: wasOld ? 'unchanged' : 'new', level: lvl });
                  seen.add(tm);
                }
              }
            }
          }
          levelHits[lvl] = hits;
        }

        const allTrackerHits = [];
        for (let l = 1; l <= 5; l++) allTrackerHits.push(...levelHits[l]);
        const tagManagers = _trkStruct2.tag_managers || [];

        const allTabs = [
          { id:'stats',     label:'Statistik', lines:[], color:'#e879f9', isStats:true, isDiff:false, isTile:false, mode2:true,
            stats1: data.stats1 || {}, stats2: data.stats2 || {},
            keywords1: data.keywords1 || [], keywords2: data.keywords2 || [],
            intLinks1: (data.links1||{}).internal||[], intLinks2: (data.links2||{}).internal||[],
            extLinks1: (data.links1||{}).external||[], extLinks2: (data.links2||{}).external||[] },
          { id:'html-add',  label:'Content neu',         lines:_collectLines(data.sections,['html'],'+'),     color:'#4ade80', isDiff:false, isTile:true,      mode2:false },
          { id:'html-del',  label: mode === 2 ? 'Content wird entfernt' : 'Content entfernt', lines:_collectLines(data.sections,['html'],'-'), color:'#f87171', isDiff:false, isTile:true, mode2:true },
          { id:'html-diff', label:'Content-Diff',        lines:_collectDiffLines(data.sections,['html']),     color:'#60a5fa', isDiff:true,  isTile:false,     mode2:true  },
          { id:'code-add',  label:'Code neu',            lines:_collectLines(data.sections,['js','css'],'+'), color:'#34d399', isDiff:false, isTile:false,     mode2:false },
          { id:'code-del',  label: mode === 2 ? 'Code wird entfernt' : 'Code entfernt', lines:_collectLines(data.sections,['js','css'],'-'), color:'#fb923c', isDiff:false, isTile:false, mode2:true },
          { id:'code-diff', label:'Code-Diff',           lines:_collectDiffLines(data.sections,['js','css']), color:'#a78bfa', isDiff:true,  isTile:false,     mode2:true  },
          { id:'tracker',   label:'Tracker', trackers:allTrackerHits, levelHits, tagManagers: _trkStruct2.tag_managers || [], lines:[], color:'#06b6d4', isTracker:true, isDiff:false, isTile:false, mode2:true },
        ];
        const tabs = allTabs.filter(t => mode === 1 || t.mode2);

        body.style.cssText = 'flex:1;display:flex;flex-direction:column;background:var(--bg);overflow:hidden;';
        const tabBar = document.createElement('div');
        tabBar.style.cssText = 'display:flex;flex-wrap:wrap;border-bottom:1px solid var(--border);flex-shrink:0;background:var(--surface);';
        body.appendChild(tabBar);

        const panes = [];
        let _activeTabIdx = 0;

        tabs.forEach((t, i) => {
          const btn = document.createElement('button');
          const _tabViolet = '#a78bfa';
          btn.style.cssText = 'padding:8px 14px;background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;font-size:12px;font-family:sans-serif;white-space:nowrap;';
          const count = t.isStats ? '\u2261' : t.isTracker ? t.trackers.length : t.isDiff ? '\u0394' : t.lines.filter(l => !l.startsWith('@@') && !l.startsWith('+++') && !l.startsWith('---')).length;
          btn.innerHTML = `<span style="font-weight:700;">${_esc(t.label)}</span><span style="margin-left:6px;font-size:10px;background:var(--surface2);border-radius:10px;padding:1px 6px;">${count}</span>`;
          const _setActive = active => {
            btn.style.color = active ? '#fff' : _tabViolet;
            btn.style.borderBottomColor = active ? _tabViolet : 'transparent';
          };
          _setActive(i === 0);
          btn.addEventListener('click', () => {
            _activeTabIdx = i;
            tabBar.querySelectorAll('button').forEach((b, j) => { b.style.color=_tabViolet; b.style.borderBottomColor='transparent'; panes[j].style.display='none'; });
            btn.style.color = '#fff'; btn.style.borderBottomColor = _tabViolet;
            panes[i].style.display = panes[i]._isDiffPane ? 'flex' : 'block';
          });
          tabBar.appendChild(btn);

          const pane = document.createElement('div');
          pane.style.cssText = `flex:1;overflow-y:auto;padding:10px;font-family:sans-serif;font-size:12px;${i > 0 ? 'display:none;' : ''}`;
          if (!t.lines.length && !t.isTracker && !t.isStats) {
            pane.innerHTML = `<div style="padding:20px;color:var(--muted);text-align:center;">Keine \u00c4nderungen</div>`;
          } else if (t.isDiff) {
            pane.style.fontFamily = 'monospace';
            pane.style.padding = '0';
            pane.style.display = i > 0 ? 'none' : 'flex';
            pane.style.flexDirection = 'column';

            let _splitMode = false;
            const toolbar = document.createElement('div');
            toolbar.style.cssText = 'display:flex;align-items:center;justify-content:flex-end;padding:4px 10px;border-bottom:1px solid var(--border);flex-shrink:0;background:var(--surface);';
            const toggleBtn = document.createElement('button');
            toggleBtn.style.cssText = 'padding:3px 10px;font-size:11px;font-family:sans-serif;border:1px solid var(--border);border-radius:5px;background:var(--surface2);color:var(--muted);cursor:pointer;';
            toggleBtn.textContent = '\u29c9 Doppelfenster';

            const diffContent = document.createElement('div');
            diffContent.style.cssText = 'flex:1;overflow-y:auto;';

            function _renderUnified() {
              diffContent.innerHTML = t.lines.map(_renderDiffLine).join('');
            }

            function _renderSplit() {
              const cell = (content, bg, color, right) =>
                `<div style="min-width:0;overflow:hidden;padding:2px 10px;background:${bg};color:${color};
                  white-space:pre-wrap;word-break:break-all;${right ? 'border-right:1px solid var(--border);' : ''}">${content}</div>`;

              const rows = [];
              for (const line of t.lines) {
                if (line.startsWith('+++') || line.startsWith('---')) continue;
                if (line.startsWith('@@')) {
                  const esc = line.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
                  rows.push(`<div style="padding:2px 10px;color:#818cf8;background:rgba(129,140,248,.07);white-space:pre-wrap;word-break:break-all;grid-column:1/-1;">${esc}</div>`);
                } else if (line.startsWith('-')) {
                  const esc = line.slice(1).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
                  rows.push({ left: cell(esc,'rgba(248,113,113,.13)','#f87171',true), right: cell('','rgba(248,113,113,.04)','',false), type:'del' });
                } else if (line.startsWith('+')) {
                  const esc = line.slice(1).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
                  const last = rows[rows.length - 1];
                  if (last && last.type === 'del') {
                    last.right = cell(esc,'rgba(74,222,128,.13)','#4ade80',false);
                    last.type = 'pair';
                  } else {
                    rows.push({ left: cell('','rgba(74,222,128,.04)','',true), right: cell(esc,'rgba(74,222,128,.13)','#4ade80',false), type:'add' });
                  }
                } else {
                  const esc = line.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
                  rows.push({ left: cell(esc,'','var(--muted)',true), right: cell(esc,'','var(--muted)',false), type:'ctx' });
                }
              }
              const rowGrid = 'display:grid;grid-template-columns:1fr 1fr;min-width:0;overflow:hidden;';
              diffContent.innerHTML =
                `<div style="${rowGrid}border-top:1px solid var(--border);">
                  <div style="padding:3px 10px;font-size:10px;font-family:sans-serif;color:var(--muted);border-right:1px solid var(--border);border-bottom:1px solid var(--border);background:var(--surface);">Vorher</div>
                  <div style="padding:3px 10px;font-size:10px;font-family:sans-serif;color:var(--muted);border-bottom:1px solid var(--border);background:var(--surface);">Nachher</div>
                </div>` +
                rows.map(r => typeof r === 'string'
                  ? `<div style="${rowGrid}">${r}</div>`
                  : `<div style="${rowGrid}">${r.left}${r.right}</div>`
                ).join('');
            }

            _renderUnified();
            toggleBtn.addEventListener('click', () => {
              _splitMode = !_splitMode;
              toggleBtn.style.background = _splitMode ? '#0e7490' : 'var(--surface2)';
              toggleBtn.style.color = _splitMode ? '#fff' : 'var(--muted)';
              toggleBtn.style.borderColor = _splitMode ? '#0e7490' : 'var(--border)';
              _splitMode ? _renderSplit() : _renderUnified();
            });

            toolbar.appendChild(toggleBtn);
            pane.appendChild(toolbar);
            pane.appendChild(diffContent);
            pane._isDiffPane = true;
          } else if (t.isTracker) {
            if (!t.trackers.length) {
              pane.innerHTML = '<div style="padding:30px;color:var(--muted);text-align:center;font-family:sans-serif;">Im aktuellen Snapshot wurden keine bekannten Tracker erkannt.</div>';
            } else {
              function _chip(h) {
                const idEsc = h.id.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
                const viaHtml = h.via ? `<div style="color:var(--muted);font-size:9px;margin-top:2px;">via ${_esc(h.via)}</div>` : '';
                // Reverse-Lookup-Button für GTM/GA/UA-IDs
                const isLookupable = /^(GTM-|G-|UA-)/i.test(h.id);
                const chipId = 'rl-' + Math.random().toString(36).slice(2,8);
                const lookupBtn = isLookupable
                  ? `<button data-rl-id="${idEsc}" data-rl-chip="${chipId}"
                       style="margin-top:4px;padding:2px 8px;font-size:9px;font-weight:600;
                              border:1px solid ${h.color}44;border-radius:4px;background:none;
                              color:${h.color};cursor:pointer;font-family:sans-serif;opacity:.7;"
                       onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='.7'"
                       onclick="event.stopPropagation();_wbReverseLookup(this)">&#x1F50D; Domains</button>
                     <div id="${chipId}" style="display:none;margin-top:4px;"></div>` : '';
                return `<div style="background:var(--surface);border:1px solid ${h.color}55;border-left:3px solid ${h.color};
                  border-radius:6px;padding:8px 12px;font-family:sans-serif;font-size:12px;line-height:1.5;min-width:160px;max-width:280px;">
                  <div style="font-weight:700;color:${h.color};">${_esc(h.name)}</div>
                  <div style="color:var(--text);font-family:monospace;font-size:10px;word-break:break-all;margin-top:2px;">${idEsc}</div>
                  ${viaHtml}${lookupBtn}
                </div>`;
              }
              function _statusSection(label, color, items) {
                if (!items.length) return '';
                return `<div style="margin-bottom:10px;">
                  <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:${color};margin-bottom:6px;font-family:sans-serif;">${label} (${items.length})</div>
                  <div style="display:flex;flex-wrap:wrap;gap:6px;">${items.map(_chip).join('')}</div>
                </div>`;
              }
              function _levelBlock(levelLabel, levelDesc, levelColor, hits) {
                if (!hits.length) return '';
                const byNew     = hits.filter(h => h.status === 'new');
                const byRemoved = hits.filter(h => h.status === 'removed');
                const byPresent = hits.filter(h => h.status === 'unchanged');
                return `<div style="margin-bottom:20px;padding:14px 16px;background:rgba(${levelColor},.06);border:1px solid rgba(${levelColor},.2);border-radius:10px;">
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                    <span style="font-size:13px;font-weight:800;color:rgb(${levelColor});font-family:sans-serif;">${_esc(levelLabel)}</span>
                    <span style="font-size:11px;color:var(--muted);font-family:sans-serif;">${_esc(levelDesc)}</span>
                    <span style="font-size:10px;background:rgba(${levelColor},.15);color:rgb(${levelColor});padding:2px 8px;border-radius:10px;font-weight:700;font-family:sans-serif;">${hits.length}</span>
                  </div>
                  ${_statusSection('Neu', '#4ade80', byNew)}
                  ${_statusSection('Entfernt', '#f87171', byRemoved)}
                  ${_statusSection('Vorhanden', '#64748b', byPresent)}
                </div>`;
              }

              const tmHint = t.tagManagers.length
                ? `<div style="margin-bottom:14px;padding:8px 12px;background:rgba(251,146,60,.08);border:1px solid rgba(251,146,60,.3);border-left:3px solid #fb923c;border-radius:6px;font-family:sans-serif;font-size:11px;color:#fb923c;">
                    <b>Tag Manager:</b> ${t.tagManagers.map(m => _esc(m)).join(', ')}
                  </div>` : '';

              let blocksHtml = '';
              for (let lvl = 1; lvl <= 5; lvl++) {
                const hits = t.levelHits[lvl] || [];
                if (hits.length) {
                  const m = _LEVEL_META[lvl];
                  blocksHtml += _levelBlock(m.label, m.desc, m.color, hits);
                }
              }
              pane.innerHTML = tmHint + blocksHtml;
            }
          } else if (t.isStats) {
            pane.style.fontFamily = 'sans-serif';
            pane.style.padding = '16px 20px';
            pane.style.overflowY = 'auto';

            // ── Vergleichstabelle ──
            const colOld = mode === 2 ? 'Aktuell' : 'Vorher';
            const colNew = mode === 2 ? 'Kommend' : 'Aktuell';
            const s1 = t.stats1, s2 = t.stats2;
            const _delta = (a, b) => {
              if (a == null || b == null) return '';
              const d = b - a;
              if (d === 0) return '<span style="color:var(--muted);">±0</span>';
              const c = d > 0 ? '#4ade80' : '#f87171';
              const sign = d > 0 ? '+' : '';
              return `<span style="color:${c};font-weight:600;">${sign}${d.toLocaleString('de-DE')}</span>`;
            };
            const _pctDelta = (a, b) => {
              if (!a || !b || a === 0) return '';
              const pct = ((b - a) / a * 100).toFixed(1);
              if (parseFloat(pct) === 0) return '';
              const c = pct > 0 ? '#4ade80' : '#f87171';
              const sign = pct > 0 ? '+' : '';
              return `<span style="color:${c};font-size:10px;margin-left:4px;">(${sign}${pct}%)</span>`;
            };
            // ── Detail-Daten für klickbare Zeilen ──
            function _diffItems(list1, list2, keyFn) {
              const set1 = new Set((list1||[]).map(keyFn));
              const set2 = new Set((list2||[]).map(keyFn));
              const added = [...set2].filter(k => !set1.has(k));
              const removed = [...set1].filter(k => !set2.has(k));
              const kept = [...set2].filter(k => set1.has(k));
              return { added, removed, kept };
            }

            const _detailData = {
              'Überschriften': () => {
                const d = _diffItems(s1.heading_texts, s2.heading_texts, h => h.level + ': ' + h.text);
                return { added: d.added, removed: d.removed, kept: d.kept };
              },
              'Bilder': () => {
                const _imgKey = i => {
                  const src = (i && i.src) || '';
                  const name = src.split('/').pop().split('?')[0] || src;
                  const alt = (i && i.alt) || '';
                  return name + (alt ? ' \u2013 ' + alt : '');
                };
                const d = _diffItems(s1.image_list || [], s2.image_list || [], _imgKey);
                return { added: d.added, removed: d.removed, kept: d.kept };
              },
              'JS-Dateien (extern)': () => {
                const d = _diffItems(s1.js_file_list, s2.js_file_list, j => j.name);
                return { added: d.added, removed: d.removed, kept: d.kept };
              },
              'CSS-Dateien (extern)': () => {
                const d = _diffItems(s1.css_file_list, s2.css_file_list, c => c.name);
                return { added: d.added, removed: d.removed, kept: d.kept };
              },
            };

            function _showDetailPopup(label) {
              const fn = _detailData[label];
              if (!fn) return;
              const { added, removed, kept } = fn();

              const popId = 'wz-stat-detail-pop';
              document.getElementById(popId)?.remove();

              function _listHtml(items, color, prefix) {
                if (!items.length) return '';
                return items.map(it => {
                  const esc = (it||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
                  return `<div style="padding:2px 0;color:${color};font-size:11px;font-family:monospace;word-break:break-all;">${prefix} ${esc}</div>`;
                }).join('');
              }

              const pop = document.createElement('div');
              pop.id = popId;
              pop.style.cssText = 'position:fixed;inset:0;z-index:10500;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;';
              pop.onclick = e => { if (e.target === pop) pop.remove(); };

              const total = added.length + removed.length + kept.length;
              pop.innerHTML = `
                <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;
                            width:90%;max-width:560px;max-height:80vh;display:flex;flex-direction:column;
                            box-shadow:0 12px 40px rgba(0,0,0,.5);overflow:hidden;">
                  <div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px;">
                    <span style="font-size:14px;font-weight:700;color:var(--text);">${_esc(label)}</span>
                    <span style="font-size:11px;color:var(--muted);">${total} gesamt</span>
                    <span style="flex:1;"></span>
                    <button onclick="document.getElementById('${popId}').remove()"
                      style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:18px;">&#10005;</button>
                  </div>
                  <div style="padding:14px 16px;overflow-y:auto;font-family:sans-serif;">
                    ${added.length ? `<div style="margin-bottom:12px;">
                      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#4ade80;margin-bottom:4px;">Neu (${added.length})</div>
                      ${_listHtml(added, '#4ade80', '+')}
                    </div>` : ''}
                    ${removed.length ? `<div style="margin-bottom:12px;">
                      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#f87171;margin-bottom:4px;">Entfernt (${removed.length})</div>
                      ${_listHtml(removed, '#f87171', '−')}
                    </div>` : ''}
                    ${kept.length ? `<div style="margin-bottom:12px;">
                      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:4px;">Vorhanden (${kept.length})</div>
                      ${_listHtml(kept, 'var(--muted)', ' ')}
                    </div>` : ''}
                    ${!total ? '<div style="color:var(--muted);font-size:12px;">Keine Details verfügbar.</div>' : ''}
                  </div>
                </div>`;
              document.body.appendChild(pop);
            }

            const rows = [
              ['Überschriften', s1.headings, s2.headings],
              ['Absätze', s1.paragraphs, s2.paragraphs],
              ['Wörter', s1.words, s2.words],
              ['Zeichen', s1.chars, s2.chars],
              ['Links', s1.links, s2.links],
              ['Bilder', s1.images, s2.images],
              ['JS-Dateien (extern)', s1.js_files, s2.js_files],
              ['JS (inline)', s1.inline_scripts, s2.inline_scripts],
              ['CSS-Dateien (extern)', s1.css_files, s2.css_files],
              ['CSS (inline)', s1.inline_styles, s2.inline_styles],
              ['Listen', s1.lists, s2.lists],
              ['Tabellen', s1.tables, s2.tables],
              ['Formulare', s1.forms, s2.forms],
            ];
            const fmt = v => v != null ? v.toLocaleString('de-DE') : '–';
            const hasDetail = label => label in _detailData;
            const tableHtml = `
              <div style="margin-bottom:28px;">
                <h3 style="margin:0 0 10px;font-size:14px;font-weight:700;color:var(--text);">Seitenstruktur</h3>
                <table style="width:100%;max-width:600px;border-collapse:collapse;font-size:12px;">
                  <thead>
                    <tr style="border-bottom:2px solid var(--border);">
                      <th style="text-align:left;padding:6px 10px;color:var(--muted);font-weight:600;">Metrik</th>
                      <th style="text-align:right;padding:6px 10px;color:var(--muted);font-weight:600;">${colOld}</th>
                      <th style="text-align:right;padding:6px 10px;color:var(--muted);font-weight:600;">${colNew}</th>
                      <th style="text-align:right;padding:6px 10px;color:var(--muted);font-weight:600;">Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${rows.map(([label, v1, v2]) => `
                      <tr data-detail-label="${_esc(label)}"
                          style="border-bottom:1px solid var(--border);${hasDetail(label) ? 'cursor:pointer;' : ''}"
                          ${hasDetail(label) ? `onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background=''"` : ''}>
                        <td style="padding:5px 10px;color:var(--text);">${label}${hasDetail(label) ? ' <span style="opacity:.3;font-size:10px;">&#x25B6;</span>' : ''}</td>
                        <td style="padding:5px 10px;text-align:right;color:var(--muted);font-variant-numeric:tabular-nums;">${fmt(v1)}</td>
                        <td style="padding:5px 10px;text-align:right;color:var(--text);font-weight:600;font-variant-numeric:tabular-nums;">${fmt(v2)}</td>
                        <td style="padding:5px 10px;text-align:right;font-variant-numeric:tabular-nums;">${_delta(v1, v2)} ${_pctDelta(v1, v2)}</td>
                      </tr>`).join('')}
                  </tbody>
                </table>
              </div>`;

            // ── Generische Slope-Chart-Funktion ──
            function _drawSlopeChart(containerId, list1, list2, keyField, emptyMsg) {
              const el = pane.querySelector('#' + containerId) || document.getElementById(containerId);
              if (!el || typeof d3 === 'undefined') return;

              const map1 = new Map(list1.map((k, i) => [k[keyField], { count: k.count, rank: i + 1 }]));
              const map2 = new Map(list2.map((k, i) => [k[keyField], { count: k.count, rank: i + 1 }]));
              const allKeys = new Set([...map1.keys(), ...map2.keys()]);
              const maxRank = 32;

              const items = [];
              for (const w of allKeys) {
                items.push({
                  word: w,
                  r1: map1.has(w) ? map1.get(w).rank : null,
                  r2: map2.has(w) ? map2.get(w).rank : null,
                });
              }
              items.sort((a, b) => Math.min(a.r1||maxRank, a.r2||maxRank) - Math.min(b.r1||maxRank, b.r2||maxRank));
              const shown = items.slice(0, 35);
              if (!shown.length) {
                el.innerHTML = `<div style="color:var(--muted);padding:20px;text-align:center;font-size:12px;">${_esc(emptyMsg)}</div>`;
                return;
              }

              const margin = { top: 32, right: 160, bottom: 28, left: 160 };
              const width = el.clientWidth || 700;
              const rowH = 18;
              const height = Math.max(shown.length * rowH + margin.top + margin.bottom, 280);

              const svg = d3.select(el).append('svg').attr('width', width).attr('height', height).style('font-family','sans-serif');
              const yScale = d3.scaleLinear().domain([1, shown.length]).range([margin.top, height - margin.bottom]);
              const x1 = margin.left, x2 = width - margin.right;

              svg.append('rect').attr('x',x1-2).attr('y',margin.top-10).attr('width',4)
                .attr('height',height-margin.top-margin.bottom+20).attr('rx',2).attr('fill','rgba(255,255,255,.05)');
              svg.append('rect').attr('x',x2-2).attr('y',margin.top-10).attr('width',4)
                .attr('height',height-margin.top-margin.bottom+20).attr('rx',2).attr('fill','rgba(255,255,255,.05)');

              svg.append('text').attr('x',x1).attr('y',margin.top-16).attr('text-anchor','middle').attr('fill','#94a3b8').attr('font-size',11).attr('font-weight',700).text(colOld);
              svg.append('text').attr('x',x2).attr('y',margin.top-16).attr('text-anchor','middle').attr('fill','#94a3b8').attr('font-size',11).attr('font-weight',700).text(colNew);

              const leftItems = [...shown].sort((a,b) => (a.r1||999) - (b.r1||999));
              const rightItems = [...shown].sort((a,b) => (a.r2||999) - (b.r2||999));
              const leftY = new Map(); leftItems.forEach((it,i) => leftY.set(it.word, yScale(i+1)));
              const rightY = new Map(); rightItems.forEach((it,i) => rightY.set(it.word, yScale(i+1)));

              const _sColor = d => { if(!d.r1) return '#4ade80'; if(!d.r2) return '#f87171'; return d.r2<d.r1?'#4ade80':d.r2>d.r1?'#f87171':'#64748b'; };

              svg.selectAll('.sl').data(shown).enter().append('line')
                .attr('x1',d=>d.r1?x1:x1+20).attr('y1',d=>leftY.get(d.word))
                .attr('x2',d=>d.r2?x2:x2-20).attr('y2',d=>rightY.get(d.word))
                .attr('stroke',_sColor)
                .attr('stroke-width',d=>{const b=Math.min(d.r1||99,d.r2||99);return b<=5?2.5:b<=15?1.8:1.2;})
                .attr('stroke-opacity',d=>{const b=Math.min(d.r1||99,d.r2||99);return b<=10?.8:.45;})
                .attr('stroke-dasharray',d=>(!d.r1||!d.r2)?'4,3':'none');

              // Truncate long labels
              const _trunc = (s, n) => s.length > n ? s.slice(0, n-1) + '\u2026' : s;

              svg.selectAll('.ll').data(shown).enter().append('text')
                .attr('x',x1-10).attr('y',d=>leftY.get(d.word)+4).attr('text-anchor','end').attr('font-size',10)
                .attr('fill',d=>d.r1?'var(--text)':'#f8717188').text(d=>d.r1?_trunc(d.word,22):'');
              svg.selectAll('.rl').data(shown).enter().append('text')
                .attr('x',x1+8).attr('y',d=>leftY.get(d.word)+4).attr('text-anchor','start').attr('font-size',9).attr('fill','#64748b')
                .text(d=>d.r1?'#'+d.r1:'');
              svg.selectAll('.lr').data(shown).enter().append('text')
                .attr('x',x2+10).attr('y',d=>rightY.get(d.word)+4).attr('text-anchor','start').attr('font-size',10)
                .attr('fill',d=>d.r2?'var(--text)':'#f8717188').text(d=>d.r2?_trunc(d.word,22):'');
              svg.selectAll('.rr').data(shown).enter().append('text')
                .attr('x',x2-8).attr('y',d=>rightY.get(d.word)+4).attr('text-anchor','end').attr('font-size',9).attr('fill','#64748b')
                .text(d=>d.r2?'#'+d.r2:'');

              svg.selectAll('.dl').data(shown.filter(d=>d.r1)).enter().append('circle')
                .attr('cx',x1).attr('cy',d=>leftY.get(d.word)).attr('r',3.5).attr('fill',_sColor);
              svg.selectAll('.dr').data(shown.filter(d=>d.r2)).enter().append('circle')
                .attr('cx',x2).attr('cy',d=>rightY.get(d.word)).attr('r',3.5).attr('fill',_sColor);

              const leg = svg.append('g').attr('transform',`translate(${x1},${height-8})`);
              [{c:'#4ade80',l:'Gestiegen / neu'},{c:'#f87171',l:'Gefallen / entfernt'},{c:'#64748b',l:'Unverändert'}].forEach((it,i) => {
                leg.append('line').attr('x1',i*160).attr('x2',i*160+16).attr('y1',0).attr('y2',0).attr('stroke',it.c).attr('stroke-width',2);
                leg.append('text').attr('x',i*160+20).attr('y',3.5).attr('font-size',10).attr('fill','#94a3b8').text(it.l);
              });
            }

            // ── Slope Charts: IDs & HTML ──
            const _ts = Date.now();
            const slopeKwId  = 'wz-slope-kw-'  + _ts;
            const slopeIntId = 'wz-slope-int-' + _ts;
            const slopeExtId = 'wz-slope-ext-' + _ts;

            function _slopeSection(id, title, desc) {
              return `<div style="margin-bottom:24px;">
                <h3 style="margin:0 0 4px;font-size:14px;font-weight:700;color:var(--text);">${title}</h3>
                <p style="margin:0 0 12px;font-size:11px;color:var(--muted);">${desc}</p>
                <div id="${id}" style="width:100%;min-height:380px;"></div>
              </div>`;
            }

            pane.innerHTML = `<div style="display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start;">
              <div style="flex:0 0 auto;min-width:280px;">${tableHtml}</div>
              <div style="flex:1;min-width:300px;">
                ${_slopeSection(slopeKwId,  'Themenverschiebung', 'Top-Keywords nach Gewichtung')}
                ${_slopeSection(slopeIntId, 'Interne Linktexte', 'Ankertexte interner Links')}
                ${_slopeSection(slopeExtId, 'Ausgehende Linktexte', 'Ankertexte externer Links')}
              </div>
            </div>`;

            // Click-Events für Detail-Popups
            pane.querySelectorAll('tr[data-detail-label]').forEach(tr => {
              const label = tr.dataset.detailLabel;
              if (label in _detailData) {
                tr.addEventListener('click', () => _showDetailPopup(label));
              }
            });

            function _renderAllSlopes() {
              _drawSlopeChart(slopeKwId,  t.keywords1, t.keywords2, 'word', 'Keine Keywords extrahiert.');
              _drawSlopeChart(slopeIntId, t.intLinks1, t.intLinks2, 'text', 'Keine internen Links gefunden.');
              _drawSlopeChart(slopeExtId, t.extLinks1, t.extLinks2, 'text', 'Keine ausgehenden Links gefunden.');
            }

            // D3 lazy-load – verzögert, damit pane im DOM ist
            function _triggerSlope() {
              requestAnimationFrame(() => requestAnimationFrame(_renderAllSlopes));
            }
            if (typeof d3 !== 'undefined') {
              _triggerSlope();
            } else {
              const sc = document.createElement('script');
              sc.src = 'https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js';
              sc.onload = _triggerSlope;
              document.head.appendChild(sc);
            }
          } else if (t.isTile) {
            pane.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;">` +
              t.lines.filter(line => /[a-zA-Z0-9\u00C0-\u024F]/.test(line)).map((line, idx) => {
                const esc = line.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
                return `<div data-tile-idx="${idx}" data-orig="${esc.replace(/"/g,'&quot;')}"
                  style="background:var(--surface);border:1px solid ${t.color}44;border-left:3px solid ${t.color};
                  border-radius:6px;padding:7px 10px;color:${t.color};font-size:12px;
                  word-break:break-word;line-height:1.4;"><span>${esc}</span></div>`;
              }).join('') + `</div>`;
          } else {
            pane.style.fontFamily = 'monospace';
            pane.style.padding = '10px 0';
            pane.innerHTML = t.lines.map(line => {
              const esc = line.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
              return `<div style="padding:2px 16px;white-space:pre-wrap;word-break:break-all;color:${t.color};">${esc}</div>`;
            }).join('');
          }
          body.appendChild(pane);
          panes.push(pane);
        });

        // ── Übersetzungs-Funktion einrichten ────────────────────────────
        (function _setupTranslate() {
          const transBtn  = document.getElementById('wz-diff-btn-trans');
          const transMenu = document.getElementById('wz-diff-trans-menu');
          if (!transBtn || !transMenu) return;

          const transLangs = [
            { code:'de',    name:'Deutsch',      flag:'🇩🇪' },
            { code:'en',    name:'Englisch',     flag:'🇺🇸' },
            { code:'fr',    name:'Französisch',  flag:'🇫🇷' },
            { code:'es',    name:'Spanisch',     flag:'🇪🇸' },
            { code:'zh-CN', name:'Chinesisch',   flag:'🇨🇳' },
            { code:'ru',    name:'Russisch',     flag:'🇷🇺' },
          ];

          transMenu.innerHTML = '';
          transLangs.forEach(lang => {
            const item = document.createElement('button');
            item.style.cssText = 'width:100%;text-align:left;padding:6px 10px;background:none;border:none;border-radius:5px;cursor:pointer;font-size:12px;font-family:sans-serif;color:var(--text);display:flex;align-items:center;gap:8px;';
            item.innerHTML = `<span>${lang.flag}</span><span style="font-weight:600;">${_esc(lang.name)}</span>`;
            item.addEventListener('mouseenter', () => { item.style.background = 'var(--surface2)'; });
            item.addEventListener('mouseleave', () => { item.style.background = 'none'; });
            item.addEventListener('click', () => {
              transMenu.style.display = 'none';
              _doTranslate(lang);
            });
            transMenu.appendChild(item);
          });

          const _btnActive   = 'padding:5px 12px;border:1px solid rgba(6,182,212,0.5);border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;background:var(--surface2);color:#06b6d4;';
          const _btnDisabled = 'padding:5px 12px;border:1px solid var(--border);border-radius:6px;font-size:11px;font-weight:600;cursor:default;background:var(--surface2);color:var(--muted);opacity:.4;';

          function _refreshTransBtn() {
            const t = tabs[_activeTabIdx];
            const ok = t && (t.isTile || t.id === 'html-diff');
            transBtn.disabled = !ok;
            transBtn.style.cssText = ok ? _btnActive : _btnDisabled;
            if (!ok) transMenu.style.display = 'none';
          }
          _refreshTransBtn();
          tabBar.querySelectorAll('button').forEach(b => b.addEventListener('click', _refreshTransBtn));

          transBtn.onclick = e => {
            e.stopPropagation();
            if (transBtn.disabled) return;
            transMenu.style.display = transMenu.style.display === 'none' ? 'block' : 'none';
          };

          const _closeMenu = e => {
            const wrap = document.getElementById('wz-diff-trans-wrap');
            if (wrap && !wrap.contains(e.target)) transMenu.style.display = 'none';
          };
          document.addEventListener('click', _closeMenu);
          // Cleanup listener when modal is removed
          const _obs = new MutationObserver(muts => {
            for (const m of muts) for (const n of m.removedNodes)
              if (n.id === 'wz-wb-diff-modal') { document.removeEventListener('click', _closeMenu); _obs.disconnect(); }
          });
          _obs.observe(document.body, { childList: true });

          async function _doTranslate(lang) {
            const t = tabs[_activeTabIdx];
            if (!t) return;

            // ── Kachel-Tabs: Übersetzung direkt in jede Kachel ──────────────
            if (t.isTile) {
              const activePaneEl = panes[_activeTabIdx];
              const tileDivs = Array.from(activePaneEl.querySelectorAll('[data-tile-idx]'));
              if (!tileDivs.length) return;

              // HTML-Entities dekodieren für sauberen API-Input
              const _dec = document.createElement('div');
              const tileTexts = tileDivs.map(el => { _dec.innerHTML = el.dataset.orig; return _dec.textContent; });

              // Spinner in jede Kachel
              tileDivs.forEach(el => {
                el.innerHTML = `<span style="opacity:.5;">${el.dataset.orig}</span>
                  <div style="display:flex;align-items:center;gap:4px;margin-top:5px;opacity:.6;">
                    <div style="width:9px;height:9px;border:1.5px solid var(--border);border-top-color:#06b6d4;
                         border-radius:50%;animation:wz-spin 0.75s linear infinite;flex-shrink:0;"></div>
                    <span style="font-size:10px;color:var(--muted);font-family:sans-serif;">${lang.flag}</span>
                  </div>`;
              });

              try {
                const r = await fetch('/api/translate-content', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ text: tileTexts.join('\n').slice(0, 5000), target: lang.code }),
                });
                const d = await r.json();
                if (!r.ok || d.error) throw new Error(d.error || 'Fehler');

                const translatedLines = d.translated.split('\n');
                tileDivs.forEach((el, i) => {
                  const tr = (translatedLines[i] || '').trim();
                  el.innerHTML = tr
                    ? `<span>${_esc(tr)}</span>
                       <div style="margin-top:5px;padding-top:4px;border-top:1px solid currentColor;
                            opacity:.35;font-size:10px;word-break:break-word;">${el.dataset.orig}</div>`
                    : `<span>${el.dataset.orig}</span>`;
                });
              } catch(err) {
                tileDivs.forEach(el => { el.innerHTML = `<span>${el.dataset.orig}</span>`; });
                alert('Übersetzung fehlgeschlagen: ' + err.message);
              }
              return;
            }

            // ── Andere Tabs: Ergebnis-Panel unterhalb der Tab-Leiste ─────────
            let lines = [];
            if (t.isDiff)        lines = t.lines.filter(l => l.startsWith('+') && !l.startsWith('+++')).map(l => l.slice(1));
            else if (!t.isTracker) lines = t.lines;

            let panel = document.getElementById('wz-diff-trans-result');
            if (!panel) {
              panel = document.createElement('div');
              panel.id = 'wz-diff-trans-result';
              panel.style.cssText = 'border-bottom:1px solid var(--border);background:rgba(6,182,212,.04);padding:10px 14px;flex-shrink:0;font-family:sans-serif;';
              body.insertBefore(panel, body.children[1]);
            }
            panel.style.display = 'block';

            if (!lines.length) {
              panel.innerHTML = `<div style="display:flex;align-items:center;gap:8px;">
                <span style="font-size:12px;color:var(--muted);">Kein übersetzbarer Text in diesem Tab.</span>
                <span style="flex:1;"></span>
                <button onclick="document.getElementById('wz-diff-trans-result').style.display='none'"
                  style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px;line-height:1;">&#10005;</button>
              </div>`;
              return;
            }

            panel.innerHTML = `<div style="display:flex;align-items:center;gap:8px;color:var(--muted);font-size:12px;">
              <div style="width:14px;height:14px;border:2px solid var(--border);border-top-color:#06b6d4;
                   border-radius:50%;animation:wz-spin 0.75s linear infinite;flex-shrink:0;"></div>
              Übersetze ins ${lang.flag} ${_esc(lang.name)}\u2026
            </div>`;

            try {
              const r = await fetch('/api/translate-content', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: lines.join('\n').slice(0, 5000), target: lang.code }),
              });
              const d = await r.json();
              if (!r.ok || d.error) throw new Error(d.error || 'Fehler');

              panel.innerHTML = `
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap;">
                  <span style="font-size:11px;font-weight:700;color:#06b6d4;">${lang.flag} ${_esc(lang.name)}</span>
                  ${d.detected_lang_name ? `<span style="font-size:10px;color:var(--muted);">Originalsprache: ${_esc(d.detected_lang_name)}</span>` : ''}
                  <span style="flex:1;"></span>
                  <button onclick="document.getElementById('wz-diff-trans-result').style.display='none'"
                    style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px;line-height:1;">&#10005;</button>
                </div>
                <div style="font-size:12px;color:var(--text);line-height:1.6;max-height:140px;overflow-y:auto;white-space:pre-wrap;word-break:break-word;">${_esc(d.translated)}</div>`;
            } catch(err) {
              panel.innerHTML = `<div style="display:flex;align-items:center;gap:8px;">
                <span style="color:#ef4444;font-size:12px;">Fehler: ${_esc(err.message)}</span>
                <span style="flex:1;"></span>
                <button onclick="document.getElementById('wz-diff-trans-result').style.display='none'"
                  style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px;line-height:1;">&#10005;</button>
              </div>`;
            }
          }
        })();

      } catch(e) {
        if (body) body.innerHTML = `<div style="color:#ef4444;padding:20px;font-family:sans-serif;">Fehler: ${_esc(e.message)}</div>`;
      }
    }

    let _currentMode = hasPrev ? 1 : 2;
    document.getElementById('wz-diff-btn-prev').addEventListener('click', () => { if (hasPrev && _currentMode !== 1) { _currentMode = 1; _loadDiff(1); } });
    document.getElementById('wz-diff-btn-next').addEventListener('click', () => { if (hasNext && _currentMode !== 2) { _currentMode = 2; _loadDiff(2); } });
    _loadDiff(_currentMode);
  };

})();
