"""Telegram Monitor — Geo-Extraktion aus Nachrichten.

Extrahiert Orte aus Nachrichtentexten via spaCy NER und geocodiert sie
über Nominatim (OpenStreetMap). Ergebnisse werden gecacht.
"""

import logging
import threading
from datetime import datetime, timezone

log = logging.getLogger(__name__)

# ── spaCy-Modelle (lazy-loaded) ──────────────────────────────────────────
_nlp_models = {}
_nlp_lock = threading.Lock()

_LANG_MODEL = {
    "de": "de_core_news_sm",
    "en": "en_core_web_sm",
    "ru": "ru_core_news_sm",
}


def _get_nlp(lang):
    """Lazy-load spaCy model for a language."""
    model_name = _LANG_MODEL.get(lang)
    if not model_name:
        return None
    with _nlp_lock:
        if lang not in _nlp_models:
            try:
                import spacy
                _nlp_models[lang] = spacy.load(model_name, disable=["parser", "lemmatizer"])
                log.info("spaCy model loaded: %s", model_name)
            except Exception as exc:
                log.warning("spaCy model %s not available: %s", model_name, exc)
                _nlp_models[lang] = None
        return _nlp_models[lang]


# ── Geocoding-Cache (in-memory) ──────────────────────────────────────────
_geo_cache = {}  # place_name → {"lat": ..., "lon": ..., "display": ...} or None
_geo_lock = threading.Lock()


