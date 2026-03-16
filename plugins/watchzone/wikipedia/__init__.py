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

def _fetch_edits(article, lang, days=30):
    """Fetch revision data for a single article over the given number of days."""
    import requests as _rq

    resolved = _resolve_wiki_title(article, lang)
    wiki_title = resolved or article

    end_dt = datetime.now(timezone.utc)
    start_dt = end_dt - timedelta(days=days)
    rv_start = end_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    rv_end = start_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    edits_per_day = Counter()
    size_changes = Counter()  # net size change per day
    total_revisions = 0
    rvcontinue = None
    prev_size = None

    try:
        for _ in range(50):
            params = {
                "action": "query", "prop": "revisions", "titles": wiki_title,
                "rvprop": "timestamp|size|user", "rvlimit": "500",
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
                    ts = rev.get("timestamp", "")[:10]
                    sz = rev.get("size", 0)
                    if ts:
                        edits_per_day[ts] += 1
                        total_revisions += 1
                        if prev_size is not None:
                            size_changes[ts] += sz - prev_size
                        prev_size = sz

            cont = data.get("continue", {})
            rvcontinue = cont.get("rvcontinue")
            if not rvcontinue:
                break

        series = [{"date": d, "edits": edits_per_day[d], "size_delta": size_changes.get(d, 0)}
                  for d in sorted(edits_per_day.keys())]

        return {
            "article": article, "wiki_title": wiki_title, "lang": lang,
            "total_edits": total_revisions, "series": series,
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
        lang = config.get("lang", "de")
        if not articles:
            return {"error": "Keine Artikel konfiguriert"}

        results = []
        for art in articles[:5]:
            title = art if isinstance(art, str) else art.get("title", "")
            if not title:
                continue
            results.append(_fetch_edits(title, lang, days=30))

        total_edits = sum(r.get("total_edits", 0) for r in results if "error" not in r)
        return {
            "zone_id": zone.id, "zone_name": zone.name,
            "zone_type": "wikipedia", "lang": lang,
            "count": total_edits, "articles": results,
        }

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
        return {"data_types": ["wikipedia"], "history_endpoint_suffix": "wiki-history"}

PluginManager.register(WikipediaPlugin())
