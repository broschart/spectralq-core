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
        "credential_group": "copernicus",
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
        import base64, logging
        log = logging.getLogger(__name__)
        if not bbox:
            return {"error": "Zone hat keine gueltige Geometrie"}

        time_focus = config.get("time_focus")

        if time_focus and time_focus.get("from"):
            try:
                focus_date = _dt.strptime(time_focus["from"][:10], "%Y-%m-%d")
                date_from = (focus_date - _td(days=5)).strftime("%Y-%m-%d")
                date_to = (focus_date + _td(days=5)).strftime("%Y-%m-%d")
            except ValueError:
                date_to = _dt.utcnow().strftime("%Y-%m-%d")
                date_from = (_dt.utcnow() - _td(days=30)).strftime("%Y-%m-%d")
        else:
            date_to = _dt.utcnow().strftime("%Y-%m-%d")
            date_from = (_dt.utcnow() - _td(days=30)).strftime("%Y-%m-%d")

        img_bytes, used_bbox, cropped = fetch_sentinel_image(bbox, date_from, date_to, 1024, 1024, user_id=user_id)
        img_b64 = base64.b64encode(img_bytes).decode("ascii")

        result = {
            "zone_id": zone.id, "zone_name": zone.name, "zone_type": "satellite",
            "image_b64": img_b64, "bbox": used_bbox,
            "date_from": date_from, "date_to": date_to, "cropped": cropped,
        }

        # Time Focus: fetch 3 images (before, focus, after)
        if time_focus and time_focus.get("from"):
            try:
                focus_date = _dt.strptime(time_focus["from"][:10], "%Y-%m-%d")
                tf_dates = [
                    ("before", focus_date - _td(days=1)),
                    ("focus",  focus_date),
                    ("after",  focus_date + _td(days=1)),
                ]
                tf_images = []
                for label, d in tf_dates:
                    d_from = (d - _td(days=3)).strftime("%Y-%m-%d")
                    d_to = (d + _td(days=3)).strftime("%Y-%m-%d")
                    try:
                        ib, ub, cr = fetch_sentinel_image(bbox, d_from, d_to, 512, 512, user_id=user_id)
                        tf_images.append({
                            "label": label, "date": d.strftime("%Y-%m-%d"),
                            "image_b64": base64.b64encode(ib).decode("ascii"),
                            "bbox": ub,
                        })
                    except Exception as e:
                        log.warning("Satellite TF image error (%s): %s", label, e)
                        tf_images.append({
                            "label": label, "date": d.strftime("%Y-%m-%d"),
                            "image_b64": None, "bbox": None,
                        })
                result["time_focus"] = time_focus
                result["time_focus_images"] = tf_images
            except Exception:
                pass

        return result

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
            return jsonify({"zone_id": zone.id, "zone_name": zone.name, "dates": dates,
                            "bbox": ",".join(str(v) for v in bbox)})
        except Exception as e:
            log.warning("Satellite-Dates Fehler (Zone %d): %s", zone.id, e)
            return jsonify({"error": str(e)}), 502

    def ai_tools(self):
        return [
            {
                "name": "sentinel2_availability",
                "description": (
                    "Prüft Sentinel-2 Satellitenbildverfügbarkeit für eine Region und Zeitraum. "
                    "Liefert Aufnahmedaten und NDVI-Statistiken (Vegetationsindex). "
                    "Nützlich um zu prüfen ob wolkenfreie Bilder vorhanden sind "
                    "und wie sich die Vegetation in einem Gebiet entwickelt."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "bbox": {
                            "type": "array",
                            "items": {"type": "number"},
                            "description": "Bounding-Box [lon_min, lat_min, lon_max, lat_max]",
                        },
                        "date_from": {
                            "type": "string",
                            "description": "Startdatum (YYYY-MM-DD)",
                        },
                        "date_to": {
                            "type": "string",
                            "description": "Enddatum (YYYY-MM-DD)",
                        },
                    },
                    "required": ["bbox", "date_from", "date_to"],
                },
            },
            {
                "name": "sentinel2_image_analysis",
                "description": (
                    "Ruft ein Sentinel-2 Satellitenbild ab und analysiert es via multimodalem LLM. "
                    "Erkennt Landnutzung, Infrastruktur, Veränderungen, Umweltschäden etc. "
                    "Optional: Zwei Zeitpunkte für Veränderungsanalyse (Change Detection)."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "bbox": {
                            "type": "array",
                            "items": {"type": "number"},
                            "description": "Bounding-Box [lon_min, lat_min, lon_max, lat_max]",
                        },
                        "date_from": {
                            "type": "string",
                            "description": "Startdatum für Bildsuche (YYYY-MM-DD)",
                        },
                        "date_to": {
                            "type": "string",
                            "description": "Enddatum für Bildsuche (YYYY-MM-DD)",
                        },
                        "compare_from": {
                            "type": "string",
                            "description": "Optional: Startdatum für Vergleichsbild (YYYY-MM-DD). Wenn gesetzt, wird eine Veränderungsanalyse durchgeführt.",
                        },
                        "compare_to": {
                            "type": "string",
                            "description": "Optional: Enddatum für Vergleichsbild (YYYY-MM-DD)",
                        },
                        "question": {
                            "type": "string",
                            "description": "Spezifische Analysefrage (z.B. 'Gibt es Anzeichen für Abholzung?')",
                        },
                    },
                    "required": ["bbox", "date_from", "date_to"],
                },
            },
        ]

    def ai_tool_handler(self, tool_name, inputs, user_id):
        if tool_name == "sentinel2_availability":
            return self._handle_availability(inputs, user_id)
        elif tool_name == "sentinel2_image_analysis":
            return self._handle_image_analysis(inputs, user_id)
        return {"error": f"Unbekanntes Tool: {tool_name}"}

    def _handle_availability(self, inputs, user_id):
        bbox = inputs.get("bbox", [])
        date_from = inputs.get("date_from", "")
        date_to = inputs.get("date_to", "")

        if len(bbox) != 4:
            return {"error": "bbox muss 4 Werte haben [lon_min, lat_min, lon_max, lat_max]"}
        if not date_from or not date_to:
            return {"error": "date_from und date_to erforderlich (YYYY-MM-DD)"}

        try:
            from plugins.watchzone.ndvi._transport import fetch_sentinel_ndvi_stats
            stats = fetch_sentinel_ndvi_stats(bbox, date_from, date_to, user_id=user_id)
        except Exception as e:
            return {"error": f"Sentinel-API-Fehler: {str(e)[:120]}"}

        if not stats:
            return {"bbox": bbox, "period": f"{date_from} bis {date_to}",
                    "available_dates": 0, "message": "Keine Sentinel-2 Daten für diese Region/Zeitraum"}

        values = [s["mean_ndvi"] for s in stats if s.get("mean_ndvi") is not None]
        dates = [s["date"] for s in stats if s.get("mean_ndvi") is not None]

        result = {
            "bbox": bbox,
            "period": f"{date_from} bis {date_to}",
            "available_dates": len(dates),
            "dates": dates,
        }

        if values:
            avg_ndvi = sum(values) / len(values)
            result["ndvi_stats"] = {
                "avg": round(avg_ndvi, 3),
                "max": round(max(values), 3),
                "min": round(min(values), 3),
                "max_date": dates[values.index(max(values))],
                "min_date": dates[values.index(min(values))],
            }

        return result

    def _handle_image_analysis(self, inputs, user_id):
        import base64, logging
        log = logging.getLogger(__name__)

        from plugins.watchzone.satellite._transport import fetch_sentinel_image
        from plugins.ai._llm import analyze_image, compare_images, get_ai_settings

        bbox = inputs.get("bbox", [])
        date_from = inputs.get("date_from", "")
        date_to = inputs.get("date_to", "")
        compare_from = inputs.get("compare_from")
        compare_to = inputs.get("compare_to")
        question = inputs.get("question", "")

        if len(bbox) != 4:
            return {"error": "bbox muss 4 Werte haben [lon_min, lat_min, lon_max, lat_max]"}
        if not date_from or not date_to:
            return {"error": "date_from und date_to erforderlich"}

        settings = get_ai_settings(user_id)

        # Bild abrufen
        try:
            img_bytes, used_bbox, cropped = fetch_sentinel_image(
                bbox, date_from, date_to, 1024, 1024, user_id=user_id)
            img_b64 = base64.b64encode(img_bytes).decode("ascii")
        except Exception as e:
            return {"error": f"Satellitenbild-Abruf fehlgeschlagen: {str(e)[:120]}"}

        system = (
            "Du bist ein Experte für Satellitenbildanalyse und Fernerkundung. "
            "Analysiere das Sentinel-2 Echtfarb-Satellitenbild präzise und sachlich. "
            "Beschreibe Landnutzung, Infrastruktur, Vegetation, Gewässer und "
            "auffällige Merkmale. Wenn du nach Veränderungen gefragt wirst, "
            "beschreibe konkret was sich zwischen den Bildern unterscheidet."
        )

        # Vergleichsanalyse (2 Zeitpunkte)?
        if compare_from and compare_to:
            try:
                img2_bytes, _, _ = fetch_sentinel_image(
                    bbox, compare_from, compare_to, 1024, 1024, user_id=user_id)
                img2_b64 = base64.b64encode(img2_bytes).decode("ascii")
            except Exception as e:
                return {"error": f"Vergleichsbild-Abruf fehlgeschlagen: {str(e)[:120]}"}

            prompt = (
                f"Vergleiche diese zwei Sentinel-2 Satellitenbilder der gleichen Region "
                f"(bbox: {bbox}).\n"
                f"Bild 1: Zeitraum {date_from} bis {date_to}\n"
                f"Bild 2: Zeitraum {compare_from} bis {compare_to}\n\n"
                f"Beschreibe erkennbare Veränderungen zwischen den beiden Zeitpunkten."
            )
            if question:
                prompt += f"\n\nSpezifische Frage: {question}"

            result = compare_images(
                [(f"Zeitraum {date_from}–{date_to}", img_b64),
                 (f"Zeitraum {compare_from}–{compare_to}", img2_b64)],
                prompt, settings, system=system, max_tokens=3000)
        else:
            # Einzelbild-Analyse
            prompt = (
                f"Analysiere dieses Sentinel-2 Satellitenbild "
                f"(bbox: {bbox}, Zeitraum: {date_from} bis {date_to})."
            )
            if question:
                prompt += f"\n\nSpezifische Frage: {question}"
            else:
                prompt += (
                    "\n\nBeschreibe: Landnutzung, Vegetation, Infrastruktur, "
                    "Gewässer, auffällige Merkmale."
                )

            result = analyze_image(img_b64, prompt, settings,
                                   system=system, max_tokens=3000)

        if not result.get("ok"):
            return {"error": f"LLM-Analyse fehlgeschlagen: {result.get('error', 'Unbekannt')}"}

        return {
            "bbox": bbox,
            "period": f"{date_from} bis {date_to}",
            "compare_period": f"{compare_from} bis {compare_to}" if compare_from else None,
            "analysis": result["text"],
            "model": result.get("model", ""),
        }

    def analysis_provider(self):
        return {
            "data_types": ["satellite"],
            "history_endpoint_suffix": "satellite-dates",
            "analysis_js": "/plugins/watchzone/satellite/static/satellite_analysis.js",
            "ui_prefix": "sat",
            "ui_label": "Satellitendaten",
            "ui_color": "#8b5cf6",
            "zone_types": ["satellite"],
            "accepts_global": True,
        }

PluginManager.register(SatellitePlugin())
