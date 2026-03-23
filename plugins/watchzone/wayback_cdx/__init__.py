"""Wayback CDX Watch Zone Plugin — URL archiving frequency via Wayback Machine CDX API."""

import logging
from datetime import datetime, timedelta, timezone

from flask import jsonify
from plugins import PluginManager
from plugins.watchzone import WatchZonePlugin

log = logging.getLogger(__name__)

UA = "VeriTrend.ai/1.0 (forensic trend analysis; contact@veritrend.ai)"
CDX_API = "https://web.archive.org/cdx/search/cdx"

def _fetch_cdx(url, date_from, date_to, collapse="timestamp:8"):
    """Fetch CDX records for a URL in a date range.

    collapse='timestamp:8' = daily (YYYYMMDD)
    collapse='timestamp:6' = monthly (YYYYMM)
    Returns list of {timestamp, statuscode, digest, length, mimetype}.
    """
    import requests as _rq

    params = {
        "url": url,
        "output": "json",
        "fl": "timestamp,statuscode,digest,length,mimetype",
        "collapse": collapse,
        "from": date_from.replace("-", ""),
        "to": date_to.replace("-", ""),
        "limit": 10000,
    }

    try:
        r = _rq.get(CDX_API, params=params,
                     headers={"User-Agent": UA}, timeout=60)
        r.raise_for_status()
        data = r.json()
    except Exception as exc:
        log.warning("Wayback CDX error for %s: %s", url, exc)
        return {"error": str(exc)[:200]}

    if not data or len(data) < 2:
        return []

    # First row is header
    header = data[0]
    records = []
    for row in data[1:]:
        rec = dict(zip(header, row))
        ts = rec.get("timestamp", "")
        # Format: YYYYMMDDHHmmss → YYYY-MM-DD
        if len(ts) >= 8:
            rec["date"] = f"{ts[:4]}-{ts[4:6]}-{ts[6:8]}"
        else:
            rec["date"] = ts
        rec["length"] = int(rec.get("length") or 0)
        records.append(rec)

    return records

def _fetch_site_tree(domain, limit=500):
    """Fetch unique URLs for a domain and build a site tree structure."""
    import requests as _rq
    from urllib.parse import urlparse
    from collections import Counter

    params = {
        "url": domain + "/*",
        "output": "json",
        "fl": "original,mimetype,statuscode",
        "filter": "statuscode:200",
        "collapse": "urlkey",
        "limit": limit,
    }
    try:
        r = _rq.get(CDX_API, params=params, headers={"User-Agent": UA}, timeout=20)
        r.raise_for_status()
        data = r.json()
    except Exception as exc:
        log.debug("Site tree fetch failed: %s", exc)
        return None

    if not data or len(data) < 2:
        return None

    header = data[0]
    entries = []  # list of {path, mime_type}
    mime_counts = Counter()
    for row in data[1:]:
        rec = dict(zip(header, row))
        orig_url = rec.get("original", "")
        mime = rec.get("mimetype", "")
        if not orig_url:
            continue
        # Reconstruct absolute path from full URL
        parsed = urlparse(orig_url if "://" in orig_url else "https://" + orig_url)
        path = parsed.path or "/"
        # Include query string for unique pages
        if parsed.query:
            path += "?" + parsed.query
        path = path.rstrip("/") or "/"
        # Classify MIME type
        if "html" in mime:
            mt = "HTML"
        elif "css" in mime:
            mt = "CSS"
        elif "javascript" in mime or "js" in mime:
            mt = "JS"
        elif "image" in mime:
            mt = "Bilder"
        elif "pdf" in mime:
            mt = "PDF"
        elif "json" in mime or "xml" in mime:
            mt = "Daten"
        else:
            mt = "Sonstige"
        mime_counts[mt] += 1
        entries.append({"path": path, "mime": mt, "url": orig_url})

    # Build tree with mime info + original URL on leaf nodes
    tree = {}
    for entry in entries:
        parts = [p for p in entry["path"].split("/") if p]
        if not parts:
            parts = ["/"]
        node = tree
        for i, part in enumerate(parts):
            if part not in node:
                node[part] = {"_children": {}, "_mime": None, "_url": None}
            if i == len(parts) - 1:
                node[part]["_mime"] = entry["mime"]
                node[part]["_url"] = entry.get("url", "")
            node = node[part]["_children"]

    # Flatten tree for JSON
    def _flatten(node):
        result = {}
        for key, val in node.items():
            children = _flatten(val.get("_children", {}))
            entry = {"mime": val.get("_mime"), "children": children}
            if val.get("_url"):
                entry["url"] = val["_url"]
            result[key] = entry
        return result

    return {
        "total_urls": len(entries),
        "tree": _flatten(tree),
        "mime_counts": dict(mime_counts),
    }

