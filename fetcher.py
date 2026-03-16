"""
Google Trends Fetcher
---------------------
Unterstützt drei Backends (Reihenfolge über Admin-Seite konfigurierbar):

  1. Playwright + Browser-Cookies  – kostenlos, funktioniert mit exportierten
               Cookies aus dem eigenen Browser.
               Env: TRENDS_COOKIES_FILE=/pfad/zu/cookies.json
               Cookies exportieren mit Browser-Extension "Cookie Editor"
               (https://cookie-editor.com) → Export → Format: Netscape/Header
               → Als cookies.json speichern.

  2. pytrends  – leichtgewichtige Python-Bibliothek, kein Browser nötig.
               Kostenlos, aber anfälliger für Rate-Limiting.

  3. SerpAPI  – zuverlässig, 100 kostenlose Anfragen/Monat
               Env: SERPAPI_KEY=dein-key
               https://serpapi.com/google-trends-api

Unterstützte Zeitrahmen (timeframe):
  today 12-m  – letzte 12 Monate (wöchentlich)   [Standard]
  today 5-y   – letzte 5 Jahre (monatlich)
  today 3-m   – letzte 3 Monate (täglich)
  today 1-m   – letzter Monat (täglich)
  now 7-d     – letzte 7 Tage (stündlich)
  now 1-d     – letzte 24 Stunden (stündlich)
  now 4-H     – letzte 4 Stunden (minütlich)
  now 1-H     – letzte Stunde (minütlich)

Unterstützte Dienste (gprop):
  ""        – Web-Suche (Standard)
  "news"    – Google News
  "images"  – Google Bilder
  "youtube" – YouTube
  "froogle" – Google Shopping
"""

import json
import logging
import os
import random
import time
from datetime import datetime, timezone
from urllib.parse import quote_plus

log = logging.getLogger(__name__)


class NoDataError(RuntimeError):
    """Google Trends hat für diese Anfrage keine Daten geliefert (kein technischer Fehler)."""


SERPAPI_KEY = os.getenv("SERPAPI_KEY", "")
COOKIES_FILE = os.getenv("TRENDS_COOKIES_FILE", "")
if not COOKIES_FILE:
    _default_cf = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cookies.json")
    if os.path.exists(_default_cf):
        COOKIES_FILE = _default_cf

DEFAULT_TIMEFRAME = "now 7-d"


# ---------------------------------------------------------------------------
# Timestamp-Normalisierung je nach Zeitrahmen-Granularität
# ---------------------------------------------------------------------------

def _normalize_dt(ts: int, timeframe: str) -> datetime:
    """
    Normalisiert einen Unix-Timestamp auf die passende Granularität:
    - today …  → Tagesstart (Mitternacht)
    - now 7-d  → Stundenbeginn
    - now 1-d  → Minutenbeginn (~8-Minuten-Intervalle)
    - now 4-H / 1-H → Minutenbeginn
    """
    dt = datetime.fromtimestamp(ts)
    if timeframe.startswith("today") or timeframe == "all":
        return dt.replace(hour=0, minute=0, second=0, microsecond=0)
    elif "7-d" in timeframe:
        return dt.replace(minute=0, second=0, microsecond=0)
    else:
        # Minuten-Granularität (now 4-H, now 1-H, …)
        return dt.replace(second=0, microsecond=0)


# ---------------------------------------------------------------------------
# Backend 1: SerpAPI
# ---------------------------------------------------------------------------

def _fetch_serpapi(keyword: str, geo: str = "DE",
                   timeframe: str = DEFAULT_TIMEFRAME,
                   gprop: str = "",
                   api_key: str = "") -> dict[datetime, int]:
    """Ruft Google Trends über SerpAPI ab."""
    from serpapi import GoogleSearch  # pip install google-search-results

    params = {
        "engine": "google_trends",
        "q": keyword,
        "date": timeframe,
        "hl": "de",
        "api_key": api_key or SERPAPI_KEY,
    }
    if geo:   params["geo"]   = geo   # leer = Weltweit → Parameter weglassen
    if gprop: params["gprop"] = gprop

    search = GoogleSearch(params)
    results = search.get_dict()

    if "error" in results:
        err_msg = results["error"]
        # SerpAPI meldet explizit, dass Google keine Daten für die Anfrage hat
        if "no results" in err_msg.lower() or "hasn't returned" in err_msg.lower():
            raise NoDataError(f"SerpAPI: keine Daten für diese Anfrage: {err_msg}")
        raise RuntimeError(f"SerpAPI Fehler: {err_msg}")

    timeline = (
        results.get("interest_over_time", {}).get("timeline_data", [])
    )
    if not timeline:
        raise NoDataError("SerpAPI: leere Zeitreihe (keine Datenpunkte)")

    result: dict[datetime, int] = {}
    for entry in timeline:
        try:
            ts = int(entry["timestamp"])
            val = int(entry["values"][0]["extracted_value"])
            result[_normalize_dt(ts, timeframe)] = val
        except (KeyError, ValueError, IndexError):
            pass

    return result


def _fetch_related_serpapi(keyword: str, geo: str = "DE",
                            timeframe: str = DEFAULT_TIMEFRAME,
                            gprop: str = "",
                            api_key: str = "") -> dict:
    """Ruft Related Queries (rising + top) über SerpAPI ab."""
    from serpapi import GoogleSearch

    params = {
        "engine": "google_trends",
        "q": keyword,
        "date": timeframe,
        "hl": "de",
        "data_type": "RELATED_QUERIES",
        "api_key": api_key or SERPAPI_KEY,
    }
    if geo:   params["geo"]   = geo   # leer = Weltweit → Parameter weglassen
    if gprop: params["gprop"] = gprop

    results = GoogleSearch(params).get_dict()
    if "error" in results:
        raise RuntimeError(f"SerpAPI Related Queries Fehler: {results['error']}")

    rq = results.get("related_queries", {})
    return {
        "rising": rq.get("rising", []),
        "top":    rq.get("top", []),
    }


