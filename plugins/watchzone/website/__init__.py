"""Website Watch Zone Plugin — Wayback Machine + Traceroute."""

from flask import jsonify
from plugins import PluginManager
from plugins.watchzone import WatchZonePlugin

class WebsitePlugin(WatchZonePlugin):
    plugin_id = "website"

    meta = {
        "label": "Websites",
        "icon_svg": (
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" '
            'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
            '<circle cx="12" cy="12" r="10"/>'
            '<line x1="2" y1="12" x2="22" y2="12"/>'
            '<path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>'
            '</svg>'
        ),
        "color": "#06b6d4",
        "description": "Website-Monitoring via Wayback Machine + Traceroute",
        "category": "web",
        "required_credentials": [],
        "has_live": True,
        "has_history": True,
        "panel_template": "website/_panel.html",
        "js_file": "/plugins/watchzone/website/static/website.js",
        "overlay_template": "website/_overlay.html",
        "live_map_inset_template": "website/_live_inset.html",
        "live_side_panels_template": "website/_live_panels.html",
        "live_undermap_template": "website/_live_undermap.html",
    }

    def api_routes(self):
        from plugins.watchzone.website._routes import api_traceroute, api_traceroute_result, api_traceroute_result_patch
        return [
            {"rule": "/api/watchzones/<int:zid>/traceroute", "handler": api_traceroute},
            {"rule": "/api/watchzones/<int:zid>/traceroute-result", "handler": api_traceroute_result, "methods": ["GET", "POST"]},
            {"rule": "/api/watchzones/<int:zid>/traceroute-result/<int:rid>", "handler": api_traceroute_result_patch, "methods": ["PATCH"]},
        ]

    def live_handler(self, zone, config, geo, bbox, user_id):
        from plugins.watchzone.website._transport import fetch_wayback_live
        url = config.get("url", "")
        if not url:
            return {"error": "Keine URL konfiguriert"}
        items = fetch_wayback_live(url)
        return {
            "zone_id": zone.id, "zone_name": zone.name,
            "zone_type": "website", "count": len(items), "items": items, "url": url,
        }

    def history_routes(self):
        return [
            {"suffix": "website-history", "handler": self._history_handler},
            # traceroute + traceroute-result bleiben vorerst in app.py
            # (SSE-Streaming und PATCH-Routen sind komplex genug fuer separate Migration)
        ]

    def _history_handler(self, zone, args, user_id):
        import json as _j, logging
        log = logging.getLogger(__name__)
        config = _j.loads(zone.config) if zone.config else {}
        url = config.get("url", "")
        if not url:
            return jsonify({"error": "Keine URL konfiguriert"}), 400
        date_from = args.get("from", "")
        date_to = args.get("to", "")
        if not date_from or not date_to:
            return jsonify({"error": "Parameter 'from' und 'to' erforderlich"}), 400
        try:
            from plugins.watchzone.website._transport import fetch_wayback_changes
            data = fetch_wayback_changes(url, date_from, date_to)
            return jsonify({"zone_id": zone.id, "zone_name": zone.name, "url": url, "data": data})
        except Exception as e:
            log.warning("Website-History Fehler (Zone %d): %s", zone.id, e)
            return jsonify({"error": str(e)}), 502

    def ai_tools(self):
        return [
            {
                "name": "get_website_history",
                "description": "Gibt historische Wayback-Machine-Aenderungen einer Website-Watchzone zurueck.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "zone_id": {"type": "integer", "description": "ID der Watch Zone"},
                        "date_from": {"type": "string", "description": "Startdatum YYYY-MM-DD"},
                        "date_to": {"type": "string", "description": "Enddatum YYYY-MM-DD"},
                    },
                    "required": ["zone_id", "date_from", "date_to"],
                },
            },
            {
                "name": "get_traceroute_history",
                "description": "Gibt gespeicherte Traceroute-Ergebnisse einer Website-Watchzone zurueck.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "zone_id": {"type": "integer", "description": "ID der Watch Zone"},
                        "limit": {"type": "integer", "description": "Anzahl Ergebnisse (Standard: 5, max: 20)"},
                    },
                    "required": ["zone_id"],
                },
            },
        ]

    def ai_tool_handler(self, tool_name, inputs, user_id):
        import json as _j
        from models import WatchZone

        if tool_name == "get_website_history":
            z = WatchZone.query.filter_by(id=inputs["zone_id"], user_id=user_id).first()
            if not z:
                return {"error": f"Zone {inputs['zone_id']} nicht gefunden"}
            cfg = _j.loads(z.config) if z.config else {}
            url = cfg.get("url", "")
            if not url:
                return {"error": "Zone hat keine URL konfiguriert"}
            try:
                from plugins.watchzone.website._transport import fetch_wayback_changes
                data = fetch_wayback_changes(url, inputs["date_from"], inputs["date_to"])
                return {"zone_id": z.id, "zone_name": z.name, "url": url, "data": data}
            except Exception as e:
                return {"error": str(e)}

        elif tool_name == "get_traceroute_history":
            from models import TracerouteResult
            z = WatchZone.query.filter_by(id=inputs["zone_id"], user_id=user_id).first()
            if not z:
                return {"error": f"Zone {inputs['zone_id']} nicht gefunden"}
            limit = min(int(inputs.get("limit", 5)), 20)
            rows = (TracerouteResult.query
                    .filter_by(zone_id=z.id, user_id=user_id)
                    .order_by(TracerouteResult.created_at.desc())
                    .limit(limit).all())
            results = []
            for r in rows:
                d = r.to_dict()
                d.pop("hops", None)
                results.append(d)
            return {"zone_id": z.id, "zone_name": z.name, "results": results}

        return {"error": f"Unbekanntes Tool: {tool_name}"}

    def analysis_provider(self):
        return {"data_types": ["website"], "history_endpoint_suffix": "website-history"}

PluginManager.register(WebsitePlugin())
