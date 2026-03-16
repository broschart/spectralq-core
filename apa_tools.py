"""
APA (AI Project Assistant) – WatchZone Tool-Use
------------------------------------------------
Tool-Definitionen und -Ausführung für den KI-Projektassistenten.
Ausgelagert aus app.py für bessere Modularität.
"""

from models import db
from plugins import PluginManager
from plugins.watchzone._helpers import geojson_to_bbox as _geojson_to_bbox

# ── Core-Tools (nicht plugin-spezifisch) ──────────────────────────────────
_WZ_CORE_TOOLS = [
    {
        "name": "list_watchzones",
        "description": "Listet alle Watch Zones des Nutzers auf (Name, Typ, ID, aktiv, Projekt).",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "get_watchzone_details",
        "description": "Gibt die Konfiguration und Metadaten einer einzelnen Watch Zone zurück.",
        "input_schema": {
            "type": "object",
            "properties": {
                "zone_id": {"type": "integer", "description": "ID der Watch Zone"}
            },
            "required": ["zone_id"],
        },
    },
    {
        "name": "get_live_data",
        "description": (
            "Ruft aktuelle Live-Daten einer Watch Zone ab. "
            "Funktioniert für Typen: website, censys, aircraft, vessel, weather, seismic. "
            "Nicht geeignet für satellite/ndvi/nightlights (Bilddaten)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "zone_id": {"type": "integer", "description": "ID der Watch Zone"}
            },
            "required": ["zone_id"],
        },
    },
    {
        "name": "create_watchzone",
        "description": (
            "Legt eine neue Watch Zone an. "
            "Für Website-Zonen: zone_type='website', url angeben. "
            "Für Geo-Zonen: lat/lon/radius_km angeben."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "name":      {"type": "string",  "description": "Name der Watch Zone"},
                "zone_type": {"type": "string",  "description": "Typ: website | vessel | aircraft | weather | seismic | censys | satellite | ndvi | nightlights"},
                "url":       {"type": "string",  "description": "URL (nur für zone_type='website')"},
                "lat":       {"type": "number",  "description": "Breitengrad Mittelpunkt (für Geo-Zonen)"},
                "lon":       {"type": "number",  "description": "Längengrad Mittelpunkt (für Geo-Zonen)"},
                "radius_km": {"type": "number",  "description": "Radius in km (für Geo-Zonen, Standard: 100)"},
                "project_id":{"type": "integer", "description": "Optionale Projekt-ID"},
            },
            "required": ["name", "zone_type"],
        },
    },
    # ── Standalone-Triangulations-Tools ────────────────────────────────────────
    {
        "name": "wiki_views",
        "description": "Ruft Wikipedia-Seitenaufrufe für Artikel ab (Wikimedia API, kein API-Key). Liefert tägliche Abrufzahlen, Trend und Spikes als unabhängiges Signal.",
        "input_schema": {
            "type": "object",
            "properties": {
                "articles": {"type": "array", "items": {"type": "string"}, "description": "Wikipedia-Artikelnamen (max. 5)"},
                "lang":     {"type": "string",  "description": "Sprachcode: de, en, fr, ru usw. (Standard: de)"},
                "days":     {"type": "integer", "description": "Zeitraum in Tagen (max. 730, Standard: 90)"},
            },
            "required": ["articles"],
        },
    },
    {
        "name": "gdelt_volume",
        "description": "Ruft GDELT-Medienberichterstattung für Suchbegriffe ab (kein API-Key). Tägliche Artikelanzahl in weltweiten Nachrichtenmedien.",
        "input_schema": {
            "type": "object",
            "properties": {
                "terms": {"type": "array", "items": {"type": "string"}, "description": "Suchbegriffe (max. 5)"},
                "days":  {"type": "integer", "description": "Zeitraum in Tagen (max. 365, Standard: 90)"},
            },
            "required": ["terms"],
        },
    },
    {
        "name": "yahoo_finance",
        "description": "Ruft historische Aktienkurse und Handelsvolumen ab (Yahoo Finance). Unterstützt Aktien, ETFs und Kryptowährungen (z.B. AAPL, BTC-USD, GLD).",
        "input_schema": {
            "type": "object",
            "properties": {
                "symbols": {"type": "array", "items": {"type": "string"}, "description": "Ticker-Symbole (max. 5)"},
                "days":    {"type": "integer", "description": "Zeitraum in Tagen (Standard: 90)"},
            },
            "required": ["symbols"],
        },
    },
    {
        "name": "run_traceroute",
        "description": "Führt einen aktiven Traceroute zu einer Domain, URL oder IP aus. Zeigt Hops, RTT, Länder und geschätzte Distanz in km.",
        "input_schema": {
            "type": "object",
            "properties": {
                "target": {"type": "string", "description": "Domain, URL oder IP-Adresse"},
            },
            "required": ["target"],
        },
    },
    {
        "name": "bgp_lookup",
        "description": "BGP/WHOIS-Lookup für eine IP-Adresse oder Domain (RIPE NCC). Liefert Organisation, Land, Netzname und ASN-Info.",
        "input_schema": {
            "type": "object",
            "properties": {
                "ip":     {"type": "string", "description": "IP-Adresse (alternativ zu domain)"},
                "domain": {"type": "string", "description": "Domain – wird zu IP aufgelöst (alternativ zu ip)"},
            },
        },
    },
    {
        "name": "wayback",
        "description": "Ruft Änderungshistorie einer URL/Domain aus der Wayback Machine (Internet Archive) ab.",
        "input_schema": {
            "type": "object",
            "properties": {
                "url":       {"type": "string",  "description": "URL oder Domain"},
                "date_from": {"type": "string",  "description": "Startdatum YYYY-MM-DD (Standard: vor 90 Tagen)"},
                "date_to":   {"type": "string",  "description": "Enddatum YYYY-MM-DD (Standard: heute)"},
            },
            "required": ["url"],
        },
    },
]


