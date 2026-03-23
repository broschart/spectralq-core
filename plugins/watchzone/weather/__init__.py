"""Weather Watch Zone Plugin — DWD / NOAA / Open-Meteo."""

from flask import jsonify
from plugins import PluginManager
from plugins.watchzone import WatchZonePlugin
from plugins.watchzone._helpers import geojson_to_bbox

class WeatherPlugin(WatchZonePlugin):
    plugin_id = "weather"

    meta = {
        "label": "Wetter & Pegel",
        "icon_svg": (
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" '
            'stroke="currentColor" stroke-width="2">'
            '<path d="M8 15c-2.21 0-4-1.79-4-4s1.79-4 4-4c.34 0 .68.04 1 .12C9.6 5.28 11.14 4 13 4c2.49 0 4.5 2.01 4.5 4.5 0 .28-.03.55-.08.82C18.93 9.79 20 11.27 20 13c0 2.21-1.79 4-4 4H8z"/>'
            '<path d="M8 19v2M12 19v2M16 19v2"/>'
            '</svg>'
        ),
        "color": "#3b82f6",
        "description": "Wetter- und Pegelstandsdaten via DWD / NOAA",
        "category": "geo",
        "required_credentials": [],
        "has_live": True,
        "has_history": True,
        "panel_template": "weather/_panel.html",
        "js_file": "/plugins/watchzone/weather/static/weather.js",
        "apa_action": "weather_history",

    }

    def apa_action_handler(self, action):
        """Returns dict with: status_msg, report, data_msg, error"""
        from datetime import datetime, timedelta

        wx_label = action.get("label", "Region")
        wx_days = min(action.get("days", 180), 730)
        wx_bbox = action.get("bbox", [])
        wx_type = action.get("data_type", "niederschlag")

        if len(wx_bbox) != 4:
            return {"error": "Wetter: bbox muss 4 Werte haben [lon_min, lat_min, lon_max, lat_max]"}

        try:
            from plugins.watchzone.weather._transport import fetch_dwd_weather_history

            center_lat = (wx_bbox[1] + wx_bbox[3]) / 2
            center_lon = (wx_bbox[0] + wx_bbox[2]) / 2
            date_to = datetime.utcnow().strftime("%Y-%m-%d")
            date_from = (datetime.utcnow() - timedelta(days=wx_days)).strftime("%Y-%m-%d")
            wx_data = fetch_dwd_weather_history(center_lat, center_lon, date_from, date_to, wx_type)

            if wx_data and wx_data.get("data"):
                entries = wx_data["data"]
                values = [e["value"] for e in entries if e.get("value") is not None]
                if values:
                    avg_val = sum(values) / len(values)
                    max_val = max(values)
                    max_date = next(e["date"] for e in entries if e.get("value") == max_val)
                    type_label = {"niederschlag": "Niederschlag (mm)", "pegel": "Pegelstand",
                                  "warnung": "Wetterwarnungen", "sturm": "Windböen (km/h)"}.get(wx_type, wx_type)
                    report_parts = [
                        f"WETTERDATEN (DWD/NOAA) – {wx_label}, {type_label}:",
                        f"  Zeitraum: {date_from} bis {date_to}, {len(entries)} Tage",
                        f"  Ø {avg_val:.1f}, Max: {max_val:.1f} am {max_date}",
                        f"  Summe: {sum(values):.1f}" if wx_type in ("niederschlag", "pegel") else "",
                    ]
                    return {
                        "status_msg": f"Wetterdaten (DWD/NOAA): {wx_label} – {wx_type} ({wx_days}d) …",
                        "report": "\n".join(p for p in report_parts if p),
                        "data_msg": f"Wetter {wx_label} ({type_label}): Ø {avg_val:.1f}, Max {max_val:.1f} am {max_date}",
                        "error": None,
                    }
                else:
                    return {
                        "status_msg": f"Wetterdaten (DWD/NOAA): {wx_label} – {wx_type} ({wx_days}d) …",
                        "report": "",
                        "data_msg": f"Wetter {wx_label}: Keine Messwerte",
                        "error": None,
                    }
            else:
                return {
                    "status_msg": f"Wetterdaten (DWD/NOAA): {wx_label} – {wx_type} ({wx_days}d) …",
                    "report": f"WETTERDATEN – {wx_label}: Keine Daten im Zeitraum {date_from} bis {date_to}",
                    "data_msg": f"Wetter {wx_label}: Keine Daten im Zeitraum",
                    "error": None,
                }
        except Exception as e:
            return {"error": f"Wetter-Fehler: {str(e)[:80]}"}

    def live_handler(self, zone, config, geo, bbox, user_id):
        from datetime import datetime as _dt, timedelta as _td
        from plugins.watchzone.weather._transport import fetch_dwd_weather, fetch_dwd_alerts
        if not bbox:
            return {"error": "Zone hat keine gueltige Geometrie"}
        center_lat = (bbox[1] + bbox[3]) / 2
        center_lon = (bbox[0] + bbox[2]) / 2

        time_focus = config.get("time_focus")

        # If time_focus is set, load historical weather instead of live
        if time_focus and time_focus.get("from"):
            try:
                from plugins.watchzone.weather._transport import fetch_dwd_weather_history
                focus_date = _dt.strptime(time_focus["from"][:10], "%Y-%m-%d")
                date_from = (focus_date - _td(days=7)).strftime("%Y-%m-%d")
                date_to = (focus_date + _td(days=7)).strftime("%Y-%m-%d")
                # Fetch multiple data types for the event period
                hist_temp = fetch_dwd_weather_history(center_lat, center_lon, date_from, date_to, "temperatur")
                hist_rain = fetch_dwd_weather_history(center_lat, center_lon, date_from, date_to, "niederschlag")
                hist_wind = fetch_dwd_weather_history(center_lat, center_lon, date_from, date_to, "sturm")
                return {
                    "zone_id": zone.id, "zone_name": zone.name,
                    "zone_type": "weather",
                    "time_focus": time_focus,
                    "historical": True,
                    "date_from": date_from, "date_to": date_to,
                    "history_temp": hist_temp,
                    "history_rain": hist_rain,
                    "history_wind": hist_wind,
                    "weather": None, "alerts": [],
                }
            except Exception as e:
                import logging
                logging.getLogger(__name__).warning("Weather TF error: %s", e)

        weather = fetch_dwd_weather(center_lat, center_lon)
        try:
            alerts = fetch_dwd_alerts(center_lat, center_lon)
        except Exception:
            alerts = []
        return {
            "zone_id": zone.id, "zone_name": zone.name,
            "zone_type": "weather", "weather": weather, "alerts": alerts,
        }

    def history_routes(self):
        return [{"suffix": "weather-history", "handler": self._history_handler}]

    def _history_handler(self, zone, args, user_id):
        import json as _j, logging
        log = logging.getLogger(__name__)
        geo = _j.loads(zone.geometry) if zone.geometry else {}
        bbox = geojson_to_bbox(geo)
        if not bbox:
            return jsonify({"error": "Zone hat keine gueltige Geometrie"}), 400
        date_from = args.get("from", "")
        date_to = args.get("to", "")
        data_type = args.get("type", "pegel")
        if not date_from or not date_to:
            return jsonify({"error": "Parameter 'from' und 'to' erforderlich"}), 400
        center_lat = (bbox[1] + bbox[3]) / 2
        center_lon = (bbox[0] + bbox[2]) / 2
        try:
            from plugins.watchzone.weather._transport import fetch_dwd_weather_history
            data = fetch_dwd_weather_history(center_lat, center_lon, date_from, date_to, data_type)
            return jsonify({"zone_id": zone.id, "zone_name": zone.name, "data_type": data_type, "data": data})
        except Exception as e:
            log.warning("Weather-History Fehler (Zone %d): %s", zone.id, e)
            return jsonify({"error": str(e)}), 502

    def ai_tools(self):
        return [{
            "name": "weather_history",
            "description": "Ruft historische Wetterdaten (DWD/Open-Meteo) fuer eine Region oder Watch Zone ab.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "zone_id": {"type": "integer", "description": "ID einer Geo-Watch-Zone (alternativ zu lat/lon)"},
                    "lat": {"type": "number", "description": "Breitengrad (alternativ zu zone_id)"},
                    "lon": {"type": "number", "description": "Laengengrad (alternativ zu zone_id)"},
                    "date_from": {"type": "string", "description": "Startdatum YYYY-MM-DD"},
                    "date_to": {"type": "string", "description": "Enddatum YYYY-MM-DD"},
                    "data_type": {"type": "string", "description": "temperatur | niederschlag | warnung | sturm"},
                },
                "required": ["date_from", "date_to"],
            },
        }]

    def ai_tool_handler(self, tool_name, inputs, user_id):
        if tool_name != "weather_history":
            return {"error": f"Unbekanntes Tool: {tool_name}"}
        lat = inputs.get("lat")
        lon = inputs.get("lon")
        if lat is None or lon is None:
            zone_id_val = inputs.get("zone_id")
            if zone_id_val:
                import json as _j
                from models import WatchZone
                z = WatchZone.query.filter_by(id=zone_id_val, user_id=user_id).first()
                if z:
                    geo = _j.loads(z.geometry) if z.geometry else {}
                    bbox = geojson_to_bbox(geo)
                    if bbox:
                        lat = (bbox[1] + bbox[3]) / 2
                        lon = (bbox[0] + bbox[2]) / 2
        if lat is None or lon is None:
            return {"error": "Keine gueltige Position (zone_id oder lat/lon erforderlich)"}
        try:
            from plugins.watchzone.weather._transport import fetch_dwd_weather_history
            data_type = inputs.get("data_type", "temperatur")
            data = fetch_dwd_weather_history(float(lat), float(lon), inputs["date_from"], inputs["date_to"], data_type=data_type)
            return {"lat": lat, "lon": lon, "data_type": data_type,
                    "date_from": inputs["date_from"], "date_to": inputs["date_to"],
                    "count": len(data), "data": data}
        except Exception as e:
            return {"error": str(e)}

    def analysis_provider(self):
        return {
            "data_types": ["weather"],
            "history_endpoint_suffix": "weather-history",
            "analysis_js": "/plugins/watchzone/weather/static/weather_analysis.js",
            "ui_prefix": "wx",
            "ui_label": "Wetter",
            "ui_color": "#3b82f6",
            "zone_types": ["weather"],
            "accepts_global": True,
        }

PluginManager.register(WeatherPlugin())
