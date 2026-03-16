"""AI Plugin: Keyword-Vorschläge."""

from plugins import PluginManager
from plugins.ai import AIPlugin

class KeywordSuggestionsPlugin(AIPlugin):
    plugin_id = "keyword_suggestions"
    meta = {
        "label": "Keyword-Vorschläge",
        "icon_svg": '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>',
        "color": "#f59e0b",
        "description": "KI-generierte Keyword-Empfehlungen basierend auf bestehenden Trends und Projektkontext.",
        "required_credentials": ["anthropic_api_key"],

    }

    def api_routes(self):
        return [{"rule": "/api/ai-keyword-suggestions", "endpoint": "api_ai_keyword_suggestions",
                 "handler": self._handle, "methods": ["POST"]}]

    def _handle(self):
        from flask import request, jsonify
        from flask_login import current_user
        from plugins.ai._llm import call_llm, increment_usage

        guard = self._guard("keyword_suggestions")
        if not isinstance(guard, tuple) or len(guard) != 2:
            return guard
        user_id, settings = guard

        body = request.get_json(force=True, silent=True) or {}
        series = body.get("series", [])
        project_id = body.get("project_id")

        if not series:
            return jsonify({"error": "Keine Daten übermittelt."}), 400

        increment_usage(user_id, source="keyword-vorschläge",
                        detail=', '.join(s.get('keyword', '') for s in series[:3]))

        # Projektbriefing laden
        project_briefing = ""
        if project_id:
            from models import Project
            proj = Project.query.filter_by(id=int(project_id), user_id=user_id).first()
            if proj and proj.briefing and proj.briefing.strip():
                project_briefing = proj.briefing.strip()

        prompt = self._build_prompt(series, project_briefing)
        result = call_llm(prompt, settings, max_tokens=2048)

        if not result["ok"]:
            return jsonify({"error": result["error"]}), result.get("status", 502)

        return jsonify({"ok": True, "suggestions": result["text"],
                        "model": result["model"]})

    @staticmethod
    def _build_prompt(series, project_briefing):
        GP = {"": "Web", "news": "News", "images": "Bilder",
              "youtube": "YouTube", "froogle": "Shopping"}

        lines = [
            "Du bist ein SEO- und Content-Marketing-Experte. "
            "Analysiere die folgenden Google Trends-Daten und schlage auf Deutsch "
            "neue, relevante Keywords vor, die für die Analyse nützlich sein könnten. "
            "Nutze Markdown-Formatierung: ## für Abschnitte, **fett** für Keyword-Namen, - für Listen. "
            "Strukturiere die Vorschläge in sinnvolle Kategorien (z. B. nach Themenbereich oder Suchintention). "
            "Gib zu jedem Keyword-Vorschlag eine kurze Begründung (1 Satz).",
            "",
        ]

        if project_briefing:
            lines += ["## Projektbriefing", project_briefing, ""]

        lines.append("## Aktuelle Keywords in der Analyse")
        seen_kws = set()
        for s in series:
            kw = s.get("keyword", "?")
            if kw in seen_kws:
                continue
            seen_kws.add(kw)
            geo_raw = s.get("geo")
            geo_lbl = geo_raw if geo_raw not in (None, "") else "DE"
            gp = GP.get(s.get("gprop", ""), "Web")
            data = s.get("data", [])
            vals = [p["value"] for p in data if p.get("value") is not None]
            d0 = data[0]["date"][:10] if data else "?"
            d1 = data[-1]["date"][:10] if data else "?"
            mn, mx = (min(vals), max(vals)) if vals else (0, 0)
            avg = sum(vals) / len(vals) if vals else 0
            lines.append(
                f"- **{kw}** ({geo_lbl}, {gp}): "
                f"Zeitraum {d0}–{d1}, Min={mn} Max={mx} Ø={avg:.1f}"
            )
        lines.append("")
        lines += [
            "---",
            "Bitte schlage 10–15 neue Keywords vor, die thematisch passen und noch nicht in der obigen Liste stehen. "
            "Berücksichtige Synonyme, verwandte Begriffe, Long-Tail-Keywords und saisonale Varianten. "
            "Gliedere die Vorschläge in sinnvolle Kategorien mit kurzen Erklärungen. "
            "WICHTIG: Beginne die Ausgabe sofort mit der ersten Kategorie (## Kategoriename). "
            "Keine einleitenden Sätze, keine Titel-Überschrift, keine Zusammenfassung am Anfang.",
        ]
        return "\n".join(lines)

PluginManager.register(KeywordSuggestionsPlugin())
