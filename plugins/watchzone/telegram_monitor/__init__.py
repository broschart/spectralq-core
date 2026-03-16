"""Telegram Monitoring Watch Zone Plugin — keyword tracking in public channels."""

import logging
from datetime import datetime, timezone

from flask import jsonify, request as flask_request
from plugins import PluginManager
from plugins.watchzone import WatchZonePlugin

log = logging.getLogger(__name__)

class TelegramMonitorPlugin(WatchZonePlugin):
    plugin_id = "telegram_monitor"

    meta = {
        "label": "Telegram",
        "icon_svg": (
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" '
            'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
            '<path d="M21 3L1 11l7 2 2 7 4-5 5 3z"/>'
            '<line x1="10" y1="14" x2="21" y2="3"/>'
            '</svg>'
        ),
        "color": "#0088cc",
        "description": "Telegram-Kanalanalyse — Keyword-Monitoring in oeffentlichen Kanaelen",
        "category": "search",
        "required_credentials": ["telegram_api_id", "telegram_api_hash"],
        "has_live": True,
        "has_history": True,
        "has_map": False,
        "panel_template": "telegram_monitor/_panel.html",
        "js_file": "/plugins/watchzone/telegram_monitor/static/telegram_monitor.js",

    }

    def live_handler(self, zone, config, geo, bbox, user_id):
        import json as _j

        keywords_raw = config.get("keywords", "")
        if isinstance(keywords_raw, list):
            keywords = keywords_raw
        else:
            keywords = [k.strip() for k in keywords_raw.split(",") if k.strip()]

        if not keywords:
            return {"error": "Keine Keywords konfiguriert. Zone bearbeiten und Keywords eintragen."}

        days = config.get("days", 90)

        # Use the existing /api/telegram-mentions endpoint logic
        from transport import _get_credential
        api_id = _get_credential("telegram_api_id", "TELEGRAM_API_ID", user_id)
        api_hash = _get_credential("telegram_api_hash", "TELEGRAM_API_HASH", user_id)
        if not api_id or not api_hash:
            return {"error": "Telegram-API-Credentials fehlen."}

        # Call the telegram search
        import asyncio
        results = []
        try:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            for kw in keywords[:5]:
                data = loop.run_until_complete(
                    _search_telegram_kw(api_id, api_hash, kw, days)
                )
                results.append(data)
            loop.close()
        except Exception as exc:
            log.warning("Telegram monitor error: %s", exc)
            return {"error": str(exc)[:200]}

        return {
            "zone_id": zone.id,
            "zone_name": zone.name,
            "zone_type": "telegram_monitor",
            "keywords": keywords,
            "days": days,
            "count": sum(r.get("total", 0) for r in results),
            "results": results,
        }

    def api_routes(self):
        from plugins.watchzone.telegram_monitor._routes import api_telegram_mentions, api_telegram_auth
        return [
            {"rule": "/api/telegram-mentions", "handler": api_telegram_mentions},
            {"rule": "/api/admin/telegram-auth", "handler": api_telegram_auth, "methods": ["POST"]},
        ]

    def history_routes(self):
        return [{"suffix": "telegram-history", "handler": self._history_handler}]

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

        from transport import _get_credential
        api_id = _get_credential("telegram_api_id", "TELEGRAM_API_ID", user_id)
        api_hash = _get_credential("telegram_api_hash", "TELEGRAM_API_HASH", user_id)
        if not api_id or not api_hash:
            return jsonify({"error": "Telegram-Credentials fehlen."}), 400

        date_from = args.get("from", "")
        date_to = args.get("to", "")

        # Calculate days from date range
        try:
            d_from = datetime.fromisoformat(date_from + "T00:00:00+00:00") if date_from else None
            d_to = datetime.fromisoformat(date_to + "T23:59:00+00:00") if date_to else None
            days = (d_to - d_from).days if d_from and d_to else 90
            days = min(max(days, 7), 365)
        except ValueError:
            days = 90

        import asyncio
        try:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            # Aggregate all keywords
            all_series = {}
            for kw in keywords[:5]:
                data = loop.run_until_complete(
                    _search_telegram_kw(api_id, api_hash, kw, days)
                )
                for pt in data.get("series", []):
                    d = pt["date"]
                    all_series[d] = all_series.get(d, 0) + pt["count"]
            loop.close()
        except Exception as exc:
            return jsonify({"error": str(exc)[:200]}), 502

        result_data = [
            {"date": d, "value": c}
            for d, c in sorted(all_series.items())
        ]

        return jsonify({
            "zone_id": zone.id, "zone_name": zone.name,
            "keywords": keywords, "data": result_data,
        })

    def ai_tools(self):
        return [{
            "name": "telegram_keyword_search",
            "description": "Sucht nach Keyword-Erwaehungen in oeffentlichen Telegram-Kanaelen.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "keywords": {
                        "type": "array", "items": {"type": "string"},
                        "description": "Liste von Suchbegriffen (max 5)",
                    },
                    "days": {
                        "type": "integer",
                        "description": "Zeitraum in Tagen (Standard: 90, max: 365)",
                    },
                },
                "required": ["keywords"],
            },
        }]

    def ai_tool_handler(self, tool_name, inputs, user_id):
        if tool_name != "telegram_keyword_search":
            return {"error": f"Unbekanntes Tool: {tool_name}"}

        from transport import _get_credential
        api_id = _get_credential("telegram_api_id", "TELEGRAM_API_ID", user_id)
        api_hash = _get_credential("telegram_api_hash", "TELEGRAM_API_HASH", user_id)
        if not api_id or not api_hash:
            return {"error": "Telegram-Credentials fehlen."}

        keywords = inputs.get("keywords", [])[:5]
        days = min(inputs.get("days", 90), 365)

        import asyncio
        try:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            results = []
            for kw in keywords:
                data = loop.run_until_complete(
                    _search_telegram_kw(api_id, api_hash, kw, days)
                )
                results.append(data)
            loop.close()
        except Exception as exc:
            return {"error": str(exc)[:200]}

        return {"keywords": keywords, "days": days, "results": results}

    def analysis_provider(self):
        return {"data_types": ["telegram_monitor"], "history_endpoint_suffix": "telegram-history"}

