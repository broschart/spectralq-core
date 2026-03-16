"""
AI-Plugin-Typ.

Jede KI-Funktion (Trend-Analyse, Keyword-Vorschläge, Projekt-Assistent, ...)
ist ein eigenes Plugin, das AIPlugin erweitert und sich beim Import registriert.
"""

from plugins import PluginManager
from plugins.base import BasePlugin


class AIPlugin(BasePlugin):
    """Basis fuer alle AI-Plugins."""

    plugin_type = "ai"

    meta = {
        **BasePlugin.meta,
        "required_credentials": ["anthropic_api_key"],
        "route_prefix": "",        # z.B. "/api/ai-analyze"
    }

    def is_available(self, user_id):
        """Prüft ob mindestens ein LLM-API-Key konfiguriert ist."""
        import os
        if os.getenv("ANTHROPIC_API_KEY"):
            return True
        try:
            from models import AppSetting
            for key in self.meta.get("required_credentials", ["anthropic_api_key"]):
                row = AppSetting.query.filter_by(key=key, user_id=user_id).first()
                if row and row.value:
                    return True
                admin_row = AppSetting.query.filter_by(key=key, user_id=None).first()
                if admin_row and admin_row.value:
                    return True
        except Exception:
            pass
        return False

    def api_routes(self):
        """Override: Liste von {rule, endpoint, handler, methods} für Flask.

        Jeder Eintrag wird dynamisch als Route registriert:
            app.add_url_rule(rule, endpoint=endpoint,
                             view_func=handler, methods=methods)
        """
        return []

    @staticmethod
    def _guard(plugin_id):
        """Prüft ob Plugin aktiviert ist + gibt (user_id, settings) oder Flask-Response."""
        from flask import jsonify
        from flask_login import current_user
        from plugins import PluginManager
        uid = current_user.id if current_user and current_user.is_authenticated else None
        if not uid:
            return jsonify({"error": "Nicht eingeloggt."}), 401
        enabled = PluginManager.enabled_for_user("ai", uid)
        if plugin_id not in enabled:
            return jsonify({"error": "Plugin deaktiviert."}), 403
        from plugins.ai._llm import get_ai_settings, check_quota
        ok, used, limit = check_quota(uid)
        if not ok:
            return jsonify({"error": f"KI-Kontingent erschöpft ({used}/{limit} Aufrufe diesen Monat). Bitte nächsten Monat erneut versuchen."}), 429
        return uid, get_ai_settings(uid)


# Plugin-Typ beim PluginManager registrieren
PluginManager.register_type("ai", AIPlugin)
