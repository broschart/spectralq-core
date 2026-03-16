"""AI Plugin: Projekt-Analyse (projektweite Snapshot-Analyse)."""

from plugins import PluginManager
from plugins.ai import AIPlugin

class ProjectAnalysisPlugin(AIPlugin):
    plugin_id = "project_analysis"
    meta = {
        "label": "Projekt-Analyse",
        "icon_svg": '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
        "color": "#10b981",
        "description": "KI-gestützte Gesamtanalyse aller Projekt-Snapshots mit kontextueller Bewertung.",
        "required_credentials": ["anthropic_api_key"],

    }

    def api_routes(self):
        return [{"rule": "/api/ai-project-analyze", "endpoint": "api_ai_project_analyze",
                 "handler": self._handle, "methods": ["POST"]}]

    def _handle(self):
        import json as _json
        from flask import request, jsonify, abort
        from flask_login import current_user
        from plugins.ai._llm import call_llm, increment_usage
        from models import Project, Snapshot

        guard = self._guard("project_analysis")
        if not isinstance(guard, tuple) or len(guard) != 2:
            return guard
        user_id, settings = guard

        body = request.get_json(force=True, silent=True) or {}
        project_id = body.get("project_id")
        if not project_id:
            return jsonify({"error": "project_id fehlt"}), 400

        proj = Project.query.filter_by(id=project_id, user_id=user_id).first()
        if not proj:
            abort(404)

        snaps = Snapshot.query.filter_by(project_id=project_id) \
                        .order_by(Snapshot.sort_order, Snapshot.created_at).all()
        if not snaps:
            return jsonify({"error": "Dieses Projekt enthält keine Snapshots."}), 400

        increment_usage(user_id, source="projektanalyse",
                        detail=proj.name if proj else f"Projekt #{project_id}")

        prompt = self._build_prompt(proj, snaps)
        result = call_llm(prompt, settings, max_tokens=4096)

        if not result["ok"]:
            return jsonify({"error": result["error"]}), result.get("status", 502)

        return jsonify({"ok": True, "analysis": result["text"],
                        "model": result["model"], "snap_count": len(snaps)})

    @staticmethod
    def _build_prompt(proj, snaps):
        import json as _json

        GP = {"": "Web", "news": "News", "images": "Bilder",
              "youtube": "YouTube", "froogle": "Shopping"}
        TF = {"now 1-H": "1h", "now 4-H": "4h", "now 1-d": "24h", "now 7-d": "7 Tage",
              "today 1-m": "1 Monat", "today 3-m": "3 Monate",
              "today 12-m": "12 Monate", "today 5-y": "5 Jahre"}

        lines = [
            "Du bist Teil unseres Analyse-Teams und formulierst die abschließende Gesamtbewertung "
            "eines gemeinsamen Google Trends-Projekts. Die folgenden Snapshots, Kommentare und "
            "Markierungen sind unsere eigenen Beobachtungen aus dem laufenden Projekt – "
            "nutze sie als Grundlage, bewertet und ordnet sie aber eigenständig ein. "
            "Kritische Einschätzungen sind ausdrücklich erwünscht, sofern sie aus den Daten "
            "begründbar sind. Vermeide Meta-Kommentare wie 'laut Kommentar', "
            "'die Markierungen zeigen' oder ähnliche Konstrukte, die den Text wie eine "
            "Sekundärbewertung klingen lassen – schreibe stattdessen einen stringenten, "
            "kohärenten Analysetext, dessen Schlussfolgerungen sich aus den Daten ergeben. "
            "Nutze Markdown-Formatierung: ## für Überschriften, **fett**, - für Listen. "
            "Schreibe aus der Wir-Perspektive (wir, uns, unser), ohne dabei eine "
            "vorgefertigte Meinung zu vertreten.",
            "",
            f"# Projekt: {proj.name}",
            f"Snapshots gesamt: {len(snaps)}",
            "",
        ]

        if proj.briefing and proj.briefing.strip():
            lines += ["## Projektbriefing", proj.briefing.strip(), ""]

        for i, snap in enumerate(snaps, 1):
            chart = _json.loads(snap.chart_json) if snap.chart_json else {}
            markers = _json.loads(snap.markers_json) if snap.markers_json else []

            lines += [f"## Snapshot {i}: {snap.title or '(kein Titel)'}", ""]
            if snap.created_at:
                lines.append(f"Erstellt: {snap.created_at.strftime('%d.%m.%Y %H:%M')}")

            is_analysis = chart.get("type") == "analysis"
            if is_analysis:
                atype_labels = {
                    "ssim": "Self-Similarity-Matrix",
                    "outlier": "Ausreißer-Erkennung",
                    "decomp": "Zeitreihen-Zerlegung",
                }
                atype = atype_labels.get(chart.get("analysis_type", ""),
                                         chart.get("analysis_type", "Analyse"))
                lines.append(f"Analyse-Typ: {atype}")
                if chart.get("subtitle"):
                    lines.append(f"Keyword: {chart['subtitle']}")
                params = chart.get("params", {})
                if params:
                    lines.append("Parameter: " +
                                 ", ".join(f"{k}={v}" for k, v in params.items()))
            else:
                kw_meta = chart.get("keywords_meta", [])
                if kw_meta:
                    kw_strs = []
                    for m in kw_meta:
                        geo_raw = m.get("geo", "")
                        geo_lbl = geo_raw if geo_raw else "Weltweit"
                        tf_lbl = TF.get(m.get("timeframe", ""), m.get("timeframe", ""))
                        gp_lbl = GP.get(m.get("gprop", ""), "Web")
                        kw_strs.append(
                            f"{m.get('keyword', '?')} ({geo_lbl}, {gp_lbl}, {tf_lbl})")
                    lines.append("Keywords: " + " | ".join(kw_strs))

                datasets = chart.get("datasets", [])
                labels = chart.get("labels", [])
                for ds in datasets:
                    data = ds.get("data", [])
                    if not data:
                        continue
                    if isinstance(data[0], dict):
                        vals = [p["y"] for p in data if p.get("y") is not None]
                        d0 = str(data[0].get("x", "?"))[:10]
                        d1 = str(data[-1].get("x", "?"))[:10]
                        pts = [(str(p.get("x", "?"))[:10], p["y"])
                               for p in data if p.get("y") is not None]
                    else:
                        vals = [v for v in data if v is not None]
                        d0 = str(labels[0])[:10] if labels else "?"
                        d1 = str(labels[-1])[:10] if labels else "?"
                        pts = [(str(labels[j])[:10] if j < len(labels) else str(j), v)
                               for j, v in enumerate(data) if v is not None]
                    if not vals:
                        continue
                    mn, mx = min(vals), max(vals)
                    avg = sum(vals) / len(vals)
                    third = max(1, len(vals) // 3)
                    diff = (sum(vals[-third:]) / third) - (sum(vals[:third]) / third)
                    trend_d = "steigend" if diff > 5 else "fallend" if diff < -5 else "stabil"
                    lines.append(
                        f"  '{ds.get('label', '?')}': {d0}–{d1}, "
                        f"{len(vals)} Punkte | Min={mn:.0f} Max={mx:.0f} Ø={avg:.1f} "
                        f"| Trend={trend_d}")
                    if pts:
                        hi = max(pts, key=lambda p: p[1])
                        lo = min(pts, key=lambda p: p[1])
                        lines.append(
                            f"    Peak: {hi[0]} = {hi[1]:.0f} | "
                            f"Tief: {lo[0]} = {lo[1]:.0f}")

                corrs = chart.get("correlations", [])
                if corrs:
                    lines.append("Korrelationen:")
                    for c in corrs:
                        r = c.get("r")
                        if r is not None:
                            s = "stark" if abs(r) > 0.7 else "mittel" if abs(r) > 0.3 else "schwach"
                            d = "positiv" if r >= 0 else "negativ"
                            lines.append(
                                f"  {c.get('labelA', '?')} ↔ {c.get('labelB', '?')}: "
                                f"r={r:+.3f} ({s} {d})")

            if markers:
                lines.append("Markierungen:")
                for m in markers:
                    lbl = m.get("label", "")
                    cmt = m.get("comment", "")
                    if lbl or cmt:
                        lines.append(f"  M{m.get('num', '')}: {lbl} – {cmt}")

            if snap.comment and snap.comment.strip():
                lines.append(f"Kommentar: {snap.comment.strip()}")

            lines.append("")

        lines += [
            "---",
            "Erstelle eine integrierte Gesamtbewertung mit folgenden Abschnitten. "
            "Alle unsere Beobachtungen, Kommentare und Markierungen fließen dabei "
            "als selbstverständlicher Teil unserer Analyse ein – ohne sie gesondert "
            "zu zitieren oder zu kommentieren:",
            "",
            "1. **Gesamtbild** – Welches übergeordnete Bild ergibt sich aus unserem "
            "Projekt? Was haben wir im Betrachtungszeitraum festgestellt?",
            "2. **Kernbefunde** – Was sind unsere bedeutsamsten Erkenntnisse zu "
            "Keywords, Zeiträumen und Ereignissen?",
            "3. **Muster & Dynamik** – Welche Entwicklungen und Zusammenhänge "
            "ziehen sich durch unser gesamtes Datenmaterial?",
            "4. **Schlussfolgerungen** – Was lässt sich daraus ableiten? "
            "Welche Hypothesen haben sich bestätigt oder verändert?",
            "5. **Nächste Schritte** – Worauf sollten wir uns als nächstes "
            "konzentrieren?",
        ]
        return "\n".join(lines)

PluginManager.register(ProjectAnalysisPlugin())