# ---------------------------------------------------------------------------
# Backend 2: Playwright + Cookies
# ---------------------------------------------------------------------------

def _load_cookies(cookies_file: str) -> list[dict]:
    """
    Liest Cookies aus einer JSON-Datei.
    Unterstützt sowohl das Playwright-Format als auch das
    EditThisCookie/Cookie-Editor-Exportformat.
    """
    with open(cookies_file, "r", encoding="utf-8") as f:
        raw = json.load(f)

    import time as _time
    now = _time.time()

    cookies = []
    for c in raw:
        # Ablaufdatum prüfen – abgelaufene Cookies weglassen
        exp_raw = c.get("expirationDate") or c.get("expires")
        if isinstance(exp_raw, (int, float)) and 0 < exp_raw < now:
            log.debug("Cookie '%s' abgelaufen, wird übersprungen", c.get("name", "?"))
            continue

        # Playwright erwartet: name, value, domain, path
        cookie = {
            "name":   c.get("name", ""),
            "value":  c.get("value", ""),
            "domain": c.get("domain", ".google.com"),
            "path":   c.get("path", "/"),
        }
        if c.get("secure") is not None:
            cookie["secure"] = bool(c["secure"])
        if c.get("httpOnly") is not None:
            cookie["httpOnly"] = bool(c["httpOnly"])
        if isinstance(exp_raw, (int, float)) and exp_raw > 0:
            cookie["expires"] = int(exp_raw)
        # sameSite weitergeben (Google nutzt oft "None" + secure)
        ss = c.get("sameSite") or c.get("samesite")
        if ss and ss in ("Strict", "Lax", "None"):
            cookie["sameSite"] = ss
        cookies.append(cookie)
        # Cookies von länderspezifischen Google-Domains auch für .google.com bereitstellen
        domain = cookie.get("domain", "")
        if domain.endswith(".google.de") or domain.endswith(".google.co.uk") or domain.endswith(".google.fr"):
            com_cookie = dict(cookie)
            com_cookie["domain"] = domain.replace(".google.de", ".google.com").replace(".google.co.uk", ".google.com").replace(".google.fr", ".google.com")
            cookies.append(com_cookie)

    log.debug("%d Cookies geladen (von %d gesamt)", len(cookies), len(raw))
    return cookies


def _fetch_playwright(keyword: str, geo: str = "DE",
                      timeframe: str = DEFAULT_TIMEFRAME,
                      gprop: str = "",
                      cookies_file: str = "") -> dict[datetime, int]:
    """Ruft Google Trends per Playwright + Browser-Cookies ab."""
    from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

    geo_param   = f"&geo={geo}" if geo else ""
    gprop_param = f"&gprop={gprop}" if gprop else ""
    date_param  = timeframe.replace(" ", "+")

    # Sprach- und Regionskontexte für Playwright
    _hl_map = {"US": "en", "GB": "en", "FR": "fr", "ES": "es", "IT": "it",
               "BR": "pt", "NL": "nl", "PL": "pl", "TR": "tr", "RU": "ru",
               "JP": "ja", "KR": "ko", "CN": "zh", "SA": "ar", "DE": "de"}
    _tz_map = {"US": "America/New_York", "GB": "Europe/London", "FR": "Europe/Paris",
               "ES": "Europe/Madrid", "IT": "Europe/Rome", "BR": "America/Sao_Paulo",
               "JP": "Asia/Tokyo", "KR": "Asia/Seoul", "CN": "Asia/Shanghai",
               "RU": "Europe/Moscow", "DE": "Europe/Berlin"}
    hl = _hl_map.get(geo, "en") if geo else "en"
    locale_str = f"{hl}-{geo}" if geo else "en-US"
    tz_id = _tz_map.get(geo, "Europe/Berlin") if geo else "America/New_York"

    url = (
        f"https://trends.google.com/trends/explore"
        f"?q={quote_plus(keyword)}&date={date_param}{geo_param}{gprop_param}&hl={hl}"
    )

    captured: list[dict] = []

    def on_response(response):
        if "trends/api/widgetdata/multiline" in response.url:
            try:
                text = response.body().decode("utf-8", errors="replace")
                if text.startswith(")]}'"):
                    text = text.split("\n", 1)[1]
                captured.append(json.loads(text))
            except Exception as e:
                log.warning("Antwort-Parsing: %s", e)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        ctx = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            locale=locale_str,
            timezone_id=tz_id,
            viewport={"width": 1280, "height": 800},
        )

        # Cookies einladen
        _cf = cookies_file or COOKIES_FILE
        if _cf and os.path.exists(_cf):
            cookies = _load_cookies(_cf)
            ctx.add_cookies(cookies)
            log.debug("%d Cookies geladen aus %s", len(cookies), _cf)
        else:
            log.warning(
                "Keine Cookies gefunden (TRENDS_COOKIES_FILE nicht gesetzt). "
                "Google Trends kann 429 zurückgeben."
            )

        page = ctx.new_page()
        page.on("response", on_response)

        max_retries = 2
        for attempt in range(max_retries + 1):
            captured.clear()
            got_429 = False

            def _check_429(response):
                nonlocal got_429
                if response.url.startswith("https://trends.google.com/trends/explore") and response.status == 429:
                    got_429 = True
            page.on("response", _check_429)

            try:
                page.goto(url, wait_until="domcontentloaded", timeout=40_000)

                # GDPR-Consent annehmen falls nötig
                _accept_consent_playwright(page)

                # Auf API-Antwort warten (max. 25 s)
                deadline = time.time() + 25
                while not captured and not got_429 and time.time() < deadline:
                    page.wait_for_timeout(500)

            except PWTimeout:
                log.error("Playwright-Timeout für '%s' (Versuch %d)", keyword, attempt + 1)

            page.remove_listener("response", _check_429)

            if captured:
                break
            if got_429 and attempt < max_retries:
                wait = 30 * (attempt + 1)
                log.info("429 für '%s' – warte %ds vor Retry %d", keyword, wait, attempt + 2)
                time.sleep(wait)
            else:
                break

        ctx.close()
        browser.close()

    if not captured:
        raise RuntimeError("Keine Daten empfangen (429 oder Timeout)")

    timeline = captured[0].get("default", {}).get("timelineData", [])
    result: dict[datetime, int] = {}
    for entry in timeline:
        try:
            ts = int(entry["time"])
            val = int(entry["value"][0])
            result[_normalize_dt(ts, timeframe)] = val
        except (KeyError, ValueError, IndexError):
            pass

    if not result:
        raise NoDataError("Playwright: API-Antwort empfangen, aber keine Datenpunkte")

    return result


