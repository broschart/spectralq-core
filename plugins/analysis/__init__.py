"""
Analysis-Plugin-Typ.

Jede Analyse-Methode (SSIM, Outlier, Decomposition, ...) ist ein eigenes Plugin.
Zusätzlich zum Enable/Disable kann pro User konfiguriert werden, wo die Methode
erscheint: im Lab-Menü, im Keyword-Popup oder an beiden Stellen.
"""

from plugins import PluginManager
from plugins.base import BasePlugin


class AnalysisPlugin(BasePlugin):
    """Basis fuer alle Analysis-Plugins."""

    plugin_type = "analysis"

    meta = {
        **BasePlugin.meta,
        "default_show_in": ["popup"],  # "lab", "popup" oder beide
        "button_id": "",               # z.B. "btn-spike-coin"
        "color": "#888",
        "symbol": "",                  # z.B. "⚡"
        "requires_multi_kw": False,    # Braucht mind. 2 aktive Keywords?
        "popup_handler": "",           # z.B. "openSsimForKw"
        "popup_badges": [],            # [["i18n_key", "fallback"], ...]
        "modal_template": "",          # z.B. "ssim/_modal.html"
    }

    def api_routes(self):
        """Override: Liste von {rule, endpoint, handler, methods} für API-Routen.

        Beispiel:
            return [{"rule": "/api/decompose", "handler": self._handle, "methods": ["POST"]}]
        """
        return []

    def compute(self, body):
        """Kernberechnung ohne Flask-Kontext. Gibt ein dict zurück.

        Wird von _handle (HTTP) und _run_analysis (APA intern) genutzt.
        Fehler werden als {"error": "...", "_status": 400} zurückgegeben.
        """
        return {"error": "Not implemented", "_status": 501}

    def get_show_in(self, user_id):
        """Gibt zurück wo die Methode für den User angezeigt wird."""
        try:
            from models import AppSetting
            key = f"plugin_show_in_analysis_{self.plugin_id}"
            row = AppSetting.query.filter_by(key=key, user_id=user_id).first()
            if row and row.value:
                if row.value == "both":
                    return ["lab", "popup"]
                elif row.value == "none":
                    return []
                else:
                    return [row.value]
        except Exception:
            pass
        return list(self.meta.get("default_show_in", ["popup"]))


# Plugin-Typ beim PluginManager registrieren
PluginManager.register_type("analysis", AnalysisPlugin)