def _get_wz_tools(user_id=None):
    """Baut die vollständige Tool-Liste: Core-Tools + Plugin-Tools (nur enabled)."""
    tools = list(_WZ_CORE_TOOLS)
    src = PluginManager.enabled_for_user("watchzone", user_id) if user_id else PluginManager.all_of_type("watchzone")
    for _pid, plugin in src.items():
        tools.extend(plugin.ai_tools())
    return tools


def _get_wz_tools_oai(user_id=None):
    """OpenAI-Format der vollständigen Tool-Liste."""
    return [
        {"type": "function", "function": {
            "name": t["name"], "description": t["description"],
            "parameters": t["input_schema"],
        }} for t in _get_wz_tools(user_id)
    ]


def _execute_wz_tool(tool_name: str, inputs: dict, user_id: int) -> dict:
    """Führt ein WatchZone-Tool aus und gibt das Ergebnis als dict zurück."""
    import json as _j
    import math as _math
    from models import WatchZone, TracerouteResult

    def _bbox_from_latlon(lat, lon, radius_km):
        """Einfache Bbox-Annäherung um einen Punkt."""
        deg_per_km = 1 / 111.0
        d = radius_km * deg_per_km
        return {
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [lon - d, lat - d], [lon + d, lat - d],
                    [lon + d, lat + d], [lon - d, lat + d],
                    [lon - d, lat - d],
                ]],
            },
        }

    if tool_name == "list_watchzones":
        zones = WatchZone.query.filter_by(user_id=user_id).order_by(WatchZone.created_at.desc()).all()
        return {"zones": [
            {"id": z.id, "name": z.name, "zone_type": z.zone_type,
             "active": z.active, "project_id": z.project_id,
             "created_at": z.created_at.isoformat() if z.created_at else None}
            for z in zones
        ]}

    elif tool_name == "get_watchzone_details":
        z = WatchZone.query.filter_by(id=inputs["zone_id"], user_id=user_id).first()
        if not z:
            return {"error": f"Zone {inputs['zone_id']} nicht gefunden"}
        d = z.to_dict()
        d["traceroute_count"] = TracerouteResult.query.filter_by(zone_id=z.id, user_id=user_id).count()
        return d

    elif tool_name == "get_live_data":
        z = WatchZone.query.filter_by(id=inputs["zone_id"], user_id=user_id).first()
        if not z:
            return {"error": f"Zone {inputs['zone_id']} nicht gefunden"}
        if z.zone_type in ("satellite", "ndvi", "nightlights"):
            return {"error": f"Live-Daten für Typ '{z.zone_type}' enthalten Bilddaten und können nicht als Text zurückgegeben werden."}
        plugin = PluginManager.get("watchzone", z.zone_type)
        if not plugin:
            return {"error": f"Unbekannter Zonentyp: {z.zone_type}"}
        cfg = _j.loads(z.config) if z.config else {}
        geo = _j.loads(z.geometry) if z.geometry else {}
        bbox = _geojson_to_bbox(geo)
        try:
            return plugin.live_handler(z, cfg, geo, bbox, user_id)
        except Exception as e:
            return {"error": str(e)}

    elif tool_name == "create_watchzone":
        zone_type = inputs.get("zone_type", "")
        valid_types = tuple(PluginManager.all_of_type("watchzone").keys())
        if zone_type not in valid_types:
            return {"error": f"Ungültiger zone_type. Erlaubt: {', '.join(valid_types)}"}
        config = {}
        if zone_type == "website":
            url = inputs.get("url", "").strip()
            if not url:
                return {"error": "Für zone_type='website' ist url erforderlich"}
            if not url.startswith("http"):
                url = "https://" + url
            config = {"url": url}
            geometry = {"type": "FeatureCollection", "features": []}
        else:
            lat = inputs.get("lat")
            lon = inputs.get("lon")
            if lat is None or lon is None:
                return {"error": "Für Geo-Zonen sind lat und lon erforderlich"}
            radius_km = float(inputs.get("radius_km", 100))
            geometry = _bbox_from_latlon(float(lat), float(lon), radius_km)
        z = WatchZone(
            name=inputs.get("name", f"Zone {zone_type}"),
            zone_type=zone_type,
            geometry=_j.dumps(geometry),
            config=_j.dumps(config),
            active=True,
            project_id=inputs.get("project_id"),
            user_id=user_id,
        )
        db.session.add(z)
        db.session.commit()
        return {"created": True, "zone": z.to_dict()}

    # ── Standalone-Triangulations-Tools ──────────────────────────────────────

    if tool_name == "wiki_views":
        import requests as _req_wiki
        articles  = inputs.get("articles", [])[:5]
        lang      = inputs.get("lang", "de")
        days      = min(int(inputs.get("days", 90)), 730)
        import datetime as _dt
        end_dt   = _dt.datetime.utcnow()
        start_dt = end_dt - _dt.timedelta(days=days)
        start_s  = start_dt.strftime("%Y%m%d")
        end_s    = end_dt.strftime("%Y%m%d")
        UA = "VeriTrend.ai/1.0 (forensic trend analysis)"
        results = []
        for article in articles:
            ac = article.strip().replace(" ", "_")
            if not ac:
                continue
            url = (f"https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/"
                   f"{lang}.wikipedia/all-access/all-agents/"
                   f"{_req_wiki.utils.quote(ac, safe='')}/daily/{start_s}/{end_s}")
            try:
                r = _req_wiki.get(url, headers={"User-Agent": UA}, timeout=15)
                if r.status_code == 404:
                    results.append({"article": article, "lang": lang, "error": "Artikel nicht gefunden"})
                    continue
                r.raise_for_status()
                items = r.json().get("items", [])
                if not items:
                    results.append({"article": article, "lang": lang, "error": "Keine Daten"})
                    continue
                views = [it.get("views", 0) for it in items]
                dates = [it.get("timestamp", "")[:8] for it in items]
                total = sum(views)
                avg = total / len(views) if views else 0
                max_val = max(views) if views else 0
                max_idx = views.index(max_val) if views else 0
                max_date = dates[max_idx]
                if max_date:
                    max_date = f"{max_date[:4]}-{max_date[4:6]}-{max_date[6:8]}"
                direction = "stabil"
                if len(views) >= 14:
                    q = len(views) // 4 or 1
                    avg_start = sum(views[:q]) / q
                    avg_end   = sum(views[-q:]) / q
                    if avg_end > avg_start * 1.3:    direction = "steigend"
                    elif avg_end < avg_start * 0.7:  direction = "fallend"
                spikes = []
                if avg > 0:
                    for i, v in enumerate(views):
                        if v > avg * 3:
                            d = dates[i]
                            spikes.append({"date": f"{d[:4]}-{d[4:6]}-{d[6:8]}" if len(d) == 8 else d,
                                           "views": v, "factor": round(v / avg, 1)})
                    spikes.sort(key=lambda x: -x["views"])
                    spikes = spikes[:5]
                results.append({
                    "article": article, "lang": lang,
                    "datapoints": len(views), "total_views": total,
                    "avg_daily": round(avg, 0), "max_views": max_val, "max_date": max_date,
                    "direction": direction, "spikes": spikes,
                    "first7_avg": round(sum(views[:7]) / 7, 0) if len(views) >= 7 else round(avg, 0),
                    "last7_avg":  round(sum(views[-7:]) / 7, 0) if len(views) >= 7 else round(avg, 0),
                })
            except Exception as exc:
                results.append({"article": article, "lang": lang, "error": str(exc)[:80]})
        return {"results": results}

    elif tool_name == "gdelt_volume":
        import requests as _req_gdelt
        import csv as _csv
        import io as _io
        import datetime as _dt
        terms = inputs.get("terms", [])[:5]
        days  = min(int(inputs.get("days", 90)), 365)
        end_dt    = _dt.datetime.utcnow()
        start_dt  = end_dt - _dt.timedelta(days=days)
        start_s   = start_dt.strftime("%Y%m%d%H%M%S")
        end_s     = end_dt.strftime("%Y%m%d%H%M%S")
        results = []
        for term in terms:
            if not term.strip():
                continue
            try:
                r = _req_gdelt.get(
                    "https://api.gdeltproject.org/api/v2/doc/doc",
                    params={"query": term.strip(), "mode": "timelinevolraw",
                            "startdatetime": start_s, "enddatetime": end_s,
                            "format": "csv"},
                    timeout=20, headers={"User-Agent": "VeriTrend.ai/1.0"},
                )
                r.raise_for_status()
                reader = _csv.DictReader(_io.StringIO(r.text))
                datapoints = []
                for row in reader:
                    date = list(row.values())[0] if row else ""
                    val  = float(list(row.values())[1]) if len(row) >= 2 else 0
                    datapoints.append({"date": date, "value": val})
                if not datapoints:
                    results.append({"term": term, "error": "Keine Daten"})
                    continue
                vals    = [d["value"] for d in datapoints]
                avg     = sum(vals) / len(vals) if vals else 0
                max_val = max(vals) if vals else 0
                max_idx = vals.index(max_val) if vals else 0
                direction = "stabil"
                if len(vals) >= 14:
                    q = len(vals) // 4 or 1
                    avg_s = sum(vals[:q]) / q
                    avg_e = sum(vals[-q:]) / q
                    if avg_e > avg_s * 1.3:    direction = "steigend"
                    elif avg_e < avg_s * 0.7:  direction = "fallend"
                spikes_count = sum(1 for v in vals if avg > 0 and v > avg * 3)
                results.append({
                    "term": term, "datapoints": len(datapoints),
                    "avg_daily": round(avg, 1), "max_daily": round(max_val, 1),
                    "max_date": datapoints[max_idx]["date"] if datapoints else "",
                    "direction": direction, "spikes_count": spikes_count,
                    "first7_avg": round(sum(vals[:7]) / 7, 1) if len(vals) >= 7 else round(avg, 1),
                    "last7_avg":  round(sum(vals[-7:]) / 7, 1) if len(vals) >= 7 else round(avg, 1),
                })
            except Exception as exc:
                results.append({"term": term, "error": str(exc)[:80]})
        return {"results": results}

    elif tool_name == "yahoo_finance":
        try:
            import yfinance as _yf
        except ImportError:
            return {"error": "yfinance nicht installiert"}
        import datetime as _dt
        symbols = inputs.get("symbols", [])[:5]
        days    = min(int(inputs.get("days", 90)), 730)
        end_dt  = _dt.datetime.utcnow()
        start_dt = end_dt - _dt.timedelta(days=days)
        results = []
        for sym in symbols:
            sym = sym.strip().upper()
            if not sym:
                continue
            try:
                tk   = _yf.Ticker(sym)
                hist = tk.history(start=start_dt.strftime("%Y-%m-%d"),
                                  end=end_dt.strftime("%Y-%m-%d"), auto_adjust=True)
                if hist.empty:
                    results.append({"symbol": sym, "error": "Keine Daten"})
                    continue
                closes  = hist["Close"].tolist()
                volumes = hist["Volume"].tolist()
                dates   = [str(d)[:10] for d in hist.index.tolist()]
                avg_price = sum(closes) / len(closes)
                max_price = max(closes)
                min_price = min(closes)
                pct_change = ((closes[-1] - closes[0]) / closes[0] * 100) if closes[0] else 0
                direction = "steigend" if pct_change > 3 else ("fallend" if pct_change < -3 else "stabil")
                big_moves = [{"date": dates[i], "pct": round((closes[i] - closes[i-1]) / closes[i-1] * 100, 2)}
                             for i in range(1, len(closes))
                             if closes[i-1] and abs(closes[i] - closes[i-1]) / closes[i-1] > 0.03][:5]
                info = tk.info or {}
                results.append({
                    "symbol": sym,
                    "currency": info.get("currency", "?"),
                    "name": info.get("shortName", sym),
                    "datapoints": len(closes),
                    "latest_price": round(closes[-1], 4),
                    "avg_price": round(avg_price, 4),
                    "max_price": round(max_price, 4),
                    "min_price": round(min_price, 4),
                    "pct_change": round(pct_change, 2),
                    "direction": direction,
                    "big_moves": big_moves,
                })
            except Exception as exc:
                results.append({"symbol": sym, "error": str(exc)[:80]})
        return {"results": results}

    elif tool_name == "run_traceroute":
        import subprocess, re as _re, socket as _sock, urllib.parse as _up
        target = inputs.get("target", "").strip()
        if not target:
            return {"error": "Kein Ziel angegeben"}
        parsed_host = _up.urlparse(target if "://" in target else "https://" + target).hostname or target
        try:
            proc = subprocess.run(
                ["tracepath", "-n", "-m", "20", parsed_host],
                capture_output=True, text=True, timeout=60,
            )
            hops = []
            total_km = 0.0
            prev_lat = prev_lng = None
            for raw in proc.stdout.splitlines():
                m = _re.match(r'^\s*(\d+)[?:]?\s+(\S+)\s+(\S+)', raw.strip())
                if not m:
                    continue
                hop_num = int(m.group(1))
                ip      = m.group(2)
                rtt_str = m.group(3)
                if ip in ("???", "[LOCALHOST]", "no", "localhost"):
                    hops.append({"hop": hop_num, "ip": None, "rtt": rtt_str})
                    continue
                lat = lng = city = country = asn = None
                try:
                    import requests as _rreq
                    geo = _rreq.get(f"http://ip-api.com/json/{ip}?fields=status,lat,lon,city,country,as",
                                    timeout=4).json()
                    if geo.get("status") == "success":
                        lat, lng = geo.get("lat"), geo.get("lon")
                        city, country, asn = geo.get("city"), geo.get("country"), geo.get("as")
                except Exception:
                    pass
                if lat and lng and prev_lat and prev_lng:
                    import math as _mt
                    dlat = _mt.radians(lat - prev_lat)
                    dlng = _mt.radians(lng - prev_lng)
                    a = (_mt.sin(dlat/2)**2
                         + _mt.cos(_mt.radians(prev_lat)) * _mt.cos(_mt.radians(lat))
                         * _mt.sin(dlng/2)**2)
                    total_km += 6371 * 2 * _mt.asin(_mt.sqrt(a))
                hops.append({"hop": hop_num, "ip": ip, "rtt": rtt_str,
                             "lat": lat, "lng": lng, "city": city,
                             "country": country, "asn": asn})
                prev_lat, prev_lng = lat, lng
            visible  = [h for h in hops if h.get("ip")]
            anon_c   = len(hops) - len(visible)
            last_rtt = None
            for h in reversed(hops):
                rm = _re.search(r'[\d.]+', str(h.get("rtt", "")))
                if rm:
                    last_rtt = float(rm.group())
                    break
            return {
                "target": parsed_host,
                "hops_total": len(hops), "hops_visible": len(visible), "hops_anon": anon_c,
                "last_rtt_ms": last_rtt, "total_km": round(total_km, 1),
                "hops": hops,
            }
        except subprocess.TimeoutExpired:
            return {"error": f"Traceroute zu {parsed_host} hat das Zeitlimit überschritten"}
        except Exception as e:
            return {"error": str(e)}

    elif tool_name == "bgp_lookup":
        import requests as _rreq
        import socket as _sock
        bl_ip     = (inputs.get("ip") or "").strip()
        bl_domain = (inputs.get("domain") or "").strip()
        if not bl_ip and bl_domain:
            try:
                bl_ip = _sock.gethostbyname(bl_domain)
            except Exception:
                pass
        if not bl_ip:
            return {"error": "Keine IP-Adresse oder Domain angegeben"}
        try:
            whois_data, bgp_data = {}, {}
            try:
                wr = _rreq.get(f"https://stat.ripe.net/data/whois/data.json?resource={bl_ip}",
                               timeout=8, headers={"User-Agent": "veritrend-apa/1.0"}).json()
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
                whois_data = {k: v for k, v in
                              {"org": org, "country": country, "abuse": abuse, "netname": netname}.items() if v}
            except Exception:
                pass
            try:
                br = _rreq.get(f"https://stat.ripe.net/data/prefix-overview/data.json?resource={bl_ip}",
                               timeout=8, headers={"User-Agent": "veritrend-apa/1.0"}).json()
                bd = br.get("data", {})
                bgp_data = {
                    "prefix": bd.get("resource", ""), "announced": bd.get("announced", False),
                    "asns": [{"asn": a.get("asn"), "holder": a.get("holder", "")}
                             for a in bd.get("asns", [])[:5]],
                }
            except Exception:
                pass
            return {"ip": bl_ip, "domain": bl_domain or None, "whois": whois_data, "bgp": bgp_data}
        except Exception as e:
            return {"error": str(e)}

    elif tool_name == "wayback":
        import datetime as _dt
        wb_url = (inputs.get("url") or "").strip()
        if not wb_url:
            return {"error": "Keine URL angegeben"}
        if "://" not in wb_url:
            wb_url = "https://" + wb_url
        date_to   = inputs.get("date_to")  or _dt.datetime.utcnow().strftime("%Y-%m-%d")
        date_from = inputs.get("date_from") or (_dt.datetime.utcnow() - _dt.timedelta(days=90)).strftime("%Y-%m-%d")
        try:
            from plugins.watchzone.website._transport import fetch_wayback_changes
            changes = fetch_wayback_changes(wb_url, date_from, date_to)
            if not changes:
                return {"url": wb_url, "date_from": date_from, "date_to": date_to, "changes": 0}
            by_month: dict = {}
            for c in changes:
                mon = c["date"][:7]
                by_month[mon] = by_month.get(mon, 0) + 1
            title_changes = [c for c in changes if c.get("title_changed")]
            return {
                "url": wb_url, "date_from": date_from, "date_to": date_to,
                "changes_total": len(changes),
                "by_month": {k: v for k, v in sorted(by_month.items())[-12:]},
                "title_changes": len(title_changes),
                "first_change": changes[0]["date"],
                "last_change":  changes[-1]["date"],
                "recent": changes[-10:],
            }
        except Exception as e:
            return {"error": str(e)}

    # ── Plugin-delegierte Tools ─────────────────────────────────────────────
    for _pid, _plugin in PluginManager.all_of_type("watchzone").items():
        for _tool_def in _plugin.ai_tools():
            if _tool_def["name"] == tool_name:
                return _plugin.ai_tool_handler(tool_name, inputs, user_id)

    return {"error": f"Unbekanntes Tool: {tool_name}"}
