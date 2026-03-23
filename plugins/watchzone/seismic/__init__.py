"""
Seismic Watch Zone Plugin — USGS Earthquake Catalog.
"""

from flask import jsonify
from plugins import PluginManager
from plugins.watchzone import WatchZonePlugin
from plugins.watchzone._helpers import parse_zone_data, geojson_to_bbox

class SeismicPlugin(WatchZonePlugin):
    plugin_id = "seismic"

    meta = {
        "label": "Seismik",
        "icon_svg": (
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" '
            'stroke="currentColor" stroke-width="2" stroke-linecap="round" '
            'stroke-linejoin="round">'
            '<polyline points="2 12 5 12 7 4 10 20 13 8 16 16 18 12 22 12"/>'
            '</svg>'
        ),
        "color": "#ef4444",
        "description": "Erdbebenueberwachung via USGS Earthquake Catalog",
        "category": "geo",
        "required_credentials": [],
        "has_live": True,
        "has_history": True,
        "panel_template": "seismic/_panel.html",
        "js_file": "/plugins/watchzone/seismic/static/seismic.js",
        "apa_action": "seismic_history",

    }

    # ------------------------------------------------------------------
    # APA Action Handler
    # ------------------------------------------------------------------

    def apa_action_handler(self, action):
        """Returns dict with: status_msg, report, data_msg, error"""
        from datetime import datetime, timedelta

        seis_label = action.get("label", "Region")
        seis_days = min(action.get("days", 180), 730)
        seis_bbox = action.get("bbox", [])

        if len(seis_bbox) != 4:
            return {"error": "Seismik: bbox muss 4 Werte haben [lon_min, lat_min, lon_max, lat_max]"}

        try:
            from plugins.watchzone.seismic._transport import fetch_usgs_earthquake_history as fetch_seismic_history

            date_to = datetime.utcnow().strftime("%Y-%m-%d")
            date_from = (datetime.utcnow() - timedelta(days=seis_days)).strftime("%Y-%m-%d")
            seis_data = fetch_seismic_history(seis_bbox, date_from, date_to)

            if seis_data and seis_data.get("data"):
                entries = seis_data["data"]
                total_quakes = sum(e.get("count", 1) for e in entries)
                max_mag = max(e["value"] for e in entries) if entries else 0
                max_date = next((e["date"] for e in entries if e["value"] == max_mag), "?")
                report_parts = [
                    f"SEISMIK (USGS) – {seis_label} (bbox: {seis_bbox}):",
                    f"  Zeitraum: {date_from} bis {date_to}",
                    f"  {total_quakes} Erdbeben in {len(entries)} Tagen mit Aktivität",
                    f"  Max. Magnitude: {max_mag} am {max_date}",
                ]
                # Top 5 stärkste Beben
                top5 = sorted(entries, key=lambda e: e["value"], reverse=True)[:5]
                for t in top5:
                    report_parts.append(f"  {t['date']}: Mag. {t['value']} ({t.get('count', 1)} Beben)")
                return {
                    "status_msg": f"Seismik (USGS): {seis_label} ({seis_days}d) …",
                    "report": "\n".join(report_parts),
                    "data_msg": f"Seismik {seis_label}: {total_quakes} Beben, max Mag. {max_mag} am {max_date}",
                    "error": None,
                }
            else:
                return {
                    "status_msg": f"Seismik (USGS): {seis_label} ({seis_days}d) …",
                    "report": f"SEISMIK (USGS) – {seis_label}: Keine Erdbeben im Zeitraum {date_from} bis {date_to}",
                    "data_msg": f"Seismik {seis_label}: Keine Erdbeben im Zeitraum",
                    "error": None,
                }
        except Exception as e:
            return {"error": f"Seismik-Fehler: {str(e)[:80]}"}

    # ------------------------------------------------------------------
    # Live Handler
    # ------------------------------------------------------------------

    def live_handler(self, zone, config, geo, bbox, user_id):
        from datetime import datetime as _dt, timedelta as _td
        from plugins.watchzone.seismic._transport import fetch_usgs_earthquakes

        if not bbox:
            return {"error": "Zone hat keine gueltige Geometrie"}

        date_to = _dt.utcnow().strftime("%Y-%m-%d")
        date_from = (_dt.utcnow() - _td(days=30)).strftime("%Y-%m-%d")
        quakes = fetch_usgs_earthquakes(bbox, date_from, date_to, min_magnitude=1.0)
        return {
            "zone_id": zone.id,
            "zone_name": zone.name,
            "zone_type": "seismic",
            "count": len(quakes),
            "items": quakes[:50],
        }

    # ------------------------------------------------------------------
    # History Route
    # ------------------------------------------------------------------

    def history_routes(self):
        return [{"suffix": "seismic-history", "handler": self._history_handler}]

    def _history_handler(self, zone, args, user_id):
        import json as _j
        from plugins.watchzone.seismic._transport import fetch_usgs_earthquake_history

        geo = _j.loads(zone.geometry) if zone.geometry else {}
        bbox = geojson_to_bbox(geo)
        if not bbox:
            return jsonify({"error": "Zone hat keine gueltige Geometrie"}), 400

        date_from = args.get("from", "")
        date_to = args.get("to", "")
        if not date_from or not date_to:
            return jsonify({"error": "Parameter 'from' und 'to' erforderlich"}), 400

        import logging
        log = logging.getLogger(__name__)
        try:
            data = fetch_usgs_earthquake_history(bbox, date_from, date_to)
            return jsonify({
                "zone_id": zone.id,
                "zone_name": zone.name,
                "data": data,
            })
        except Exception as e:
            log.warning("Seismic-History Fehler (Zone %d): %s", zone.id, e)
            return jsonify({"error": str(e)}), 502

    # ------------------------------------------------------------------
    # AI Tools
    # ------------------------------------------------------------------

    def ai_tools(self):
        return [
            {
                "name": "seismic_history",
                "description": "Ruft historische Erdbebendaten (USGS) fuer eine Region oder Watch Zone ab.",
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
        if tool_name != "seismic_history":
            return {"error": f"Unbekanntes Tool: {tool_name}"}

        bbox = self._resolve_bbox(inputs.get("zone_id"), inputs.get("bbox"), user_id)
        if not bbox:
            return {"error": "Keine gueltige Region (zone_id oder bbox erforderlich)"}
        try:
            from plugins.watchzone.seismic._transport import fetch_usgs_earthquake_history
            data = fetch_usgs_earthquake_history(bbox, inputs["date_from"], inputs["date_to"])
            return {
                "bbox": bbox,
                "date_from": inputs["date_from"],
                "date_to": inputs["date_to"],
                "count": len(data),
                "data": data,
            }
        except Exception as e:
            return {"error": str(e)}

    # ------------------------------------------------------------------
    # Analysis Provider
    # ------------------------------------------------------------------

    def analysis_provider(self):
        return {
            "data_types": ["seismic"],
            "history_endpoint_suffix": "seismic-history",
            "analysis_js": "/plugins/watchzone/seismic/static/seismic_analysis.js",
            "ui_prefix": "seis",
            "ui_label": "Seismik (USGS)",
            "ui_color": "#ef4444",
            "zone_types": ["seismic"],
            "accepts_global": True,
        }

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _resolve_bbox(zone_id, bbox_input, user_id):
        """Loest bbox auf — entweder aus zone_id oder direkt."""
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

PluginManager.register(SeismicPlugin())
