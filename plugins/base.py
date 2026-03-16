"""
Basis-Klasse fuer alle VeriTrend.ai-Plugins.
"""


class BasePlugin:
    """Gemeinsame Basis — wird von typ-spezifischen Klassen erweitert."""

    plugin_type = None   # "watchzone", "ai", ...
    plugin_id   = None   # "vessel", "gpt4", ...

    # Metadaten — von jedem Plugin ueberschrieben
    meta = {
        "label": "",
        "icon_svg": "",
        "color": "#888",
        "description": "",
        "i18n": {},                # {de:{...}, en:{...}, fr:{...}, es:{...}}
        "required_credentials": [],
    }

    def is_available(self, user_id=None):
        """Prueft ob alle required_credentials vorhanden sind.

        Prueft User-spezifische, dann globale AppSettings, dann Env-Variablen.
        Kann von Plugins ueberschrieben werden fuer zusaetzliche Pruefungen.
        """
        import os
        creds = (self.meta or {}).get("required_credentials", [])
        if not creds:
            return True
        try:
            from models import AppSetting
            for key in creds:
                found = False
                if user_id:
                    obj = AppSetting.query.filter_by(key=key, user_id=user_id).first()
                    if obj and obj.value:
                        found = True
                if not found:
                    obj = AppSetting.query.filter_by(key=key, user_id=None).first()
                    if obj and obj.value:
                        found = True
                if not found and os.getenv(key.upper(), ""):
                    found = True
                if not found:
                    return False
        except Exception:
            return False
        return True

    def __repr__(self):
        return f"<{self.__class__.__name__} {self.plugin_type}/{self.plugin_id}>"
