"""NDVI Watch Zone Plugin — Copernicus Sentinel-2 Vegetation Index."""

import logging
from flask import jsonify

log = logging.getLogger(__name__)
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
        "credential_group": "copernicus",
        "has_live": True,
        "has_history": True,
        "panel_template": "ndvi/_panel.html",
        "js_file": "/plugins/watchzone/ndvi/static/ndvi.js",
        "apa_action": "ndvi_analysis",

    }

    def apa_action_handler(self, action):
        """Returns dict with: status_msg, report, data_msg, error"""
        from datetime import datetime, timedelta
        from plugins.watchzone.ndvi._transport import fetch_sentinel_ndvi_stats
        from transport import CopernicusAuthError

        bbox = action.get("bbox", [])
        days = min(int(action.get("days", 365)), 730)
        label = action.get("label", "Region")

        if not bbox or len(bbox) != 4:
            return {"error": "bbox muss [lon_min, lat_min, lon_max, lat_max] sein"}

        try:
            bbox = [float(b) for b in bbox]
        except (ValueError, TypeError):
            return {"error": "bbox-Koordinaten müssen Zahlen sein"}

        end_dt = datetime.now()
        start_dt = end_dt - timedelta(days=days)
        date_from = start_dt.strftime("%Y-%m-%d")
        date_to = end_dt.strftime("%Y-%m-%d")

        try:
            stats = fetch_sentinel_ndvi_stats(bbox, date_from, date_to)
        except CopernicusAuthError as e:
            return {"error": f"Copernicus-Auth-Fehler: {str(e)[:80]}"}
        except Exception as e:
            return {"error": f"Sentinel-API-Fehler: {str(e)[:80]}"}

        if not stats:
            return {"error": "Keine NDVI-Daten für diesen Bereich/Zeitraum"}

        values = [s["mean_ndvi"] for s in stats if s.get("mean_ndvi") is not None]
        dates = [s["date"] for s in stats if s.get("mean_ndvi") is not None]

        if not values:
            return {"error": "Keine gültigen NDVI-Messwerte"}

        avg_ndvi = sum(values) / len(values)
        max_ndvi = max(values)
        min_ndvi = min(values)
        max_idx = values.index(max_ndvi)
        min_idx = values.index(min_ndvi)

        # Trend
        direction = "stabil"
        if len(values) >= 6:
            q = len(values) // 4 or 1
            avg_start = sum(values[:q]) / q
            avg_end = sum(values[-q:]) / q
            if avg_end > avg_start + 0.05:
                direction = "steigend (Begrünung)"
            elif avg_end < avg_start - 0.05:
                direction = "fallend (Vegetation nimmt ab)"

        # Anomalien: plötzliche Einbrüche/Anstiege
        anomalies = []
        WINDOW = 6
        THRESHOLD = 0.12
        for i in range(WINDOW, len(values)):
            rolling_avg = sum(values[i-WINDOW:i]) / WINDOW
            delta = values[i] - rolling_avg
            if abs(delta) > THRESHOLD:
                anomalies.append({
                    "date": dates[i] if i < len(dates) else "",
                    "ndvi": round(values[i], 3),
                    "delta": round(delta, 3),
                    "type": "Einbruch" if delta < 0 else "Anstieg",
                })
        anomalies.sort(key=lambda x: abs(x["delta"]), reverse=True)
        anomalies = anomalies[:5]

        nr = {
            "label": label,
            "bbox": bbox,
            "datapoints": len(values),
            "period": f"{date_from} bis {date_to}",
            "avg_ndvi": round(avg_ndvi, 3),
            "max_ndvi": round(max_ndvi, 3),
            "max_date": dates[max_idx] if max_idx < len(dates) else "",
            "min_ndvi": round(min_ndvi, 3),
            "min_date": dates[min_idx] if min_idx < len(dates) else "",
            "direction": direction,
            "anomalies": anomalies,
            "first_avg": round(sum(values[:3]) / min(3, len(values)), 3) if values else 0,
            "last_avg": round(sum(values[-3:]) / min(3, len(values)), 3) if values else 0,
        }

        # Build report (matches apa_stream.py lines 3224-3249)
        report_parts = ["NDVI-VEGETATIONSANALYSE (Sentinel-2):"]
        anomaly_info = ""
        if nr.get("anomalies"):
            anom_parts = [f"{a['date']}: {a['type']} ({a['delta']:+.3f})" for a in nr["anomalies"][:3]]
            anomaly_info = f", Anomalien: {', '.join(anom_parts)}"
        report_parts.append(
            f"  {nr['label']} (bbox: {nr['bbox']}): "
            f"{nr['datapoints']} Messungen, Zeitraum {nr['period']}, "
            f"Ø NDVI {nr['avg_ndvi']}, "
            f"Max {nr['max_ndvi']} am {nr['max_date']}, "
            f"Min {nr['min_ndvi']} am {nr['min_date']}, "
            f"Trend: {nr['direction']}, "
            f"Anfang Ø {nr['first_avg']}, Ende Ø {nr['last_avg']}"
            f"{anomaly_info}"
        )

        data_msg = (
            f"  {nr['label']}: Ø NDVI {nr['avg_ndvi']}, "
            f"Trend: {nr['direction']}"
            f"{', ' + str(len(nr['anomalies'])) + ' Anomalien' if nr.get('anomalies') else ''}"
        )

        return {
            "status_msg": f"NDVI-Vegetationsanalyse: {label} ({days}d) …",
            "report": "\n".join(report_parts),
            "data_msg": data_msg,
            "error": None,
        }

    def api_routes(self):
        from plugins.watchzone.ndvi._routes import api_sentinel_ndvi
        return [{"rule": "/api/sentinel/ndvi", "handler": api_sentinel_ndvi}]

    def live_handler(self, zone, config, geo, bbox, user_id):
        import base64
        from datetime import datetime as _dt, timedelta as _td
        from plugins.watchzone.ndvi._transport import (
            fetch_sentinel_ndvi_stats, fetch_sentinel_ndvi_image,
            fetch_sentinel_ndvi_change)
        if not bbox:
            return {"error": "Zone hat keine gueltige Geometrie"}

        # Check for time_focus — center data around event date
        time_focus = config.get("time_focus")
        if time_focus and time_focus.get("from"):
            try:
                focus_date = _dt.strptime(time_focus["from"][:10], "%Y-%m-%d")
                date_from = (focus_date - _td(days=45)).strftime("%Y-%m-%d")
                date_to = (focus_date + _td(days=45)).strftime("%Y-%m-%d")
            except ValueError:
                date_to = _dt.utcnow().strftime("%Y-%m-%d")
                date_from = (_dt.utcnow() - _td(days=90)).strftime("%Y-%m-%d")
        else:
            date_to = _dt.utcnow().strftime("%Y-%m-%d")
            date_from = (_dt.utcnow() - _td(days=90)).strftime("%Y-%m-%d")

        # Statistiken
        stats = fetch_sentinel_ndvi_stats(
            bbox, date_from, date_to, interval="P7D", user_id=user_id)
        valid = [s for s in stats if s.get("mean_ndvi") is not None]

        result = {
            "zone_id": zone.id, "zone_name": zone.name, "zone_type": "ndvi",
            "count": len(valid), "items": valid, "bbox": bbox,
        }
        if time_focus:
            result["time_focus"] = time_focus

        # NDVI-Bild (um Focus-Datum oder letzte 14 Tage)
        try:
            if time_focus and time_focus.get("from"):
                focus_date = _dt.strptime(time_focus["from"][:10], "%Y-%m-%d")
                img_from = (focus_date - _td(days=7)).strftime("%Y-%m-%d")
                img_to = (focus_date + _td(days=7)).strftime("%Y-%m-%d")
            else:
                img_to = _dt.utcnow().strftime("%Y-%m-%d")
                img_from = (_dt.utcnow() - _td(days=14)).strftime("%Y-%m-%d")
            png, img_bbox, cropped = fetch_sentinel_ndvi_image(
                bbox, img_from, img_to, width=512, height=512,
                user_id=user_id)
            if png:
                result["ndvi_image_b64"] = base64.b64encode(png).decode()
                result["ndvi_image_bbox"] = img_bbox
        except Exception as e:
            log.warning("NDVI-Bild Fehler: %s", e)

        # Change-Detection (um Focus oder letzte 30 Tage)
        try:
            if time_focus and time_focus.get("from"):
                focus_date = _dt.strptime(time_focus["from"][:10], "%Y-%m-%d")
                days_since = (_dt.utcnow() - focus_date).days
                change_png, ch_bbox, ch_cropped, hotspots = \
                    fetch_sentinel_ndvi_change(bbox, user_id=user_id,
                                               days_back=max(30, days_since + 14))
            else:
                change_png, ch_bbox, ch_cropped, hotspots = \
                    fetch_sentinel_ndvi_change(bbox, user_id=user_id,
                                               days_back=30)
            if change_png:
                result["change_image_b64"] = base64.b64encode(
                    change_png).decode()
                result["change_bbox"] = ch_bbox
            result["hotspots"] = hotspots
        except Exception as e:
            log.warning("NDVI Change-Detection Fehler: %s", e)

        return result

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
        return {
            "data_types": ["ndvi"],
            "history_endpoint_suffix": "ndvi-history",
            "analysis_js": "/plugins/watchzone/ndvi/static/ndvi_analysis.js",
            "ui_prefix": "ndvi",
            "ui_label": "Sentinel-2 NDVI",
            "ui_color": "#16a34a",
            "zone_types": ["ndvi"],
            "accepts_global": True,
        }

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
