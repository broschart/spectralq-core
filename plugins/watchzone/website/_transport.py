"""Website transport layer — Wayback Machine CDX API."""

import json
import logging
from urllib.request import Request, urlopen
from urllib.parse import urlencode

log = logging.getLogger(__name__)


def fetch_wayback_snapshots(url, date_from=None, date_to=None):
    """
    Ruft Snapshots einer URL von der Wayback Machine CDX API ab.
    """
    from datetime import datetime as _dt
    cdx_url = "https://web.archive.org/cdx/search/cdx"
    params = {
        "url": url,
        "output": "json",
        "fl": "timestamp,digest,statuscode,original,title,length",
        "filter": "statuscode:200",
        "collapse": "digest",
        "limit": "2000",
    }
    if date_from:
        params["from"] = date_from.replace("-", "")
    if date_to:
        params["to"] = date_to.replace("-", "")

    req_url = cdx_url + "?" + urlencode(params)
    log.info("Wayback CDX request: %s", req_url)
    try:
        req = Request(req_url, headers={"User-Agent": "VeriTrend/1.0"})
        with urlopen(req, timeout=45) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        log.warning("Wayback CDX Fehler für %s: %s", url, e)
        return []

    if not data or len(data) < 2:
        return []

    results = []
    for row in data[1:]:
        ts       = row[0]
        digest   = row[1]
        status   = row[2]
        orig_url = row[3]
        title    = row[4] if len(row) > 4 else ""
        length   = row[5] if len(row) > 5 else ""
        try:
            dt = _dt.strptime(ts[:8], "%Y%m%d")
            date_str = dt.strftime("%Y-%m-%d")
        except Exception:
            date_str = ts[:4] + "-" + ts[4:6] + "-" + ts[6:8]
        time_str = ts[8:10] + ":" + ts[10:12] if len(ts) >= 12 else ""
        try:
            length_bytes = int(length) if length else None
        except ValueError:
            length_bytes = None
        results.append({
            "timestamp": ts,
            "date": date_str,
            "time": time_str,
            "digest": digest,
            "status": status,
            "url": orig_url,
            "title": title.strip() if title else "",
            "length": length_bytes,
            "wayback_url": f"https://web.archive.org/web/{ts}/{orig_url}",
        })

    return results


def fetch_wayback_changes(url, date_from, date_to):
    """
    Gibt Website-Änderungen (= Snapshots mit unterschiedlichem Digest) zurück.
    """
    snapshots = fetch_wayback_snapshots(url, date_from, date_to)
    if not snapshots:
        return []

    changes = []
    prev_title = None
    prev_length = None
    for snap in snapshots:
        title = snap.get("title", "")
        length = snap.get("length")
        title_changed = (prev_title is not None and title != prev_title and
                         (title or prev_title))
        size_delta = (length - prev_length) if (length is not None and prev_length is not None) else None
        changes.append({
            "date": snap["date"],
            "time": snap.get("time", ""),
            "timestamp": snap["timestamp"],
            "value": 1,
            "url": snap.get("url", ""),
            "wayback_url": snap["wayback_url"],
            "digest": snap["digest"],
            "title": title,
            "title_changed": title_changed,
            "prev_title": prev_title if title_changed else None,
            "length": length,
            "size_delta": size_delta,
        })
        prev_title = title
        prev_length = length

    return changes


