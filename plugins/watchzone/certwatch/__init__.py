"""Certificate Transparency Watch Zone Plugin — crt.sh Monitoring."""

import logging
from collections import Counter
from datetime import datetime, timedelta, timezone

from flask import jsonify
from plugins import PluginManager
from plugins.watchzone import WatchZonePlugin

log = logging.getLogger(__name__)

UA = "VeriTrend.ai/1.0 (forensic trend analysis; contact@veritrend.ai)"

def _fetch_crtsh(domain, days=30):
    """Fetch certificate transparency entries from crt.sh for a domain."""
    import requests as _rq

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    url = "https://crt.sh/"
    params = {
        "q": f"%.{domain}",
        "output": "json",
    }

    try:
        r = _rq.get(url, params=params, headers={"User-Agent": UA}, timeout=30)
        r.raise_for_status()
        entries = r.json()
    except Exception as exc:
        return {"domain": domain, "error": str(exc)[:200]}

    # Filter to recent entries and deduplicate
    recent = []
    seen_names = {}  # common_name → earliest entry
    certs_per_day = Counter()
    issuers = Counter()
    new_subdomains = []

    for e in entries:
        not_before = e.get("not_before") or e.get("entry_timestamp", "")
        try:
            dt = datetime.fromisoformat(not_before.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
        except (ValueError, AttributeError):
            continue
        if dt < cutoff:
            continue

        name = (e.get("common_name") or "").lower().strip()
        issuer = e.get("issuer_name") or ""
        date_str = dt.strftime("%Y-%m-%d")
        certs_per_day[date_str] += 1

        # Extract short issuer org
        issuer_short = _parse_issuer_org(issuer)
        if issuer_short:
            issuers[issuer_short] += 1

        # Track new subdomains
        if name and name not in seen_names:
            seen_names[name] = {
                "name": name,
                "first_seen": date_str,
                "issuer": issuer_short or issuer[:60],
                "not_before": not_before[:19],
            }

        recent.append({
            "id": e.get("id"),
            "common_name": name,
            "name_value": (e.get("name_value") or "").strip(),
            "issuer": issuer_short or issuer[:60],
            "not_before": not_before[:19],
            "not_after": (e.get("not_after") or "")[:19],
            "serial": e.get("serial_number", ""),
        })

    # Sort subdomains by first_seen descending
    subdomain_list = sorted(seen_names.values(), key=lambda x: x["first_seen"], reverse=True)

    series = [{"date": d, "certs": certs_per_day[d]}
              for d in sorted(certs_per_day.keys())]

    return {
        "domain": domain,
        "total_certs": len(recent),
        "unique_subdomains": len(seen_names),
        "subdomains": subdomain_list[:50],
        "issuers": dict(issuers.most_common(10)),
        "series": series,
        "entries": recent[:100],
    }

def _parse_issuer_org(issuer_dn):
    """Extract O= value from issuer DN string."""
    for part in issuer_dn.split(","):
        part = part.strip()
        if part.upper().startswith("O="):
            return part[2:].strip()
    return ""

class CertWatchPlugin(WatchZonePlugin):
    plugin_id = "certwatch"

    meta = {
        "label": "DNS / CT",
        "icon_svg": (
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" '
            'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
            '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>'
            '<path d="M7 11V7a5 5 0 0 1 10 0v4"/>'
            '<circle cx="12" cy="16" r="1"/>'
            '</svg>'
        ),
        "color": "#14b8a6",
        "description": "Certificate Transparency Monitoring via crt.sh",
        "category": "web",
        "required_credentials": [],
        "has_live": True,
        "has_history": True,
        "panel_template": "certwatch/_panel.html",
        "js_file": "/plugins/watchzone/certwatch/static/certwatch.js",

    }

    def live_handler(self, zone, config, geo, bbox, user_id):
        domains = config.get("domains", [])
        if not domains:
            return {"error": "Keine Domains konfiguriert"}

        results = []
        for dom in domains[:5]:
            d = dom if isinstance(dom, str) else dom.get("domain", "")
            if d:
                results.append(_fetch_crtsh(d, days=30))

        total_certs = sum(r.get("total_certs", 0) for r in results if "error" not in r)
        total_subs = sum(r.get("unique_subdomains", 0) for r in results if "error" not in r)
        return {
            "zone_id": zone.id, "zone_name": zone.name,
            "zone_type": "certwatch",
            "count": total_certs, "unique_subdomains": total_subs,
            "domains": results,
        }

    def history_routes(self):
        return [
            {"suffix": "ct-history", "handler": self._history_handler},
        ]

    def _history_handler(self, zone, args, user_id):
        import json as _j
        config = _j.loads(zone.config) if zone.config else {}
        domains = config.get("domains", [])
        days_str = args.get("days", "90")
        days = min(int(days_str), 365)
        if not domains:
            return jsonify({"error": "Keine Domains konfiguriert"}), 400

        results = []
        for dom in domains[:5]:
            d = dom if isinstance(dom, str) else dom.get("domain", "")
            if d:
                results.append(_fetch_crtsh(d, days=days))

        return jsonify({"zone_id": zone.id, "zone_name": zone.name, "domains": results})

    def ai_tools(self):
        return [{
            "name": "get_cert_transparency",
            "description": "Ruft Certificate-Transparency-Daten (crt.sh) fuer konfigurierte Domains einer Watch Zone ab.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "zone_id": {"type": "integer", "description": "ID der Watch Zone"},
                    "days": {"type": "integer", "description": "Anzahl Tage (Standard: 30, max: 365)"},
                },
                "required": ["zone_id"],
            },
        }]

    def ai_tool_handler(self, tool_name, inputs, user_id):
        if tool_name != "get_cert_transparency":
            return {"error": f"Unbekanntes Tool: {tool_name}"}
        import json as _j
        from models import WatchZone
        z = WatchZone.query.filter_by(id=inputs["zone_id"], user_id=user_id).first()
        if not z:
            return {"error": f"Zone {inputs['zone_id']} nicht gefunden"}
        cfg = _j.loads(z.config) if z.config else {}
        domains = cfg.get("domains", [])
        days = min(int(inputs.get("days", 30)), 365)
        results = []
        for dom in domains[:5]:
            d = dom if isinstance(dom, str) else dom.get("domain", "")
            if d:
                results.append(_fetch_crtsh(d, days=days))
        return {"zone_id": z.id, "zone_name": z.name, "domains": results}

    def analysis_provider(self):
        return {"data_types": ["certwatch"], "history_endpoint_suffix": "ct-history"}

PluginManager.register(CertWatchPlugin())