def _fetch_related_playwright(keyword: str, geo: str = "DE",
                               timeframe: str = DEFAULT_TIMEFRAME,
                               gprop: str = "",
                               cookies_file: str = "") -> dict:
    """
    Ruft Related Queries per Playwright ab, indem die
    'relatedsearches'-API-Antwort von Google Trends abgefangen wird.
    rankedList[0] = Top-Queries, rankedList[1] = Rising-Queries.
    """
    from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

    geo_param   = f"&geo={geo}" if geo else ""
    gprop_param = f"&gprop={gprop}" if gprop else ""
    date_param  = timeframe.replace(" ", "+")

    _hl_map = {"US": "en", "GB": "en", "FR": "fr", "ES": "es", "IT": "it",
               "BR": "pt", "NL": "nl", "PL": "pl", "TR": "tr", "RU": "ru",
               "JP": "ja", "KR": "ko", "CN": "zh", "SA": "ar", "DE": "de"}
    _tz_map = {"US": "America/New_York", "GB": "Europe/London", "FR": "Europe/Paris",
               "ES": "Europe/Madrid", "IT": "Europe/Rome", "BR": "America/Sao_Paulo",
               "JP": "Asia/Tokyo", "KR": "Asia/Seoul", "CN": "Asia/Shanghai",
               "RU": "Europe/Moscow", "DE": "Europe/Berlin"}
    hl = _hl_map.get(geo, "en") if geo else "en"
    locale_str = f"{hl}-{geo}" if geo else "en-US"
    tz_id = _tz_map.get(geo, "Europe/Berlin") if geo else "America/New_York"

    url = (
        f"https://trends.google.com/trends/explore"
        f"?q={quote_plus(keyword)}&date={date_param}{geo_param}{gprop_param}&hl={hl}"
    )

    captured_related: list[dict] = []
    captured_multiline: list[dict] = []  # benötigt damit die Seite nicht abgebrochen wird

    got_429 = False

    def on_response(response):
        nonlocal got_429
        if "trends/api/widgetdata/relatedsearches" in response.url:
            log.info("Related-Queries Response: status=%d, url=%s", response.status, response.url[:120])
            if response.status == 429:
                got_429 = True
                return
            try:
                text = response.body().decode("utf-8", errors="replace")
                if text.startswith(")]}'"):
                    text = text.split("\n", 1)[1]
                data = json.loads(text)
                captured_related.append(data)
                # Log what we got
                rl = data.get("default", {}).get("rankedList", [])
                counts = [len(entry.get("rankedKeyword", [])) for entry in rl]
                log.info("Related-Queries geparst: rankedList mit %s Einträgen", counts)
            except Exception as e:
                log.warning("Related-Queries-Parsing: %s", e)
        elif "trends/api/widgetdata/multiline" in response.url:
            captured_multiline.append(True)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        ctx = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            locale=locale_str,
            timezone_id=tz_id,
            viewport={"width": 1280, "height": 800},
        )
        _cf2 = cookies_file or COOKIES_FILE
        if _cf2 and os.path.exists(_cf2):
            ctx.add_cookies(_load_cookies(_cf2))

        page = ctx.new_page()
        page.on("response", on_response)

        try:
            page.goto(url, wait_until="domcontentloaded", timeout=40_000)
            _accept_consent_playwright(page)
            # Google sendet zwei relatedsearches-Antworten:
            #   1. keywordType=ENTITY (Themen, oft leer)
            #   2. keywordType=QUERY  (echte Suchanfragen, mit Daten)
            # Warten bis mindestens eine Antwort mit echten Query-Einträgen vorliegt.
            def _got_query_data():
                for r in captured_related:
                    for rl in r.get("default", {}).get("rankedList", []):
                        for item in rl.get("rankedKeyword", []):
                            if item.get("query"):
                                return True
                return False

            deadline = time.time() + 35
            while not _got_query_data() and time.time() < deadline:
                page.wait_for_timeout(500)
        except PWTimeout:
            log.error("Playwright-Timeout (related queries) für '%s'", keyword)
        finally:
            ctx.close()
            browser.close()

    log.info("Related-Queries Playwright: %d Antworten empfangen für '%s', 429=%s", len(captured_related), keyword, got_429)
    if not captured_related:
        if got_429:
            raise RuntimeError("429 Rate-Limit bei Related Queries")
        raise RuntimeError("Keine Related-Queries-Daten empfangen (Timeout oder Seite nicht geladen)")

    # Google liefert zwei separate relatedsearches-Antworten:
    #   [0] = Themen/Topics  (item hat "topic": {"title": ...}, kein "query"-Feld)
    #   [1] = Suchanfragen   (item hat "query": "...",          das wollen wir)
    # Wir suchen die Antwort, die echte Suchanfragen enthält.
    def _has_queries(resp):
        rl = resp.get("default", {}).get("rankedList", [])
        for rl_entry in rl:
            for item in rl_entry.get("rankedKeyword", []):
                if item.get("query"):
                    return True
        return False

    query_resp = next((r for r in captured_related if _has_queries(r)), captured_related[0])
    ranked_list = query_resp.get("default", {}).get("rankedList", [])

    # rankedList[0]=Top, rankedList[1]=Rising
    def parse_ranked(idx):
        if idx >= len(ranked_list):
            return []
        items = ranked_list[idx].get("rankedKeyword", [])
        result = []
        for i, item in enumerate(items):
            # Suchanfragen: item["query"]  |  Themen: item["topic"]["title"]
            q = item.get("query") or item.get("topic", {}).get("title", "")
            result.append({
                "query": q,
                "value": str(item.get("value", item.get("formattedValue", ""))),
                "rank": i,
            })
        return result

    return {
        "top":    parse_ranked(0),
        "rising": parse_ranked(1),
    }


