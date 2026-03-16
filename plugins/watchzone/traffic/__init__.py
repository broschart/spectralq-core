"""Traffic Watch Zone Plugin — TomTom Traffic API."""

import logging
from datetime import datetime, timezone

from flask import jsonify
from plugins import PluginManager
from plugins.watchzone import WatchZonePlugin
from plugins.watchzone._helpers import geojson_to_bbox

log = logging.getLogger(__name__)

UA = "VeriTrend.ai/1.0 (forensic trend analysis; contact@veritrend.ai)"
TOMTOM_INCIDENTS = "https://api.tomtom.com/traffic/services/5/incidentDetails"
TOMTOM_FLOW = "https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json"

# Icon categories from TomTom
INCIDENT_CATEGORIES = {
    0: ("Unknown", "#64748b"),
    1: ("Unfall", "#dc2626"),
    2: ("Nebel", "#94a3b8"),
    3: ("Gefahr", "#f59e0b"),
    4: ("Regen", "#3b82f6"),
    5: ("Eis", "#06b6d4"),
    6: ("Stau", "#ea580c"),
    7: ("Baustelle", "#eab308"),
    8: ("Wind", "#8b5cf6"),
    9: ("Sperrung", "#dc2626"),
    10: ("Strassensperre", "#dc2626"),
    11: ("Umleitung", "#f59e0b"),
    14: ("Defektes Fahrzeug", "#64748b"),
}

# Magnitude labels
MAGNITUDE = {0: "Unbekannt", 1: "Gering", 2: "Moderat", 3: "Erheblich", 4: "Schwer"}

def _get_tomtom_key(user_id=None):
    """Get TomTom API key from credential store."""
    from transport import _get_credential
    return _get_credential("tomtom_api_key", "TOMTOM_API_KEY", user_id)