def _geocode(place_name):
    """Geocode a place name via Photon (Komoot). Returns dict or None.

    Photon is based on OpenStreetMap data, has no strict rate limits,
    and supports multilingual place names (DE, RU, EN, etc.).
    """
    with _geo_lock:
        if place_name in _geo_cache:
            return _geo_cache[place_name]

    import urllib.request
    import urllib.parse
    import json as _json

    result = None
    try:
        url = "https://photon.komoot.io/api?" + urllib.parse.urlencode({
            "q": place_name, "limit": 1, "lang": "en",
        })
        req = urllib.request.Request(url, headers={"User-Agent": "spectralq-enterprise/1.0"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = _json.loads(resp.read())
        features = data.get("features", [])
        if features:
            coords = features[0]["geometry"]["coordinates"]  # [lon, lat]
            props = features[0].get("properties", {})
            display = ", ".join(filter(None, [
                props.get("name", ""),
                props.get("state", ""),
                props.get("country", ""),
            ]))
            result = {
                "lat": coords[1],
                "lon": coords[0],
                "display": display[:120] or place_name,
            }
    except Exception as exc:
        log.debug("Geocoding failed for '%s': %s", place_name, exc)

    with _geo_lock:
        _geo_cache[place_name] = result
    return result


# ── Stopwords für Ortsfilter (häufige Fehlerkennungen) ───────────────────
_STOP_PLACES = {
    # Häufige False Positives bei NER
    "telegram", "twitter", "facebook", "youtube", "instagram", "tiktok",
    "reuters", "bbc", "cnn", "ap", "afp",
    "nato", "eu", "un", "usa", "ussr", "udssr",
    "wagner", "iskander", "himars", "javelin", "bayraktar",
    "putin", "zelenskyj", "zelensky", "biden", "trump",
}


def _normalize_date_entity(date_text, msg_date_str):
    """Try to normalize a DATE/TIME entity to an absolute datetime string.

    Args:
        date_text: raw entity text (e.g. "gestern", "am Montag", "14:30", "3. März")
        msg_date_str: message timestamp "YYYY-MM-DD HH:MM"

    Returns:
        str "YYYY-MM-DD HH:MM" or None
    """
    import re
    from datetime import timedelta

    if not msg_date_str:
        return None

    try:
        msg_dt = datetime.strptime(msg_date_str[:16], "%Y-%m-%d %H:%M")
    except (ValueError, TypeError):
        try:
            msg_dt = datetime.strptime(msg_date_str[:10], "%Y-%m-%d")
        except (ValueError, TypeError):
            return None

    text = date_text.strip().lower()

    # Relative: gestern/yesterday/вчера
    if text in ("gestern", "yesterday", "вчера"):
        return (msg_dt - timedelta(days=1)).strftime("%Y-%m-%d %H:%M")
    if text in ("heute", "today", "сегодня"):
        return msg_dt.strftime("%Y-%m-%d %H:%M")
    if text in ("vorgestern", "позавчера"):
        return (msg_dt - timedelta(days=2)).strftime("%Y-%m-%d %H:%M")
    if text in ("morgen", "tomorrow", "завтра"):
        return (msg_dt + timedelta(days=1)).strftime("%Y-%m-%d %H:%M")

    # Time pattern HH:MM
    m = re.match(r"(\d{1,2})[:\.](\d{2})", text)
    if m:
        h, mi = int(m.group(1)), int(m.group(2))
        if 0 <= h <= 23 and 0 <= mi <= 59:
            return msg_dt.strftime("%Y-%m-%d") + f" {h:02d}:{mi:02d}"

    # Date pattern: DD.MM.YYYY or DD.MM.
    m = re.match(r"(\d{1,2})\.(\d{1,2})\.(\d{2,4})?", text)
    if m:
        d, mo = int(m.group(1)), int(m.group(2))
        y = int(m.group(3)) if m.group(3) else msg_dt.year
        if y < 100:
            y += 2000
        if 1 <= d <= 31 and 1 <= mo <= 12:
            return f"{y:04d}-{mo:02d}-{d:02d} 00:00"

    # ISO-like YYYY-MM-DD
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", text)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)} 00:00"

    # English month names: "March 15", "15 March", "March 15, 2026"
    _EN_MONTHS = {"january":1,"february":2,"march":3,"april":4,"may":5,"june":6,
                  "july":7,"august":8,"september":9,"october":10,"november":11,"december":12}
    m = re.match(r"([a-z]+)\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?", text)
    if m and m.group(1) in _EN_MONTHS:
        mo = _EN_MONTHS[m.group(1)]
        d = int(m.group(2))
        y = int(m.group(3)) if m.group(3) else msg_dt.year
        if 1 <= d <= 31:
            return f"{y:04d}-{mo:02d}-{d:02d} 00:00"
    m = re.match(r"(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?", text)
    if m and m.group(2) in _EN_MONTHS:
        mo = _EN_MONTHS[m.group(2)]
        d = int(m.group(1))
        y = int(m.group(3)) if m.group(3) else msg_dt.year
        if 1 <= d <= 31:
            return f"{y:04d}-{mo:02d}-{d:02d} 00:00"

    # German month names: "3. März", "15. Januar 2026"
    _DE_MONTHS = {"januar":1,"februar":2,"märz":3,"april":4,"mai":5,"juni":6,
                  "juli":7,"august":8,"september":9,"oktober":10,"november":11,"dezember":12}
    m = re.match(r"(\d{1,2})\.\s*([a-zäöü]+)(?:\s+(\d{4}))?", text)
    if m and m.group(2) in _DE_MONTHS:
        mo = _DE_MONTHS[m.group(2)]
        d = int(m.group(1))
        y = int(m.group(3)) if m.group(3) else msg_dt.year
        if 1 <= d <= 31:
            return f"{y:04d}-{mo:02d}-{d:02d} 00:00"

    # Russian month names: "15 марта", "3 января 2026"
    _RU_MONTHS = {"января":1,"февраля":2,"марта":3,"апреля":4,"мая":5,"июня":6,
                  "июля":7,"августа":8,"сентября":9,"октября":10,"ноября":11,"декабря":12}
    m = re.match(r"(\d{1,2})\s+(\S+)(?:\s+(\d{4}))?", text)
    if m and m.group(2) in _RU_MONTHS:
        mo = _RU_MONTHS[m.group(2)]
        d = int(m.group(1))
        y = int(m.group(3)) if m.group(3) else msg_dt.year
        if 1 <= d <= 31:
            return f"{y:04d}-{mo:02d}-{d:02d} 00:00"

    # Weekdays
    _WEEKDAYS = {
        "monday":0, "tuesday":1, "wednesday":2, "thursday":3, "friday":4, "saturday":5, "sunday":6,
        "montag":0, "dienstag":1, "mittwoch":2, "donnerstag":3, "freitag":4, "samstag":5, "sonntag":6,
        "понедельник":0, "вторник":1, "среда":2, "четверг":3, "пятница":4, "суббота":5, "воскресенье":6,
    }
    if text in _WEEKDAYS:
        target_wd = _WEEKDAYS[text]
        cur_wd = msg_dt.weekday()
        diff = (cur_wd - target_wd) % 7
        if diff == 0:
            diff = 7  # "Monday" = last Monday
        return (msg_dt - timedelta(days=diff)).strftime("%Y-%m-%d") + " 00:00"

    # Can't normalize — return None
    return None


def extract_locations(messages, src_langs=None):
    """Extract geo locations and time-place events from message texts.

    Args:
        messages: list of {"text": str, "src_lang": str, "date": str, ...}
        src_langs: set of languages to process (default: de, en, ru)

    Returns:
        tuple (locations, events) where:
          locations: list of {"lat", "lon", "place", "display", "date", "snippet", "count"}
          events: list of {"time", "time_raw", "place", "lat", "lon", "snippet", "channel"}
    """
    if not messages:
        return [], []

    if src_langs is None:
        src_langs = {"de", "en", "ru"}

    place_mentions = {}  # place_name → {"count": int, "dates": [], "snippets": []}
    raw_events = []      # linked time-place pairs from same message

    for msg in messages:
        text = msg.get("text", "")
        if not text or len(text) < 10:
            continue

        lang = msg.get("src_lang", "unknown")
        if lang not in src_langs:
            lang = "en"

        nlp = _get_nlp(lang)
        if not nlp:
            continue

        try:
            doc = nlp(text[:1000])

            msg_places = []
            msg_times = []

            for ent in doc.ents:
                if ent.label_ in ("LOC", "GPE", "FAC"):
                    place = ent.text.strip()
                    if len(place) < 3 or place.lower() in _STOP_PLACES or place.isdigit():
                        continue

                    if place not in place_mentions:
                        place_mentions[place] = {"count": 0, "dates": [], "snippets": []}
                    place_mentions[place]["count"] += 1
                    if msg.get("date"):
                        place_mentions[place]["dates"].append(msg["date"])
                    # Use translated text for snippet if available
                    src_text = msg.get("translated") or text
                    start = max(0, ent.start_char - 30)
                    end = min(len(src_text), ent.end_char + 30)
                    snip = src_text[start:end].replace("\n", " ").strip() if start < len(src_text) else src_text[:60]
                    if len(place_mentions[place]["snippets"]) < 3:
                        place_mentions[place]["snippets"].append(snip)
                    msg_places.append(place)

                elif ent.label_ in ("DATE", "TIME"):
                    time_raw = ent.text.strip()
                    if len(time_raw) >= 2:
                        normalized = _normalize_date_entity(time_raw, msg.get("date", ""))
                        msg_times.append({
                            "raw": time_raw,
                            "normalized": normalized or msg.get("date", ""),
                        })

            # Use translated snippet if available, otherwise original
            snippet = (msg.get("translated") or text)[:120].replace("\n", " ").strip()
            snippet_orig = text[:120].replace("\n", " ").strip() if msg.get("translated") else ""

            # Link places and times from the same message
            if msg_places and msg_times:
                for place in msg_places:
                    for t in msg_times:
                        raw_events.append({
                            "place": place,
                            "time": t["normalized"],
                            "time_raw": t["raw"],
                            "snippet": snippet,
                            "snippet_orig": snippet_orig,
                            "channel": msg.get("channel", ""),
                            "msg_date": msg.get("date", ""),
                        })
            # Places without explicit time → use message date
            elif msg_places:
                for place in msg_places:
                    raw_events.append({
                        "place": place,
                        "time": msg.get("date", ""),
                        "time_raw": "",
                        "snippet": snippet,
                        "snippet_orig": snippet_orig,
                        "channel": msg.get("channel", ""),
                        "msg_date": msg.get("date", ""),
                    })
            # Times without place → still useful for calendar
            elif msg_times:
                for t in msg_times:
                    raw_events.append({
                        "place": "",
                        "time": t["normalized"],
                        "time_raw": t["raw"],
                        "snippet": snippet,
                        "snippet_orig": snippet_orig,
                        "channel": msg.get("channel", ""),
                        "msg_date": msg.get("date", ""),
                    })

        except Exception as exc:
            log.debug("NER failed for message: %s", exc)

    if not place_mentions and not raw_events:
        return [], []

    # Sort by frequency, take top 30
    sorted_places = sorted(place_mentions.items(), key=lambda x: -x[1]["count"])[:30]

    # Geocode each place
    locations = []
    geocoded = {}  # place → {lat, lon}
    import time
    for place_name, info in sorted_places:
        geo = _geocode(place_name)
        time.sleep(0.2)
        if geo:
            geocoded[place_name] = geo
            locations.append({
                "lat": geo["lat"],
                "lon": geo["lon"],
                "place": place_name,
                "display": geo["display"],
                "count": info["count"],
                "date": info["dates"][0] if info["dates"] else "",
                "snippet": info["snippets"][0] if info["snippets"] else "",
            })

    # Deduplicate nearby locations
    deduped = []
    for loc in locations:
        is_dup = False
        for existing in deduped:
            if abs(loc["lat"] - existing["lat"]) < 0.01 and abs(loc["lon"] - existing["lon"]) < 0.01:
                existing["count"] += loc["count"]
                if loc["place"] not in existing["place"]:
                    existing["place"] += ", " + loc["place"]
                is_dup = True
                break
        if not is_dup:
            deduped.append(loc)

    # Enrich events with geocoded coordinates (or keep without geo for calendar)
    events = []
    seen = set()
    for ev in raw_events:
        place = ev["place"]
        geo = geocoded.get(place) if place else None
        # Deduplicate: same place + same time
        key = (place or ev.get("snippet", "")[:40], ev["time"][:16] if ev["time"] else "")
        if key in seen:
            continue
        seen.add(key)
        events.append({
            "time": ev["time"],
            "time_raw": ev["time_raw"],
            "place": place,
            "lat": geo["lat"] if geo else None,
            "lon": geo["lon"] if geo else None,
            "snippet": ev["snippet"],
            "snippet_orig": ev.get("snippet_orig", ""),
            "channel": ev["channel"],
            "posted": ev.get("msg_date", ""),
        })

    # Sort events chronologically
    events.sort(key=lambda e: e.get("time", "") or "")

    return deduped, events


def extract_geo_from_telegram_media(msg):
    """Extract geo data from Telegram message media (shared locations, venues).

    Args:
        msg: Telethon Message object

    Returns:
        dict with lat/lon or None
    """
    media = getattr(msg, 'media', None)
    if not media:
        return None

    # MessageMediaGeo / MessageMediaGeoLive
    geo = getattr(media, 'geo', None)
    if geo and hasattr(geo, 'lat') and hasattr(geo, 'long'):
        return {
            "lat": geo.lat,
            "lon": geo.long,
            "place": "Geteilter Standort",
            "type": "geo_live" if hasattr(media, 'period') else "geo",
        }

    # MessageMediaVenue
    venue = getattr(media, 'venue', None) if hasattr(media, 'title') else None
    if hasattr(media, 'title') and geo:
        return {
            "lat": geo.lat,
            "lon": geo.long,
            "place": getattr(media, 'title', 'Venue'),
            "type": "venue",
        }

    return None