def _accept_consent_playwright(page):
    try:
        accept_texts = ["Alle akzeptieren", "Accept all", "Tout accepter",
                        "Aceptar todo", "Accetta tutto", "Aceitar tudo"]
        for frame in page.frames:
            if "consent.google.com" in frame.url:
                for txt in accept_texts:
                    btn = frame.locator("button").filter(has_text=txt)
                    if btn.count():
                        btn.first.click()
                        page.wait_for_timeout(1500)
                        return
        for txt in accept_texts:
            btn = page.locator("button").filter(has_text=txt)
            if btn.count():
                btn.first.click()
                page.wait_for_timeout(1500)
                return
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Backend 3: pytrends
# ---------------------------------------------------------------------------

def _fetch_pytrends(keyword: str, geo: str = "DE",
                    timeframe: str = DEFAULT_TIMEFRAME,
                    gprop: str = "",
                    tz_offset: int = 60,
                    hl: str = "de") -> dict[datetime, int]:
    """Ruft Google Trends über die pytrends-Bibliothek ab (kein Browser nötig)."""
    from pytrends.request import TrendReq

    pt = TrendReq(hl=hl, tz=tz_offset)
    pt.build_payload([keyword], geo=geo, timeframe=timeframe, gprop=gprop)
    df = pt.interest_over_time()

    if df is None or df.empty:
        raise NoDataError("pytrends: keine Daten empfangen (rate-limited oder keine Daten verfügbar)")

    result: dict[datetime, int] = {}
    for ts, row in df.iterrows():
        try:
            dt = ts.to_pydatetime().replace(tzinfo=None)
            result[_normalize_dt(int(dt.timestamp()), timeframe)] = int(row[keyword])
        except (KeyError, ValueError):
            pass
    return result


def _fetch_related_pytrends(keyword: str, geo: str = "DE",
                              timeframe: str = DEFAULT_TIMEFRAME,
                              gprop: str = "",
                              tz_offset: int = 60,
                              hl: str = "de") -> dict:
    """Ruft Related Queries über pytrends ab."""
    from pytrends.request import TrendReq

    pt = TrendReq(hl=hl, tz=tz_offset)
    pt.build_payload([keyword], geo=geo, timeframe=timeframe, gprop=gprop)
    related = pt.related_queries()

    result = {"rising": [], "top": []}
    kw_data = related.get(keyword) or {}
    for q_type in ["rising", "top"]:
        df = kw_data.get(q_type)
        if df is not None and not df.empty:
            for i, row in df.iterrows():
                result[q_type].append({
                    "query": str(row.get("query", "")),
                    "value": str(row.get("value", "")),
                    "rank":  i,
                })
    return result


def _fetch_region_pytrends(keyword: str, geo: str = "",
                            timeframe: str = "today 12-m",
                            gprop: str = "",
                            resolution: str = "REGION",
                            tz_offset: int = 60,
                            hl: str = "de") -> list:
    """
    Ruft Interesse-nach-Region über pytrends ab.
    resolution: 'REGION' (Bundesländer/Provinzen) oder 'CITY'
    Gibt eine nach value absteigende Liste von Dicts zurück:
      [{geo_name, geo_code, value}, ...]
    """
    from pytrends.request import TrendReq

    pt = TrendReq(hl=hl, tz=tz_offset)
    pt.build_payload([keyword], geo=geo, timeframe=timeframe, gprop=gprop)
    df = pt.interest_by_region(
        resolution=resolution,
        inc_low_vol=True,
        inc_geo_code=True,
    )

    if df is None or df.empty:
        raise RuntimeError(
            f"pytrends interest_by_region: keine Daten (resolution={resolution})"
        )

    result = []
    for geo_name, row in df.iterrows():
        try:
            val = int(row.get(keyword, 0))
        except (ValueError, TypeError):
            val = 0
        if val <= 0:
            continue
        result.append({
            "geo_name": str(geo_name),
            "geo_code": str(row.get("geoCode", "")),
            "value":    val,
        })

    result.sort(key=lambda x: x["value"], reverse=True)
    return result


# ---------------------------------------------------------------------------
# Multi-Keyword Backends (2-5 Keywords in einer Abfrage → gemeinsame Skala)
# ---------------------------------------------------------------------------

