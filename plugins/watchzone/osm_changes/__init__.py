"""OSM Changes Watch Zone Plugin — OpenStreetMap edits via Overpass API."""

import logging
from datetime import datetime, timedelta, timezone

from flask import jsonify
from plugins import PluginManager
from plugins.watchzone import WatchZonePlugin
from plugins.watchzone._helpers import geojson_to_bbox

log = logging.getLogger(__name__)

UA = "VeriTrend.ai/1.0 (forensic trend analysis; contact@veritrend.ai)"
OVERPASS_API = "https://overpass-api.de/api/interpreter"

# Forensically interesting tags
TRACKED_TAGS = {
    "building":    ("Gebäude",   "#f59e0b"),
    "highway":     ("Straße",    "#3b82f6"),
    "landuse":     ("Landnutzung", "#22c55e"),
    "military":    ("Militär",   "#dc2626"),
    "aeroway":     ("Flughafen", "#8b5cf6"),
    "railway":     ("Eisenbahn", "#64748b"),
    "waterway":    ("Gewässer",  "#06b6d4"),
    "barrier":     ("Barriere",  "#ea580c"),
    "power":       ("Energie",   "#eab308"),
    "amenity":     ("Einrichtung", "#a78bfa"),
}

def _overpass_query(query, timeout=60):
    """Execute an Overpass QL query and return JSON."""
    import requests as _rq

    try:
        r = _rq.post(OVERPASS_API, data={"data": query},
                      headers={"User-Agent": UA}, timeout=timeout)
        r.raise_for_status()
        return r.json()
    except Exception as exc:
        log.warning("Overpass API error: %s", exc)
        return {"error": str(exc)[:200]}

def _fetch_recent_edits(bbox, days=30):
    """Fetch recently edited/created elements in bbox."""
    min_lon, min_lat, max_lon, max_lat = bbox
    since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")

    # Query for recently changed nodes, ways, relations with key tags
    tag_filters = "|".join(TRACKED_TAGS.keys())
    query = f"""
[out:json][timeout:90];
(
  node(newer:"{since}")({min_lat},{min_lon},{max_lat},{max_lon});
  way(newer:"{since}")({min_lat},{min_lon},{max_lat},{max_lon});
  relation(newer:"{since}")({min_lat},{min_lon},{max_lat},{max_lon});
);
out center meta 500;
"""

    data = _overpass_query(query, timeout=90)
    if isinstance(data, dict) and "error" in data:
        return data

    elements = data.get("elements", [])

    # Categorize and build results
    items = []
    tag_counts = {}
    users = {}

    for el in elements:
        tags = el.get("tags", {})
        el_type = el.get("type", "node")

        # Determine center point
        lat = el.get("lat") or (el.get("center", {}) or {}).get("lat")
        lon = el.get("lon") or (el.get("center", {}) or {}).get("lon")

        # Find the most interesting tag
        category = None
        cat_label = "Sonstig"
        cat_color = "#64748b"
        for tag_key in TRACKED_TAGS:
            if tag_key in tags:
                category = tag_key
                cat_label, cat_color = TRACKED_TAGS[tag_key]
                break

        if not category and not tags:
            continue  # skip untagged nodes

        # Determine primary label
        name = tags.get("name", "")
        tag_detail = ""
        if category:
            tag_detail = tags.get(category, "yes")
            if tag_detail == "yes":
                tag_detail = category

        user = el.get("user", "anonymous")
        timestamp = el.get("timestamp", "")
        version = el.get("version", 1)

        tag_counts[cat_label] = tag_counts.get(cat_label, 0) + 1
        users[user] = users.get(user, 0) + 1

        items.append({
            "id": el.get("id"),
            "type": el_type,
            "lat": lat,
            "lon": lon,
            "category": cat_label,
            "color": cat_color,
            "tag_key": category or "",
            "tag_value": tag_detail,
            "name": name,
            "user": user,
            "timestamp": timestamp[:19] if timestamp else "",
            "version": version,
            "is_new": version == 1,
        })

    # Sort by timestamp descending
    items.sort(key=lambda x: x.get("timestamp", ""), reverse=True)

    # Top contributors
    top_users = sorted(users.items(), key=lambda x: -x[1])[:10]

    return {
        "items": items[:200],
        "total": len(elements),
        "tag_counts": tag_counts,
        "top_users": [{"user": u, "edits": c} for u, c in top_users],
        "new_count": sum(1 for i in items if i.get("is_new")),
    }

