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

PluginManager.register(CensysPlugin())
