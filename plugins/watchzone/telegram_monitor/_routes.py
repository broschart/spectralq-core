"""Telegram Monitor plugin API routes — mention timeline + auth + channel mgmt."""

import os
import logging
from flask import request, jsonify, abort, current_app

log = logging.getLogger(__name__)


def api_telegram_mentions():
    """Telegram-Nachrichtenvolumen in öffentlichen Kanälen pro Tag."""
    import asyncio
    from collections import Counter
    import bisect
    from datetime import datetime, timedelta, timezone
    from flask_login import current_user
    from transport import _get_credential

    terms_param = request.args.get("terms", "")
    if not terms_param:
        abort(400, "terms Parameter fehlt")
    terms = [t.strip() for t in terms_param.split(",") if t.strip()][:5]
    days = min(int(request.args.get("days", 90)), 365)

    labels_param = request.args.get("labels", "")
    chart_labels = sorted([l.strip() for l in labels_param.split(",")
                           if l.strip()]) if labels_param else None

    uid = current_user.id if current_user.is_authenticated else None
    api_id = _get_credential("telegram_api_id", "TELEGRAM_API_ID", uid)
    api_hash = _get_credential("telegram_api_hash", "TELEGRAM_API_HASH", uid)

    if not api_id or not api_hash:
        return jsonify([{"term": t, "error": "Telegram-API-Credentials fehlen. "
                         "Bitte api_id und api_hash unter Admin eintragen "
                         "(https://my.telegram.org)."}
                        for t in terms])

    session_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "telegram_session")

    if not os.path.exists(session_path + ".session"):
        return jsonify([{"term": t, "error": "Telegram-Session nicht aktiv. "
                         "Bitte zuerst unter Admin → Telegram authentifizieren."}
                        for t in terms])

    # Support explicit date range (for time focus)
    date_from_param = request.args.get("date_from", "")
    date_to_param = request.args.get("date_to", "")
    if date_from_param and date_to_param:
        try:
            start_dt = datetime.fromisoformat(date_from_param + "T00:00:00+00:00")
            end_dt = datetime.fromisoformat(date_to_param + "T23:59:59+00:00")
            # Add padding of 'days' around the focus range
            start_dt = start_dt - timedelta(days=days)
            end_dt = end_dt + timedelta(days=days)
        except ValueError:
            end_dt = datetime.now(timezone.utc)
            start_dt = end_dt - timedelta(days=days)
    else:
        end_dt = datetime.now(timezone.utc)
        start_dt = end_dt - timedelta(days=days)

    async def _search_telegram():
        from telethon import TelegramClient
        from telethon.tl.functions.messages import SearchGlobalRequest
        from telethon.tl.types import InputMessagesFilterEmpty, InputPeerEmpty

        client = TelegramClient(session_path, int(api_id), api_hash)
        await client.connect()
        if not await client.is_user_authorized():
            await client.disconnect()
            return [{"term": t, "error": "Telegram-Session abgelaufen. Bitte erneut authentifizieren."}
                    for t in terms]

        result = []
        for term in terms:
            posts_per_day = Counter()
            fetched = 0
            try:
                offset_rate = 0
                offset_peer = InputPeerEmpty()
                offset_id = 0
                for _ in range(50):
                    sr = await client(SearchGlobalRequest(
                        q=term,
                        filter=InputMessagesFilterEmpty(),
                        min_date=start_dt,
                        max_date=end_dt,
                        offset_rate=offset_rate,
                        offset_peer=offset_peer,
                        offset_id=offset_id,
                        limit=100,
                    ))
                    if not sr.messages:
                        break
                    for msg in sr.messages:
                        if msg.date and msg.date.replace(tzinfo=timezone.utc) >= start_dt:
                            day_str = msg.date.strftime("%Y-%m-%d")
                            posts_per_day[day_str] += 1
                            fetched += 1
                    offset_rate = sr.next_rate if hasattr(sr, 'next_rate') and sr.next_rate else 0
                    if not offset_rate:
                        break
                    offset_peer = InputPeerEmpty()
                    offset_id = sr.messages[-1].id
                    await asyncio.sleep(0.5)

                if chart_labels and len(chart_labels) > 1 and posts_per_day:
                    aggregated = Counter()
                    for day_str, count in posts_per_day.items():
                        idx = bisect.bisect_right(chart_labels, day_str)
                        if idx > 0:
                            idx -= 1
                        best = chart_labels[idx]
                        if idx + 1 < len(chart_labels):
                            try:
                                d0 = abs((datetime.strptime(day_str, "%Y-%m-%d") -
                                          datetime.strptime(chart_labels[idx], "%Y-%m-%d")).days)
                                d1 = abs((datetime.strptime(day_str, "%Y-%m-%d") -
                                          datetime.strptime(chart_labels[idx+1], "%Y-%m-%d")).days)
                                if d1 < d0:
                                    best = chart_labels[idx + 1]
                            except Exception:
                                pass
                        aggregated[best] += count
                    series = [{"date": d, "count": aggregated[d]}
                              for d in sorted(aggregated.keys())]
                else:
                    series = [{"date": d, "count": posts_per_day[d]}
                              for d in sorted(posts_per_day.keys())]

                result.append({"term": term, "total": fetched, "series": series})
            except Exception as exc:
                result.append({"term": term, "error": str(exc)[:150]})

        await client.disconnect()
        return result

    loop = asyncio.new_event_loop()
    try:
        result = loop.run_until_complete(_search_telegram())
    finally:
        loop.close()

    return jsonify(result)


