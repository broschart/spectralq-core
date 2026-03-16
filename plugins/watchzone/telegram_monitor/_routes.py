"""Telegram Monitor plugin API routes — mention timeline + auth."""

import os
from flask import request, jsonify, abort, current_app


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

    session_path = os.path.join(current_app.root_path, "telegram_session")

    if not os.path.exists(session_path + ".session"):
        return jsonify([{"term": t, "error": "Telegram-Session nicht aktiv. "
                         "Bitte zuerst unter Admin → Telegram authentifizieren."}
                        for t in terms])

    end_dt = datetime.now(timezone.utc)
    start_dt = end_dt - timedelta(days=days)

    async def _search_telegram():
        from telethon import TelegramClient

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
                offset_date = end_dt
                for _ in range(50):
                    messages = await client.get_messages(
                        None, search=term, limit=100,
                        offset_date=offset_date, min_id=0,
                    )
                    if not messages:
                        break
                    stop = False
                    for msg in messages:
                        if msg.date.replace(tzinfo=timezone.utc) < start_dt:
                            stop = True
                            break
                        day_str = msg.date.strftime("%Y-%m-%d")
                        posts_per_day[day_str] += 1
                        fetched += 1
                    if stop:
                        break
                    offset_date = messages[-1].date
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

    session_path = os.path.join(current_app.root_path, "telegram_session")

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
