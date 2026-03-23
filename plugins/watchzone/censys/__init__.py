"""Censys Watch Zone Plugin — Censys Search API v2."""

import os
from plugins import PluginManager
from plugins.watchzone import WatchZonePlugin

class CensysPlugin(WatchZonePlugin):
    plugin_id = "censys"

    meta = {
        "label": "Censys",
        "icon_svg": (
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" '
            'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
            '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'
            '<line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>'
            '</svg>'
        ),
        "color": "#e11d48",
        "description": "Censys Internet-Suche (exponierte Hosts/Dienste)",
        "category": "search",
        "required_credentials": ["censys_api_id", "censys_api_secret"],
        "credential_group": "censys",
        "has_live": True,
        "has_history": False,
        "panel_template": "censys/_panel.html",
        "js_file": "/plugins/watchzone/censys/static/censys.js",

    }

    def live_handler(self, zone, config, geo, bbox, user_id):
        from plugins.watchzone.censys._transport import fetch_censys_search
        from models import AppSetting
        query = config.get("query", "")
        if not query:
            return {"error": "Keine Censys-Suchanfrage konfiguriert"}

        def _cred(key):
            obj = AppSetting.query.filter_by(key=key, user_id=user_id).first() \
               or AppSetting.query.filter_by(key=key, user_id=None).first()
            return (obj.value if obj else "") or os.getenv(key.upper(), "")

        api_id = _cred("censys_api_id")
        api_secret = _cred("censys_api_secret")
        if not api_id or not api_secret:
            return {"error": "Censys-Credentials fehlen (Einstellungen \u2192 Censys API ID / Secret)"}

        items = fetch_censys_search(query, api_id, api_secret)
        return {
            "zone_id": zone.id, "zone_name": zone.name, "zone_type": "censys",
            "count": len(items), "items": items, "query": query,
        }

    def ai_tools(self):
        return [{
            "name": "censys_host_search",
            "description": (
                "Durchsucht die Censys-Datenbank nach exponierten Hosts/Diensten im Internet. "
                "Findet offene Ports, Dienste, ASN-Informationen und Geo-Lokation. "
                "Nützlich für OSINT, Infrastruktur-Analyse und Sicherheitsbewertung."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": (
                            "Censys-Suchanfrage (z.B. 'services.port=443 AND "
                            "location.country_code=DE', 'ip:203.0.113.0/24', "
                            "'services.http.response.html_title: example')"
                        ),
                    },
                    "per_page": {
                        "type": "integer",
                        "description": "Max. Ergebnisse (1-100, Standard: 25)",
                    },
                },
                "required": ["query"],
            },
        }]

    def ai_tool_handler(self, tool_name, inputs, user_id):
        if tool_name != "censys_host_search":
            return {"error": f"Unbekanntes Tool: {tool_name}"}

        from plugins.watchzone.censys._transport import fetch_censys_search
        from models import AppSetting
        import os

        query = inputs.get("query", "")
        per_page = min(int(inputs.get("per_page", 25)), 100)
        if not query:
            return {"error": "Keine Suchanfrage angegeben"}

        def _cred(key):
            obj = AppSetting.query.filter_by(key=key, user_id=user_id).first() \
               or AppSetting.query.filter_by(key=key, user_id=None).first()
            return (obj.value if obj else "") or os.getenv(key.upper(), "")

        api_id = _cred("censys_api_id")
        api_secret = _cred("censys_api_secret")
        if not api_id or not api_secret:
            return {"error": "Censys-Credentials nicht konfiguriert"}

        try:
            items = fetch_censys_search(query, api_id, api_secret, per_page)
        except RuntimeError as e:
            return {"error": str(e)}

        # Kompakte Zusammenfassung für APA
        summary_items = []
        for it in items[:25]:
            ports_str = ", ".join(str(p) for p in it.get("ports", []))
            svcs_str = ", ".join(it.get("services", []))
            summary_items.append({
                "ip": it["ip"],
                "ports": ports_str,
                "services": svcs_str,
                "org": it.get("org", ""),
                "country": it.get("country", ""),
                "city": it.get("city", ""),
                "asn": it.get("asn"),
                "last_updated": it.get("last_updated", ""),
            })

        return {
            "query": query,
            "total": len(items),
            "hosts": summary_items,
        }

PluginManager.register(CensysPlugin())