def api_telegram_auth():
    """Telegram-Authentifizierung: Sendet Code oder verifiziert Code."""
    import asyncio
    from flask_login import current_user
    from transport import _get_credential

    if not current_user.is_superadmin:
        return jsonify(ok=False, error="Nur Superadmin."), 403

    data = request.get_json(force=True) or {}
    step = data.get("step", "")

    uid = current_user.id
    api_id = _get_credential("telegram_api_id", "TELEGRAM_API_ID", uid)
    api_hash = _get_credential("telegram_api_hash", "TELEGRAM_API_HASH", uid)

    if not api_id or not api_hash:
        return jsonify(ok=False, error="Bitte zuerst api_id und api_hash eintragen."), 400

    session_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "telegram_session")

    async def _do_auth():
        from telethon import TelegramClient
        from telethon.errors import SessionPasswordNeededError

        client = TelegramClient(session_path, int(api_id), api_hash)
        await client.connect()

        if step == "send_code":
            phone = data.get("phone", "").strip()
            if not phone:
                return {"ok": False, "error": "Telefonnummer erforderlich."}
            result = await client.send_code_request(phone)
            current_app.config["_tg_phone"] = phone
            current_app.config["_tg_code_hash"] = result.phone_code_hash
            await client.disconnect()
            return {"ok": True, "message": "Code gesendet. Bitte Code eingeben."}

        elif step == "verify_code":
            code = data.get("code", "").strip()
            phone = current_app.config.get("_tg_phone", "")
            code_hash = current_app.config.get("_tg_code_hash", "")
            if not code or not phone or not code_hash:
                return {"ok": False, "error": "Bitte zuerst Code senden."}
            try:
                await client.sign_in(phone=phone, code=code, phone_code_hash=code_hash)
            except SessionPasswordNeededError:
                pw = data.get("password", "").strip()
                if not pw:
                    await client.disconnect()
                    return {"ok": False, "error": "2FA-Passwort erforderlich.", "need_2fa": True}
                await client.sign_in(password=pw)

            authorized = await client.is_user_authorized()
            await client.disconnect()
            if authorized:
                current_app.config.pop("_tg_phone", None)
                current_app.config.pop("_tg_code_hash", None)
                return {"ok": True, "message": "Telegram-Session aktiv!"}
            return {"ok": False, "error": "Authentifizierung fehlgeschlagen."}

        elif step == "check":
            authorized = await client.is_user_authorized()
            await client.disconnect()
            return {"ok": True, "active": authorized}

        await client.disconnect()
        return {"ok": False, "error": f"Unbekannter Schritt: {step}"}

    loop = asyncio.new_event_loop()
    try:
        result = loop.run_until_complete(_do_auth())
    except Exception as exc:
        result = {"ok": False, "error": str(exc)[:200]}
    finally:
        loop.close()

    return jsonify(result)


