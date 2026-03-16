"""Air Quality Watch Zone Plugin — OpenAQ."""

import logging
from datetime import datetime, timedelta, timezone

from flask import jsonify
from plugins import PluginManager
from plugins.watchzone import WatchZonePlugin
from plugins.watchzone._helpers import geojson_to_bbox

log = logging.getLogger(__name__)

UA = "VeriTrend.ai/1.0 (forensic trend analysis; contact@veritrend.ai)"
OPENAQ_API = "https://api.openaq.org/v3"

# AQI breakpoints (simplified US EPA scale for PM2.5 µg/m³)
AQI_LEVELS = [
    (12.0,  "Gut",        "#22c55e"),
    (35.4,  "Moderat",    "#eab308"),
    (55.4,  "Ungesund*",  "#f59e0b"),
    (150.4, "Ungesund",   "#ea580c"),
    (250.4, "Sehr ungesund", "#dc2626"),
    (500.0, "Gefaehrlich", "#7f1d1d"),
]

PARAM_LABELS = {
    "pm25": ("PM2.5", "µg/m³"),
    "pm10": ("PM10", "µg/m³"),
    "o3":   ("Ozon", "µg/m³"),
    "no2":  ("NO₂", "µg/m³"),
    "so2":  ("SO₂", "µg/m³"),
    "co":   ("CO", "µg/m³"),
}

def _get_openaq_key(user_id=None):
    from transport import _get_credential
    return _get_credential("openaq_api_key", "OPENAQ_API_KEY", user_id)

def _aq_headers(api_key):
    return {"User-Agent": UA, "X-API-Key": api_key, "Accept": "application/json"}

def _aqi_label(pm25):
    """Return (label, color) for PM2.5 value."""
    if pm25 is None:
        return ("?", "#64748b")
    for threshold, label, color in AQI_LEVELS:
        if pm25 <= threshold:
            return (label, color)
    return ("Gefaehrlich", "#7f1d1d")

def _fetch_locations(bbox, api_key, limit=100):
    """Fetch air quality monitoring stations in bounding box."""
    import requests as _rq

    # OpenAQ bbox: minLon,minLat,maxLon,maxLat
    bbox_str = f"{bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]}"

    try:
        r = _rq.get(f"{OPENAQ_API}/locations", params={
            "bbox": bbox_str,
            "limit": str(limit),
        }, headers=_aq_headers(api_key), timeout=15)
        r.raise_for_status()
        data = r.json()
    except Exception as exc:
        log.warning("OpenAQ locations error: %s", exc)
        return {"error": str(exc)[:200]}

    return data.get("results", [])

def _fetch_latest(location_id, api_key):
    """Fetch latest measurements for a location."""
    import requests as _rq

    try:
        r = _rq.get(f"{OPENAQ_API}/locations/{location_id}/latest", params={},
                     headers=_aq_headers(api_key), timeout=10)
        r.raise_for_status()
        data = r.json()
    except Exception as exc:
        log.warning("OpenAQ latest error: %s", exc)
        return []

    return data.get("results", [])

def _fetch_sensor_history(sensor_id, api_key, date_from, date_to):
    """Fetch daily aggregated measurements for a sensor."""
    import requests as _rq

    try:
        r = _rq.get(f"{OPENAQ_API}/sensors/{sensor_id}/measurements/daily", params={
            "date_from": date_from,
            "date_to": date_to,
            "limit": 1000,
        }, headers=_aq_headers(api_key), timeout=20)
        r.raise_for_status()
        data = r.json()
    except Exception as exc:
        log.warning("OpenAQ history error: %s", exc)
        return {"error": str(exc)[:200]}

    return data.get("results", [])

