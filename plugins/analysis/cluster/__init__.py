"""Analysis Plugin: RQ Cluster Analyse."""
from plugins import PluginManager
from plugins.analysis import AnalysisPlugin

class ClusterPlugin(AnalysisPlugin):
    plugin_id = "cluster"
    meta = {
        "label": "RQ Cluster Analyse",
        "icon_svg": '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><circle cx="12" cy="16" r="3"/><line x1="10.5" y1="9.5" x2="12" y2="13.5"/><line x1="13.5" y1="9.5" x2="12" y2="13.5"/></svg>',
        "color": "#4ade80",
        "symbol": "⊕",
        "description": "Thematische Clusteranalyse verwandter Suchanfragen.",
        "default_show_in": ["popup"],
        "button_id": "",
        "requires_multi_kw": False,
        "modal_template": "cluster/_modal.html",
        "popup_handler": "openClusterForKw",

    }

PluginManager.register(ClusterPlugin())
