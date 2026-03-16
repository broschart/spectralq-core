"""AI Plugin: Trend-Analyse + Follow-up Chat."""

import re as _re
import json as _json
import logging

from plugins import PluginManager
from plugins.ai import AIPlugin

log = logging.getLogger(__name__)

class TrendAnalysisPlugin(AIPlugin):
    plugin_id = "trend_analysis"
    meta = {
        "label": "Trend-Analyse",
        "icon_svg": '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/></svg>',
        "color": "#3b82f6",
        "description": "KI-Analyse von Trenddaten mit Follow-up-Chat für vertiefte Auswertung.",
        "required_credentials": ["anthropic_api_key"],

    }

    def api_routes(self):
        return [
            {"rule": "/api/ai-analyze", "endpoint": "api_ai_analyze",
             "handler": self._handle_analyze, "methods": ["POST"]},
            {"rule": "/api/ai-chat", "endpoint": "api_ai_chat",
             "handler": self._handle_chat, "methods": ["POST"]},
        ]

    # ── Analyze ────────────────────────────────────────────────────────────

    def _handle_analyze(self):
        from flask import request, jsonify
        from flask_login import current_user
        from plugins.ai._llm import call_llm, increment_usage

        guard = self._guard("trend_analysis")
        if not isinstance(guard, tuple) or len(guard) != 2:
            return guard
        user_id, settings = guard

        body = request.get_json(force=True, silent=True) or {}
        series = body.get("series", [])
        context = (body.get("context") or "").strip()
        mode = (body.get("mode") or "").strip()
        extras = body.get("extras") or {}
        fmt = (body.get("format") or "prose").strip()
        project_id = body.get("project_id")

        if not series:
            return jsonify({"error": "Keine Daten übermittelt."}), 400

        _mode_labels = {"ssim": "Saisonalität", "od": "Ausreißer",
                        "dc": "Cluster", "": "Trend"}
        increment_usage(user_id, source="analyse",
                        detail=f"{_mode_labels.get(mode, mode)}: "
                               f"{', '.join(s.get('keyword', '') for s in series[:3])}")

        # Projektbriefing laden
        project_briefing = ""
        if project_id:
            from models import Project
            proj = Project.query.filter_by(id=int(project_id),
                                           user_id=user_id).first()
            if proj and proj.briefing and proj.briefing.strip():
                project_briefing = proj.briefing.strip()

        prompt = self._build_analyze_prompt(series, context, mode, fmt,
                                            extras, project_briefing)

        result = call_llm(prompt, settings, max_tokens=4096)
        if not result["ok"]:
            return jsonify({"error": result["error"]}), result.get("status", 502)

        analysis = result["text"]

        # Phasen-Block aus der Antwort extrahieren
        phases = []
        phase_match = _re.search(
            r'<!--PHASES-->(.*?)<!--/PHASES-->', analysis, _re.DOTALL)
        if phase_match:
            analysis = analysis[:phase_match.start()].rstrip()
            try:
                parsed = _json.loads(phase_match.group(1).strip())
                if isinstance(parsed, list):
                    phases = parsed
            except Exception:
                pass

        from app import audit_log
        kw_summary = ", ".join(s.get("keyword", "?") for s in series[:5])
        audit_log("analysis_run", "keyword", None,
                  f"{_mode_labels.get(mode, mode)}: {kw_summary}",
                  project_id=int(project_id) if project_id else None)

        return jsonify({"ok": True, "analysis": analysis,
                        "phases": phases, "model": result["model"]})

    # ── Chat ───────────────────────────────────────────────────────────────

    def _handle_chat(self):
        from flask import request, jsonify
        from flask_login import current_user
        from plugins.ai._llm import increment_usage
        import requests as _req

        guard = self._guard("trend_analysis")
        if not isinstance(guard, tuple) or len(guard) != 2:
            return guard
        user_id, settings = guard

        body = request.get_json(force=True, silent=True) or {}
        messages = body.get("messages", [])
        analysis_ctx = (body.get("analysis_context") or "").strip()
        pipeline_log = (body.get("pipeline_log") or "").strip()
        project_id = body.get("project_id")

        if not messages:
            return jsonify({"error": "Keine Nachrichten übermittelt."}), 400

        increment_usage(user_id, source="ki-chat",
                        detail=(messages[-1].get("content", "")[:80]
                                if messages else ""))

        # Projektbriefing laden
        project_briefing = ""
        if project_id:
            from models import Project
            proj = Project.query.filter_by(id=int(project_id),
                                           user_id=user_id).first()
            if proj and proj.briefing and proj.briefing.strip():
                project_briefing = proj.briefing.strip()

        system_prompt = self._build_chat_system_prompt(
            analysis_ctx, pipeline_log, project_briefing)

        resolve = settings["resolve"]
        ai_provider = settings["ai_provider"]
        ai_model = settings["ai_model"]

        from app import _get_wz_tools, _get_wz_tools_oai, _execute_wz_tool
        _MAX_TOOL_ROUNDS = 5

        try:
            if ai_provider == "anthropic":
                api_key = resolve("anthropic_api_key",
                                  __import__("os").getenv("ANTHROPIC_API_KEY", ""))
                if not api_key:
                    return jsonify({"error": "Anthropic API-Schlüssel nicht konfiguriert."}), 503
                reply = "Keine Antwort erhalten."
                for _round in range(_MAX_TOOL_ROUNDS):
                    resp = _req.post(
                        "https://api.anthropic.com/v1/messages",
                        headers={"x-api-key": api_key,
                                 "anthropic-version": "2023-06-01",
                                 "content-type": "application/json"},
                        json={"model": ai_model, "max_tokens": 2048,
                              "system": system_prompt,
                              "messages": messages,
                              "tools": _get_wz_tools(user_id)},
                        timeout=60,
                    )
                    if not resp.ok:
                        try:
                            detail = resp.json()
                        except Exception:
                            detail = resp.text
                        msg = (detail.get("error", {}).get("message", str(detail))
                               if isinstance(detail, dict) else str(detail))
                        return jsonify({"error": f"Anthropic {resp.status_code}: {msg}"}), 502
                    result = resp.json()
                    content = result.get("content", [])
                    stop_reason = result.get("stop_reason", "end_turn")
                    tool_uses = [b for b in content
                                 if b.get("type") == "tool_use"]
                    if not tool_uses or stop_reason == "end_turn":
                        reply = "\n".join(
                            b.get("text", "") for b in content
                            if b.get("type") == "text")
                        break
                    messages.append({"role": "assistant", "content": content})
                    tool_results = []
                    for tu in tool_uses:
                        try:
                            res = _execute_wz_tool(
                                tu["name"], tu.get("input", {}), user_id)
                            tool_results.append({
                                "type": "tool_result",
                                "tool_use_id": tu["id"],
                                "content": _json.dumps(
                                    res, ensure_ascii=False)[:8000],
                            })
                        except Exception as te:
                            tool_results.append({
                                "type": "tool_result",
                                "tool_use_id": tu["id"],
                                "content": f"Fehler: {te}",
                                "is_error": True,
                            })
                    messages.append({"role": "user", "content": tool_results})
                else:
                    reply = "Maximale Tool-Iterations-Tiefe erreicht."

            elif ai_provider == "openai":
                api_key = resolve("openai_api_key", "")
                if not api_key:
                    return jsonify({"error": "OpenAI API-Schlüssel nicht konfiguriert."}), 503
                oai_messages = ([{"role": "system", "content": system_prompt}]
                                + messages)
                reply = "Keine Antwort erhalten."
                for _round in range(_MAX_TOOL_ROUNDS):
                    resp = _req.post(
                        "https://api.openai.com/v1/chat/completions",
                        headers={"Authorization": f"Bearer {api_key}",
                                 "Content-Type": "application/json"},
                        json={"model": ai_model, "max_tokens": 2048,
                              "messages": oai_messages,
                              "tools": _get_wz_tools_oai(user_id)},
                        timeout=60,
                    )
                    if not resp.ok:
                        try:
                            detail = resp.json()
                        except Exception:
                            detail = resp.text
                        msg = (detail.get("error", {}).get("message", str(detail))
                               if isinstance(detail, dict) else str(detail))
                        return jsonify({"error": f"OpenAI {resp.status_code}: {msg}"}), 502
                    choice = resp.json()["choices"][0]
                    msg_obj = choice["message"]
                    finish = choice.get("finish_reason", "stop")
                    tool_calls = msg_obj.get("tool_calls") or []
                    if not tool_calls or finish == "stop":
                        reply = msg_obj.get("content") or ""
                        break
                    oai_messages.append(msg_obj)
                    for tc in tool_calls:
                        fn = tc["function"]
                        try:
                            inp = _json.loads(fn.get("arguments", "{}"))
                            res = _execute_wz_tool(
                                fn["name"], inp, user_id)
                            oai_messages.append({
                                "role": "tool",
                                "tool_call_id": tc["id"],
                                "content": _json.dumps(
                                    res, ensure_ascii=False)[:8000],
                            })
                        except Exception as te:
                            oai_messages.append({
                                "role": "tool",
                                "tool_call_id": tc["id"],
                                "content": f"Fehler: {te}",
                            })
                else:
                    reply = "Maximale Tool-Iterations-Tiefe erreicht."

            elif ai_provider == "gemini":
                api_key = resolve("gemini_api_key", "")
                if not api_key:
                    return jsonify({"error": "Gemini API-Schlüssel nicht konfiguriert."}), 503
                gemini_contents = [
                    {"role": "user",
                     "parts": [{"text": system_prompt}]},
                    {"role": "model",
                     "parts": [{"text": "Verstanden. Ich stehe für Fragen zur Analyse bereit."}]},
                ]
                for m in messages:
                    gemini_contents.append({
                        "role": "user" if m["role"] == "user" else "model",
                        "parts": [{"text": m["content"]}],
                    })
                resp = _req.post(
                    f"https://generativelanguage.googleapis.com/v1beta/models/"
                    f"{ai_model}:generateContent?key={api_key}",
                    headers={"Content-Type": "application/json"},
                    json={"contents": gemini_contents,
                          "generationConfig": {"maxOutputTokens": 2048}},
                    timeout=60,
                )
                if not resp.ok:
                    return jsonify({"error": f"Gemini {resp.status_code}"}), 502
                reply = (resp.json()["candidates"][0]["content"]
                         ["parts"][0]["text"])

            elif ai_provider == "mistral":
                api_key = resolve("mistral_api_key", "")
                if not api_key:
                    return jsonify({"error": "Mistral API-Schlüssel nicht konfiguriert."}), 503
                resp = _req.post(
                    "https://api.mistral.ai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {api_key}",
                             "Content-Type": "application/json"},
                    json={"model": ai_model, "max_tokens": 2048,
                          "messages": ([{"role": "system",
                                         "content": system_prompt}]
                                       + messages)},
                    timeout=60,
                )
                if not resp.ok:
                    try:
                        detail = resp.json()
                    except Exception:
                        detail = resp.text
                    msg = (detail.get("error", {}).get("message", str(detail))
                           if isinstance(detail, dict) else str(detail))
                    return jsonify({"error": f"Mistral {resp.status_code}: {msg}"}), 502
                reply = resp.json()["choices"][0]["message"]["content"]

            else:
                return jsonify({"error": f"Unbekannter Anbieter: {ai_provider}"}), 400

            return jsonify({"ok": True, "reply": reply,
                            "model": f"{ai_provider}/{ai_model}"})

        except Exception as exc:
            log.error("ai-chat Fehler: %s", exc)
            return jsonify({"error": str(exc)}), 500

    # ── Prompt builders ────────────────────────────────────────────────────

    @staticmethod
    def _build_analyze_prompt(series, context, mode, fmt, extras,
                              project_briefing):
        """Builds the full analysis prompt including all mode-specific blocks."""
        GP = {"": "Web", "news": "News", "images": "Bilder",
              "youtube": "YouTube", "froogle": "Shopping"}

        if fmt == "prose":
            lines = [
                "Du bist ein Experte für Google Trends-Analyse. "
                "Analysiere die folgenden Zeitreihendaten und erstelle eine Bewertung auf Deutsch "
                "als zusammenhängenden Fließtext. "
                "WICHTIG: Verwende KEINERLEI Markdown-Formatierung – keine **, keine #, keine Bindestriche "
                "als Listenpunkte, keine Tabellen. "
                "Strukturiere den Text durch sinnvolle Absatzwechsel (Leerzeile zwischen thematischen Blöcken). "
                "Leite jeden thematischen Abschnitt mit einem kurzen, klaren Titel als eigenständiger Zeile ein, "
                "gefolgt von einem Absatz Fließtext. "
                "Schreibe natürlich und verständlich – auch für Leser ohne Statistikkenntnisse.",
                "",
            ]
        else:
            lines = [
                "Du bist ein Experte für Google Trends-Analyse. "
                "Analysiere die folgenden Zeitreihendaten und erstelle eine strukturierte "
                "Bewertung auf Deutsch. "
                "Nutze Markdown-Formatierung: ## für Überschriften, **fett**, - für Listen. "
                "Für tabellarische Daten nutze Markdown-Tabellen im Format | Spalte | Spalte | "
                "mit Trennzeile |---|---|. "
                "Verwende KEINE reinen Pipe-Zeichen (|) oder Bindestriche außerhalb von Tabellen oder Listen.",
                "",
            ]
        if context:
            lines += [f"> **Parameter:** {context}", ""]
        if project_briefing:
            lines += ["## Projektbriefing", project_briefing, ""]

        lines += [
            "## PFLICHTFORMAT AM ENDE DER ANTWORT",
            "Füge am Ende deiner Antwort — nach dem letzten Analyseabschnitt — exakt diesen Block an:",
            "",
            "<!--PHASES-->",
            '[{"label":"Phase 1: Name","start":"YYYY-MM-DD","end":"YYYY-MM-DD","description":"1 Satz"}]',
            "<!--/PHASES-->",
            "",
            "Regeln für den Phasen-Block:",
            "- 2–5 sinnvolle Phasen, orientiert an erkennbaren Veränderungen im Trendverlauf",
            "- start/end im Format YYYY-MM-DD",
            "- Prognose-Phasen mit end-Datum nach dem letzten Datenpunkt sind erlaubt, wenn sinnvoll",
            "- Falls keine sinnvollen Phasen erkennbar sind: <!--PHASES-->[]<!--/PHASES-->",
            "- Der Block darf NUR gültiges JSON enthalten, keine anderen Zeichen außerhalb der eckigen Klammern",
            "",
        ]

        for s in series:
            data = s.get("data", [])
            vals = [p["value"] for p in data if p.get("value") is not None]
            kw = s.get("keyword", "?")
            geo_raw = s.get("geo")
            geo = geo_raw if geo_raw is not None else "DE"
            geo_lbl = geo if geo else "Weltweit"
            gp = GP.get(s.get("gprop", ""), "Web")
            rt = s.get("run_tag", "")
            d0 = data[0]["date"][:10] if data else "?"
            d1 = data[-1]["date"][:10] if data else "?"
            mn, mx = (min(vals), max(vals)) if vals else (0, 0)
            avg = sum(vals) / len(vals) if vals else 0

            lines.append(f"## {kw} ({geo_lbl}, {gp})")
            if rt:
                lines.append(f"Reihe: {rt}")
            lines.append(
                f"Zeitraum: {d0} – {d1} | "
                f"{len(data)} Datenpunkte | Min={mn} Max={mx} Ø={avg:.1f}"
            )
            lines.append("")
            lines.append("Datum,Wert")
            step = max(1, len(data) // 160)
            for p in data[::step]:
                lines.append(f"{p['date'][:10]},{p.get('value', '')}")
            lines.append("")

        lines.append("---")
        lines.append("Bitte erstelle folgende Analyse:")

        # Abschnittstitel je nach Format
        def T(label):
            return label if fmt == "prose" else f"**{label}**"

        # Helper: multi-keyword relationship block
        def _multi_kw_block(n, mode_hint=""):
            kw_list = ", ".join(
                f"{s.get('keyword', '?')} "
                f"({'Weltweit' if s.get('geo') == '' else (s.get('geo') or 'DE')})"
                for s in series
            )
            base = (
                f"{n}. {T('Datenquellen & Verhältnisse')} – "
                f"Es liegen {len(series)} Keyword-Reihen vor: {kw_list}. "
                f"Bewerte kurz das Verhältnis dieser Datenquellen zueinander: "
            )
            if mode_hint == "ssim":
                detail = (
                    f"Zeigen die Self-Similarity-Muster aller Keywords ähnliche Strukturen oder unterschiedliche? "
                    f"Gibt es gemeinsame Strukturbrüche oder Saisonmuster, die auf einen geteilten Treiber hindeuten? "
                )
            elif mode_hint == "od":
                detail = (
                    f"Treten Ausreißer bei mehreren Keywords gleichzeitig auf (gemeinsamer externer Trigger) "
                    f"oder isoliert (keyword-spezifisches Ereignis)? Welche Reihe ist volatiler? "
                )
            elif mode_hint == "dc":
                detail = (
                    f"Verlaufen die Trendkomponenten gleichgerichtet oder gegenläufig? "
                    f"Sind die Saisonalmuster bei allen Keywords identisch oder zeitlich verschoben? "
                    f"Welche Reihe könnte ein Leitindikator für die anderen sein? "
                )
            elif mode_hint == "cpd":
                detail = (
                    f"Treten Strukturbrüche bei mehreren Keywords gleichzeitig auf (gemeinsamer externer Auslöser) "
                    f"oder versetzt (sequenzielle Reaktion)? Welche Reihe reagiert als erste? "
                )
            elif mode_hint == "spike_coin":
                detail = (
                    f"In welchem Ausmaß spiken die Keywords gleichzeitig? "
                    f"Gibt es Keywords, die bei Koinzidenzen systematisch stärker ausschlagen als andere? "
                )
            elif mode_hint == "rc":
                detail = (
                    f"Welche Keyword-Paare zeigen die stärkste zeitliche Korrelation? "
                    f"Gibt es Paare mit wechselnder Korrelation (phasenweise positiv, dann negativ)? "
                )
            elif mode_hint == "fc":
                detail = (
                    f"Zeigen die Prognosen der verschiedenen Keywords in dieselbe Richtung? "
                    f"Gibt es Keywords, deren Prognose gegenläufig ist? "
                )
            elif mode_hint == "gc":
                detail = (
                    f"Bilden die Granger-kausalen Beziehungen eine Kette (A→B→C) oder ein Netzwerk? "
                    f"Gibt es ein Keyword, das besonders viele andere Granger-verursacht (Hub)? "
                )
            elif mode_hint == "cluster":
                detail = (
                    f"Bilden die verwandten Suchanfragen thematisch kohärente Cluster? "
                    f"Entwickeln sich bestimmte Cluster zeitlich parallel oder gegenläufig? "
                )
            elif mode_hint == "ra":
                detail = (
                    f"Zeigen die parallelen Abruf-Reihen konsistente Werte oder gibt es systematische Abweichungen, "
                    f"die auf Sampling-Artefakte oder Normalisierungsprobleme bei Google Trends hindeuten? "
                )
            elif mode_hint == "pf":
                detail = (
                    f"Welche der identifizierten Frequenzen sind technische Sampling-Artefakte "
                    f"und welche repräsentieren echtes Nutzerverhalten? "
                )
            else:
                detail = (
                    f"Laufen die Zeitreihen parallel (korreliert), zeitversetzt oder gegenläufig? "
                    f"Gibt es Phasen erhöhter Gemeinsamkeit und Phasen der Divergenz? "
                )
            suffix = (
                f"Gibt es erkennbare Abhängigkeiten oder gemeinsame externe Treiber? "
                f"Wie beeinflusst das die Interpretierbarkeit: Messen die Reihen dasselbe Phänomen "
                f"aus verschiedenen Blickwinkeln, oder handelt es sich um inhaltlich unabhängige Signale?"
            )
            return base + detail + suffix

        # ── Mode-specific analysis instructions ──

        if mode == "ssim":
            lines += [
                f"Diese Analyse basiert auf einer Self-Similarity-Matrix. "
                f"Erkläre die Ergebnisse auch für Anwender ohne Statistikkenntnisse verständlich.",
                f"1. {T('Fazit')} – 3–5 Sätze: Was zeigt die Matrix insgesamt? "
                f"Welche Schlüsselerkenntnisse lassen sich ableiten?",
                f"2. {T('Was ist eine Self-Similarity-Matrix?')} – Erkläre kurz und allgemeinverständlich: "
                f"Wie entsteht die Matrix? Was bedeuten helle vs. dunkle Bereiche? Wie liest man sie?",
                f"3. {T('Erkannte Strukturen')} – Blöcke hoher Ähnlichkeit (stabile Phasen), "
                f"diagonale Streifen (Periodenwiederholungen), plötzliche Farbwechsel (Verhaltensänderungen)",
                f"4. {T('Saisonalität & Zyklen')} – Hinweise auf wiederkehrende Muster? "
                f"In welchem Rhythmus (wöchentlich, monatlich, jährlich)?",
                f"5. {T('Strukturbrüche')} – Zeitpunkte, an denen sich das Verhaltensmuster "
                f"fundamental ändert? Was könnte das bedeuten?",
                f"6. {T('Nachrichtenbezug')} – Welche bekannten Ereignisse oder gesellschaftliche Entwicklungen "
                f"könnten die erkannten Muster oder Brüche im betreffenden Zeitraum erklären?",
            ]
            n = 7
            if len(series) > 1:
                lines.append(_multi_kw_block(n, "ssim"))
                n += 1
            lines.append(f"{n}. {T('Handlungsempfehlungen')} – Was bedeutet das konkret für den Anwender?")
        elif mode == "od":
            lines += [
                f"Diese Analyse basiert auf einer Ausreißer-Erkennung. "
                f"Erkläre die Ergebnisse auch für Anwender ohne Statistikkenntnisse verständlich.",
                f"1. {T('Fazit')} – 3–5 Sätze: Wie viele und welche Art von Ausreißern wurden gefunden? "
                f"Was bedeuten sie im Gesamtbild?",
                f"2. {T('Was ist Ausreißer-Erkennung?')} – Kurz und allgemeinverständlich: "
                f"Was ist ein statistischer Ausreißer? Was misst Z-Score und IQR? "
                f"Ab wann gilt ein Wert als auffällig?",
                f"3. {T('Gefundene Ausreißer')} – Analysiere die auffälligsten Datenpunkte: "
                f"Datum, Richtung (ungewöhnlich hoch oder niedrig), Magnitude des Ausschlags",
                f"4. {T('Wahrscheinliche Ursachen')} – Welche realen Ereignisse, saisonale Anlässe "
                f"oder externe Faktoren könnten diese Ausreißer erklären?",
                f"5. {T('Nachrichtenbezug')} – Verknüpfe die Ausreißer-Zeitpunkte mit bekannten "
                f"Nachrichten, Kampagnen oder gesellschaftlichen Entwicklungen aus dem betreffenden Zeitraum",
                f"6. {T('Bewertung der Relevanz')} – Sind die Ausreißer inhaltlich bedeutsam "
                f"(echtes Signal) oder eher statistisches Rauschen?",
            ]
            n = 7
            if len(series) > 1:
                lines.append(_multi_kw_block(n, "od"))
                n += 1
            lines.append(f"{n}. {T('Handlungsempfehlungen')} – Wie sollte der Anwender mit diesen Ausreißern umgehen?")
        elif mode == "dc":
            lines += [
                f"Diese Analyse basiert auf einer Zeitreihen-Zerlegung. "
                f"Erkläre die Ergebnisse auch für Anwender ohne Statistikkenntnisse verständlich.",
                f"1. {T('Fazit')} – 3–5 Sätze: Was zeigt die Zerlegung insgesamt? "
                f"Dominiert Trend, Saisonalität oder Rauschen?",
                f"2. {T('Was ist Zeitreihen-Zerlegung?')} – Kurz und allgemeinverständlich: "
                f"Was bedeuten Trend, Saisonalität und Residuen? "
                f"Unterschied additiv (T+S+R) vs. multiplikativ (T×S×R)?",
                f"3. {T('Trendkomponente')} – Langfristiger Verlauf: "
                f"Wachstum, Stagnation oder Rückgang? Gibt es Wendepunkte?",
                f"4. {T('Saisonale Komponente')} – Wie stark ist die Saisonalität ausgeprägt? "
                f"In welchem Rhythmus? Ist das Muster stabil?",
                f"5. {T('Residuen')} – Was zeigen die Reste? "
                f"Auffällige Cluster oder Einzelwerte deuten auf externe Ereignisse hin.",
                f"6. {T('Nachrichtenbezug')} – Welche bekannten Ereignisse könnten Trendbrüche "
                f"oder ungewöhnliche Residual-Peaks im betreffenden Zeitraum erklären?",
            ]
            n = 7
            if len(series) > 1:
                lines.append(_multi_kw_block(n, "dc"))
                n += 1
            lines.append(f"{n}. {T('Handlungsempfehlungen')} – Was bedeuten die Zerlegungskomponenten "
                         f"für Prognosen und zukünftige Entscheidungen?")
        elif mode == "cpd":
            lines += [
                f"Diese Analyse basiert auf einer Change-Point-Detection (Strukturbrucherkennung). "
                f"Erkläre die Ergebnisse auch für Anwender ohne Statistikkenntnisse verständlich.",
                f"1. {T('Fazit')} – 3–5 Sätze: Wie viele Strukturbrüche wurden erkannt? "
                f"Was bedeuten sie im Gesamtbild der Zeitreihe?",
                f"2. {T('Was ist Change-Point-Detection?')} – Kurz und allgemeinverständlich: "
                f"Was sind Changepoints/Strukturbrüche? Wie erkennt der Algorithmus, "
                f"dass sich das Verhalten einer Zeitreihe fundamental verändert hat? "
                f"Was bedeuten Penalty und Segmentlänge?",
                f"3. {T('Erkannte Strukturbrüche')} – Analysiere jeden gefundenen Changepoint: "
                f"Datum, Richtung (Anstieg/Abfall), Magnitude der Veränderung, "
                f"Mittelwert vor und nach dem Bruch. Welche Brüche sind am bedeutsamsten?",
                f"4. {T('Zeitliche Einordnung & Ursachenanalyse')} – Welche realen Ereignisse, "
                f"Nachrichten, politischen Entscheidungen oder gesellschaftlichen Entwicklungen "
                f"könnten die Strukturbrüche ausgelöst haben? Prüfe für jeden Changepoint "
                f"den zeitlichen Kontext.",
                f"5. {T('Segmentcharakteristik')} – Beschreibe die Phasen zwischen den Changepoints: "
                f"Sind sie stabil, volatil, steigend oder fallend? Wie unterscheiden sich "
                f"die Segmente voneinander?",
                f"6. {T('Nachrichtenbezug')} – Verknüpfe die Changepoints mit konkreten bekannten "
                f"Nachrichtenereignissen aus dem betreffenden Zeitraum. "
                f"Gab es Kampagnen, Krisen oder Trendwechsel, die die Brüche erklären?",
            ]
            n = 7
            if len(series) > 1:
                lines.append(_multi_kw_block(n, "cpd"))
                n += 1
            lines.append(f"{n}. {T('Handlungsempfehlungen')} – Was bedeuten die Strukturbrüche "
                         f"für Monitoring, Strategie und zukünftige Beobachtung?")
        elif mode == "spike_coin":
            lines += [
                f"Diese Analyse basiert auf einer Spike-Koinzidenz-Erkennung (Koordinationserkennung). "
                f"Erkläre die Ergebnisse auch für Anwender ohne Statistikkenntnisse verständlich.",
                f"1. {T('Fazit')} – 3–5 Sätze: Wie viele koordinierte Spikes wurden erkannt? "
                f"Deuten sie auf gemeinsame externe Treiber oder koordiniertes Verhalten hin?",
                f"2. {T('Was ist Spike-Koinzidenz?')} – Kurz und allgemeinverständlich: "
                f"Was bedeutet es, wenn mehrere Keywords gleichzeitig Spikes zeigen? "
                f"Was sind Z-Scores und warum sind gleichzeitige Ausschläge auffällig?",
                f"3. {T('Erkannte Koinzidenzen')} – Analysiere die auffälligsten Zeitpunkte: "
                f"Datum, beteiligte Keywords, Stärke der Ausschläge (Z-Scores). "
                f"Welche Koinzidenzen sind am stärksten?",
                f"4. {T('Ursachenanalyse')} – Welche realen Ereignisse könnten die gleichzeitigen "
                f"Spikes ausgelöst haben? Handelt es sich um ein gemeinsames Medienereignis, "
                f"eine Kampagne oder einen externen Schock?",
                f"5. {T('Koordinationsbewertung')} – Wie wahrscheinlich ist es, dass die "
                f"gleichzeitigen Spikes zufällig auftreten? Gibt es Hinweise auf koordinierte "
                f"Suchaktivitäten oder gemeinsame Informationsquellen?",
                f"6. {T('Nachrichtenbezug')} – Verknüpfe die Koinzidenz-Zeitpunkte mit konkreten "
                f"Nachrichtenereignissen oder gesellschaftlichen Entwicklungen.",
            ]
            n = 7
            if len(series) > 1:
                lines.append(_multi_kw_block(n, "spike_coin"))
                n += 1
            lines.append(f"{n}. {T('Handlungsempfehlungen')} – Welche Schlüsse lassen sich "
                         f"aus den Koinzidenzen ziehen? Was sollte weiter beobachtet werden?")
        elif mode == "rc":
            lines += [
                f"Diese Analyse basiert auf einer Rolling Correlation (gleitende Korrelation). "
                f"Erkläre die Ergebnisse auch für Anwender ohne Statistikkenntnisse verständlich.",
                f"1. {T('Fazit')} – 3–5 Sätze: Wie entwickelt sich die Korrelation zwischen den "
                f"Keywords über die Zeit? Gibt es ein dominantes Muster?",
                f"2. {T('Was ist Rolling Correlation?')} – Kurz und allgemeinverständlich: "
                f"Was misst Pearson-Korrelation? Warum ist eine gleitende Berechnung "
                f"aussagekräftiger als ein einzelner Wert? Was bedeuten Werte nahe +1, 0, -1?",
                f"3. {T('Erkannte Phasen')} – Analysiere die wichtigsten Korrelationsphasen: "
                f"Zeiträume hoher positiver Korrelation (Keywords bewegen sich gemeinsam), "
                f"negativer Korrelation (gegenläufig), und Phasen ohne Zusammenhang.",
                f"4. {T('Phasenwechsel & Wendepunkte')} – Wann und warum ändert sich die "
                f"Korrelation abrupt? Was könnte diese Wechsel ausgelöst haben? "
                f"Gibt es Parallelen zu Nachrichtenereignissen?",
                f"5. {T('Forensische Bewertung')} – Was sagen die Korrelationsmuster über den "
                f"Zusammenhang der Keywords aus? Messen sie dasselbe Phänomen, reagieren sie "
                f"auf gemeinsame externe Treiber, oder sind sie inhaltlich unabhängig?",
                f"6. {T('Nachrichtenbezug')} – Verknüpfe Phasen hoher/niedriger Korrelation "
                f"mit realen Ereignissen, Kampagnen oder gesellschaftlichen Entwicklungen.",
            ]
            n = 7
            if len(series) > 1:
                lines.append(_multi_kw_block(n, "rc"))
                n += 1
            lines.append(f"{n}. {T('Handlungsempfehlungen')} – Was bedeuten die Korrelationsmuster "
                         f"für Monitoring und Interpretation der Keywords?")
        elif mode == "fc":
            lines += [
                f"Diese Analyse basiert auf einer Zeitreihen-Prognose (Forecasting). "
                f"Erkläre die Ergebnisse auch für Anwender ohne Statistikkenntnisse verständlich.",
                f"1. {T('Fazit')} – 3–5 Sätze: Was prognostiziert das Modell? "
                f"Steigt, fällt oder stagniert das Suchinteresse? Wie sicher ist die Prognose?",
                f"2. {T('Was ist Forecasting?')} – Kurz und allgemeinverständlich: "
                f"Wie funktioniert das verwendete Modell (Prophet bzw. ARIMA)? "
                f"Was bedeutet das Konfidenzintervall? Wo liegen die Grenzen der Prognose?",
                f"3. {T('Prognose-Ergebnis')} – Analysiere den prognostizierten Verlauf: "
                f"Richtung, Stärke der Veränderung, Breite des Konfidenzintervalls. "
                f"Wird die Prognose im Zeitverlauf unsicherer?",
                f"4. {T('Historischer Kontext')} – Wie fügt sich die Prognose in den bisherigen "
                f"Verlauf ein? Ist der prognostizierte Trend eine Fortsetzung oder ein Bruch?",
                f"5. {T('Einflussfaktoren')} – Welche bekannten oder absehbaren Ereignisse "
                f"könnten die Prognose bestätigen oder entkräften? Saisonale Effekte, "
                f"geplante Events, gesellschaftliche Trends?",
                f"6. {T('Nachrichtenbezug')} – Welche aktuellen oder erwartbaren Entwicklungen "
                f"könnten den prognostizierten Trend beeinflussen?",
            ]
            n = 7
            if len(series) > 1:
                lines.append(_multi_kw_block(n, "fc"))
                n += 1
            lines.append(f"{n}. {T('Handlungsempfehlungen')} – Wie sollte der Anwender die Prognose "
                         f"nutzen? Wann sollte sie aktualisiert werden?")
        elif mode == "gc":
            lines += [
                f"Diese Analyse basiert auf einem Granger-Kausalitätstest. "
                f"Erkläre die Ergebnisse auch für Anwender ohne Statistikkenntnisse verständlich.",
                f"1. {T('Fazit')} – 3–5 Sätze: Welche kausalen Beziehungen wurden gefunden? "
                f"Welches Keyword treibt welches? Gibt es bidirektionale Beziehungen?",
                f"2. {T('Was ist Granger-Kausalität?')} – Kurz und allgemeinverständlich: "
                f"Was testet der Granger-Test? Was bedeutet es, wenn A B 'Granger-verursacht'? "
                f"Wichtig: Granger-Kausalität ≠ echte Kausalität. Was misst der F-Test, was bedeutet der p-Wert?",
                f"3. {T('Signifikante Beziehungen')} – Analysiere alle signifikanten Ergebnisse (p < 0.05): "
                f"Richtung, optimaler Lag, Stärke des Effekts. "
                f"Welche Beziehung ist am stärksten?",
                f"4. {T('Zeitliche Verzögerung (Lag)')} – Was bedeuten die gefundenen Lags inhaltlich? "
                f"Ein Lag von 3 bei täglichen Daten = 3 Tage Vorlauf. "
                f"Ist das plausibel für die jeweiligen Keywords?",
                f"5. {T('Forensische Interpretation')} – Was sagen die Granger-Beziehungen "
                f"über die Dynamik zwischen den Suchbegriffen? Gibt es Hinweise auf gemeinsame "
                f"Informationsquellen, Medienkaskaden oder koordiniertes Verhalten?",
                f"6. {T('Nachrichtenbezug')} – Welche realen Zusammenhänge oder Mechanismen "
                f"könnten die gefundenen Granger-kausalen Beziehungen erklären?",
            ]
            n = 7
            if len(series) > 1:
                lines.append(_multi_kw_block(n, "gc"))
                n += 1
            lines.append(f"{n}. {T('Handlungsempfehlungen')} – Wie können die Granger-Beziehungen "
                         f"für Monitoring und Frühwarnung genutzt werden?")
        elif mode == "pf":
            lines += [
                f"Diese Analyse basiert auf einer Fourier-Spektralanalyse (FFT) zur Identifikation "
                f"periodischer Muster in Google-Trends-Daten. "
                f"Erkläre die Ergebnisse auch für Anwender ohne Statistikkenntnisse verständlich.",
                f"1. {T('Fazit')} – 3–5 Sätze: Welche periodischen Muster existieren? "
                f"Welche sind technische Artefakte, welche echtes Nutzerverhalten?",
                f"2. {T('Was ist Fourier-Analyse?')} – Kurz und allgemeinverständlich: "
                f"Was misst die FFT? Was bedeuten Frequenz, Periode und Power-Spektrum?",
                f"3. {T('Technische Artefakte')} – Google Trends hat bekannte Sampling-Zyklen "
                f"(7-Tage, ggf. Tageszyklen). Erkläre warum diese auftreten und warum sie "
                f"keine echten Verhaltensmuster darstellen.",
                f"4. {T('Echte Periodizitäten')} – Welche der nicht-technischen Frequenzen "
                f"könnten reale Muster sein (saisonale Zyklen, Nachrichtenrhythmen)?",
                f"5. {T('Filter-Empfehlung')} – Welche Frequenzen sollten gefiltert werden "
                f"und welche sollten erhalten bleiben? Was ändert sich an der Interpretation "
                f"nach dem Filtern?",
                f"6. {T('Nachrichtenbezug')} – Gibt es Periodizitäten, die auf wiederkehrende "
                f"Medienereignisse, Kampagnen oder saisonale Anlässe hindeuten?",
            ]
            n = 7
            lines.append(f"{n}. {T('Handlungsempfehlungen')} – Wie verbessert der Periodizitäts-Filter "
                         f"die Aussagekraft nachfolgender Analysen (Korrelation, Forecasting)?")
        elif mode == "ra":
            lines += [
                f"Diese Analyse vergleicht parallele Abruf-Reihen (identische Abfrage, verschiedene Zeitpunkte) "
                f"desselben Keywords, um Google-Trends-Sampling-Artefakte und Normalisierungseffekte zu identifizieren. "
                f"Erkläre die Ergebnisse auch für Anwender ohne Statistikkenntnisse verständlich.",
                f"1. {T('Fazit')} – 3–5 Sätze: Sind die parallelen Reihen konsistent oder gibt es "
                f"signifikante Abweichungen? Wie zuverlässig sind die Daten insgesamt?",
                f"2. {T('Was sind Sampling-Artefakte?')} – Kurz und allgemeinverständlich: "
                f"Warum liefert Google Trends bei identischer Abfrage unterschiedliche Werte? "
                f"Was bedeutet Normalisierung auf 0–100?",
                f"3. {T('Abweichungsanalyse')} – Wo weichen die Reihen am stärksten voneinander ab? "
                f"Sind die Abweichungen gleichmäßig verteilt oder konzentriert auf bestimmte Zeiträume? "
                f"Betreffen sie Spitzenwerte, Trendumkehrpunkte oder flache Phasen?",
                f"4. {T('Artefakt-Klassifikation')} – Welche Abweichungen sind typische "
                f"Sampling-Artefakte (zufällige Normalisierungsschwankungen) und welche könnten "
                f"auf echte Datenänderungen hindeuten (z.B. nachträgliche Korrekturen durch Google)?",
                f"5. {T('Datenqualität')} – Bewerte die Gesamtqualität der Datenbasis: "
                f"Mittlere Abweichung, maximale Ausreißer, betroffene Zeiträume. "
                f"Welche Reihe ist am repräsentativsten?",
                f"6. {T('Nachrichtenbezug')} – Fallen die stärksten Abweichungen mit bekannten "
                f"Ereignissen oder Google-Algorithmus-Änderungen zusammen?",
            ]
            n = 7
            lines.append(f"{n}. {T('Handlungsempfehlungen')} – Welche Reihe sollte für weitere Analysen "
                         f"bevorzugt werden? Sollten die Reihen gemittelt werden? "
                         f"Welche Datenpunkte sollten mit Vorsicht interpretiert werden?")
        elif mode == "cluster":
            lines += [
                f"Diese Analyse basiert auf einer Cluster-Analyse verwandter Suchanfragen. "
                f"Erkläre die Ergebnisse auch für Anwender ohne Statistikkenntnisse verständlich.",
                f"1. {T('Fazit')} – 3–5 Sätze: Welche thematischen Cluster existieren? "
                f"Welche Cluster zeigen die auffälligsten Veränderungen im Zeitverlauf?",
                f"2. {T('Was ist eine Cluster-Analyse?')} – Kurz und allgemeinverständlich: "
                f"Was sind thematische Cluster verwandter Suchanfragen und warum sind sie aufschlussreich?",
                f"3. {T('Identifizierte Cluster')} – Liste aller erkannten Cluster: "
                f"Name, enthaltene Queries, kurze Beschreibung des gemeinsamen Themas.",
                f"4. {T('Zeitliche Entwicklung')} – Wie haben sich die Cluster im Zeitverlauf verändert? "
                f"Neue Cluster, wachsende Cluster, schrumpfende/verschwindende Cluster. "
                f"Breakout-Queries besonders hervorheben.",
                f"5. {T('Forensische Interpretation')} – Was verraten die Cluster-Muster "
                f"über das Suchverhalten? Hinweise auf Ereignisse, Kampagnen oder Trendwechsel?",
                f"6. {T('Nachrichtenbezug')} – Welche realen Ereignisse könnten "
                f"die beobachteten Cluster-Verschiebungen erklären?",
            ]
            n = 7
            if len(series) > 1:
                lines.append(_multi_kw_block(n, "cluster"))
                n += 1
            lines.append(f"{n}. {T('Handlungsempfehlungen')} – Welche Cluster verdienen "
                         f"besonderes Monitoring? Welche aufkommenden Themen könnten relevant werden?")
        else:
            lines += [
                f"1. {T('Fazit')} – 3–5 Sätze, die die wichtigsten Erkenntnisse "
                f"kompakt zusammenfassen (Gesamtbild, auffällige Entwicklungen, wichtigste Empfehlung). "
                f"Gehe dabei auf mögliche aktuelle Ereignisse oder Nachrichtenlage ein.",
                f"2. {T('Gesamttrend')} je Keyword (steigend / fallend / stabil / volatil)",
                f"3. {T('Peaks & Ausreißer')} – herausragende Datenpunkte mit Datum und möglicher Ursache; "
                f"versuche, Ausreißer mit realen Nachrichten oder saisonalen Anlässen in Verbindung zu bringen",
                f"4. {T('Saisonalität')} – wiederkehrende Muster, Wochentags- oder Jahresrhythmen",
                f"5. {T('Nachrichtenbezug')} – welche bekannten Ereignisse, Nachrichten oder "
                f"gesellschaftlichen Entwicklungen könnten die Trendverläufe erklären?",
            ]
            n = 6
            if len(series) > 1:
                lines.append(_multi_kw_block(n, ""))
                n += 1
            lines.append(f"{n}. {T('Handlungsempfehlungen')} – konkrete nächste Schritte")

        # ── Extras: berechnete Analyseergebnisse anhängen ─────────────
        lines.append("")
        lines.append("---")
        lines.append("## Zusätzliche Analysedaten")

        # Methoden-spezifische Ergebnisse
        if mode == "ssim" and extras.get("ssim"):
            ssim_ex = extras["ssim"]
            lines.append("")
            lines.append("### Self-Similarity-Matrix – Berechnete Kennzahlen")
            lines.append(f"Metrik: {ssim_ex.get('metric', '?')} | "
                         f"Globale mittlere Ähnlichkeit: {ssim_ex.get('mean_sim', '?')}")
            if ssim_ex.get("breaks"):
                lines.append("Zeitpunkte mit niedrigster Ähnlichkeit (mögliche Strukturbrüche):")
                for b in ssim_ex["breaks"]:
                    lines.append(f"  {b['date']}: Ähnlichkeit={b['sim']}")
            if ssim_ex.get("profile"):
                lines.append("Ähnlichkeitsprofil (Datum, Ø-Ähnlichkeit zu allen anderen Zeitpunkten):")
                lines.append("Datum,Ähnlichkeit")
                for p in ssim_ex["profile"]:
                    lines.append(f"{p['date']},{p['sim']}")

        elif mode == "od" and extras.get("od"):
            od_ex = extras["od"]
            outliers = od_ex.get("outliers", [])
            lines.append("")
            lines.append(f"### Ausreißer-Erkennung – {len(outliers)} erkannte Ausreißer")
            if outliers:
                lines.append("Datum | Wert | Richtung | Abweichung")
                for o in outliers:
                    lines.append(f"  {o['date']}: Wert={o['value']}, {o['dir']}, "
                                 f"Abweichung={o['dev']}{o['unit']}")
            else:
                lines.append("Kein Ausreißer gefunden.")

        elif mode == "dc" and extras.get("dc"):
            dc_ex = extras["dc"]
            t = dc_ex.get("trend", {})
            lines.append("")
            lines.append("### Zeitreihen-Zerlegung – Berechnete Komponenten")
            if t:
                lines.append(f"Trend: {t.get('start', {}).get('date', '?')} "
                             f"({t.get('start', {}).get('value', '?')}) → "
                             f"{t.get('end', {}).get('date', '?')} "
                             f"({t.get('end', {}).get('value', '?')}) | "
                             f"Richtung: {t.get('direction', '?')}")
                lines.append(f"Trend-Min: {t.get('min', {}).get('value', '?')} "
                             f"am {t.get('min', {}).get('date', '?')} | "
                             f"Trend-Max: {t.get('max', {}).get('value', '?')} "
                             f"am {t.get('max', {}).get('date', '?')}")
            lines.append(f"Saisonale Amplitude: {dc_ex.get('seasonal_amplitude', '?')}")
            if dc_ex.get("top_residuals"):
                lines.append("Größte Residuen (Datum, Wert):")
                for r in dc_ex["top_residuals"]:
                    lines.append(f"  {r['date']}: {r['value']}")

        elif mode == "cpd" and extras.get("changepoints"):
            cps = extras["changepoints"]
            lines.append("")
            lines.append(f"### Change-Point-Detection – {len(cps)} erkannte Strukturbrüche")
            lines.append("Die folgenden Changepoints wurden algorithmisch erkannt "
                         "(PELT-basiert, kostenoptimierte Segmentierung):")
            lines.append("Datum | Keyword | Richtung | Mittelwert vorher | Mittelwert nachher | Delta")
            for cp in cps:
                lines.append(f"  {cp['date']}: {cp['keyword']} | {cp['dir']} | "
                             f"vorher={cp['meanBefore']} | nachher={cp['meanAfter']} | "
                             f"Delta={cp['delta']}")

        elif mode == "spike_coin" and extras.get("spike_coincidence"):
            sc = extras["spike_coincidence"]
            coins = sc.get("coincidences", [])
            lines.append("")
            lines.append(f"### Spike-Koinzidenz – {len(coins)} erkannte Koinzidenzen")
            lines.append("Zeitpunkte, an denen mehrere Keywords gleichzeitig "
                         "überdurchschnittliche Spikes zeigen (Z-Score-basiert):")
            lines.append("Datum | Anzahl Keywords | Ø|Z| | Beteiligte Keywords")
            for c in coins:
                kw_str = ", ".join(
                    f"{k['keyword']} (Z={k['zScore']}, {k['dir']})"
                    for k in c.get("keywords", [])
                )
                lines.append(f"  {c['date']}: {c['count']} Keywords | "
                             f"Ø|Z|={c['avgZ']} | {kw_str}")

        elif mode == "rc" and extras.get("rolling_correlation"):
            rc = extras["rolling_correlation"]
            phases = rc.get("phases", [])
            lines.append("")
            lines.append(f"### Rolling Correlation – Gleitende Korrelation")
            lines.append(f"Fenstergröße: {rc.get('window', '?')} Datenpunkte | "
                         f"Ø r = {rc.get('avgR', '?')} | "
                         f"Paare: {', '.join(rc.get('pairs', []))}")
            lines.append(f"{len(phases)} erkannte Korrelationsphasen:")
            lines.append("Paar | Phase | Von | Bis | Dauer | Ø r")
            for ph in phases:
                lines.append(f"  {ph['pair']}: {ph['cat']} | "
                             f"{ph['startDate']} – {ph['endDate']} | "
                             f"{ph['duration']} Pkt. | r={ph['avgR']}")

        elif mode == "fc" and extras.get("forecast"):
            fc_ex = extras["forecast"]
            lines.append("")
            lines.append(f"### Forecasting – Prognose-Ergebnisse")
            lines.append(f"Modell: {fc_ex.get('model', '?')} | "
                         f"Keyword: {fc_ex.get('keyword', '?')} | "
                         f"Horizont: {fc_ex.get('horizon', '?')} Schritte | "
                         f"Frequenz: {fc_ex.get('freq', '?')}")
            lines.append(f"Prognostizierte Richtung: {fc_ex.get('direction', '?')} "
                         f"({fc_ex.get('delta_pct', '?')}%)")
            lines.append(f"Letzter historischer Wert: {fc_ex.get('last_historical', '?')} | "
                         f"Letzter Prognosewert: {fc_ex.get('last_forecast', '?')}")
            if fc_ex.get("aic"):
                lines.append(f"AIC: {fc_ex['aic']} | BIC: {fc_ex.get('bic', '?')}")
            if fc_ex.get("changepoints"):
                lines.append(f"Prophet-Changepoints: {', '.join(fc_ex['changepoints'])}")
            values = fc_ex.get("values", [])
            if values:
                lines.append("Prognose-Werte (Datum, Prognose, Untergrenze, Obergrenze):")
                for v in values:
                    lines.append(f"  {v['date']}: {v['yhat']} [{v['lower']} – {v['upper']}]")

        elif mode == "gc" and extras.get("granger"):
            gc_ex = extras["granger"]
            gc_results = gc_ex.get("results", [])
            lines.append("")
            lines.append(f"### Granger-Kausalität – {len(gc_results)} getestete Beziehungen")
            lines.append(f"Maximaler Lag: {gc_ex.get('max_lag', '?')} | "
                         f"Signifikanzniveau: p < 0.05")
            lines.append("Richtung | Bester Lag | F-Statistik | p-Wert | Signifikanz")
            for r in gc_results:
                lines.append(f"  {r['direction']}: Lag={r['best_lag']} | "
                             f"F={r['best_f']} | p={r['best_p']} | "
                             f"{'SIGNIFIKANT' if r['significant'] else 'nicht signifikant'} "
                             f"{r.get('sig_label', '')}")

        elif mode == "ra" and extras.get("run_artifact"):
            ra_list = extras["run_artifact"]
            lines.append("")
            lines.append("### Artefakt-Check – Parallele Abruf-Reihen")
            for ra in ra_list:
                lines.append(f"\nKeyword: {ra.get('keyword', '?')} ({ra.get('geo', 'DE')})")
                lines.append(f"Anzahl paralleler Reihen: {len(ra.get('runs', []))}")
                for r in ra.get("runs", []):
                    lines.append(f"  Reihe '{r.get('label', '?')}': "
                                 f"{r.get('count', '?')} Punkte, "
                                 f"Min={r.get('min', '?')}, Max={r.get('max', '?')}, "
                                 f"Mittel={r.get('mean', '?')}")
                for d in ra.get("pairwise_diffs", []):
                    lines.append(f"  Vergleich '{d['run_a']}' vs '{d['run_b']}': "
                                 f"{d['common_points']} gemeinsame Punkte, "
                                 f"mittlere Abweichung={d['mean_abs_diff']}, "
                                 f"max. Abweichung={d['max_abs_diff']}")

        elif mode == "pf" and extras.get("periodicity"):
            pf_ex = extras["periodicity"]
            lines.append("")
            lines.append(f"### Fourier-Spektralanalyse – Periodizitäts-Filter")
            lines.append(f"Identifizierte Frequenzen: {pf_ex.get('total_frequencies', '?')}")
            lines.append(f"Filter angewendet: {'Ja' if pf_ex.get('filter_applied') else 'Nein'}")
            tech = pf_ex.get("technical", [])
            if tech:
                lines.append("Technische Artefakte (Google-Sampling):")
                for t in tech:
                    lines.append(f"  Periode: {t['period_days']} Tage – {t.get('label', '')} "
                                 f"(relative Power: {t['relative_power']})")
            natural = pf_ex.get("natural", [])
            if natural:
                lines.append("Natürliche/echte Periodizitäten:")
                for t in natural:
                    lines.append(f"  Periode: {t['period_days']} Tage "
                                 f"(relative Power: {t['relative_power']})")
            removed = pf_ex.get("removed", [])
            if removed:
                lines.append(f"Gefilterte Frequenzen: {', '.join(removed)}")

        elif mode == "cluster" and extras.get("cluster"):
            cl_ex = extras["cluster"]
            lines.append("")
            lines.append(f"### Cluster-Analyse – Keyword: {cl_ex.get('keyword', '?')}")
            lines.append(f"Zeitliche Batches: {cl_ex.get('batches', '?')} | "
                         f"Einzigartige verwandte Queries: {cl_ex.get('unique_queries', '?')}")
            queries = cl_ex.get("queries", [])
            if queries:
                lines.append(f"Queries (bis zu 100): {', '.join(str(q) for q in queries)}")

        # Verwandte Suchanfragen (immer)
        if extras.get("related"):
            lines.append("")
            lines.append("### Verwandte Suchanfragen")
            for rel in extras["related"]:
                kw_name = rel.get("keyword", "?")
                if rel.get("top"):
                    lines.append(f"Top ({kw_name}): {', '.join(rel['top'])}")
                if rel.get("rising"):
                    lines.append(f"Aufsteigend ({kw_name}): {', '.join(rel['rising'])}")

        # Interesse nach Region (immer)
        if extras.get("region") and extras["region"].get("data"):
            reg = extras["region"]
            res_label = ("Bundesland" if reg.get("resolution") == "REGION"
                         else "Stadt")
            lines.append("")
            lines.append(f"### Interesse nach Region ({res_label}) – "
                         f"Keyword: {reg.get('keyword', '?')}")
            lines.append("Region,Interesse")
            for d in reg["data"]:
                lines.append(f"{d['geo_name']},{d['value']}")

        # Korrelationen zwischen Keyword-Reihen
        if extras.get("corr"):
            lines.append("")
            lines.append("### Korrelationen zwischen den Keyword-Reihen (Pearson r)")
            lines.append("Skala: -1 = perfekt negativ, 0 = kein Zusammenhang, +1 = perfekt positiv")
            for pair in extras["corr"]:
                r = pair.get("r", 0)
                strength = ("stark" if abs(r) > 0.7
                            else "mittel" if abs(r) > 0.4 else "schwach")
                direction = "positiv" if r >= 0 else "negativ"
                lines.append(
                    f"  {pair['labelA']} ↔ {pair['labelB']}: "
                    f"r={r:+.3f} ({strength} {direction}, "
                    f"n={pair.get('n', '?')} gemeinsame Datenpunkte)"
                )

        # Zeitliche Verhaltensmuster (Wochentag, Tageszeit, Monat)
        if extras.get("temporal"):
            temp = extras["temporal"]
            lines.append("")
            lines.append("### Zeitliche Verhaltensmuster (Durchschnittswerte)")
            if temp.get("weekday"):
                lines.append("Wochentag,Ø-Interesse")
                for d in temp["weekday"]:
                    lines.append(f"  {d['day']},{d['avg']}")
            if temp.get("hourly"):
                lines.append("Tageszeit (Stunde),Ø-Interesse")
                for h in temp["hourly"]:
                    lines.append(f"  {h['hour']},{h['avg']}")
            if temp.get("monthly"):
                lines.append("Monat,Ø-Interesse")
                for m in temp["monthly"]:
                    lines.append(f"  {m['month']},{m['avg']}")

        # Schlüsselereignisse des Projekts
        if extras.get("events"):
            lines.append("")
            lines.append("### Schlüsselereignisse im Beobachtungszeitraum")
            lines.append("(Nutze diese Ereignisse, um Ausschläge und Muster in den Trendkurven zu erklären.)")
            for ev in extras["events"]:
                date_str = ev.get("start_dt", "")
                end_str = ev.get("end_dt") or ""
                if end_str:
                    date_str = f"{date_str} – {end_str}"
                ev_type = ("Zeitraum" if ev.get("event_type") == "range"
                           else "Ereignis")
                title = ev.get("title", "")
                desc = ev.get("description", "") or ""
                line = f"  [{ev_type}] {date_str}: {title}"
                if desc:
                    line += f" — {desc}"
                lines.append(line)

        return "\n".join(lines)

    @staticmethod
    def _build_chat_system_prompt(analysis_ctx, pipeline_log,
                                  project_briefing):
        """Builds the system prompt for the follow-up chat."""
        system_parts = [
            "Du bist ein erfahrener Datenanalyst und KI-Assistent (APA). "
            "Beantworte Folgefragen zur vorliegenden Trendanalyse präzise und auf Basis der Daten. "
            "Antworte auf Deutsch. Verwende Markdown-Formatierung (Fettschrift, Listen) wo sinnvoll, "
            "halte die Antworten aber kompakt.\n\n"
            "Du hast Zugriff auf Watch Zones und Triangulations-Datenquellen über bereitgestellte Tools. "
            "Nutze diese Tools aktiv bei entsprechenden Anfragen. Rufe bei Bedarf mehrere Tools nacheinander auf.\n\n"
            "Watch-Zone-Tools: list_watchzones, get_watchzone_details, get_live_data, "
            "get_website_history, get_traceroute_history, create_watchzone.\n\n"
            "Triangulations-Tools (kein API-Key nötig sofern nicht angegeben):\n"
            "- wiki_views: Wikipedia-Seitenaufrufe für Artikel\n"
            "- gdelt_volume: GDELT-Medienberichterstattung (Artikelanzahl pro Tag)\n"
            "- yahoo_finance: Aktienkurse, ETFs, Kryptowährungen\n"
            "- ndvi_analysis: Sentinel-2 Vegetationsindex (Copernicus-Zugangsdaten erforderlich)\n"
            "- seismic_history: USGS-Erdbebendaten für eine Region\n"
            "- nightlights_history: NASA VIIRS Nachtlichthelligkeit\n"
            "- weather_history: DWD/Open-Meteo Wetterdaten\n"
            "- run_traceroute: Aktiver Traceroute zu Domain/IP\n"
            "- bgp_lookup: BGP/WHOIS-Lookup (RIPE NCC)\n"
            "- wayback: Änderungshistorie via Wayback Machine\n"
            "- vessel_traffic: AIS-Schiffsverkehr (AISHub-Zugangsdaten erforderlich)\n"
            "- aircraft_traffic: ADS-B-Flugzeugdaten (airplanes.live)\n\n"
            "Für geo-basierte Tools (ndvi_analysis, seismic_history, nightlights_history, "
            "weather_history, vessel_traffic, aircraft_traffic) kannst du entweder eine zone_id "
            "einer bestehenden Geo-Watch-Zone oder direkt eine bbox [lon_min, lat_min, lon_max, lat_max] angeben."
        ]
        if analysis_ctx:
            system_parts.append(
                f"\n\nDie ursprüngliche Analyse lautet:\n\n{analysis_ctx}")
        if pipeline_log:
            system_parts.append(
                "\n\nDas folgende Protokoll dokumentiert den Ablauf der Analyse-Pipeline "
                "(Keyword-Auswahl, Recherche-Schritte, Agenten-Entscheidungen):\n\n"
                + pipeline_log[:8000]
            )
        if project_briefing:
            system_parts.append(
                f"\n\nProjektbriefing:\n{project_briefing}")
        return "".join(system_parts)

PluginManager.register(TrendAnalysisPlugin())