def _fetch_multi_serpapi(keywords: list[str], geo: str = "DE",
                         timeframe: str = DEFAULT_TIMEFRAME,
                         gprop: str = "",
                         api_key: str = "") -> dict[str, dict[datetime, int]]:
    """Ruft 2-5 Keywords in EINER SerpAPI-Abfrage ab → gemeinsame Skala."""
    from serpapi import GoogleSearch

    params = {
        "engine": "google_trends",
        "q": ",".join(keywords),
        "date": timeframe,
        "hl": "de",
        "api_key": api_key or SERPAPI_KEY,
    }
    if geo:   params["geo"]   = geo
    if gprop: params["gprop"] = gprop

    search = GoogleSearch(params)
    results = search.get_dict()

    if "error" in results:
        err_msg = results["error"]
        if "no results" in err_msg.lower() or "hasn't returned" in err_msg.lower():
            raise NoDataError(f"SerpAPI multi: keine Daten: {err_msg}")
        raise RuntimeError(f"SerpAPI multi Fehler: {err_msg}")

    timeline = results.get("interest_over_time", {}).get("timeline_data", [])
    if not timeline:
        raise NoDataError("SerpAPI multi: leere Zeitreihe")

    multi: dict[str, dict[datetime, int]] = {kw: {} for kw in keywords}
    for entry in timeline:
        try:
            ts = int(entry["timestamp"])
            dt = _normalize_dt(ts, timeframe)
            for i, kw in enumerate(keywords):
                val = int(entry["values"][i]["extracted_value"])
                multi[kw][dt] = val
        except (KeyError, ValueError, IndexError):
            pass
    return multi


def _fetch_multi_playwright(keywords: list[str], geo: str = "DE",
                             timeframe: str = DEFAULT_TIMEFRAME,
                             gprop: str = "",
                             cookies_file: str = "") -> dict[str, dict[datetime, int]]:
    """Ruft 2-5 Keywords in EINER Playwright-Abfrage ab → gemeinsame Skala."""
    from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

    geo_param   = f"&geo={geo}" if geo else ""
    gprop_param = f"&gprop={gprop}" if gprop else ""
    date_param  = timeframe.replace(" ", "+")

    _hl_map = {"US": "en", "GB": "en", "FR": "fr", "ES": "es", "IT": "it",
               "BR": "pt", "NL": "nl", "PL": "pl", "TR": "tr", "RU": "ru",
               "JP": "ja", "KR": "ko", "CN": "zh", "SA": "ar", "DE": "de"}
    _tz_map = {"US": "America/New_York", "GB": "Europe/London", "FR": "Europe/Paris",
               "ES": "Europe/Madrid", "IT": "Europe/Rome", "BR": "America/Sao_Paulo",
               "JP": "Asia/Tokyo", "KR": "Asia/Seoul", "CN": "Asia/Shanghai",
               "RU": "Europe/Moscow", "DE": "Europe/Berlin"}
    hl = _hl_map.get(geo, "en") if geo else "en"
    locale_str = f"{hl}-{geo}" if geo else "en-US"
    tz_id = _tz_map.get(geo, "Europe/Berlin") if geo else "America/New_York"

    q_param = ",".join(quote_plus(kw) for kw in keywords)
    url = (
        f"https://trends.google.com/trends/explore"
        f"?q={q_param}&date={date_param}{geo_param}{gprop_param}&hl={hl}"
    )

    captured: list[dict] = []

    def on_response(response):
        if "trends/api/widgetdata/multiline" in response.url:
            try:
                text = response.body().decode("utf-8", errors="replace")
                if text.startswith(")]}'"):
                    text = text.split("\n", 1)[1]
                captured.append(json.loads(text))
            except Exception as e:
                log.warning("Multi-Antwort-Parsing: %s", e)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        ctx = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            locale=locale_str,
            timezone_id=tz_id,
            viewport={"width": 1280, "height": 800},
        )

        _cf = cookies_file or COOKIES_FILE
        if _cf and os.path.exists(_cf):
            cookies = _load_cookies(_cf)
            ctx.add_cookies(cookies)

        page = ctx.new_page()
        page.on("response", on_response)

        max_retries = 2
        for attempt in range(max_retries + 1):
            captured.clear()
            got_429 = False

            def _check_429(response):
                nonlocal got_429
                if response.url.startswith("https://trends.google.com/trends/explore") and response.status == 429:
                    got_429 = True
            page.on("response", _check_429)

            try:
                page.goto(url, wait_until="domcontentloaded", timeout=40_000)
                _accept_consent_playwright(page)
                deadline = time.time() + 25
                while not captured and not got_429 and time.time() < deadline:
                    page.wait_for_timeout(500)
            except PWTimeout:
                log.error("Playwright-Multi-Timeout (Versuch %d)", attempt + 1)

            page.remove_listener("response", _check_429)

            if captured:
                break
            if got_429 and attempt < max_retries:
                wait = 30 * (attempt + 1)
                log.info("429 Multi – warte %ds vor Retry %d", wait, attempt + 2)
                time.sleep(wait)
            else:
                break

        ctx.close()
        browser.close()

    if not captured:
        raise RuntimeError("Multi: Keine Daten empfangen (429 oder Timeout)")

    timeline = captured[0].get("default", {}).get("timelineData", [])
    multi: dict[str, dict[datetime, int]] = {kw: {} for kw in keywords}
    for entry in timeline:
        try:
            ts = int(entry["time"])
            dt = _normalize_dt(ts, timeframe)
            for i, kw in enumerate(keywords):
                val = int(entry["value"][i])
                multi[kw][dt] = val
        except (KeyError, ValueError, IndexError):
            pass

    if not any(multi[kw] for kw in keywords):
        raise NoDataError("Playwright multi: API-Antwort empfangen, aber keine Datenpunkte")

    return multi


def _fetch_multi_pytrends(keywords: list[str], geo: str = "DE",
                           timeframe: str = DEFAULT_TIMEFRAME,
                           gprop: str = "",
                           tz_offset: int = 60,
                           hl: str = "de") -> dict[str, dict[datetime, int]]:
    """Ruft 2-5 Keywords in EINER pytrends-Abfrage ab → gemeinsame Skala."""
    from pytrends.request import TrendReq

    pt = TrendReq(hl=hl, tz=tz_offset)
    pt.build_payload(keywords, geo=geo, timeframe=timeframe, gprop=gprop)
    df = pt.interest_over_time()

    if df is None or df.empty:
        raise NoDataError("pytrends multi: keine Daten empfangen")

    multi: dict[str, dict[datetime, int]] = {kw: {} for kw in keywords}
    for ts, row in df.iterrows():
        try:
            dt_obj = ts.to_pydatetime().replace(tzinfo=None)
            norm_dt = _normalize_dt(int(dt_obj.timestamp()), timeframe)
            for kw in keywords:
                multi[kw][norm_dt] = int(row[kw])
        except (KeyError, ValueError):
            pass
    return multi