def _aggregate_daily(records):
    """Count snapshots per day."""
    by_date = {}
    for r in records:
        d = r.get("date", "")[:10]
        if d:
            by_date[d] = by_date.get(d, 0) + 1
    return [{"date": d, "count": c} for d, c in sorted(by_date.items())]

def _aggregate_weekly(records):
    """Count snapshots per ISO week."""
    from datetime import date as _date
    by_week = {}
    for r in records:
        d = r.get("date", "")[:10]
        if not d:
            continue
        try:
            dt = _date.fromisoformat(d)
            # Monday of that week
            monday = dt - timedelta(days=dt.weekday())
            wk = monday.isoformat()
            by_week[wk] = by_week.get(wk, 0) + 1
        except ValueError:
            continue
    return [{"date": d, "count": c} for d, c in sorted(by_week.items())]

class WaybackCDXPlugin(WatchZonePlugin):
    plugin_id = "wayback_cdx"

    meta = {
        "label": "Wayback Frequenz",
        "icon_svg": (
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" '
            'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
            '<circle cx="12" cy="12" r="10"/>'
            '<polyline points="12 6 12 12 16 14"/>'
            '</svg>'
        ),
        "color": "#06b6d4",
        "description": "Wayback Machine Archivierungsfrequenz via CDX API",
        "category": "web",
        "required_credentials": [],
        "has_live": True,
        "has_history": True,
        "has_map": False,
        "panel_template": "wayback_cdx/_panel.html",
        "js_file": "/plugins/watchzone/wayback_cdx/static/wayback_cdx.js",

    }

    def live_handler(self, zone, config, geo, bbox, user_id):
        import json as _j

        url = config.get("url", "")
        if not url:
            return {"error": "Keine URL konfiguriert. Zone bearbeiten und URL eintragen."}

        now = datetime.now(timezone.utc)
        # from/to aus Query-Parametern oder Fallback auf days-Config
        date_from = config.get("from", "")
        date_to = config.get("to", "")
        if not date_from or not date_to:
            days = config.get("days", 365)
            date_to = now.strftime("%Y-%m-%d")
            date_from = (now - timedelta(days=days)).strftime("%Y-%m-%d")

        records = _fetch_cdx(url, date_from, date_to)
        if isinstance(records, dict) and "error" in records:
            return records

        daily = _aggregate_daily(records)
        total = sum(d["count"] for d in daily)
        peak = max((d["count"] for d in daily), default=0)
        peak_date = next((d["date"] for d in daily if d["count"] == peak), "") if peak else ""
        daily_avg = round(total / max(len(daily), 1), 1)

        first_date = records[0]["date"] if records else ""
        last_date = records[-1]["date"] if records else ""

        # Count total archived pages for the whole domain (including subpages)
        domain_total = None
        try:
            from urllib.parse import urlparse
            parsed = urlparse(url if "://" in url else "https://" + url)
            domain = parsed.netloc or parsed.path.split("/")[0]
            if domain:
                import requests as _rq
                _ct_params = {
                    "url": domain + "/*",
                    "output": "json",
                    "fl": "timestamp",
                    "limit": 1,
                    "showNumPages": "true",
                }
                _ct_r = _rq.get(CDX_API, params=_ct_params,
                                headers={"User-Agent": UA}, timeout=15)
                if _ct_r.ok:
                    _ct_data = _ct_r.json()
                    if isinstance(_ct_data, int):
                        domain_total = _ct_data
                    elif isinstance(_ct_data, list) and _ct_data:
                        domain_total = int(_ct_data[0]) if isinstance(_ct_data[0], (int, str)) else None
        except Exception as exc:
            log.debug("Domain page count failed: %s", exc)

        result = {
            "zone_id": zone.id,
            "zone_name": zone.name,
            "zone_type": "wayback_cdx",
            "url": url,
            "count": total,
            "days_with_data": len(daily),
            "daily_avg": daily_avg,
            "peak": peak,
            "peak_date": peak_date,
            "first_date": first_date,
            "last_date": last_date,
            "date_from": date_from,
            "date_to": date_to,
            "daily": daily,
        }
        if domain_total is not None:
            result["domain_total_pages"] = domain_total

        # Fetch site tree structure
        try:
            from urllib.parse import urlparse
            parsed = urlparse(url if "://" in url else "https://" + url)
            domain = parsed.netloc or parsed.path.split("/")[0]
            if domain:
                site_tree = _fetch_site_tree(domain, limit=300)
                if site_tree:
                    result["site_tree"] = site_tree
        except Exception as exc:
            log.debug("Site tree failed: %s", exc)

        return result

    def history_routes(self):
        return [{"suffix": "wayback-frequency", "handler": self._history_handler}]

    def _history_handler(self, zone, args, user_id):
        import json as _j

        config = _j.loads(zone.config) if zone.config else {}
        url = config.get("url", "")
        if not url:
            return jsonify({"error": "Keine URL konfiguriert."}), 400

        date_from = args.get("from", "")
        date_to = args.get("to", "")
        if not date_from or not date_to:
            return jsonify({"error": "Parameter 'from' und 'to' erforderlich"}), 400

        records = _fetch_cdx(url, date_from, date_to)
        if isinstance(records, dict) and "error" in records:
            return jsonify(records), 502

        daily = _aggregate_daily(records)
        data = [{"date": d["date"], "value": d["count"]} for d in daily]

        return jsonify({
            "zone_id": zone.id, "zone_name": zone.name,
            "url": url, "data": data,
        })

    def ai_tools(self):
        return [{
            "name": "wayback_url_frequency",
            "description": "Zeigt wie oft eine URL vom Internet Archive archiviert wurde (Wayback CDX).",
            "input_schema": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "Die zu pruefende URL"},
                    "days": {"type": "integer", "description": "Zeitraum in Tagen (Standard: 365)"},
                },
                "required": ["url"],
            },
        }]

    def ai_tool_handler(self, tool_name, inputs, user_id):
        if tool_name != "wayback_url_frequency":
            return {"error": f"Unbekanntes Tool: {tool_name}"}
        url = inputs.get("url", "")
        if not url:
            return {"error": "URL erforderlich"}
        days = min(inputs.get("days", 365), 3650)
        now = datetime.now(timezone.utc)
        records = _fetch_cdx(url, (now - timedelta(days=days)).strftime("%Y-%m-%d"), now.strftime("%Y-%m-%d"))
        if isinstance(records, dict) and "error" in records:
            return records
        daily = _aggregate_daily(records)
        return {
            "url": url,
            "total_snapshots": sum(d["count"] for d in daily),
            "days_with_snapshots": len(daily),
            "peak_day": max(daily, key=lambda d: d["count"]) if daily else None,
            "daily": daily[-30:],  # last 30 days for AI
        }

    def analysis_provider(self):
        return {"data_types": ["wayback_cdx"], "history_endpoint_suffix": "wayback-frequency"}

PluginManager.register(WaybackCDXPlugin())
