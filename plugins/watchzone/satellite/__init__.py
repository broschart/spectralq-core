"""Satellite Watch Zone Plugin — Copernicus Sentinel-2 True-Color."""

from flask import jsonify
from plugins import PluginManager
from plugins.watchzone import WatchZonePlugin
from plugins.watchzone._helpers import geojson_to_bbox

class SatellitePlugin(WatchZonePlugin):
    plugin_id = "satellite"

    meta = {
        "label": "Satellit",
        "icon_svg": (
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" '
            'stroke="currentColor" stroke-width="2">'
            '<circle cx="12" cy="12" r="2"/>'
            '<path d="M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>'
            '<path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>'
            '</svg>'
        ),
        "color": "#8b5cf6",
        "description": "Sentinel-2 Echtfarb-Satellitenbilder (Copernicus)",
        "category": "geo",
        "required_credentials": ["copernicus_email", "copernicus_password"],
        "has_live": True,
        "has_history": True,
        "panel_template": "satellite/_panel.html",
        "js_file": "/plugins/watchzone/satellite/static/satellite.js",
        "overlay_template": "satellite/_overlay.html",
    }

    def api_routes(self):
        from plugins.watchzone.satellite._routes import api_sentinel_image
        return [{"rule": "/api/sentinel/image", "handler": api_sentinel_image}]

    def live_handler(self, zone, config, geo, bbox, user_id):
        from datetime import datetime as _dt, timedelta as _td
        from plugins.watchzone.satellite._transport import fetch_sentinel_image
        import base64
        if not bbox:
            return {"error": "Zone hat keine gueltige Geometrie"}
        date_to = _dt.utcnow().strftime("%Y-%m-%d")
        date_from = (_dt.utcnow() - _td(days=30)).strftime("%Y-%m-%d")
        img_bytes, used_bbox, cropped = fetch_sentinel_image(bbox, date_from, date_to, 1024, 1024, user_id=user_id)
        img_b64 = base64.b64encode(img_bytes).decode("ascii")
        return {
            "zone_id": zone.id, "zone_name": zone.name, "zone_type": "satellite",
            "image_b64": img_b64, "bbox": used_bbox,
            "date_from": date_from, "date_to": date_to, "cropped": cropped,
        }

    def history_routes(self):
        return [{"suffix": "satellite-dates", "handler": self._dates_handler}]

    def _dates_handler(self, zone, args, user_id):
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
            from plugins.watchzone.ndvi._transport import fetch_sentinel_ndvi_stats
            stats = fetch_sentinel_ndvi_stats(bbox, date_from, date_to, interval="P1D", user_id=user_id)
            dates = [s["date"] for s in stats if s.get("mean_ndvi") is not None]
            return jsonify({"zone_id": zone.id, "zone_name": zone.name, "dates": dates})
        except Exception as e:
            log.warning("Satellite-Dates Fehler (Zone %d): %s", zone.id, e)
            return jsonify({"error": str(e)}), 502

    def analysis_provider(self):
        return {"data_types": ["satellite"], "history_endpoint_suffix": "satellite-dates"}

PluginManager.register(SatellitePlugin())