def fetch_wayback_diff_html(original_url, ts2, ts1=None):
    """
    Vergleicht zwei Wayback-Snapshots strukturiert.
    """
    import re, difflib, html as _html_mod
    from urllib.request import Request, urlopen

    def _fetch(ts, _retries=2):
        import gzip as _gzip
        import time as _time
        wb_url = f"https://web.archive.org/web/{ts}id_/{original_url}"
        for attempt in range(_retries + 1):
            try:
                req = Request(wb_url, headers={
                    "User-Agent": "Mozilla/5.0 (compatible; VeriTrend/1.0)"})
                with urlopen(req, timeout=40) as resp:
                    ct = resp.headers.get("Content-Type", "")
                    ce = resp.headers.get("Content-Encoding", "")
                    raw = resp.read()
                if ce == "gzip" or raw[:2] == b"\x1f\x8b":
                    try:
                        raw = _gzip.decompress(raw)
                    except Exception:
                        pass
                m = re.search(r"charset=([^\s;\"']+)", ct, re.I)
                charset = m.group(1) if m else None
                if not charset:
                    sniff = raw[:4096].decode("ascii", errors="replace")
                    mm = re.search(
                        r'<meta[^>]+charset=["\']?([^\s;"\'/>]+)',
                        sniff, re.I)
                    if not mm:
                        mm = re.search(
                            r'<meta[^>]+content=["\'][^"\']*charset='
                            r'([^\s;"\'/>]+)', sniff, re.I)
                    charset = mm.group(1) if mm else "utf-8"
                return raw.decode(charset, errors="replace")
            except Exception as e:
                log.debug("Wayback fetch %s Versuch %d: %s",
                          ts, attempt + 1, e)
                if attempt < _retries:
                    _time.sleep(1.5)
        return None

    def _fmt_css(code):
        s = re.sub(r'\s+', ' ', code).strip()
        s = re.sub(r'\s*\{\s*', ' {\n  ', s)
        s = re.sub(r';\s*', ';\n  ', s)
        s = re.sub(r'\s*\}\s*', '\n}\n', s)
        out, indent = [], 0
        for line in s.splitlines():
            line = line.rstrip()
            if not line:
                continue
            if line.startswith('}'):
                indent = max(0, indent - 1)
            out.append('  ' * indent + line.lstrip())
            if line.endswith('{'):
                indent += 1
        return [l for l in out if l.strip()]

    def _fmt_js(code):
        out, indent, buf = [], 0, ''
        in_str, str_ch = False, ''
        in_line_comment, in_block_comment = False, False
        i, n = 0, len(code)
        while i < n:
            ch = code[i]
            if in_line_comment:
                buf += ch
                if ch == '\n':
                    out.append('  ' * indent + buf.strip())
                    buf = ''
                    in_line_comment = False
            elif in_block_comment:
                buf += ch
                if ch == '*' and i + 1 < n and code[i + 1] == '/':
                    buf += '/'
                    i += 1
                    out.append('  ' * indent + buf.strip())
                    buf = ''
                    in_block_comment = False
            elif in_str:
                buf += ch
                if ch == '\\' and i + 1 < n:
                    i += 1
                    buf += code[i]
                elif ch == str_ch:
                    in_str = False
            elif ch in ('"', "'", '`'):
                in_str, str_ch = True, ch
                buf += ch
            elif ch == '/' and i + 1 < n and code[i + 1] == '/':
                in_line_comment = True
                buf += '//'
                i += 1
            elif ch == '/' and i + 1 < n and code[i + 1] == '*':
                in_block_comment = True
                buf += '/*'
                i += 1
            elif ch == '{':
                buf += ch
                out.append('  ' * indent + buf.strip())
                buf = ''
                indent += 1
            elif ch == '}':
                if buf.strip():
                    out.append('  ' * indent + buf.strip())
                    buf = ''
                indent = max(0, indent - 1)
                out.append('  ' * indent + '}')
            elif ch == ';':
                buf += ch
                out.append('  ' * indent + buf.strip())
                buf = ''
            else:
                buf += ch
            i += 1
        if buf.strip():
            out.append('  ' * indent + buf.strip())
        return [l for l in out if l.strip()]

    # ── Tag-Manager-Erkennung: nachgeladene Skripte aus Containern ──

    _TM_PATTERNS = {
        "GTM": re.compile(
            r"googletagmanager\.com/gtm\.js\?id=(GTM-[A-Z0-9]+)", re.I),
        "GTM_noscript": re.compile(
            r"googletagmanager\.com/ns\.html\?id=(GTM-[A-Z0-9]+)", re.I),
        "GA4": re.compile(
            r"googletagmanager\.com/gtag/js\?id=(G-[A-Z0-9]+)", re.I),
        "Matomo_TM": re.compile(
            r"(https?://[^\"'\s]+/container_\w+\.js)", re.I),
        "Tealium": re.compile(
            r"(https?://tags\.tiqcdn\.com/utag/[^\"'\s]+/utag\.js)", re.I),
        "Adobe_Launch": re.compile(
            r"(https?://assets\.adobedtm\.com/[^\"'\s]+\.min\.js)", re.I),
    }

    # Bekannte Tracker-Domains/-Pfade die in TM-Containern vorkommen
    _TRACKER_HINTS = [
        "google-analytics.com", "analytics.js", "gtag/js",
        "googletagmanager.com", "googlesyndication.com",
        "doubleclick.net", "google.com/pagead",
        "facebook.net/en_US/fbevents", "connect.facebook.net",
        "snap.licdn.com", "analytics.tiktok.com",
        "bat.bing.com", "clarity.ms",
        "hotjar.com", "mouseflow.com",
        "matomo", "piwik",
        "plausible.io", "pirsch.io",
        "hubspot.com", "hs-scripts.com", "hs-analytics",
        "pardot.com", "marketo.net",
        "segment.com", "segment.io", "cdn.segment",
        "amplitude.com", "mixpanel.com", "heap-analytics",
        "cdn.cookielaw.org", "cookiebot.com", "usercentrics",
        "consentmanager.net",
        "newrelic.com", "nr-data.net",
        "sentry.io", "bugsnag.com",
        "cdn.jsdelivr.net/npm/@",  # häufig genutzt für Tracker-Libs
    ]

    # Bekannte Piggybacking-Muster: Skript A lädt Skript B
    _PIGGYBACK_CHAINS = {
        "connect.facebook.net": ["facebook.com/tr", "facebook.com/audience"],
        "googleadservices.com": ["doubleclick.net", "googlesyndication.com"],
        "bat.bing.com": ["clarity.ms"],
        "static.criteo.net": ["dis.criteo.com", "sslwidget.criteo.com"],
        "cdn.taboola.com": ["trc.taboola.com", "nr.taboola.com"],
        "widgets.outbrain.com": ["log.outbrain.com", "amplify.outbrain.com"],
        "tags.tiqcdn.com": [],  # Tealium → lädt dynamisch weitere
    }

    _MAX_LEVEL = 5
    _URL_PAT = re.compile(
        r'https?://[a-zA-Z0-9._\-/]+(?:\.js|\.php|\.gif|\.png'
        r'|\?[a-zA-Z0-9&=._\-]*)', re.I)

    def _fetch_container(url):
        """Holt eine Container-JS-Datei und gibt den Inhalt zurück."""
        try:
            req = Request(url, headers={
                "User-Agent": "Mozilla/5.0 (compatible; VeriTrend/1.0)"})
            with urlopen(req, timeout=12) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except Exception as e:
            log.debug("Container nicht abrufbar %s: %s", url, e)
            return None

    def _crawl_container(container_js, parent_id, depth, result, seen_urls,
                         crawled_ids):
        """Rekursiv: extrahiert Tracker-URLs und verschachtelte Container."""
        level_key = f"level{min(depth, _MAX_LEVEL)}"
        if level_key not in result:
            result[level_key] = []

        # Tracker-URLs extrahieren
        for um in _URL_PAT.finditer(container_js):
            curl = um.group(0)
            if curl in seen_urls:
                continue
            if any(hint in curl.lower() for hint in _TRACKER_HINTS):
                seen_urls.add(curl)
                result[level_key].append({"url": curl, "via": parent_id})

        if depth >= _MAX_LEVEL:
            return

        # Verschachtelte GTM-Container
        nested_gtm = set(re.findall(r'GTM-[A-Z0-9]{4,8}', container_js))
        for ngid in nested_gtm:
            if ngid in crawled_ids:
                continue
            crawled_ids.add(ngid)
            nest_level = f"level{min(depth + 1, _MAX_LEVEL)}"
            if nest_level not in result:
                result[nest_level] = []
            result["tag_managers"].append(f"{ngid} (via {parent_id})")
            nested_js = _fetch_container(
                f"https://www.googletagmanager.com/gtm.js?id={ngid}")
            if nested_js:
                _crawl_container(nested_js, ngid, depth + 1,
                                 result, seen_urls, crawled_ids)

        # Piggybacking-Ketten
        piggy_level = f"level{min(depth + 1, _MAX_LEVEL)}"
        if piggy_level not in result:
            result[piggy_level] = []
        for entry in list(result[level_key]):
            for parent_hint, children in _PIGGYBACK_CHAINS.items():
                if parent_hint in entry["url"].lower():
                    for child in children:
                        if child not in seen_urls:
                            seen_urls.add(child)
                            result[piggy_level].append(
                                {"url": child, "via": parent_hint})

    def _extract_tagmanager_scripts(raw_html):
        """Erkennt Tracker rekursiv bis Level 5.

        Level 1: Direkt im HTML
        Level 2: Via Tag Manager (GTM, Matomo TM, Tealium, Adobe)
        Level 3–5: Verschachtelte Container, Piggybacking-Ketten
        """
        result = {"tag_managers": []}
        for i in range(1, _MAX_LEVEL + 1):
            result[f"level{i}"] = []
        seen_urls = set()
        crawled_ids = set()

        # Tag-Manager im HTML erkennen
        gtm_ids = set()
        for pat_key in ("GTM", "GTM_noscript"):
            for m in _TM_PATTERNS[pat_key].finditer(raw_html):
                gtm_ids.add(m.group(1))
        for gid in gtm_ids:
            result["tag_managers"].append(gid)

        matomo_urls = []
        for m in _TM_PATTERNS["Matomo_TM"].finditer(raw_html):
            matomo_urls.append(m.group(1))
            result["tag_managers"].append("Matomo TM")
        for m in _TM_PATTERNS["Tealium"].finditer(raw_html):
            result["tag_managers"].append("Tealium")
        for m in _TM_PATTERNS["Adobe_Launch"].finditer(raw_html):
            result["tag_managers"].append("Adobe Launch")

        # Level 1: Direkt im HTML referenzierte Tracker
        src_pat = re.compile(r'<script[^>]+src=["\']([^"\']+)["\']', re.I)
        for sm in src_pat.finditer(raw_html):
            src = sm.group(1).strip()
            if src not in seen_urls and \
               any(hint in src.lower() for hint in _TRACKER_HINTS):
                seen_urls.add(src)
                result["level1"].append({"url": src, "via": None})

        # Level 2+: GTM-Container rekursiv crawlen
        for gtm_id in gtm_ids:
            crawled_ids.add(gtm_id)
            container_js = _fetch_container(
                f"https://www.googletagmanager.com/gtm.js?id={gtm_id}")
            if container_js:
                _crawl_container(container_js, gtm_id, 2,
                                 result, seen_urls, crawled_ids)

        # Level 2+: Matomo-TM-Container
        for murl in matomo_urls:
            container_js = _fetch_container(murl)
            if container_js:
                _crawl_container(container_js, "Matomo TM", 2,
                                 result, seen_urls, crawled_ids)

        # Piggybacking aus Level-1-URLs
        for entry in list(result["level1"]):
            for parent_hint, children in _PIGGYBACK_CHAINS.items():
                if parent_hint in entry["url"].lower():
                    for child in children:
                        if child not in seen_urls:
                            seen_urls.add(child)
                            result["level2"].append(
                                {"url": child, "via": parent_hint})

        return result

    def _tracker_result_to_lines(tr):
        """Konvertiert strukturiertes Tracker-Ergebnis in flache Zeilen für Diff."""
        lines = []
        for tm in tr.get("tag_managers", []):
            lines.append(f"[TM] {tm}")
        depth_prefix = {1: "  [direkt] ", 2: "  \u2190 ", 3: "  \u2190\u2190 ",
                        4: "  \u2190\u2190\u2190 ", 5: "  \u2190\u2190\u2190\u2190 "}
        for lvl in range(1, _MAX_LEVEL + 1):
            prefix = depth_prefix.get(lvl, "  " + "\u2190" * (lvl - 1) + " ")
            for e in tr.get(f"level{lvl}", []):
                via = e.get("via") or ""
                lines.append(f"{prefix}{via}: {e['url']}" if via
                             else f"{prefix}{e['url']}")
        return lines

    # ── Seiten-Statistik & Keyword-Extraktion ──

    _STOPWORDS = frozenset(
        # DE
        "der die das ein eine einer eines einem einen und oder aber auch "
        "nicht ist sind war waren wird werden hat haben hatte hatten kann "
        "können konnte konnten soll sollen sollte sollten muss müssen "
        "musste mussten darf dürfen durfte durften will wollen wollte "
        "wollten mag mögen mochte mochten von vom zum zur im in an auf "
        "für mit nach über unter vor zwischen durch gegen ohne bis bei "
        "aus seit wegen während dass ob wenn weil obwohl als wie wo was "
        "wer wem wen wessen welche welcher welches dieser diese dieses "
        "jener jene jenes alle alles jeder jede jedes man sich sein "
        "seine seinem seinen seiner ihr ihre ihrem ihren ihrer wir uns "
        "unser unsere euch eure ich du er sie es mir dir ihm mich dich "
        "ihn noch schon nur sehr mehr hier dort dann so da doch noch "
        "mal nun ja nein kein keine keinem keinen keiner des dem den "
        "zur zum zur per pro zur via bzw etc bzw sowie bereits rund "
        "circa etwa knapp gut neue neuen neuer neues neue aller allen "
        # EN
        "the a an and or but not is are was were be been being have has "
        "had do does did will would shall should can could may might "
        "must need to of in on at by for with from into through about "
        "over under between after before during without against "
        "this that these those it its he she they them their his her "
        "him our your my we you me us i all some any no each every "
        "which who whom what where when how if than so very also just "
        "only still too more most much many such here there then now "
        "up out as well".split()
    )

    def _extract_page_stats(raw_html):
        """Extrahiert Seitenstatistiken: Überschriften, Absätze, Zeichen, Links, Bilder."""
        from html.parser import HTMLParser

        class _StatParser(HTMLParser):
            def __init__(self):
                super().__init__(convert_charrefs=True)
                self.headings = {f"h{i}": 0 for i in range(1, 7)}
                self.heading_texts = []  # [(level, text)]
                self.paragraphs = 0
                self.links = 0
                self.images = 0
                self.image_srcs = []
                self.lists = 0
                self.tables = 0
                self.forms = 0
                self.text_parts = []
                self._skip_depth = 0
                self._in_tag = None
                self._tag_text = []
                _SKIP = {"script", "style", "noscript", "head", "svg",
                         "canvas", "template", "iframe"}
                self._skip_tags = _SKIP

            def handle_starttag(self, tag, attrs):
                t = tag.lower()
                if t in self._skip_tags:
                    self._skip_depth += 1
                    return
                if self._skip_depth > 0:
                    return
                if t in self.headings:
                    self.headings[t] += 1
                    self._in_tag = t
                    self._tag_text = []
                elif t == "p":
                    self.paragraphs += 1
                elif t == "a":
                    self.links += 1
                elif t == "img":
                    self.images += 1
                    attrs_d = dict(attrs)
                    src = attrs_d.get("src", "")
                    alt = attrs_d.get("alt", "")
                    if src:
                        self.image_srcs.append(
                            {"src": src, "alt": alt[:80]})
                elif t in ("ul", "ol"):
                    self.lists += 1
                elif t == "table":
                    self.tables += 1
                elif t == "form":
                    self.forms += 1

            def handle_endtag(self, tag):
                t = tag.lower()
                if t in self._skip_tags:
                    self._skip_depth = max(0, self._skip_depth - 1)
                if t == self._in_tag:
                    txt = " ".join(self._tag_text).strip()[:120]
                    if txt:
                        self.heading_texts.append(
                            {"level": self._in_tag, "text": txt})
                    self._in_tag = None

            def handle_data(self, data):
                if self._skip_depth == 0:
                    s = data.strip()
                    if s:
                        self.text_parts.append(s)
                        if self._in_tag:
                            self._tag_text.append(s)

        p = _StatParser()
        try:
            p.feed(raw_html)
        except Exception:
            pass

        full_text = " ".join(p.text_parts)
        total_headings = sum(p.headings.values())

        # Externe JS- und CSS-Dateien: Namen extrahieren
        js_src_pat = re.compile(
            r'<script[^>]+src=["\']([^"\']+)["\']', re.I)
        js_file_list = []
        for m in js_src_pat.finditer(raw_html):
            url = m.group(1).strip()
            # Kurzname: letzter Pfad-Teil
            name = url.rsplit("/", 1)[-1].split("?")[0] or url
            js_file_list.append({"name": name, "url": url})
        js_files = len(js_file_list)
        css_file_list = []
        css_seen = set()
        for m in re.finditer(r'<link[^>]*>', raw_html, re.I):
            tag = m.group(0)
            if re.search(r'rel=["\']stylesheet["\']', tag, re.I) or \
               re.search(r'href=["\'][^"\']+\.css', tag, re.I):
                href_m = re.search(r'href=["\']([^"\']+)["\']', tag, re.I)
                if href_m and m.start() not in css_seen:
                    css_seen.add(m.start())
                    url = href_m.group(1).strip()
                    name = url.rsplit("/", 1)[-1].split("?")[0] or url
                    css_file_list.append({"name": name, "url": url})
        css_files = len(css_file_list)
        # Inline-Styles zählen
        inline_styles = len(re.findall(r'<style[\s>]', raw_html, re.I))
        inline_scripts = len(re.findall(
            r'<script(?:\s[^>]*)?>(?!\s*$)', raw_html, re.I)) - js_files

        return {
            "headings": total_headings,
            "headings_detail": {k: v for k, v in p.headings.items() if v > 0},
            "heading_texts": p.heading_texts[:50],
            "paragraphs": p.paragraphs,
            "chars": len(full_text),
            "words": len(full_text.split()),
            "links": p.links,
            "images": p.images,
            "image_list": p.image_srcs[:50],
            "lists": p.lists,
            "tables": p.tables,
            "forms": p.forms,
            "js_files": js_files,
            "js_file_list": js_file_list,
            "css_files": css_files,
            "css_file_list": css_file_list,
            "inline_scripts": max(0, inline_scripts),
            "inline_styles": inline_styles,
        }

    def _extract_top_keywords(raw_html, n=30):
        """Extrahiert die Top-N Keywords (nach Häufigkeit) aus sichtbarem Text."""
        from html.parser import HTMLParser
        from collections import Counter

        _SKIP = {"script", "style", "noscript", "head", "svg",
                 "canvas", "template", "iframe"}

        class _TextExtractor(HTMLParser):
            def __init__(self):
                super().__init__(convert_charrefs=True)
                self._skip = 0
                self.texts = []
                # Gewichtung: Überschriften zählen mehr
                self._weight = 1

            def handle_starttag(self, tag, attrs):
                t = tag.lower()
                if t in _SKIP:
                    self._skip += 1
                elif t in ("h1", "h2", "h3"):
                    self._weight = 3
                elif t in ("h4", "h5", "h6"):
                    self._weight = 2
                elif t in ("strong", "b", "em", "mark"):
                    self._weight = 2

            def handle_endtag(self, tag):
                t = tag.lower()
                if t in _SKIP:
                    self._skip = max(0, self._skip - 1)
                elif t in ("h1", "h2", "h3", "h4", "h5", "h6",
                           "strong", "b", "em", "mark"):
                    self._weight = 1

            def handle_data(self, data):
                if self._skip == 0:
                    s = data.strip()
                    if s:
                        self.texts.append((s, self._weight))

        p = _TextExtractor()
        try:
            p.feed(raw_html)
        except Exception:
            pass

        counts = Counter()
        word_pat = re.compile(r"[a-zäöüßàâéèêëïîôùûçñ]{3,}", re.I)
        for text, weight in p.texts:
            for m in word_pat.finditer(text):
                w = m.group(0).lower()
                if w not in _STOPWORDS and len(w) >= 3:
                    counts[w] += weight

        return [{"word": w, "count": c}
                for w, c in counts.most_common(n)]

    def _extract_link_texts(raw_html, original_url, n=30):
        """Extrahiert Ankertexte interner und externer Links."""
        from html.parser import HTMLParser
        from collections import Counter
        from urllib.parse import urlparse

        orig_domain = urlparse(original_url).netloc.lower().lstrip("www.")

        class _LinkParser(HTMLParser):
            def __init__(self):
                super().__init__(convert_charrefs=True)
                self._skip = 0
                self._in_a = False
                self._href = None
                self._text = []
                self.internal = Counter()
                self.external = Counter()

            def handle_starttag(self, tag, attrs):
                t = tag.lower()
                if t in ("script", "style", "noscript", "head", "svg"):
                    self._skip += 1
                elif t == "a" and self._skip == 0:
                    self._in_a = True
                    self._text = []
                    self._href = None
                    for k, v in attrs:
                        if k == "href" and v:
                            self._href = v.strip()

            def handle_endtag(self, tag):
                t = tag.lower()
                if t in ("script", "style", "noscript", "head", "svg"):
                    self._skip = max(0, self._skip - 1)
                elif t == "a" and self._in_a:
                    self._in_a = False
                    anchor = " ".join(self._text).strip()
                    if anchor and self._href and len(anchor) >= 2:
                        # Normalisieren: Whitespace, max 80 Zeichen
                        anchor = " ".join(anchor.split())[:80]
                        href = self._href
                        try:
                            domain = urlparse(href).netloc.lower().lstrip(
                                "www.")
                        except Exception:
                            domain = ""
                        if not domain or domain == orig_domain:
                            self.internal[anchor] += 1
                        else:
                            self.external[anchor] += 1

            def handle_data(self, data):
                if self._in_a and self._skip == 0:
                    s = data.strip()
                    if s:
                        self._text.append(s)

        p = _LinkParser()
        try:
            p.feed(raw_html)
        except Exception:
            pass

        return {
            "internal": [{"text": t, "count": c}
                         for t, c in p.internal.most_common(n)],
            "external": [{"text": t, "count": c}
                         for t, c in p.external.most_common(n)],
        }

    def _extract_blocks(tag, raw_html):
        lines = []
        src_pat = re.compile(rf'<{tag}[^>]+(?:src|href)=["\']([^"\']+)["\']', re.I)
        for m in src_pat.finditer(raw_html):
            url = m.group(1).strip()
            if url:
                lines.append(url)
        content_pat = re.compile(rf"<{tag}[^>]*>(.*?)</{tag}>", re.DOTALL | re.I)
        for m in content_pat.finditer(raw_html):
            block = m.group(1).strip()
            if not block:
                continue
            raw_lines = [l.strip() for l in block.splitlines() if l.strip()]
            if len(raw_lines) <= 1:
                formatted = _fmt_css(block) if tag == "style" else _fmt_js(block)
                lines.extend(formatted)
            else:
                lines.extend(raw_lines)
        return lines

    def _html_body_lines(raw_html):
        from html.parser import HTMLParser
        _SKIP = {"script", "style", "noscript", "head",
                 "title", "svg", "canvas", "template", "iframe"}

        class _Extractor(HTMLParser):
            def __init__(self):
                super().__init__(convert_charrefs=True)
                self._depth = 0
                self.texts = []
            def handle_starttag(self, tag, attrs):
                if tag.lower() in _SKIP:
                    self._depth += 1
            def handle_endtag(self, tag):
                if tag.lower() in _SKIP:
                    self._depth = max(0, self._depth - 1)
            def handle_data(self, data):
                if self._depth == 0:
                    s = data.strip()
                    if s and not s.isspace():
                        self.texts.append(s)

        p = _Extractor()
        try:
            p.feed(raw_html)
        except Exception:
            pass
        return p.texts

    def _make_diff(lines1, lines2, label1, label2):
        return list(difflib.unified_diff(
            lines1, lines2,
            fromfile=label1,
            tofile=label2,
            lineterm="",
            n=2,
        ))

    html2 = _fetch(ts2)
    if not html2:
        return {"error": "Snapshot nicht verfügbar", "ts2": ts2}

    if not ts1:
        try:
            cdx_params = urlencode({
                "url": original_url,
                "output": "json",
                "fl": "timestamp",
                "filter": "statuscode:200",
                "collapse": "digest",
                "to": str(int(ts2) - 1),
                "limit": "1",
            })
            cdx_req = Request(
                f"https://web.archive.org/cdx/search/cdx?{cdx_params}",
                headers={"User-Agent": "Mozilla/5.0 (compatible; VeriTrend/1.0)"},
            )
            with urlopen(cdx_req, timeout=15) as r:
                cdx_data = json.loads(r.read().decode("utf-8"))
            if cdx_data and len(cdx_data) >= 2:
                ts1 = cdx_data[-1][0]
        except Exception as e:
            log.warning("CDX-Lookup für Vorgänger fehlgeschlagen: %s", e)

    if not ts1:
        return {
            "sections": [],
            "ts2": ts2,
            "ts1": None,
            "url": original_url,
            "info": "Kein Vorgänger-Snapshot gefunden",
        }

    html1 = _fetch(ts1)
    if not html1:
        return {"error": "Vorheriger Snapshot nicht verfügbar", "ts2": ts2, "ts1": ts1}

    label1 = f"Snapshot {ts1[:8]}"
    label2 = f"Snapshot {ts2[:8]}"

    sections = []

    body1 = _html_body_lines(html1)
    body2 = _html_body_lines(html2)
    log.info("DIFF body1 sample: %s", body1[:10])
    log.info("DIFF body2 sample: %s", body2[:10])
    html_diff = _make_diff(body1, body2, label1, label2)
    if html_diff:
        sections.append({
            "title": "HTML-Inhalt",
            "type": "html",
            "lines": html_diff,
        })

    js1 = _extract_blocks("script", html1)
    js2 = _extract_blocks("script", html2)
    js_diff = _make_diff(js1, js2, label1, label2)
    if js_diff:
        sections.append({
            "title": "JavaScript",
            "type": "js",
            "lines": js_diff,
        })

    css1 = _extract_blocks("style", html1)
    css2 = _extract_blocks("style", html2)
    css_diff = _make_diff(css1, css2, label1, label2)
    if css_diff:
        sections.append({
            "title": "CSS",
            "type": "css",
            "lines": css_diff,
        })

    # ── Tracker via Tag Manager ──
    tracker1_struct = _extract_tagmanager_scripts(html1)
    tracker2_struct = _extract_tagmanager_scripts(html2)
    tracker1_lines = _tracker_result_to_lines(tracker1_struct)
    tracker2_lines = _tracker_result_to_lines(tracker2_struct)
    tracker_diff = _make_diff(tracker1_lines, tracker2_lines, label1, label2)
    if tracker_diff:
        sections.append({
            "title": "Tracker (via Tag Manager)",
            "type": "tracker",
            "lines": tracker_diff,
        })
    elif tracker2_lines:
        sections.append({
            "title": "Tracker (via Tag Manager)",
            "type": "tracker",
            "lines": tracker2_lines,
        })

    # ── Seitenstatistik & Top-Keywords ──
    stats1 = _extract_page_stats(html1)
    stats2 = _extract_page_stats(html2)
    kw1 = _extract_top_keywords(html1, 30)
    kw2 = _extract_top_keywords(html2, 30)
    links1 = _extract_link_texts(html1, original_url, 30)
    links2 = _extract_link_texts(html2, original_url, 30)

    return {
        "sections": sections,
        "ts2": ts2,
        "ts1": ts1,
        "url": original_url,
        "js_raw":  js2,
        "css_raw": css2,
        "js_raw1": js1,
        "css_raw1": css1,
        "tracker_raw": tracker2_lines,
        "tracker_raw1": tracker1_lines,
        "tracker_struct": tracker2_struct,
        "tracker_struct1": tracker1_struct,
        "stats1": stats1,
        "stats2": stats2,
        "keywords1": kw1,
        "keywords2": kw2,
        "links1": links1,
        "links2": links2,
    }