class AirQualityPlugin(WatchZonePlugin):
    plugin_id = "airquality"

    meta = {
        "label": "Luftqualitaet",
        "icon_svg": (
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" '
            'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
            '<path d="M8 2c3 0 5 2 8 2s4-1 4-1v11s-1 1-4 1-5-2-8-2-4 1-4 1V2s1-1 4-1z"/>'
            '<line x1="4" y1="22" x2="4" y2="15"/>'
            '</svg>'
        ),
        "color": "#22c55e",
        "description": "Luftqualitaet & Feinstaub via OpenAQ",
        "category": "geo",
        "required_credentials": ["openaq_api_key"],
        "has_live": True,
        "has_history": True,
        "panel_template": "airquality/_panel.html",
        "js_file": "/plugins/watchzone/airquality/static/airquality.js",

    }

    def live_handler(self, zone, config, geo, bbox, user_id):
        if not bbox:
            return {"error": "Zone hat keine gueltige Geometrie"}

        api_key = _get_openaq_key(user_id)
        if not api_key:
            return {"error": "OpenAQ API-Key fehlt. Kostenlos registrieren auf openaq.org."}

        locations_raw = _fetch_locations(bbox, api_key, limit=100)
        if isinstance(locations_raw, dict) and "error" in locations_raw:
            return locations_raw

        stations = []
        worst_pm25 = None
        avg_pm25_vals = []

        for loc in locations_raw:
            coords = loc.get("coordinates") or {}
            lat = coords.get("latitude")
            lon = coords.get("longitude")
            loc_id = loc.get("id")
            name = loc.get("name", "")
            locality = loc.get("locality") or ""
            country_code = (loc.get("country") or {}).get("code", "")

            # Extract sensors and latest values
            sensors = loc.get("sensors", [])
            params = {}
            pm25_val = None
            sensor_ids = {}
            for s in sensors:
                p = s.get("parameter") or {}
                pname = p.get("name", "")
                pid = p.get("id")
                sid = s.get("id")
                latest = s.get("latest") or {}
                val = latest.get("value")
                unit = (p.get("units") or {}).get("name", "")
                ts = (latest.get("datetime") or {}).get("utc", "")

                params[pname] = {"value": val, "unit": unit, "time": ts[:16] if ts else ""}
                if sid:
                    sensor_ids[pname] = sid
                if pname == "pm25" and val is not None:
                    pm25_val = val

            if pm25_val is not None:
                avg_pm25_vals.append(pm25_val)
                if worst_pm25 is None or pm25_val > worst_pm25:
                    worst_pm25 = pm25_val

            label, color = _aqi_label(pm25_val)

            stations.append({
                "id": loc_id,
                "name": name,
                "locality": locality,
                "country": country_code,
                "lat": lat,
                "lon": lon,
                "pm25": pm25_val,
                "aqi_label": label,
                "aqi_color": color,
                "params": params,
                "sensor_ids": sensor_ids,
            })

        # Sort: worst PM2.5 first
        stations.sort(key=lambda s: -(s.get("pm25") or 0))

        avg_pm25 = round(sum(avg_pm25_vals) / len(avg_pm25_vals), 1) if avg_pm25_vals else None
        avg_label, avg_color = _aqi_label(avg_pm25)

        return {
            "zone_id": zone.id,
            "zone_name": zone.name,
            "zone_type": "airquality",
            "count": len(stations),
            "avg_pm25": avg_pm25,
            "avg_label": avg_label,
            "avg_color": avg_color,
            "worst_pm25": worst_pm25,
            "items": stations[:60],
        }

    # ------------------------------------------------------------------
    # History
    # ------------------------------------------------------------------

    def history_routes(self):
        return [{"suffix": "airquality-history", "handler": self._history_handler}]

    def _history_handler(self, zone, args, user_id):
        import json as _j

        api_key = _get_openaq_key(user_id)
        if not api_key:
            return jsonify({"error": "OpenAQ API-Key fehlt."}), 400

        sensor_id = args.get("sensor_id", "")
        if not sensor_id:
            return jsonify({"error": "Parameter 'sensor_id' erforderlich"}), 400

        date_from = args.get("from", "")
        date_to = args.get("to", "")
        if not date_from or not date_to:
            return jsonify({"error": "Parameter 'from' und 'to' erforderlich"}), 400

        results = _fetch_sensor_history(sensor_id, api_key, date_from, date_to)
        if isinstance(results, dict) and "error" in results:
            return jsonify(results), 502

        data = []
        for m in results:
            period = m.get("period") or {}
            dt_info = period.get("datetimeFrom") or {}
            dt = dt_info.get("utc", "")[:10] if dt_info else ""
            summary = m.get("value") or {}
            data.append({
                "date": dt,
                "value": summary.get("avg"),
                "min": summary.get("min"),
                "max": summary.get("max"),
            })

        data.sort(key=lambda d: d["date"])
        return jsonify({"zone_id": zone.id, "zone_name": zone.name, "data": data})

    # ------------------------------------------------------------------
    # AI Tools
    # ------------------------------------------------------------------

    def ai_tools(self):
        return [{
            "name": "get_airquality_data",
            "description": "Ruft aktuelle Luftqualitaetsdaten (PM2.5, PM10, Ozon etc.) fuer eine Watch Zone ab.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "zone_id": {"type": "integer", "description": "ID der Watch Zone"},
                },
                "required": ["zone_id"],
            },
        }]

    def ai_tool_handler(self, tool_name, inputs, user_id):
        if tool_name != "get_airquality_data":
            return {"error": f"Unbekanntes Tool: {tool_name}"}
        import json as _j
        from models import WatchZone
        z = WatchZone.query.filter_by(id=inputs["zone_id"], user_id=user_id).first()
        if not z:
            return {"error": f"Zone {inputs['zone_id']} nicht gefunden"}
        geo = _j.loads(z.geometry) if z.geometry else {}
        bbox = geojson_to_bbox(geo)
        if not bbox:
            return {"error": "Zone hat keine gueltige Geometrie"}
        result = self.live_handler(z, _j.loads(z.config) if z.config else {}, geo, bbox, user_id)
        if "error" in result:
            return result
        return {
            "zone_id": z.id,
            "station_count": result["count"],
            "avg_pm25": result["avg_pm25"],
            "avg_quality": result["avg_label"],
            "worst_pm25": result["worst_pm25"],
            "stations": result["items"][:15],
        }

    def analysis_provider(self):
        return {
            "data_types": ["airquality"],
            "history_endpoint_suffix": "airquality-history",
        }

PluginManager.register(AirQualityPlugin())
