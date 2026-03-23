/**
 * WZ Module: Certificate Transparency / DNS monitoring via crt.sh.
 */
(function() {
"use strict";
var WZ = window.WZ;
var t = window._t || function(k, fb) { return fb; };

// ── Add Domain Modal ─────────────────────────────────────────────
window.wzAddCertWatch = function() {
  var mid = "wz-add-ct-modal";
  var old = document.getElementById(mid);
  if (old) old.remove();

  var modal = document.createElement("div");
  modal.id = mid;
  modal.style.cssText = "position:fixed;inset:0;z-index:10200;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;";

  modal.innerHTML =
    '<div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;' +
    'width:min(480px,95vw);display:flex;flex-direction:column;' +
    'box-shadow:0 20px 60px rgba(0,0,0,.6);overflow:hidden;">' +

    '<div style="padding:12px 18px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;flex-shrink:0;">' +
      '<span style="font-size:15px;font-weight:700;color:var(--text);">' + t("wz_ct_modal_title", "Monitor Domain") + '</span>' +
      '<span style="flex:1;"></span>' +
      '<button id="wz-act-close" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:20px;line-height:1;">&#10005;</button>' +
    '</div>' +

    '<div style="padding:16px 18px 14px;flex-shrink:0;">' +
      '<div style="margin-bottom:10px;">' +
        '<label style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px;">' + t("wz_ct_lbl_domain", "Domain") + '</label>' +
        '<input id="wz-act-domain" type="text" placeholder="example.com"' +
        ' style="width:100%;box-sizing:border-box;background:var(--bg);border:1px solid var(--border);border-radius:7px;' +
        'padding:8px 12px;font-size:13px;color:var(--text);outline:none;font-family:monospace;">' +
      '</div>' +
      '<div style="display:flex;gap:10px;align-items:flex-end;">' +
        '<div style="flex:1;">' +
          '<label style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px;">' + t("wz_ct_lbl_name", "Watch Zone Name") + '</label>' +
          '<input id="wz-act-name" type="text" placeholder="e.g. Kremlin DNS"' +
          ' style="width:100%;box-sizing:border-box;background:var(--bg);border:1px solid var(--border);border-radius:7px;' +
          'padding:8px 12px;font-size:13px;color:var(--text);outline:none;"' +
          ' oninput="this.dataset.edited=\'1\'">' +
        '</div>' +
        '<button id="wz-act-add" style="padding:8px 20px;background:#14b8a6;color:#fff;border:none;border-radius:7px;' +
        'font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;flex-shrink:0;">' +
          t("wz_ct_add", "+ Add") +
        '</button>' +
      '</div>' +
      '<div id="wz-act-err" style="display:none;margin-top:8px;font-size:12px;color:#f87171;"></div>' +
    '</div>' +
  '</div>';

  document.body.appendChild(modal);

  document.getElementById("wz-act-close").onclick = function() { modal.remove(); };
  modal.addEventListener("click", function(e) { if (e.target === modal) modal.remove(); });

  // Auto-fill name from domain
  document.getElementById("wz-act-domain").addEventListener("input", function() {
    var nameEl = document.getElementById("wz-act-name");
    if (!nameEl.dataset.edited) nameEl.value = this.value.trim();
  });

  // Add button
  document.getElementById("wz-act-add").onclick = async function() {
    var errEl = document.getElementById("wz-act-err");
    errEl.style.display = "none";

    var domain = document.getElementById("wz-act-domain").value.trim().toLowerCase();
    // Strip protocol and path
    domain = domain.replace(/^https?:\/\//, "").split("/")[0].split("?")[0];

    if (!domain) {
      errEl.textContent = t("wz_ct_err_domain", "Please enter a domain.");
      errEl.style.display = "block";
      return;
    }
    // Basic domain validation
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
      errEl.textContent = t("wz_ct_err_invalid", "Invalid domain.");
      errEl.style.display = "block";
      return;
    }

    var nameVal = (document.getElementById("wz-act-name").value || "").trim() || domain;
    var projectId = document.getElementById("hdr-wz-project")?.value || null;
    var geometry = { type: "Polygon", coordinates: [[[-180,-90],[180,-90],[180,90],[-180,90],[-180,-90]]] };

    try {
      var r = await fetch("/api/watchzones", {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          name: nameVal,
          zone_type: "certwatch",
          geometry: geometry,
          config: { domains: [domain] },
          project_id: projectId ? parseInt(projectId) : null,
        })
      });
      if (r.ok) {
        var z = await r.json();
        WZ._zones.push(z);
        WZ._renderAllZones();
        modal.remove();
      }
    } catch(e) { console.error("Save certwatch zone error:", e); }
  };

  setTimeout(function() { document.getElementById("wz-act-domain").focus(); }, 60);
};


