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
        "apa_action": "wayback",
    }

    def apa_action_handler(self, action):
        """Returns dict with: status_msg, report, data_msg, error"""
        from datetime import datetime, timedelta
        from plugins.watchzone.website._transport import fetch_wayback_changes

        wb_url = (action.get("url") or action.get("domain") or "").strip()
        wb_days = min(int(action.get("days", 90)), 365)

        if not wb_url:
            return {"error": "Wayback: keine URL angegeben"}

        if "://" not in wb_url:
            wb_url = "https://" + wb_url

        try:
            date_to = datetime.utcnow().strftime("%Y-%m-%d")
            date_from = (datetime.utcnow() - timedelta(days=wb_days)).strftime("%Y-%m-%d")
            changes = fetch_wayback_changes(wb_url, date_from, date_to)

            if changes:
                by_month = {}
                for c in changes:
                    mon = c["date"][:7]
                    by_month[mon] = by_month.get(mon, 0) + 1
                month_str = ", ".join(f"{m}: {n}\u00d7" for m, n in sorted(by_month.items())[-6:])
                # Titeländerungen ermitteln
                title_changes = [c for c in changes if c.get("title_changed")]
                titles_seen = list(dict.fromkeys(
                    c["title"] for c in changes if c.get("title")
                ))
                report_parts = [
                    f"WAYBACK MACHINE ({wb_url}, {date_from} bis {date_to}):",
                    f"  {len(changes)} Inhaltliche Änderungen erkannt (jeweils neuer Digest)",
                    f"  Letzte Monate: {month_str}",
                    f"  Erster Snapshot: {changes[0]['date']}, Letzter: {changes[-1]['date']}",
                ]
                if titles_seen:
                    report_parts.append(f"  Bekannte Seitentitel ({len(titles_seen)} distinct): " + " | ".join(titles_seen[:8]))
                if title_changes:
                    report_parts.append(f"  \u26a0 {len(title_changes)} Titeländerung(en) erkannt:")
                    for tc in title_changes[:5]:
                        report_parts.append(f"    {tc['date']} {tc.get('time','')} — \"{tc.get('prev_title','?')}\" → \"{tc['title']}\"")
                tc_note = f", {len(title_changes)} Titeländerungen" if title_changes else ""
                return {
                    "status_msg": f"Wayback Machine: {wb_url} ({wb_days} Tage) …",
                    "report": "\n".join(report_parts),
                    "data_msg": f"Wayback {wb_url}: {len(changes)} Inhaltsänderungen in {wb_days} Tagen{tc_note} – {month_str}",
                    "error": None,
                }
            else:
                return {
                    "status_msg": f"Wayback Machine: {wb_url} ({wb_days} Tage) …",
                    "report": f"WAYBACK MACHINE ({wb_url}): Keine Snapshots im Zeitraum {date_from}–{date_to}",
                    "data_msg": f"Wayback {wb_url}: Keine Snapshots gefunden",
                    "error": None,
                }
        except Exception as e:
            return {"error": f"Wayback-Fehler: {str(e)[:80]}"}

    def api_routes(self):
        from plugins.watchzone.website._routes import (
            api_traceroute, api_traceroute_result, api_traceroute_result_patch,
            api_snapshot_diff, api_tracker_reverse_lookup,
        )
        return [
            {"rule": "/api/watchzones/<int:zid>/traceroute", "handler": api_traceroute},
            {"rule": "/api/watchzones/<int:zid>/traceroute-result", "handler": api_traceroute_result, "methods": ["GET", "POST"]},
            {"rule": "/api/watchzones/<int:zid>/traceroute-result/<int:rid>", "handler": api_traceroute_result_patch, "methods": ["PATCH"]},
            {"rule": "/api/watchzones/<int:zid>/snapshot-diff", "handler": api_snapshot_diff},
            {"rule": "/api/tracker-reverse-lookup", "handler": api_tracker_reverse_lookup},
        ]

    def live_handler(self, zone, config, geo, bbox, user_id):
        from plugins.watchzone.website._transport import fetch_wayback_live
        url = config.get("url", "")
        if not url:
            return {"error": "Keine URL konfiguriert"}

        time_focus = config.get("time_focus")
        if time_focus and time_focus.get("from"):
            # Load snapshots ±15 days around event
            from datetime import datetime as _dt, timedelta as _td
            from plugins.watchzone.website._transport import fetch_wayback_snapshots
            try:
                focus_date = _dt.strptime(time_focus["from"][:10], "%Y-%m-%d")
                date_from = (focus_date - _td(days=15)).strftime("%Y%m%d")
                date_to = (focus_date + _td(days=15)).strftime("%Y%m%d")
                items = fetch_wayback_snapshots(url, date_from, date_to)
                return {
                    "zone_id": zone.id, "zone_name": zone.name,
                    "zone_type": "website", "count": len(items), "items": items,
                    "url": url, "time_focus": time_focus,
                    "date_from": (focus_date - _td(days=15)).strftime("%Y-%m-%d"),
                    "date_to": (focus_date + _td(days=15)).strftime("%Y-%m-%d"),
                }
            except Exception as e:
                import logging
                logging.getLogger(__name__).warning("Wayback TF fetch error: %s", e)
                # Return empty result with time_focus info so UI shows correct date
                return {
                    "zone_id": zone.id, "zone_name": zone.name,
                    "zone_type": "website", "count": 0, "items": [],
                    "url": url, "time_focus": time_focus,
                    "date_from": (focus_date - _td(days=15)).strftime("%Y-%m-%d"),
                    "date_to": (focus_date + _td(days=15)).strftime("%Y-%m-%d"),
                    "error_hint": "Wayback Machine nicht erreichbar. Bitte sp\u00e4ter erneut versuchen.",
                }

        from datetime import datetime as _dt, timedelta as _td
        from plugins.watchzone.website._transport import fetch_wayback_snapshots
        days = config.get("days", 90)
        dt_to = _dt.utcnow()
        dt_from = dt_to - _td(days=days)
        try:
            items = fetch_wayback_snapshots(url, dt_from.strftime("%Y%m%d"), dt_to.strftime("%Y%m%d"))
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning("Wayback fetch error: %s", e)
            return {
                "zone_id": zone.id, "zone_name": zone.name,
                "zone_type": "website", "count": 0, "items": [], "url": url,
                "error_hint": "Wayback Machine nicht erreichbar: " + str(e)[:100],
            }
        return {
            "zone_id": zone.id, "zone_name": zone.name,
            "zone_type": "website", "count": len(items), "items": items, "url": url,
            "date_from": dt_from.strftime("%Y-%m-%d"),
            "date_to": dt_to.strftime("%Y-%m-%d"),
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
        return {
            "data_types": ["website"],
            "history_endpoint_suffix": "website-history",
            "analysis_js": "/plugins/watchzone/website/static/website_analysis.js",
            "ui_prefix": "web",
            "ui_label": "Website (Wayback)",
            "ui_color": "#06b6d4",
            "zone_types": ["website"],
            "accepts_global": False,
        }

PluginManager.register(WebsitePlugin())