def _fetch_edit_history(bbox, date_from, date_to):
    """Count edits per day in bbox for timeline."""
    min_lon, min_lat, max_lon, max_lat = bbox
    since = date_from + "T00:00:00Z"

    query = f"""
[out:json][timeout:120];
(
  node(newer:"{since}")({min_lat},{min_lon},{max_lat},{max_lon});
  way(newer:"{since}")({min_lat},{min_lon},{max_lat},{max_lon});
);
out meta 5000;
"""

    data = _overpass_query(query, timeout=120)
    if isinstance(data, dict) and "error" in data:
        return data

    elements = data.get("elements", [])
    by_date = {}
    for el in elements:
        ts = el.get("timestamp", "")[:10]
        if ts and ts >= date_from and ts <= date_to:
            by_date[ts] = by_date.get(ts, 0) + 1

    return [{"date": d, "value": c} for d, c in sorted(by_date.items())]

class OSMChangesPlugin(WatchZonePlugin):
    plugin_id = "osm_changes"

    meta = {
        "label": "OSM Änderungen",
        "icon_svg": (
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" '
            'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
            '<polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/>'
            '<line x1="12" y1="22" x2="12" y2="15.5"/>'
            '<polyline points="22 8.5 12 15.5 2 8.5"/>'
            '</svg>'
        ),
        "color": "#7cb342",
        "description": "OpenStreetMap-Aenderungen via Overpass API",
        "category": "geo",
        "required_credentials": [],
        "has_live": True,
        "has_history": True,
        "panel_template": "osm_changes/_panel.html",
        "js_file": "/plugins/watchzone/osm_changes/static/osm_changes.js",

    }

    def live_handler(self, zone, config, geo, bbox, user_id):
        if not bbox:
            return {"error": "Zone hat keine gueltige Geometrie"}

        days = config.get("days", 30)
        result = _fetch_recent_edits(bbox, days=days)
        if isinstance(result, dict) and "error" in result:
            return result

        return {
            "zone_id": zone.id,
            "zone_name": zone.name,
            "zone_type": "osm_changes",
            "count": result["total"],
            "new_count": result["new_count"],
            "tag_counts": result["tag_counts"],
            "top_users": result["top_users"],
            "items": result["items"],
        }

    def history_routes(self):
        return [{"suffix": "osm-history", "handler": self._history_handler}]

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

        data = _fetch_edit_history(bbox, date_from, date_to)
        if isinstance(data, dict) and "error" in data:
            return jsonify(data), 502

        return jsonify({
            "zone_id": zone.id, "zone_name": zone.name, "data": data,
        })

    def ai_tools(self):
        return [{
            "name": "get_osm_changes",
            "description": "Ruft kuerzliche OpenStreetMap-Aenderungen in einer Watch Zone ab.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "zone_id": {"type": "integer", "description": "ID der Watch Zone"},
                    "days": {"type": "integer", "description": "Zeitraum in Tagen (Standard: 30)"},
                },
                "required": ["zone_id"],
            },
        }]

    def ai_tool_handler(self, tool_name, inputs, user_id):
        if tool_name != "get_osm_changes":
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
        days = inputs.get("days", 30)
        result = _fetch_recent_edits(bbox, days=days)
        if isinstance(result, dict) and "error" in result:
            return result
        return {
            "zone_id": z.id,
            "total_changes": result["total"],
            "new_objects": result["new_count"],
            "tag_counts": result["tag_counts"],
            "top_users": result["top_users"],
            "recent": result["items"][:20],
        }

    def analysis_provider(self):
        return {"data_types": ["osm_changes"], "history_endpoint_suffix": "osm-history"}

PluginManager.register(OSMChangesPlugin())
