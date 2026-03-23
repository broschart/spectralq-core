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
        "apa_action": "aircraft_traffic",
    }

    def apa_action_handler(self, action):
        """Returns dict with: status_msg, report, data_msg, error"""
        import json as _j
        from plugins.watchzone.aircraft._transport import fetch_aircraft_live

        ac_bbox = action.get("bbox")
        ac_zone_id = action.get("zone_id")
        if not ac_bbox and ac_zone_id:
            from models import WatchZone
            from plugins.watchzone._helpers import geojson_to_bbox
            _wz = WatchZone.query.get(ac_zone_id)
            if _wz and _wz.geometry:
                ac_bbox = geojson_to_bbox(_j.loads(_wz.geometry))

        if not ac_bbox:
            return {"error": "aircraft_traffic: keine BBox / Zone angegeben"}

        try:
            aircraft = fetch_aircraft_live(ac_bbox)
            if aircraft:
                types_cnt = {}
                ops_cnt = {}
                emergencies = [a for a in aircraft if a.get("emergency", "none") not in ("none", "", None)]
                on_ground = sum(1 for a in aircraft if a.get("on_ground"))
                for a in aircraft:
                    t = a.get("type") or "?"
                    types_cnt[t] = types_cnt.get(t, 0) + 1
                    op = a.get("operator") or a.get("country") or "?"
                    ops_cnt[op] = ops_cnt.get(op, 0) + 1
                type_str = ", ".join(f"{k}: {n}" for k, n in sorted(types_cnt.items(), key=lambda x: -x[1])[:5])
                op_str = ", ".join(f"{k}: {n}" for k, n in sorted(ops_cnt.items(), key=lambda x: -x[1])[:5])
                em_str = "; ".join(f"{a.get('callsign','?')} ({a.get('emergency')})" for a in emergencies[:3]) or "keine"
                report_parts = [
                    f"FLUGZEUGVERKEHR (bbox={ac_bbox}):",
                    f"  {len(aircraft)} Luftfahrzeuge in der Zone ({on_ground} am Boden)",
                    f"  Typen: {type_str}",
                    f"  Betreiber: {op_str}",
                    f"  Notfallsignale: {em_str}",
                ]
                return {
                    "status_msg": f"Flugzeugdaten werden abgerufen (bbox={ac_bbox}) …",
                    "report": "\n".join(report_parts),
                    "data_msg": f"ADS-B: {len(aircraft)} Luftfahrzeuge – {type_str} | Notfall: {em_str}",
                    "error": None,
                }
            else:
                return {
                    "status_msg": f"Flugzeugdaten werden abgerufen (bbox={ac_bbox}) …",
                    "report": f"FLUGZEUGVERKEHR (bbox={ac_bbox}): Keine Luftfahrzeuge in der Zone",
                    "data_msg": "ADS-B: Keine Luftfahrzeuge in der Zone gefunden",
                    "error": None,
                }
        except Exception as e:
            return {"error": f"ADS-B-Fehler: {str(e)[:120]}"}

    def live_handler(self, zone, config, geo, bbox, user_id):
        from plugins.watchzone.aircraft._transport import fetch_aircraft_live
        if not bbox:
            return {"error": "Zone hat keine gueltige Geometrie"}
        try:
            items = fetch_aircraft_live(bbox, user_id=user_id)
        except RuntimeError as e:
            return {"error": str(e)}
        result = {
            "zone_id": zone.id, "zone_name": zone.name,
            "zone_type": "aircraft", "count": len(items), "items": items,
        }
        if not items:
            result["warning"] = "api_empty"
        return result

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
