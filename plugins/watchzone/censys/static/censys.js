/**
 * WZ Module: censys renderer + zone creation.
 */
(function() {
"use strict";
var WZ = window.WZ;

  // ── Censys Watch Zone ────────────────────────────────────────────────────

  window._wzCnsPreview = function() {
    const country = (document.getElementById("cns-country").value || "").trim().toUpperCase();
    const city    = (document.getElementById("cns-city").value || "").trim();
    const ports   = (document.getElementById("cns-ports").value || "").split(",").map(p => p.trim()).filter(Boolean);
    const service = (document.getElementById("cns-service").value || "").trim();
    const parts = [];
    if (country) parts.push(`location.country_code=${country}`);
    if (city)    parts.push(`location.city="${city}"`);
    if (ports.length === 1) parts.push(`services.port=${ports[0]}`);
    else if (ports.length > 1) parts.push(`(${ports.map(p => "services.port=" + p).join(" or ")})`);
    if (service) parts.push(`services.service_name=${service.toUpperCase()}`);
    document.getElementById("cns-query-preview").textContent = parts.length ? parts.join(" and ") : "";
  }

  window.wzAddCensys = function() {
    ["cns-name","cns-country","cns-city","cns-ports","cns-service"].forEach(id => {
      document.getElementById(id).value = "";
    });
    document.getElementById("cns-query-preview").textContent = "";
    document.getElementById("wz-censys-modal").style.display = "flex";
  };

  window._wzCensysSave = async function() {
    const name    = (document.getElementById("cns-name").value || "").trim();
    const country = (document.getElementById("cns-country").value || "").trim().toUpperCase();
    const city    = (document.getElementById("cns-city").value || "").trim();
    const ports   = (document.getElementById("cns-ports").value || "").split(",").map(p => p.trim()).filter(Boolean);
    const service = (document.getElementById("cns-service").value || "").trim();
    if (!country && !city && !ports.length && !service) {
      alert(t('wz_censys_alert_filter','Please specify at least one filter (country, city, port or service).'));
      return;
    }
    const parts = [];
    if (country) parts.push(`location.country_code=${country}`);
    if (city)    parts.push(`location.city="${city}"`);
    if (ports.length === 1) parts.push(`services.port=${ports[0]}`);
    else if (ports.length > 1) parts.push(`(${ports.map(p => "services.port=" + p).join(" or ")})`);
    if (service) parts.push(`services.service_name=${service.toUpperCase()}`);
    const query = parts.join(" and ");
    const zoneName = name || (country ? `Censys ${country}` : t('wz_censys_default_name','Censys Search')) + (ports.length ? ` :${ports.join(",")}` : "");
    const projectId = document.getElementById("hdr-wz-project")?.value || null;
    document.getElementById("wz-censys-modal").style.display = "none";
    try {
      const r = await fetch("/api/watchzones", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          name: zoneName,
          zone_type: "censys",
          geometry: {},
          config: { source: "censys", query, country_code: country, city, ports: ports.join(","), service },
          project_id: projectId ? parseInt(projectId) : null,
        })
      });
      if (r.ok) {
        const z = await r.json();
        WZ._zones.push(z);
        WZ._renderAllZones();
      } else {
        const err = await r.json();
        alert(t('wz_censys_err_save','Error:') + " " + (err.error || r.status));
      }
    } catch(e) { console.error("Save censys zone error:", e); }
  };

  function _renderCensysLive(data) {
    document.getElementById("wz-live-count").textContent =
      data.count != null ? data.count + " Hosts" : "";
    if (WZ._liveMarkers) WZ._liveMarkers.clearLayers();

    const content = document.getElementById("wz-live-content");
    const items = data.items || [];

    if (!items.length) {
      content.innerHTML = `<div style="padding:32px;text-align:center;color:var(--muted);">
        ${t('wz_censys_no_hosts','No hosts found for:')}<br><code style="font-size:12px;">${WZ._esc(data.query || "")}</code></div>`;
      return;
    }

    content.innerHTML = `
      <div style="padding:12px 16px 6px;font-size:11px;color:var(--muted);font-family:monospace;word-break:break-all;">
        ${t('wz_censys_query_label','Query:')} <span style="color:var(--text);">${WZ._esc(data.query || "")}</span>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead>
          <tr style="border-bottom:1px solid var(--border);color:var(--muted);text-align:left;">
            <th style="padding:6px 12px;">${t('wz_censys_th_ip','IP')}</th>
            <th style="padding:6px 8px;">${t('wz_censys_th_ports','Ports')}</th>
            <th style="padding:6px 8px;">${t('wz_censys_th_services','Services')}</th>
            <th style="padding:6px 8px;">${t('wz_censys_th_org','Organisation')}</th>
            <th style="padding:6px 8px;">${t('wz_censys_th_location','Location')}</th>
            <th style="padding:6px 8px;">${t('wz_censys_th_last_seen','Last Seen')}</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((h, i) => `
          <tr style="border-bottom:1px solid var(--border);${i % 2 === 1 ? "background:rgba(255,255,255,.02);" : ""}">
            <td style="padding:6px 12px;font-family:monospace;color:#e11d48;white-space:nowrap;">${WZ._esc(h.ip)}</td>
            <td style="padding:6px 8px;font-family:monospace;white-space:nowrap;">
              ${(h.ports || []).map(p => `<span style="background:rgba(225,29,72,.15);color:#e11d48;border-radius:3px;padding:1px 5px;margin-right:2px;">${p}</span>`).join("")}
            </td>
            <td style="padding:6px 8px;color:var(--muted);">${WZ._esc((h.services || []).join(", "))}</td>
            <td style="padding:6px 8px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${WZ._esc(h.org || "")}">
              ${h.asn ? `<span style="color:var(--muted);font-size:10px;">AS${h.asn}</span> ` : ""}${WZ._esc(h.org || "–")}
            </td>
            <td style="padding:6px 8px;white-space:nowrap;">
              ${h.country_code ? `<span style="font-size:10px;color:var(--muted);">${WZ._esc(h.country_code)}</span> ` : ""}${WZ._esc(h.city || h.country || "–")}
            </td>
            <td style="padding:6px 8px;color:var(--muted);white-space:nowrap;">${WZ._esc(h.last_updated || "")}</td>
          </tr>`).join("")}
        </tbody>
      </table>`;
  }


  WZ.registerPlugin("censys", {
    renderer: _renderCensysLive,
    has_map: false,
    has_live_map: false,
    mix_global_zones: false,
    default_source: "censys",
    zone_badge: function(z) {
      if (z.config && z.config.query) {
        return '<span class="wz-zone-meta" style="color:#e11d48;font-family:monospace;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' +
          WZ._esc(z.config.query) + '">' + WZ._esc(z.config.query) + '</span>';
      }
      return "";
    },
  });

})();
