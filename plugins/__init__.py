"""
VeriTrend.ai Plugin System — Generischer Plugin-Manager.

Plugins registrieren sich beim Import. PluginManager.discover_all() importiert
alle Plugin-Module aus den Unterordnern (watchzone/, ai/, ...).

Plugins koennen als einzelne .py-Dateien oder als gebündelte Ordner vorliegen:
  plugins/<type>/<plugin>.py          — klassisch (flach)
  plugins/<type>/<plugin>/            — gebündelt
      __init__.py                     — Plugin-Klasse
      templates/                      — Jinja2-Fragmente
      static/                         — JS/CSS/Assets
      i18n.json                       — Uebersetzungen
"""

import json as _json
import os as _os


class PluginManager:
    _plugins = {}          # {plugin_type: {plugin_id: plugin_instance}}
    _type_handlers = {}    # {plugin_type: type_handler_class}
    _bundle_dirs = {}      # {plugin_id: abs_template_dir} fuer gebündelte Plugins

    # ------------------------------------------------------------------
    # Registrierung
    # ------------------------------------------------------------------

    @classmethod
    def register_type(cls, plugin_type, handler_class):
        """Registriert einen Plugin-Typ (z.B. 'watchzone', 'ai')."""
        cls._type_handlers[plugin_type] = handler_class
        cls._plugins.setdefault(plugin_type, {})

    @classmethod
    def register(cls, plugin):
        """Registriert eine Plugin-Instanz.

        Bei gebündelten Plugins (Ordner mit __init__.py) wird automatisch:
        - i18n.json geladen und in meta['i18n'] gemerged
        - der templates/-Ordner fuer den Jinja-Loader vorgemerkt
        """
        ptype = plugin.plugin_type
        pid = plugin.plugin_id
        if ptype is None or pid is None:
            raise ValueError(f"Plugin {plugin!r} hat keinen plugin_type/plugin_id")

        # Bundle-Erkennung: __init__.py liegt in einem Unterordner
        plugin_file = _os.path.abspath(
            __import__(plugin.__class__.__module__, fromlist=["__file__"]).__file__
        )
        plugin_dir = _os.path.dirname(plugin_file)
        is_bundle = _os.path.basename(plugin_file) == "__init__.py" and _os.path.basename(plugin_dir) == pid

        if is_bundle:
            # i18n.json automatisch laden
            i18n_path = _os.path.join(plugin_dir, "i18n.json")
            if _os.path.isfile(i18n_path):
                with open(i18n_path, encoding="utf-8") as f:
                    plugin.meta["i18n"] = _json.load(f)

            # Template-Ordner vormerken (Prefix = plugin_id)
            tpl_dir = _os.path.join(plugin_dir, "templates")
            if _os.path.isdir(tpl_dir):
                cls._bundle_dirs[pid] = tpl_dir

        cls._plugins.setdefault(ptype, {})[pid] = plugin

    # ------------------------------------------------------------------
    # Abfragen
    # ------------------------------------------------------------------

    @classmethod
    def get(cls, plugin_type, plugin_id):
        """Einzelnes Plugin holen (oder None)."""
        return cls._plugins.get(plugin_type, {}).get(plugin_id)

    @classmethod
    def all_of_type(cls, plugin_type):
        """Alle Plugins eines Typs als {plugin_id: instance}."""
        return dict(cls._plugins.get(plugin_type, {}))

    @classmethod
    def all_types(cls):
        """Liste aller registrierten Plugin-Typen."""
        return list(cls._type_handlers.keys())

    @classmethod
    def enabled_for_user(cls, plugin_type, user_id):
        """Aktivierte Plugins eines Typs fuer einen User.

        Deaktivierte Plugins werden via AppSetting gespeichert:
        key = 'plugin_disabled_{plugin_type}_{plugin_id}', value = '1'.
        Kein Eintrag = aktiviert (Opt-out-Prinzip).
        """
        from models import AppSetting
        prefix = f"plugin_disabled_{plugin_type}_"
        disabled = set()
        try:
            rows = AppSetting.query.filter(
                AppSetting.key.like(prefix + "%"),
                AppSetting.user_id == user_id,
            ).all()
            for r in rows:
                if r.value == "1":
                    disabled.add(r.key[len(prefix):])
        except Exception:
            pass  # Ausserhalb App-Kontext (Tests etc.)
        all_plugins = cls._plugins.get(plugin_type, {})
        return {pid: p for pid, p in all_plugins.items() if pid not in disabled}

    # ------------------------------------------------------------------
    # Template-Ordner (fuer Jinja-ChoiceLoader)
    # ------------------------------------------------------------------

    @classmethod
    def template_dirs(cls):
        """Template-Ordner gebündelter Plugins als {plugin_id: abs_path}."""
        return dict(cls._bundle_dirs)

    # ------------------------------------------------------------------
    # Discovery
    # ------------------------------------------------------------------

    @classmethod
    def discover_all(cls):
        """Importiert alle Plugin-Module aus allen Typ-Unterordnern.

        Unterstuetzt sowohl flache Module (plugin.py) als auch
        gebündelte Ordner (plugin/__init__.py).
        """
        import importlib
        import pkgutil

        base = _os.path.dirname(__file__)
        for subdir in sorted(_os.listdir(base)):
            pkg_path = _os.path.join(base, subdir)
            if not _os.path.isdir(pkg_path) or subdir.startswith("_"):
                continue
            init_file = _os.path.join(pkg_path, "__init__.py")
            if not _os.path.isfile(init_file):
                continue
            # __init__.py importieren → registriert den Plugin-Typ
            importlib.import_module(f"plugins.{subdir}")
            # Alle Module im Paket importieren → registriert Plugins
            for _, modname, ispkg in pkgutil.iter_modules([pkg_path]):
                if modname.startswith("_"):
                    continue
                importlib.import_module(f"plugins.{subdir}.{modname}")