def _fetch_incidents(bbox, api_key):
    """Fetch traffic incidents in bounding box from TomTom."""
    import requests as _rq

    # TomTom bbox format: minLon,minLat,maxLon,maxLat
    bbox_str = f"{bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]}"

    try:
        r = _rq.get(TOMTOM_INCIDENTS, params={
            "key": api_key,
            "bbox": bbox_str,
            "fields": (
                "{incidents{type,geometry{type,coordinates},"
                "properties{id,iconCategory,magnitudeOfDelay,events,startTime,"
                "endTime,from,to,length,delay,roadNumbers}}}"
            ),
            "language": "de-DE",
            "timeValidityFilter": "present",
        }, headers={"User-Agent": UA}, timeout=15)
        r.raise_for_status()
        data = r.json()
    except Exception as exc:
        log.warning("TomTom Incidents error: %s", exc)
        return {"error": str(exc)[:200]}

    incidents = []
    for feat in data.get("incidents", []):
        props = feat.get("properties", {})
        geom = feat.get("geometry", {})
        coords = geom.get("coordinates", [])

        # Extract center point from LineString or Point
        lat, lon = None, None
        if geom.get("type") == "Point" and len(coords) >= 2:
            lon, lat = coords[0], coords[1]
        elif geom.get("type") == "LineString" and coords:
            mid = coords[len(coords) // 2]
            lon, lat = mid[0], mid[1]

        icon_cat = props.get("iconCategory", 0)
        cat_label, cat_color = INCIDENT_CATEGORIES.get(icon_cat, ("Sonstig", "#64748b"))

        events = props.get("events", [])
        description = events[0].get("description", "") if events else ""

        incidents.append({
            "id": props.get("id", ""),
            "lat": lat,
            "lon": lon,
            "category": cat_label,
            "category_id": icon_cat,
            "color": cat_color,
            "magnitude": props.get("magnitudeOfDelay", 0),
            "magnitude_label": MAGNITUDE.get(props.get("magnitudeOfDelay", 0), ""),
            "description": description,
            "from": props.get("from", ""),
            "to": props.get("to", ""),
            "length_m": props.get("length", 0),
            "delay_s": props.get("delay", 0),
            "roads": props.get("roadNumbers", []),
            "start": (props.get("startTime") or "")[:19],
        })

    # Sort by magnitude descending
    incidents.sort(key=lambda x: -(x.get("magnitude") or 0))
    return incidents

def _fetch_flow_sample(bbox, api_key, samples=9):
    """Sample traffic flow at grid points across the bbox."""
    import requests as _rq

    min_lon, min_lat, max_lon, max_lat = bbox
    # Create grid of sample points
    points = []
    cols = 3
    rows = 3
    for r in range(rows):
        for c in range(cols):
            lat = min_lat + (max_lat - min_lat) * (r + 0.5) / rows
            lon = min_lon + (max_lon - min_lon) * (c + 0.5) / cols
            points.append((lat, lon))

    results = []
    for lat, lon in points[:samples]:
        try:
            resp = _rq.get(TOMTOM_FLOW, params={
                "key": api_key,
                "point": f"{lat},{lon}",
                "unit": "kmph",
            }, headers={"User-Agent": UA}, timeout=10)
            if resp.status_code != 200:
                continue
            seg = resp.json().get("flowSegmentData", {})
            current = seg.get("currentSpeed")
            freeflow = seg.get("freeFlowSpeed")
            if current is not None and freeflow is not None and freeflow > 0:
                results.append({
                    "lat": lat,
                    "lon": lon,
                    "current_speed": current,
                    "free_flow_speed": freeflow,
                    "ratio": round(current / freeflow, 2),
                    "confidence": seg.get("confidence", 0),
                })
        except Exception:
            continue

    return results

class TrafficPlugin(WatchZonePlugin):
    plugin_id = "traffic"

    meta = {
        "label": "Verkehr",
        "icon_svg": (
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" '
            'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
            '<rect x="1" y="3" width="22" height="18" rx="2"/>'
            '<circle cx="12" cy="8" r="2" fill="currentColor"/>'
            '<circle cx="12" cy="16" r="2"/>'
            '<circle cx="12" cy="12" r="2"/>'
            '</svg>'
        ),
        "color": "#ea580c",
        "description": "Verkehrslage & Stoerungen via TomTom Traffic API",
        "category": "geo",
        "required_credentials": ["tomtom_api_key"],
        "has_live": True,
        "has_history": False,
        "panel_template": "traffic/_panel.html",
        "js_file": "/plugins/watchzone/traffic/static/traffic.js",

    }

    def live_handler(self, zone, config, geo, bbox, user_id):
        if not bbox:
            return {"error": "Zone hat keine gueltige Geometrie"}

        api_key = _get_tomtom_key(user_id)
        if not api_key:
            return {"error": "TomTom API-Key fehlt. Bitte unter Plugins eintragen."}

        incidents = _fetch_incidents(bbox, api_key)
        if isinstance(incidents, dict) and "error" in incidents:
            return incidents

        flow = _fetch_flow_sample(bbox, api_key, samples=9)

        # Stats
        cat_counts = {}
        total_delay = 0
        severe_count = 0
        for inc in incidents:
            cat = inc.get("category", "Sonstig")
            cat_counts[cat] = cat_counts.get(cat, 0) + 1
            total_delay += inc.get("delay_s") or 0
            if (inc.get("magnitude") or 0) >= 3:
                severe_count += 1

        avg_ratio = None
        if flow:
            ratios = [f["ratio"] for f in flow if f.get("ratio") is not None]
            if ratios:
                avg_ratio = round(sum(ratios) / len(ratios), 2)

        return {
            "zone_id": zone.id,
            "zone_name": zone.name,
            "zone_type": "traffic",
            "count": len(incidents),
            "severe_count": severe_count,
            "total_delay_s": total_delay,
            "category_counts": cat_counts,
            "avg_flow_ratio": avg_ratio,
            "flow_samples": flow,
            "items": incidents[:80],
            "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }

    def ai_tools(self):
        return [{
            "name": "get_traffic_data",
            "description": "Ruft aktuelle Verkehrsstoerungen und Verkehrsfluss-Daten fuer eine Watch Zone ab (TomTom).",
            "input_schema": {
                "type": "object",
                "properties": {
                    "zone_id": {"type": "integer", "description": "ID der Watch Zone"},
                },
                "required": ["zone_id"],
            },
        }]

    def ai_tool_handler(self, tool_name, inputs, user_id):
        if tool_name != "get_traffic_data":
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
            "incident_count": result["count"],
            "severe_count": result["severe_count"],
            "total_delay_minutes": round(result["total_delay_s"] / 60, 1),
            "category_counts": result["category_counts"],
            "avg_flow_ratio": result["avg_flow_ratio"],
            "incidents": result["items"][:20],
        }

PluginManager.register(TrafficPlugin())
