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

        return {
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
