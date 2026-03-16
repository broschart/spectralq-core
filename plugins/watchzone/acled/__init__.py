"""ACLED Watch Zone Plugin — Armed Conflict Location & Event Data."""

import logging
from datetime import datetime, timedelta, timezone

from flask import jsonify
from plugins import PluginManager
from plugins.watchzone import WatchZonePlugin
from plugins.watchzone._helpers import geojson_to_bbox

log = logging.getLogger(__name__)

UA = "VeriTrend.ai/1.0 (forensic trend analysis; contact@veritrend.ai)"
ACLED_TOKEN_URL = "https://acleddata.com/oauth/token"
ACLED_API = "https://acleddata.com/api/acled/read"

# ACLED event types with German / English labels
EVENT_COLORS = {
    "Battles":                   "#dc2626",
    "Violence against civilians": "#9333ea",
    "Explosions/Remote violence": "#f59e0b",
    "Riots":                     "#ea580c",
    "Protests":                  "#3b82f6",
    "Strategic developments":    "#64748b",
}

# Token cache: {user_id: (token, expiry_datetime)}
_token_cache = {}

def _acled_auth(user_id=None):
    """Return (email, password) from credential store or None."""
    from transport import _get_credential
    email = _get_credential("acled_email", "ACLED_EMAIL", user_id)
    pw = _get_credential("acled_password", "ACLED_PASSWORD", user_id)
    if email and pw:
        return (email, pw)
    return None

def _acled_get_token(user_id=None):
    """Get a Bearer token for the ACLED API (cached for 23h)."""
    import requests as _rq

    now = datetime.now(timezone.utc)
    cached = _token_cache.get(user_id)
    if cached and cached[1] > now:
        return cached[0]

    creds = _acled_auth(user_id)
    if not creds:
        return None

    try:
        r = _rq.post(ACLED_TOKEN_URL, data={
            "username": creds[0],
            "password": creds[1],
            "grant_type": "password",
            "client_id": "acled",
        }, timeout=15)
        r.raise_for_status()
        token = r.json().get("access_token")
        if token:
            _token_cache[user_id] = (token, now + timedelta(hours=23))
        return token
    except Exception as exc:
        log.warning("ACLED token error: %s", exc)
        return None

def _fetch_acled_events(bbox, date_from, date_to, limit=500, user_id=None):
    """Fetch ACLED events for a bounding box and date range.

    bbox = (min_lon, min_lat, max_lon, max_lat)
    date_from / date_to = 'YYYY-MM-DD'
    Returns list of event dicts.
    """
    import requests as _rq

    token = _acled_get_token(user_id)
    if not token:
        return {"error": "ACLED-Zugangsdaten fehlen. Bitte E-Mail und Passwort unter Plugins eintragen."}

    params = {
        "event_date": f"{date_from}|{date_to}",
        "event_date_where": "BETWEEN",
        "latitude": f"{bbox[1]}|{bbox[3]}",
        "latitude_where": "BETWEEN",
        "longitude": f"{bbox[0]}|{bbox[2]}",
        "longitude_where": "BETWEEN",
        "limit": str(limit),
    }

    try:
        r = _rq.get(ACLED_API, params=params,
                     headers={"User-Agent": UA, "Authorization": f"Bearer {token}"},
                     timeout=30)
        r.raise_for_status()
        data = r.json()
    except Exception as exc:
        log.warning("ACLED API error: %s", exc)
        return {"error": str(exc)[:200]}

    raw = data.get("data", [])
    events = []
    for e in raw:
        events.append({
            "id": e.get("data_id", ""),
            "date": e.get("event_date", ""),
            "event_type": e.get("event_type", ""),
            "sub_event_type": e.get("sub_event_type", ""),
            "actor1": e.get("actor1", ""),
            "actor2": e.get("actor2", ""),
            "country": e.get("country", ""),
            "admin1": e.get("admin1", ""),
            "location": e.get("location", ""),
            "lat": _safe_float(e.get("latitude")),
            "lon": _safe_float(e.get("longitude")),
            "fatalities": _safe_int(e.get("fatalities")),
            "notes": (e.get("notes") or "")[:300],
            "source": e.get("source", ""),
        })

    events.sort(key=lambda x: x["date"], reverse=True)
    return events

def _fetch_acled_history(bbox, date_from, date_to, user_id=None):
    """Fetch ACLED events aggregated by date for analysis timeline."""
    events = _fetch_acled_events(bbox, date_from, date_to, limit=5000, user_id=user_id)
    if isinstance(events, dict) and "error" in events:
        return events

    # Aggregate: count + total fatalities per date
    by_date = {}
    for e in events:
        d = e["date"]
        if d not in by_date:
            by_date[d] = {"count": 0, "fatalities": 0}
        by_date[d]["count"] += 1
        by_date[d]["fatalities"] += e.get("fatalities") or 0

    data = [
        {"date": d, "value": v["count"], "fatalities": v["fatalities"]}
        for d, v in sorted(by_date.items())
    ]
    return data

def _safe_float(v):
    try:
        return float(v) if v is not None else None
    except (ValueError, TypeError):
        return None

def _safe_int(v):
    try:
        return int(v) if v is not None else 0
    except (ValueError, TypeError):
        return 0

