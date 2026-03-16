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
        "limit": "5000",
    }
    if date_from:
        params["from"] = date_from.replace("-", "")
    if date_to:
        params["to"] = date_to.replace("-", "")

    req_url = cdx_url + "?" + urlencode(params)
    log.info("Wayback CDX request: %s", req_url)
    try:
        req = Request(req_url, headers={"User-Agent": "VeriTrend/1.0"})
        with urlopen(req, timeout=30) as resp:
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

    def _fetch(ts):
        import gzip as _gzip
        wb_url = f"https://web.archive.org/web/{ts}id_/{original_url}"
        req = Request(wb_url, headers={"User-Agent": "Mozilla/5.0 (compatible; VeriTrend/1.0)"})
        try:
            with urlopen(req, timeout=25) as resp:
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
                mm = re.search(r'<meta[^>]+charset=["\']?([^\s;"\'/>]+)', sniff, re.I)
                if not mm:
                    mm = re.search(r'<meta[^>]+content=["\'][^"\']*charset=([^\s;"\'/>]+)', sniff, re.I)
                charset = mm.group(1) if mm else "utf-8"
            return raw.decode(charset, errors="replace")
        except Exception:
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

    return {
        "sections": sections,
        "ts2": ts2,
        "ts1": ts1,
        "url": original_url,
        "js_raw":  js2,
        "css_raw": css2,
        "js_raw1": js1,
        "css_raw1": css1,
    }


def fetch_wayback_live(url):
    """Gibt die letzten Snapshots/Änderungen einer URL zurück."""
    from datetime import datetime as _dt, timedelta as _td
    date_to = _dt.utcnow().strftime("%Y%m%d")
    date_from = (_dt.utcnow() - _td(days=365)).strftime("%Y%m%d")
    snapshots = fetch_wayback_snapshots(url, date_from, date_to)
    return snapshots[-20:] if len(snapshots) > 20 else snapshots
