"""Bluesky Monitoring Watch Zone Plugin — keyword tracking via AT Protocol."""

import logging
import time as _time
from collections import Counter
from datetime import datetime, timedelta, timezone

from flask import jsonify
from plugins import PluginManager
from plugins.watchzone import WatchZonePlugin

log = logging.getLogger(__name__)

def _get_bsky_creds(user_id=None):
    from transport import _get_credential
    handle = _get_credential("bluesky_handle", "BLUESKY_HANDLE", user_id)
    pw = _get_credential("bluesky_app_password", "BLUESKY_APP_PASSWORD", user_id)
    return (handle, pw) if handle and pw else None

def _bsky_search(handle, app_password, term, days=180):
    """Search Bluesky posts for a keyword. Returns daily counts."""
    import requests as _rq

    # Auth
    try:
        sess = _rq.post("https://bsky.social/xrpc/com.atproto.server.createSession",
                         json={"identifier": handle, "password": app_password}, timeout=15)
        sess.raise_for_status()
        token = sess.json().get("accessJwt")
    except Exception as exc:
        return {"term": term, "total": 0, "series": [], "error": f"Login fehlgeschlagen: {str(exc)[:100]}"}

    headers = {"Authorization": f"Bearer {token}"}
    end_dt = datetime.now(timezone.utc)
    start_dt = end_dt - timedelta(days=days)
    posts_per_day = Counter()
    fetched = 0

    try:
        cursor = None
        for _ in range(50):
            params = {"q": term, "limit": 100, "sort": "latest"}
            if cursor:
                params["cursor"] = cursor

            r = _rq.get("https://bsky.social/xrpc/app.bsky.feed.searchPosts",
                         params=params, headers=headers, timeout=20)
            if r.status_code == 429:
                _time.sleep(2)
                continue
            r.raise_for_status()
            data = r.json()
            posts = data.get("posts", [])
            if not posts:
                break

            stop = False
            for post in posts:
                indexed_at = post.get("indexedAt", "")
                if not indexed_at:
                    continue
                day_str = indexed_at[:10]
                if day_str < start_dt.strftime("%Y-%m-%d"):
                    stop = True
                    break
                posts_per_day[day_str] += 1
                fetched += 1

            if stop:
                break
            cursor = data.get("cursor")
            if not cursor:
                break
            _time.sleep(0.3)

    except Exception as exc:
        log.warning("Bluesky search error for '%s': %s", term, exc)

    series = [{"date": d, "count": posts_per_day[d]} for d in sorted(posts_per_day.keys())]
    return {"term": term, "total": fetched, "series": series}

class BlueskyMonitorPlugin(WatchZonePlugin):
    plugin_id = "bluesky_monitor"

    meta = {
        "label": "Bluesky",
        "icon_svg": (
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" '
            'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
            '<path d="M12 3c-3.5 3-7 6.5-7 10a7 7 0 0 0 14 0c0-3.5-3.5-7-7-10z"/>'
            '<path d="M12 13v4"/>'
            '</svg>'
        ),
        "color": "#0085ff",
        "description": "Bluesky-Postanalyse — Keyword-Monitoring via AT Protocol",
        "category": "search",
        "required_credentials": ["bluesky_handle", "bluesky_app_password"],
        "has_live": True,
        "has_history": True,
        "has_map": False,
        "panel_template": "bluesky_monitor/_panel.html",
        "js_file": "/plugins/watchzone/bluesky_monitor/static/bluesky_monitor.js",

    }

    def api_routes(self):
        from plugins.watchzone.bluesky_monitor._routes import api_bluesky_mentions
        return [{"rule": "/api/bluesky-mentions", "handler": api_bluesky_mentions}]

    def live_handler(self, zone, config, geo, bbox, user_id):
        import json as _j

        keywords_raw = config.get("keywords", "")
        if isinstance(keywords_raw, list):
            keywords = keywords_raw
        else:
            keywords = [k.strip() for k in keywords_raw.split(",") if k.strip()]

        if not keywords:
            return {"error": "Keine Keywords konfiguriert. Zone bearbeiten und Keywords eintragen."}

        days = config.get("days", 180)
        creds = _get_bsky_creds(user_id)
        if not creds:
            return {"error": "Bluesky-Zugangsdaten fehlen (Handle + App-Password unter Plugins)."}

        results = []
        for kw in keywords[:5]:
            data = _bsky_search(creds[0], creds[1], kw, days)
            results.append(data)

        return {
            "zone_id": zone.id,
            "zone_name": zone.name,
            "zone_type": "bluesky_monitor",
            "keywords": keywords,
            "days": days,
            "count": sum(r.get("total", 0) for r in results),
            "results": results,
        }

    def history_routes(self):
        return [{"suffix": "bluesky-history", "handler": self._history_handler}]

    def _history_handler(self, zone, args, user_id):
        import json as _j

        config = _j.loads(zone.config) if zone.config else {}
        keywords_raw = config.get("keywords", "")
        if isinstance(keywords_raw, list):
            keywords = keywords_raw
        else:
            keywords = [k.strip() for k in keywords_raw.split(",") if k.strip()]

        if not keywords:
            return jsonify({"error": "Keine Keywords konfiguriert."}), 400

        creds = _get_bsky_creds(user_id)
        if not creds:
            return jsonify({"error": "Bluesky-Credentials fehlen."}), 400

        date_from = args.get("from", "")
        date_to = args.get("to", "")
        try:
            d_from = datetime.fromisoformat(date_from + "T00:00:00+00:00") if date_from else None
            d_to = datetime.fromisoformat(date_to + "T23:59:00+00:00") if date_to else None
            days = (d_to - d_from).days if d_from and d_to else 180
            days = min(max(days, 7), 365)
        except ValueError:
            days = 180

        all_series = {}
        for kw in keywords[:5]:
            data = _bsky_search(creds[0], creds[1], kw, days)
            for pt in data.get("series", []):
                d = pt["date"]
                all_series[d] = all_series.get(d, 0) + pt["count"]

        result_data = [{"date": d, "value": c} for d, c in sorted(all_series.items())]

        return jsonify({
            "zone_id": zone.id, "zone_name": zone.name,
            "keywords": keywords, "data": result_data,
        })

    def ai_tools(self):
        return [{
            "name": "bluesky_keyword_search",
            "description": "Sucht nach Keyword-Erwaehungen auf Bluesky (AT Protocol).",
            "input_schema": {
                "type": "object",
                "properties": {
                    "keywords": {"type": "array", "items": {"type": "string"}, "description": "Suchbegriffe (max 5)"},
                    "days": {"type": "integer", "description": "Zeitraum in Tagen (Standard: 180, max: 365)"},
                },
                "required": ["keywords"],
            },
        }]

    def ai_tool_handler(self, tool_name, inputs, user_id):
        if tool_name != "bluesky_keyword_search":
            return {"error": f"Unbekanntes Tool: {tool_name}"}
        creds = _get_bsky_creds(user_id)
        if not creds:
            return {"error": "Bluesky-Credentials fehlen."}
        keywords = inputs.get("keywords", [])[:5]
        days = min(inputs.get("days", 180), 365)
        results = [_bsky_search(creds[0], creds[1], kw, days) for kw in keywords]
        return {"keywords": keywords, "days": days, "results": results}

    def analysis_provider(self):
        return {"data_types": ["bluesky_monitor"], "history_endpoint_suffix": "bluesky-history"}

PluginManager.register(BlueskyMonitorPlugin())