# ---------------------------------------------------------------------------
# Standard-Workflow (wird durch DB-Einstellung überschrieben)
# ---------------------------------------------------------------------------

DEFAULT_WORKFLOW = [
    {"backend": "playwright", "enabled": True},
    {"backend": "pytrends",   "enabled": False},
    {"backend": "serpapi",    "enabled": True},
]


# ---------------------------------------------------------------------------
# Dispatcher: workflowgesteuert mit Fallback
# ---------------------------------------------------------------------------

def _fetch_multi(keywords: list[str], geo: str = "DE",
                 timeframe: str = DEFAULT_TIMEFRAME,
                 gprop: str = "",
                 workflow: list | None = None,
                 serpapi_key: str = "",
                 cookies_file: str = "",
                 tz_offset: int = 60,
                 hl: str = "de") -> tuple[dict[str, dict[datetime, int]], str]:
    """
    Ruft 2-5 Keywords in EINER Google-Trends-Abfrage ab.
    Gibt (multi_dict, backend_name) zurück.
    multi_dict: {keyword: {datetime: value}} – alle Keywords teilen die gleiche Skala.
    """
    if len(keywords) < 2 or len(keywords) > 5:
        raise ValueError(f"_fetch_multi erwartet 2-5 Keywords, bekam {len(keywords)}")

    wf = workflow or DEFAULT_WORKFLOW
    tech_errors: list[str] = []
    for entry in wf:
        if not entry.get("enabled", True):
            continue
        backend = entry["backend"]
        try:
            if backend == "serpapi":
                key = serpapi_key or SERPAPI_KEY
                if not key:
                    tech_errors.append("serpapi: kein API-Key konfiguriert")
                    continue
                log.info("SerpAPI-Multi für %s", keywords)
                return _fetch_multi_serpapi(keywords, geo, timeframe, gprop, api_key=key), "serpapi"
            elif backend == "playwright":
                log.info("Playwright-Multi für %s", keywords)
                return _fetch_multi_playwright(keywords, geo, timeframe, gprop,
                                               cookies_file=cookies_file), "playwright"
            elif backend == "pytrends":
                log.info("pytrends-Multi für %s", keywords)
                return _fetch_multi_pytrends(keywords, geo, timeframe, gprop, tz_offset=tz_offset, hl=hl), "pytrends"
        except NoDataError:
            raise
        except Exception as e:
            tech_errors.append(f"{backend}: {e}")
            log.warning("Multi-Backend '%s' Fehler: %s – versuche nächstes", backend, e)

    raise RuntimeError("Alle Multi-Backends fehlgeschlagen: " + " | ".join(tech_errors))


def _fetch_single(keyword: str, geo: str = "DE",
                  timeframe: str = DEFAULT_TIMEFRAME,
                  gprop: str = "",
                  workflow: list | None = None,
                  serpapi_key: str = "",
                  cookies_file: str = "",
                  tz_offset: int = 60,
                  hl: str = "de") -> tuple[dict[datetime, int], str]:
    """
    Probiert die Backends in Workflow-Reihenfolge durch.
    Gibt (data_dict, backend_name) zurück.
    """
    wf = workflow or DEFAULT_WORKFLOW
    no_data_errors: list[str] = []
    tech_errors: list[str] = []
    for entry in wf:
        if not entry.get("enabled", True):
            continue
        backend = entry["backend"]
        try:
            if backend == "serpapi":
                key = serpapi_key or SERPAPI_KEY
                if not key:
                    tech_errors.append("serpapi: kein API-Key konfiguriert")
                    continue
                log.info("SerpAPI-Backend für '%s'", keyword)
                return _fetch_serpapi(keyword, geo, timeframe, gprop, api_key=key), "serpapi"
            elif backend == "playwright":
                log.info("Playwright-Backend für '%s'", keyword)
                return _fetch_playwright(keyword, geo, timeframe, gprop,
                                         cookies_file=cookies_file), "playwright"
            elif backend == "pytrends":
                log.info("pytrends-Backend für '%s'", keyword)
                return _fetch_pytrends(keyword, geo, timeframe, gprop, tz_offset=tz_offset, hl=hl), "pytrends"
        except NoDataError as e:
            # Kein Suchvolumen – kein Fallback auf andere Backends nötig
            log.info("Backend '%s' bestätigt: kein Suchvolumen für '%s': %s", backend, keyword, e)
            raise NoDataError(f"Google Trends: kein Suchvolumen – {backend}: {e}")
        except Exception as e:
            tech_errors.append(f"{backend}: {e}")
            log.warning("Backend '%s' technischer Fehler für '%s': %s – versuche nächstes Backend", backend, keyword, e)

    raise RuntimeError("Alle Backends fehlgeschlagen: " + " | ".join(tech_errors))