def api_telegram_channels():
    """Telegram-Kanal-Verwaltung: list / join / leave (projektbezogen)."""
    import asyncio
    import sqlite3
    from flask_login import current_user, login_required
    from transport import _get_credential

    if not current_user.is_authenticated:
        return jsonify(ok=False, error="Login erforderlich."), 401

    uid = current_user.id
    api_id = _get_credential("telegram_api_id", "TELEGRAM_API_ID", uid)
    api_hash = _get_credential("telegram_api_hash", "TELEGRAM_API_HASH", uid)
    if not api_id or not api_hash:
        return jsonify(ok=False, error="Telegram-Credentials fehlen."), 400

    session_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        "telegram_session",
    )

    data = request.get_json(force=True) if request.method == "POST" else {}
    action = data.get("action", "list") if request.method == "POST" else "list"
    project_id = data.get("project_id") or request.args.get("project_id")
    if project_id:
        project_id = int(project_id)

    # DB path for channel-project mapping
    db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__))))), "trends.db")

    def _get_project_channels():
        """Get channel usernames assigned to this project."""
        if not project_id:
            return None  # No project filter → show all
        conn = sqlite3.connect(db_path, timeout=30)
        cur = conn.cursor()
        rows = cur.execute("SELECT username FROM tg_channel_projects WHERE project_id = ?",
                           (project_id,)).fetchall()
        conn.close()
        return set(r[0].lower() for r in rows)

    def _assign_channel_to_project(username):
        """Assign a channel to the current project."""
        if not project_id:
            return
        conn = sqlite3.connect(db_path, timeout=30)
        cur = conn.cursor()
        cur.execute("INSERT OR IGNORE INTO tg_channel_projects (username, project_id, user_id) VALUES (?, ?, ?)",
                    (username.lower(), project_id, uid))
        conn.commit()
        conn.close()

    def _remove_channel_from_project(username):
        """Remove a channel from the current project (does NOT leave the channel on Telegram)."""
        if not project_id:
            return
        conn = sqlite3.connect(db_path, timeout=30)
        cur = conn.cursor()
        cur.execute("DELETE FROM tg_channel_projects WHERE username = ? AND project_id = ?",
                    (username.lower(), project_id))
        conn.commit()
        conn.close()

    async def _do():
        from telethon import TelegramClient
        from telethon.tl.functions.channels import JoinChannelRequest, LeaveChannelRequest

        client = TelegramClient(session_path, int(api_id), api_hash)
        await client.connect()
        if not await client.is_user_authorized():
            await client.disconnect()
            return {"ok": False, "error": "Telegram-Session nicht aktiv."}

        try:
            if action == "check_before_join":
                username = (data.get("channel", "") or "").strip().lstrip("@")
                if not username:
                    return {"ok": False, "error": "Kanalname erforderlich."}
                try:
                    from telethon.tl.types import User as _TlUser
                    entity = await client.get_entity(username)
                    if isinstance(entity, _TlUser):
                        return {"ok": False, "error": f"@{username} ist ein persönlicher Account, kein Kanal oder Gruppe."}
                    is_group = getattr(entity, 'megagroup', False)
                    is_channel = getattr(entity, 'broadcast', False)
                    me = await client.get_me()
                    my_name = ((me.first_name or "") + " " + (me.last_name or "")).strip()
                    return {
                        "ok": True,
                        "is_group": is_group,
                        "is_channel": is_channel,
                        "title": getattr(entity, 'title', username),
                        "username": getattr(entity, 'username', username) or username,
                        "participants": getattr(entity, 'participants_count', None),
                        "my_name": my_name,
                    }
                except Exception as exc:
                    return {"ok": False, "error": f"@{username}: {str(exc)[:150]}"}

            elif action == "join":
                username = (data.get("channel", "") or "").strip().lstrip("@")
                if not username:
                    return {"ok": False, "error": "Kanalname erforderlich."}
                try:
                    from telethon.tl.types import User as _TlUser
                    entity = await client.get_entity(username)
                    if isinstance(entity, _TlUser):
                        return {"ok": False, "error": f"@{username} ist ein persönlicher Account, kein Kanal oder Gruppe."}
                    is_group = getattr(entity, 'megagroup', False)
                    await client(JoinChannelRequest(entity))
                    real_uname = getattr(entity, 'username', username) or username
                    _assign_channel_to_project(real_uname)
                    label = "Gruppe" if is_group else "Kanal"
                    return {"ok": True, "message": f"{label} @{real_uname} beigetreten.",
                            "is_group": is_group,
                            "channel": {"id": entity.id, "title": getattr(entity, 'title', username),
                                        "username": real_uname}}
                except Exception as exc:
                    return {"ok": False, "error": f"@{username}: {str(exc)[:150]}"}

            elif action == "leave":
                username = (data.get("channel", "") or "").strip().lstrip("@")
                if not username:
                    return {"ok": False, "error": "Kanalname erforderlich."}
                _remove_channel_from_project(username)
                # Only actually leave on Telegram if channel is not in any other project
                conn = sqlite3.connect(db_path, timeout=30)
                cur = conn.cursor()
                other = cur.execute("SELECT COUNT(*) FROM tg_channel_projects WHERE username = ?",
                                    (username.lower(),)).fetchone()[0]
                conn.close()
                if other == 0:
                    try:
                        entity = await client.get_entity(username)
                        await client(LeaveChannelRequest(entity))
                        return {"ok": True, "message": f"Kanal @{username} verlassen und aus Projekt entfernt."}
                    except Exception as exc:
                        return {"ok": False, "error": f"Kanal @{username}: {str(exc)[:150]}"}
                else:
                    return {"ok": True, "message": f"@{username} aus Projekt entfernt (in {other} anderen Projekten noch aktiv)."}

            elif action == "search":
                query = (data.get("query", "") or "").strip()
                if not query or len(query) < 2:
                    return {"ok": False, "error": "Suchbegriff zu kurz (mind. 2 Zeichen)."}
                try:
                    from telethon.tl.functions.contacts import SearchRequest as _SearchReq
                    result = await client(_SearchReq(q=query, limit=20))
                    found = []
                    for chat in result.chats:
                        uname = getattr(chat, 'username', '') or ''
                        title = getattr(chat, 'title', '') or uname
                        members = getattr(chat, 'participants_count', None)
                        is_group = getattr(chat, 'megagroup', False)
                        created = getattr(chat, 'date', None)
                        created_iso = created.isoformat() if created else None
                        found.append({
                            "username": uname,
                            "title": title,
                            "participants": members,
                            "is_group": is_group,
                            "created": created_iso,
                        })
                    return {"ok": True, "results": found}
                except Exception as exc:
                    return {"ok": False, "error": f"Suche fehlgeschlagen: {str(exc)[:150]}"}

            else:  # list
                project_channels = _get_project_channels()
                channels = []
                async for dialog in client.iter_dialogs():
                    if dialog.is_channel:
                        ent = dialog.entity
                        uname = getattr(ent, 'username', '') or ''
                        # Filter by project if project_id given
                        if project_channels is not None and uname.lower() not in project_channels:
                            continue
                        channels.append({
                            "id": ent.id,
                            "title": getattr(ent, 'title', ''),
                            "username": uname,
                            "participants": getattr(ent, 'participants_count', None),
                        })
                return {"ok": True, "channels": channels}
        finally:
            await client.disconnect()

    loop = asyncio.new_event_loop()
    try:
        result = loop.run_until_complete(_do())
    except Exception as exc:
        result = {"ok": False, "error": str(exc)[:200]}
    finally:
        loop.close()

    # Translate channel titles if not in user's UI language
    items_to_translate = result.get("channels") or result.get("results") or []
    if result.get("ok") and items_to_translate:
        try:
            from models import AppSetting
            ui_lang = "de"
            obj = AppSetting.query.filter_by(key="ui_language", user_id=uid).first()
            if obj and obj.value:
                ui_lang = obj.value
            else:
                obj = AppSetting.query.filter_by(key="ui_language", user_id=None).first()
                if obj and obj.value:
                    ui_lang = obj.value

            from translator import detect_language
            from deep_translator import GoogleTranslator
            translator = GoogleTranslator(source="auto", target=ui_lang)
            for ch in items_to_translate:
                title = ch.get("title", "")
                if not title:
                    continue
                try:
                    src = detect_language(title)
                    if src != ui_lang and src != "unknown" and len(title) > 3:
                        ch["title_translated"] = translator.translate(title) or ""
                        ch["title_lang"] = src
                except Exception:
                    pass
        except Exception as exc:
            log.warning("Channel title translation error: %s", exc)

    return jsonify(result)


