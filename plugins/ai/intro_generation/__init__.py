"""AI Plugin: Intro-Generierung für Präsentationen."""

from plugins import PluginManager
from plugins.ai import AIPlugin

class IntroGenerationPlugin(AIPlugin):
    plugin_id = "intro_generation"
    meta = {
        "label": "Intro-Generierung",
        "icon_svg": '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
        "color": "#06b6d4",
        "description": "Automatische Generierung von Einleitungstexten für Projekt-Präsentationen.",
        "required_credentials": ["anthropic_api_key"],

    }

    def api_routes(self):
        return [{"rule": "/api/ai-intro-generate", "endpoint": "api_ai_intro_generate",
                 "handler": self._handle, "methods": ["POST"]}]

    def _handle(self):
        import json as _json
        from flask import request, jsonify
        from flask_login import current_user
        from plugins.ai._llm import call_llm, increment_usage
        from models import Project, Snapshot, Slide

        guard = self._guard("intro_generation")
        if not isinstance(guard, tuple) or len(guard) != 2:
            return guard
        user_id, settings = guard

        body = request.get_json(force=True, silent=True) or {}
        project_id = body.get("project_id")
        if not project_id:
            return jsonify({"error": "project_id fehlt"}), 400

        proj = Project.query.filter_by(id=project_id, user_id=user_id).first()
        if not proj:
            from flask import abort
            abort(404)

        increment_usage(user_id, source="intro-generierung",
                        detail=proj.name if proj else f"Projekt #{project_id}")

        snaps = Snapshot.query.filter_by(project_id=project_id) \
                        .order_by(Snapshot.sort_order, Snapshot.created_at).all()
        slides = Slide.query.filter_by(project_id=project_id) \
                       .order_by(Slide.sort_order).all()

        prompt = self._build_prompt(proj, snaps, slides)
        result = call_llm(prompt, settings, max_tokens=512)

        if not result["ok"]:
            return jsonify({"error": result["error"]}), result.get("status", 502)

        return jsonify({"ok": True, "intro": result["text"].strip()})

    @staticmethod
    def _build_prompt(proj, snaps, slides):
        import json as _json

        TF = {"now 1-H": "1h", "now 4-H": "4h", "now 1-d": "24h", "now 7-d": "7 Tage",
              "today 1-m": "1 Monat", "today 3-m": "3 Monate",
              "today 12-m": "12 Monate", "today 5-y": "5 Jahre"}
        GP = {"": "Web", "news": "News", "images": "Bilder",
              "youtube": "YouTube", "froogle": "Shopping"}

        # Keywords aus Snapshots sammeln (dedupliziert)
        seen_kw = set()
        kw_list = []
        for snap in snaps:
            chart = _json.loads(snap.chart_json) if snap.chart_json else {}
            for m in chart.get("keywords_meta", []):
                kw = m.get("keyword", "")
                if not kw or kw in seen_kw:
                    continue
                seen_kw.add(kw)
                geo = m.get("geo", "") or "Weltweit"
                tf = TF.get(m.get("timeframe", ""), m.get("timeframe", ""))
                gp = GP.get(m.get("gprop", ""), "Web")
                kw_list.append(f"{kw} ({geo}, {gp}, {tf})")

        content_slides = [s for s in slides if s.slide_type != "title" and s.title]

        lines = [
            "Du bist Experte für Google Trends und Datenjournalismus. "
            "Erstelle einen prägnanten Einleitungstext auf Deutsch für eine Datenanalyse-Präsentation. "
            "Der Text soll in 2–3 kurzen Absätzen erklären: das Analyseziel, welche Keywords "
            "untersucht wurden und was die Zuschauer auf den folgenden Slides erwartet. "
            "Maximal 130 Wörter. Kein Markdown, keine Überschriften, nur Fließtext. "
            "WICHTIG: Schreibe ausschließlich aus der Wir-Perspektive (wir, uns, unser). "
            "Vermeide 'der Analyst', 'die Analyse zeigt' oder Dritte-Person-Konstrukte.",
            "",
            f"Projektname: {proj.name}",
        ]
        if proj.briefing and proj.briefing.strip():
            lines += ["", f"Projektbriefing: {proj.briefing.strip()}"]
        if kw_list:
            lines += ["", f"Analysierte Keywords ({len(kw_list)}):"]
            for kw in kw_list[:20]:
                lines.append(f"- {kw}")
        if snaps:
            lines += ["", f"Anzahl Snapshots: {len(snaps)}"]
        if content_slides:
            lines += ["", "Abschnitte der Präsentation:"]
            for s in content_slides[:10]:
                lines.append(f"- {s.title}")
        lines += [
            "",
            "WICHTIG: Beginne direkt mit dem Einleitungstext. Kein Titel, keine Aufzählung.",
        ]
        return "\n".join(lines)

PluginManager.register(IntroGenerationPlugin())