def _fetch_related(keyword: str, geo: str = "DE",
                   timeframe: str = DEFAULT_TIMEFRAME,
                   gprop: str = "",
                   workflow: list | None = None,
                   serpapi_key: str = "",
                   cookies_file: str = "",
                   tz_offset: int = 60,
                   hl: str = "de") -> dict:
    """Ruft Related Queries ab – gleiche Backend-Reihenfolge wie _fetch_single."""
    wf = workflow or DEFAULT_WORKFLOW
    for entry in wf:
        if not entry.get("enabled", True):
            continue
        backend = entry["backend"]
        try:
            if backend == "serpapi":
                key = serpapi_key or SERPAPI_KEY
                if not key:
                    continue
                result = _fetch_related_serpapi(keyword, geo, timeframe, gprop, api_key=key)
            elif backend == "playwright":
                result = _fetch_related_playwright(keyword, geo, timeframe, gprop,
                                                   cookies_file=cookies_file)
            elif backend == "pytrends":
                result = _fetch_related_pytrends(keyword, geo, timeframe, gprop, tz_offset=tz_offset, hl=hl)
            else:
                continue
            # Backend lief erfolgreich – Ergebnis akzeptieren (auch wenn leer)
            if result.get("rising") or result.get("top"):
                return result
            # Leere Listen = kein Suchvolumen, kein Fallback nötig
            log.info("Related-Backend '%s': keine verwandten Suchanfragen für '%s' (kein Suchvolumen)",
                     backend, keyword)
            return result
        except Exception as e:
            # Technischer Fehler → nächstes Backend versuchen
            log.warning("Related-Backend '%s' technischer Fehler für '%s': %s – versuche nächstes Backend",
                        backend, keyword, e)
    return {"rising": [], "top": []}


# ---------------------------------------------------------------------------
# Haupt-Funktion
# ---------------------------------------------------------------------------

