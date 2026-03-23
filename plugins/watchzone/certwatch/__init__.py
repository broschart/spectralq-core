"""Certificate Transparency Watch Zone Plugin — crt.sh Monitoring."""

import logging
from collections import Counter
from datetime import datetime, timedelta, timezone

from flask import jsonify
from plugins import PluginManager
from plugins.watchzone import WatchZonePlugin

log = logging.getLogger(__name__)

UA = "VeriTrend.ai/1.0 (forensic trend analysis; contact@veritrend.ai)"

def _fetch_crtsh(domain, days=None):
    """Fetch certificate transparency entries from crt.sh for a domain."""
    import json as _json
    from urllib.request import Request, urlopen
    from urllib.error import HTTPError, URLError

    cutoff = None
    if days:
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    # urllib übernimmt die URL literal — requests würde % als %25 re-kodieren
    url = f"https://crt.sh/?q=%.{domain}&output=json"
    req = Request(url, headers={"User-Agent": UA, "Accept": "application/json"})

    entries = None
    source = "crt.sh"
    # For large time ranges (>180 days), prefer Certspotter directly (crt.sh returns only newest)
    _use_certspotter_first = days and days > 180
    if not _use_certspotter_first:
        try:
            with urlopen(req, timeout=30) as resp:
                entries = _json.loads(resp.read().decode("utf-8"))
        except (HTTPError, URLError, OSError, Exception) as e:
            log.info("crt.sh failed for %s: %s — trying Certspotter fallback", domain, e)

    # Fallback (or primary for large ranges): Certspotter API
    if not entries:
        source = "certspotter"
        try:
            fb_url = f"https://api.certspotter.com/v1/issuances?domain={domain}&include_subdomains=true&expand=dns_names&expand=issuer"
            fb_req = Request(fb_url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urlopen(fb_req, timeout=20) as resp:
                fb_data = _json.loads(resp.read().decode("utf-8"))
            # Convert Certspotter format to crt.sh-like format
            entries = []
            for item in fb_data:
                dns_names = item.get("dns_names", [])
                issuer = item.get("issuer", {})
                issuer_name = issuer.get("name", "") if isinstance(issuer, dict) else str(issuer)
                not_before = item.get("not_before", "")
                not_after = item.get("not_after", "")
                cn = dns_names[0] if dns_names else ""
                entries.append({
                    "id": item.get("id"),
                    "common_name": cn,
                    "name_value": "\n".join(dns_names),
                    "issuer_name": issuer_name,
                    "not_before": not_before,
                    "not_after": not_after,
                    "serial_number": item.get("tbs_sha256", "")[:20],
                })
        except Exception as exc2:
            return {"domain": domain, "error": f"crt.sh und Certspotter nicht erreichbar. Bitte sp\u00e4ter erneut versuchen. ({str(exc2)[:80]})"}

    # Deduplicate and aggregate
    recent = []
    seen_names = {}  # common_name → earliest entry
    certs_per_day = Counter()
    issuers = Counter()
    issuer_timeline = {}  # date → {issuer → count}
    wildcards = []
    multi_domain = []
    suspicious_subs = []
    durations = []

    _SUSPICIOUS_PREFIXES = {"admin", "staging", "stage", "dev", "test", "vpn", "mail",
                            "smtp", "imap", "pop", "ftp", "api", "internal", "intranet",
                            "portal", "dashboard", "panel", "login", "auth", "sso",
                            "jenkins", "gitlab", "jira", "grafana", "kibana", "phpmyadmin"}

    for e in entries:
        not_before = e.get("not_before") or e.get("entry_timestamp", "")
        not_after = e.get("not_after") or ""
        try:
            dt = datetime.fromisoformat(not_before.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
        except (ValueError, AttributeError):
            continue
        if cutoff and dt < cutoff:
            continue

        name = (e.get("common_name") or "").lower().strip()
        name_value = (e.get("name_value") or "").strip()
        issuer = e.get("issuer_name") or ""
        date_str = dt.strftime("%Y-%m-%d")
        certs_per_day[date_str] += 1

        # Extract short issuer org
        issuer_short = _parse_issuer_org(issuer)
        if issuer_short:
            issuers[issuer_short] += 1
            if date_str not in issuer_timeline:
                issuer_timeline[date_str] = Counter()
            issuer_timeline[date_str][issuer_short] += 1

        # Certificate duration
        try:
            dt_after = datetime.fromisoformat(not_after.replace("Z", "+00:00"))
            if dt_after.tzinfo is None:
                dt_after = dt_after.replace(tzinfo=timezone.utc)
            dur_days = (dt_after - dt).days
            durations.append(dur_days)
        except (ValueError, AttributeError):
            dur_days = None

        # Track new subdomains
        if name and name not in seen_names:
            seen_names[name] = {
                "name": name,
                "first_seen": date_str,
                "issuer": issuer_short or issuer[:60],
                "not_before": not_before[:19],
                "duration_days": dur_days,
            }

        # Wildcard detection
        if name and name.startswith("*."):
            if name not in [w["name"] for w in wildcards]:
                wildcards.append({"name": name, "date": date_str, "issuer": issuer_short or issuer[:60]})

        # Multi-domain certificates (SANs)
        san_names = [n.strip().lower() for n in name_value.replace("\n", " ").split() if n.strip() and "." in n.strip()]
        # Find unique root domains in SANs
        san_roots = set()
        for sn in san_names:
            parts = sn.lstrip("*.").split(".")
            if len(parts) >= 2:
                san_roots.add(".".join(parts[-2:]))
        if len(san_roots) > 1:
            if not any(m["serial"] == e.get("serial_number", "") for m in multi_domain):
                multi_domain.append({
                    "domains": list(san_roots)[:10],
                    "date": date_str,
                    "issuer": issuer_short or issuer[:60],
                    "serial": e.get("serial_number", ""),
                })

        # Suspicious subdomain detection
        if name:
            prefix = name.split(".")[0].lstrip("*").lstrip(".")
            if prefix in _SUSPICIOUS_PREFIXES:
                if name not in [s["name"] for s in suspicious_subs]:
                    suspicious_subs.append({"name": name, "date": date_str, "type": prefix})

        recent.append({
            "id": e.get("id"),
            "common_name": name,
            "name_value": name_value,
            "issuer": issuer_short or issuer[:60],
            "not_before": not_before[:19],
            "not_after": not_after[:19],
            "serial": e.get("serial_number", ""),
            "duration_days": dur_days,
        })

    # Sort subdomains by first_seen descending
    subdomain_list = sorted(seen_names.values(), key=lambda x: x["first_seen"], reverse=True)

    series = [{"date": d, "certs": certs_per_day[d]}
              for d in sorted(certs_per_day.keys())]

    # Issuer changes detection + segments for timeline bar
    issuer_changes = []
    issuer_segments = []  # [{issuer, from, to}]
    sorted_dates = sorted(issuer_timeline.keys())
    prev_top = None
    seg_start = None
    for d in sorted_dates:
        top = issuer_timeline[d].most_common(1)[0][0] if issuer_timeline[d] else None
        if top and top != prev_top:
            if prev_top and seg_start:
                issuer_segments.append({"issuer": prev_top, "from": seg_start, "to": d})
                issuer_changes.append({"date": d, "from": prev_top, "to": top})
            seg_start = d
        prev_top = top
    # Close last segment
    if prev_top and seg_start and sorted_dates:
        issuer_segments.append({"issuer": prev_top, "from": seg_start, "to": sorted_dates[-1]})

    # Duration stats
    avg_duration = round(sum(durations) / len(durations)) if durations else None
    short_certs = sum(1 for d in durations if d <= 90)
    long_certs = sum(1 for d in durations if d > 365)

    return {
        "domain": domain,
        "source": source,
        "total_certs": len(recent),
        "unique_subdomains": len(seen_names),
        "subdomains": subdomain_list[:50],
        "issuers": dict(issuers.most_common(10)),
        "series": series,
        "entries": recent[:300],
        # Forensic analysis
        "wildcards": wildcards[:20],
        "multi_domain": multi_domain[:10],
        "suspicious_subs": suspicious_subs[:20],
        "issuer_changes": issuer_changes[:10],
        "issuer_segments": issuer_segments,
        "avg_duration_days": avg_duration,
        "short_certs": short_certs,
        "long_certs": long_certs,
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

        # Time focus: calculate days to cover the event period
        time_focus = config.get("time_focus")
        days = None
        if time_focus and time_focus.get("from"):
            try:
                tf_from = datetime.strptime(time_focus["from"][:10], "%Y-%m-%d")
                # Cover: 30 days before event to now (or at least 60 days)
                padding = timedelta(days=30)
                dt_from = tf_from - padding
                now = datetime.utcnow()
                days_span = (now - dt_from).days
                days = max(days_span, 60)
                log.info("CT time_focus: from=%s, days=%d", time_focus["from"][:10], days)
            except (ValueError, TypeError) as exc:
                log.debug("CT time_focus parse error: %s", exc)

        results = []
        for dom in domains[:5]:
            d = dom if isinstance(dom, str) else dom.get("domain", "")
            if d:
                results.append(_fetch_crtsh(d, days=days))

        total_certs = sum(r.get("total_certs", 0) for r in results if "error" not in r)
        total_subs = sum(r.get("unique_subdomains", 0) for r in results if "error" not in r)
        result = {
            "zone_id": zone.id, "zone_name": zone.name,
            "zone_type": "certwatch",
            "count": total_certs, "unique_subdomains": total_subs,
            "domains": results,
        }
        if time_focus:
            result["time_focus"] = time_focus
        return result

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
        return {
            "data_types": ["certwatch"],
            "history_endpoint_suffix": "ct-history",
            "analysis_js": "/plugins/watchzone/certwatch/static/certwatch_analysis.js",
            "ui_prefix": "cw",
            "ui_label": "Certwatch (CT)",
            "ui_color": "#14b8a6",
            "zone_types": ["certwatch"],
            "accepts_global": False,
        }

PluginManager.register(CertWatchPlugin())
