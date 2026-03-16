"""Nightlights Watch Zone Plugin — NASA VIIRS Day/Night Band."""

from flask import jsonify
from plugins import PluginManager
from plugins.watchzone import WatchZonePlugin
from plugins.watchzone._helpers import geojson_to_bbox

class NightlightsPlugin(WatchZonePlugin):
    plugin_id = "nightlights"

    meta = {
        "label": "Nachtlichter",
        "icon_svg": (
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" '
            'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
            '<circle cx="12" cy="12" r="4"/>'
            '<path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>'
            '</svg>'
        ),
        "color": "#fbbf24",
        "description": "NASA VIIRS Nachtlichtdaten (GIBS)",
        "category": "geo",
        "required_credentials": [],
        "has_live": True,
        "has_history": True,
        "panel_template": "nightlights/_panel.html",
        "js_file": "/plugins/watchzone/nightlights/static/nightlights.js",

    }

    def live_handler(self, zone, config, geo, bbox, user_id):
        from datetime import datetime as _dt, timedelta as _td
        from plugins.watchzone.nightlights._transport import fetch_nightlights_snapshot
        if not bbox:
            return {"error": "Zone hat keine gueltige Geometrie"}
        date_str = (_dt.utcnow() - _td(days=2)).strftime("%Y-%m-%d")
        img_url, mean_brightness = fetch_nightlights_snapshot(bbox, date_str)
        return {
            "zone_id": zone.id, "zone_name": zone.name, "zone_type": "nightlights",
            "image_url": img_url, "mean_brightness": mean_brightness,
            "bbox": bbox, "date": date_str,
        }

    def history_routes(self):
        return [{"suffix": "nightlights-history", "handler": self._history_handler}]

    def _history_handler(self, zone, args, user_id):
        import json as _j, logging
        log = logging.getLogger(__name__)
        geo = _j.loads(zone.geometry) if zone.geometry else {}
        bbox = geojson_to_bbox(geo)
        if not bbox:
            return jsonify({"error": "Zone hat keine gueltige Geometrie"}), 400
        date_from = args.get("from", "")
        date_to = args.get("to", "")
        if not date_from or not date_to:
            return jsonify({"error": "Parameter 'from' und 'to' erforderlich"}), 400
        try:
            from plugins.watchzone.nightlights._transport import fetch_nightlights_history
            data = fetch_nightlights_history(bbox, date_from, date_to)
            return jsonify({"zone_id": zone.id, "zone_name": zone.name, "data": data})
        except Exception as e:
            log.warning("Nightlights-History Fehler (Zone %d): %s", zone.id, e)
            return jsonify({"error": str(e)}), 502

    def ai_tools(self):
        return [{
            "name": "nightlights_history",
            "description": "Ruft historische NASA VIIRS Nachtlichthelligkeit fuer eine Region oder Watch Zone ab.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "zone_id": {"type": "integer", "description": "ID einer Geo-Watch-Zone (alternativ zu bbox)"},
                    "bbox": {"type": "array", "items": {"type": "number"}, "description": "[lon_min, lat_min, lon_max, lat_max]"},
                    "date_from": {"type": "string", "description": "Startdatum YYYY-MM-DD"},
                    "date_to": {"type": "string", "description": "Enddatum YYYY-MM-DD"},
                },
                "required": ["date_from", "date_to"],
            },
        }]

    def ai_tool_handler(self, tool_name, inputs, user_id):
        if tool_name != "nightlights_history":
            return {"error": f"Unbekanntes Tool: {tool_name}"}
        bbox = self._resolve_bbox(inputs.get("zone_id"), inputs.get("bbox"), user_id)
        if not bbox:
            return {"error": "Keine gueltige Region (zone_id oder bbox erforderlich)"}
        try:
            from plugins.watchzone.nightlights._transport import fetch_nightlights_history
            data = fetch_nightlights_history(bbox, inputs["date_from"], inputs["date_to"])
            return {"bbox": bbox, "date_from": inputs["date_from"], "date_to": inputs["date_to"], "count": len(data), "data": data}
        except Exception as e:
            return {"error": str(e)}

    def analysis_provider(self):
        return {"data_types": ["nightlights"], "history_endpoint_suffix": "nightlights-history"}

    @staticmethod
    def _resolve_bbox(zone_id, bbox_input, user_id):
        if bbox_input and len(bbox_input) == 4:
            return bbox_input
        if zone_id:
            import json as _j
            from models import WatchZone
            z = WatchZone.query.filter_by(id=zone_id, user_id=user_id).first()
            if z:
                return geojson_to_bbox(_j.loads(z.geometry) if z.geometry else {})
        return None

PluginManager.register(NightlightsPlugin())
