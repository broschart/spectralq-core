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
  document.getElementById("wz-live-count").textContent =
    data.count != null ? data.count + " " + t("wz_ct_live_certs", "Certificates") : "";

  // Hide map
  var mapRow = document.getElementById("wz-map-row");
  if (mapRow) mapRow.style.display = "none";
  var resizeMap = document.getElementById("wz-resize-map");
  if (resizeMap) resizeMap.style.display = "none";

  var content = document.getElementById("wz-live-content");
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
      '<span style="font-size:10px;color:#14b8a6;background:rgba(20,184,166,.12);padding:2px 6px;border-radius:4px;">CT Log</span>' +
      '<span style="flex:1;"></span>' +
      '<a href="https://crt.sh/?q=%25.' + encodeURIComponent(dom.domain) + '" target="_blank" rel="noopener"' +
      ' style="font-size:11px;color:var(--accent1);text-decoration:none;">' + t("wz_ct_open_crtsh", "Open on crt.sh") + ' \u2197</a>' +
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
      html += '<div style="font-size:10px;color:var(--muted);margin-bottom:4px;">' + t("wz_ct_live_certs", "Certificates") + ' \u00b7 ' + t("wz_ct_live_period", "last 30 days") + '</div>';
      html += _buildSparkBars(series);
      html += '</div>';
    }

    // Issuers
    var issuerKeys = Object.keys(issuers);
    if (issuerKeys.length) {
      html += '<div style="padding:6px 14px 8px;border-top:1px solid var(--border);">';
      html += '<div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">' + t("wz_ct_issuers", "Issuers") + '</div>';
      for (var k = 0; k < issuerKeys.length; k++) {
        html += '<div style="display:flex;justify-content:space-between;font-size:11px;padding:1px 0;">' +
          '<span style="color:var(--text);">' + _esc(issuerKeys[k]) + '</span>' +
          '<span style="color:var(--muted);">' + issuers[issuerKeys[k]] + '</span></div>';
      }
      html += '</div>';
    }

    // New subdomains list
    if (subdomains.length) {
      html += '<div style="padding:6px 14px 10px;border-top:1px solid var(--border);">';
      html += '<div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">' +
        t("wz_ct_new_subdomains", "New subdomains") + ' (' + subdomains.length + ')</div>';
      var showMax = Math.min(subdomains.length, 20);
      for (var s = 0; s < showMax; s++) {
        var sub = subdomains[s];
        html += '<div style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:11px;border-bottom:1px solid var(--border);">' +
          '<span style="font-family:monospace;color:var(--text);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _esc(sub.name) + '</span>' +
          '<span style="color:var(--muted);flex-shrink:0;font-size:10px;">' + sub.first_seen + '</span>' +
          '<span style="color:var(--muted);flex-shrink:0;font-size:10px;">' + _esc(sub.issuer) + '</span>' +
        '</div>';
      }
      if (subdomains.length > showMax) {
        html += '<div style="font-size:10px;color:var(--muted);padding:4px 0;">+ ' + (subdomains.length - showMax) + ' weitere</div>';
      }
      html += '</div>';
    }

    html += '</div>'; // card end
  }

  html += '</div>';
  content.innerHTML = html;
}

function _buildSparkBars(series) {
  var maxCerts = 1;
  for (var i = 0; i < series.length; i++) {
    if (series[i].certs > maxCerts) maxCerts = series[i].certs;
  }

  var html = '<div style="display:flex;align-items:flex-end;gap:1px;height:40px;">';
  for (var i = 0; i < series.length; i++) {
    var d = series[i];
    var h = Math.max(2, Math.round((d.certs / maxCerts) * 36));
    var clr = d.certs === 0 ? "var(--border)" :
              d.certs >= maxCerts * 0.8 ? "#14b8a6" :
              d.certs >= maxCerts * 0.4 ? "#636363" : "var(--muted)";
    html += '<div title="' + d.date + ': ' + d.certs + ' certs"' +
      ' style="flex:1;min-width:0;height:' + h + 'px;background:' + clr + ';border-radius:2px 2px 0 0;transition:height .2s;"></div>';
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
});

})();
