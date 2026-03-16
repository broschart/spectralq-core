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

    const fmtSnap = s => s ? (s.date + (s.time ? ' ' + s.time.slice(0,5) : '')) : null;
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
          <a href="${_esc(pageUrl)}" target="_blank" rel="noopener"
             style="font-size:11px;color:#06b6d4;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px;"
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
        if (!data.sections || data.sections.length === 0) {
          body.style.cssText += 'display:flex;align-items:center;justify-content:center;';
          body.innerHTML = `<div style="color:var(--muted);font-size:13px;font-family:sans-serif;">${_esc(data.info || 'Keine Unterschiede gefunden.')}</div>`;
          return;
        }

        const _rawNew = [...(data.js_raw || []), ...(data.css_raw || [])];
        const _rawOld = [...(data.js_raw1 || []), ...(data.css_raw1 || [])];
        const _hitsNew = _scanRaw(_rawNew);
        const _hitsOld = _scanRaw(_rawOld);
        const allTrackerHits = [];
        for (const [key, h] of _hitsNew)
          allTrackerHits.push({ ...h, status: _hitsOld.has(key) ? 'unchanged' : 'new' });
        for (const [key, h] of _hitsOld)
          if (!_hitsNew.has(key)) allTrackerHits.push({ ...h, status: 'removed' });

        const allTabs = [
          { id:'html-add',  label:'Content neu',         lines:_collectLines(data.sections,['html'],'+'),     color:'#4ade80', isDiff:false, isTile:true,      mode2:false },
          { id:'html-del',  label: mode === 2 ? 'Content wird entfernt' : 'Content entfernt', lines:_collectLines(data.sections,['html'],'-'), color:'#f87171', isDiff:false, isTile:true, mode2:true },
          { id:'html-diff', label:'Content-Diff',        lines:_collectDiffLines(data.sections,['html']),     color:'#60a5fa', isDiff:true,  isTile:false,     mode2:true  },
          { id:'code-add',  label:'Code neu',            lines:_collectLines(data.sections,['js','css'],'+'), color:'#34d399', isDiff:false, isTile:false,     mode2:false },
          { id:'code-del',  label: mode === 2 ? 'Code wird entfernt' : 'Code entfernt', lines:_collectLines(data.sections,['js','css'],'-'), color:'#fb923c', isDiff:false, isTile:false, mode2:true },
          { id:'code-diff', label:'Code-Diff',           lines:_collectDiffLines(data.sections,['js','css']), color:'#a78bfa', isDiff:true,  isTile:false,     mode2:true  },
          { id:'tracker',   label:'\uD83D\uDCE1 Tracker', trackers:allTrackerHits, lines:[], color:'#06b6d4', isTracker:true, isDiff:false, isTile:false,     mode2:true  },
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
          const count = t.isTracker ? t.trackers.length : t.isDiff ? '\u0394' : t.lines.filter(l => !l.startsWith('@@') && !l.startsWith('+++') && !l.startsWith('---')).length;
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
          if (!t.lines.length && !t.isTracker) {
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
            const statusLabel = { new:'neu', removed:'entfernt', unchanged:'vorhanden' };
            const statusColor = { new:'#4ade80', removed:'#f87171', unchanged:'#64748b' };
            if (!t.trackers.length) {
              pane.innerHTML = '<div style="padding:30px;color:var(--muted);text-align:center;font-family:sans-serif;">Im aktuellen Snapshot wurden keine bekannten Tracker erkannt.</div>';
            } else {
              const byNew     = t.trackers.filter(h => h.status === 'new');
              const byRemoved = t.trackers.filter(h => h.status === 'removed');
              const byPresent = t.trackers.filter(h => h.status === 'unchanged');
              function _chip(h) {
                const idEsc = h.id.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
                return `<div style="background:var(--surface);border:1px solid ${h.color}55;border-left:3px solid ${h.color};
                  border-radius:6px;padding:8px 12px;font-family:sans-serif;font-size:12px;line-height:1.5;min-width:160px;max-width:260px;">
                  <div style="font-weight:700;color:${h.color};">${_esc(h.name)}</div>
                  <div style="color:var(--text);font-family:monospace;font-size:10px;word-break:break-all;margin-top:2px;">${idEsc}</div>
                </div>`;
              }
              function _section(label, color, items) {
                if (!items.length) return '';
                return `<div style="margin-bottom:14px;">
                  <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:${color};margin-bottom:6px;font-family:sans-serif;">${label} (${items.length})</div>
                  <div style="display:flex;flex-wrap:wrap;gap:6px;">${items.map(_chip).join('')}</div>
                </div>`;
              }
              const tagManagers = t.trackers.filter(h =>
                ['Google Tag Manager','Tealium'].includes(h.name)
              );
              const tagMgrHint = tagManagers.length
                ? `<div style="margin-bottom:12px;padding:8px 12px;background:rgba(251,146,60,.08);border:1px solid rgba(251,146,60,.3);border-left:3px solid #fb923c;border-radius:6px;font-family:sans-serif;font-size:11px;color:#fb923c;">
                    <b>Hinweis:</b> ${tagManagers.map(h => h.name).join(', ')} erkannt &mdash; weitere Tracker k&ouml;nnen dynamisch nachgeladen werden und sind im Quelltext nicht sichtbar.
                  </div>` : '';
              pane.innerHTML = tagMgrHint +
                _section('Neu hinzugekommen', '#4ade80', byNew) +
                _section('Entfernt', '#f87171', byRemoved) +
                _section('Vorhanden', '#64748b', byPresent);
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