def api_telegram_translate_kw():
    """Übersetze ein Keyword in mehrere Zielsprachen."""
    from flask_login import current_user

    if not current_user.is_authenticated:
        return jsonify(ok=False, error="Login erforderlich."), 401

    text = (request.args.get("text", "") or "").strip()
    if not text or len(text) > 200:
        return jsonify(ok=False, error="Kein Text."), 400

    # Optional: translate to a single additional target language
    single_target = (request.args.get("target", "") or "").strip()

    targets = {
        "ru": "Russisch",
        "uk": "Ukrainisch",
        "en": "Englisch",
        "ar": "Arabisch",
        "fa": "Persisch",
        "zh-CN": "Chinesisch",
        "fr": "Französisch",
        "tr": "Türkisch",
        "de": "Deutsch",
        "he": "Hebräisch",
    }

    # Additional language names for single-target requests
    _ALL_LANG_NAMES = {
        "ru": "Russisch", "uk": "Ukrainisch", "en": "Englisch", "ar": "Arabisch",
        "fa": "Persisch", "zh-CN": "Chinesisch", "fr": "Französisch", "tr": "Türkisch",
        "de": "Deutsch", "he": "Hebräisch", "pt": "Portugiesisch", "it": "Italienisch",
        "pl": "Polnisch", "ja": "Japanisch", "ko": "Koreanisch", "nl": "Niederländisch",
        "sv": "Schwedisch", "no": "Norwegisch", "fi": "Finnisch", "et": "Estnisch",
        "lv": "Lettisch", "lt": "Litauisch", "ro": "Rumänisch", "hu": "Ungarisch",
        "cs": "Tschechisch", "el": "Griechisch", "hi": "Hindi", "es": "Spanisch",
    }

    if single_target and single_target not in targets:
        targets = {single_target: _ALL_LANG_NAMES.get(single_target, single_target)}

    try:
        from translator import detect_language
        src_lang = detect_language(text)
    except Exception:
        src_lang = "unknown"

    results = []
    try:
        from deep_translator import GoogleTranslator
        for lang_code, lang_name in targets.items():
            if lang_code == src_lang or (lang_code == "zh-CN" and src_lang == "zh-cn"):
                continue
            try:
                translated = GoogleTranslator(source="auto", target=lang_code).translate(text)
                if translated and translated.lower() != text.lower():
                    results.append({"lang": lang_code, "name": lang_name, "text": translated})
            except Exception:
                pass
    except Exception as exc:
        return jsonify(ok=False, error=str(exc)[:150]), 500

    return jsonify(ok=True, src_lang=src_lang, translations=results)