class ACLEDPlugin(WatchZonePlugin):
    plugin_id = "acled"

    meta = {
        "label": "ACLED",
        "icon_svg": (
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" '
            'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
            '<path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z"/>'
            '<circle cx="12" cy="10" r="3"/>'
            '</svg>'
        ),
        "color": "#dc2626",
        "description": "Bewaffnete Konflikte & politische Gewalt via ACLED",
        "category": "geo",
        "required_credentials": ["acled_email", "acled_password"],
        "has_live": True,
        "has_history": True,
        "panel_template": "acled/_panel.html",
        "js_file": "/plugins/watchzone/acled/static/acled.js",

    }

    # ------------------------------------------------------------------
    # Live Handler
    # ------------------------------------------------------------------

    def live_handler(self, zone, config, geo, bbox, user_id):
        if not bbox:
            return {"error": "Zone hat keine gueltige Geometrie"}

        date_to = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        date_from = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%d")

        events = _fetch_acled_events(bbox, date_from, date_to, limit=500, user_id=user_id)
        if isinstance(events, dict) and "error" in events:
            return events

        # Aggregate stats
        type_counts = {}
        total_fatalities = 0
        for e in events:
            et = e.get("event_type", "Other")
            type_counts[et] = type_counts.get(et, 0) + 1
            total_fatalities += e.get("fatalities") or 0

        return {
            "zone_id": zone.id,
            "zone_name": zone.name,
            "zone_type": "acled",
            "count": len(events),
            "fatalities": total_fatalities,
            "type_counts": type_counts,
            "items": events[:100],
        }

    # ------------------------------------------------------------------
    # History Route
    # ------------------------------------------------------------------

    def history_routes(self):
        return [{"suffix": "acled-history", "handler": self._history_handler}]

    def _history_handler(self, zone, args, user_id):
        import json as _j

        geo = _j.loads(zone.geometry) if zone.geometry else {}
        bbox = geojson_to_bbox(geo)
        if not bbox:
            return jsonify({"error": "Zone hat keine gueltige Geometrie"}), 400

        date_from = args.get("from", "")
        date_to = args.get("to", "")
        if not date_from or not date_to:
            return jsonify({"error": "Parameter 'from' und 'to' erforderlich"}), 400

        try:
            data = _fetch_acled_history(bbox, date_from, date_to, user_id=user_id)
            if isinstance(data, dict) and "error" in data:
                return jsonify(data), 502
            return jsonify({
                "zone_id": zone.id,
                "zone_name": zone.name,
                "data": data,
            })
        except Exception as e:
            log.warning("ACLED-History Fehler (Zone %d): %s", zone.id, e)
            return jsonify({"error": str(e)}), 502

    # ------------------------------------------------------------------
    # AI Tools
    # ------------------------------------------------------------------

    def ai_tools(self):
        return [
            {
                "name": "acled_conflict_data",
                "description": "Ruft ACLED-Konfliktereignisse (bewaffnete Konflikte, politische Gewalt, "
                               "Proteste) fuer eine Region und einen Zeitraum ab.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "zone_id": {
                            "type": "integer",
                            "description": "ID einer Geo-Watch-Zone (alternativ zu bbox)",
                        },
                        "bbox": {
                            "type": "array",
                            "items": {"type": "number"},
                            "description": "[lon_min, lat_min, lon_max, lat_max]",
                        },
                        "date_from": {
                            "type": "string",
                            "description": "Startdatum YYYY-MM-DD",
                        },
                        "date_to": {
                            "type": "string",
                            "description": "Enddatum YYYY-MM-DD",
                        },
                    },
                    "required": ["date_from", "date_to"],
                },
            }
        ]

    def ai_tool_handler(self, tool_name, inputs, user_id):
        if tool_name != "acled_conflict_data":
            return {"error": f"Unbekanntes Tool: {tool_name}"}

        bbox = self._resolve_bbox(inputs.get("zone_id"), inputs.get("bbox"), user_id)
        if not bbox:
            return {"error": "Keine gueltige Region (zone_id oder bbox erforderlich)"}
        try:
            events = _fetch_acled_events(bbox, inputs["date_from"], inputs["date_to"], limit=200, user_id=user_id)
            if isinstance(events, dict) and "error" in events:
                return events
            type_counts = {}
            total_fatalities = 0
            for e in events:
                et = e.get("event_type", "Other")
                type_counts[et] = type_counts.get(et, 0) + 1
                total_fatalities += e.get("fatalities") or 0
            return {
                "bbox": bbox,
                "date_from": inputs["date_from"],
                "date_to": inputs["date_to"],
                "event_count": len(events),
                "fatalities": total_fatalities,
                "type_counts": type_counts,
                "events": events[:50],
            }
        except Exception as e:
            return {"error": str(e)}

    # ------------------------------------------------------------------
    # Analysis Provider
    # ------------------------------------------------------------------

    def analysis_provider(self):
        return {
            "data_types": ["acled"],
            "history_endpoint_suffix": "acled-history",
        }

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _resolve_bbox(zone_id, bbox_input, user_id):
        if bbox_input and len(bbox_input) == 4:
            return bbox_input
        if zone_id:
            import json as _j
            from models import WatchZone
            z = WatchZone.query.filter_by(id=zone_id, user_id=user_id).first()
            if z:
                geo = _j.loads(z.geometry) if z.geometry else {}
                return geojson_to_bbox(geo)
        return None

PluginManager.register(ACLEDPlugin())
