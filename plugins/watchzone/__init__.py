"""
Watch-Zone-Plugin-Typ.

Jeder Zone-Typ (vessel, aircraft, seismic, ...) ist ein eigenes Plugin,
das WatchZonePlugin erweitert und sich beim Import registriert.
"""

from plugins import PluginManager
from plugins.base import BasePlugin


class WatchZonePlugin(BasePlugin):
    """Basis fuer alle Watch-Zone-Plugins."""

    plugin_type = "watchzone"

    # Erweiterte Meta-Felder (zusaetzlich zu BasePlugin.meta)
    meta = {
        **BasePlugin.meta,
        "category": "geo",         # "geo" | "web" | "search"
        "has_live": False,         # Unterstuetzt Live-Datenabfrage?
        "has_history": False,      # Liefert Zeitreihendaten fuer Analyse?
        "panel_template": "",      # Pfad zum Jinja2-Panel-Fragment
        "js_file": "",             # Pfad zur Plugin-JS-Datei
        # Live-Popup-Slots (optional — nur setzen wenn Plugin Elemente beitraegt)
        "overlay_template": "",            # Standalone-Modals/Overlays (ausserhalb Live-Popup)
        "live_header_template": "",        # Buttons im Live-Popup-Header
        "live_map_inset_template": "",     # Elemente innerhalb der Live-Map
        "live_side_panels_template": "",   # Seitenpanels neben der Map
        "live_undermap_template": "",      # Buttons unter der Map
    }

    # Gemeinsame WZ-Core-Uebersetzungen (Subnav, Global-Panel, Live-Popup etc.)
    # Werden beim Typ-Import ueber PluginManager.type_i18n einmalig registriert.
    _core_i18n = {
        "de": {
            "ef_nav_manage": "Verwalten", "ef_nav_find": "Meldungen finden", "ef_nav_watchzones": "Watch Zones",
            "wz_lbl_project": "Projekt:", "wz_all_projects": "\u2013 Alle \u2013",
            "wz_draw_new_zone": "+ Neue Zone zeichnen",
            "wz_active": "aktiv", "wz_inactive": "inaktiv",
            "wz_fetch_live": "Live-Daten abrufen", "wz_btn_live": "Live",
            "wz_tt_toggle": "Aktiv/Inaktiv", "wz_tt_center": "Auf Karte zentrieren", "wz_tt_delete": "L\u00f6schen", "wz_tt_edit": "Bearbeiten",
            "wz_tt_delete_global": "Nur unter \u201eGlobale Zonen\u201c l\u00f6schbar", "wz_delete_global_hint": "Diese Zone ist eine globale Zone und kann nur unter \u201eGlobale Zonen\u201c gel\u00f6scht werden.",
            "wz_tt_edit_global": "Nur unter \u201eGlobale Zonen\u201c bearbeitbar", "wz_edit_global_hint": "Diese Zone ist eine globale Zone und kann nur unter \u201eGlobale Zonen\u201c bearbeitet werden.",
            "wz_editing_zone": "Zone bearbeiten \u2013 Eckpunkte ziehen zum \u00c4ndern", "wz_edit_save": "Speichern", "wz_edit_cancel": "Abbrechen",
            "wz_draw_polygon": "Polygon-Zone zeichnen", "wz_draw_rectangle": "Rechteck-Zone zeichnen",
            "wz_zone_name_prompt": "Name der Beobachtungszone:", "wz_zone_name_default": "Neue Zone",
            "wz_unknown": "Unbekannt", "wz_show_details_arrow": "Details anzeigen \u2192", "wz_show_details": "Details anzeigen",
            "wz_sidebar_global": "Globale Zonen",
            "wz_global_title": "Globale Zonen", "wz_global_subtitle": "Kategorien\u00fcbergreifende Zonen f\u00fcr alle Beobachtungstypen",
            "wz_global_desc": "Globale Zonen gelten gleichzeitig f\u00fcr alle Beobachtungskategorien. Einmal gezeichnet, erscheint die Zone automatisch in jeder aktiven Kategorie \u2013 ideal f\u00fcr ein dauerhaftes Beobachtungsgebiet, das nicht mehrfach definiert werden soll.",
            "wz_global_hint": "Hier kategorien\u00fcbergreifende Beobachtungszonen definieren, die in allen aktiven Kategorien wiederverwendet werden k\u00f6nnen \u2013 ohne die Zone jedes Mal neu zeichnen zu m\u00fcssen.",
            "wz_clock_suffix": " Uhr", "wz_fetch_time_suffix": " (Abrufzeit)",
            "wz_live_title_default": "Live-Daten", "wz_live_prefix_live": "Live-Daten:",
            "wz_spinner_loading": "Lade Daten \u2026", "wz_loading_live": "Lade Live-Daten \u2026", "wz_load_error_prefix": "Fehler beim Laden:",
            "wz_btn_refresh": "\u21bb Aktualisieren",
            "wz_unknown_error": "Unbekannter Fehler",
        },
        "en": {
            "ef_nav_manage": "Manage", "ef_nav_find": "Find Reports", "ef_nav_watchzones": "Watch Zones",
            "wz_lbl_project": "Project:", "wz_all_projects": "\u2013 All \u2013",
            "wz_draw_new_zone": "+ Draw New Zone",
            "wz_active": "active", "wz_inactive": "inactive",
            "wz_fetch_live": "Fetch live data", "wz_btn_live": "Live",
            "wz_tt_toggle": "Enable/Disable", "wz_tt_center": "Centre on map", "wz_tt_delete": "Delete", "wz_tt_edit": "Edit",
            "wz_tt_delete_global": "Only deletable under Global Zones", "wz_delete_global_hint": "This zone is a global zone and can only be deleted under \u201cGlobal Zones\u201d.",
            "wz_tt_edit_global": "Only editable under Global Zones", "wz_edit_global_hint": "This zone is a global zone and can only be edited under \u201cGlobal Zones\u201d.",
            "wz_editing_zone": "Editing zone \u2013 drag handles to reshape", "wz_edit_save": "Save", "wz_edit_cancel": "Cancel",
            "wz_draw_polygon": "Draw Polygon Zone", "wz_draw_rectangle": "Draw Rectangle Zone",
            "wz_zone_name_prompt": "Observation zone name:", "wz_zone_name_default": "New Zone",
            "wz_unknown": "Unknown", "wz_show_details_arrow": "Show details \u2192", "wz_show_details": "Show details",
            "wz_sidebar_global": "Global Zones",
            "wz_global_title": "Global Zones", "wz_global_subtitle": "Cross-category zones for all observation types",
            "wz_global_desc": "Global zones apply simultaneously to all observation categories. Once drawn, the zone automatically appears in every active category \u2013 ideal for a permanent observation area you don\u2019t want to define multiple times.",
            "wz_global_hint": "Define cross-category observation zones here that you can reuse across all active categories \u2013 without having to redraw the zone each time.",
            "wz_clock_suffix": "", "wz_fetch_time_suffix": " (fetch time)",
            "wz_live_title_default": "Live Data", "wz_live_prefix_live": "Live Data:",
            "wz_spinner_loading": "Loading\u2026", "wz_loading_live": "Loading live data \u2026", "wz_load_error_prefix": "Error loading:",
            "wz_btn_refresh": "\u21bb Refresh",
            "wz_unknown_error": "Unknown error",
        },
        "fr": {
            "ef_nav_manage": "G\u00e9rer", "ef_nav_find": "Trouver des actualit\u00e9s", "ef_nav_watchzones": "Zones de surveillance",
            "wz_lbl_project": "Projet\u00a0:", "wz_all_projects": "\u2013 Tous \u2013",
            "wz_draw_new_zone": "+ Dessiner une zone",
            "wz_active": "actif", "wz_inactive": "inactif",
            "wz_fetch_live": "Donn\u00e9es en direct", "wz_btn_live": "Direct",
            "wz_tt_toggle": "Activer/D\u00e9sactiver", "wz_tt_center": "Centrer sur la carte", "wz_tt_delete": "Supprimer", "wz_tt_edit": "Modifier",
            "wz_tt_delete_global": "Supprimable uniquement sous Zones globales", "wz_delete_global_hint": "Cette zone est une zone globale et ne peut \u00eatre supprim\u00e9e que sous \u00ab\u00a0Zones globales\u00a0\u00bb.",
            "wz_tt_edit_global": "Modifiable uniquement sous Zones globales", "wz_edit_global_hint": "Cette zone est une zone globale et ne peut \u00eatre modifi\u00e9e que sous \u00ab\u00a0Zones globales\u00a0\u00bb.",
            "wz_editing_zone": "Modification de la zone \u2013 glissez les poign\u00e9es pour remodeler", "wz_edit_save": "Enregistrer", "wz_edit_cancel": "Annuler",
            "wz_draw_polygon": "Dessiner une zone polygone", "wz_draw_rectangle": "Dessiner une zone rectangle",
            "wz_zone_name_prompt": "Nom de la zone d\u2019observation\u00a0:", "wz_zone_name_default": "Nouvelle zone",
            "wz_unknown": "Inconnu", "wz_show_details_arrow": "Voir les d\u00e9tails \u2192", "wz_show_details": "Voir les d\u00e9tails",
            "wz_sidebar_global": "Zones globales",
            "wz_global_title": "Zones globales", "wz_global_subtitle": "Zones transversales pour tous les types d\u2019observation",
            "wz_global_desc": "Les zones globales s\u2019appliquent simultan\u00e9ment \u00e0 toutes les cat\u00e9gories d\u2019observation. Une fois dessin\u00e9e, la zone appara\u00eet automatiquement dans chaque cat\u00e9gorie active \u2013 id\u00e9al pour une zone d\u2019observation permanente.",
            "wz_global_hint": "D\u00e9finissez ici des zones d\u2019observation transversales r\u00e9utilisables dans toutes les cat\u00e9gories actives \u2013 sans avoir \u00e0 redessiner la zone \u00e0 chaque fois.",
            "wz_clock_suffix": "", "wz_fetch_time_suffix": " (heure d\u2019appel)",
            "wz_live_title_default": "Donn\u00e9es en direct", "wz_live_prefix_live": "En direct\u00a0:",
            "wz_spinner_loading": "Chargement\u2026", "wz_loading_live": "Chargement des donn\u00e9es\u2026", "wz_load_error_prefix": "Erreur de chargement\u00a0:",
            "wz_btn_refresh": "\u21bb Actualiser",
            "wz_unknown_error": "Erreur inconnue",
        },
        "es": {
            "ef_nav_manage": "Gestionar", "ef_nav_find": "Buscar noticias", "ef_nav_watchzones": "Zonas de vigilancia",
            "wz_lbl_project": "Proyecto:", "wz_all_projects": "\u2013 Todos \u2013",
            "wz_draw_new_zone": "+ Dibujar zona",
            "wz_active": "activo", "wz_inactive": "inactivo",
            "wz_fetch_live": "Datos en vivo", "wz_btn_live": "Vivo",
            "wz_tt_toggle": "Activar/Desactivar", "wz_tt_center": "Centrar en mapa", "wz_tt_delete": "Eliminar", "wz_tt_edit": "Editar",
            "wz_tt_delete_global": "Solo eliminable en Zonas globales", "wz_delete_global_hint": "Esta zona es una zona global y solo puede eliminarse en \u201cZonas globales\u201d.",
            "wz_tt_edit_global": "Solo editable en Zonas globales", "wz_edit_global_hint": "Esta zona es una zona global y solo puede editarse en \u201cZonas globales\u201d.",
            "wz_editing_zone": "Editando zona \u2013 arrastra los puntos para modificar", "wz_edit_save": "Guardar", "wz_edit_cancel": "Cancelar",
            "wz_draw_polygon": "Dibujar zona pol\u00edgono", "wz_draw_rectangle": "Dibujar zona rect\u00e1ngulo",
            "wz_zone_name_prompt": "Nombre de la zona de observaci\u00f3n:", "wz_zone_name_default": "Nueva zona",
            "wz_unknown": "Desconocido", "wz_show_details_arrow": "Ver detalles \u2192", "wz_show_details": "Ver detalles",
            "wz_sidebar_global": "Zonas globales",
            "wz_global_title": "Zonas globales", "wz_global_subtitle": "Zonas transversales para todos los tipos de observaci\u00f3n",
            "wz_global_desc": "Las zonas globales se aplican simult\u00e1neamente a todas las categor\u00edas de observaci\u00f3n. Una vez dibujada, la zona aparece autom\u00e1ticamente en cada categor\u00eda activa \u2013 ideal para un \u00e1rea de observaci\u00f3n permanente.",
            "wz_global_hint": "Defina aqu\u00ed zonas de observaci\u00f3n transversales reutilizables en todas las categor\u00edas activas \u2013 sin tener que redibujar la zona cada vez.",
            "wz_clock_suffix": "", "wz_fetch_time_suffix": " (hora de consulta)",
            "wz_live_title_default": "Datos en vivo", "wz_live_prefix_live": "En vivo:",
            "wz_spinner_loading": "Cargando\u2026", "wz_loading_live": "Cargando datos en vivo\u2026", "wz_load_error_prefix": "Error al cargar:",
            "wz_btn_refresh": "\u21bb Actualizar",
            "wz_unknown_error": "Error desconocido",
        },
    }

    # ------------------------------------------------------------------
    # Hooks — von konkreten Plugins ueberschrieben
    # ------------------------------------------------------------------

    def live_handler(self, zone, config, geo, bbox, user_id):
        """Liefert Live-Daten fuer eine Zone.

        Args:
            zone: WatchZone-Modell-Instanz
            config: dict (geparstes zone.config JSON)
            geo: dict (geparstes zone.geometry GeoJSON)
            bbox: tuple (min_lon, min_lat, max_lon, max_lat) oder None
            user_id: int

        Returns:
            dict mit Ergebnis (wird als JSON zurueckgegeben)
        """
        raise NotImplementedError(f"{self.plugin_id}: live_handler nicht implementiert")

    def api_routes(self):
        """Standalone API-Routen die dieses Plugin bereitstellt.

        Returns:
            list of {"rule": str, "handler": callable, "methods": list[str]}
        """
        return []

    def history_routes(self):
        """Liste von History-API-Routen die dieses Plugin bereitstellt.

        Returns:
            list of {"suffix": str, "handler": callable(zone, args, user_id) -> Response}
        """
        return []

    def ai_tools(self):
        """AI-Tool-Definitionen im Anthropic-Format.

        Returns:
            list of dict (tool definitions)
        """
        return []

    def ai_tool_handler(self, tool_name, inputs, user_id):
        """Fuehrt einen AI-Tool-Aufruf aus.

        Args:
            tool_name: str
            inputs: dict
            user_id: int

        Returns:
            dict mit Ergebnis
        """
        return {"error": f"Tool nicht implementiert: {tool_name}"}

    def analysis_provider(self):
        """Konfiguration fuer Analyse-Triangulation.

        Returns:
            dict mit {"data_types": [...], "history_endpoint_suffix": "..."}
            oder None wenn kein Analyse-Provider
        """
        return None


# Plugin-Typ beim PluginManager registrieren
PluginManager.register_type("watchzone", WatchZonePlugin)
