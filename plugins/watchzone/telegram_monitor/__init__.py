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
        "credential_group": "telegram",
        "availability_key": "telegram",
        "has_live": True,
        "has_history": True,
        "has_map": False,
        "panel_template": "telegram_monitor/_panel.html",
        "js_file": "/plugins/watchzone/telegram_monitor/static/telegram_monitor.js",

    }

    def live_handler(self, zone, config, geo, bbox, user_id):
        import json as _j
        from plugins.watchzone.telegram_monitor._cache import get as cache_get, put as cache_put

        # Check cache first
        cached = cache_get(zone.id, config)
        if cached:
            log.info("Telegram CACHE HIT for zone %s (%s)", zone.id, zone.name)
            return cached
        log.info("Telegram CACHE MISS for zone %s (%s) — fetching from Telegram", zone.id, zone.name)

        keywords_raw = config.get("keywords", "") or config.get("search", "")
        if isinstance(keywords_raw, list):
            keywords = keywords_raw
        else:
            keywords = [k.strip() for k in keywords_raw.split(",") if k.strip()]

        # If source_zone_id is set, inherit channels from that zone
        source_zone_id = config.get("source_zone_id")
        if source_zone_id and not config.get("channels"):
            try:
                import json as _jj
                from models import WatchZone
                src_zone = WatchZone.query.get(source_zone_id)
                if src_zone and src_zone.config:
                    src_cfg = _jj.loads(src_zone.config)
                    if src_cfg.get("channels"):
                        config["channels"] = src_cfg["channels"]
                    if not keywords and src_cfg.get("keywords"):
                        keywords_raw = src_cfg["keywords"]
                        if isinstance(keywords_raw, list):
                            keywords = keywords_raw
                        else:
                            keywords = [k.strip() for k in keywords_raw.split(",") if k.strip()]
            except Exception:
                pass

        if not keywords:
            return {"error": "Keine Keywords konfiguriert. Bitte Suchbegriff eingeben."}

        days = config.get("days", 7)

        # Use the existing /api/telegram-mentions endpoint logic
        from transport import _get_credential
        api_id = _get_credential("telegram_api_id", "TELEGRAM_API_ID", user_id)
        api_hash = _get_credential("telegram_api_hash", "TELEGRAM_API_HASH", user_id)
        if not api_id or not api_hash:
            return {"error": "Telegram-API-Credentials fehlen."}

        channels = config.get("channels", [])
        if isinstance(channels, str):
            channels = [c.strip() for c in channels.split(",") if c.strip()]

        # Determine user's UI language for translation
        ui_lang = "de"
        try:
            from models import AppSetting
            obj = AppSetting.query.filter_by(key="ui_language", user_id=user_id).first()
            if obj and obj.value:
                ui_lang = obj.value
            else:
                obj = AppSetting.query.filter_by(key="ui_language", user_id=None).first()
                if obj and obj.value:
                    ui_lang = obj.value
        except Exception:
            pass

        # Compute date range from time_focus if present (only if explicitly set, not inherited)
        from datetime import timedelta
        import json as _j2
        _own_config = _j2.loads(zone.config) if zone.config else {}
        date_from_override = None
        date_to_override = None
        tf = _own_config.get("time_focus")
        if tf and tf.get("from"):
            try:
                tf_from_str = tf["from"]
                tf_to_str = tf.get("to") or tf_from_str
                # Parse dates (YYYY-MM-DD or YYYY-MM-DDTHH:MM)
                def _parse_dt(s, default_time="00:00:00"):
                    dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=timezone.utc)
                    return dt
                tf_dt = _parse_dt(tf_from_str)
                tf_dt_to = _parse_dt(tf_to_str)
                # Extend range: days before from, days after to
                padding = timedelta(days=days)
                date_from_override = tf_dt - padding
                date_to_override = tf_dt_to + padding
            except (ValueError, TypeError) as exc:
                log.debug("time_focus parse error: %s", exc)

        # Call the telegram search
        import asyncio
        results = []
        try:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            for kw in keywords[:5]:
                data = loop.run_until_complete(
                    _search_telegram_kw(api_id, api_hash, kw, days, channels=channels,
                                        ui_lang=ui_lang,
                                        date_from_override=date_from_override,
                                        date_to_override=date_to_override)
                )
                results.append(data)

            loop.close()
        except Exception as exc:
            log.warning("Telegram monitor error: %s", exc)
            return {"error": str(exc)[:200]}

        # Collect and deduplicate messages across keywords
        all_msgs = []
        _seen_msgs = set()
        geo_locations = []
        for r in results:
            for m in r.get("messages", []):
                key = (m.get("date", ""), m.get("text", "")[:100])
                if key not in _seen_msgs:
                    _seen_msgs.add(key)
                    all_msgs.append(m)
            geo_locations.extend(r.get("geo_media", []))

        geo_events = []
        if all_msgs:
            try:
                from plugins.watchzone.telegram_monitor._geo import extract_locations
                text_locations, text_events = extract_locations(all_msgs)
                geo_locations.extend(text_locations)
                geo_events.extend(text_events)
            except Exception as exc:
                log.warning("Geo-extraction failed: %s", exc)

        result = {
            "zone_id": zone.id,
            "zone_name": zone.name,
            "zone_type": "telegram_monitor",
            "keywords": keywords,
            "channels": channels,
            "days": days,
            "time_focus": tf if tf else None,
            "count": sum(r.get("total", 0) for r in results),
            "results": results,
            "geo_locations": geo_locations,
            "geo_events": geo_events,
        }

        # Cache result (24h)
        cache_put(zone.id, config, result)

        return result

    def api_routes(self):
        from plugins.watchzone.telegram_monitor._routes import (
            api_telegram_mentions, api_telegram_auth, api_telegram_channels,
        )
        from plugins.watchzone.telegram_monitor._routes import api_telegram_translate_kw, api_telegram_day_messages
        return [
            {"rule": "/api/telegram-mentions", "handler": api_telegram_mentions},
            {"rule": "/api/admin/telegram-auth", "handler": api_telegram_auth, "methods": ["POST"]},
            {"rule": "/api/admin/telegram-channels", "handler": api_telegram_channels, "methods": ["GET", "POST"]},
            {"rule": "/api/telegram-translate-kw", "handler": api_telegram_translate_kw},
            {"rule": "/api/telegram-day-messages", "handler": api_telegram_day_messages},
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

        channels = config.get("channels", [])
        if isinstance(channels, str):
            channels = [c.strip() for c in channels.split(",") if c.strip()]

        import asyncio
        try:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            # Aggregate all keywords
            all_series = {}
            for kw in keywords[:5]:
                data = loop.run_until_complete(
                    _search_telegram_kw(api_id, api_hash, kw, days, channels=channels)
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
            "description": (
                "Sucht nach Keyword-Erwaehungen in oeffentlichen Telegram-Kanaelen. "
                "Optional auf bestimmte Kanaele einschraenkbar."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "keywords": {
                        "type": "array", "items": {"type": "string"},
                        "description": "Liste von Suchbegriffen (max 5)",
                    },
                    "channels": {
                        "type": "array", "items": {"type": "string"},
                        "description": "Optionale Liste von Kanal-Usernames (ohne @). Leer = globale Suche.",
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
        channels = inputs.get("channels", [])
        days = min(inputs.get("days", 90), 365)

        import asyncio
        try:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            results = []
            for kw in keywords:
                data = loop.run_until_complete(
                    _search_telegram_kw(api_id, api_hash, kw, days, channels=channels)
                )
                results.append(data)
            loop.close()
        except Exception as exc:
            return {"error": str(exc)[:200]}

        return {"keywords": keywords, "channels": channels, "days": days, "results": results}

    def scheduler_jobs(self):
        try:
            from plugins.watchzone.telegram_monitor._cache import cleanup
            return [
                {"func": cleanup, "trigger": "interval", "hours": 1, "id": "tg_cache_cleanup", "replace_existing": True}
            ]
        except Exception:
            return []

    def analysis_provider(self):
        return {
            "data_types": ["telegram_monitor"],
            "history_endpoint_suffix": "telegram-history",
            "analysis_js": "/plugins/watchzone/telegram_monitor/static/telegram_monitor_analysis.js",
            "ui_prefix": "tgm",
            "ui_label": "Telegram Monitor",
            "ui_color": "#0088cc",
            "zone_types": ["telegram_monitor"],
            "accepts_global": False,
        }

async def _search_telegram_kw(api_id, api_hash, term, days=7, channels=None,
                              ui_lang="de", max_messages=0,
                              date_from_override=None, date_to_override=None):
    """Search public Telegram channels for a keyword.

    Returns daily counts + recent messages with auto-translation.

    Args:
        channels: Optional list of channel usernames (without @).
                  If empty/None, performs global search.
        ui_lang:  Target language for translation (ISO code, e.g. 'de', 'en').
        max_messages: Max number of recent messages to return with text (0=unlimited).
        date_from_override: Optional explicit start datetime (overrides days).
        date_to_override: Optional explicit end datetime (overrides now).
    """
    import os
    import asyncio as _aio
    from telethon import TelegramClient
    from telethon.tl.functions.messages import SearchGlobalRequest
    from telethon.tl.types import InputMessagesFilterEmpty, InputPeerEmpty
    from datetime import timedelta

    session_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
                                "telegram_session")

    client = TelegramClient(session_path, int(api_id), api_hash)
    await client.connect()

    if not await client.is_user_authorized():
        await client.disconnect()
        return {"term": term, "total": 0, "series": [], "messages": [],
                "error": "Telegram-Session nicht aktiv"}

    now = date_to_override or datetime.now(timezone.utc)
    date_from = date_from_override or (now - timedelta(days=days))
    daily = {}
    recent_msgs = []  # collect recent messages with text
    geo_media = []    # collect geo-tagged messages (shared locations, venues)

    def _check_geo_media(msg, ch_title="", ch_uname=""):
        """Check if a message has geo media and collect it."""
        try:
            from plugins.watchzone.telegram_monitor._geo import extract_geo_from_telegram_media
            geo = extract_geo_from_telegram_media(msg)
            if geo:
                geo["date"] = msg.date.strftime("%Y-%m-%d %H:%M") if msg.date else ""
                geo["channel"] = ch_title
                geo["channel_username"] = ch_uname
                geo["snippet"] = (msg.message or msg.text or "")[:100] if hasattr(msg, 'message') else ""
                geo["count"] = 1
                geo_media.append(geo)
        except Exception:
            pass

    try:
        total = 0
        if channels:
            for ch in channels:
                try:
                    entity = await client.get_entity(ch)
                except Exception as exc:
                    log.warning("Telegram: Kanal '%s' nicht gefunden: %s", ch, exc)
                    continue
                ch_title = getattr(entity, 'title', ch)
                ch_uname = getattr(entity, 'username', '') or ch
                offset_date = now
                for page in range(50):
                    messages = await client.get_messages(
                        entity, search=term, limit=100,
                        offset_date=offset_date, min_id=0,
                    )
                    if not messages:
                        break
                    for msg in messages:
                        if msg.date and msg.date >= date_from:
                            day = msg.date.strftime("%Y-%m-%d")
                            daily[day] = daily.get(day, 0) + 1
                            total += 1
                            _check_geo_media(msg, ch_title, ch_uname)
                            if msg.text:
                                recent_msgs.append({
                                    "date": msg.date.strftime("%Y-%m-%d %H:%M"),
                                    "text": msg.text[:500],
                                    "channel": ch_title,
                                    "channel_username": ch_uname,
                                })
                    oldest = messages[-1].date if messages else None
                    if not oldest or oldest < date_from:
                        break
                    offset_date = oldest
                    await _aio.sleep(0.5)
        else:
            # Globale Suche via SearchGlobalRequest
            offset_rate = 0
            offset_peer = InputPeerEmpty()
            offset_id = 0
            for page in range(50):
                result = await client(SearchGlobalRequest(
                    q=term,
                    filter=InputMessagesFilterEmpty(),
                    min_date=date_from,
                    max_date=now,
                    offset_rate=offset_rate,
                    offset_peer=offset_peer,
                    offset_id=offset_id,
                    limit=100,
                ))
                if not result.messages:
                    break
                # Build chat id → title/username lookup
                chat_map = {}
                for ch in getattr(result, 'chats', []):
                    chat_map[ch.id] = {
                        "title": getattr(ch, 'title', ''),
                        "username": getattr(ch, 'username', '') or '',
                    }
                for msg in result.messages:
                    if msg.date and msg.date >= date_from:
                        day = msg.date.strftime("%Y-%m-%d")
                        daily[day] = daily.get(day, 0) + 1
                        total += 1
                        chat_id = getattr(msg.peer_id, 'channel_id', None) or getattr(msg.peer_id, 'chat_id', None)
                        ci = chat_map.get(chat_id, {})
                        _check_geo_media(msg, ci.get("title", ""), ci.get("username", ""))
                        if msg.message:
                            recent_msgs.append({
                                "date": msg.date.strftime("%Y-%m-%d %H:%M"),
                                "text": msg.message[:500],
                                "channel": ci.get("title", ""),
                                "channel_username": ci.get("username", ""),
                            })
                offset_rate = result.next_rate if hasattr(result, 'next_rate') and result.next_rate else 0
                if not offset_rate:
                    break
                offset_peer = InputPeerEmpty()
                offset_id = result.messages[-1].id
                await _aio.sleep(0.5)

    except Exception as exc:
        log.warning("Telegram search error for '%s': %s", term, exc)
    finally:
        await client.disconnect()

    # Auto-translate messages where language != ui_lang
    if recent_msgs and ui_lang:
        try:
            from translator import detect_language
            from deep_translator import GoogleTranslator
            translator = GoogleTranslator(source="auto", target=ui_lang)
            for m in recent_msgs:
                try:
                    src_lang = detect_language(m["text"])
                    m["src_lang"] = src_lang
                    if src_lang != ui_lang and src_lang != "unknown":
                        m["translated"] = translator.translate(m["text"]) or ""
                except Exception:
                    m["src_lang"] = "unknown"
        except Exception as exc:
            log.warning("Translation error: %s", exc)

    series = [{"date": d, "count": c} for d, c in sorted(daily.items())]

    return {
        "term": term,
        "channels": channels or [],
        "total": sum(c for c in daily.values()),
        "series": series,
        "messages": recent_msgs,
        "geo_media": geo_media,
    }

PluginManager.register(TelegramMonitorPlugin())
