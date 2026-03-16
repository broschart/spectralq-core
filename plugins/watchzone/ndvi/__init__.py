"""NDVI Watch Zone Plugin — Copernicus Sentinel-2 Vegetation Index."""

from flask import jsonify
from plugins import PluginManager
from plugins.watchzone import WatchZonePlugin
from plugins.watchzone._helpers import geojson_to_bbox

class NdviPlugin(WatchZonePlugin):
    plugin_id = "ndvi"

    meta = {
        "label": "NDVI / Vegetation",
        "icon_svg": (
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" '
            'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
            '<path d="M7 20h10"/>'
            '<path d="M10 20c5.5-2.5.8-6.4 3-10"/>'
            '<path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.5-3-2.8C6.1 8 9 7.4 11 9"/>'
            '<path d="M14.1 6a7 7 0 0 0-1.5 4.7c1.7-.3 3.2-.2 4.3.5 1 .6 1.7 1.4 2.1 2.3-2 1.5-4.7.8-6-.8"/>'
            '</svg>'
        ),
        "color": "#16a34a",
        "description": "NDVI-Vegetationsindex via Copernicus Sentinel-2",
        "category": "geo",
        "required_credentials": ["copernicus_email", "copernicus_password"],
        "has_live": True,
        "has_history": True,
        "panel_template": "ndvi/_panel.html",
        "js_file": "/plugins/watchzone/ndvi/static/ndvi.js",

    }

    def api_routes(self):
        from plugins.watchzone.ndvi._routes import api_sentinel_ndvi
        return [{"rule": "/api/sentinel/ndvi", "handler": api_sentinel_ndvi}]

    def live_handler(self, zone, config, geo, bbox, user_id):
        from datetime import datetime as _dt, timedelta as _td
        from plugins.watchzone.ndvi._transport import fetch_sentinel_ndvi_stats
        if not bbox:
            return {"error": "Zone hat keine gueltige Geometrie"}
        date_to = _dt.utcnow().strftime("%Y-%m-%d")
        date_from = (_dt.utcnow() - _td(days=90)).strftime("%Y-%m-%d")
        stats = fetch_sentinel_ndvi_stats(bbox, date_from, date_to, interval="P7D", user_id=user_id)
        valid = [s for s in stats if s.get("mean_ndvi") is not None]
        return {
            "zone_id": zone.id, "zone_name": zone.name, "zone_type": "ndvi",
            "count": len(valid), "items": valid, "bbox": bbox,
        }

    def history_routes(self):
        return [{"suffix": "ndvi-history", "handler": self._history_handler}]

    def _history_handler(self, zone, args, user_id):
        import json as _j, logging
        log = logging.getLogger(__name__)
        geo = _j.loads(zone.geometry) if zone.geometry else {}
        bbox = geojson_to_bbox(geo)
        if not bbox:
            return jsonify({"error": "Zone hat keine gueltige Geometrie"}), 400
        date_from = args.get("from", "")
        date_to = args.get("to", "")
        interval = args.get("interval", "P7D")
        if not date_from or not date_to:
            return jsonify({"error": "Parameter 'from' und 'to' erforderlich"}), 400
        try:
            from plugins.watchzone.ndvi._transport import fetch_sentinel_ndvi_stats
            stats = fetch_sentinel_ndvi_stats(bbox, date_from, date_to, interval=interval, user_id=user_id)
            return jsonify({"zone_id": zone.id, "zone_name": zone.name, "data": stats})
        except Exception as e:
            log.warning("NDVI-History Fehler (Zone %d): %s", zone.id, e)
            return jsonify({"error": str(e)}), 502

    def ai_tools(self):
        return [{
            "name": "ndvi_analysis",
            "description": "Ruft NDVI-Vegetationsindex (Sentinel-2/Copernicus) fuer eine Region oder Watch Zone ab.",
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
        if tool_name != "ndvi_analysis":
            return {"error": f"Unbekanntes Tool: {tool_name}"}
        bbox = self._resolve_bbox(inputs.get("zone_id"), inputs.get("bbox"), user_id)
        if not bbox:
            return {"error": "Keine gueltige Region (zone_id oder bbox erforderlich)"}
        try:
            from plugins.watchzone.ndvi._transport import fetch_sentinel_ndvi_stats
            data = fetch_sentinel_ndvi_stats(bbox, inputs["date_from"], inputs["date_to"], interval="P7D", user_id=user_id)
            return {"bbox": bbox, "date_from": inputs["date_from"], "date_to": inputs["date_to"], "data": data}
        except Exception as e:
            return {"error": str(e)}

    def analysis_provider(self):
        return {"data_types": ["ndvi"], "history_endpoint_suffix": "ndvi-history"}

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

PluginManager.register(NdviPlugin())