// ── Live Renderer ────────────────────────────────────────────────
function _renderCertWatchLive(data) {
  var ctx = WZ._currentCtx;
  ctx.countEl.textContent =
    data.count != null ? data.count + " " + t("wz_ct_live_certs", "Certificates") : "";

  // Hide map
  var mapRow = ctx.mapRowEl;
  if (mapRow) mapRow.style.display = "none";
  var resizeMap = ctx.resizeMapEl;
  if (resizeMap) resizeMap.style.display = "none";

  var content = ctx.contentEl;
  var domains = data.domains || [];

  if (!domains.length) {
    content.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);">' +
      t("wz_ct_live_no_certs", "No certificates in period") + '</div>';
    return;
  }

  var html = '<div style="padding:12px 16px;">';

  for (var i = 0; i < domains.length; i++) {
    var dom = domains[i];
    if (dom.error) {
      html += '<div style="padding:10px;margin-bottom:8px;background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.3);border-radius:8px;font-size:12px;color:#f87171;">' +
        _esc(dom.domain) + ' \u2014 ' + _esc(dom.error) + '</div>';
      continue;
    }

    var totalCerts = dom.total_certs || 0;
    var uniqueSubs = dom.unique_subdomains || 0;
    var subdomains = dom.subdomains || [];
    var issuers = dom.issuers || {};
    var series = dom.series || [];

    // Domain card
    html += '<div style="margin-bottom:12px;background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;">';

    // Header
    html += '<div style="padding:10px 14px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px;">' +
      '<span style="font-size:13px;font-weight:700;color:var(--text);">' + _esc(dom.domain) + '</span>' +
      '<span style="font-size:10px;color:#14b8a6;background:rgba(20,184,166,.12);padding:2px 6px;border-radius:4px;">' + (dom.source === "certspotter" ? 'Certspotter' : 'crt.sh') + '</span>' +
      (dom.source === "certspotter" ? '<span style="font-size:9px;color:var(--muted);margin-left:4px;" title="crt.sh war nicht erreichbar, Daten von Certspotter (SSLMate)">\u26a0 Fallback</span>' : '') +
      '<span style="flex:1;"></span>' +
      '<a href="https://crt.sh/?q=%25.' + encodeURIComponent(dom.domain) + '" target="_blank" rel="noopener"' +
      ' style="font-size:11px;color:var(--accent3);text-decoration:none;">' + t("wz_ct_open_crtsh", "Open on crt.sh") + ' \u2197</a>' +
    '</div>';

    // Stats row
    html += '<div style="padding:10px 14px;display:flex;gap:16px;flex-wrap:wrap;">';
    html += '<div style="text-align:center;">' +
      '<div style="font-size:22px;font-weight:800;color:' + (totalCerts > 20 ? '#14b8a6' : 'var(--text)') + ';">' + totalCerts + '</div>' +
      '<div style="font-size:10px;color:var(--muted);text-transform:uppercase;">' + t("wz_ct_total", "Total") + ' ' + t("wz_ct_live_certs", "Certificates") + '</div>' +
    '</div>';
    html += '<div style="text-align:center;">' +
      '<div style="font-size:22px;font-weight:800;color:' + (uniqueSubs > 10 ? '#f59e0b' : 'var(--text)') + ';">' + uniqueSubs + '</div>' +
      '<div style="font-size:10px;color:var(--muted);text-transform:uppercase;">' + t("wz_ct_unique", "Unique subdomains") + '</div>' +
    '</div>';
    html += '</div>';

    // Sparkline bar chart
    if (series.length > 0) {
      html += '<div style="padding:4px 14px 10px;">';
      var periodLabel = series.length > 1
        ? (window.fmtDateOnly ? window.fmtDateOnly(series[0].date) : series[0].date) + ' – ' +
          (window.fmtDateOnly ? window.fmtDateOnly(series[series.length-1].date) : series[series.length-1].date)
        : '';
      html += '<div style="font-size:10px;color:var(--muted);margin-bottom:4px;">' + t("wz_ct_live_certs", "Certificates") + (periodLabel ? ' \u00b7 ' + periodLabel : '') + '</div>';
      html += _buildSparkBars(series, data.time_focus);
      html += '</div>';
    }

    // Issuers as chips
    var issuerKeys = Object.keys(issuers);
    if (issuerKeys.length) {
      html += '<div style="padding:6px 14px 8px;border-top:1px solid var(--border);">';
      html += '<div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:6px;">' + t("wz_ct_issuers", "Issuers") + '</div>';
      html += '<div style="display:flex;flex-wrap:wrap;gap:5px;">';
      var _issColors = ["#14b8a6","#06b6d4","#8b5cf6","#f59e0b","#22c55e","#ec4899","#ef4444","#3b82f6"];
      for (var k = 0; k < issuerKeys.length; k++) {
        var _ic = _issColors[k % _issColors.length];
        html += '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:12px;border:1px solid ' + _ic + '40;background:' + _ic + '15;font-size:11px;color:' + _ic + ';font-weight:600;">'
          + _esc(issuerKeys[k])
          + '<span style="background:' + _ic + '30;padding:1px 5px;border-radius:8px;font-size:9px;color:' + _ic + ';font-weight:700;">' + issuers[issuerKeys[k]] + '</span></span>';
      }
      html += '</div></div>';
    }

    // Gantt timeline chart — horizontal bars per subdomain
    var entries = dom.entries || [];
    if (entries.length > 1) {
      // Deduplicate by common_name, keep earliest not_before + latest not_after
      var _ganttMap = {};
      entries.forEach(function(e) {
        var cn = e.common_name || "";
        if (!cn || !e.not_before) return;
        if (!_ganttMap[cn]) _ganttMap[cn] = { name: cn, start: e.not_before, end: e.not_after || e.not_before, issuer: e.issuer };
        else {
          if (e.not_before < _ganttMap[cn].start) _ganttMap[cn].start = e.not_before;
          if ((e.not_after || "") > _ganttMap[cn].end) _ganttMap[cn].end = e.not_after || e.not_before;
        }
      });
      var ganttItems = Object.values(_ganttMap).sort(function(a,b) { return a.start.localeCompare(b.start); });
      // Limit to top 60, show in scrollable container
      if (ganttItems.length > 60) ganttItems = ganttItems.slice(0, 60);
      if (ganttItems.length > 0) {
        // Calculate time range
        var allStarts = ganttItems.map(function(g) { return new Date(g.start.replace(" ","T")).getTime(); });
        var allEnds = ganttItems.map(function(g) { return new Date(g.end.replace(" ","T")).getTime(); });
        var tMin = Math.min.apply(null, allStarts);
        var tMax = Math.max.apply(null, allEnds);
        var tRange = tMax - tMin || 86400000;
        var _tf = data.time_focus;
        var _tfFrom = _tf && _tf.from ? new Date(_tf.from.slice(0,10) + "T00:00:00").getTime() : null;

        html += '<div style="padding:6px 14px 10px;border-top:1px solid var(--border);">';
        html += '<div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:6px;">' + t("wz_ct_timeline","Zertifikats-Timeline") + '</div>';
        // X-axis labels
        var _fmtDg = window.fmtDateOnly || function(s) { return s ? s.slice(0,10) : ""; };
        html += '<div style="display:flex;justify-content:space-between;font-size:9px;color:var(--muted);margin-bottom:2px;">';
        html += '<span>' + _fmtDg(new Date(tMin).toISOString()) + '</span>';
        html += '<span>' + _fmtDg(new Date(tMin + tRange/2).toISOString()) + '</span>';
        html += '<span>' + _fmtDg(new Date(tMax).toISOString()) + '</span>';
        html += '</div>';
        // Bars
        html += '<div style="position:relative;border-left:1px solid var(--border);border-right:1px solid var(--border);max-height:400px;overflow-y:auto;">';
        // Focus time marker
        if (_tfFrom && _tfFrom >= tMin && _tfFrom <= tMax) {
          var tfPct = ((_tfFrom - tMin) / tRange) * 100;
          html += '<div style="position:absolute;left:' + tfPct + '%;top:0;bottom:0;width:2px;background:#f59e0b;z-index:2;opacity:.6;" title="' + _esc((_tf.title || 'Event') + ' ' + _tf.from.slice(0,10)) + '"></div>';
        }
        ganttItems.forEach(function(g) {
          var s = new Date(g.start.replace(" ","T")).getTime();
          var e = new Date(g.end.replace(" ","T")).getTime();
          var left = ((s - tMin) / tRange) * 100;
          var width = Math.max(0.5, ((e - s) / tRange) * 100);
          var durD = Math.round((e - s) / 86400000);
          var col = durD <= 90 ? "#f59e0b" : durD > 365 ? "#06b6d4" : "#14b8a6";
          var shortName = g.name.length > 25 ? g.name.substring(0,23) + "\u2026" : g.name;
          var _fD2 = window.fmtDateOnly || function(s) { return s ? s.slice(0,10) : ""; };
          var tipText = g.name + '\n' + _fD2(g.start) + ' \u2192 ' + _fD2(g.end) + ' (' + durD + ' Tage)\nIssuer: ' + g.issuer;
          html += '<div style="display:flex;align-items:center;height:20px;margin-bottom:1px;">';
          html += '<div style="width:180px;flex-shrink:0;font-size:10px;font-family:monospace;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:6px;" title="' + _esc(g.name) + '">' + _esc(shortName) + '</div>';
          html += '<div style="flex:1;position:relative;height:16px;">';
          html += '<div class="wz-ct-gantt-bar" data-name="' + _esc(g.name) + '" style="position:absolute;left:' + left + '%;width:' + width + '%;height:100%;background:' + col + ';border-radius:2px;opacity:.7;cursor:pointer;transition:opacity .15s;" title="' + _esc(tipText) + '">';
          // Show duration inside bar if wide enough
          if (width > 8) html += '<span style="font-size:8px;color:#fff;padding:0 3px;text-shadow:0 0 2px rgba(0,0,0,.8);white-space:nowrap;overflow:hidden;">' + durD + 'd</span>';
          html += '</div>';
          // Show issuer label to the right of bar if space
          html += '<span style="position:absolute;left:' + Math.min(left + width + 0.5, 95) + '%;font-size:8px;color:var(--muted);white-space:nowrap;top:2px;">' + _esc(g.issuer.substring(0, 20)) + '</span>';
          html += '</div></div>';
        });
        html += '</div></div>';
      }
    }

    // Subdomain count info (list removed, details in Gantt hover)
    if (subdomains.length) {
      html += '</div>';
    }

    // ── Forensic Analysis Sections ──

    // Certificate durations
    if (dom.avg_duration_days != null) {
      html += '<div style="padding:6px 14px 8px;border-top:1px solid var(--border);">';
      html += '<div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">' + t("wz_ct_durations","Zertifikats-Laufzeiten") + '</div>';
      html += '<div style="display:flex;gap:14px;flex-wrap:wrap;">';
      html += '<div style="text-align:center;"><div style="font-size:16px;font-weight:700;color:var(--text);">' + dom.avg_duration_days + '</div><div style="font-size:9px;color:var(--muted);">\u00d8 Tage</div></div>';
      if (dom.short_certs) html += '<div style="text-align:center;"><div style="font-size:16px;font-weight:700;color:#f59e0b;">' + dom.short_certs + '</div><div style="font-size:9px;color:var(--muted);">Kurz (\u226490d)</div></div>';
      if (dom.long_certs) html += '<div style="text-align:center;"><div style="font-size:16px;font-weight:700;color:#06b6d4;">' + dom.long_certs + '</div><div style="font-size:9px;color:var(--muted);">Lang (&gt;1J)</div></div>';
      html += '</div></div>';
    }

    // Issuer changes (text only, no timeline bar)
    var issuerChanges = dom.issuer_changes || [];
    if (issuerChanges.length) {
      html += '<div style="padding:6px 14px 8px;border-top:1px solid var(--border);">';
      html += '<div style="font-size:10px;font-weight:700;color:#ef4444;text-transform:uppercase;margin-bottom:4px;">\u26a0 Issuer-Wechsel (' + issuerChanges.length + ')</div>';
      issuerChanges.forEach(function(c) {
        var fmtSeen = window.fmtDateOnly ? window.fmtDateOnly(c.date) : c.date;
        html += '<div style="font-size:12px;padding:3px 0;display:flex;align-items:center;gap:4px;">'
          + '<span style="color:var(--muted);">' + _esc(fmtSeen) + ':</span> '
          + '<span style="color:#ef4444;text-decoration:line-through;">' + _esc(c.from) + '</span>'
          + ' <span style="color:var(--muted);">\u2192</span> '
          + '<span style="color:#22c55e;font-weight:600;">' + _esc(c.to) + '</span>'
          + '</div>';
      });
      html += '</div>';
    }

    // Wildcard certificates
    var wildcards = dom.wildcards || [];
    if (wildcards.length) {
      html += '<div style="padding:6px 14px 8px;border-top:1px solid var(--border);">';
      html += '<div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">' + t("wz_ct_wildcards","Wildcard-Zertifikate") + ' (' + wildcards.length + ')</div>';
      html += '<div style="display:flex;flex-wrap:wrap;gap:4px;">';
      wildcards.forEach(function(w) {
        var fmtSeen = window.fmtDateOnly ? window.fmtDateOnly(w.date) : w.date;
        html += '<span style="font-size:12px;padding:3px 10px;border-radius:8px;background:rgba(139,92,246,.12);border:1px solid rgba(139,92,246,.3);color:#8b5cf6;font-family:monospace;" title="' + _esc(fmtSeen) + ' \u2014 ' + _esc(w.issuer) + '">' + _esc(w.name) + '</span>';
      });
      html += '</div></div>';
    }

    // Suspicious subdomains
    var suspicious = dom.suspicious_subs || [];
    if (suspicious.length) {
      html += '<div style="padding:6px 14px 8px;border-top:1px solid var(--border);">';
      html += '<div style="font-size:10px;font-weight:700;color:#ef4444;text-transform:uppercase;margin-bottom:4px;">\u26a0 ' + t("wz_ct_suspicious","Verd\u00e4chtige Subdomains") + ' (' + suspicious.length + ')</div>';
      html += '<div style="display:flex;flex-wrap:wrap;gap:4px;">';
      suspicious.forEach(function(s) {
        var fmtSeen = window.fmtDateOnly ? window.fmtDateOnly(s.date) : s.date;
        html += '<span style="font-size:12px;padding:3px 10px;border-radius:8px;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);color:#ef4444;font-family:monospace;" title="Typ: ' + _esc(s.type) + ' \u2014 ' + fmtSeen + '">' + _esc(s.name) + '</span>';
      });
      html += '</div></div>';
    }

    // Multi-domain certificates
    // Sankey: Domain → Issuer flow over time
    var _allEntries = dom.entries || [];
    if (_allEntries.length > 2) {
      // Build domain→issuer relationships over time
      var _domIssuerMap = {}; // domain → [{issuer, date}]
      _allEntries.forEach(function(e) {
        if (!e.common_name || !e.issuer || !e.not_before) return;
        var cn = e.common_name;
        if (!_domIssuerMap[cn]) _domIssuerMap[cn] = [];
        _domIssuerMap[cn].push({ issuer: e.issuer, date: e.not_before.slice(0, 10) });
      });
      // Show only domains that had at least one real issuer change
      var _sankeyDomains = [];
      Object.keys(_domIssuerMap).forEach(function(cn) {
        var arr = _domIssuerMap[cn];
        arr.sort(function(a, b) { return a.date.localeCompare(b.date); });
        var steps = [];
        arr.forEach(function(i) { if (!steps.length || steps[steps.length-1].issuer !== i.issuer || steps[steps.length-1].date !== i.date) steps.push(i); });
        // Check if there's at least one actual issuer change
        var hasRealChange = false;
        for (var si = 1; si < steps.length; si++) { if (steps[si].issuer !== steps[si-1].issuer) { hasRealChange = true; break; } }
        if (hasRealChange) _sankeyDomains.push({ name: cn, transitions: steps });
      });

      if (_sankeyDomains.length > 0) {
        html += '<div style="padding:6px 14px 10px;border-top:1px solid var(--border);">';
        html += '<div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:6px;">' + t("wz_ct_sankey","Domain \u2194 Issuer Verlauf") + '</div>';
        html += '<canvas id="wz-ct-sankey-' + i + '" style="width:100%;height:' + Math.max(160, _sankeyDomains.length * 40 + 50) + 'px;"></canvas>';
        html += '</div>';
      }
    }

    html += '</div>'; // card end
  }

  html += '</div>';
  content.innerHTML = html;

  // Render Sankey diagrams
  for (var si = 0; si < domains.length; si++) {
    var _dom = domains[si];
    if (_dom.error) continue;
    var _sCanvas = document.getElementById("wz-ct-sankey-" + si);
    if (!_sCanvas) continue;

    // Rebuild sankey data (same logic as above)
    var _sEntries = _dom.entries || [];
    var _sDomMap = {};
    _sEntries.forEach(function(e) {
      if (!e.common_name || !e.issuer || !e.not_before) return;
      if (!_sDomMap[e.common_name]) _sDomMap[e.common_name] = [];
      _sDomMap[e.common_name].push({ issuer: e.issuer, date: e.not_before.slice(0,10) });
    });
    var _sDomains = [];
    Object.keys(_sDomMap).forEach(function(cn) {
      var arr = _sDomMap[cn]; arr.sort(function(a,b) { return a.date.localeCompare(b.date); });
      // Keep all steps (including same-issuer renewals) — deduplicate only same issuer+date
      var steps = [];
      arr.forEach(function(i) {
        if (!steps.length || steps[steps.length-1].issuer !== i.issuer || steps[steps.length-1].date !== i.date) steps.push(i);
      });
      // Mark which steps are issuer changes
      steps.forEach(function(s, idx) { s.changed = idx > 0 && steps[idx-1].issuer !== s.issuer; });
      var hasChange = steps.some(function(s) { return s.changed; });
      if (hasChange) _sDomains.push({ name: cn, transitions: steps, hasChange: hasChange });
    });
    _sDomains.sort(function(a,b) { return a.name.localeCompare(b.name); });
    if (_sDomains.length > 30) _sDomains = _sDomains.slice(0, 30);
    if (!_sDomains.length) continue;

    // Collect unique issuers + assign colors
    var _sIssColors = {};
    var _sIssCI = 0;
    var _sColPalette = ["#14b8a6","#06b6d4","#8b5cf6","#f59e0b","#22c55e","#ec4899","#ef4444","#3b82f6","#f97316","#84cc16"];
    _sDomains.forEach(function(d) { d.transitions.forEach(function(t) { if (!_sIssColors[t.issuer]) { _sIssColors[t.issuer] = _sColPalette[_sIssCI % _sColPalette.length]; _sIssCI++; } }); });

    // Find max columns (max transitions)
    var _sMaxCols = 0;
    _sDomains.forEach(function(d) { if (d.transitions.length > _sMaxCols) _sMaxCols = d.transitions.length; });

    // Set canvas size
    var _sW = _sCanvas.parentElement.clientWidth || 600;
    var _sH = Math.max(160, _sDomains.length * 40 + 50);
    var dpr = window.devicePixelRatio || 1;
    _sCanvas.width = _sW * dpr;
    _sCanvas.height = _sH * dpr;
    _sCanvas.style.width = _sW + "px";
    _sCanvas.style.height = _sH + "px";
    var ctx2 = _sCanvas.getContext("2d");
    ctx2.scale(dpr, dpr);

    // Layout: domain names on left, then columns for each issuer stage
    var _sLabelW = 160;
    var _sColW = (_sW - _sLabelW - 20) / Math.max(_sMaxCols, 1);
    var _sRowH = 36;
    var _sTopPad = 20;

    // Header: column labels (dates of first transition per column)
    ctx2.font = "10px sans-serif";
    ctx2.fillStyle = "#888";
    ctx2.textAlign = "center";
    for (var ci = 0; ci < _sMaxCols; ci++) {
      var colX = _sLabelW + ci * _sColW + _sColW / 2;
      ctx2.fillText(ci === 0 ? "Initial" : "Wechsel " + ci, colX, 12);
    }

    // Draw rows
    _sDomains.forEach(function(d, di) {
      var y = _sTopPad + di * _sRowH + _sRowH / 2;

      // Domain name
      ctx2.font = "11px monospace";
      ctx2.fillStyle = "#ccc";
      ctx2.textAlign = "right";
      var shortN = d.name.length > 22 ? d.name.substring(0, 20) + "\u2026" : d.name;
      ctx2.fillText(shortN, _sLabelW - 8, y + 4);

      // Draw transition nodes + connecting curves
      d.transitions.forEach(function(t, ti) {
        var x = _sLabelW + ti * _sColW + _sColW / 2;
        var col = _sIssColors[t.issuer] || "#888";

        // Node (rounded rect) — highlight if issuer changed
        var nw = Math.min(_sColW - 10, 100);
        var nh = 20;
        ctx2.fillStyle = t.changed ? "#ef444420" : (col + "30");
        ctx2.strokeStyle = t.changed ? "#ef4444" : col;
        ctx2.lineWidth = t.changed ? 2 : 1;
        ctx2.beginPath();
        ctx2.roundRect(x - nw/2, y - nh/2, nw, nh, 4);
        ctx2.fill();
        ctx2.stroke();

        // Issuer label in node
        ctx2.font = "bold 10px sans-serif";
        ctx2.fillStyle = col;
        ctx2.textAlign = "center";
        var issShort = t.issuer.length > 12 ? t.issuer.substring(0, 10) + "\u2026" : t.issuer;
        ctx2.fillText(issShort, x, y + 3);

        // Date below node
        ctx2.font = "10px sans-serif";
        ctx2.fillStyle = "#666";
        var _fDsk = window.fmtDateOnly ? window.fmtDateOnly(t.date) : t.date;
        ctx2.fillText(_fDsk, x, y + nh/2 + 14);

        // Connecting bezier to next node
        if (ti < d.transitions.length - 1) {
          var nextT = d.transitions[ti + 1];
          var nx = _sLabelW + (ti + 1) * _sColW + _sColW / 2;
          var nCol = _sIssColors[nextT.issuer] || "#888";
          var isChange = nextT.changed;
          ctx2.beginPath();
          ctx2.moveTo(x + nw/2, y);
          var cpx1 = x + nw/2 + (nx - x - nw) * 0.4;
          var cpx2 = nx - nw/2 - (nx - x - nw) * 0.4;
          ctx2.bezierCurveTo(cpx1, y, cpx2, y, nx - nw/2, y);
          ctx2.strokeStyle = isChange ? "#ef4444" : (nCol + "40");
          ctx2.lineWidth = isChange ? 3 : 1;
          if (!isChange) { ctx2.setLineDash([3,3]); }
          ctx2.stroke();
          ctx2.setLineDash([]);

          // Arrow head (only for changes)
          if (isChange) {
            ctx2.beginPath();
            ctx2.moveTo(nx - nw/2 - 2, y - 4);
            ctx2.lineTo(nx - nw/2 + 3, y);
            ctx2.lineTo(nx - nw/2 - 2, y + 4);
            ctx2.fillStyle = "#ef4444";
            ctx2.fill();
          }
        }
      });
    });

    // Legend
    ctx2.font = "10px sans-serif";
    ctx2.textAlign = "left";
    var _sLx = 10;
    var _sLy = _sH - 4;
    Object.keys(_sIssColors).forEach(function(iss) {
      ctx2.fillStyle = _sIssColors[iss];
      ctx2.fillRect(_sLx, _sLy - 8, 8, 8);
      ctx2.fillStyle = "#888";
      ctx2.fillText(iss, _sLx + 12, _sLy);
      _sLx += ctx2.measureText(iss).width + 22;
    });
  }

  // Hover on subdomain rows → highlight corresponding sparkline bar
  var _ctHighlightedBar = null;
  content.querySelectorAll(".wz-ct-sub-row").forEach(function(row) {
    row.addEventListener("mouseenter", function() {
      var date = row.getAttribute("data-date");
      if (!date) return;
      // Reset previous
      if (_ctHighlightedBar) { _ctHighlightedBar.style.background = _ctHighlightedBar.getAttribute("data-orig-bg"); _ctHighlightedBar.style.transform = ""; }
      // Find and highlight bar
      var bar = content.querySelector('.wz-ct-bar[data-date="' + date + '"]');
      if (bar) {
        bar.style.background = "#fff";
        bar.style.transform = "scaleY(1.3)";
        bar.style.transformOrigin = "bottom";
        _ctHighlightedBar = bar;
        // Scroll bar into view if needed
        bar.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      }
      row.style.background = "rgba(255,255,255,.05)";
    });
    row.addEventListener("mouseleave", function() {
      if (_ctHighlightedBar) { _ctHighlightedBar.style.background = _ctHighlightedBar.getAttribute("data-orig-bg"); _ctHighlightedBar.style.transform = ""; _ctHighlightedBar = null; }
      row.style.background = "";
    });
  });

  // Focus time marker line on sparkline
  var _tf = data.time_focus;
  if (_tf && _tf.from) {
    var tfDate = _tf.from.slice(0, 10);
    var tfBar = content.querySelector('.wz-ct-bar[data-date="' + tfDate + '"]');
    if (tfBar) {
      // Add a marker above the event bar
      var marker = document.createElement("div");
      marker.style.cssText = "position:absolute;bottom:100%;left:0;width:100%;text-align:center;pointer-events:none;";
      marker.innerHTML = '<div style="width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid #f59e0b;margin:0 auto;"></div>';
      tfBar.style.position = "relative";
      tfBar.appendChild(marker);
    }
  }
}