def api_telegram_day_messages():
    """Nachrichten eines bestimmten Tages für ein Keyword abrufen."""
    import asyncio
    from datetime import datetime as _dt, timedelta, timezone as _tz
    from flask_login import current_user
    from transport import _get_credential

    if not current_user.is_authenticated:
        return jsonify(ok=False, error="Login erforderlich."), 401

    date_str = (request.args.get("date", "") or "").strip()
    terms_str = (request.args.get("terms", "") or "").strip()
    if not date_str or not terms_str:
        return jsonify(ok=False, error="date und terms Parameter erforderlich."), 400

    terms = [t.strip() for t in terms_str.split(",") if t.strip()][:5]

    try:
        day_start = _dt.fromisoformat(date_str + "T00:00:00+00:00")
        day_end = day_start + timedelta(days=1)
    except ValueError:
        return jsonify(ok=False, error="Ungültiges Datum."), 400

    uid = current_user.id
    api_id = _get_credential("telegram_api_id", "TELEGRAM_API_ID", uid)
    api_hash = _get_credential("telegram_api_hash", "TELEGRAM_API_HASH", uid)
    if not api_id or not api_hash:
        return jsonify(ok=False, error="Telegram-Credentials fehlen."), 400

    session_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        "telegram_session",
    )

    # Determine UI language for translation
    ui_lang = "de"
    try:
        from models import AppSetting
        obj = AppSetting.query.filter_by(key="ui_language", user_id=uid).first()
        if obj and obj.value:
            ui_lang = obj.value
        else:
            obj = AppSetting.query.filter_by(key="ui_language", user_id=None).first()
            if obj and obj.value:
                ui_lang = obj.value
    except Exception:
        pass

    async def _fetch():
        from telethon import TelegramClient
        from telethon.tl.functions.messages import SearchGlobalRequest
        from telethon.tl.types import InputMessagesFilterEmpty, InputPeerEmpty

        client = TelegramClient(session_path, int(api_id), api_hash)
        await client.connect()
        if not await client.is_user_authorized():
            await client.disconnect()
            return {"ok": False, "error": "Telegram-Session nicht aktiv."}

        messages = []
        try:
            for term in terms:
                result = await client(SearchGlobalRequest(
                    q=term,
                    filter=InputMessagesFilterEmpty(),
                    min_date=day_start,
                    max_date=day_end,
                    offset_rate=0,
                    offset_peer=InputPeerEmpty(),
                    offset_id=0,
                    limit=50,
                ))
                chat_map = {}
                for ch in getattr(result, 'chats', []):
                    chat_map[ch.id] = {
                        "title": getattr(ch, 'title', ''),
                        "username": getattr(ch, 'username', '') or '',
                    }
                for msg in (result.messages or []):
                    if msg.message:
                        chat_id = getattr(msg.peer_id, 'channel_id', None) or getattr(msg.peer_id, 'chat_id', None)
                        ci = chat_map.get(chat_id, {})
                        messages.append({
                            "date": msg.date.strftime("%Y-%m-%d %H:%M") if msg.date else "",
                            "text": msg.message[:500],
                            "channel": ci.get("title", ""),
                            "channel_username": ci.get("username", ""),
                        })
                await asyncio.sleep(0.3)
        finally:
            await client.disconnect()

        return {"ok": True, "messages": messages}

    loop = asyncio.new_event_loop()
    try:
        result = loop.run_until_complete(_fetch())
    except Exception as exc:
        result = {"ok": False, "error": str(exc)[:200]}
    finally:
        loop.close()

    # Translate messages
    if result.get("ok") and result.get("messages"):
        try:
            from translator import detect_language
            from deep_translator import GoogleTranslator
            translator = GoogleTranslator(source="auto", target=ui_lang)
            for m in result["messages"]:
                try:
                    src = detect_language(m["text"])
                    m["src_lang"] = src
                    if src != ui_lang and src != "unknown":
                        m["translated"] = translator.translate(m["text"]) or ""
                except Exception:
                    m["src_lang"] = "unknown"
        except Exception:
            pass

    return jsonify(result)