def reverse_lookup_tracking_id(tracking_id):
    """Reverse-Lookup: Welche Domains nutzen dieselbe Tracking-ID?

    Strategie:
    1. GTM-Container-JS abrufen → Domain-Referenzen extrahieren
    2. CDX-API: Wayback-Snapshots der gefundenen Domains prüfen
    3. Für GA/GTM-IDs: CDX nach der Script-URL suchen
    """
    import re
    from urllib.request import Request, urlopen
    from urllib.parse import urlparse, urlencode

    results = []  # [{"domain": ..., "source": ..., "verified": bool}]
    seen_domains = set()
    tid = tracking_id.strip()

    def _add(domain, source, verified=False):
        d = domain.lower().lstrip("www.")
        if d and d not in seen_domains and len(d) > 3 and "." in d:
            seen_domains.add(d)
            results.append({"domain": d, "source": source, "verified": verified})

    # ── 1. GTM-Container parsen: Domain-Referenzen extrahieren ──
    if tid.startswith("GTM-"):
        try:
            req = Request(
                f"https://www.googletagmanager.com/gtm.js?id={tid}",
                headers={"User-Agent": "Mozilla/5.0 (compatible; VeriTrend/1.0)"})
            with urlopen(req, timeout=15) as resp:
                container_js = resp.read().decode("utf-8", errors="replace")

            # Domains aus dem Container extrahieren — nur echte URLs
            _IGNORE_DOMAINS = frozenset([
                "googletagmanager.com", "google-analytics.com",
                "googleapis.com", "gstatic.com", "google.com",
                "doubleclick.net", "googlesyndication.com",
                "googleadservices.com", "adservice.google.com",
                "pagead2.googlesyndication.com",
                "ade.googlesyndication.com",
                "ad.doubleclick.net",
                "facebook.net", "facebook.com",
                "connect.facebook.net",
                "fonts.googleapis.com", "schema.org", "w3.org",
                "jquery.com", "cloudflare.com", "jsdelivr.net",
                "unpkg.com", "cdnjs.cloudflare.com",
                "youtube.com", "m.youtube.com", "youtu.be",
                "googlevideo.com", "google.de", "google.co.uk",
                "twitter.com", "x.com", "t.co",
                "pinterest.com", "s.pinimg.com",
                "reddit.com", "redditstatic.com",
                "linkedin.com", "snap.licdn.com",
                "tiktok.com", "analytics.tiktok.com",
                "bing.com", "bat.bing.com",
                "amazon.com", "amazon-adsystem.com",
                # CDNs & Infrastruktur
                "akamaized.net", "fastly.net", "edgecastcdn.net",
                "cloudfront.net", "azureedge.net",
            ])
            # Gültige TLDs (gängige)
            _VALID_TLDS = frozenset(
                "com org net edu gov mil int io co dev app ai me tv fm"
                " de at ch uk fr es it pt nl be pl cz sk hu ro bg hr"
                " se no dk fi is lt lv ee ie lu li mc ad sm va"
                " ru ua by kz uz ge am az"
                " cn jp kr in tw hk sg my th id ph vn"
                " au nz ca br mx ar cl co pe ve"
                " za eg ng ke gh ma tn"
                " info biz name pro mobi asia tel travel jobs museum"
                " aero coop cat eu".split()
            )
            def _is_ignored(d):
                if d in _IGNORE_DOMAINS:
                    return True
                for ign in _IGNORE_DOMAINS:
                    if d.endswith("." + ign):
                        return True
                # TLD-Prüfung: letzte Komponente muss gültige TLD sein
                parts = d.rsplit(".", 1)
                if len(parts) < 2:
                    return True
                tld = parts[-1].lower()
                if tld not in _VALID_TLDS:
                    # co.uk etc. prüfen
                    parts2 = d.rsplit(".", 2)
                    if len(parts2) >= 3:
                        compound = parts2[-2] + "." + parts2[-1]
                        if compound not in ("co.uk", "co.jp", "co.kr",
                                            "co.nz", "co.za", "co.in",
                                            "com.au", "com.br", "com.mx",
                                            "com.ar", "com.cn", "com.tw",
                                            "com.hk", "com.sg", "or.jp",
                                            "org.uk", "net.au"):
                            return True
                    else:
                        return True
                return False
            # Nur explizite URLs mit Protokoll
            url_domain_pat = re.compile(
                r'https?://(?:www\.)?'
                r'([a-zA-Z0-9](?:[a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?'
                r'(?:\.[a-zA-Z]{2,})+)', re.I)
            for m in url_domain_pat.finditer(container_js):
                d = m.group(1).lower()
                if not _is_ignored(d) and \
                   not d.endswith((".js", ".css", ".png", ".gif")):
                    _add(d, "GTM-Container")

            # GTM Domain-Allowlists: oft als String-Arrays
            # z.B. ["nytimes.com","cooking.nytimes.com"]
            quoted_domain_pat = re.compile(
                r'["\']([a-zA-Z0-9](?:[a-zA-Z0-9\-]{0,40}[a-zA-Z0-9])?'
                r'\.(?:com|org|net|de|co\.uk|io|edu|gov|info|biz|eu|fr'
                r'|at|ch|nl|be|it|es|pt|se|no|dk|fi|pl|cz|ru|cn|jp'
                r'|au|ca|br|mx|in|kr|za|nz|ie|uk))["\']', re.I)
            for m in quoted_domain_pat.finditer(container_js):
                d = m.group(1).lower().lstrip("www.")
                if not _is_ignored(d) and len(d) > 4:
                    _add(d, "GTM-Allowlist")

            # Zusätzlich: GA-Property-IDs im Container → können auf
            # andere Domains verweisen (cross-domain tracking)
            ga_ids = set(re.findall(r'\bUA-\d{4,10}-\d{1,4}\b', container_js))
            ga4_ids = set(re.findall(r'\bG-[A-Z0-9]{6,12}\b', container_js))
            for gid in ga_ids | ga4_ids:
                _add(gid, "GA-Property im Container", verified=False)

        except Exception as e:
            log.debug("GTM-Container %s nicht abrufbar: %s", tid, e)

    # ── 2. CDX-API: Nach Seiten suchen, die die Tracking-ID laden ──
    # Für GTM/GA: Die Script-URL wird von vielen Domains geladen
    cdx_search_urls = []
    if tid.startswith("GTM-"):
        cdx_search_urls.append(
            f"googletagmanager.com/gtm.js?id={tid}")
    elif tid.startswith("G-"):
        cdx_search_urls.append(
            f"googletagmanager.com/gtag/js?id={tid}")
    elif tid.startswith("UA-"):
        cdx_search_urls.append(
            f"google-analytics.com/analytics.js")

    for search_url in cdx_search_urls:
        try:
            params = urlencode({
                "url": search_url,
                "output": "json",
                "fl": "original,timestamp",
                "filter": "statuscode:200",
                "collapse": "urlkey",
                "limit": "200",
            })
            req = Request(
                f"https://web.archive.org/cdx/search/cdx?{params}",
                headers={"User-Agent": "Mozilla/5.0 (compatible; VeriTrend/1.0)"})
            with urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            if data and len(data) >= 2:
                for row in data[1:]:
                    orig = row[0]
                    try:
                        parsed = urlparse(orig)
                        # Die Referer-Domain steckt manchmal im Query-Parameter
                        if parsed.query:
                            for qp in parsed.query.split("&"):
                                if "=" in qp:
                                    v = qp.split("=", 1)[1]
                                    try:
                                        pd = urlparse(v)
                                        if pd.netloc:
                                            _add(pd.netloc, "CDX-Referer")
                                    except Exception:
                                        pass
                    except Exception:
                        pass
        except Exception as e:
            log.debug("CDX-Lookup für %s fehlgeschlagen: %s", search_url, e)

    # ── 3. Gefundene Domains via CDX verifizieren ──
    # Stichprobenartig: Neuester Snapshot laden und prüfen ob ID vorkommt
    verified_count = 0
    for entry in results[:20]:  # max 20 Verifikationen
        if entry["verified"] or entry["domain"].startswith("G-") or \
           entry["domain"].startswith("UA-"):
            continue
        try:
            params = urlencode({
                "url": entry["domain"],
                "output": "json",
                "fl": "timestamp,original",
                "filter": "statuscode:200",
                "limit": "1",
                "sort": "reverse",
            })
            req = Request(
                f"https://web.archive.org/cdx/search/cdx?{params}",
                headers={"User-Agent": "Mozilla/5.0 (compatible; VeriTrend/1.0)"})
            with urlopen(req, timeout=8) as resp:
                cdx = json.loads(resp.read().decode("utf-8"))
            if cdx and len(cdx) >= 2:
                ts = cdx[1][0]
                wb_url = f"https://web.archive.org/web/{ts}id_/{entry['domain']}"
                req2 = Request(wb_url, headers={
                    "User-Agent": "Mozilla/5.0 (compatible; VeriTrend/1.0)"})
                with urlopen(req2, timeout=12) as resp2:
                    html = resp2.read().decode("utf-8", errors="replace")
                if tid in html:
                    entry["verified"] = True
                    verified_count += 1
        except Exception:
            pass
        if verified_count >= 8:
            break  # Performance-Limit

    return {
        "tracking_id": tid,
        "domains": results,
        "total": len(results),
    }


def fetch_wayback_live(url):
    """Gibt die letzten Snapshots/Änderungen einer URL zurück."""
    from datetime import datetime as _dt, timedelta as _td
    date_to = _dt.utcnow().strftime("%Y%m%d")
    date_from = (_dt.utcnow() - _td(days=365)).strftime("%Y%m%d")
    snapshots = fetch_wayback_snapshots(url, date_from, date_to)
    return snapshots[-20:] if len(snapshots) > 20 else snapshots