function _buildSparkBars(series, timeFocus) {
  var maxCerts = 1;
  for (var i = 0; i < series.length; i++) {
    if (series[i].certs > maxCerts) maxCerts = series[i].certs;
  }
  var tfFrom = timeFocus && timeFocus.from ? timeFocus.from.slice(0, 10) : null;
  var tfTo = timeFocus && timeFocus.to ? timeFocus.to.slice(0, 10) : tfFrom;

  var html = '<div style="display:flex;align-items:flex-end;gap:1px;height:40px;position:relative;">';
  for (var i = 0; i < series.length; i++) {
    var d = series[i];
    var h = Math.max(2, Math.round((d.certs / maxCerts) * 36));
    var isFocus = tfFrom && d.date >= tfFrom && d.date <= (tfTo || tfFrom);
    var clr = isFocus ? "#f59e0b" :
              d.certs === 0 ? "var(--border)" :
              d.certs >= maxCerts * 0.8 ? "#14b8a6" :
              d.certs >= maxCerts * 0.4 ? "#636363" : "var(--muted)";
    var border = isFocus ? "border:1px solid #f59e0b;" : "";
    html += '<div class="wz-ct-bar" data-date="' + d.date + '" data-orig-bg="' + clr + '" title="' + d.date + ': ' + d.certs + ' certs' + (isFocus ? ' (Event)' : '') + '"' +
      ' style="flex:1;min-width:0;height:' + h + 'px;background:' + clr + ';border-radius:2px 2px 0 0;transition:all .15s;' + border + '"></div>';
  }
  html += '</div>';
  return html;
}

function _esc(s) {
  if (!s) return "";
  var d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}


// ── Register Plugin ──────────────────────────────────────────────
WZ.registerPlugin("certwatch", {
  renderer: _renderCertWatchLive,
  has_map: false,
  openStrategy: "spinner",
  live_title_prefix: "DNS / CT:",
  live_title_i18n: "wz_ct_live_title",
  live_box_max_width: "1100px",
});

})();
