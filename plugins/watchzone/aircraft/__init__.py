"""Aircraft Watch Zone Plugin — ADS-B Flight Tracking."""

from plugins import PluginManager
from plugins.watchzone import WatchZonePlugin

class AircraftPlugin(WatchZonePlugin):
    plugin_id = "aircraft"

    meta = {
        "label": "Aircraft",
        "icon_svg": (
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" '
            'stroke="currentColor" stroke-width="2">'
            '<path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 00-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>'
            '</svg>'
        ),
        "color": "#f59e0b",
        "description": "ADS-B Flugzeugverfolgung via airplanes.live",
        "category": "geo",
        "required_credentials": [],
        "has_live": True,
        "has_history": False,
        "panel_template": "aircraft/_panel.html",
        "js_file": "/plugins/watchzone/aircraft/static/aircraft.js",
        "live_header_template": "aircraft/_live_hdr.html",
        "live_side_panels_template": "aircraft/_live_panels.html",
        "live_parcoords_template": "aircraft/_live_parcoords.html",
        "live_refresh_template": "aircraft/_live_refresh.html",
    }

    def live_handler(self, zone, config, geo, bbox, user_id):
        from plugins.watchzone.aircraft._transport import fetch_aircraft_live
        if not bbox:
            return {"error": "Zone hat keine gueltige Geometrie"}
        items = fetch_aircraft_live(bbox, user_id=user_id)
        return {
            "zone_id": zone.id, "zone_name": zone.name,
            "zone_type": "aircraft", "count": len(items), "items": items,
        }

    def ai_tools(self):
        return [{
            "name": "aircraft_traffic",
            "description": "Ruft aktuelle ADS-B-Flugzeugdaten fuer eine Region oder Watch Zone ab (airplanes.live).",
            "input_schema": {
                "type": "object",
                "properties": {
                    "zone_id": {"type": "integer", "description": "ID einer Geo-Watch-Zone (alternativ zu bbox)"},
                    "bbox": {"type": "array", "items": {"type": "number"}, "description": "[lon_min, lat_min, lon_max, lat_max]"},
                },
            },
        }]

    def ai_tool_handler(self, tool_name, inputs, user_id):
        if tool_name != "aircraft_traffic":
            return {"error": f"Unbekanntes Tool: {tool_name}"}
        bbox = self._resolve_bbox(inputs.get("zone_id"), inputs.get("bbox"), user_id)
        if not bbox:
            return {"error": "Keine gueltige Region (zone_id oder bbox erforderlich)"}
        try:
            from plugins.watchzone.aircraft._transport import fetch_aircraft_live
            aircraft = fetch_aircraft_live(bbox, user_id=user_id)
            if not aircraft:
                return {"bbox": bbox, "count": 0, "aircraft": []}
            types_cnt = {}
            ops_cnt = {}
            emergencies = [a for a in aircraft if a.get("emergency", "none") not in ("none", "", None)]
            on_ground = sum(1 for a in aircraft if a.get("on_ground"))
            for a in aircraft:
                t = a.get("type") or "?"; types_cnt[t] = types_cnt.get(t, 0) + 1
                op = a.get("operator") or a.get("country") or "?"; ops_cnt[op] = ops_cnt.get(op, 0) + 1
            return {
                "bbox": bbox, "count": len(aircraft), "on_ground": on_ground,
                "types": types_cnt, "operators": ops_cnt,
                "emergencies": [{"callsign": a.get("callsign"), "type": a.get("emergency")} for a in emergencies[:10]],
                "sample": aircraft[:20],
            }
        except Exception as e:
            return {"error": str(e)}

    @staticmethod
    def _resolve_bbox(zone_id, bbox_input, user_id):
        if bbox_input and len(bbox_input) == 4:
            return bbox_input
        if zone_id:
            import json as _j
            from models import WatchZone
            from plugins.watchzone._helpers import geojson_to_bbox
            z = WatchZone.query.filter_by(id=zone_id, user_id=user_id).first()
            if z:
                return geojson_to_bbox(_j.loads(z.geometry) if z.geometry else {})
        return None

PluginManager.register(AircraftPlugin())
