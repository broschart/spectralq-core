"""Vessel Watch Zone Plugin — AIS Ship Tracking."""

from plugins import PluginManager
from plugins.watchzone import WatchZonePlugin


class VesselPlugin(WatchZonePlugin):
    plugin_id = "vessel"

    meta = {
        "label": "Vessels",
        "icon_svg": (
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" '
            'stroke="currentColor" stroke-width="2">'
            '<path d="M2 20l1.5-4H6l1-2h10l1 2h2.5L22 20H2z"/>'
            '<path d="M7 14V8l5-4 5 4v6"/>'
            '</svg>'
        ),
        "color": "#3b82f6",
        "description": "AIS-Schiffsverfolgung via VesselFinder / AISHub",
        "category": "geo",
        "required_credentials": ["aishub_user"],
        "has_live": True,
        "has_history": False,
        "panel_template": "vessel/_panel.html",
        "js_file": "/plugins/watchzone/vessel/static/vessel.js",
    }

    def live_handler(self, zone, config, geo, bbox, user_id):
        from plugins.watchzone.vessel._transport import fetch_ais_vessels
        if not bbox:
            return {"error": "Zone hat keine gueltige Geometrie"}
        items = fetch_ais_vessels(bbox, user_id=user_id)
        return {
            "zone_id": zone.id, "zone_name": zone.name,
            "zone_type": "vessel", "count": len(items), "items": items,
        }

    def ai_tools(self):
        return [{
            "name": "vessel_traffic",
            "description": "Ruft aktuelle AIS-Schiffsverkehrsdaten fuer eine Region oder Watch Zone ab.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "zone_id": {"type": "integer", "description": "ID einer Geo-Watch-Zone (alternativ zu bbox)"},
                    "bbox": {"type": "array", "items": {"type": "number"}, "description": "[lon_min, lat_min, lon_max, lat_max]"},
                },
            },
        }]

    def ai_tool_handler(self, tool_name, inputs, user_id):
        if tool_name != "vessel_traffic":
            return {"error": f"Unbekanntes Tool: {tool_name}"}
        from plugins.watchzone._helpers import geojson_to_bbox
        bbox = self._resolve_bbox(inputs.get("zone_id"), inputs.get("bbox"), user_id)
        if not bbox:
            return {"error": "Keine gueltige Region (zone_id oder bbox erforderlich)"}
        try:
            from plugins.watchzone.vessel._transport import fetch_ais_vessels
            vessels = fetch_ais_vessels(bbox, user_id=user_id)
            if not vessels:
                return {"bbox": bbox, "count": 0, "vessels": []}
            types_cnt = {}
            flags_cnt = {}
            anomalous = [v for v in vessels if v.get("anomaly_score", 0) > 0]
            for v in vessels:
                u = v.get("usage", "?"); types_cnt[u] = types_cnt.get(u, 0) + 1
                f = v.get("flag") or "?"; flags_cnt[f] = flags_cnt.get(f, 0) + 1
            return {
                "bbox": bbox, "count": len(vessels),
                "types": types_cnt, "flags": flags_cnt,
                "anomalous_count": len(anomalous),
                "anomalous": [{"name": v.get("name"), "mmsi": v.get("mmsi"),
                               "flags": v.get("anomaly_flags", [])} for v in anomalous[:10]],
                "sample": vessels[:20],
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
                geo = _j.loads(z.geometry) if z.geometry else {}
                return geojson_to_bbox(geo)
        return None


PluginManager.register(VesselPlugin())