def run_fetch(app, run_tag: str = "", keyword_ids: list | None = None, user_id: int | None = None) -> dict:
    """
    Ruft Daten für aktive Keywords ab und speichert sie in der DB.

    run_tag:     Bezeichner für die Abruf-Reihe (deutsches Datumsformat TT.MM.JJ HH:MM).
                 Wenn leer, wird automatisch der aktuelle Zeitstempel verwendet.
    keyword_ids: Optionale Liste von Keyword-IDs. Wenn gesetzt, werden nur diese
                 Keywords abgerufen (müssen aktiv sein). Wenn None → alle aktiven.
    """
    from models import Keyword, TrendData, FetchLog, AppSetting, RelatedQuery, User, db

    if not run_tag:
        run_tag = datetime.now().strftime("%d.%m.%y %H:%M")

    with app.app_context():
        # Globalen Zeitrahmen aus Einstellungen lesen (Fallback)
        setting = db.session.get(AppSetting, "fetch_timeframe")
        global_timeframe = setting.value if setting and setting.value else DEFAULT_TIMEFRAME
        log.info("Standard-Zeitrahmen: %s", global_timeframe)

        # Workflow, API-Key und Cookies-Datei aus DB lesen (Env als Fallback)
        w_setting = db.session.get(AppSetting, "fetch_workflow")
        try:
            workflow = json.loads(w_setting.value) if w_setting and w_setting.value else DEFAULT_WORKFLOW
        except (json.JSONDecodeError, ValueError):
            workflow = DEFAULT_WORKFLOW

        # User-spezifische Backend-Einschränkung anwenden
        if user_id:
            user = db.session.get(User, user_id)
            if user and not user.is_superadmin and user.can_custom_workflow:
                allowed = user.get_allowed_backends()
                if allowed:
                    workflow = [e for e in workflow if e.get("backend") in allowed]

        k_setting = db.session.get(AppSetting, "serpapi_key")
        serpapi_key = (k_setting.value if k_setting and k_setting.value else None) or SERPAPI_KEY

        c_setting = db.session.get(AppSetting, "cookies_file")
        cookies_file = (c_setting.value if c_setting and c_setting.value else None) or COOKIES_FILE

        # Trends-Zeitzone (per-user → globaler Fallback, Standard UTC+1)
        tz_offset = 60
        tz_global = AppSetting.query.filter_by(key="trends_tz", user_id=None).first()
        if tz_global and tz_global.value:
            try: tz_offset = int(tz_global.value)
            except ValueError: pass
        if user_id:
            tz_user = AppSetting.query.filter_by(key="trends_tz", user_id=user_id).first()
            if tz_user and tz_user.value:
                try: tz_offset = int(tz_user.value)
                except ValueError: pass

        # Abfragesprache (per-user → globaler Fallback, Standard "auto")
        hl = "de"
        ql_global = AppSetting.query.filter_by(key="query_language", user_id=None).first()
        if ql_global and ql_global.value:
            hl = ql_global.value
        if user_id:
            ql_user = AppSetting.query.filter_by(key="query_language", user_id=user_id).first()
            if ql_user and ql_user.value:
                hl = ql_user.value
        if hl == "auto":
            hl = "de"  # Serverseitiger Fallback; Browser-Default wird clientseitig aufgelöst

        # Primäres Backend für FetchLog-Eintrag (erstes aktiviertes)
        backend_name = next(
            (e["backend"] for e in workflow if e.get("enabled", True)), "unbekannt"
        )
        log_entry = FetchLog(status="running", backend=backend_name, user_id=user_id)
        db.session.add(log_entry)
        db.session.commit()
        log_id = log_entry.id

        if keyword_ids:
            # Bei explizit angegebenen IDs: active-Filter weglassen (manueller Abruf)
            keywords = Keyword.query.filter(Keyword.id.in_(keyword_ids)).all()
        else:
            keywords = Keyword.query.filter_by(active=True).all()

        total = len(keywords)
        ok_count = 0
        no_data_count = 0
        tech_fail_count = 0
        errors: list[str] = []

        single_kw = len(keywords) == 1  # kürzere Wartezeit bei Einzelabruf
        log.info("Workflow: %s | %d Keywords", [e["backend"] for e in workflow if e.get("enabled", True)], total)

        for kw in keywords:
            delay = random.uniform(1, 3) if single_kw else random.uniform(8, 18)
            log.debug("Warte %.1fs vor '%s'", delay, kw.keyword)
            time.sleep(delay)

            # Per-Keyword-Einstellungen mit globalem Fallback
            kw_timeframe = kw.timeframe or global_timeframe
            kw_gprop     = kw.gprop or ""

            try:
                data, used_backend = _fetch_single(
                    kw.keyword, kw.geo, kw_timeframe, kw_gprop,
                    workflow=workflow, serpapi_key=serpapi_key, cookies_file=cookies_file,
                    tz_offset=tz_offset, hl=hl,
                )
                if not data:
                    raise NoDataError("Keine Datenpunkte in der Antwort")

                inserted = 0
                for dt, val in data.items():
                    existing = TrendData.query.filter_by(
                        keyword_id=kw.id, date=dt, run_tag=run_tag
                    ).first()
                    if existing:
                        existing.value = val
                    else:
                        db.session.add(
                            TrendData(
                                keyword_id=kw.id, date=dt,
                                value=val, run_tag=run_tag,
                            )
                        )
                    inserted += 1

                db.session.commit()
                log.info("'%s': %d Datenpunkte gespeichert (Backend: %s)",
                         kw.keyword, inserted, used_backend)
                ok_count += 1

                # Related Queries abrufen (Fehler blockieren nicht den Haupt-Fetch)
                try:
                    time.sleep(random.uniform(3, 7))
                    rq_data = _fetch_related(
                        kw.keyword, kw.geo, kw_timeframe, kw_gprop,
                        workflow=workflow, serpapi_key=serpapi_key, cookies_file=cookies_file,
                        tz_offset=tz_offset, hl=hl,
                    )
                    now = datetime.now(timezone.utc)
                    rq_count = 0
                    for qt in ("rising", "top"):
                        for i, item in enumerate(rq_data.get(qt, [])):
                            q = (item.get("query") or "").strip()
                            if not q:
                                continue
                            db.session.add(RelatedQuery(
                                keyword_id = kw.id,
                                query_type = qt,
                                query      = q,
                                value      = str(item.get("value", "")),
                                rank       = i,
                                fetched_at = now,
                            ))
                            rq_count += 1
                    db.session.commit()
                    log.info("'%s': %d Related Queries gespeichert", kw.keyword, rq_count)
                except Exception as rq_err:
                    db.session.rollback()
                    log.warning("Related Queries für '%s' fehlgeschlagen: %s",
                                kw.keyword, rq_err)

                # Regionsinteresse abrufen (Fehler blockieren nicht den Haupt-Fetch)
                try:
                    time.sleep(random.uniform(3, 7))
                    region_items = _fetch_region_pytrends(
                        kw.keyword, kw.geo, kw_timeframe, kw_gprop,
                        "COUNTRY" if kw.geo == "" else "REGION",
                        tz_offset=tz_offset, hl=hl,
                    )
                    from models import RegionInterest
                    region_res = "COUNTRY" if kw.geo == "" else "REGION"
                    region_ts = datetime.now(timezone.utc)
                    for item in region_items:
                        existing_r = RegionInterest.query.filter_by(
                            keyword_id=kw.id, resolution=region_res,
                            geo_name=item["geo_name"], run_tag=run_tag,
                        ).first()
                        if existing_r:
                            existing_r.value = item["value"]
                            existing_r.fetched_at = region_ts
                        else:
                            db.session.add(RegionInterest(
                                keyword_id=kw.id,
                                resolution=region_res,
                                geo_name=item["geo_name"],
                                geo_code=item.get("geo_code", ""),
                                value=item["value"],
                                fetched_at=region_ts,
                                run_tag=run_tag,
                            ))
                    db.session.commit()
                    log.info("'%s': %d Regionseinträge gespeichert", kw.keyword, len(region_items))
                except Exception as reg_err:
                    db.session.rollback()
                    log.warning("Regionsinteresse für '%s' fehlgeschlagen: %s",
                                kw.keyword, reg_err)

            except NoDataError as e:
                db.session.rollback()
                # Kein Suchvolumen, aber Abruf war technisch erfolgreich →
                # 0-Wert speichern, damit das Frontend unterscheiden kann
                # zwischen "nie abgerufen" und "kein Volumen".
                try:
                    zero_dt = datetime.now().replace(minute=0, second=0, microsecond=0)
                    existing = TrendData.query.filter_by(
                        keyword_id=kw.id, date=zero_dt, run_tag=run_tag
                    ).first()
                    if not existing:
                        db.session.add(TrendData(
                            keyword_id=kw.id, date=zero_dt,
                            value=0, run_tag=run_tag,
                        ))
                    db.session.commit()
                    log.info("'%s': 0-Wert gespeichert (kein Suchvolumen)", kw.keyword)
                except Exception:
                    db.session.rollback()
                msg = f"{kw.keyword}: {e}"
                errors.append(msg)
                log.warning("Keine Daten für '%s': %s", kw.keyword, e)
                no_data_count += 1
            except Exception as e:
                db.session.rollback()
                msg = f"{kw.keyword}: {e}"
                errors.append(msg)
                log.error(msg)
                tech_fail_count += 1

        total_fail = no_data_count + tech_fail_count
        status = (
            "ok"      if total_fail == 0
            else "no_data" if ok_count == 0 and no_data_count > 0
            else "failed"  if ok_count == 0
            else "partial"
        )
        log_entry = db.session.get(FetchLog, log_id)
        log_entry.finished_at = datetime.now(timezone.utc)
        log_entry.keywords_total = total
        log_entry.keywords_ok = ok_count
        log_entry.keywords_failed = total_fail
        log_entry.errors = "\n".join(errors)
        log_entry.status = status
        db.session.commit()

        log.info("Fetch beendet: %d OK, %d ohne Daten, %d Fehler",
                 ok_count, no_data_count, tech_fail_count)

        # Alerts nach jedem Fetch auswerten
        try:
            from alerts import evaluate_alerts
            evaluate_alerts(app)
        except Exception as ae:
            log.warning("Alert-Auswertung nach Fetch fehlgeschlagen: %s", ae)

        return {
            "status": status, "total": total,
            "ok": ok_count, "failed": total_fail, "errors": errors,
        }
