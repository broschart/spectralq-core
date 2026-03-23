"""Wikipedia Watch Zone Plugin — Article Edit Monitoring."""

import logging
from collections import Counter
from datetime import datetime, timedelta, timezone

from flask import jsonify
from plugins import PluginManager
from plugins.watchzone import WatchZonePlugin

log = logging.getLogger(__name__)

UA = "VeriTrend.ai/1.0 (forensic trend analysis; contact@veritrend.ai)"

def _resolve_wiki_title(term, lang):
    """Resolve exact Wikipedia article title via Search API."""
    import requests as _rq
    try:
        url = (
            f"https://{lang}.wikipedia.org/w/api.php?"
            f"action=query&list=search&srsearch={_rq.utils.quote(term)}"
            f"&srlimit=1&format=json"
        )
        r = _rq.get(url, headers={"User-Agent": UA}, timeout=10)
        r.raise_for_status()
        hits = r.json().get("query", {}).get("search", [])
        if hits:
            return hits[0]["title"]
    except Exception:
        pass
    return None

def _fetch_views(article, lang, days=30, date_from=None, date_to=None):
    """Fetch daily pageview counts for a Wikipedia article."""
    import requests as _rq

    resolved = _resolve_wiki_title(article, lang)
    wiki_title = (resolved or article).replace(" ", "_")

    if date_from and date_to:
        start_str = date_from.replace("-", "") + "00"
        end_str = date_to.replace("-", "") + "00"
    else:
        end_dt = datetime.now(timezone.utc)
        start_dt = end_dt - timedelta(days=days)
        start_str = start_dt.strftime("%Y%m%d") + "00"
        end_str = end_dt.strftime("%Y%m%d") + "00"

    try:
        url = (f"https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/"
               f"{lang}.wikipedia/all-access/all-agents/"
               f"{_rq.utils.quote(wiki_title, safe='')}/daily/{start_str}/{end_str}")
        r = _rq.get(url, headers={"User-Agent": UA}, timeout=15)
        if not r.ok:
            return []
        items = r.json().get("items", [])
        return [{"date": it["timestamp"][:4]+"-"+it["timestamp"][4:6]+"-"+it["timestamp"][6:8],
                 "views": it.get("views", 0)} for it in items]
    except Exception:
        return []