async def _search_telegram_kw(api_id, api_hash, term, days=90):
    """Search public Telegram channels for a keyword. Returns daily counts."""
    import os
    from telethon import TelegramClient
    from datetime import timedelta

    session_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
                                "telegram_session")

    client = TelegramClient(session_path, int(api_id), api_hash)
    await client.connect()

    if not await client.is_user_authorized():
        await client.disconnect()
        return {"term": term, "total": 0, "series": [],
                "error": "Telegram-Session nicht aktiv"}

    now = datetime.now(timezone.utc)
    date_from = now - timedelta(days=days)
    daily = {}

    try:
        offset_date = now
        total = 0
        for page in range(50):
            messages = await client.get_messages(
                None,  # global search
                search=term,
                limit=100,
                offset_date=offset_date,
                min_id=0,
            )
            if not messages:
                break

            for msg in messages:
                if msg.date and msg.date >= date_from:
                    day = msg.date.strftime("%Y-%m-%d")
                    daily[day] = daily.get(day, 0) + 1
                    total += 1

            oldest = messages[-1].date if messages else None
            if not oldest or oldest < date_from:
                break
            offset_date = oldest

            import asyncio
            await asyncio.sleep(0.5)

    except Exception as exc:
        log.warning("Telegram search error for '%s': %s", term, exc)
    finally:
        await client.disconnect()

    series = [{"date": d, "count": c} for d, c in sorted(daily.items())]

    return {
        "term": term,
        "total": sum(c for c in daily.values()),
        "series": series,
    }

PluginManager.register(TelegramMonitorPlugin())
