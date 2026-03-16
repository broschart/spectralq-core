"""
APA (AI Project Assistant) – SSE-Stream-Endpoint
-------------------------------------------------
Ausgelagert aus app.py (~4.000 Zeilen).
"""

def api_ai_project_assist_stream():
    """
    Startet einen KI-gesteuerten Projektassistenten.
    Body: { "seed": "keyword", "intensity": 1-5, "briefing": "optional context" }
    Liefert SSE-Events:  data: {"type":"status|data|report|done|error", ...}
    """
    if not _ai_plugin_enabled("project_assistant"):
        return jsonify({"error": "AI Projekt-Assistent ist deaktiviert."}), 403
    import json as _json, time as _time, random as _random
    import requests as _req

    body      = request.get_json(force=True, silent=True) or {}
    seed      = (body.get("seed") or "").strip()
    intensity = max(1, min(5, int(body.get("intensity", 2))))
    briefing  = (body.get("briefing") or "").strip()

    if not seed:
        return jsonify({"error": "Seed-Keyword fehlt"}), 400

    uid = current_user.id

    ok, used, limit = _check_llm_quota(current_user.id)
    if not ok:
        return jsonify({"error": f"KI-Kontingent erschöpft ({used}/{limit} Aufrufe diesen Monat). Bitte nächsten Monat erneut versuchen."}), 429

    # --- Settings lesen (innerhalb Request-Kontext) ---
    def _get_setting(key, default=""):
        _uid = current_user.id if (not current_user.is_superadmin and current_user.can_use_own_apis) else None
        return _resolve_api_key(key, default, user_id=_uid, is_admin=current_user.is_superadmin)

    ai_provider = _get_setting("ai_provider", "anthropic")
    ai_model    = _get_setting("ai_model", "claude-haiku-4-5-20251001")
    ai_key_anth = _get_setting("anthropic_api_key", os.getenv("ANTHROPIC_API_KEY", ""))
    ai_key_oai  = _get_setting("openai_api_key", "")

    workflow = _get_user_workflow(current_user)

    k_setting = AppSetting.query.filter_by(key="serpapi_key", user_id=None).first()
    serpapi_key = (k_setting.value if k_setting and k_setting.value else None) or os.getenv("SERPAPI_KEY", "")

    from fetcher import COOKIES_FILE as _FETCHER_COOKIES
    c_setting = AppSetting.query.filter_by(key="cookies_file", user_id=None).first()
    cookies_file = (c_setting.value if c_setting and c_setting.value else None) or _FETCHER_COOKIES

    # Quota check
    if current_user.max_projects and current_user.max_projects > 0:
        count = Project.query.filter_by(user_id=uid).count()
        if count >= current_user.max_projects:
            return jsonify({"error": f"Projektlimit erreicht ({current_user.max_projects})"}), 403

    # Snapshot settings for generator
    settings = {
        "ai_provider": ai_provider,
        "ai_model": ai_model,
        "ai_key_anth": ai_key_anth,
        "ai_key_oai": ai_key_oai,
        "workflow": workflow,
        "serpapi_key": serpapi_key,
        "cookies_file": cookies_file,
        "hl": _get_query_language(current_user),
    }

    _apa_llm_source = "apa"
    _apa_llm_detail = seed

    def _call_llm(prompt, max_tokens=4096):
        """Calls the configured LLM provider. Returns text or raises."""
        _increment_llm_usage(uid, source=_apa_llm_source, detail=_apa_llm_detail)
        if settings["ai_provider"] == "anthropic":
            api_key = settings["ai_key_anth"]
            if not api_key:
                raise RuntimeError("Anthropic API-Key nicht konfiguriert")
            resp = _req.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": settings["ai_model"],
                    "max_tokens": max_tokens,
                    "messages": [{"role": "user", "content": prompt}],
                },
                timeout=120,
            )
            if not resp.ok:
                raise RuntimeError(f"Anthropic {resp.status_code}: {resp.text[:300]}")
            return resp.json()["content"][0]["text"]
        elif settings["ai_provider"] == "openai":
            api_key = settings["ai_key_oai"]
            if not api_key:
                raise RuntimeError("OpenAI API-Key nicht konfiguriert")
            resp = _req.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": settings["ai_model"],
                    "max_tokens": max_tokens,
                    "messages": [{"role": "user", "content": prompt}],
                },
                timeout=120,
            )
            if not resp.ok:
                raise RuntimeError(f"OpenAI {resp.status_code}: {resp.text[:300]}")
            return resp.json()["choices"][0]["message"]["content"]
        else:
            raise RuntimeError(f"Unbekannter AI-Provider: {settings['ai_provider']}")

    def generate():
        def sse(data):
            return f"data: {_json.dumps(data, ensure_ascii=False)}\n\n"

        try:
            with app.app_context():
                from fetcher import _fetch_single, _fetch_related, DEFAULT_WORKFLOW, DEFAULT_TIMEFRAME

                wf = settings["workflow"] or DEFAULT_WORKFLOW

                # ── 1. Projekt anlegen ──────────────────────────────────────
                yield sse({"type": "status", "msg": f"Erstelle Projekt \"{seed}\" …"})
                max_order = db.session.query(db.func.max(Project.sort_order)).filter(
                    Project.user_id == uid).scalar() or 0
                proj = Project(
                    name=f"APA: {seed}",
                    description=f"KI-Projektassistenz – Seed: {seed}",
                    briefing=briefing or f"Automatische Analyse zum Thema \"{seed}\"",
                    color="#4f8ef7",
                    sort_order=max_order + 1,
                    user_id=uid,
                )
                db.session.add(proj)
                db.session.commit()
                project_id = proj.id
                yield sse({"type": "data", "msg": f"Projekt #{project_id} erstellt", "project_id": project_id})
                audit_log("apa_start", "project", project_id,
                          f"Seed: {seed}, Intensität: {intensity}, Briefing: {(briefing or '')[:100]}",
                          project_id=project_id, user_id=uid)

                # ── 2. Geo-Kontext aus Sprache ableiten ─────────────────────
                yield sse({"type": "status", "msg": "Ermittle Sprachkontext für Seed-Keyword …"})

                # Sprache erkennen → primären Geo-Kontext bestimmen
                primary_geo = "DE"
                try:
                    from translator import detect_language
                    lang = detect_language(seed)
                    geo_map = {
                        "de": "DE", "en": "", "fr": "FR", "es": "ES",
                        "it": "IT", "pt": "BR", "nl": "NL", "pl": "PL",
                        "tr": "TR", "ru": "RU", "ja": "JP", "ko": "KR",
                        "zh": "CN", "ar": "SA",
                    }
                    primary_geo = geo_map.get(lang, "DE")
                    yield sse({"type": "data", "msg": f"Sprache erkannt: {lang} → Geo: {primary_geo or 'Weltweit'}"})
                except Exception:
                    yield sse({"type": "data", "msg": "Spracherkennung nicht verfügbar → Standard: DE"})

                # ── 2b. Prüfen, ob Übersetzung des Seeds sinnvoll ist ──────
                yield sse({"type": "status", "msg": "Prüfe, ob eine Übersetzung des Keywords analytisch sinnvoll ist …"})
                translated_seed = None
                try:
                    trans_prompt = f"""Seed-Keyword: "{seed}" (Sprache: {lang if 'lang' in dir() else 'unbekannt'}, Geo: {primary_geo or 'Weltweit'})
{('Briefing: ' + briefing) if briefing else ''}

Prüfe: Würde es die Google-Trends-Analyse bereichern, dieses Keyword zusätzlich in einer anderen Sprache abzufragen?

Beispiele, wo eine Übersetzung sinnvoll ist:
- "Klimawandel" → auch "climate change" (globales Thema, internationale Vergleichbarkeit)
- "Ukraine" → keine Übersetzung nötig (Eigenname, international gleich)
- "Bäckerei" → keine Übersetzung (rein lokales Thema)

Antworte ausschließlich im JSON-Format:
{{
  "translate": true oder false,
  "translation": "übersetztes Keyword oder leer",
  "target_lang": "en, de, fr, etc. oder leer",
  "target_geo": "US, DE, FR, etc. oder leer für Weltweit",
  "reason": "kurze Begründung"
}}"""
                    import re
                    _apa_llm_source = "apa-übersetzung"
                    trans_raw = _call_llm(trans_prompt, max_tokens=500)
                    m = re.search(r'\{[\s\S]*\}', trans_raw)
                    trans_result = _json.loads(m.group(0)) if m else {}
                    if trans_result.get("translate") and trans_result.get("translation"):
                        translated_seed = trans_result["translation"].strip()
                        trans_geo = (trans_result.get("target_geo") or "").upper()
                        yield sse({"type": "data",
                                   "msg": f"Übersetzung: \"{translated_seed}\" ({trans_geo or 'Weltweit'}) – {trans_result.get('reason', '')}"})
                    else:
                        yield sse({"type": "data", "msg": f"Keine Übersetzung nötig – {trans_result.get('reason', 'Keyword ist international verständlich')}"})
                except Exception as e:
                    log.warning("Übersetzungsprüfung fehlgeschlagen: %s", e)
                    yield sse({"type": "data", "msg": "Übersetzungsprüfung übersprungen"})

                # Sonderzeichen aus Keywords entfernen (echte Nutzer tippen keine Sonderzeichen)
                import re as _re
                def _clean_kw(text):
                    text = _re.sub(r'[^\w\s]', ' ', text, flags=_re.UNICODE)
                    return _re.sub(r'\s+', ' ', text).strip()

                clean_seed = _clean_kw(seed)
                if translated_seed:
                    translated_seed = _clean_kw(translated_seed)

                # Phase 1: Seed-Keyword immer zuerst abrufen (+ Übersetzung falls vorhanden)
                queries = [
                    {"keyword": clean_seed, "geo": primary_geo, "timeframe": "today 12-m", "gprop": ""},
                ]
                if translated_seed:
                    t_geo = (trans_result.get("target_geo") or "").upper() if 'trans_result' in dir() else ""
                    queries.append({"keyword": translated_seed, "geo": t_geo, "timeframe": "today 12-m", "gprop": ""})

                yield sse({"type": "data", "msg": f"{len(queries)} Seed-Abfragen geplant",
                           "queries": [q["keyword"] + f" ({q.get('geo') or 'Welt'}/{q['timeframe']}/{q.get('gprop') or 'web'})" for q in queries]})

                # ── 3. Seed-Keyword abrufen ─────────────────────────────────
                all_keyword_ids = []
                fetched_kw_names = []
                run_tag = f"ai-assist-{project_id}"

                for i, q in enumerate(queries):
                    kw_text = (q.get("keyword") or clean_seed).strip()
                    geo     = (q.get("geo") or "DE").upper()
                    tf      = q.get("timeframe") or "today 12-m"
                    gprop   = q.get("gprop") or ""

                    yield sse({"type": "status", "msg": f"[{i+1}/{len(queries)}] Abruf: \"{kw_text}\" ({geo}, {tf}, {gprop or 'web'}) …"})

                    # Keyword anlegen (wenn noch nicht vorhanden)
                    existing_kw = Keyword.query.filter_by(
                        keyword=kw_text, geo=geo, timeframe=tf,
                        gprop=gprop, user_id=uid
                    ).first()
                    if existing_kw:
                        kw = existing_kw
                    else:
                        kw = Keyword(
                            keyword=kw_text, geo=geo, timeframe=tf,
                            gprop=gprop, active=True, user_id=uid,
                        )
                        db.session.add(kw)
                        db.session.commit()

                    # Projekt zuweisen
                    p = Project.query.get(project_id)
                    if p and p not in kw.kw_projects:
                        kw.kw_projects.append(p)
                        db.session.commit()

                    all_keyword_ids.append(kw.id)
                    fetched_kw_names.append(kw_text)

                    # Daten abrufen (mit Geo-Fallback)
                    from fetcher import NoDataError
                    actual_geo = geo
                    try:
                        _time.sleep(_random.uniform(8, 15))
                        data, backend = _fetch_single(
                            kw.keyword, kw.geo, tf, gprop,
                            workflow=wf, serpapi_key=settings["serpapi_key"],
                            cookies_file=settings["cookies_file"], hl=settings["hl"],
                        )
                    except NoDataError:
                        data = None
                        # Fallback 1: Weltweit versuchen
                        if geo:
                            yield sse({"type": "data", "msg": f"\"{kw_text}\": Keine Daten für {geo}, versuche Weltweit …"})
                            try:
                                _time.sleep(_random.uniform(6, 10))
                                data, backend = _fetch_single(
                                    kw.keyword, "", tf, gprop,
                                    workflow=wf, serpapi_key=settings["serpapi_key"],
                                    cookies_file=settings["cookies_file"], hl=settings["hl"],
                                )
                                actual_geo = "Weltweit"
                            except Exception:
                                data = None
                        # Fallback 2: Live-Daten (7 Tage, bessere Auflösung)
                        if not data and tf != "now 7-d":
                            fallback_tf = "now 7-d"
                            fallback_geo = geo or ""
                            yield sse({"type": "data", "msg": f"\"{kw_text}\": Keine Daten für 12 Monate, versuche Live-Daten (7 Tage) …"})
                            try:
                                _time.sleep(_random.uniform(6, 10))
                                data, backend = _fetch_single(
                                    kw.keyword, fallback_geo, fallback_tf, gprop,
                                    workflow=wf, serpapi_key=settings["serpapi_key"],
                                    cookies_file=settings["cookies_file"], hl=settings["hl"],
                                )
                                tf = fallback_tf
                                actual_geo = fallback_geo or "Weltweit"
                            except Exception:
                                data = None
                            # Fallback 3: Live-Daten weltweit
                            if not data and fallback_geo:
                                yield sse({"type": "data", "msg": f"\"{kw_text}\": Live-Daten {fallback_geo} leer, versuche Weltweit …"})
                                try:
                                    _time.sleep(_random.uniform(6, 10))
                                    data, backend = _fetch_single(
                                        kw.keyword, "", fallback_tf, gprop,
                                        workflow=wf, serpapi_key=settings["serpapi_key"],
                                        cookies_file=settings["cookies_file"], hl=settings["hl"],
                                    )
                                    tf = fallback_tf
                                    actual_geo = "Weltweit"
                                except Exception:
                                    data = None
                    except Exception as e:
                        data = None
                        db.session.rollback()
                        yield sse({"type": "data", "msg": f"\"{kw_text}\": Fehler – {str(e)[:100]}"})

                    if data:
                        count = 0
                        for dt, val in data.items():
                            existing = TrendData.query.filter_by(
                                keyword_id=kw.id, date=dt, run_tag=run_tag
                            ).first()
                            if existing:
                                existing.value = val
                            else:
                                db.session.add(TrendData(
                                    keyword_id=kw.id, date=dt,
                                    value=val, run_tag=run_tag,
                                ))
                            count += 1
                        db.session.commit()
                        yield sse({"type": "data", "msg": f"\"{kw_text}\": {count} Datenpunkte ({actual_geo})"})
                    else:
                        yield sse({"type": "data", "msg": f"\"{kw_text}\": Keine Daten verfügbar"})

                    # Verwandte Suchanfragen abrufen
                    try:
                        _time.sleep(_random.uniform(6, 12))
                        rq_data = _fetch_related(
                            kw.keyword, kw.geo, tf, gprop,
                            workflow=wf, serpapi_key=settings["serpapi_key"],
                            cookies_file=settings["cookies_file"], hl=settings["hl"],
                        )
                        rq_count = 0
                        now = datetime.now(timezone.utc)
                        for qt in ("rising", "top"):
                            for idx, item in enumerate(rq_data.get(qt, [])):
                                qtext = (item.get("query") or "").strip()
                                if not qtext:
                                    continue
                                db.session.add(RelatedQuery(
                                    keyword_id=kw.id, query_type=qt,
                                    query=qtext, value=str(item.get("value", "")),
                                    rank=idx, fetched_at=now,
                                ))
                                rq_count += 1
                        db.session.commit()
                        if rq_count:
                            yield sse({"type": "data", "msg": f"\"{kw_text}\": {rq_count} verwandte Suchanfragen"})
                    except Exception as e:
                        db.session.rollback()
                        log.warning("Related Queries Fehler für '%s': %s", kw_text, e)

                # ── 3b. Nachrichten-Scan: Aktuelle Meldungen scrapen ─────────
                yield sse({"type": "status", "msg": f"Scanne aktuelle Nachrichten zu \"{seed}\" …"})
                _apa_news_context = ""
                try:
                    import requests as _req_news3b
                    from bs4 import BeautifulSoup as _BS3b
                    _UA3b = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0"
                    _lang_key_3b = ""
                    if primary_geo in ("US", "GB", "AU", "CA"):
                        _lang_key_3b = "English"
                    elif primary_geo == "FR":
                        _lang_key_3b = "French"
                    elif primary_geo == "ES":
                        _lang_key_3b = "Spanish"
                    _hl3b, _gl3b, _ceid3b, _ = _GNEWS_LANG_MAP.get(_lang_key_3b, _GNEWS_LANG_MAP[""])
                    _rss3b = _req_news3b.get(
                        "https://news.google.com/rss/search",
                        params={"q": seed, "hl": _hl3b, "gl": _gl3b, "ceid": _ceid3b},
                        headers={"User-Agent": _UA3b}, timeout=15,
                    )
                    _rss3b.raise_for_status()
                    _news_items = _rss_parse_items(_rss3b.text)
                    # Deduplizieren
                    _seen3b = set()
                    _uniq3b = []
                    for _it in _news_items:
                        _tc = _it["title"].lower().strip()[:60]
                        if _tc not in _seen3b:
                            _seen3b.add(_tc)
                            _uniq3b.append(_it)
                    _news_items = _uniq3b[:15]
                    yield sse({"type": "data", "msg": f"{len(_news_items)} Nachrichtenartikel gefunden"})

                    # Artikel scrapen (parallel, max 8)
                    from concurrent.futures import ThreadPoolExecutor as _TP3b
                    import re as _re3b
                    def _scrape3b(art):
                        url = art.get("url", "")
                        if not url:
                            return {**art, "fulltext": ""}
                        try:
                            r = _req_news3b.get(url, headers={"User-Agent": _UA3b},
                                                timeout=12, allow_redirects=True)
                            r.raise_for_status()
                            soup = _BS3b(r.text, "html.parser")
                            for tag in soup(["script","style","nav","footer","header",
                                             "aside","form","iframe","noscript"]):
                                tag.decompose()
                            for el in soup.find_all(attrs={"class": _re3b.compile(
                                    r'cookie|consent|gdpr|privacy|banner|overlay|cmp',
                                    _re3b.IGNORECASE)}):
                                el.decompose()
                            for el in soup.find_all(attrs={"id": _re3b.compile(
                                    r'cookie|consent|gdpr|privacy|banner|overlay|cmp',
                                    _re3b.IGNORECASE)}):
                                el.decompose()
                            root = soup.find("article") or soup.find("body")
                            if root:
                                paras = root.find_all("p")
                                text = "\n".join(p.get_text(strip=True)
                                                 for p in paras if len(p.get_text(strip=True)) > 20)
                            else:
                                text = soup.get_text(separator="\n", strip=True)
                            return {**art, "fulltext": text[:2000] if text else ""}
                        except Exception:
                            return {**art, "fulltext": ""}

                    with _TP3b(max_workers=6) as _pool3b:
                        _scraped3b = list(_pool3b.map(_scrape3b, _news_items))

                    _scraped_ok = [a for a in _scraped3b if a.get("fulltext")]
                    yield sse({"type": "data", "msg": f"{len(_scraped_ok)} Artikel erfolgreich gescrapt"})

                    # Kontext-Block für Koordinator zusammenbauen
                    if _scraped3b:
                        _news_lines = ["AKTUELLE NACHRICHTENLAGE (automatisch gescrapt):"]
                        for i, art in enumerate(_scraped3b[:12], 1):
                            _news_lines.append(f"  Artikel {i}: {art.get('title', '–')}")
                            _news_lines.append(f"    Quelle: {art.get('domain', '–')} | Datum: {art.get('seendate', '–')}")
                            ft = (art.get("fulltext") or "")[:400]
                            if ft:
                                _news_lines.append(f"    Auszug: {ft}")
                        _apa_news_context = "\n".join(_news_lines)

                    # Events aus den Artikeln anlegen
                    _news_ev_count = 0
                    for _it in _news_items[:10]:
                        dt_str = _it.get("seendate", "")
                        if not dt_str:
                            continue
                        try:
                            ev_dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00")).replace(tzinfo=None)
                        except Exception:
                            continue
                        existing = Event.query.filter(
                            Event.user_id == uid,
                            Event.project_id == project_id,
                            Event.start_dt == ev_dt,
                        ).first()
                        if existing:
                            continue
                        ev = Event(
                            title=_it["title"][:200],
                            description=f"Quelle: {_it.get('domain', '?')} | {_it.get('url', '')}",
                            event_type="point",
                            start_dt=ev_dt,
                            color="#f59e0b",
                            project_id=project_id,
                            user_id=uid,
                        )
                        db.session.add(ev)
                        _news_ev_count += 1
                    if _news_ev_count:
                        db.session.commit()
                        yield sse({"type": "data", "msg": f"{_news_ev_count} Nachrichtenereignisse als Events angelegt"})

                except Exception as exc:
                    log.warning("APA News-Scan (Phase 3b) fehlgeschlagen: %s", exc)
                    yield sse({"type": "data", "msg": f"News-Scan fehlgeschlagen: {str(exc)[:80]}"})

                # ── 4. Autonome iterative Vertiefung ──────────────────────────
                max_iterations = intensity * 2  # Sicherheits-Cap
                colors = ["#4f8ef7","#22c55e","#f97316","#a78bfa","#ef4444","#06b6d4","#eab308","#ec4899"]

                def _build_context():
                    """Baut Kontext-String für die KI: Keywords, Trenddaten, Related Queries."""
                    lines = []
                    for kid in all_keyword_ids:
                        kw_obj = Keyword.query.get(kid)
                        if not kw_obj:
                            continue
                        trends = TrendData.query.filter_by(keyword_id=kid, run_tag=run_tag).order_by(TrendData.date).all()
                        vals = [t.value for t in trends if t.value is not None]
                        if vals:
                            first3 = trends[:3]
                            last3 = trends[-3:]
                            lines.append(f"  \"{kw_obj.keyword}\" ({kw_obj.geo}, {kw_obj.timeframe}, {kw_obj.gprop or 'web'}): {len(vals)} Punkte, Min={min(vals)}, Max={max(vals)}, Ø={sum(vals)/len(vals):.0f}")
                            fmt = "%Y-%m-%d"
                            lines.append("    Anfang: " + ", ".join(f"{t.date.strftime(fmt)}={t.value}" for t in first3))
                            lines.append("    Ende: " + ", ".join(f"{t.date.strftime(fmt)}={t.value}" for t in last3))
                        # Related Queries
                        rqs = db.session.query(RelatedQuery).filter_by(keyword_id=kid).order_by(RelatedQuery.rank).limit(15).all()
                        if rqs:
                            rising = [rq.query for rq in rqs if rq.query_type == "rising"]
                            top = [rq.query for rq in rqs if rq.query_type == "top"]
                            if rising:
                                lines.append(f"    Rising: {', '.join(rising[:8])}")
                            if top:
                                lines.append(f"    Top: {', '.join(top[:8])}")
                    # Ereignisse des Nutzers (ggf. projektbezogen) hinzufügen
                    events_q = Event.query.filter_by(user_id=uid).order_by(Event.start_dt)
                    if project_id:
                        # Projekt-Events + globale Events (project_id=NULL)
                        events_q = Event.query.filter(
                            Event.user_id == uid,
                            db.or_(Event.project_id == project_id, Event.project_id.is_(None))
                        ).order_by(Event.start_dt)
                    events = events_q.all()
                    if events:
                        lines.append("\n  HINTERLEGTE EREIGNISSE:")
                        for ev in events:
                            fmt = "%Y-%m-%d"
                            if ev.event_type == "range" and ev.end_dt:
                                date_str = f"{ev.start_dt.strftime(fmt)} bis {ev.end_dt.strftime(fmt)}"
                            else:
                                date_str = ev.start_dt.strftime(fmt)
                            desc = f" – {ev.description}" if ev.description else ""
                            lines.append(f"    • {date_str}: {ev.title}{desc}")

                    # ── WatchZones des Projekts + Traceroute-Befunde ──────────────
                    try:
                        import json as _j
                        from models import WatchZone, TracerouteResult
                        zones_q = WatchZone.query.filter_by(user_id=uid)
                        if project_id:
                            zones_q = zones_q.filter_by(project_id=project_id)
                        wz_list = zones_q.all()
                        if wz_list:
                            lines.append("\n  ÜBERWACHTE ZONEN (WatchZones):")
                            for wz in wz_list:
                                cfg = _j.loads(wz.config) if wz.config else {}
                                geo = _j.loads(wz.geometry) if wz.geometry else {}
                                bbox = _geojson_to_bbox(geo)
                                url = cfg.get("url", "")
                                status = "aktiv" if wz.active else "inaktiv"
                                bbox_str = f" bbox=[{','.join(f'{v:.3f}' for v in bbox)}]" if bbox else ""
                                lines.append(f"    • [zone_id={wz.id}] [{wz.zone_type}] {wz.name}"
                                             f"{' – ' + url if url else ''} ({status}){bbox_str}")
                                # Letztes Traceroute-Ergebnis (für website-Zonen)
                                if wz.zone_type == "website":
                                    tr = (TracerouteResult.query
                                          .filter_by(zone_id=wz.id, user_id=uid)
                                          .order_by(TracerouteResult.created_at.desc())
                                          .first())
                                    if tr:
                                        anoms = _j.loads(tr.anomalies_json) if tr.anomalies_json else []
                                        anom_str = "; ".join(a.get("msg", "") for a in anoms) if anoms else "keine"
                                        lines.append(
                                            f"      Traceroute ({tr.created_at.strftime('%Y-%m-%d %H:%M')}): "
                                            f"{tr.hops_count} Hops ({tr.hops_visible} sichtbar, {tr.hops_anon} anonym), "
                                            f"RTT {tr.last_rtt} ms, {round(tr.total_km or 0):,} km"
                                        )
                                        if anoms:
                                            lines.append(f"      Anomalien: {anom_str}")
                                # Hinweis welcher APA-Befehl für diese Zone geeignet ist
                                cmd_hint = {
                                    "weather":     "→ APA-Befehl: weather_history mit dieser bbox",
                                    "seismic":     "→ APA-Befehl: seismic_history mit dieser bbox",
                                    "nightlights": "→ APA-Befehl: nightlights_history mit dieser bbox",
                                    "ndvi":        "→ APA-Befehl: ndvi_analysis mit dieser bbox",
                                    "satellite":   "→ APA-Befehl: ndvi_analysis mit dieser bbox (NDVI-Proxy für Satellitenbild)",
                                    "vessel":      "→ APA-Befehl: vessel_traffic mit dieser bbox",
                                    "aircraft":    "→ APA-Befehl: aircraft_traffic mit dieser bbox",
                                }.get(wz.zone_type, "")
                                if cmd_hint and bbox:
                                    lines.append(f"      {cmd_hint}")
                    except Exception as _wze:
                        log.warning("APA WatchZone-Kontext Fehler: %s", _wze)

                    return "\n".join(lines) if lines else "(noch keine Daten)"

                def _build_trend_context():
                    """Baut detaillierten Trend-Kontext: Verlaufsdaten mit mehr Datenpunkten."""
                    lines = []
                    # fetch_group-Zuordnung sammeln für Vergleichbarkeitshinweis
                    fg_map = {}  # fetch_group -> [keyword_names]
                    for kid in all_keyword_ids:
                        kw_obj = Keyword.query.get(kid)
                        if not kw_obj:
                            continue
                        trends = TrendData.query.filter_by(keyword_id=kid, run_tag=run_tag).order_by(TrendData.date).all()
                        vals = [t.value for t in trends if t.value is not None]
                        if not vals:
                            continue
                        # fetch_group tracken
                        fgs = set(t.fetch_group for t in trends if t.fetch_group)
                        for fg in fgs:
                            fg_map.setdefault(fg, []).append(kw_obj.keyword)
                        fmt = "%Y-%m-%d"
                        fg_label = ""
                        if fgs:
                            fg_label = " [gemeinsame Skala]"
                        lines.append(f"  \"{kw_obj.keyword}\" ({kw_obj.geo}, {kw_obj.timeframe}){fg_label}:")
                        lines.append(f"    {len(vals)} Punkte, Min={min(vals)}, Max={max(vals)}, Ø={sum(vals)/len(vals):.0f}")
                        # Mehr Datenpunkte für Trendanalyse: Anfang, Mitte, Ende
                        n = len(trends)
                        first5 = trends[:5]
                        mid_start = max(0, n // 2 - 2)
                        mid5 = trends[mid_start:mid_start + 5]
                        last5 = trends[-5:]
                        lines.append("    Anfang: " + ", ".join(f"{t.date.strftime(fmt)}={t.value}" for t in first5))
                        if n > 15:
                            lines.append("    Mitte:  " + ", ".join(f"{t.date.strftime(fmt)}={t.value}" for t in mid5))
                        lines.append("    Ende:   " + ", ".join(f"{t.date.strftime(fmt)}={t.value}" for t in last5))
                        # Trend-Richtung
                        if len(vals) >= 4:
                            first_q = sum(vals[:len(vals)//4]) / max(len(vals)//4, 1)
                            last_q = sum(vals[-len(vals)//4:]) / max(len(vals)//4, 1)
                            if last_q > first_q * 1.2:
                                lines.append("    → STEIGENDER Trend")
                            elif last_q < first_q * 0.8:
                                lines.append("    → FALLENDER Trend")
                            else:
                                lines.append("    → STABILER Trend")
                    # Vergleichsgruppen hinzufügen
                    cmp_groups = [kws for kws in fg_map.values() if len(kws) >= 2]
                    if cmp_groups:
                        lines.append("")
                        lines.append("  VERGLEICHBARE GRUPPEN (gemeinsame Abfrage → quantitativ vergleichbar):")
                        for i, kws in enumerate(cmp_groups, 1):
                            lines.append(f"    Gruppe {i}: {', '.join(kws)}")
                    return "\n".join(lines) if lines else "(noch keine Trenddaten)"

                def _build_rq_context():
                    """Baut detaillierten Related-Queries-Kontext."""
                    lines = []
                    for kid in all_keyword_ids:
                        kw_obj = Keyword.query.get(kid)
                        if not kw_obj:
                            continue
                        rqs = db.session.query(RelatedQuery).filter_by(keyword_id=kid).order_by(RelatedQuery.rank).limit(20).all()
                        if not rqs:
                            continue
                        rising = [(rq.query, rq.value) for rq in rqs if rq.query_type == "rising"]
                        top = [(rq.query, rq.value) for rq in rqs if rq.query_type == "top"]
                        lines.append(f"  Verwandte Suchanfragen für \"{kw_obj.keyword}\" ({kw_obj.geo}):")
                        if rising:
                            lines.append("    RISING (stark wachsend):")
                            for q, v in rising[:10]:
                                lines.append(f"      \"{q}\" (Wachstum: {v})")
                        if top:
                            lines.append("    TOP (höchstes Volumen):")
                            for q, v in top[:10]:
                                lines.append(f"      \"{q}\" (Score: {v})")
                    return "\n".join(lines) if lines else "(noch keine verwandten Suchanfragen)"

                def _build_cross_project_memory():
                    """Durchsucht andere Projekte des Users nach überlappenden Keywords
                    und liefert relevante Erkenntnisse (projektübergreifendes Gedächtnis)."""
                    lines = []
                    # Alle Keywords dieses APA-Laufs sammeln
                    current_kw_names = set()
                    for kid in all_keyword_ids:
                        kw = Keyword.query.get(kid)
                        if kw:
                            current_kw_names.add(kw.keyword.lower().strip())
                    if not current_kw_names:
                        return ""

                    # Alle Projekte des Users außer dem aktuellen
                    other_projects = Project.query.filter(
                        Project.user_id == uid,
                        Project.id != project_id
                    ).all()
                    if not other_projects:
                        return ""

                    hits = []
                    for proj in other_projects:
                        # Keywords dieses Projekts laden
                        from sqlalchemy import text as _sa_text
                        proj_kw_ids = [r[0] for r in db.session.execute(
                            _sa_text("SELECT keyword_id FROM keyword_projects WHERE project_id = :pid"),
                            {"pid": proj.id}
                        ).fetchall()]
                        for pkid in proj_kw_ids:
                            pkw = Keyword.query.get(pkid)
                            if not pkw:
                                continue
                            if pkw.keyword.lower().strip() not in current_kw_names:
                                continue
                            # Überlappung gefunden! Trend-Daten aus dem anderen Projekt holen
                            other_trends = TrendData.query.filter(
                                TrendData.keyword_id == pkid,
                                TrendData.run_tag != run_tag
                            ).order_by(TrendData.date).all()
                            if not other_trends:
                                continue
                            vals = [t.value for t in other_trends if t.value is not None]
                            if not vals:
                                continue
                            fmt = "%Y-%m-%d"
                            first_date = other_trends[0].date.strftime(fmt)
                            last_date = other_trends[-1].date.strftime(fmt)
                            # Trend-Richtung
                            direction = "stabil"
                            if len(vals) >= 4:
                                q1 = sum(vals[:len(vals)//4]) / max(len(vals)//4, 1)
                                q4 = sum(vals[-len(vals)//4:]) / max(len(vals)//4, 1)
                                if q4 > q1 * 1.2:
                                    direction = "steigend"
                                elif q4 < q1 * 0.8:
                                    direction = "fallend"
                            # Strukturbrüche (einfach: große Sprünge)
                            breaks = []
                            for i in range(1, len(vals)):
                                if abs(vals[i] - vals[i-1]) > 30:
                                    breaks.append(other_trends[i].date.strftime(fmt))
                            break_info = f", Strukturbrüche: {', '.join(breaks[:3])}" if breaks else ""
                            hits.append(
                                f"  • \"{pkw.keyword}\" in Projekt \"{proj.name}\" "
                                f"({first_date} bis {last_date}, {pkw.geo}, {len(vals)} Punkte, "
                                f"Min={min(vals)}, Max={max(vals)}, Ø={sum(vals)/len(vals):.0f}, "
                                f"Trend: {direction}{break_info})"
                            )
                            # Slides/Berichte aus dem anderen Projekt
                            slides = Slide.query.filter_by(
                                project_id=proj.id, slide_type="textbild"
                            ).limit(2).all()
                            for sl in slides:
                                if sl.description and pkw.keyword.lower() in sl.description.lower():
                                    # Kurzfassung des Berichts (erste 200 Zeichen)
                                    excerpt = sl.description[:200].replace('\n', ' ')
                                    hits.append(f"    → Bericht-Auszug: \"{excerpt}…\"")

                    if not hits:
                        return ""
                    lines.append("PROJEKTÜBERGREIFENDES GEDÄCHTNIS:")
                    lines.append("Folgende Keywords wurden bereits in anderen Projekten analysiert:")
                    lines.extend(hits)
                    lines.append("Berücksichtige diese Vorerkenntnisse in deiner Strategie!")
                    return "\n".join(lines)

                def _build_historical_context():
                    """Vergleicht aktuelle Muster mit historischen Daten des Users.
                    Sucht nach ähnlichen Verlaufsmustern in früheren Erhebungen."""
                    lines = []
                    for kid in all_keyword_ids:
                        kw = Keyword.query.get(kid)
                        if not kw:
                            continue
                        # Aktuelle Daten
                        current = TrendData.query.filter_by(
                            keyword_id=kid, run_tag=run_tag
                        ).order_by(TrendData.date).all()
                        cur_vals = [t.value for t in current if t.value is not None]
                        if len(cur_vals) < 5:
                            continue
                        # Historische Daten (andere run_tags für dasselbe Keyword)
                        hist = TrendData.query.filter(
                            TrendData.keyword_id == kid,
                            TrendData.run_tag != run_tag
                        ).order_by(TrendData.date).all()
                        if not hist:
                            # Suche auch nach gleichnamigen Keywords anderer Projekte
                            same_kws = Keyword.query.filter(
                                Keyword.keyword == kw.keyword,
                                Keyword.user_id == uid,
                                Keyword.id != kid
                            ).all()
                            for skw in same_kws:
                                hist.extend(TrendData.query.filter_by(
                                    keyword_id=skw.id
                                ).order_by(TrendData.date).all())
                        if not hist:
                            continue
                        hist_vals = [t.value for t in hist if t.value is not None]
                        if len(hist_vals) < 5:
                            continue

                        fmt = "%Y-%m-%d"
                        hist_first = hist[0].date.strftime(fmt)
                        hist_last = hist[-1].date.strftime(fmt)

                        # Mustervergleich: Trend-Richtung
                        def _trend_dir(vals):
                            q = len(vals) // 4 or 1
                            avg_start = sum(vals[:q]) / q
                            avg_end = sum(vals[-q:]) / q
                            if avg_end > avg_start * 1.2:
                                return "steigend", avg_start, avg_end
                            elif avg_end < avg_start * 0.8:
                                return "fallend", avg_start, avg_end
                            return "stabil", avg_start, avg_end

                        cur_dir, cur_s, cur_e = _trend_dir(cur_vals)
                        hist_dir, hist_s, hist_e = _trend_dir(hist_vals)

                        # Peaks und Einbrüche im historischen Datensatz
                        hist_max_val = max(hist_vals)
                        hist_min_val = min(hist_vals)
                        hist_max_date = [t for t in hist if t.value == hist_max_val]
                        hist_min_date = [t for t in hist if t.value == hist_min_val]

                        lines.append(f"\n  \"{kw.keyword}\" – Historischer Vergleich:")
                        lines.append(f"    Historische Daten: {hist_first} bis {hist_last} ({len(hist_vals)} Punkte)")
                        lines.append(f"    Historischer Trend: {hist_dir} (Ø Anfang: {hist_s:.0f}, Ø Ende: {hist_e:.0f})")
                        lines.append(f"    Aktueller Trend: {cur_dir} (Ø Anfang: {cur_s:.0f}, Ø Ende: {cur_e:.0f})")
                        if hist_max_date:
                            lines.append(f"    Historischer Peak: {hist_max_val} am {hist_max_date[0].date.strftime(fmt)}")
                        if hist_min_date:
                            lines.append(f"    Historisches Tief: {hist_min_val} am {hist_min_date[0].date.strftime(fmt)}")

                        # Musterähnlichkeit prüfen
                        if cur_dir == hist_dir:
                            lines.append(f"    → MUSTER WIEDERHOLT SICH: Aktueller Trend ({cur_dir}) entspricht historischem Verlauf")
                        else:
                            lines.append(f"    → TRENDWECHSEL: Historisch {hist_dir}, aktuell {cur_dir}")

                        # Niveauvergleich
                        cur_avg = sum(cur_vals) / len(cur_vals)
                        hist_avg = sum(hist_vals) / len(hist_vals)
                        if cur_avg > hist_avg * 1.5:
                            lines.append(f"    → DEUTLICH HÖHERES NIVEAU: Aktuell Ø {cur_avg:.0f} vs. historisch Ø {hist_avg:.0f}")
                        elif cur_avg < hist_avg * 0.5:
                            lines.append(f"    → DEUTLICH NIEDRIGERES NIVEAU: Aktuell Ø {cur_avg:.0f} vs. historisch Ø {hist_avg:.0f}")

                    if not lines:
                        return ""
                    return "ZEITLICHE TIEFE – HISTORISCHER KONTEXT:\n" + "\n".join(lines)

                def _check_artifacts():
                    """Prüft auf Sampling-Artefakte bei niedrigen Suchvolumina.

                    Wird nur aktiv, wenn:
                    1. Für ein Keyword mehrere Run-Tags mit überlappenden Daten existieren
                    2. UND die Daten niedrige Suchvolumina aufweisen (Ø < 15 oder > 30% Nullwerte)

                    Gibt (flag, report_text) zurück.
                    flag: True wenn Artefakt-Verdacht besteht.
                    """
                    artifact_lines = []
                    any_suspicious = False

                    for kid in all_keyword_ids:
                        kw_obj = Keyword.query.get(kid)
                        if not kw_obj:
                            continue

                        # Alle Run-Tags für dieses Keyword ermitteln
                        all_tags = [r[0] for r in db.session.query(
                            db.distinct(TrendData.run_tag)
                        ).filter_by(keyword_id=kid).all()]
                        if len(all_tags) < 2:
                            continue

                        # Aktuelle Werte laden und prüfen, ob Low-Volume
                        current_vals = [t.value for t in TrendData.query.filter_by(
                            keyword_id=kid, run_tag=run_tag
                        ).all() if t.value is not None]
                        if not current_vals:
                            continue
                        mean_val = sum(current_vals) / len(current_vals)
                        zero_pct = current_vals.count(0) / len(current_vals)

                        # Nur bei niedrigem Suchvolumen prüfen
                        if mean_val >= 15 and zero_pct < 0.3:
                            continue

                        # Paarweise Abweichungen zwischen Run-Tags berechnen
                        tag_series = {}
                        for tag in all_tags:
                            rows = TrendData.query.filter_by(
                                keyword_id=kid, run_tag=tag
                            ).order_by(TrendData.date).all()
                            tag_series[tag] = {
                                r.date.strftime("%Y-%m-%d"): r.value
                                for r in rows if r.value is not None
                            }

                        pairs_checked = 0
                        for i, tag_a in enumerate(all_tags):
                            for tag_b in all_tags[i+1:]:
                                sa, sb = tag_series[tag_a], tag_series[tag_b]
                                common_dates = set(sa.keys()) & set(sb.keys())
                                if len(common_dates) < 5:
                                    continue
                                diffs = [abs(sa[d] - sb[d]) for d in common_dates]
                                mean_diff = sum(diffs) / len(diffs)
                                max_diff = max(diffs)
                                pairs_checked += 1

                                if mean_diff > 5 or max_diff > 20:
                                    any_suspicious = True
                                    artifact_lines.append(
                                        f"  ⚠ \"{kw_obj.keyword}\" (Ø={mean_val:.0f}, {zero_pct*100:.0f}% Nullwerte): "
                                        f"Run \"{tag_a}\" vs \"{tag_b}\" – "
                                        f"{len(common_dates)} gemeinsame Datenpunkte, "
                                        f"Ø-Abweichung={mean_diff:.1f}, Max-Abweichung={max_diff:.0f}"
                                    )
                                elif pairs_checked > 0:
                                    artifact_lines.append(
                                        f"  ✓ \"{kw_obj.keyword}\" (Ø={mean_val:.0f}): "
                                        f"Parallel-Erhebungen konsistent (Ø-Abw.={mean_diff:.1f})"
                                    )

                    if not artifact_lines:
                        return False, ""
                    return any_suspicious, "\n".join(artifact_lines)

                def _exec_fetch(action):
                    """Führt eine fetch-Aktion aus. Gibt (cnt, geo_used, fallback_msg) zurück."""
                    from fetcher import NoDataError
                    pk_text = _clean_kw(action.get("keyword", "")).lower()
                    if not pk_text or pk_text in set(fetched_kw_names):
                        return None, "", ""
                    pk_geo = (action.get("geo") or primary_geo).upper()
                    pk_tf = action.get("timeframe") or "today 12-m"
                    pk_gprop = action.get("gprop") or ""
                    fallback_msg = ""

                    def _do_fetch(geo):
                        existing_kw = Keyword.query.filter_by(
                            keyword=pk_text, geo=geo, timeframe=pk_tf,
                            gprop=pk_gprop, user_id=uid
                        ).first()
                        if existing_kw:
                            kw2 = existing_kw
                        else:
                            kw2 = Keyword(
                                keyword=pk_text, geo=geo, timeframe=pk_tf,
                                gprop=pk_gprop, active=True, user_id=uid,
                            )
                            db.session.add(kw2)
                            db.session.commit()

                        p2 = Project.query.get(project_id)
                        if p2 and p2 not in kw2.kw_projects:
                            kw2.kw_projects.append(p2)
                            db.session.commit()

                        all_keyword_ids.append(kw2.id)
                        fetched_kw_names.append(pk_text)

                        _time.sleep(_random.uniform(8, 15))
                        data2, _ = _fetch_single(
                            kw2.keyword, geo, pk_tf, pk_gprop,
                            workflow=wf, serpapi_key=settings["serpapi_key"],
                            cookies_file=settings["cookies_file"], hl=settings["hl"],
                        )
                        cnt = 0
                        if data2:
                            for dt, val in data2.items():
                                ex = TrendData.query.filter_by(
                                    keyword_id=kw2.id, date=dt, run_tag=run_tag
                                ).first()
                                if ex:
                                    ex.value = val
                                else:
                                    db.session.add(TrendData(
                                        keyword_id=kw2.id, date=dt,
                                        value=val, run_tag=run_tag,
                                    ))
                                cnt += 1
                            db.session.commit()

                        # Related Queries
                        _time.sleep(_random.uniform(6, 12))
                        try:
                            rq_data = _fetch_related(
                                kw2.keyword, geo, pk_tf, pk_gprop,
                                workflow=wf, serpapi_key=settings["serpapi_key"],
                                cookies_file=settings["cookies_file"], hl=settings["hl"],
                            )
                            now = datetime.now(timezone.utc)
                            for qt in ("rising", "top"):
                                for idx, item in enumerate(rq_data.get(qt, [])):
                                    qtext = (item.get("query") or "").strip()
                                    if qtext:
                                        db.session.add(RelatedQuery(
                                            keyword_id=kw2.id, query_type=qt,
                                            query=qtext, value=str(item.get("value", "")),
                                            rank=idx, fetched_at=now,
                                        ))
                            db.session.commit()
                        except Exception:
                            db.session.rollback()

                        return cnt

                    # Primärer Abruf
                    try:
                        cnt = _do_fetch(pk_geo)
                        return cnt, pk_geo, ""
                    except NoDataError:
                        # Geo-Fallback: wenn spezifisches Land keine Daten hat → Weltweit
                        if pk_geo:
                            fallback_msg = f"Keine Daten für {pk_geo}, versuche Weltweit …"
                            try:
                                _time.sleep(_random.uniform(6, 10))
                                cnt = _do_fetch("")
                                return cnt, "Weltweit", fallback_msg
                            except (NoDataError, Exception):
                                return 0, pk_geo, fallback_msg + " Auch weltweit keine Daten."
                        return 0, pk_geo, "Kein Suchvolumen gefunden."

                def _exec_compare(action):
                    """Ruft 2-5 Keywords in EINER Abfrage ab → gemeinsame Skala."""
                    import uuid as _uuid
                    from fetcher import _fetch_multi, NoDataError

                    raw_kws = action.get("keywords", [])
                    cmp_geo = (action.get("geo") or primary_geo).upper()
                    cmp_tf = action.get("timeframe") or "today 12-m"
                    cmp_gprop = action.get("gprop") or ""

                    # Bereinigen und Duplikate entfernen
                    clean_kws = []
                    for k in raw_kws:
                        ck = _clean_kw(k).lower()
                        if ck and ck not in clean_kws:
                            clean_kws.append(ck)

                    if len(clean_kws) < 2:
                        return {}, "Mindestens 2 Keywords nötig für Vergleich"
                    if len(clean_kws) > 5:
                        clean_kws = clean_kws[:5]

                    fg = _uuid.uuid4().hex[:12]  # fetch_group ID

                    _time.sleep(_random.uniform(8, 15))
                    multi_data, backend = _fetch_multi(
                        clean_kws, cmp_geo, cmp_tf, cmp_gprop,
                        workflow=wf, serpapi_key=settings["serpapi_key"],
                        cookies_file=settings["cookies_file"], hl=settings["hl"],
                    )

                    results = {}
                    for kw_text, ts_dict in multi_data.items():
                        # Keyword anlegen/finden
                        existing_kw = Keyword.query.filter_by(
                            keyword=kw_text, geo=cmp_geo, timeframe=cmp_tf,
                            gprop=cmp_gprop, user_id=uid
                        ).first()
                        if existing_kw:
                            kw_obj = existing_kw
                        else:
                            kw_obj = Keyword(
                                keyword=kw_text, geo=cmp_geo, timeframe=cmp_tf,
                                gprop=cmp_gprop, active=True, user_id=uid,
                            )
                            db.session.add(kw_obj)
                            db.session.commit()

                        p2 = Project.query.get(project_id)
                        if p2 and p2 not in kw_obj.kw_projects:
                            kw_obj.kw_projects.append(p2)
                            db.session.commit()

                        all_keyword_ids.append(kw_obj.id)
                        if kw_text not in fetched_kw_names:
                            fetched_kw_names.append(kw_text)

                        cnt = 0
                        for dt, val in ts_dict.items():
                            ex = TrendData.query.filter_by(
                                keyword_id=kw_obj.id, date=dt, run_tag=run_tag
                            ).first()
                            if ex:
                                ex.value = val
                                ex.fetch_group = fg
                            else:
                                db.session.add(TrendData(
                                    keyword_id=kw_obj.id, date=dt,
                                    value=val, run_tag=run_tag,
                                    fetch_group=fg,
                                ))
                            cnt += 1
                        db.session.commit()
                        results[kw_text] = cnt

                    return results, ""

                def _exec_snapshot(action):
                    """Erstellt einen Snapshot mit Kommentar und optionalen Markierungen."""
                    import json as _j2
                    snap_title = action.get("title", f"Analyse: {seed}")
                    snap_comment = action.get("comment", "")
                    snap_keywords = action.get("keywords", [])  # Liste von Keywords für den Chart
                    snap_markers = action.get("markers", [])  # [{date, label, color}]

                    # Keywords für diesen Snapshot bestimmen
                    snap_labels = []
                    snap_datasets = []
                    snap_meta = []
                    ci = 0
                    seen_kw = set()
                    for kid in all_keyword_ids:
                        kw_obj = Keyword.query.get(kid)
                        if not kw_obj:
                            continue
                        # Nur bestimmte Keywords wenn angegeben, sonst alle
                        if snap_keywords and kw_obj.keyword not in snap_keywords:
                            continue
                        if kw_obj.keyword in seen_kw:
                            continue
                        seen_kw.add(kw_obj.keyword)
                        trends = TrendData.query.filter_by(
                            keyword_id=kid, run_tag=run_tag
                        ).order_by(TrendData.date).all()
                        if not trends:
                            continue
                        labels = [t.date.strftime("%Y-%m-%d") for t in trends]
                        values = [t.value for t in trends]
                        if not snap_labels or len(labels) > len(snap_labels):
                            snap_labels = labels
                        color = colors[ci % len(colors)]
                        snap_datasets.append({
                            "label": kw_obj.keyword,
                            "data": values,
                            "borderColor": color,
                            "backgroundColor": color,
                            "borderWidth": 2,
                            "pointRadius": 0,
                            "fill": False,
                        })
                        snap_meta.append({
                            "keyword": kw_obj.keyword, "color": color,
                            "geo": kw_obj.geo, "gprop": kw_obj.gprop or "",
                            "timeframe": kw_obj.timeframe or "",
                        })
                        ci += 1

                    if not snap_datasets:
                        return None

                    # Duplikat-Check: gleiche Keyword-Kombination bereits als Snapshot?
                    new_kw_set = frozenset(d["label"] for d in snap_datasets)
                    if new_kw_set in created_snapshot_kw_sets:
                        return "duplicate"
                    created_snapshot_kw_sets.add(new_kw_set)

                    # Markierungen konvertieren – date → label_idx für Chart-Darstellung
                    markers_list = []
                    for mi, m in enumerate(snap_markers):
                        m_date = m.get("date", "")
                        m_label = m.get("label", "")
                        # label_idx berechnen: Position des Datums im Labels-Array
                        label_idx = 0
                        if m_date and snap_labels:
                            try:
                                label_idx = snap_labels.index(m_date)
                            except ValueError:
                                # Nächstes verfügbares Datum suchen
                                for li, lbl in enumerate(snap_labels):
                                    if lbl >= m_date:
                                        label_idx = li
                                        break
                                else:
                                    label_idx = len(snap_labels) - 1
                        markers_list.append({
                            "num": mi + 1,
                            "label_idx": label_idx,
                            "label": m_label,
                            "comment": m_label,
                        })

                    max_so = db.session.query(
                        db.func.max(Snapshot.sort_order)
                    ).filter_by(project_id=project_id).scalar() or 0
                    snap = Snapshot(
                        title=snap_title,
                        comment=snap_comment,
                        chart_json=_j2.dumps({
                            "labels": snap_labels,
                            "datasets": snap_datasets,
                            "keywords_meta": snap_meta,
                            "visible_range": {},
                        }, ensure_ascii=False),
                        markers_json=_j2.dumps(markers_list, ensure_ascii=False),
                        sort_order=max_so + 1,
                        project_id=project_id,
                        user_id=uid,
                    )
                    snap.compute_hash()
                    db.session.add(snap)
                    db.session.commit()
                    return snap.id

                created_snapshot_kw_sets = set()  # verhindert identische Snapshot-Charts

                def _exec_news_scan(action):
                    """Durchsucht Nachrichtenquellen und legt gefundene Schlüsselereignisse als Events an."""
                    import requests as _req_news
                    query = action.get("query", seed)
                    from_date = action.get("from", "")
                    to_date = action.get("to", "")
                    max_events = min(int(action.get("max_events", 5)), 10)

                    # Google News RSS als primäre Quelle
                    UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0"
                    search_q = query
                    if from_date:
                        search_q += f" after:{from_date}"
                    if to_date:
                        search_q += f" before:{to_date}"

                    # Sprachkontext bestimmen
                    lang_key = ""
                    if primary_geo in ("US", "GB", "AU", "CA"):
                        lang_key = "English"
                    elif primary_geo == "FR":
                        lang_key = "French"
                    elif primary_geo == "ES":
                        lang_key = "Spanish"
                    hl, gl, ceid, _ = _GNEWS_LANG_MAP.get(lang_key, _GNEWS_LANG_MAP[""])

                    items = []
                    try:
                        r = _req_news.get(
                            "https://news.google.com/rss/search",
                            params={"q": search_q, "hl": hl, "gl": gl, "ceid": ceid},
                            headers={"User-Agent": UA},
                            timeout=15,
                        )
                        r.raise_for_status()
                        items = _rss_parse_items(r.text)
                    except Exception as exc:
                        log.warning("APA News-Scan fehlgeschlagen: %s", exc)
                        return [], f"News-Suche fehlgeschlagen: {str(exc)[:80]}"

                    if not items:
                        return [], "Keine Nachrichtenartikel gefunden"

                    # Chronologisch sortieren (älteste zuerst)
                    items.sort(key=lambda x: x.get("seendate", ""))

                    # Deduplizieren und auf max_events begrenzen
                    seen_titles = set()
                    unique = []
                    for it in items:
                        t_clean = it["title"].lower().strip()[:60]
                        if t_clean not in seen_titles:
                            seen_titles.add(t_clean)
                            unique.append(it)
                    items = unique[:max_events]

                    # Events anlegen
                    created_events = []
                    for it in items:
                        dt_str = it.get("seendate", "")
                        if not dt_str:
                            continue
                        try:
                            ev_dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00")).replace(tzinfo=None)
                        except Exception:
                            continue
                        # Prüfen ob bereits ein ähnliches Event existiert
                        existing = Event.query.filter(
                            Event.user_id == uid,
                            Event.project_id == project_id,
                            Event.start_dt == ev_dt,
                        ).first()
                        if existing:
                            continue
                        ev = Event(
                            title=it["title"][:200],
                            description=f"Quelle: {it.get('domain', '?')} | {it.get('url', '')}",
                            event_type="point",
                            start_dt=ev_dt,
                            color="#f59e0b",  # Gelb für auto-erkannte News-Events
                            project_id=project_id,
                            user_id=uid,
                        )
                        db.session.add(ev)
                        created_events.append({
                            "title": it["title"],
                            "date": ev_dt.strftime("%Y-%m-%d"),
                            "source": it.get("domain", ""),
                        })
                    if created_events:
                        db.session.commit()
                    return created_events, None

                def _exec_event_probe(action):
                    """Zieht Kurzfenster-Daten (1d/7d) um ein Ereignisdatum,
                    um Suchspuren VOR dem Ereignis zu erkennen (Vorwissen/Planung)."""
                    from fetcher import NoDataError
                    event_date = action.get("date", "")  # YYYY-MM-DD
                    kw_list = action.get("keywords", [seed])
                    window = action.get("window", "7d")  # "1d" oder "7d"

                    if not event_date:
                        return [], "Kein Ereignisdatum angegeben"

                    try:
                        ev_dt = datetime.strptime(event_date, "%Y-%m-%d")
                    except ValueError:
                        return [], f"Ungültiges Datum: {event_date}"

                    # Zeitfenster berechnen
                    if window == "1d":
                        # 1 Tag vor bis 1 Tag nach dem Ereignis
                        start = (ev_dt - timedelta(days=1)).strftime("%Y-%m-%d")
                        end = (ev_dt + timedelta(days=1)).strftime("%Y-%m-%d")
                        tf = f"{start} {end}"
                    else:
                        # 7 Tage vor bis 7 Tage nach dem Ereignis
                        start = (ev_dt - timedelta(days=7)).strftime("%Y-%m-%d")
                        end = (ev_dt + timedelta(days=7)).strftime("%Y-%m-%d")
                        tf = f"{start} {end}"

                    probe_results = []
                    for kw_text in kw_list[:5]:
                        pk_text = _clean_kw(kw_text).lower()
                        if not pk_text:
                            continue
                        pk_geo = (action.get("geo") or primary_geo).upper()

                        # Keyword anlegen/finden
                        existing_kw = Keyword.query.filter_by(
                            keyword=pk_text, geo=pk_geo, timeframe=tf,
                            gprop="", user_id=uid
                        ).first()
                        if existing_kw:
                            kw2 = existing_kw
                        else:
                            kw2 = Keyword(
                                keyword=pk_text, geo=pk_geo, timeframe=tf,
                                gprop="", active=True, user_id=uid,
                            )
                            db.session.add(kw2)
                            db.session.commit()

                        p2 = Project.query.get(project_id)
                        if p2 and p2 not in kw2.kw_projects:
                            kw2.kw_projects.append(p2)
                            db.session.commit()

                        if kw2.id not in all_keyword_ids:
                            all_keyword_ids.append(kw2.id)

                        # Probe-Tag für Kurzfenster-Daten
                        probe_tag = f"{run_tag}-probe-{event_date}-{window}"

                        _time.sleep(_random.uniform(6, 12))
                        try:
                            data2, _ = _fetch_single(
                                kw2.keyword, pk_geo, tf, "",
                                workflow=wf, serpapi_key=settings["serpapi_key"],
                                cookies_file=settings["cookies_file"], hl=settings["hl"],
                            )
                        except Exception as exc:
                            probe_results.append({
                                "keyword": pk_text, "error": str(exc)[:80],
                            })
                            continue

                        cnt = 0
                        pre_event = []
                        post_event = []
                        if data2:
                            for dt, val in data2.items():
                                ex = TrendData.query.filter_by(
                                    keyword_id=kw2.id, date=dt, run_tag=probe_tag
                                ).first()
                                if ex:
                                    ex.value = val
                                else:
                                    db.session.add(TrendData(
                                        keyword_id=kw2.id, date=dt,
                                        value=val, run_tag=probe_tag,
                                    ))
                                cnt += 1
                                # Vor/nach Ereignis klassifizieren
                                if hasattr(dt, 'date'):
                                    d = dt.date() if hasattr(dt, 'date') else dt
                                else:
                                    d = dt
                                ev_d = ev_dt.date()
                                if d < ev_d:
                                    pre_event.append(val)
                                else:
                                    post_event.append(val)
                            db.session.commit()

                        # Forensische Auswertung: Suchspuren VOR dem Ereignis
                        pre_avg = sum(pre_event) / len(pre_event) if pre_event else 0
                        post_avg = sum(post_event) / len(post_event) if post_event else 0
                        pre_max = max(pre_event) if pre_event else 0

                        signal = "neutral"
                        if pre_event and post_event:
                            if pre_avg > post_avg * 0.8 and pre_max > 20:
                                signal = "VORWISSEN-INDIKATOR"
                            elif pre_max > 0 and post_avg > pre_avg * 2:
                                signal = "reaktiv (normal)"
                            elif pre_avg > 0 and post_avg == 0:
                                signal = "AUFFÄLLIG: Suche nur VOR Ereignis"

                        probe_results.append({
                            "keyword": pk_text,
                            "window": window,
                            "event_date": event_date,
                            "datapoints": cnt,
                            "pre_event_avg": round(pre_avg, 1),
                            "pre_event_max": pre_max,
                            "post_event_avg": round(post_avg, 1),
                            "signal": signal,
                        })

                    return probe_results, None

                def _exec_wiki_views(action):
                    """Ruft Wikipedia-Pageviews für Artikel ab (öffentliche Wikimedia-API, kein Key nötig).
                    Liefert tägliche Abrufzahlen – unabhängiges Signal neben Google Trends."""
                    import requests as _req_wiki
                    articles = action.get("articles", [seed])
                    wiki_lang = action.get("lang", "de")  # de, en, fr, es, ru, ...
                    days = min(int(action.get("days", 365)), 730)

                    end_dt = datetime.now()
                    start_dt = end_dt - timedelta(days=days)
                    start_str = start_dt.strftime("%Y%m%d")
                    end_str = end_dt.strftime("%Y%m%d")

                    UA = "VeriTrend.ai/1.0 (forensic trend analysis; contact@veritrend.ai)"
                    wiki_results = []

                    for article in articles[:5]:
                        article_clean = article.strip().replace(" ", "_")
                        if not article_clean:
                            continue
                        url = (
                            f"https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/"
                            f"{wiki_lang}.wikipedia/all-access/all-agents/"
                            f"{_req_wiki.utils.quote(article_clean, safe='')}/daily/{start_str}/{end_str}"
                        )
                        try:
                            r = _req_wiki.get(url, headers={"User-Agent": UA}, timeout=15)
                            if r.status_code == 404:
                                wiki_results.append({
                                    "article": article, "lang": wiki_lang,
                                    "error": "Artikel nicht gefunden",
                                })
                                continue
                            r.raise_for_status()
                            data = r.json()
                            items = data.get("items", [])
                            if not items:
                                wiki_results.append({
                                    "article": article, "lang": wiki_lang,
                                    "error": "Keine Daten",
                                })
                                continue

                            views = [it.get("views", 0) for it in items]
                            dates = [it.get("timestamp", "")[:8] for it in items]  # YYYYMMDD

                            # Statistiken
                            total = sum(views)
                            avg = total / len(views) if views else 0
                            max_val = max(views) if views else 0
                            max_idx = views.index(max_val) if views else 0
                            max_date = dates[max_idx] if dates else ""
                            if max_date:
                                max_date = f"{max_date[:4]}-{max_date[4:6]}-{max_date[6:8]}"

                            # Trend-Richtung
                            direction = "stabil"
                            if len(views) >= 14:
                                q = len(views) // 4 or 1
                                avg_start = sum(views[:q]) / q
                                avg_end = sum(views[-q:]) / q
                                if avg_end > avg_start * 1.3:
                                    direction = "steigend"
                                elif avg_end < avg_start * 0.7:
                                    direction = "fallend"

                            # Spikes erkennen (> 3x Durchschnitt)
                            spikes = []
                            if avg > 0:
                                for i, v in enumerate(views):
                                    if v > avg * 3 and i < len(dates):
                                        d = dates[i]
                                        spike_date = f"{d[:4]}-{d[4:6]}-{d[6:8]}" if len(d) == 8 else d
                                        spikes.append({"date": spike_date, "views": v, "factor": round(v / avg, 1)})
                                spikes.sort(key=lambda x: x["views"], reverse=True)
                                spikes = spikes[:5]

                            # Erste/letzte 7 Tage für Kontext
                            first7 = views[:7]
                            last7 = views[-7:]

                            wiki_results.append({
                                "article": article, "lang": wiki_lang,
                                "datapoints": len(views),
                                "total_views": total,
                                "avg_daily": round(avg, 0),
                                "max_views": max_val,
                                "max_date": max_date,
                                "direction": direction,
                                "spikes": spikes,
                                "first7_avg": round(sum(first7) / len(first7), 0) if first7 else 0,
                                "last7_avg": round(sum(last7) / len(last7), 0) if last7 else 0,
                            })
                        except Exception as exc:
                            wiki_results.append({
                                "article": article, "lang": wiki_lang,
                                "error": str(exc)[:80],
                            })

                    return wiki_results, None

                def _exec_gdelt_volume(action):
                    """Ruft GDELT DOC 2.0 Medien-Artikelanzahl pro Tag ab (kein API-Key nötig).
                    Zeigt, wie intensiv ein Thema in weltweiten Nachrichtenmedien behandelt wird."""
                    import requests as _req_gdelt
                    import csv as _csv_gdelt
                    import io as _io_gdelt

                    terms = action.get("terms", [seed])
                    days = min(int(action.get("days", 180)), 365)

                    if days <= 30:
                        timespan_str = f"{days}d"
                    else:
                        months = max(1, days // 30)
                        timespan_str = f"{months}m"

                    gdelt_results = []
                    for term in terms[:5]:
                        term = term.strip()
                        if not term:
                            continue
                        url = (
                            f"https://api.gdeltproject.org/api/v2/doc/doc"
                            f"?query={_req_gdelt.utils.quote(term)}"
                            f"&mode=timelinevolraw&timespan={timespan_str}&format=csv&TIMERES=day"
                        )
                        try:
                            r = _req_gdelt.get(url, timeout=20)
                            r.raise_for_status()
                            text = r.text.strip()
                            if text.startswith("\ufeff"):
                                text = text[1:]
                            if not text:
                                gdelt_results.append({"term": term, "error": "Keine Daten"})
                                continue

                            reader = _csv_gdelt.reader(_io_gdelt.StringIO(text))
                            counts = []
                            header_skipped = False
                            for row in reader:
                                if len(row) < 3:
                                    continue
                                if not header_skipped:
                                    header_skipped = True
                                    if row[0].strip().lower() == "date":
                                        continue
                                if row[1].strip() != "Article Count":
                                    continue
                                try:
                                    counts.append(int(float(row[2].strip())))
                                except (ValueError, IndexError):
                                    continue

                            if not counts:
                                gdelt_results.append({"term": term, "error": "Keine Artikeldaten"})
                                continue

                            total = sum(counts)
                            avg = total / len(counts)
                            max_val = max(counts)
                            min_val = min(counts)

                            # Trend-Richtung
                            direction = "stabil"
                            if len(counts) >= 14:
                                q = len(counts) // 4 or 1
                                avg_start = sum(counts[:q]) / q
                                avg_end = sum(counts[-q:]) / q
                                if avg_end > avg_start * 1.3:
                                    direction = "steigend"
                                elif avg_end < avg_start * 0.7:
                                    direction = "fallend"

                            # Spikes (> 3x Durchschnitt)
                            spikes = []
                            if avg > 0:
                                for i, c in enumerate(counts):
                                    if c > avg * 3:
                                        spikes.append({"index": i, "count": c, "factor": round(c / avg, 1)})
                                spikes.sort(key=lambda x: x["count"], reverse=True)
                                spikes = spikes[:5]

                            gdelt_results.append({
                                "term": term,
                                "datapoints": len(counts),
                                "total_articles": total,
                                "avg_daily": round(avg, 0),
                                "max_daily": max_val,
                                "min_daily": min_val,
                                "direction": direction,
                                "spikes_count": len(spikes),
                                "first7_avg": round(sum(counts[:7]) / min(7, len(counts)), 0),
                                "last7_avg": round(sum(counts[-7:]) / min(7, len(counts)), 0),
                            })
                        except Exception as exc:
                            gdelt_results.append({"term": term, "error": str(exc)[:80]})

                    return gdelt_results, None

                def _exec_yahoo_finance(action):
                    """Ruft Yahoo Finance Kursdaten ab. Zeigt Marktbewegungen und Volatilität."""
                    import yfinance as yf

                    symbols = action.get("symbols", [])
                    days = min(int(action.get("days", 180)), 730)

                    if not symbols:
                        return [], "Keine Ticker-Symbole angegeben"

                    yf_results = []
                    for symbol in [s.strip().upper() for s in symbols[:5] if s.strip()]:
                        try:
                            tk = yf.Ticker(symbol)
                            hist = tk.history(period=f"{days}d")
                            if hist.empty:
                                yf_results.append({"symbol": symbol, "error": "Keine Daten"})
                                continue

                            closes = hist["Close"].dropna().tolist()
                            volumes = hist["Volume"].dropna().tolist()
                            dates = [d.strftime("%Y-%m-%d") for d in hist.index]

                            if not closes:
                                yf_results.append({"symbol": symbol, "error": "Keine Kursdaten"})
                                continue

                            avg_price = sum(closes) / len(closes)
                            max_price = max(closes)
                            min_price = min(closes)
                            max_idx = closes.index(max_price)
                            min_idx = closes.index(min_price)
                            last_price = closes[-1]
                            first_price = closes[0]
                            change_pct = ((last_price - first_price) / first_price * 100) if first_price else 0

                            # Trend-Richtung
                            direction = "stabil"
                            if len(closes) >= 14:
                                q = len(closes) // 4 or 1
                                avg_start = sum(closes[:q]) / q
                                avg_end = sum(closes[-q:]) / q
                                if avg_end > avg_start * 1.1:
                                    direction = "steigend"
                                elif avg_end < avg_start * 0.9:
                                    direction = "fallend"

                            # Volatilität (Standardabweichung der täglichen Renditen)
                            daily_returns = [(closes[i] - closes[i-1]) / closes[i-1]
                                             for i in range(1, len(closes)) if closes[i-1]]
                            volatility = 0
                            if daily_returns:
                                mean_r = sum(daily_returns) / len(daily_returns)
                                volatility = (sum((r - mean_r)**2 for r in daily_returns) / len(daily_returns)) ** 0.5

                            # Große Tagesschwankungen (>3%)
                            big_moves = []
                            for i, r in enumerate(daily_returns):
                                if abs(r) > 0.03 and (i + 1) < len(dates):
                                    big_moves.append({
                                        "date": dates[i + 1],
                                        "change_pct": round(r * 100, 2),
                                    })
                            big_moves.sort(key=lambda x: abs(x["change_pct"]), reverse=True)
                            big_moves = big_moves[:5]

                            # Volumen-Spikes
                            avg_vol = sum(volumes) / len(volumes) if volumes else 0
                            vol_spikes = []
                            if avg_vol > 0:
                                for i, v in enumerate(volumes):
                                    if v > avg_vol * 3 and i < len(dates):
                                        vol_spikes.append({"date": dates[i], "volume": int(v), "factor": round(v / avg_vol, 1)})
                                vol_spikes.sort(key=lambda x: x["volume"], reverse=True)
                                vol_spikes = vol_spikes[:5]

                            # Info
                            info = tk.info if hasattr(tk, "info") else {}
                            currency = info.get("currency", "")
                            name = info.get("shortName") or info.get("longName") or symbol

                            yf_results.append({
                                "symbol": symbol,
                                "name": name,
                                "currency": currency,
                                "datapoints": len(closes),
                                "last_price": round(last_price, 2),
                                "avg_price": round(avg_price, 2),
                                "max_price": round(max_price, 2),
                                "max_date": dates[max_idx] if max_idx < len(dates) else "",
                                "min_price": round(min_price, 2),
                                "min_date": dates[min_idx] if min_idx < len(dates) else "",
                                "change_pct": round(change_pct, 2),
                                "direction": direction,
                                "volatility": round(volatility * 100, 3),
                                "big_moves": big_moves,
                                "vol_spikes": vol_spikes,
                                "first7_avg": round(sum(closes[:7]) / min(7, len(closes)), 2),
                                "last7_avg": round(sum(closes[-7:]) / min(7, len(closes)), 2),
                            })
                        except Exception as exc:
                            yf_results.append({"symbol": symbol, "error": str(exc)[:80]})

                    return yf_results, None

                def _exec_ndvi_analysis(action):
                    """Ruft NDVI-Vegetationsindex via Sentinel-2 ab. Zeigt Landveränderungen."""
                    from plugins.watchzone.ndvi._transport import fetch_sentinel_ndvi_stats
                    from transport import CopernicusAuthError

                    bbox = action.get("bbox", [])  # [lon_min, lat_min, lon_max, lat_max]
                    days = min(int(action.get("days", 365)), 730)
                    label = action.get("label", "Region")

                    if not bbox or len(bbox) != 4:
                        return [], "bbox muss [lon_min, lat_min, lon_max, lat_max] sein"

                    try:
                        bbox = [float(b) for b in bbox]
                    except (ValueError, TypeError):
                        return [], "bbox-Koordinaten müssen Zahlen sein"

                    end_dt = datetime.now()
                    start_dt = end_dt - timedelta(days=days)
                    date_from = start_dt.strftime("%Y-%m-%d")
                    date_to = end_dt.strftime("%Y-%m-%d")

                    try:
                        stats = fetch_sentinel_ndvi_stats(bbox, date_from, date_to)
                    except CopernicusAuthError as e:
                        return [], f"Copernicus-Auth-Fehler: {str(e)[:80]}"
                    except Exception as e:
                        return [], f"Sentinel-API-Fehler: {str(e)[:80]}"

                    if not stats:
                        return [], "Keine NDVI-Daten für diesen Bereich/Zeitraum"

                    values = [s["mean_ndvi"] for s in stats if s.get("mean_ndvi") is not None]
                    dates = [s["date"] for s in stats if s.get("mean_ndvi") is not None]

                    if not values:
                        return [], "Keine gültigen NDVI-Messwerte"

                    avg_ndvi = sum(values) / len(values)
                    max_ndvi = max(values)
                    min_ndvi = min(values)
                    max_idx = values.index(max_ndvi)
                    min_idx = values.index(min_ndvi)

                    # Trend
                    direction = "stabil"
                    if len(values) >= 6:
                        q = len(values) // 4 or 1
                        avg_start = sum(values[:q]) / q
                        avg_end = sum(values[-q:]) / q
                        if avg_end > avg_start + 0.05:
                            direction = "steigend (Begrünung)"
                        elif avg_end < avg_start - 0.05:
                            direction = "fallend (Vegetation nimmt ab)"

                    # Anomalien: plötzliche Einbrüche/Anstiege
                    anomalies = []
                    WINDOW = 6
                    THRESHOLD = 0.12
                    for i in range(WINDOW, len(values)):
                        rolling_avg = sum(values[i-WINDOW:i]) / WINDOW
                        delta = values[i] - rolling_avg
                        if abs(delta) > THRESHOLD:
                            anomalies.append({
                                "date": dates[i] if i < len(dates) else "",
                                "ndvi": round(values[i], 3),
                                "delta": round(delta, 3),
                                "type": "Einbruch" if delta < 0 else "Anstieg",
                            })
                    anomalies.sort(key=lambda x: abs(x["delta"]), reverse=True)
                    anomalies = anomalies[:5]

                    result = {
                        "label": label,
                        "bbox": bbox,
                        "datapoints": len(values),
                        "period": f"{date_from} bis {date_to}",
                        "avg_ndvi": round(avg_ndvi, 3),
                        "max_ndvi": round(max_ndvi, 3),
                        "max_date": dates[max_idx] if max_idx < len(dates) else "",
                        "min_ndvi": round(min_ndvi, 3),
                        "min_date": dates[min_idx] if min_idx < len(dates) else "",
                        "direction": direction,
                        "anomalies": anomalies,
                        "first_avg": round(sum(values[:3]) / min(3, len(values)), 3) if values else 0,
                        "last_avg": round(sum(values[-3:]) / min(3, len(values)), 3) if values else 0,
                    }

                    return [result], None

                def _exec_wiki_edits(action):
                    """Ruft Wikipedia-Bearbeitungshistorie ab und analysiert Autoren + IPs.
                    Forensisch relevant: Wer bearbeitet einen Artikel, von wo, mit welcher Reputation?"""
                    import requests as _req_we
                    from collections import Counter as _Counter_we

                    articles = action.get("articles", [seed])
                    wiki_lang = action.get("lang", "de")
                    days = min(int(action.get("days", 365)), 730)
                    UA = "VeriTrend.ai/1.0 (forensic trend analysis; contact@veritrend.ai)"

                    end_dt = datetime.now(timezone.utc)
                    start_dt = end_dt - timedelta(days=days)

                    results = []
                    for article in [a.strip() for a in articles[:5] if a.strip()]:
                        try:
                            # Titel auflösen
                            sr = _req_we.get(
                                f"https://{wiki_lang}.wikipedia.org/w/api.php",
                                params={"action": "query", "list": "search",
                                        "srsearch": article, "srlimit": 1, "format": "json"},
                                headers={"User-Agent": UA}, timeout=10)
                            hits = sr.json().get("query", {}).get("search", []) if sr.ok else []
                            wiki_title = hits[0]["title"] if hits else article

                            # Revisionen abrufen (paginiert)
                            edits_per_day = _Counter_we()
                            users = _Counter_we()
                            ip_edits = 0
                            reg_edits = 0
                            total_revisions = 0
                            rvcontinue = None
                            import re as _re_ip_we

                            for _ in range(20):
                                params = {
                                    "action": "query", "prop": "revisions",
                                    "titles": wiki_title,
                                    "rvprop": "timestamp|user",
                                    "rvlimit": "500",
                                    "rvstart": end_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
                                    "rvend": start_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
                                    "format": "json",
                                }
                                if rvcontinue:
                                    params["rvcontinue"] = rvcontinue

                                r = _req_we.get(
                                    f"https://{wiki_lang}.wikipedia.org/w/api.php",
                                    params=params, headers={"User-Agent": UA}, timeout=15)
                                r.raise_for_status()
                                data = r.json()
                                pages = data.get("query", {}).get("pages", {})
                                for pid, page in pages.items():
                                    if pid == "-1":
                                        break
                                    for rev in page.get("revisions", []):
                                        ts = rev.get("timestamp", "")[:10]
                                        user = rev.get("user", "")
                                        if ts:
                                            edits_per_day[ts] += 1
                                            total_revisions += 1
                                        is_ip = bool(_re_ip_we.match(
                                            r"^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-fA-F:]+$", user
                                        )) if user else False
                                        if is_ip:
                                            ip_edits += 1
                                        else:
                                            reg_edits += 1
                                            users[user] += 1
                                cont = data.get("continue", {})
                                rvcontinue = cont.get("rvcontinue")
                                if not rvcontinue:
                                    break

                            if not total_revisions:
                                results.append({"article": article, "wiki_title": wiki_title,
                                                "error": "Keine Bearbeitungen im Zeitraum"})
                                continue

                            # Spikes (Tage mit >3x Durchschnitt)
                            counts = list(edits_per_day.values())
                            avg_daily = total_revisions / max(1, days)
                            edit_spikes = []
                            if avg_daily > 0:
                                for date, cnt in sorted(edits_per_day.items()):
                                    if cnt > avg_daily * 3:
                                        edit_spikes.append({"date": date, "edits": cnt,
                                                            "factor": round(cnt / avg_daily, 1)})
                                edit_spikes.sort(key=lambda x: x["edits"], reverse=True)
                                edit_spikes = edit_spikes[:5]

                            # Top-Autoren
                            top_authors = [{"user": u, "edits": c}
                                           for u, c in users.most_common(10)]

                            # Reputations-Check der Top-Autoren
                            top_names = [a["user"] for a in top_authors[:10]]
                            if top_names:
                                try:
                                    ui_resp = _req_we.get(
                                        f"https://{wiki_lang}.wikipedia.org/w/api.php",
                                        params={"action": "query", "list": "users",
                                                "ususers": "|".join(top_names[:50]),
                                                "usprop": "editcount|registration|groups|blockinfo",
                                                "format": "json"},
                                        headers={"User-Agent": UA}, timeout=15)
                                    if ui_resp.ok:
                                        for u in ui_resp.json().get("query", {}).get("users", []):
                                            for a in top_authors:
                                                if a["user"] == u.get("name"):
                                                    a["total_editcount"] = u.get("editcount", 0)
                                                    groups = [g for g in u.get("groups", [])
                                                              if g not in ("*", "user", "autoconfirmed")]
                                                    a["groups"] = groups
                                                    a["blocked"] = "blockid" in u
                                except Exception:
                                    pass

                            results.append({
                                "article": article,
                                "wiki_title": wiki_title,
                                "lang": wiki_lang,
                                "total_edits": total_revisions,
                                "registered_edits": reg_edits,
                                "anonymous_edits": ip_edits,
                                "anonymous_pct": round(ip_edits / total_revisions * 100, 1) if total_revisions else 0,
                                "avg_daily": round(avg_daily, 2),
                                "edit_spikes": edit_spikes,
                                "top_authors": top_authors,
                                "unique_authors": len(users),
                            })
                        except Exception as exc:
                            results.append({"article": article, "error": str(exc)[:80]})

                    return results, None

                # ── 4. Zwei-Agenten-Architektur ──────────────────────────────
                # Koordinator: plant strategisch, denkt um die Ecke
                # Rechercheur: führt Abrufe aus, bewertet Daten, berichtet

                coordinator_history = []  # Verlauf der Koordinator-Entscheidungen
                researcher_reports = []   # Berichte des Rechercheurs an den Koordinator
                apa_snapshot_ids = []     # IDs der während der Analyse erstellten Snapshots
                generate._critic_feedback = ""  # Kritiker-Feedback für Coordinator
                generate._critic_report = ""    # Kritiker-Gesamtbericht für Report

                for iteration in range(max_iterations):

                    # ── KOORDINATOR ──────────────────────────────────────────
                    yield sse({"type": "status", "msg": f"Iteration {iteration+1} – Koordinator plant …"})

                    context = _build_context()
                    already_fetched = set(fetched_kw_names)

                    history_block = ""
                    if coordinator_history:
                        history_block = "\nBISHERIGER VERLAUF:\n" + "\n".join(
                            f"  Runde {i+1}: {h}" for i, h in enumerate(coordinator_history)
                        ) + "\n"

                    reports_block = ""
                    if researcher_reports:
                        reports_block = "\nBERICHTE DEINER RECHERCHEURE:\n(Jeder Bericht enthält Ergebnisse von zwei Spezialisten: TREND = Verlaufsdaten-Analyst, RELATED = Verwandte-Suchanfragen-Analyst)\n" + "\n".join(
                            f"  Runde {i+1}: {r}" for i, r in enumerate(researcher_reports)
                        ) + "\n"

                    # Projektübergreifendes Gedächtnis (nur in erster Iteration laden)
                    memory_block = ""
                    if iteration == 0:
                        try:
                            mem = _build_cross_project_memory()
                            if mem:
                                memory_block = "\n" + mem + "\n"
                        except Exception as e:
                            log.warning("Cross-project memory Fehler: %s", e)

                    # Kritiker-Feedback aus letzter Runde
                    critic_block = ""
                    if hasattr(generate, '_critic_feedback') and generate._critic_feedback:
                        critic_block = "\nKRITIKER-FEEDBACK (aus vorheriger Runde):\n" + generate._critic_feedback + "\nBerücksichtige diese Kritik in deiner weiteren Strategie!\n"

                    coordinator_prompt = f"""Du bist der KOORDINATOR eines Google-Trends-Forschungsteams.
Deine Aufgabe ist es, eine Recherchestrategie zu entwickeln und den Rechercheur anzuleiten.

Seed-Keyword: "{seed}"
Primärer Geo-Kontext: {primary_geo or 'Weltweit'}
Sprache des Seed-Keywords: {lang if 'lang' in dir() else 'unbekannt'}
Intensität: {intensity}/5
{('Briefing: ' + briefing) if briefing else ''}
Iteration: {iteration+1} (Max: {max_iterations})

BISHERIGE DATEN:
{context}

BEREITS ABGERUFENE KEYWORDS: {', '.join(already_fetched)}
{_apa_news_context}
{history_block}{reports_block}{memory_block}{critic_block}
NETZWERK-FORENSIK / WATCHZONE-DATEN:
Im Abschnitt "ÜBERWACHTE DOMAINS / WATCHZONES" der bisherigen Daten findest du ggf. Ergebnisse
aus Traceroute-Analysen überwachter Websites. Beziehe diese in deine Analyse ein:
- Anomalien wie "BGP-Routing-Anomalie" können auf Routing-Manipulation oder Anycast-Infrastruktur hinweisen
- "Geografischer Umweg" bedeutet, dass Datenpakete einen deutlich längeren Weg nehmen als nötig
- "RTT-Sprung" zeigt ungewöhnlich hohe Latenzzunahme zwischen zwei Hops
- Anonyme Hops (***) verschleiern Zwischenknoten; die RTT-Differenz gibt Auskunft über mögliche Reichweite
- Viele Kilometer bei geringer Latenz deuten auf Glasfaserverbindungen; hohe Latenz bei kurzer Distanz auf Umwege
- Der Standort des Zielservers (letzter Hop) zeigt, wo Daten physisch verarbeitet werden
Diese Netzwerkdaten sind forensisch relevant für Fragen zu Hosting-Infrastruktur, Zensur-Routing,
Content-Delivery-Manipulation oder staatlicher Einflussnahme auf Routing-Pfade.

WICHTIG – VERGLEICHBARKEIT DER DATEN:
Google Trends liefert relative Werte (0-100) pro Abfrage. Ohne ein gemeinsames Referenz-Keyword
in derselben Abfrage lassen sich die Werte verschiedener Abrufe NICHT quantitativ vergleichen.
Nur die Trendentwicklung (Verlauf über Zeit) ist zwischen verschiedenen Abfragen aussagekräftig.
Wenn du Keywords quantitativ vergleichen willst, MÜSSEN sie in einer gemeinsamen Abfrage stehen.

DEINE ROLLE ALS KOORDINATOR:
Du denkst STRATEGISCH und planst die nächsten Schritte. Du führst selbst keine Abrufe durch.

HYPOTHESEN-GETRIEBENE FORSCHUNG:
Du arbeitest HYPOTHESEN-BASIERT. In JEDER Iteration:
1. Formuliere eine EXPLIZITE HYPOTHESE basierend auf den bisherigen Daten
   (z.B. "Hypothese: Der Anstieg von X korreliert mit Ereignis Y")
2. Beauftrage Abrufe/Analysen, die diese Hypothese PRÜFEN – idealerweise auch WIDERLEGEN könnten
3. Bewerte nach den Rechercheur-Berichten: Wurde die Hypothese bestätigt, widerlegt oder bleibt sie offen?
4. Formuliere ggf. eine neue/angepasste Hypothese für die nächste Runde
Eine gute Forschungsstrategie sucht AKTIV nach Gegenbelegen, nicht nur nach Bestätigung!

HINTERLEGTE EREIGNISSE:
Im Kontext können vom Nutzer hinterlegte Ereignisse aufgeführt sein (z.B. Produktlaunches, politische Ereignisse,
Kampagnen). Beziehe diese in deine Analyse ein! Sie können Trend-Änderungen erklären und sind wertvolle
Kontextinformationen für den Abschlussbericht und Snapshots.

WICHTIG – INDIREKTE MESSUNG:
- Viele Fragen lassen sich NICHT direkt messen! Du musst um die Ecke denken.
- "Wer ist die beliebteste Partei?" → Nicht "beliebteste partei" suchen, sondern die einzelnen
  Parteinamen vergleichen (cdu, spd, grüne, afd, fdp …) und deren relatives Suchvolumen analysieren.
- "Wie beliebt ist Putin in Russland?" → Nicht "putin beliebtheit" suchen, sondern z.B.
  "путин" vs. Oppositionsfiguren vergleichen, oder "путин поддержка" vs. "путин протест".
- "Welche Technologie setzt sich durch?" → Die konkreten Technologien einzeln abrufen und vergleichen.
- Frage dich immer: Was würden Menschen bei Google suchen, wenn sie sich für dieses Thema interessieren?
  Die Antwort ist fast nie die Frage selbst, sondern die konkreten Entitäten/Begriffe dahinter.

WICHTIG – SPRACHE UND GEO:
- Keywords MÜSSEN in der Sprache des Ziel-Geos sein!
- Für geo="DE": deutsche Keywords | Für geo="US"/geo="": englische | Für geo="RU": russische, usw.
- Du darfst einen ANDEREN Geo wählen, wenn das Briefing es nahelegt!
  (z.B. Beliebtheit in Russland → geo="RU" mit russischen Keywords)
- Passe die Keyword-Sprache IMMER an den gewählten Geo an!

WICHTIG – SUCHVERHALTEN REALER NUTZER:
- Kürzeste, einfachste Formulierung (Handy-Tipper!)
- Kein "und", keine Artikel, keine regionalen Qualifier wenn Geo das abdeckt
- Im Zweifel: Was würde ein normaler Mensch auf Google tippen?
- Alle Keywords in Kleinbuchstaben

WICHTIG – FORENSISCHES SUCHENDEN-PROFIL:
Frage dich bei JEDEM Keyword: WER sucht das und WARUM? Google-Trends misst nicht abstrakte Relevanz,
sondern reale Suchvorgänge realer Menschen. Unterscheide bewusst zwischen möglichen Suchenden-Profilen:
- BETROFFENE/OPFER: Suchen nach Hilfe, Beratung, Anlaufstellen, Symptomen, Rechten
  (z.B. "stalking hilfe", "anzeige erstatten", "opferberatung")
- TÄTER/PLANENDE: Suchen nach Methoden, Werkzeugen, Vermeidung von Entdeckung
  (z.B. "handy orten verhindern", "spuren löschen", "prepaid anonym")
- MITWISSER/EINGEWEIHTE: Suchen, die Vorwissen verraten – BEVOR ein Ereignis öffentlich wird
  (z.B. Firmenname + "skandal" vor der Veröffentlichung, Personenname vor Verhaftung)
- ÖFFENTLICHKEIT/MEDIEN: Reaktive Suchen NACH Berichterstattung
  (z.B. Nachrichtenthema + Personenname nach Pressekonferenz)
- IDENTITÄTS-VERSCHLEIERUNG: Suchen nach Anonymisierung, Flucht, Neuanfang
  (z.B. "identität wechseln", "auswandern ohne spuren", "konto im ausland")
Diese Unterscheidung ist forensisch entscheidend! Sie beeinflusst:
1. WELCHE Keywords du abrufst (suche gezielt nach Begriffen verschiedener Profile)
2. WIE du Ergebnisse interpretierst (ein Peak bei "fluchtroute" hat eine andere Bedeutung als bei "flüchtlingshilfe")
3. WAS du im Event-Probe suchst (Vorwissen-Indikatoren ergeben nur Sinn bei Täter/Mitwisser-Profilen)
Dokumentiere deine Einschätzung zum Suchenden-Profil in deinem "thinking"-Feld!

DEINE OPTIONEN:
1. "research" – Beauftrage den Rechercheur mit konkreten Abrufen (Liste von Keywords + Begründung)
2. "compare" – Rufe 2-5 Keywords in EINER gemeinsamen Abfrage ab → Werte sind direkt quantitativ vergleichbar!
   Nutze dies gezielt, wenn du Marktanteile, relative Popularität oder quantitative Unterschiede messen willst.
3. "analyze" – Führe eine statistische Analyse auf den vorhandenen Daten aus:
   Verfügbare Methoden:
   - "spike_coincidence": Erkennt gleichzeitige Ausreißer (Spikes) über mehrere Keywords (min. 2 Reihen)
   - "changepoint": Strukturbrüche (Change-Points) mittels PELT-Algorithmus erkennen
   - "rolling_correlation": Gleitende Korrelation zwischen Keyword-Paaren berechnen (min. 2 Reihen)
   - "periodicity": FFT-basierte Periodizitäts-Analyse (einzelnes Keyword)
   - "outliers": Ausreißer erkennen (Z-Score oder IQR, einzelnes Keyword)
   - "decompose": Saisonale Zerlegung in Trend, Saisonalität, Residuum (einzelnes Keyword)
   - "self_similarity": Rekurrenz-Plot / Self-Similarity-Matrix (einzelnes Keyword)
   - "auto_correlate": Findet die Top-3 am stärksten korrelierten Keywords inkl. optimalem Lag (einzelnes Keyword).
     Entdeckt automatisch verwandte Keywords aus dem gesamten Datenbestand des Nutzers.
     Die gefundenen Keywords werden dem Projekt hinzugefügt und ihre Daten abgerufen.
   - "forecast": Zeitreihen-Prognose per Prophet oder ARIMA (einzelnes Keyword).
     Liefert Vorhersagewerte mit Konfidenzintervall. Nutze dies, um zukünftige Trends einzuschätzen.
   Nutze dies, um tiefere Einsichten in die Daten zu gewinnen! Die Ergebnisse fließen in den Bericht ein.
4. "snapshot" – Erstelle einen Analyse-Snapshot zu bisherigen Erkenntnissen
5. "news_scan" – Durchsuche Nachrichtenquellen (Google News) nach Schlüsselereignissen zum Thema.
   HINWEIS: Zum Seed-Keyword wurde BEREITS automatisch ein News-Scan durchgeführt (siehe AKTUELLE NACHRICHTENLAGE).
   Nutze news_scan nur für ANDERE Suchbegriffe, spezifische Zeiträume oder vertiefte Recherche!
   Die gefundenen Nachrichten werden automatisch als Ereignisse im Projekt angelegt und fließen als Kontext ein.
6. "event_probe" – FORENSISCH: Ziehe ein Kurzfenster (1 Tag oder 7 Tage) um ein konkretes Ereignisdatum,
   um Suchspuren VOR dem Ereignis zu erkennen. Das System analysiert automatisch:
   - Gab es Suchvolumen BEVOR das Ereignis eintrat? → Möglicher Indikator für Vorwissen oder Planung
   - War die Suche rein reaktiv (erst NACH dem Ereignis)? → Normales Muster
   - Gab es Suchvolumen NUR VOR dem Ereignis? → Auffällig
   Dies ist forensisch hochrelevant für die Erkennung von Planungsspuren!
7. "wiki_views" – Rufe Wikipedia-Pageviews als UNABHÄNGIGES SIGNAL ab (kein API-Key nötig!).
   Wikipedia-Abrufe sind eine zweite Datenquelle neben Google Trends:
   - Bestätigen oder widerlegen Google-Trends-Muster (Triangulation)
   - Zeigen aktives Informationsinteresse (jemand will LESEN, nicht nur suchen)
   - Spikes in Wikipedia-Pageviews korrelieren oft mit Nachrichtenzyklen
   - Liefern ABSOLUTE Zahlen (im Gegensatz zu Google Trends' relativer 0-100-Skala)
   Nutze dies zur Kreuzvalidierung: Stimmen Google-Trends-Peaks mit Wikipedia-Peaks überein?
8. "wiki_edits" – Analysiere die BEARBEITUNGSHISTORIE von Wikipedia-Artikeln (kein API-Key nötig!).
   Wikipedia-Edits sind forensisch hochrelevant:
   - WER bearbeitet einen Artikel? Registrierte Autoren mit Reputation oder anonyme IPs?
   - WANN wird bearbeitet? Edit-Spikes korrelieren mit PR-Kampagnen, Krisenmanagement, Whitewashing
   - Hoher Anteil anonymer Edits bei kontroversen Themen → mögliche Interessenkonflikte
   - Top-Autoren-Analyse: Reputation, Editcount, Gruppenzugehörigkeit (Admin, Sysop, etc.)
   - Korrelation: Edit-Spikes VOR Nachrichtenereignissen → mögliches Vorwissen/PR-Vorbereitung
   Parameter: articles (Liste von Artikelnamen/Suchbegriffen), lang (default "de"), days (default 365, max 730)
9. "gdelt_volume" – Rufe GDELT-Medienberichterstattung ab (kein API-Key nötig!).
   GDELT überwacht Nachrichtenmedien weltweit und liefert tägliche Artikelanzahlen:
   - Zeigt, wie intensiv ein Thema in den Medien behandelt wird
   - Korrelation mit Google Trends zeigt, ob Suchinteresse mediengetrieben ist
   - Spikes = Medienereignisse (Pressemitteilungen, Skandale, Krisen)
   - Fehlende Medienberichterstattung bei hohem Suchvolumen ist forensisch auffällig
   - Vergleich: Wurde ZUERST gesucht oder ZUERST berichtet? → Hinweis auf Insider/Vorwissen
   Nutze dies zur Unterscheidung: organisches Suchinteresse vs. mediengetriebenes Interesse.
10. "yahoo_finance" – Rufe Yahoo Finance Kursdaten für Aktien, ETFs, Kryptowährungen oder Indizes ab.
   Finanzdaten sind forensisch relevant für:
   - Korrelation zwischen Suchinteresse und Marktbewegungen (z.B. vor Kurseinbrüchen)
   - Insider-Hinweise: Wurde ZUERST gesucht, DANN bewegte sich der Kurs?
   - Volatilitätsspitzen + Volumen-Spikes zeigen Marktreaktionen auf Ereignisse
   - Vergleich: Medienberichterstattung vs. Kursentwicklung vs. Suchvolumen
   Parameter: symbols (Liste von Ticker-Symbolen, z.B. ["AAPL", "SAP.DE", "BTC-USD"]), days (default 180, max 730)
11. "ndvi_analysis" – Rufe Sentinel-2 NDVI-Vegetationsindex für eine Bounding-Box ab (Copernicus-Zugangsdaten nötig!).
   NDVI (Normalized Difference Vegetation Index) zeigt Vegetationsdichte per Satellit:
   - Werte: -1 bis +1 (>0.3 = gesunde Vegetation, <0.1 = karg/urban/Wasser)
   - Plötzliche Einbrüche → Abholzung, Bau, Naturkatastrophen, Brände
   - Plötzliche Anstiege → Renaturierung, Saisonwechsel
   - Forensisch: Baustellenaktivität, illegale Rodung, Umweltveränderungen
   Parameter: bbox ([lon_min, lat_min, lon_max, lat_max]), days (default 365, max 730), label (Ortsname)
12. "seismic_history" – Rufe Erdbebendaten vom USGS ab (kein API-Key nötig!).
   Seismische Daten zeigen Erdbebenaktivität in einer Region:
   - Maximale Magnitude und Anzahl der Beben pro Zeitslot
   - Korrelation mit Suchinteresse (z.B. Infrastrukturschäden, Evakuierungen)
   - Forensisch: Naturkatastrophen-Timeline, Infrastruktur-Impact, Versicherungsbetrug
   Parameter: bbox ([lon_min, lat_min, lon_max, lat_max]), days (default 180, max 730), label (Regionsname)
13. "nightlights_history" – Rufe NASA VIIRS Nachtlicht-Helligkeitsdaten ab (kein API-Key nötig!).
   Nighttime Lights zeigen mittlere Beleuchtungsintensität einer Region über Zeit:
   - Helligkeitsabfall → Stromausfälle, Konflikt, Infrastrukturschäden, Entvölkerung
   - Helligkeitsanstieg → Bauaktivität, Urbanisierung, industrielle Expansion
   - Forensisch: Konfliktzonen, illegale Aktivitäten nachts, Energieversorgungskrisen
   Parameter: bbox ([lon_min, lat_min, lon_max, lat_max]), days (default 180, max 365), label (Regionsname)
14. "weather_history" – Rufe Wetter-/Pegeldaten von DWD/NOAA ab (kein API-Key nötig!).
   Wetterdaten liefern tägliche Messwerte für eine Region:
   - Typen: "niederschlag" (mm), "pegel" (Wasserstand), "warnung" (Wetterwarnungen), "sturm" (Windböen km/h)
   - Korrelation mit Suchinteresse (z.B. Hochwasser, Sturmschäden)
   - Forensisch: Naturkatastrophen-Timeline, Versicherungsansprüche, Umweltereignisse
   Parameter: bbox ([lon_min, lat_min, lon_max, lat_max]), days (default 180, max 730), data_type ("niederschlag"|"pegel"|"warnung"|"sturm"), label (Regionsname)
15. "traceroute" – Führe einen Netzwerk-Traceroute zu einer Domain/IP durch.
   Zeigt den physischen Routing-Pfad der Datenpakete durch das Internet:
   - Welche Länder/Rechenzentren werden durchlaufen? (Routing über Drittstaaten!)
   - Anonyme Hops (***) verschleiern Zwischenknoten – RTT-Differenz gibt max. Reichweite
   - Hohe Latenz bei kurzer Distanz = Umweg; BGP-Anomalien = mögliche Routing-Manipulation
   - Forensisch: Hosting-Infrastruktur, staatliche Überwachungsknoten, Content-Delivery-Manipulation
   Parameter: domain (Domain oder URL), zone_id (optional, falls WatchZone bekannt)
   Beispiel: {{"type": "traceroute", "domain": "example.com"}}
16. "bgp_lookup" – Rufe WHOIS- und BGP-Prefix-Daten für eine IP-Adresse ab (RIPE Stat).
   Liefert: Eigentümer-Organisation, Land, Abuse-Kontakt, BGP-Prefix, annoncierte ASNs
   - Discrepanz zwischen beobachtetem ASN und BGP-Origin-ASN → BGP-Hijacking-Verdacht
   - Nicht-annonciertes Prefix → Darkspace oder Fehler-Routing
   - Forensisch: Wer betreibt diesen Server wirklich? Stimmt das mit der Selbstdarstellung überein?
   Parameter: ip (IP-Adresse) ODER domain (wird aufgelöst)
   Beispiel: {{"type": "bgp_lookup", "ip": "1.2.3.4"}}
17. "wayback" – Rufe die Inhaltsänderungs-Historie einer Website aus der Wayback Machine ab.
   Zeigt, wann sich der Inhalt einer Website verändert hat (digest-basiert):
   - Viele Änderungen kurz vor einem Ereignis → mögliche Beweisvernichtung oder Vorbereitung
   - Keine Snapshots = Domain existierte nicht oder wurde nicht archiviert
   - Forensisch: Timeline von Website-Änderungen, Dokument-Löschungen, Inhaltsmanipulationen
   Parameter: url (vollständige URL oder Domain), days (Zeitraum, default 90, max 365)
   Beispiel: {{"type": "wayback", "url": "https://example.com", "days": 90}}
18. "vessel_traffic" – Rufe aktuelle AIS-Schiffsdaten für eine WatchZone oder BBox ab.
   Zeigt welche Schiffe sich gerade in der Zone befinden:
   - Schiffstypen (Tanker, Cargo, Passagier, Militär, Fischereifahrzeuge…)
   - Flaggenstaaten und Betreiber
   - Anomalie-Score: AIS-Spoofing, ungewöhnliche Geschwindigkeit, fehlende Daten
   - Forensisch: Welche Flotten nutzen diese Route? Auffällige Bewegungsmuster?
   Parameter: zone_id (WatchZone-ID) ODER bbox ([lon_min, lat_min, lon_max, lat_max])
   Beispiel: {{"type": "vessel_traffic", "zone_id": 42}}
19. "aircraft_traffic" – Rufe aktuelle ADS-B-Flugzeugdaten für eine WatchZone oder BBox ab.
   Zeigt welche Luftfahrzeuge sich gerade in der Zone befinden:
   - Flugzeugtypen und Callsigns
   - Betreiber/Airlines und Herkunftsland (Registration)
   - Notfallsignale (Squawk 7500/7600/7700)
   - Forensisch: Militärflüge, Überwachungsflugzeuge, ungewöhnliche Routen
   Parameter: zone_id (WatchZone-ID) ODER bbox ([lon_min, lat_min, lon_max, lat_max])
   Beispiel: {{"type": "aircraft_traffic", "zone_id": 42}}
20. "stop" – Beende die Analyse, wenn die Datenlage ausreicht

REGELN FÜR ANALYZE-AUFTRÄGE:
- method: eine der oben genannten Methoden
- keywords: Liste von Keyword-Namen (müssen bereits abgerufen sein!)
- Optionale Parameter je nach Methode:
  - spike_coincidence: threshold (default 2.0), min_keywords (default 2)
  - changepoint: penalty (default 10.0), min_segment (default 5)
  - rolling_correlation: window (default 30), phase_threshold (default 0.5)
  - periodicity: top_n (default 12)
  - outliers: method ("zscore_global"|"zscore_rolling"|"iqr"), threshold (default 2.0), window (default 14)
  - decompose: period (default 30), trend_window (default 7), model ("additive"|"multiplicative")
  - self_similarity: metric ("diff"|"corr"), window (default 7)
  - auto_correlate: n (default 3, max 7) – Anzahl Top-Korrelate
  - forecast: model ("prophet"|"arima", default "prophet"), horizon (default 30, max 365)
- Die Ergebnisse werden automatisch den Recherche-Berichten hinzugefügt.

REGELN FÜR RESEARCH-AUFTRÄGE:
- Gib dem Rechercheur eine klare AUFGABE und BEGRÜNDUNG
- Keywords müssen natürliche Suchbegriffe sein
- gprop: "" = Web, "news" = Nachrichten, "youtube" = Videos
- timeframe: "today 12-m", "today 5-y", "today 3-m", "today 1-m"
- Keine bereits abgerufenen Keywords erneut vorschlagen
- Bei niedriger Intensität (1-2): max 1-2 Keywords pro Auftrag
- Bei hoher Intensität (4-5): bis zu 5 Keywords pro Auftrag

REGELN FÜR SNAPSHOT:
- title: kurzer, prägnanter Titel, der die KERNAUSSAGE des Snapshots beschreibt (z.B. "Suchinteresse CDU vs. SPD 2024", nicht "Snapshot 1")
- comment: strukturierte, analytische Einschätzung (Markdown erlaubt). Der Kommentar muss:
  1. Die ZENTRALE BEOBACHTUNG benennen (Was zeigt der Chart?)
  2. KONKRETE DATENWERTE und ZEITRÄUME nennen (z.B. "Peak von 87 am 15.03., danach Rückgang auf 23")
  3. Eine INTERPRETATION liefern (Was bedeutet das? Warum ist das relevant für das Briefing?)
  4. Falls zutreffend: Bezug zu hinterlegten Ereignissen herstellen
  Vermeide vage Formulierungen wie "interessanter Verlauf" oder "bemerkenswerte Entwicklung" ohne Datenbelege.
- keywords: PFLICHTFELD! Gezielte Auswahl von 1-3 Keywords pro Snapshot.
  Jeder Snapshot muss eine KLARE THESE oder VERGLEICHSAUSSAGE haben.
  Verschiedene Snapshots müssen unterschiedliche Keyword-Kombinationen UND unterschiedliche Perspektiven zeigen.
  Erstelle keine Snapshots mit identischer Aussage in anderer Formulierung.
- markers: Zeitpunkt-Markierungen (date "YYYY-MM-DD", label, color) für wichtige Wendepunkte, Peaks, Strukturbrüche oder Ereignisse.
  Nutze Markierungen gezielt, um die Kernaussage des Snapshots visuell zu unterstützen.

WANN SNAPSHOTS ERSTELLEN:
- Erstelle Snapshots NICHT nach dem ersten Abruf, sondern erst wenn genügend Daten für eine fundierte Aussage vorliegen.
- Bevorzuge WENIGE, qualitativ hochwertige Snapshots statt vieler oberflächlicher.
- Jeder Snapshot soll eine EIGENSTÄNDIGE Erkenntnis vermitteln, die sich von den anderen abhebt.

REGELN FÜR NEWS_SCAN:
- query: Suchbegriff für die Nachrichtensuche (z.B. ein Keyword oder Thema). Default: Seed-Keyword.
- from/to: Optionale Datumsgrenzen (YYYY-MM-DD) um die Suche zeitlich einzugrenzen.
- max_events: Max. Anzahl der als Events anzulegenden Nachrichten (1-10, default 5).
- WANN NUTZEN: Wenn du einen unerklärten Peak oder Strukturbruch in den Trenddaten siehst und wissen willst,
  welches reale Ereignis diesen ausgelöst haben könnte. Oder um generell den Nachrichtenkontext zu einem Thema zu erfassen.

REGELN FÜR EVENT_PROBE:
- date: PFLICHTFELD! Das Ereignisdatum im Format YYYY-MM-DD.
- keywords: Liste von Keywords, deren Suchvolumen im Kurzfenster geprüft werden soll (default: Seed-Keyword).
- window: "1d" (1 Tag vor/nach) oder "7d" (7 Tage vor/nach, default).
- geo: Geo-Kontext (default: primärer Geo).
- WANN NUTZEN: Wenn du ein konkretes Ereignisdatum hast (z.B. aus dem News-Scan oder den hinterlegten Ereignissen)
  und prüfen willst, ob es Suchspuren VOR dem Ereignis gab. Forensisch relevant für:
  - Vorwissen-Erkennung: Wurde ein Thema gesucht, BEVOR es öffentlich bekannt wurde?
  - Planungsspuren: Gab es Suchanfragen, die auf Vorbereitung hindeuten?
  - Reaktivitätsmuster: War die Suche rein reaktiv (erst nach dem Ereignis)?

REGELN FÜR WIKI_VIEWS:
- articles: PFLICHTFELD! Liste von Wikipedia-Artikelnamen (exakte Schreibweise wie in der URL, z.B. "Angela_Merkel", "Bitcoin").
  Leerzeichen werden automatisch zu Unterstrichen. Groß-/Kleinschreibung beachten (erster Buchstabe groß)!
- lang: Wikipedia-Sprachcode (default: "de"). Für englische Wikipedia: "en", russische: "ru", etc.
  Passe die Sprache an den Geo-Kontext an!
- days: Zeitraum in Tagen (default 365, max 730).
- WANN NUTZEN:
  - Zur Kreuzvalidierung von Google-Trends-Peaks (stimmen die Signale überein?)
  - Wenn du absolute Zugriffszahlen brauchst (statt relativer 0-100-Werte)
  - Um aktives Informationsinteresse zu messen (Wikipedia = gezielte Recherche)
  - Für Personen, Organisationen, Ereignisse die einen Wikipedia-Artikel haben

Antworte ausschließlich im JSON-Format:
{{
  "thinking": "deine strategische Überlegung – warum dieser Ansatz? Wie beantwortet das die Frage im Briefing?",
  "hypothesis": "Deine aktuelle Hypothese (PFLICHTFELD!) – z.B. 'Der Anstieg von X ist auf Ereignis Y zurückzuführen' oder 'X und Y korrelieren, weil ...' Wenn du eine frühere Hypothese bewertest: 'BESTÄTIGT/WIDERLEGT/OFFEN: [alte Hypothese]. Neue Hypothese: ...'",
  "status": "kurze Statusmeldung für den Benutzer (1 Satz)",
  "actions": [
    {{"type": "research", "task": "Beschreibung des Auftrags an den Rechercheur", "keywords": [
      {{"keyword": "...", "geo": "{primary_geo}", "timeframe": "today 12-m", "gprop": ""}}
    ]}},
    {{"type": "compare", "task": "Warum dieser Vergleich?", "keywords": ["kw1", "kw2", "kw3"], "geo": "{primary_geo}", "timeframe": "today 12-m", "gprop": ""}},
    {{"type": "analyze", "method": "changepoint", "keywords": ["kw1"], "params": {{"penalty": 10}}}},
    {{"type": "analyze", "method": "spike_coincidence", "keywords": ["kw1", "kw2", "kw3"]}},
    {{"type": "analyze", "method": "auto_correlate", "keywords": ["kw1"], "params": {{"n": 3}}}},
    {{"type": "analyze", "method": "forecast", "keywords": ["kw1"], "params": {{"model": "prophet", "horizon": 30}}}},
    {{"type": "snapshot", "title": "...", "comment": "...", "keywords": ["kw1", "kw2"], "markers": []}},
    {{"type": "news_scan", "query": "Suchbegriff", "from": "2024-01-01", "to": "2024-12-31", "max_events": 5}},
    {{"type": "event_probe", "date": "2024-11-15", "keywords": ["kw1", "kw2"], "window": "7d", "geo": "{primary_geo}"}},
    {{"type": "wiki_views", "articles": ["Artikelname_1", "Artikelname_2"], "lang": "de", "days": 365}},
    {{"type": "gdelt_volume", "terms": ["Suchbegriff_1", "Suchbegriff_2"], "days": 180}},
    {{"type": "stop", "reason": "..."}}
  ]
}}"""

                    def _try_parse_coordinator(raw):
                        """Parse coordinator JSON, trying to fix common errors."""
                        import re as _re
                        m = _re.search(r'\{[\s\S]*\}', raw)
                        if not m:
                            return {}
                        txt = m.group(0)
                        # first attempt: parse as-is
                        try:
                            return _json.loads(txt)
                        except _json.JSONDecodeError:
                            pass
                        # fix trailing commas before } or ]
                        txt = _re.sub(r',\s*([}\]])', r'\1', txt)
                        # fix missing commas between }\n{ or ]\n[
                        txt = _re.sub(r'(\})\s*\n\s*(\{)', r'\1,\n\2', txt)
                        txt = _re.sub(r'(\])\s*\n\s*(\[)', r'\1,\n\2', txt)
                        try:
                            return _json.loads(txt)
                        except _json.JSONDecodeError:
                            pass
                        # try truncation repair: close open brackets/braces
                        balanced = txt
                        open_b = balanced.count('[') - balanced.count(']')
                        open_c = balanced.count('{') - balanced.count('}')
                        balanced = balanced.rstrip().rstrip(',')
                        balanced += ']' * max(open_b, 0) + '}' * max(open_c, 0)
                        return _json.loads(balanced)  # let it raise if still broken

                    try:
                        _apa_llm_source = "apa-coordinator"
                        coord_raw = _call_llm(coordinator_prompt, max_tokens=2000)
                        try:
                            coord_result = _try_parse_coordinator(coord_raw)
                        except Exception:
                            log.info("Koordinator-JSON defekt, wiederhole LLM-Aufruf")
                            coord_raw = _call_llm(coordinator_prompt, max_tokens=2000)
                            coord_result = _try_parse_coordinator(coord_raw)
                        actions = coord_result.get("actions", [])
                        status_msg = coord_result.get("status", "")
                        thinking = coord_result.get("thinking", "")
                        hypothesis = coord_result.get("hypothesis", "")
                        history_entry = thinking
                        if hypothesis:
                            history_entry += f" | HYPOTHESE: {hypothesis}"
                        if history_entry:
                            coordinator_history.append(history_entry)
                        if hypothesis:
                            yield sse({"type": "data", "msg": f"Hypothese: {hypothesis}"})
                    except Exception as e:
                        log.warning("Koordinator-Parsing fehlgeschlagen: %s", e)
                        actions = [{"type": "stop", "reason": f"Parsing-Fehler: {e}"}]
                        status_msg = ""

                    if status_msg:
                        yield sse({"type": "status", "msg": f"Koordinator: {status_msg}"})

                    if not actions:
                        yield sse({"type": "data", "msg": "Koordinator hat keine Aktionen vorgeschlagen – beende"})
                        break

                    should_stop = False
                    for ai, action in enumerate(actions):
                        atype = action.get("type", "")

                        if atype == "stop":
                            yield sse({"type": "data", "msg": f"Koordinator beendet Analyse: {action.get('reason', '')}"})
                            should_stop = True
                            break

                        elif atype == "research":
                            task_desc = action.get("task", "")
                            kw_list = action.get("keywords", [])
                            if task_desc:
                                yield sse({"type": "status", "msg": f"Rechercheur: {task_desc}"})

                            # Rechercheur führt Abrufe aus
                            fetch_results = []
                            for kw_spec in kw_list:
                                fetch_action = {
                                    "keyword": kw_spec.get("keyword", ""),
                                    "geo": kw_spec.get("geo", primary_geo),
                                    "timeframe": kw_spec.get("timeframe", "today 12-m"),
                                    "gprop": kw_spec.get("gprop", ""),
                                }
                                pk_text = _clean_kw(fetch_action.get("keyword", "")).lower()
                                if not pk_text:
                                    continue
                                yield sse({"type": "status", "msg": f"Abruf: \"{pk_text}\" ({fetch_action.get('geo', primary_geo)}, {fetch_action.get('timeframe', 'today 12-m')}) …"})
                                try:
                                    cnt, geo_used, fb_msg = _exec_fetch(fetch_action)
                                    if cnt is None:
                                        yield sse({"type": "data", "msg": f"\"{pk_text}\": übersprungen (bereits vorhanden)"})
                                        fetch_results.append(f"{pk_text}: bereits vorhanden")
                                    else:
                                        if fb_msg:
                                            yield sse({"type": "data", "msg": f"\"{pk_text}\": {fb_msg}"})
                                        if cnt:
                                            yield sse({"type": "data", "msg": f"\"{pk_text}\": {cnt} Datenpunkte ({geo_used or 'Weltweit'})"})
                                            fetch_results.append(f"{pk_text}: {cnt} Datenpunkte ({geo_used or 'Weltweit'})")
                                        else:
                                            yield sse({"type": "data", "msg": f"\"{pk_text}\": keine Daten verfügbar"})
                                            fetch_results.append(f"{pk_text}: keine Daten")
                                except Exception as e:
                                    db.session.rollback()
                                    yield sse({"type": "data", "msg": f"\"{pk_text}\": Fehler – {str(e)[:80]}"})
                                    fetch_results.append(f"{pk_text}: Fehler – {str(e)[:80]}")

                            # ── ZWEI RECHERCHEURE bewerten parallel ───────────
                            if fetch_results:
                                yield sse({"type": "status", "msg": "Rechercheure bewerten Ergebnisse …"})

                                trend_ctx = _build_trend_context()
                                rq_ctx = _build_rq_context()

                                trend_prompt = f"""Du bist der TREND-RECHERCHEUR eines Google-Trends-Forschungsteams.
Deine Spezialität: Analyse von Zeitverläufen und Suchvolumen-Mustern.

Auftrag des Koordinators: "{task_desc}"
Briefing: {briefing or 'keins'}
Seed-Keyword: "{seed}"

ABRUF-ERGEBNISSE:
{chr(10).join(fetch_results)}

VERLAUFSDATEN (DETAILLIERT):
{trend_ctx}

WICHTIG – VERGLEICHBARKEIT:
Google Trends liefert relative Werte (0-100) pro Abfrage. Werte aus verschiedenen Abfragen
sind NICHT quantitativ vergleichbar – nur die Trendentwicklung (Verlauf über Zeit) ist aussagekräftig.
Vergleiche absolute Werte nur, wenn die Keywords in derselben Abfrage standen.

Analysiere die Verlaufsdaten:
- Gibt es Peaks oder Einbrüche? Wann genau?
- Steigen oder fallen die Trends? Wie stark?
- Gibt es Saisonalität oder zyklische Muster?
- Korrelieren mehrere Keywords miteinander (steigen/fallen gleichzeitig)?
- Gibt es Anomalien (plötzliche Änderungen)?
- Was bedeuten die Daten im Kontext des Briefings?

Antworte im JSON-Format:
{{
  "findings": "Was sagen die Verlaufsdaten aus? (2-3 Sätze, KONKRET mit Datenwerten und Zeiträumen)",
  "patterns": "Erkannte Muster: Peaks, Trends, Korrelationen, Anomalien (oder 'keine')",
  "recommendation": "Welche weiteren Keywords oder Zeiträume könnten die Analyse vertiefen? (1-2 Sätze)"
}}"""

                                rq_prompt = f"""Du bist der RELATED-QUERIES-RECHERCHEUR eines Google-Trends-Forschungsteams.
Deine Spezialität: Analyse verwandter Suchanfragen und semantischer Zusammenhänge.

Auftrag des Koordinators: "{task_desc}"
Briefing: {briefing or 'keins'}
Seed-Keyword: "{seed}"

ABRUF-ERGEBNISSE:
{chr(10).join(fetch_results)}

VERWANDTE SUCHANFRAGEN (DETAILLIERT):
{rq_ctx}

Analysiere die verwandten Suchanfragen:
- Welche Themencluster bilden sich?
- Welche RISING-Queries deuten auf aktuelle Entwicklungen hin?
- Gibt es überraschende oder unerwartete Verbindungen?
- Welche verwandten Begriffe könnten als nächste Keywords abgerufen werden?
- Denke um die Ecke: Welche INDIREKTEN Suchbegriffe könnten die Frage im Briefing beantworten?
  (z.B. statt "beliebteste partei" → die einzelnen Parteinamen vergleichen)

Antworte im JSON-Format:
{{
  "findings": "Was verraten die verwandten Suchanfragen? (2-3 Sätze, konkret)",
  "themes": "Erkannte Themencluster oder semantische Verbindungen",
  "keyword_suggestions": ["keyword1", "keyword2", "keyword3"],
  "recommendation": "Welche Richtung sollte der Koordinator einschlagen? (1-2 Sätze)"
}}"""

                                # Beide Rechercheure parallel aufrufen
                                from concurrent.futures import ThreadPoolExecutor
                                trend_report = ""
                                rq_report = ""

                                def _call_trend_researcher():
                                    return _call_llm(trend_prompt, max_tokens=1000)

                                def _call_rq_researcher():
                                    return _call_llm(rq_prompt, max_tokens=1000)

                                try:
                                    with ThreadPoolExecutor(max_workers=2) as pool:
                                        ft_trend = pool.submit(_call_trend_researcher)
                                        ft_rq = pool.submit(_call_rq_researcher)
                                        trend_raw = ft_trend.result(timeout=120)
                                        rq_raw = ft_rq.result(timeout=120)

                                    def _safe_parse_researcher(raw):
                                        m = re.search(r'\{[\s\S]*\}', raw)
                                        if not m:
                                            return {}
                                        txt = m.group(0)
                                        try:
                                            return _json.loads(txt)
                                        except _json.JSONDecodeError:
                                            txt = re.sub(r',\s*([}\]])', r'\1', txt)
                                            try:
                                                return _json.loads(txt)
                                            except _json.JSONDecodeError:
                                                log.warning("Rechercheur-JSON nicht parsbar")
                                                return {}

                                    # Trend-Rechercheur auswerten
                                    t_result = _safe_parse_researcher(trend_raw)
                                    t_findings = t_result.get("findings", "")
                                    t_patterns = t_result.get("patterns", "")
                                    t_rec = t_result.get("recommendation", "")
                                    trend_report = t_findings
                                    if t_patterns and t_patterns.lower() != "keine":
                                        trend_report += f" Muster: {t_patterns}"
                                    if t_rec:
                                        trend_report += f" Empfehlung: {t_rec}"

                                    # RQ-Rechercheur auswerten
                                    r_result = _safe_parse_researcher(rq_raw)
                                    r_findings = r_result.get("findings", "")
                                    r_themes = r_result.get("themes", "")
                                    r_suggestions = r_result.get("keyword_suggestions", [])
                                    r_rec = r_result.get("recommendation", "")
                                    rq_report = r_findings
                                    if r_themes:
                                        rq_report += f" Themen: {r_themes}"
                                    if r_suggestions:
                                        rq_report += f" Keyword-Vorschläge: {', '.join(r_suggestions[:5])}"
                                    if r_rec:
                                        rq_report += f" Empfehlung: {r_rec}"

                                    if t_findings:
                                        yield sse({"type": "data", "msg": f"Trend-Rechercheur: {t_findings}"})
                                    if r_findings:
                                        yield sse({"type": "data", "msg": f"RQ-Rechercheur: {r_findings}"})

                                    # Kombinierter Bericht an Koordinator
                                    combined = f"TREND: {trend_report} | RELATED: {rq_report}"
                                    researcher_reports.append(combined)

                                except Exception as e:
                                    log.warning("Rechercheur-Fehler: %s", e)
                                    researcher_reports.append(f"Abrufe: {', '.join(fetch_results)}")

                        elif atype == "compare":
                            cmp_kws = action.get("keywords", [])
                            task_desc = action.get("task", "")
                            if task_desc:
                                yield sse({"type": "status", "msg": f"Vergleichsabruf: {task_desc}"})
                            yield sse({"type": "status", "msg": f"Gemeinsamer Abruf: {', '.join(cmp_kws)} …"})
                            try:
                                cmp_results, cmp_err = _exec_compare(action)
                                if cmp_err:
                                    yield sse({"type": "data", "msg": f"Vergleich fehlgeschlagen: {cmp_err}"})
                                else:
                                    for kw_text, cnt in cmp_results.items():
                                        yield sse({"type": "data", "msg": f"\"{kw_text}\": {cnt} Datenpunkte (gemeinsame Skala)"})
                                    # Rechercheure bewerten lassen
                                    fetch_results = [f"{k}: {v} Datenpunkte (gemeinsame Skala)" for k, v in cmp_results.items()]
                                    if fetch_results:
                                        yield sse({"type": "status", "msg": "Rechercheure bewerten Vergleichsdaten …"})
                                        trend_ctx = _build_trend_context()
                                        rq_ctx = _build_rq_context()

                                        trend_prompt = f"""Du bist der TREND-RECHERCHEUR eines Google-Trends-Forschungsteams.
Deine Spezialität: Analyse von Zeitverläufen und Suchvolumen-Mustern.

Auftrag des Koordinators: "{task_desc}"
Briefing: {briefing or 'keins'}
Seed-Keyword: "{seed}"

WICHTIG: Diese Keywords wurden in EINER gemeinsamen Abfrage geholt!
Die Werte sind direkt quantitativ vergleichbar (gemeinsame 0-100 Skala).
Du kannst und sollst die absoluten Werte der Keywords miteinander vergleichen.

ABRUF-ERGEBNISSE:
{chr(10).join(fetch_results)}

VERLAUFSDATEN (DETAILLIERT):
{trend_ctx}

Analysiere die Vergleichsdaten:
- Welches Keyword hat das höchste/niedrigste Suchvolumen?
- Wie groß sind die quantitativen Unterschiede?
- Gibt es Zeitpunkte, an denen sich die Verhältnisse umkehren?
- Korrelieren die Verläufe oder entwickeln sie sich unterschiedlich?
- Was bedeuten die Daten im Kontext des Briefings?

Antworte im JSON-Format:
{{
  "findings": "Was sagen die Vergleichsdaten aus? (2-3 Sätze, KONKRET mit Datenwerten)",
  "patterns": "Erkannte Muster: Dominanz, Umkehrungen, Korrelationen (oder 'keine')",
  "recommendation": "Welche weiteren Vergleiche oder Keywords könnten die Analyse vertiefen? (1-2 Sätze)"
}}"""

                                        try:
                                            _apa_llm_source = "apa-trend-researcher"
                                            trend_raw = _call_llm(trend_prompt, max_tokens=800)
                                            import re
                                            trend_result = _safe_parse_researcher(trend_raw)
                                            if trend_result:
                                                report_parts = []
                                                if trend_result.get("findings"):
                                                    report_parts.append(f"Trend-Analyse: {trend_result['findings']}")
                                                if trend_result.get("patterns") and trend_result["patterns"] != "keine":
                                                    report_parts.append(f"Muster: {trend_result['patterns']}")
                                                if report_parts:
                                                    researcher_reports.append(" | ".join(report_parts))
                                        except Exception as e:
                                            log.warning("Trend-Rechercheur-Fehler (compare): %s", e)

                            except Exception as e:
                                db.session.rollback()
                                yield sse({"type": "data", "msg": f"Vergleichsabruf Fehler: {str(e)[:100]}"})

                        elif atype == "snapshot":
                            snap_title = action.get("title", "Analyse-Snapshot")
                            yield sse({"type": "status", "msg": f"Erstelle Snapshot: \"{snap_title}\" …"})
                            try:
                                snap_id = _exec_snapshot(action)
                                if snap_id == "duplicate":
                                    yield sse({"type": "data", "msg": f"Snapshot übersprungen (identischer Chart existiert bereits)"})
                                elif snap_id:
                                    apa_snapshot_ids.append(snap_id)
                                    n_markers = len(action.get("markers", []))
                                    msg = f"Snapshot \"{snap_title}\" erstellt"
                                    if n_markers:
                                        msg += f" ({n_markers} Markierungen)"
                                    yield sse({"type": "data", "msg": msg})
                                else:
                                    yield sse({"type": "data", "msg": f"Snapshot übersprungen (keine Daten)"})
                            except Exception as e:
                                log.warning("Snapshot-Fehler: %s", e)
                                yield sse({"type": "data", "msg": f"Snapshot-Fehler: {str(e)[:80]}"})

                        elif atype == "analyze":
                            method = action.get("method", "")
                            kw_names = action.get("keywords", [])
                            params = action.get("params", {})

                            STANDARD_METHODS = {
                                "spike_coincidence", "changepoint", "rolling_correlation",
                                "periodicity", "outliers", "decompose", "self_similarity",
                            }
                            SPECIAL_METHODS = {"auto_correlate", "forecast"}

                            if method not in STANDARD_METHODS and method not in SPECIAL_METHODS:
                                yield sse({"type": "data", "msg": f"Unbekannte Analysemethode: {method}"})
                                continue

                            # Keyword-IDs aus Namen auflösen
                            analysis_kw_ids = []
                            for kw_name in kw_names:
                                kw_name_clean = _clean_kw(kw_name).lower()
                                for kid in all_keyword_ids:
                                    kw_obj = Keyword.query.get(kid)
                                    if kw_obj and kw_obj.keyword.lower() == kw_name_clean:
                                        analysis_kw_ids.append(kid)
                                        break

                            if not analysis_kw_ids:
                                yield sse({"type": "data", "msg": f"Analyse übersprungen: Keywords nicht gefunden ({', '.join(kw_names)})"})
                                continue

                            yield sse({"type": "status", "msg": f"Analyse: {method.replace('_', ' ').title()} für {', '.join(kw_names)} …"})

                            try:
                                # ── Auto Correlate ────────────────────────────
                                if method == "auto_correlate":
                                    import numpy as np
                                    ref_kid = analysis_kw_ids[0]
                                    top_n = min(int(params.get("n", 3)), 7)

                                    ref_kw = Keyword.query.get(ref_kid)
                                    if not ref_kw:
                                        yield sse({"type": "data", "msg": "Auto Correlate: Keyword nicht gefunden"})
                                        continue

                                    def _ac_latest_tag(kid):
                                        row = (db.session.query(TrendData.run_tag)
                                               .filter_by(keyword_id=kid)
                                               .order_by(TrendData.date.desc()).first())
                                        return row[0] if row else ""

                                    def _ac_load(kid):
                                        tag = _ac_latest_tag(kid)
                                        return TrendData.query.filter_by(keyword_id=kid, run_tag=tag).order_by(TrendData.date).all()

                                    def _ac_map(data_list):
                                        return {td.date.strftime("%Y-%m-%d %H:%M") if hasattr(td.date, 'strftime')
                                                else str(td.date): td.value for td in data_list}

                                    ref_data = _ac_load(ref_kid)
                                    if len(ref_data) < 5:
                                        yield sse({"type": "data", "msg": "Auto Correlate: Zu wenige Datenpunkte"})
                                        continue

                                    ref_dates = _ac_map(ref_data)

                                    # Alle Keywords des Users (nicht nur Projekt)
                                    all_user_kws = Keyword.query.filter(
                                        Keyword.user_id == uid, Keyword.id != ref_kid).all()

                                    ac_results = []
                                    for kw in all_user_kws:
                                        kw_data = _ac_load(kw.id)
                                        if len(kw_data) < 5:
                                            continue
                                        kw_dates = _ac_map(kw_data)
                                        common = sorted(set(ref_dates.keys()) & set(kw_dates.keys()))
                                        if len(common) < 5:
                                            continue
                                        ref_vals = np.array([ref_dates[d] for d in common], dtype=float)
                                        kw_vals = np.array([kw_dates[d] for d in common], dtype=float)
                                        if ref_vals.std() == 0 or kw_vals.std() == 0:
                                            continue
                                        r = float(np.corrcoef(ref_vals, kw_vals)[0, 1])
                                        if np.isnan(r):
                                            continue
                                        # CCF: optimalen Lag finden
                                        max_lag = min(len(common) // 3, 30)
                                        best_lag, best_lag_r = 0, r
                                        for lag in range(-max_lag, max_lag + 1):
                                            if lag == 0:
                                                continue
                                            xs, ys = [], []
                                            for idx in range(len(common)):
                                                j_idx = idx - lag
                                                if 0 <= j_idx < len(common):
                                                    xs.append(ref_vals[idx])
                                                    ys.append(kw_vals[j_idx])
                                            if len(xs) < 5:
                                                continue
                                            xs_a, ys_a = np.array(xs), np.array(ys)
                                            if xs_a.std() == 0 or ys_a.std() == 0:
                                                continue
                                            lag_r = float(np.corrcoef(xs_a, ys_a)[0, 1])
                                            if not np.isnan(lag_r) and abs(lag_r) > abs(best_lag_r):
                                                best_lag_r = lag_r
                                                best_lag = lag
                                        ac_results.append({
                                            "id": kw.id, "keyword": kw.keyword, "geo": kw.geo,
                                            "correlation": round(r, 4), "abs_correlation": round(abs(r), 4),
                                            "common_points": len(common),
                                            "best_lag": best_lag, "best_lag_r": round(best_lag_r, 4),
                                        })

                                    ac_results.sort(key=lambda x: x["abs_correlation"], reverse=True)
                                    top = ac_results[:top_n]

                                    # Gefundene Keywords dem Projekt hinzufügen und Daten abrufen
                                    added_kws = []
                                    for match in top:
                                        match_kw = Keyword.query.get(match["id"])
                                        if not match_kw:
                                            continue
                                        # Keyword dem Projekt zuordnen falls nötig
                                        if project_id:
                                            from models import keyword_projects as _kp
                                            already_linked = db.session.execute(
                                                db.select(_kp).where(_kp.c.keyword_id == match_kw.id, _kp.c.project_id == project_id)
                                            ).first()
                                            if not already_linked:
                                                db.session.execute(_kp.insert().values(keyword_id=match_kw.id, project_id=project_id))
                                                db.session.commit()
                                        if match["id"] not in all_keyword_ids:
                                            all_keyword_ids.append(match["id"])
                                        lag_str = f", lag={match['best_lag']}" if match["best_lag"] else ""
                                        added_kws.append(f"{match['keyword']} (r={match['best_lag_r']}{lag_str})")

                                    summary = f"Auto Correlate für \"{ref_kw.keyword}\": {len(ac_results)} verglichen, Top-{len(top)}: {', '.join(added_kws) if added_kws else 'keine gefunden'}"
                                    yield sse({"type": "data", "msg": summary})

                                    report_parts = [f"ANALYSE (auto_correlate): {summary}"]
                                    for m_item in top:
                                        lag_info = f", Lag={m_item['best_lag']}" if m_item["best_lag"] else ""
                                        report_parts.append(f"  {m_item['keyword']} ({m_item['geo']}): r={m_item['correlation']}, |r|={m_item['abs_correlation']}, best_r={m_item['best_lag_r']}{lag_info}")
                                    researcher_reports.append("\n".join(report_parts))

                                # ── Forecast ──────────────────────────────────
                                elif method == "forecast":
                                    import pandas as pd
                                    import warnings
                                    warnings.filterwarnings("ignore")

                                    fc_kid = analysis_kw_ids[0]
                                    fc_kw = Keyword.query.get(fc_kid)
                                    model_type = (params.get("model") or "prophet").strip().lower()
                                    horizon = min(max(int(params.get("horizon", 30)), 1), 365)

                                    # Trenddaten laden
                                    fc_tag = (db.session.query(TrendData.run_tag)
                                              .filter_by(keyword_id=fc_kid)
                                              .order_by(TrendData.date.desc()).first())
                                    fc_tag = fc_tag[0] if fc_tag else ""
                                    fc_data = TrendData.query.filter_by(
                                        keyword_id=fc_kid, run_tag=fc_tag
                                    ).order_by(TrendData.date).all()
                                    data_points = [{"date": t.date.strftime("%Y-%m-%d %H:%M") if hasattr(t.date, 'strftime') else str(t.date),
                                                    "value": t.value} for t in fc_data if t.value is not None]

                                    if len(data_points) < 10:
                                        yield sse({"type": "data", "msg": f"Forecast: Zu wenige Datenpunkte ({len(data_points)}) für \"{fc_kw.keyword}\""})
                                        continue

                                    df = pd.DataFrame(data_points)
                                    df["date"] = pd.to_datetime(df["date"], format="ISO8601")
                                    df = df.dropna(subset=["value"]).sort_values("date").reset_index(drop=True)

                                    # Frequenz erkennen
                                    diffs = df["date"].diff().dropna().dt.total_seconds()
                                    median_diff = diffs.median()
                                    if median_diff < 7200:
                                        freq = "h"
                                    elif median_diff < 172800:
                                        freq = "D"
                                    elif median_diff < 1209600:
                                        freq = "W"
                                    else:
                                        freq = "MS"

                                    if model_type == "prophet":
                                        from prophet import Prophet
                                        import logging
                                        logging.getLogger("prophet").setLevel(logging.WARNING)
                                        logging.getLogger("cmdstanpy").setLevel(logging.WARNING)

                                        pdf = df.rename(columns={"date": "ds", "value": "y"})
                                        m_fc = Prophet(
                                            yearly_seasonality="auto",
                                            weekly_seasonality=(freq in ("D", "h")),
                                            daily_seasonality=(freq == "h"),
                                            changepoint_prior_scale=0.05,
                                        )
                                        m_fc.fit(pdf)
                                        future = m_fc.make_future_dataframe(
                                            periods=horizon,
                                            freq={"h": "h", "D": None, "W": "W", "MS": "MS"}.get(freq)
                                        )
                                        fc_pred = m_fc.predict(future).tail(horizon)

                                        fc_points = []
                                        for _, row in fc_pred.iterrows():
                                            fmt = "%Y-%m-%d %H:%M" if freq == "h" else "%Y-%m-%d"
                                            fc_points.append({
                                                "date": row.ds.strftime(fmt),
                                                "yhat": round(float(row.yhat), 2),
                                                "yhat_lower": round(float(row.yhat_lower), 2),
                                                "yhat_upper": round(float(row.yhat_upper), 2),
                                            })
                                        changepoints = [cp.strftime("%Y-%m-%d") for cp in m_fc.changepoints] if hasattr(m_fc, "changepoints") else []
                                        model_label = "Prophet"

                                    else:  # arima
                                        from statsmodels.tsa.arima.model import ARIMA
                                        import numpy as np

                                        values = df["value"].values.astype(float)
                                        order = (2, 1, 2) if len(values) > 50 else (1, 1, 1)
                                        try:
                                            fit = ARIMA(values, order=order).fit()
                                        except Exception:
                                            order = (1, 1, 0)
                                            fit = ARIMA(values, order=order).fit()

                                        fc_out = fit.get_forecast(steps=horizon)
                                        fc_mean = fc_out.predicted_mean
                                        fc_ci = fc_out.conf_int(alpha=0.05)
                                        last_date = df["date"].iloc[-1]
                                        freq_map = {"h": "h", "D": "D", "W": "W", "MS": "MS"}
                                        future_dates = pd.date_range(last_date, periods=horizon + 1, freq=freq_map[freq])[1:]
                                        fmt = "%Y-%m-%d %H:%M" if freq == "h" else "%Y-%m-%d"

                                        fc_points = []
                                        for i in range(min(horizon, len(future_dates))):
                                            fc_points.append({
                                                "date": future_dates[i].strftime(fmt),
                                                "yhat": round(float(fc_mean.iloc[i]), 2),
                                                "yhat_lower": round(float(fc_ci.iloc[i, 0]), 2),
                                                "yhat_upper": round(float(fc_ci.iloc[i, 1]), 2),
                                            })
                                        changepoints = []
                                        model_label = f"ARIMA{order}"

                                    # Ergebnis zusammenfassen
                                    if fc_points:
                                        last_fc = fc_points[-1]
                                        first_fc = fc_points[0]
                                        last_actual = round(float(df["value"].iloc[-1]), 2)
                                        trend_dir = "steigend" if last_fc["yhat"] > last_actual else "fallend" if last_fc["yhat"] < last_actual else "stabil"
                                        summary = (f"Forecast ({model_label}) für \"{fc_kw.keyword}\": "
                                                   f"{horizon} Perioden, {trend_dir}, "
                                                   f"letzter Ist-Wert={last_actual}, "
                                                   f"Prognose {first_fc['date']}={first_fc['yhat']} → {last_fc['date']}={last_fc['yhat']} "
                                                   f"(KI: {last_fc['yhat_lower']}–{last_fc['yhat_upper']})")
                                    else:
                                        summary = f"Forecast ({model_label}): keine Prognosewerte generiert"

                                    yield sse({"type": "data", "msg": f"Analyse: {summary}"})

                                    report_parts = [f"ANALYSE (forecast): {summary}"]
                                    if changepoints:
                                        report_parts.append(f"  Change-Points: {', '.join(changepoints[:5])}")
                                    # Erste und letzte 3 Prognosepunkte
                                    for fp in fc_points[:3]:
                                        report_parts.append(f"  {fp['date']}: {fp['yhat']} ({fp['yhat_lower']}–{fp['yhat_upper']})")
                                    if len(fc_points) > 6:
                                        report_parts.append("  …")
                                    for fp in fc_points[-3:]:
                                        report_parts.append(f"  {fp['date']}: {fp['yhat']} ({fp['yhat_lower']}–{fp['yhat_upper']})")
                                    researcher_reports.append("\n".join(report_parts))

                                # ── Standard-Analysemethoden ──────────────────
                                else:
                                    analysis_body = {
                                        "keyword_ids": analysis_kw_ids,
                                        "run_tag": run_tag,
                                        **params,
                                    }
                                    result = _run_analysis(method, analysis_body)

                                    summary = result.get("summary", f"{method} abgeschlossen")
                                    yield sse({"type": "data", "msg": f"Analyse: {summary}"})

                                    # Ergebnisse den Recherche-Berichten hinzufügen
                                    # Kompakte Zusammenfassung für den Koordinator
                                    report_parts = [f"ANALYSE ({method}): {summary}"]
                                    if method == "spike_coincidence":
                                        for c in (result.get("coincidences") or [])[:5]:
                                            kws = ", ".join(k["keyword"] for k in c["keywords"])
                                            report_parts.append(f"  {c['date']}: {c['count']}× ({kws}), Ø|z|={c['avg_z']}")
                                    elif method == "changepoint":
                                        for cp in (result.get("changepoints") or [])[:5]:
                                            report_parts.append(f"  {cp['date']}: {cp['keyword']} {'↑' if cp['direction']=='up' else '↓'} Δ={cp['delta']}")
                                    elif method == "rolling_correlation":
                                        for p in (result.get("pairs") or [])[:5]:
                                            report_parts.append(f"  {p['keyword_a']} ↔ {p['keyword_b']}: Ø r={p['avg_r']}")
                                    elif method == "outliers":
                                        for o in (result.get("outliers") or [])[:5]:
                                            report_parts.append(f"  {o['date']}: {o['value']} ({o['direction']}, {o['deviation']}{o['unit']})")
                                    elif method == "periodicity":
                                        for f in (result.get("dominant_frequencies") or [])[:5]:
                                            tech = " [TECH]" if f.get("technical") else ""
                                            report_parts.append(f"  Periode {f['period_days']:.1f}d, rel. Power {f['relative_power']:.3f}{tech}")
                                    elif method == "decompose":
                                        sp = result.get("seasonal_pattern", [])
                                        if sp:
                                            max_s = max(sp)
                                            min_s = min(sp)
                                            report_parts.append(f"  Saisonale Amplitude: {max_s - min_s:.2f}")
                                    elif method == "self_similarity":
                                        report_parts.append(f"  Ø Ähnlichkeit: {result.get('avg_similarity')}, Hochähnliche Regionen: {len(result.get('high_similarity_regions', []))}")

                                    researcher_reports.append("\n".join(report_parts))
                            except Exception as e:
                                log.warning("Analyse-Fehler (%s): %s", method, e)
                                yield sse({"type": "data", "msg": f"Analyse-Fehler ({method}): {str(e)[:100]}"})

                        elif atype == "news_scan":
                            query = action.get("query", seed)
                            yield sse({"type": "status", "msg": f"News-Scan: \"{query}\" …"})
                            try:
                                events_found, ns_err = _exec_news_scan(action)
                                if ns_err:
                                    yield sse({"type": "data", "msg": f"News-Scan: {ns_err}"})
                                elif events_found:
                                    for ev in events_found:
                                        yield sse({"type": "data", "msg": f"Ereignis: {ev['date']} – {ev['title'][:80]} ({ev['source']})"})
                                    researcher_reports.append(
                                        f"NEWS-SCAN ({query}): {len(events_found)} Ereignisse gefunden – "
                                        + "; ".join(f"{ev['date']}: {ev['title'][:60]}" for ev in events_found)
                                    )
                                else:
                                    yield sse({"type": "data", "msg": "News-Scan: Keine relevanten Nachrichtenartikel gefunden"})
                                    researcher_reports.append(f"NEWS-SCAN ({query}): Keine Ergebnisse")
                            except Exception as e:
                                log.warning("News-Scan-Fehler: %s", e)
                                yield sse({"type": "data", "msg": f"News-Scan-Fehler: {str(e)[:80]}"})

                        elif atype == "event_probe":
                            ev_date = action.get("date", "")
                            ev_kws = action.get("keywords", [seed])
                            ev_window = action.get("window", "7d")
                            yield sse({"type": "status", "msg": f"Event-Probe: {ev_date} (±{ev_window}) – Suchspuren-Analyse …"})
                            try:
                                probe_results, ep_err = _exec_event_probe(action)
                                if ep_err:
                                    yield sse({"type": "data", "msg": f"Event-Probe: {ep_err}"})
                                elif probe_results:
                                    report_parts = [f"EVENT-PROBE ({ev_date}, ±{ev_window}):"]
                                    for pr in probe_results:
                                        if pr.get("error"):
                                            yield sse({"type": "data", "msg": f"  {pr['keyword']}: Fehler – {pr['error']}"})
                                            continue
                                        signal_icon = ""
                                        if pr["signal"] == "VORWISSEN-INDIKATOR":
                                            signal_icon = "⚠ "
                                        elif pr["signal"] == "AUFFÄLLIG: Suche nur VOR Ereignis":
                                            signal_icon = "🔴 "
                                        msg = (
                                            f"  {signal_icon}\"{pr['keyword']}\": VOR={pr['pre_event_avg']} (Max {pr['pre_event_max']}), "
                                            f"NACH={pr['post_event_avg']}, {pr['datapoints']} Punkte → {pr['signal']}"
                                        )
                                        yield sse({"type": "data", "msg": msg})
                                        report_parts.append(
                                            f"  {pr['keyword']}: Pre-Event Ø={pr['pre_event_avg']}, Max={pr['pre_event_max']}, "
                                            f"Post-Event Ø={pr['post_event_avg']} → {pr['signal']}"
                                        )
                                    researcher_reports.append("\n".join(report_parts))
                            except Exception as e:
                                log.warning("Event-Probe-Fehler: %s", e)
                                yield sse({"type": "data", "msg": f"Event-Probe-Fehler: {str(e)[:80]}"})

                        elif atype == "wiki_views":
                            wiki_articles = action.get("articles", [seed])
                            wiki_lang = action.get("lang", "de")
                            yield sse({"type": "status", "msg": f"Wikipedia-Pageviews: {', '.join(wiki_articles[:3])} ({wiki_lang}.wikipedia) …"})
                            try:
                                wiki_results, wk_err = _exec_wiki_views(action)
                                if wk_err:
                                    yield sse({"type": "data", "msg": f"Wiki-Views: {wk_err}"})
                                elif wiki_results:
                                    report_parts = [f"WIKIPEDIA-PAGEVIEWS ({wiki_lang}.wikipedia):"]
                                    for wr in wiki_results:
                                        if wr.get("error"):
                                            yield sse({"type": "data", "msg": f"  \"{wr['article']}\": {wr['error']}"})
                                            report_parts.append(f"  {wr['article']}: {wr['error']}")
                                            continue
                                        spikes_str = ""
                                        if wr.get("spikes"):
                                            top_spikes = wr["spikes"][:3]
                                            spikes_str = ", Spikes: " + ", ".join(
                                                f"{s['date']} ({s['views']:,} = {s['factor']}x Ø)" for s in top_spikes
                                            )
                                        msg = (
                                            f"  \"{wr['article']}\": Ø {wr['avg_daily']:.0f}/Tag, "
                                            f"Peak {wr['max_views']:,} am {wr['max_date']}, "
                                            f"Trend: {wr['direction']}{spikes_str}"
                                        )
                                        yield sse({"type": "data", "msg": msg})
                                        spike_info = ""
                                        if wr.get("spikes"):
                                            spike_parts = ["{} ({}x)".format(s["date"], s["factor"]) for s in wr["spikes"][:3]]
                                            spike_info = ", Spikes: " + ", ".join(spike_parts)
                                        report_parts.append(
                                            f"  {wr['article']}: {wr['datapoints']} Tage, Ø {wr['avg_daily']:.0f}/Tag, "
                                            f"Max {wr['max_views']:,} am {wr['max_date']}, Trend: {wr['direction']}{spike_info}"
                                        )
                                    researcher_reports.append("\n".join(report_parts))
                            except Exception as e:
                                log.warning("Wiki-Views-Fehler: %s", e)
                                yield sse({"type": "data", "msg": f"Wiki-Views-Fehler: {str(e)[:80]}"})

                        elif atype == "wiki_edits":
                            we_articles = action.get("articles", [seed])
                            we_lang = action.get("lang", "de")
                            we_days = action.get("days", 365)
                            yield sse({"type": "status", "msg": f"Wikipedia-Edits: {', '.join(we_articles[:3])} ({we_lang}.wikipedia, {we_days}d) …"})
                            try:
                                we_results, we_err = _exec_wiki_edits(action)
                                if we_err:
                                    yield sse({"type": "data", "msg": f"Wiki-Edits: {we_err}"})
                                elif we_results:
                                    report_parts = [f"WIKIPEDIA-BEARBEITUNGSHISTORIE ({we_lang}.wikipedia):"]
                                    for wr in we_results:
                                        if wr.get("error"):
                                            yield sse({"type": "data", "msg": f"  {wr.get('article', '?')}: {wr['error']}"})
                                            report_parts.append(f"  {wr.get('article', '?')}: {wr['error']}")
                                            continue
                                        # Spikes
                                        spike_info = ""
                                        if wr.get("edit_spikes"):
                                            spike_parts = [f"{s['date']} ({s['edits']} Edits, {s['factor']}x Ø)" for s in wr["edit_spikes"][:3]]
                                            spike_info = f", Edit-Spikes: {', '.join(spike_parts)}"
                                        # Top-Autoren
                                        author_info = ""
                                        if wr.get("top_authors"):
                                            top3 = wr["top_authors"][:3]
                                            parts = []
                                            for a in top3:
                                                rep = ""
                                                if a.get("total_editcount"):
                                                    rep = f" [{a['total_editcount']:,} Gesamt-Edits"
                                                    if a.get("groups"):
                                                        rep += f", {', '.join(a['groups'])}"
                                                    if a.get("blocked"):
                                                        rep += ", GESPERRT"
                                                    rep += "]"
                                                parts.append(f"{a['user']} ({a['edits']}x){rep}")
                                            author_info = f", Top-Autoren: {'; '.join(parts)}"

                                        msg = (
                                            f"  \"{wr['wiki_title']}\": {wr['total_edits']} Edits, "
                                            f"{wr['anonymous_pct']:.0f}% anonym, "
                                            f"{wr['unique_authors']} Autoren"
                                        )
                                        yield sse({"type": "data", "msg": msg})
                                        report_parts.append(
                                            f"  {wr['wiki_title']}: {wr['total_edits']} Edits in {we_days}d, "
                                            f"Ø {wr['avg_daily']:.1f}/Tag, "
                                            f"{wr['registered_edits']} registriert, {wr['anonymous_edits']} anonym ({wr['anonymous_pct']:.1f}%), "
                                            f"{wr['unique_authors']} verschiedene Autoren"
                                            f"{spike_info}{author_info}"
                                        )
                                    researcher_reports.append("\n".join(report_parts))
                            except Exception as e:
                                log.warning("Wiki-Edits-Fehler: %s", e)
                                yield sse({"type": "data", "msg": f"Wiki-Edits-Fehler: {str(e)[:80]}"})

                        elif atype == "gdelt_volume":
                            gdelt_terms = action.get("terms", [seed])
                            gdelt_days = action.get("days", 180)
                            yield sse({"type": "status", "msg": f"GDELT-Medienvolumen: {', '.join(gdelt_terms[:3])} ({gdelt_days}d) …"})
                            try:
                                gdelt_results, gd_err = _exec_gdelt_volume(action)
                                if gd_err:
                                    yield sse({"type": "data", "msg": f"GDELT: {gd_err}"})
                                elif gdelt_results:
                                    report_parts = ["GDELT-MEDIENBERICHTERSTATTUNG:"]
                                    for gr in gdelt_results:
                                        if gr.get("error"):
                                            yield sse({"type": "data", "msg": f"  \"{gr['term']}\": {gr['error']}"})
                                            report_parts.append(f"  {gr['term']}: {gr['error']}")
                                            continue
                                        spike_note = ""
                                        if gr.get("spikes_count", 0) > 0:
                                            spike_note = f", {gr['spikes_count']} Spikes (>3x Ø)"
                                        msg = (
                                            f"  \"{gr['term']}\": Ø {gr['avg_daily']:.0f} Artikel/Tag, "
                                            f"Max {gr['max_daily']:,}/Tag, "
                                            f"Trend: {gr['direction']}{spike_note}"
                                        )
                                        yield sse({"type": "data", "msg": msg})
                                        report_parts.append(
                                            f"  {gr['term']}: {gr['datapoints']} Tage, Ø {gr['avg_daily']:.0f}/Tag, "
                                            f"Max {gr['max_daily']:,}, Min {gr['min_daily']}, "
                                            f"Trend: {gr['direction']}, "
                                            f"Erste 7d Ø {gr['first7_avg']:.0f}, Letzte 7d Ø {gr['last7_avg']:.0f}"
                                            f"{spike_note}"
                                        )
                                    researcher_reports.append("\n".join(report_parts))
                            except Exception as e:
                                log.warning("GDELT-Fehler: %s", e)
                                yield sse({"type": "data", "msg": f"GDELT-Fehler: {str(e)[:80]}"})

                        elif atype == "yahoo_finance":
                            yf_symbols = action.get("symbols", [])
                            yf_days = action.get("days", 180)
                            yield sse({"type": "status", "msg": f"Yahoo Finance: {', '.join(yf_symbols[:3])} ({yf_days}d) …"})
                            try:
                                yf_results, yf_err = _exec_yahoo_finance(action)
                                if yf_err:
                                    yield sse({"type": "data", "msg": f"Yahoo Finance: {yf_err}"})
                                elif yf_results:
                                    report_parts = ["YAHOO-FINANCE-KURSDATEN:"]
                                    for yr in yf_results:
                                        if yr.get("error"):
                                            yield sse({"type": "data", "msg": f"  {yr['symbol']}: {yr['error']}"})
                                            report_parts.append(f"  {yr['symbol']}: {yr['error']}")
                                            continue
                                        cur = f" {yr['currency']}" if yr.get("currency") else ""
                                        moves_info = ""
                                        if yr.get("big_moves"):
                                            moves_parts = [f"{m['date']} ({m['change_pct']:+.1f}%)" for m in yr["big_moves"][:3]]
                                            moves_info = f", Große Bewegungen: {', '.join(moves_parts)}"
                                        vol_info = ""
                                        if yr.get("vol_spikes"):
                                            vol_parts = [f"{v['date']} ({v['factor']}x)" for v in yr["vol_spikes"][:3]]
                                            vol_info = f", Volumen-Spikes: {', '.join(vol_parts)}"
                                        msg = (
                                            f"  {yr.get('name', yr['symbol'])} ({yr['symbol']}): "
                                            f"Kurs {yr['last_price']}{cur}, "
                                            f"Veränderung {yr['change_pct']:+.1f}%, "
                                            f"Trend: {yr['direction']}"
                                        )
                                        yield sse({"type": "data", "msg": msg})
                                        report_parts.append(
                                            f"  {yr.get('name', yr['symbol'])} ({yr['symbol']}): "
                                            f"{yr['datapoints']} Tage, Kurs aktuell {yr['last_price']}{cur}, "
                                            f"Ø {yr['avg_price']}{cur}, "
                                            f"Max {yr['max_price']} am {yr['max_date']}, "
                                            f"Min {yr['min_price']} am {yr['min_date']}, "
                                            f"Veränderung {yr['change_pct']:+.1f}%, "
                                            f"Trend: {yr['direction']}, "
                                            f"Volatilität: {yr['volatility']:.2f}%, "
                                            f"Erste 7d Ø {yr['first7_avg']}, Letzte 7d Ø {yr['last7_avg']}"
                                            f"{moves_info}{vol_info}"
                                        )
                                    researcher_reports.append("\n".join(report_parts))
                            except Exception as e:
                                log.warning("Yahoo-Finance-Fehler: %s", e)
                                yield sse({"type": "data", "msg": f"Yahoo-Finance-Fehler: {str(e)[:80]}"})

                        elif atype == "ndvi_analysis":
                            ndvi_label = action.get("label", "Region")
                            ndvi_days = action.get("days", 365)
                            ndvi_bbox = action.get("bbox", [])
                            yield sse({"type": "status", "msg": f"NDVI-Vegetationsanalyse: {ndvi_label} ({ndvi_days}d) …"})
                            try:
                                ndvi_results, ndvi_err = _exec_ndvi_analysis(action)
                                if ndvi_err:
                                    yield sse({"type": "data", "msg": f"NDVI: {ndvi_err}"})
                                elif ndvi_results:
                                    report_parts = ["NDVI-VEGETATIONSANALYSE (Sentinel-2):"]
                                    for nr in ndvi_results:
                                        if nr.get("error"):
                                            yield sse({"type": "data", "msg": f"  {nr['label']}: {nr['error']}"})
                                            report_parts.append(f"  {nr['label']}: {nr['error']}")
                                            continue
                                        anomaly_info = ""
                                        if nr.get("anomalies"):
                                            anom_parts = [f"{a['date']}: {a['type']} ({a['delta']:+.3f})" for a in nr["anomalies"][:3]]
                                            anomaly_info = f", Anomalien: {', '.join(anom_parts)}"
                                        msg = (
                                            f"  {nr['label']}: Ø NDVI {nr['avg_ndvi']}, "
                                            f"Trend: {nr['direction']}"
                                            f"{', ' + str(len(nr['anomalies'])) + ' Anomalien' if nr.get('anomalies') else ''}"
                                        )
                                        yield sse({"type": "data", "msg": msg})
                                        report_parts.append(
                                            f"  {nr['label']} (bbox: {nr['bbox']}): "
                                            f"{nr['datapoints']} Messungen, Zeitraum {nr['period']}, "
                                            f"Ø NDVI {nr['avg_ndvi']}, "
                                            f"Max {nr['max_ndvi']} am {nr['max_date']}, "
                                            f"Min {nr['min_ndvi']} am {nr['min_date']}, "
                                            f"Trend: {nr['direction']}, "
                                            f"Anfang Ø {nr['first_avg']}, Ende Ø {nr['last_avg']}"
                                            f"{anomaly_info}"
                                        )
                                    researcher_reports.append("\n".join(report_parts))
                            except Exception as e:
                                log.warning("NDVI-Fehler: %s", e)
                                yield sse({"type": "data", "msg": f"NDVI-Fehler: {str(e)[:80]}"})

                        elif atype == "seismic_history":
                            seis_label = action.get("label", "Region")
                            seis_days = min(action.get("days", 180), 730)
                            seis_bbox = action.get("bbox", [])
                            yield sse({"type": "status", "msg": f"Seismik (USGS): {seis_label} ({seis_days}d) …"})
                            try:
                                if len(seis_bbox) != 4:
                                    yield sse({"type": "data", "msg": "Seismik: bbox muss 4 Werte haben [lon_min, lat_min, lon_max, lat_max]"})
                                else:
                                    from plugins.watchzone.seismic._transport import fetch_usgs_earthquake_history as fetch_seismic_history
                                    from datetime import datetime, timedelta
                                    date_to = datetime.utcnow().strftime("%Y-%m-%d")
                                    date_from = (datetime.utcnow() - timedelta(days=seis_days)).strftime("%Y-%m-%d")
                                    seis_data = fetch_seismic_history(seis_bbox, date_from, date_to)
                                    if seis_data and seis_data.get("data"):
                                        entries = seis_data["data"]
                                        total_quakes = sum(e.get("count", 1) for e in entries)
                                        max_mag = max(e["value"] for e in entries) if entries else 0
                                        max_date = next((e["date"] for e in entries if e["value"] == max_mag), "?")
                                        report_parts = [
                                            f"SEISMIK (USGS) – {seis_label} (bbox: {seis_bbox}):",
                                            f"  Zeitraum: {date_from} bis {date_to}",
                                            f"  {total_quakes} Erdbeben in {len(entries)} Tagen mit Aktivität",
                                            f"  Max. Magnitude: {max_mag} am {max_date}",
                                        ]
                                        # Top 5 stärkste Beben
                                        top5 = sorted(entries, key=lambda e: e["value"], reverse=True)[:5]
                                        for t in top5:
                                            report_parts.append(f"  {t['date']}: Mag. {t['value']} ({t.get('count', 1)} Beben)")
                                        researcher_reports.append("\n".join(report_parts))
                                        yield sse({"type": "data", "msg": f"Seismik {seis_label}: {total_quakes} Beben, max Mag. {max_mag} am {max_date}"})
                                    else:
                                        yield sse({"type": "data", "msg": f"Seismik {seis_label}: Keine Erdbeben im Zeitraum"})
                                        researcher_reports.append(f"SEISMIK (USGS) – {seis_label}: Keine Erdbeben im Zeitraum {date_from} bis {date_to}")
                            except Exception as e:
                                log.warning("Seismik-Fehler: %s", e)
                                yield sse({"type": "data", "msg": f"Seismik-Fehler: {str(e)[:80]}"})

                        elif atype == "nightlights_history":
                            nl_label = action.get("label", "Region")
                            nl_days = min(action.get("days", 180), 365)
                            nl_bbox = action.get("bbox", [])
                            yield sse({"type": "status", "msg": f"Nighttime Lights (NASA VIIRS): {nl_label} ({nl_days}d) …"})
                            try:
                                if len(nl_bbox) != 4:
                                    yield sse({"type": "data", "msg": "Nightlights: bbox muss 4 Werte haben [lon_min, lat_min, lon_max, lat_max]"})
                                else:
                                    from plugins.watchzone.nightlights._transport import fetch_nightlights_history
                                    from datetime import datetime, timedelta
                                    date_to = datetime.utcnow().strftime("%Y-%m-%d")
                                    date_from = (datetime.utcnow() - timedelta(days=nl_days)).strftime("%Y-%m-%d")
                                    nl_data = fetch_nightlights_history(nl_bbox, date_from, date_to)
                                    if nl_data and nl_data.get("data"):
                                        entries = nl_data["data"]
                                        values = [e["value"] for e in entries]
                                        avg_br = sum(values) / len(values)
                                        max_br = max(values)
                                        min_br = min(values)
                                        max_date = next(e["date"] for e in entries if e["value"] == max_br)
                                        min_date = next(e["date"] for e in entries if e["value"] == min_br)
                                        first_avg = sum(values[:3]) / min(3, len(values))
                                        last_avg = sum(values[-3:]) / min(3, len(values))
                                        direction = "steigend" if last_avg > first_avg * 1.05 else ("fallend" if last_avg < first_avg * 0.95 else "stabil")
                                        report_parts = [
                                            f"NIGHTTIME LIGHTS (NASA VIIRS) – {nl_label} (bbox: {nl_bbox}):",
                                            f"  Zeitraum: {date_from} bis {date_to}, {len(entries)} Messungen",
                                            f"  Ø Helligkeit: {avg_br:.1f}, Max: {max_br:.1f} am {max_date}, Min: {min_br:.1f} am {min_date}",
                                            f"  Trend: {direction} (Anfang Ø {first_avg:.1f}, Ende Ø {last_avg:.1f})",
                                        ]
                                        researcher_reports.append("\n".join(report_parts))
                                        yield sse({"type": "data", "msg": f"Nightlights {nl_label}: Ø {avg_br:.1f}, Trend: {direction}"})
                                    else:
                                        yield sse({"type": "data", "msg": f"Nightlights {nl_label}: Keine Daten im Zeitraum"})
                                        researcher_reports.append(f"NIGHTTIME LIGHTS – {nl_label}: Keine Daten im Zeitraum {date_from} bis {date_to}")
                            except Exception as e:
                                log.warning("Nightlights-Fehler: %s", e)
                                yield sse({"type": "data", "msg": f"Nightlights-Fehler: {str(e)[:80]}"})

                        elif atype == "weather_history":
                            wx_label = action.get("label", "Region")
                            wx_days = min(action.get("days", 180), 730)
                            wx_bbox = action.get("bbox", [])
                            wx_type = action.get("data_type", "niederschlag")
                            yield sse({"type": "status", "msg": f"Wetterdaten (DWD/NOAA): {wx_label} – {wx_type} ({wx_days}d) …"})
                            try:
                                if len(wx_bbox) != 4:
                                    yield sse({"type": "data", "msg": "Wetter: bbox muss 4 Werte haben [lon_min, lat_min, lon_max, lat_max]"})
                                else:
                                    from plugins.watchzone.weather._transport import fetch_dwd_weather_history
                                    from datetime import datetime, timedelta
                                    center_lat = (wx_bbox[1] + wx_bbox[3]) / 2
                                    center_lon = (wx_bbox[0] + wx_bbox[2]) / 2
                                    date_to = datetime.utcnow().strftime("%Y-%m-%d")
                                    date_from = (datetime.utcnow() - timedelta(days=wx_days)).strftime("%Y-%m-%d")
                                    wx_data = fetch_dwd_weather_history(center_lat, center_lon, date_from, date_to, wx_type)
                                    if wx_data and wx_data.get("data"):
                                        entries = wx_data["data"]
                                        values = [e["value"] for e in entries if e.get("value") is not None]
                                        if values:
                                            avg_val = sum(values) / len(values)
                                            max_val = max(values)
                                            max_date = next(e["date"] for e in entries if e.get("value") == max_val)
                                            type_label = {"niederschlag": "Niederschlag (mm)", "pegel": "Pegelstand",
                                                          "warnung": "Wetterwarnungen", "sturm": "Windböen (km/h)"}.get(wx_type, wx_type)
                                            report_parts = [
                                                f"WETTERDATEN (DWD/NOAA) – {wx_label}, {type_label}:",
                                                f"  Zeitraum: {date_from} bis {date_to}, {len(entries)} Tage",
                                                f"  Ø {avg_val:.1f}, Max: {max_val:.1f} am {max_date}",
                                                f"  Summe: {sum(values):.1f}" if wx_type in ("niederschlag", "pegel") else "",
                                            ]
                                            researcher_reports.append("\n".join(p for p in report_parts if p))
                                            yield sse({"type": "data", "msg": f"Wetter {wx_label} ({type_label}): Ø {avg_val:.1f}, Max {max_val:.1f} am {max_date}"})
                                        else:
                                            yield sse({"type": "data", "msg": f"Wetter {wx_label}: Keine Messwerte"})
                                    else:
                                        yield sse({"type": "data", "msg": f"Wetter {wx_label}: Keine Daten im Zeitraum"})
                                        researcher_reports.append(f"WETTERDATEN – {wx_label}: Keine Daten im Zeitraum {date_from} bis {date_to}")
                            except Exception as e:
                                log.warning("Wetter-Fehler: %s", e)
                                yield sse({"type": "data", "msg": f"Wetter-Fehler: {str(e)[:80]}"})

                        # ── TRACEROUTE ────────────────────────────────────────
                        elif atype == "traceroute":
                            import subprocess, re as _re, socket as _sock
                            import json as _j
                            import urllib.parse as _up
                            from models import WatchZone, TracerouteResult
                            tr_domain = (action.get("domain") or action.get("url") or "").strip()
                            tr_zone_id = action.get("zone_id")
                            if not tr_domain:
                                yield sse({"type": "data", "msg": "Traceroute: kein Domain angegeben"})
                            else:
                                parsed_host = _up.urlparse(tr_domain if "://" in tr_domain else "https://" + tr_domain).hostname or tr_domain
                                yield sse({"type": "status", "msg": f"Traceroute: {parsed_host} …"})
                                try:
                                    import requests as _req
                                    proc = subprocess.run(
                                        ["tracepath", "-n", "-m", "20", parsed_host],
                                        capture_output=True, text=True, timeout=60
                                    )
                                    hops, anomalies, total_km = [], [], 0.0
                                    prev_lat, prev_lng, prev_rtt = None, None, 0.0
                                    for raw in proc.stdout.splitlines():
                                        m = _re.match(r'^\s*(\d+)[?:]?\s+(\S+)\s+(\S+)', raw.strip())
                                        if not m:
                                            continue
                                        hop_num = int(m.group(1))
                                        ip = m.group(2)
                                        rtt_str = m.group(3)
                                        if ip in ("???", "[LOCALHOST]", "no", "localhost"):
                                            hops.append({"hop": hop_num, "ip": None, "rtt": rtt_str})
                                            continue
                                        lat = lng = city = country = asn = org = rdns = None
                                        try:
                                            geo = _req.get(f"http://ip-api.com/json/{ip}?fields=status,lat,lon,city,country,as,org", timeout=4).json()
                                            if geo.get("status") == "success":
                                                lat, lng = geo.get("lat"), geo.get("lon")
                                                city, country = geo.get("city", ""), geo.get("country", "")
                                                asn, org = geo.get("as", ""), geo.get("org", "")
                                        except Exception:
                                            pass
                                        try:
                                            rdns = _sock.gethostbyaddr(ip)[0]
                                        except Exception:
                                            pass
                                        rtt_val = float(_re.search(r'[\d.]+', rtt_str).group()) if _re.search(r'[\d.]+', rtt_str) else 0.0
                                        if lat and lng and prev_lat and prev_lng:
                                            import math
                                            dlat = math.radians(lat - prev_lat)
                                            dlng = math.radians(lng - prev_lng)
                                            a = math.sin(dlat/2)**2 + math.cos(math.radians(prev_lat))*math.cos(math.radians(lat))*math.sin(dlng/2)**2
                                            total_km += 6371 * 2 * math.asin(math.sqrt(a))
                                        hops.append({"hop": hop_num, "ip": ip, "rtt": rtt_str, "lat": lat, "lng": lng, "city": city, "country": country, "asn": asn, "org": org, "rdns": rdns})
                                        prev_lat, prev_lng, prev_rtt = lat, lng, rtt_val
                                    visible = [h for h in hops if h.get("ip")]
                                    anon_c = len(hops) - len(visible)
                                    last_rtt_val = None
                                    for h in reversed(hops):
                                        rv = h.get("rtt", "")
                                        rm = _re.search(r'[\d.]+', str(rv))
                                        if rm:
                                            last_rtt_val = float(rm.group())
                                            break
                                    # Ergebnis in DB speichern (für zukünftige APA-Läufe)
                                    if not tr_zone_id:
                                        # Zone anhand Domain suchen
                                        wz = WatchZone.query.filter_by(user_id=uid).all()
                                        for z in wz:
                                            cfg = _j.loads(z.config) if z.config else {}
                                            if parsed_host in (cfg.get("url", "") + cfg.get("domain", "")):
                                                tr_zone_id = z.id
                                                break
                                    if tr_zone_id:
                                        tr_res = TracerouteResult(
                                            zone_id=tr_zone_id, user_id=uid,
                                            target=parsed_host,
                                            hops_json=_j.dumps(hops),
                                            anomalies_json=_j.dumps(anomalies),
                                            total_km=round(total_km, 1),
                                            last_rtt=last_rtt_val,
                                            hops_count=len(hops),
                                            hops_visible=len(visible),
                                            hops_anon=anon_c,
                                        )
                                        db.session.add(tr_res)
                                        db.session.commit()
                                    geo_hops = [h for h in visible if h.get("lat")]
                                    hop_summary = "; ".join(
                                        f"Hop {h['hop']}: {h['ip']} ({h.get('city','')}, {h.get('country','')}) {h['rtt']} [{h.get('asn','').split()[0] if h.get('asn') else ''}]"
                                        for h in geo_hops[-8:]
                                    )
                                    report = (
                                        f"TRACEROUTE ({parsed_host}): {len(hops)} Hops total, "
                                        f"{len(visible)} sichtbar, {anon_c} anonym, "
                                        f"RTT {last_rtt_val} ms, {round(total_km):,} km\n"
                                        f"  Letzte Hops: {hop_summary}"
                                    )
                                    researcher_reports.append(report)
                                    yield sse({"type": "data", "msg": f"Traceroute {parsed_host}: {len(hops)} Hops, RTT {last_rtt_val} ms, {round(total_km):,} km, {anon_c} anonym"})
                                except subprocess.TimeoutExpired:
                                    yield sse({"type": "data", "msg": f"Traceroute {parsed_host}: Timeout"})
                                except Exception as e:
                                    log.warning("APA Traceroute-Fehler: %s", e)
                                    yield sse({"type": "data", "msg": f"Traceroute-Fehler: {str(e)[:80]}"})

                        # ── BGP / WHOIS LOOKUP ────────────────────────────────
                        elif atype == "bgp_lookup":
                            import requests as _req
                            bl_ip = (action.get("ip") or "").strip()
                            bl_domain = (action.get("domain") or "").strip()
                            if not bl_ip and bl_domain:
                                try:
                                    import socket as _sock2
                                    bl_ip = _sock2.gethostbyname(bl_domain)
                                except Exception:
                                    pass
                            if not bl_ip:
                                yield sse({"type": "data", "msg": "BGP-Lookup: keine IP oder Domain angegeben"})
                            else:
                                yield sse({"type": "status", "msg": f"BGP/WHOIS-Lookup: {bl_ip} …"})
                                try:
                                    whois_data, bgp_data = {}, {}
                                    try:
                                        wr = _req.get(f"https://stat.ripe.net/data/whois/data.json?resource={bl_ip}", timeout=8, headers={"User-Agent": "veritrend-apa/1.0"}).json()
                                        org = country = abuse = netname = None
                                        for record in wr.get("data", {}).get("records", []):
                                            for field in record:
                                                k = (field.get("key") or "").lower()
                                                v = (field.get("value") or "").strip()
                                                if not v: continue
                                                if k in ("org-name", "orgname", "owner", "descr") and not org: org = v
                                                if k == "country" and not country: country = v.upper()
                                                if k in ("abuse-mailbox", "orgabuseemail", "e-mail") and "@" in v and not abuse: abuse = v
                                                if k == "netname" and not netname: netname = v
                                        whois_data = {k: v for k, v in {"org": org, "country": country, "abuse": abuse, "netname": netname}.items() if v}
                                    except Exception: pass
                                    try:
                                        br = _req.get(f"https://stat.ripe.net/data/prefix-overview/data.json?resource={bl_ip}", timeout=8, headers={"User-Agent": "veritrend-apa/1.0"}).json()
                                        bd = br.get("data", {})
                                        bgp_data = {"prefix": bd.get("resource", ""), "announced": bd.get("announced", False),
                                                    "asns": [{"asn": a.get("asn"), "holder": a.get("holder", "")} for a in bd.get("asns", [])[:3]]}
                                    except Exception: pass
                                    report_parts = [f"BGP/WHOIS-LOOKUP ({bl_ip}):"]
                                    if whois_data:
                                        report_parts.append(f"  WHOIS: Org={whois_data.get('org','?')}, Land={whois_data.get('country','?')}, Netname={whois_data.get('netname','?')}")
                                        if whois_data.get("abuse"):
                                            report_parts.append(f"  Abuse-Kontakt: {whois_data['abuse']}")
                                    if bgp_data:
                                        asn_str = ", ".join(f"AS{a['asn']} ({a['holder']})" for a in bgp_data.get("asns", []))
                                        ann = "annonciert" if bgp_data.get("announced") else "NICHT annonciert"
                                        report_parts.append(f"  BGP: Prefix {bgp_data.get('prefix','?')} – {ann} – ASNs: {asn_str}")
                                    researcher_reports.append("\n".join(report_parts))
                                    yield sse({"type": "data", "msg": f"BGP/WHOIS {bl_ip}: {whois_data.get('org','?')} ({whois_data.get('country','?')}) – Prefix {bgp_data.get('prefix','?')}"})
                                except Exception as e:
                                    log.warning("APA BGP-Lookup-Fehler: %s", e)
                                    yield sse({"type": "data", "msg": f"BGP-Lookup-Fehler: {str(e)[:80]}"})

                        # ── WAYBACK MACHINE ───────────────────────────────────
                        elif atype == "wayback":
                            from plugins.watchzone.website._transport import fetch_wayback_changes
                            from datetime import datetime as _dt2, timedelta as _td
                            wb_url = (action.get("url") or action.get("domain") or "").strip()
                            wb_days = min(int(action.get("days", 90)), 365)
                            if not wb_url:
                                yield sse({"type": "data", "msg": "Wayback: keine URL angegeben"})
                            else:
                                if "://" not in wb_url:
                                    wb_url = "https://" + wb_url
                                yield sse({"type": "status", "msg": f"Wayback Machine: {wb_url} ({wb_days} Tage) …"})
                                try:
                                    date_to  = _dt2.utcnow().strftime("%Y-%m-%d")
                                    date_from = (_dt2.utcnow() - _td(days=wb_days)).strftime("%Y-%m-%d")
                                    changes = fetch_wayback_changes(wb_url, date_from, date_to)
                                    if changes:
                                        by_month = {}
                                        for c in changes:
                                            mon = c["date"][:7]
                                            by_month[mon] = by_month.get(mon, 0) + 1
                                        month_str = ", ".join(f"{m}: {n}×" for m, n in sorted(by_month.items())[-6:])
                                        # Titeländerungen ermitteln
                                        title_changes = [c for c in changes if c.get("title_changed")]
                                        titles_seen = list(dict.fromkeys(
                                            c["title"] for c in changes if c.get("title")
                                        ))
                                        report_parts = [
                                            f"WAYBACK MACHINE ({wb_url}, {date_from} bis {date_to}):",
                                            f"  {len(changes)} Inhaltliche Änderungen erkannt (jeweils neuer Digest)",
                                            f"  Letzte Monate: {month_str}",
                                            f"  Erster Snapshot: {changes[0]['date']}, Letzter: {changes[-1]['date']}",
                                        ]
                                        if titles_seen:
                                            report_parts.append(f"  Bekannte Seitentitel ({len(titles_seen)} distinct): " + " | ".join(titles_seen[:8]))
                                        if title_changes:
                                            report_parts.append(f"  ⚠ {len(title_changes)} Titeländerung(en) erkannt:")
                                            for tc in title_changes[:5]:
                                                report_parts.append(f"    {tc['date']} {tc.get('time','')} — \"{tc.get('prev_title','?')}\" → \"{tc['title']}\"")
                                        researcher_reports.append("\n".join(report_parts))
                                        tc_note = f", {len(title_changes)} Titeländerungen" if title_changes else ""
                                        yield sse({"type": "data", "msg": f"Wayback {wb_url}: {len(changes)} Inhaltsänderungen in {wb_days} Tagen{tc_note} – {month_str}"})
                                    else:
                                        researcher_reports.append(f"WAYBACK MACHINE ({wb_url}): Keine Snapshots im Zeitraum {date_from}–{date_to}")
                                        yield sse({"type": "data", "msg": f"Wayback {wb_url}: Keine Snapshots gefunden"})
                                except Exception as e:
                                    log.warning("APA Wayback-Fehler: %s", e)
                                    yield sse({"type": "data", "msg": f"Wayback-Fehler: {str(e)[:80]}"})

                        elif atype == "vessel_traffic":
                            from plugins.watchzone.vessel._transport import fetch_ais_vessels
                            vt_bbox = action.get("bbox")
                            vt_zone_id = action.get("zone_id")
                            if not vt_bbox and vt_zone_id:
                                from models import WatchZone as _WZ2
                                _wz2 = db.session.get(_WZ2, vt_zone_id)
                                if _wz2 and _wz2.geometry:
                                    vt_bbox = _geojson_to_bbox(_j.loads(_wz2.geometry))
                            if not vt_bbox:
                                yield sse({"type": "data", "msg": "vessel_traffic: keine BBox / Zone angegeben"})
                            else:
                                yield sse({"type": "status", "msg": f"AIS-Schiffsdaten werden abgerufen (bbox={vt_bbox}) …"})
                                try:
                                    vessels = fetch_ais_vessels(vt_bbox)
                                    if vessels:
                                        types_cnt: dict = {}
                                        flags_cnt: dict = {}
                                        anomalous = [v for v in vessels if v.get("anomaly_score", 0) > 0]
                                        for v in vessels:
                                            u = v.get("usage", "Unbekannt")
                                            types_cnt[u] = types_cnt.get(u, 0) + 1
                                            f = v.get("flag") or "?"
                                            flags_cnt[f] = flags_cnt.get(f, 0) + 1
                                        type_str = ", ".join(f"{k}: {n}" for k, n in sorted(types_cnt.items(), key=lambda x: -x[1])[:5])
                                        flag_str = ", ".join(f"{k}: {n}" for k, n in sorted(flags_cnt.items(), key=lambda x: -x[1])[:5])
                                        top_anom = [f"{v.get('name') or v.get('mmsi','?')} ({', '.join(v.get('anomaly_flags',[]))})" for v in anomalous[:3]]
                                        report_parts = [
                                            f"SCHIFFSVERKEHR (bbox={vt_bbox}):",
                                            f"  {len(vessels)} Schiffe in der Zone",
                                            f"  Typen: {type_str}",
                                            f"  Flaggen: {flag_str}",
                                            f"  Auffällige Schiffe ({len(anomalous)}): {'; '.join(top_anom) if top_anom else 'keine'}",
                                        ]
                                        researcher_reports.append("\n".join(report_parts))
                                        yield sse({"type": "data", "msg": f"AIS: {len(vessels)} Schiffe – {type_str} | {len(anomalous)} auffällig"})
                                    else:
                                        researcher_reports.append(f"SCHIFFSVERKEHR (bbox={vt_bbox}): Keine Schiffe in der Zone")
                                        yield sse({"type": "data", "msg": "AIS: Keine Schiffe in der Zone gefunden"})
                                except Exception as e:
                                    log.warning("APA vessel_traffic-Fehler: %s", e)
                                    yield sse({"type": "data", "msg": f"AIS-Fehler: {str(e)[:120]}"})

                        elif atype == "aircraft_traffic":
                            from plugins.watchzone.aircraft._transport import fetch_aircraft_live
                            ac_bbox = action.get("bbox")
                            ac_zone_id = action.get("zone_id")
                            if not ac_bbox and ac_zone_id:
                                from models import WatchZone as _WZ3
                                _wz3 = db.session.get(_WZ3, ac_zone_id)
                                if _wz3 and _wz3.geometry:
                                    ac_bbox = _geojson_to_bbox(_j.loads(_wz3.geometry))
                            if not ac_bbox:
                                yield sse({"type": "data", "msg": "aircraft_traffic: keine BBox / Zone angegeben"})
                            else:
                                yield sse({"type": "status", "msg": f"Flugzeugdaten werden abgerufen (bbox={ac_bbox}) …"})
                                try:
                                    aircraft = fetch_aircraft_live(ac_bbox)
                                    if aircraft:
                                        types_cnt: dict = {}
                                        ops_cnt: dict = {}
                                        emergencies = [a for a in aircraft if a.get("emergency", "none") not in ("none", "", None)]
                                        on_ground = sum(1 for a in aircraft if a.get("on_ground"))
                                        for a in aircraft:
                                            t = a.get("type") or "?"
                                            types_cnt[t] = types_cnt.get(t, 0) + 1
                                            op = a.get("operator") or a.get("country") or "?"
                                            ops_cnt[op] = ops_cnt.get(op, 0) + 1
                                        type_str = ", ".join(f"{k}: {n}" for k, n in sorted(types_cnt.items(), key=lambda x: -x[1])[:5])
                                        op_str = ", ".join(f"{k}: {n}" for k, n in sorted(ops_cnt.items(), key=lambda x: -x[1])[:5])
                                        em_str = "; ".join(f"{a.get('callsign','?')} ({a.get('emergency')})" for a in emergencies[:3]) or "keine"
                                        report_parts = [
                                            f"FLUGZEUGVERKEHR (bbox={ac_bbox}):",
                                            f"  {len(aircraft)} Luftfahrzeuge in der Zone ({on_ground} am Boden)",
                                            f"  Typen: {type_str}",
                                            f"  Betreiber: {op_str}",
                                            f"  Notfallsignale: {em_str}",
                                        ]
                                        researcher_reports.append("\n".join(report_parts))
                                        yield sse({"type": "data", "msg": f"ADS-B: {len(aircraft)} Luftfahrzeuge – {type_str} | Notfall: {em_str}"})
                                    else:
                                        researcher_reports.append(f"FLUGZEUGVERKEHR (bbox={ac_bbox}): Keine Luftfahrzeuge in der Zone")
                                        yield sse({"type": "data", "msg": "ADS-B: Keine Luftfahrzeuge in der Zone gefunden"})
                                except Exception as e:
                                    log.warning("APA aircraft_traffic-Fehler: %s", e)
                                    yield sse({"type": "data", "msg": f"ADS-B-Fehler: {str(e)[:120]}"})

                    if should_stop:
                        break

                # ── 4b. Artefakt-Prüfung (bei Low-Volume-Daten) ──────────
                artifact_flag, artifact_report = _check_artifacts()
                if artifact_report:
                    if artifact_flag:
                        yield sse({"type": "data", "msg": "⚠ Artefakt-Verdacht bei Low-Volume-Keywords erkannt"})
                    else:
                        yield sse({"type": "data", "msg": "Artefakt-Prüfung: Parallel-Erhebungen konsistent"})

                # ── 4c. Kritiker-Agent ──────────────────────────────────────
                # Unabhängiger 4. Agent, der Schlussfolgerungen anzweifelt
                generate._critic_report = ""
                if coordinator_history and researcher_reports:
                    yield sse({"type": "status", "msg": "Kritiker prüft Schlussfolgerungen …"})
                    try:
                        critic_context = _build_context()
                        critic_prompt = f"""Du bist der KRITIKER (Advocatus Diaboli) eines Google-Trends-Forschungsteams.
Deine Aufgabe ist es, die Schlussfolgerungen des Koordinators und der Rechercheure KRITISCH zu hinterfragen.

Seed-Keyword: "{seed}"
{('Briefing: ' + briefing) if briefing else ''}

DATENKONTEXT:
{critic_context}

KOORDINATOR-VERLAUF (seine Überlegungen und Hypothesen):
{chr(10).join(f"  Runde {i+1}: {h}" for i, h in enumerate(coordinator_history))}

RECHERCHEUR-BERICHTE:
{chr(10).join(f"  Runde {i+1}: {r}" for i, r in enumerate(researcher_reports))}

DEINE AUFGABE ALS KRITIKER:
Du bist NICHT kooperativ – du suchst aktiv nach Schwachstellen in der Argumentation.

Prüfe systematisch:
1. LOGISCHE FEHLER: Werden Korrelationen als Kausalität interpretiert? Werden Schlüsse gezogen, die die Daten nicht hergeben?
2. ALTERNATIVE ERKLÄRUNGEN: Welche anderen Ursachen könnten die beobachteten Muster erklären?
3. BESTÄTIGUNGSFEHLER: Wurde nur nach bestätigenden Daten gesucht? Welche Gegenbelege fehlen?
4. DATENLÜCKEN: Welche Keywords oder Zeiträume wurden NICHT untersucht, die das Bild verändern könnten?
5. METHODISCHE SCHWÄCHEN: Google-Trends-spezifische Probleme (relative Werte, Sampling, Geo-Verzerrungen)?
6. ÜBERINTERPRETATION: Wo werden aus schwachen Signalen starke Aussagen abgeleitet?

Antworte im JSON-Format:
{{
  "weaknesses": ["Liste konkreter Schwachstellen in der Argumentation"],
  "alternative_explanations": ["Liste alternativer Erklärungen für die beobachteten Muster"],
  "missing_evidence": ["Was müsste zusätzlich untersucht werden?"],
  "overinterpretations": ["Wo wird überinterpretiert?"],
  "summary": "Zusammenfassende kritische Bewertung (3-5 Sätze)"
}}"""
                        _apa_llm_source = "apa-kritiker"
                        critic_raw = _call_llm(critic_prompt, max_tokens=1500)
                        # Parse Kritiker-Antwort
                        import re as _re_critic
                        m_critic = _re_critic.search(r'\{[\s\S]*\}', critic_raw)
                        if m_critic:
                            try:
                                critic_json = _json.loads(m_critic.group(0))
                            except _json.JSONDecodeError:
                                txt_fix = _re_critic.sub(r',\s*([}\]])', r'\1', m_critic.group(0))
                                try:
                                    critic_json = _json.loads(txt_fix)
                                except _json.JSONDecodeError:
                                    critic_json = {}

                            parts = []
                            if critic_json.get("summary"):
                                parts.append(f"Bewertung: {critic_json['summary']}")
                                yield sse({"type": "data", "msg": f"Kritiker: {critic_json['summary']}"})
                            for w in (critic_json.get("weaknesses") or [])[:3]:
                                parts.append(f"Schwachstelle: {w}")
                            for a in (critic_json.get("alternative_explanations") or [])[:3]:
                                parts.append(f"Alternative Erklärung: {a}")
                            for m in (critic_json.get("missing_evidence") or [])[:3]:
                                parts.append(f"Fehlender Beleg: {m}")
                            for o in (critic_json.get("overinterpretations") or [])[:3]:
                                parts.append(f"Überinterpretation: {o}")
                            generate._critic_report = "\n".join(parts)
                    except Exception as e:
                        log.warning("Kritiker-Agent Fehler: %s", e)

                # ── 5. Abschlussbericht ─────────────────────────────────────
                yield sse({"type": "status", "msg": "Erstelle KI-Abschlussbericht …"})

                # Daten für Bericht sammeln
                report_lines = []
                for kid in all_keyword_ids:
                    kw = Keyword.query.get(kid)
                    if not kw:
                        continue
                    trends = TrendData.query.filter_by(
                        keyword_id=kid, run_tag=run_tag
                    ).order_by(TrendData.date).all()

                    report_lines.append(f"\n### Keyword: \"{kw.keyword}\" (Geo: {kw.geo}, Zeitraum: {kw.timeframe or 'Standard'}, Service: {kw.gprop or 'Web'})")
                    if trends:
                        vals = [t.value for t in trends if t.value is not None]
                        if vals:
                            report_lines.append(f"  Datenpunkte: {len(vals)}, Min: {min(vals)}, Max: {max(vals)}, Ø: {sum(vals)/len(vals):.1f}")
                            first5 = trends[:5]
                            last5 = trends[-5:]
                            report_lines.append("  Anfang: " + ", ".join(f"{t.date.strftime('%Y-%m-%d')}={t.value}" for t in first5))
                            report_lines.append("  Ende: " + ", ".join(f"{t.date.strftime('%Y-%m-%d')}={t.value}" for t in last5))
                    rqs = db.session.query(RelatedQuery).filter_by(keyword_id=kid).order_by(
                        RelatedQuery.rank).limit(10).all()
                    if rqs:
                        report_lines.append("  Verwandte Suchanfragen:")
                        for rq in rqs:
                            report_lines.append(f"    [{rq.query_type}] \"{rq.query}\" (Wert: {rq.value})")

                # Ereignisse für Bericht laden
                events_q = Event.query.filter(
                    Event.user_id == uid,
                    db.or_(Event.project_id == project_id, Event.project_id.is_(None))
                ).order_by(Event.start_dt).all()
                if events_q:
                    report_lines.append("\n### Hinterlegte Ereignisse:")
                    for ev in events_q:
                        fmt = "%Y-%m-%d"
                        if ev.event_type == "range" and ev.end_dt:
                            date_str = f"{ev.start_dt.strftime(fmt)} bis {ev.end_dt.strftime(fmt)}"
                        else:
                            date_str = ev.start_dt.strftime(fmt)
                        desc = f" – {ev.description}" if ev.description else ""
                        report_lines.append(f"  • {date_str}: {ev.title}{desc}")

                report_data = "\n".join(report_lines)

                # Datenqualität bewerten
                _kw_total = len(all_keyword_ids)
                _kw_with_data = 0
                _total_datapoints = 0
                for kid in all_keyword_ids:
                    trends = TrendData.query.filter_by(keyword_id=kid, run_tag=run_tag).all()
                    vals = [t.value for t in trends if t.value is not None]
                    if vals:
                        _kw_with_data += 1
                        _total_datapoints += len(vals)

                if _kw_total == 0 or _kw_with_data == 0:
                    _data_quality = "ungenügend"
                    _data_quality_note = (
                        "WICHTIG: Für KEINES der abgefragten Keywords konnten Google-Trends-Daten abgerufen werden. "
                        "Die Datenqualität ist UNGENÜGEND. Der Bericht muss dies prominent und unmissverständlich kommunizieren. "
                        "Ohne Datengrundlage ist keine fundierte Analyse möglich. "
                        "Bewerte die Datenqualität explizit als 'ungenügend'."
                    )
                elif _kw_with_data < _kw_total * 0.5:
                    _data_quality = "mangelhaft"
                    _data_quality_note = (
                        f"WICHTIG: Nur {_kw_with_data} von {_kw_total} Keywords lieferten Daten ({_total_datapoints} Datenpunkte gesamt). "
                        "Die Datenqualität ist MANGELHAFT. Der Bericht muss dies deutlich kommunizieren und alle Aussagen entsprechend einschränken."
                    )
                else:
                    _data_quality = "ausreichend"
                    _data_quality_note = f"{_kw_with_data} von {_kw_total} Keywords lieferten Daten ({_total_datapoints} Datenpunkte gesamt)."

                # Snapshot-Infos für den Bericht sammeln
                _snap_info_lines = []
                for _sid in apa_snapshot_ids:
                    _snap_obj = Snapshot.query.get(_sid)
                    if _snap_obj:
                        _snap_chart = _json.loads(_snap_obj.chart_json) if _snap_obj.chart_json else {}
                        _snap_kws = [m.get("keyword", "") for m in _snap_chart.get("keywords_meta", [])]
                        _snap_info_lines.append(
                            f"  - ID={_sid}, Titel: \"{_snap_obj.title}\", Keywords: {', '.join(_snap_kws)}"
                        )
                _snap_section = ""
                if _snap_info_lines:
                    _snap_section = f"""
Während der Analyse wurden folgende Snapshots (Diagramme) erstellt:
{chr(10).join(_snap_info_lines)}

WICHTIG: Du kannst diese Snapshots als visuelle Charts direkt in den Bericht einbetten!
Verwende dazu den Platzhalter {{{{SNAPSHOT:ID}}}} (z.B. {{{{SNAPSHOT:{apa_snapshot_ids[0]}}}}}), um an der passenden Stelle
im Text das zugehörige Diagramm einzufügen. Platziere Snapshots an inhaltlich sinnvollen Stellen,
z.B. nach der Beschreibung eines Trends oder Vergleichs, auf den sich der Snapshot bezieht.
Jeder Snapshot sollte höchstens einmal eingebettet werden."""

                # Historischen Kontext und Kritiker-Feedback für Bericht sammeln
                _historical_ctx = ""
                try:
                    _historical_ctx = _build_historical_context()
                except Exception as e:
                    log.warning("Historischer Kontext Fehler: %s", e)

                _critic_section = ""
                if hasattr(generate, '_critic_report') and generate._critic_report:
                    _critic_section = f"""
KRITIKER-ANALYSE:
Der unabhängige Kritiker-Agent hat folgende Einwände und alternative Erklärungen formuliert:
{generate._critic_report}
Berücksichtige diese Kritik im Bericht – insbesondere in den Abschnitten Konfidenzanalyse und "Was diese Analyse nicht beweist"."""

                _hypotheses_section = ""
                hypo_entries = [h for h in coordinator_history if "HYPOTHESE:" in h]
                if hypo_entries:
                    _hypotheses_section = "\nHYPOTHESEN-VERLAUF:\n" + "\n".join(
                        f"  Runde {i+1}: {h}" for i, h in enumerate(hypo_entries)
                    ) + "\nBerücksichtige den Hypothesen-Verlauf im Bericht – welche Thesen wurden bestätigt, welche widerlegt?\n"

                report_prompt = f"""Du bist ein erfahrener Datenanalyst bei VeriTrend, einer forensischen Trendanalyse-Plattform.

Erstelle einen umfassenden Abschlussbericht für die automatisierte Projektanalyse zum Thema "{seed}".
{('Briefing/Kontext: ' + briefing) if briefing else ''}

Die folgenden Google-Trends-Daten wurden gesammelt:
{report_data}

{_data_quality_note}
{_snap_section}
{('ARTEFAKT-PRÜFUNG (Sampling-Artefakte bei niedrigem Suchvolumen):' + chr(10) + artifact_report + chr(10) + 'WICHTIG: Wenn Artefakt-Verdacht besteht, weise im Abschnitt Datenqualität darauf hin, dass niedrige Suchvolumina zu Sampling-Artefakten führen können und die betroffenen Werte mit Vorsicht zu interpretieren sind. Wenn Parallel-Erhebungen konsistent sind, erwähne dies als positives Qualitätsmerkmal.') if artifact_report else ''}
{_historical_ctx}
{_critic_section}
{_hypotheses_section}
{_apa_news_context}
Erstelle einen professionellen Analysebericht im Markdown-Format mit folgenden Abschnitten:
1. **Executive Summary** – Kernaussagen in 3-5 Sätzen
2. **Datenqualität** – Bewertung der Datenlage (aktuell: {_data_quality}). Wenn keine oder kaum Daten vorliegen, klar benennen dass keine belastbare Analyse möglich ist.
3. **Trendverlauf** – Beschreibung der wichtigsten Muster und Dynamiken (nur wenn Daten vorhanden)
4. **Regionale Unterschiede** – Falls verschiedene Geo-Kontexte vorhanden
5. **Verwandte Suchanfragen** – Auffällige thematische Cluster und Zusammenhänge
6. **Ereigniskorrelation** – Falls Ereignisse hinterlegt sind: Wie korrelieren sie mit Trend-Änderungen? Erklären sie Peaks oder Einbrüche?
7. **Konfidenzanalyse** – Bewerte JEDE zentrale Aussage des Berichts mit einem Konfidenzwert:
   - **Hoch** (≥80%): Starke Datenbasis, langer Zeitraum, mehrere konvergierende Signale
   - **Mittel** (40-79%): Moderate Datenbasis, einzelne Signale, plausible aber nicht gesicherte Muster
   - **Niedrig** (<40%): Dünne Datenbasis, kurzer Zeitraum, einzelnes Signal ohne Bestätigung
   Nenne für jede Kernaussage: die Aussage selbst, den Konfidenzwert, und die Begründung (Datendichte, Zeitraum, Anzahl konvergierender Signale).
   Formatiere als Tabelle: | Aussage | Konfidenz | Begründung |
8. **Suchenden-Profil** – Wer sucht und warum? Ordne die beobachteten Suchmuster ein:
   - Welche Suchbegriffe deuten auf Betroffene/Opfer hin? (Hilfe, Beratung, Rechte)
   - Welche auf Täter/Planende? (Methoden, Verschleierung, Vermeidung)
   - Welche auf Mitwisser/Eingeweihte? (Suche VOR Bekanntwerden eines Ereignisses)
   - Welche auf rein mediengetriebene Reaktion der Öffentlichkeit?
   Diese Einschätzung muss nicht für jedes Keyword erfolgen, aber die forensisch relevanten Muster benennen.
   Falls Event-Probes durchgeführt wurden: Interpretiere Pre-Event-Suchspuren im Kontext des Suchenden-Profils.
9. **Was diese Analyse nicht beweist** – PFLICHTABSCHNITT. Forensisch entscheidend!
   - Welche naheliegenden Schlussfolgerungen lassen sich aus den Daten NICHT ableiten?
   - Welche alternativen Erklärungen für die beobachteten Muster existieren?
   - Welche Datenlücken verhindern belastbare Aussagen?
   - Was müsste zusätzlich erhoben werden, um offene Fragen zu klären?
   Sei hier explizit und ehrlich – ein forensischer Bericht gewinnt durch Transparenz über seine Grenzen.
10. **Bewertung & Handlungsempfehlung** – Einordnung und mögliche nächste Schritte

Schreibe auf Deutsch. Sei analytisch präzise, aber verständlich. Max. 2000 Wörter."""

                try:
                    _apa_llm_source = "apa-bericht"
                    report = _call_llm(report_prompt, max_tokens=4096)
                except Exception as e:
                    report = f"Fehler bei der Berichterstellung: {e}"

                # Bericht als Text/Bild-Slide im Projekt speichern
                max_snap_o  = db.session.query(db.func.max(Snapshot.sort_order)).filter_by(project_id=project_id).scalar() or 0
                max_slide_o = db.session.query(db.func.max(Slide.sort_order)).filter_by(project_id=project_id).scalar() or 0
                new_order   = max(max_snap_o, max_slide_o) + 1

                report_slide = Slide(
                    project_id  = project_id,
                    slide_type  = "textbild",
                    title       = f"KI-Analysebericht: {seed}",
                    description = report,
                    content     = _json.dumps({"snapshot_ids": apa_snapshot_ids}) if apa_snapshot_ids else "",
                    sort_order  = new_order,
                )
                db.session.add(report_slide)
                db.session.commit()

                yield sse({"type": "report", "msg": "Bericht erstellt",
                           "report": report, "project_id": project_id,
                           "slide_id": report_slide.id})
                # Statistik: verwandte Suchbegriffe zählen
                related_count = 0
                for kid in all_keyword_ids:
                    related_count += RelatedQuery.query.filter_by(keyword_id=kid).count()

                stats_msg = f"Analyse abgeschlossen – {len(all_keyword_ids)} Keywords abgerufen, {related_count} verwandte Suchbegriffe berücksichtigt"
                audit_log("apa_complete", "project", project_id,
                          f"{len(all_keyword_ids)} Keywords, {related_count} Related Queries, {len(apa_snapshot_ids)} Snapshots",
                          project_id=project_id, user_id=uid)
                yield sse({"type": "done", "msg": stats_msg,
                           "project_id": project_id,
                           "keywords_count": len(all_keyword_ids),
                           "related_count": related_count})

        except Exception as exc:
            log.error("AI-Assist Fehler: %s", exc, exc_info=True)
            yield sse({"type": "error", "msg": str(exc)})

    return Response(generate(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})




