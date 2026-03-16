"""AI Plugin: Project Assistant (Dashboard KI-Start)."""

from plugins import PluginManager
from plugins.ai import AIPlugin

class ProjectAssistantPlugin(AIPlugin):
    plugin_id = "project_assistant"
    meta = {
        "label": "Project Assistant",
        "icon_svg": '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z"/><path d="M6 10v1a6 6 0 0 0 12 0v-1"/><line x1="12" y1="17" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg>',
        "color": "#8b5cf6",
        "description": "KI-gestützter Projektstart mit automatischer Keyword-Recherche und Analyse.",
        "required_credentials": ["anthropic_api_key"],

    }

PluginManager.register(ProjectAssistantPlugin())