def _fetch_edits(article, lang, days=30, date_from=None, date_to=None):
    """Fetch revision data for a single article over the given number of days."""
    import requests as _rq

    resolved = _resolve_wiki_title(article, lang)
    wiki_title = resolved or article

    if date_from and date_to:
        start_dt = datetime.strptime(date_from[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)
        end_dt = datetime.strptime(date_to[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)
    else:
        end_dt = datetime.now(timezone.utc)
        start_dt = end_dt - timedelta(days=days)
    rv_start = end_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    rv_end = start_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    edits_per_day = Counter()
    size_changes = Counter()  # net size change per day
    # Autoren-Tracking pro Tag: {date: {user: {"edits": n, "size_delta": n, "reverts": n}}}
    authors_per_day = {}
    all_users = set()
    total_revisions = 0
    total_reverts = 0
    rvcontinue = None
    prev_size = None
    # Uhrzeiten pro Autor sammeln
    author_hours = {}   # {user: [hour, ...]}
    author_reverts = Counter()  # {user: revert_count}
    # Einzelne Edits für Timeline-PC: {date: [{user, hour, size_delta, revert}]}
    edits_detail = {}  # date -> list

    _REVERT_TAGS = {"mw-revert", "mw-undo", "mw-rollback", "mw-manual-revert"}
    import re as _re_rv
    _REVERT_COMMENT = _re_rv.compile(
        r"(revert|rv |undo|r[üu]ckg[äa]ngig|annul|d[ée]fair)",
        _re_rv.IGNORECASE)

    try:
        for _ in range(50):
            params = {
                "action": "query", "prop": "revisions", "titles": wiki_title,
                "rvprop": "timestamp|size|user|comment|tags", "rvlimit": "500",
                "rvstart": rv_start, "rvend": rv_end, "format": "json",
            }
            if rvcontinue:
                params["rvcontinue"] = rvcontinue

            api_url = f"https://{lang}.wikipedia.org/w/api.php"
            r = _rq.get(api_url, params=params, headers={"User-Agent": UA}, timeout=15)
            r.raise_for_status()
            data = r.json()

            pages = data.get("query", {}).get("pages", {})
            for page_id, page in pages.items():
                if page_id == "-1":
                    return {"article": article, "wiki_title": wiki_title, "error": "not_found"}
                for rev in page.get("revisions", []):
                    full_ts = rev.get("timestamp", "")
                    ts = full_ts[:10]
                    sz = rev.get("size", 0)
                    user = rev.get("user", "")
                    comment = rev.get("comment", "")
                    tags = set(rev.get("tags", []))

                    # Revert-Erkennung
                    is_revert = bool(
                        tags & _REVERT_TAGS or
                        _REVERT_COMMENT.search(comment))

                    # Uhrzeit extrahieren (0-23)
                    hour = None
                    if len(full_ts) >= 16:
                        try:
                            hour = int(full_ts[11:13])
                        except ValueError:
                            pass

                    if ts:
                        edits_per_day[ts] += 1
                        total_revisions += 1
                        if is_revert:
                            total_reverts += 1
                        delta = 0
                        if prev_size is not None:
                            delta = sz - prev_size
                            size_changes[ts] += delta
                        prev_size = sz
                        if user:
                            all_users.add(user)
                            if ts not in authors_per_day:
                                authors_per_day[ts] = {}
                            if user not in authors_per_day[ts]:
                                authors_per_day[ts][user] = {
                                    "edits": 0, "size_delta": 0,
                                    "reverts": 0}
                            authors_per_day[ts][user]["edits"] += 1
                            authors_per_day[ts][user]["size_delta"] += delta
                            if is_revert:
                                authors_per_day[ts][user]["reverts"] += 1
                                author_reverts[user] += 1
                            if hour is not None:
                                if user not in author_hours:
                                    author_hours[user] = []
                                author_hours[user].append(hour)
                                # Einzelne Edits für Timeline
                                if ts not in edits_detail:
                                    edits_detail[ts] = []
                                edits_detail[ts].append({
                                    "user": user,
                                    "hour": hour,
                                    "min": int(full_ts[14:16]) if len(full_ts) >= 16 else 0,
                                    "size_delta": delta,
                                    "revert": is_revert,
                                    "comment": comment[:200] if comment else "",
                                })

            cont = data.get("continue", {})
            rvcontinue = cont.get("rvcontinue")
            if not rvcontinue:
                break

        # Autoren-Zusammenfassung: Gesamt-Edits pro Autor
        author_totals = Counter()
        author_size = Counter()
        for day_authors in authors_per_day.values():
            for user, stats in day_authors.items():
                author_totals[user] += stats["edits"]
                author_size[user] += stats["size_delta"]

        # Top-Autoren (nach Edit-Anzahl)
        top_authors = [u for u, _ in author_totals.most_common(20)]

        # Reputation für Top-Autoren abrufen
        import re as _re_ip
        author_rep = {}
        author_age = {}  # {user: age_days}
        reg_users = [u for u in top_authors
                     if not _re_ip.match(r"^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-fA-F:]+$", u)]
        if reg_users:
            for batch_start in range(0, len(reg_users), 50):
                batch = reg_users[batch_start:batch_start + 50]
                try:
                    ui_resp = _rq.get(api_url, params={
                        "action": "query", "list": "users",
                        "ususers": "|".join(batch),
                        "usprop": "editcount|registration|groups|blockinfo",
                        "format": "json",
                    }, headers={"User-Agent": UA}, timeout=15)
                    if ui_resp.ok:
                        for u in ui_resp.json().get("query", {}).get("users", []):
                            name = u.get("name", "")
                            editcount = u.get("editcount", 0)
                            reg_date = u.get("registration", "")
                            groups = [g for g in u.get("groups", [])
                                      if g not in ("*", "user", "autoconfirmed")]
                            blocked = "blockid" in u
                            age_days = None
                            if reg_date:
                                try:
                                    rd = datetime.strptime(
                                        reg_date, "%Y-%m-%dT%H:%M:%SZ")
                                    age_days = (datetime.utcnow() - rd).days
                                except Exception:
                                    pass
                            score = 0
                            if editcount >= 100000: score += 40
                            elif editcount >= 10000: score += 35
                            elif editcount >= 1000: score += 28
                            elif editcount >= 100: score += 18
                            elif editcount >= 10: score += 8
                            elif editcount >= 1: score += 3
                            if age_days is not None:
                                if age_days >= 3650: score += 30
                                elif age_days >= 1825: score += 25
                                elif age_days >= 365: score += 18
                                elif age_days >= 90: score += 10
                                elif age_days >= 30: score += 5
                            if "sysop" in groups or "bureaucrat" in groups:
                                score += 20
                            elif "reviewer" in groups or "editor" in groups:
                                score += 10
                            elif "patroller" in groups or "rollbacker" in groups:
                                score += 8
                            if blocked:
                                score = max(0, score - 30)
                            score = min(100, score)
                            author_rep[name] = score
                            if age_days is not None:
                                author_age[name] = age_days
                except Exception:
                    pass

        # Alle Tage im Zeitraum generieren (inkl. Tage ohne Edits)
        all_days = []
        cur = start_dt
        while cur <= end_dt:
            all_days.append(cur.strftime("%Y-%m-%d"))
            cur += timedelta(days=1)

        series = []
        for d in all_days:
            day_data = {
                "date": d,
                "edits": edits_per_day.get(d, 0),
                "size_delta": size_changes.get(d, 0),
            }
            # Autoren pro Tag (nur Top-20 für Performance)
            if d in authors_per_day:
                day_authors = sorted(
                    authors_per_day[d].items(),
                    key=lambda x: -x[1]["edits"])
                day_data["authors"] = [
                    {"user": u, "edits": s["edits"],
                     "size_delta": s["size_delta"]}
                    for u, s in day_authors[:20]
                ]
            # Einzelne Edits für Timeline (max 50 pro Tag)
            if d in edits_detail:
                day_data["edits_list"] = edits_detail[d][:50]
            series.append(day_data)

        # Autoren-Übersicht
        authors_summary = []
        for user in top_authors:
            is_ip = bool(_re_ip.match(
                r"^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-fA-F:]+$", user))
            hours = author_hours.get(user, [])
            avg_hour = round(sum(hours) / len(hours), 1) if hours else None
            authors_summary.append({
                "user": user,
                "edits": author_totals[user],
                "size_delta": author_size[user],
                "reputation": author_rep.get(user),
                "age_days": author_age.get(user),
                "reverts": author_reverts.get(user, 0),
                "avg_hour": avg_hour,
                "is_ip": is_ip,
            })

        return {
            "article": article, "wiki_title": wiki_title, "lang": lang,
            "total_edits": total_revisions,
            "total_reverts": total_reverts,
            "series": series,
            "authors": authors_summary,
        }
    except Exception as exc:
        return {"article": article, "error": str(exc)[:120]}

class WikipediaPlugin(WatchZonePlugin):
    plugin_id = "wikipedia"

    meta = {
        "label": "Wikipedia",
        "icon_svg": (
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" '
            'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
            '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>'
            '<path d="M8 7h6"/><path d="M8 11h8"/>'
            '</svg>'
        ),
        "color": "#636363",
        "description": "Wikipedia-Artikelmonitoring: Bearbeitungen und Abrufzahlen",
        "category": "web",
        "required_credentials": [],
        "has_live": True,
        "has_history": True,
        "panel_template": "wikipedia/_panel.html",
        "js_file": "/plugins/watchzone/wikipedia/static/wikipedia.js",

    }

    def live_handler(self, zone, config, geo, bbox, user_id):
        articles = config.get("articles", [])
        if isinstance(articles, str):
            articles = [a.strip() for a in articles.split(",") if a.strip()]
        lang = config.get("lang", "de")
        if not articles:
            return {"error": "Keine Artikel konfiguriert"}

        time_focus = config.get("time_focus")
        _tf_from = None
        _tf_to = None

        if time_focus and time_focus.get("from"):
            try:
                focus_date = datetime.strptime(time_focus["from"][:10], "%Y-%m-%d")
                _tf_from = (focus_date - timedelta(days=15)).strftime("%Y-%m-%d")
                _tf_to = (focus_date + timedelta(days=15)).strftime("%Y-%m-%d")
            except ValueError:
                pass

        results = []
        for art in articles[:5]:
            title = art if isinstance(art, str) else art.get("title", "")
            if not title:
                continue
            if _tf_from and _tf_to:
                edit_data = _fetch_edits(title, lang, date_from=_tf_from, date_to=_tf_to)
                edit_data["views"] = _fetch_views(title, lang, date_from=_tf_from, date_to=_tf_to)
            else:
                edit_data = _fetch_edits(title, lang, days=30)
                edit_data["views"] = _fetch_views(title, lang, days=30)
            results.append(edit_data)

        total_edits = sum(r.get("total_edits", 0) for r in results if "error" not in r)
        result = {
            "zone_id": zone.id, "zone_name": zone.name,
            "zone_type": "wikipedia", "lang": lang,
            "count": total_edits, "articles": results,
        }
        if time_focus:
            result["time_focus"] = time_focus
        return result

    def history_routes(self):
        return [
            {"suffix": "wiki-history", "handler": self._history_handler},
        ]

    def _history_handler(self, zone, args, user_id):
        import json as _j
        config = _j.loads(zone.config) if zone.config else {}
        articles = config.get("articles", [])
        lang = config.get("lang", "de")
        days_str = args.get("days", "365")
        days = min(int(days_str), 730)
        if not articles:
            return jsonify({"error": "Keine Artikel konfiguriert"}), 400

        results = []
        for art in articles[:5]:
            title = art if isinstance(art, str) else art.get("title", "")
            if title:
                results.append(_fetch_edits(title, lang, days=days))

        return jsonify({"zone_id": zone.id, "zone_name": zone.name, "articles": results})

    def ai_tools(self):
        return [{
            "name": "get_wikipedia_edits",
            "description": "Ruft aktuelle Wikipedia-Bearbeitungen fuer konfigurierte Artikel einer Watch Zone ab.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "zone_id": {"type": "integer", "description": "ID der Watch Zone"},
                    "days": {"type": "integer", "description": "Anzahl Tage (Standard: 30, max: 730)"},
                },
                "required": ["zone_id"],
            },
        }]

    def ai_tool_handler(self, tool_name, inputs, user_id):
        if tool_name != "get_wikipedia_edits":
            return {"error": f"Unbekanntes Tool: {tool_name}"}
        import json as _j
        from models import WatchZone
        z = WatchZone.query.filter_by(id=inputs["zone_id"], user_id=user_id).first()
        if not z:
            return {"error": f"Zone {inputs['zone_id']} nicht gefunden"}
        cfg = _j.loads(z.config) if z.config else {}
        articles = cfg.get("articles", [])
        lang = cfg.get("lang", "de")
        days = min(int(inputs.get("days", 30)), 730)
        results = []
        for art in articles[:5]:
            title = art if isinstance(art, str) else art.get("title", "")
            if title:
                results.append(_fetch_edits(title, lang, days=days))
        return {"zone_id": z.id, "zone_name": z.name, "articles": results}

    def analysis_provider(self):
        return {
            "data_types": ["wikipedia"],
            "history_endpoint_suffix": "wiki-history",
            "analysis_js": "/plugins/watchzone/wikipedia/static/wikipedia_analysis.js",
            "ui_prefix": "wiki",
            "ui_label": "Wikipedia",
            "ui_color": "#636363",
            "zone_types": ["wikipedia"],
            "accepts_global": False,
        }

PluginManager.register(WikipediaPlugin())
