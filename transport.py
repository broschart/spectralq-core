"""
Transport Module – Shared Utilities
------------------------------------
Gemeinsame Infrastruktur für alle Plugins:
  - Credential-Verwaltung (_get_credential, API-Policies)
  - Copernicus OAuth2 + Sentinel Hub Request-Layer
  - Domain-Geolokation (resolve_domain_location)

Alle plugin-spezifischen Fetch-Funktionen liegen in den jeweiligen
Plugin-Verzeichnissen unter _transport.py.
"""

import json
import logging
import os
import time
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError
from urllib.parse import urlencode

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Konfiguration
# ---------------------------------------------------------------------------

# Copernicus Data Space Ecosystem (Sentinel Hub)
COPERNICUS_TOKEN_URL = ("https://identity.dataspace.copernicus.eu/auth/realms/"
                        "CDSE/protocol/openid-connect/token")
COPERNICUS_PROCESS_URL = "https://sh.dataspace.copernicus.eu/api/v1/process"
COPERNICUS_STATS_URL   = "https://sh.dataspace.copernicus.eu/api/v1/statistics"

# OAuth2-Token-Cache (Copernicus)
_copernicus_token_cache  = {}


# ---------------------------------------------------------------------------
# Shared: Credential-Verwaltung
# ---------------------------------------------------------------------------

# Mapping: Setting-Schlüssel → API-Gruppenname (muss mit app.py synchron bleiben)
_KEY_TO_API_GROUP = {
    "serpapi_key":          "serpapi",
    "newsapi_key":          "newsapi",
    "anthropic_api_key":    "anthropic",
    "openai_api_key":       "openai",
    "gemini_api_key":       "gemini",
    "mistral_api_key":      "mistral",
    "bluesky_handle":       "bluesky",
    "bluesky_app_password": "bluesky",
    "telegram_api_id":      "telegram",
    "telegram_api_hash":    "telegram",
    "copernicus_email":     "copernicus",
    "copernicus_password":  "copernicus",
    "censys_api_id":        "censys",
    "censys_api_secret":    "censys",
    "acled_email":          "acled",
    "acled_password":       "acled",
    "tomtom_api_key":       "tomtom",
    "opencellid_api_key":   "opencellid",
    "openaq_api_key":       "openaq",
    "entsoe_token":         "entsoe",
}


def _get_effective_api_policy_transport(api_name, user_id=None):
    """Gibt die effektive API-Berechtigung zurück:
    1. Per-User-Einstellung (user_api_perm_{group}) falls gesetzt
    2. Globale Policy (api_policy_{group})
    3. Fallback: "admin_key"
    """
    _valid = ("own_key", "admin_key", "disabled")
    try:
        from models import AppSetting
        if user_id:
            obj = AppSetting.query.filter_by(
                key=f"user_api_perm_{api_name}", user_id=user_id
            ).first()
            if obj and obj.value in _valid:
                return obj.value
        obj = AppSetting.query.filter_by(key=f"api_policy_{api_name}", user_id=None).first()
        val = obj.value if obj and obj.value else ""
        return val if val in _valid else "admin_key"
    except Exception:
        return "admin_key"


def _get_credential(key, env_var, user_id=None):
    """
    Liest einen API-Schlüssel mit per-User-Policy-Check und Fallback-Kette:
      - Policy "disabled"   → immer leerer String
      - Policy "admin_key"  → globale Setting / Env-Variable (kein User-Lookup)
      - Policy "own_key"    → User-spezifisch, kein Fallback auf Admin-Schlüssel
      Kein policy-Eintrag   → bisheriges Verhalten (user → global → env)
    """
    api_name = _KEY_TO_API_GROUP.get(key)
    try:
        from models import AppSetting
        if api_name:
            policy = _get_effective_api_policy_transport(api_name, user_id)
            if policy == "disabled":
                return ""
            if policy == "own_key":
                if user_id:
                    obj = AppSetting.query.filter_by(key=key, user_id=user_id).first()
                    if obj and obj.value:
                        return obj.value
                return ""  # own_key aber kein eigener Schlüssel gesetzt
            # admin_key: direkt zur globalen Setting
            obj = AppSetting.query.filter_by(key=key, user_id=None).first()
            if obj and obj.value:
                return obj.value
        else:
            # Kein Policy-Eintrag: bisheriges Verhalten
            if user_id:
                obj = AppSetting.query.filter_by(key=key, user_id=user_id).first()
                if obj and obj.value:
                    return obj.value
            obj = AppSetting.query.filter_by(key=key, user_id=None).first()
            if obj and obj.value:
                return obj.value
    except Exception:
        pass  # Außerhalb App-Context → Fallback auf Env
    return os.getenv(env_var, "")


# ---------------------------------------------------------------------------
# Copernicus Data Space – OAuth2 + Sentinel Hub API
# ---------------------------------------------------------------------------

class CopernicusAuthError(RuntimeError):
    """Copernicus-Zugangsdaten ungültig."""


def _copernicus_auth(user_id=None):
    """Gibt (email, password) zurück oder None."""
    email = _get_credential("copernicus_email", "COPERNICUS_EMAIL", user_id)
    pw    = _get_credential("copernicus_password", "COPERNICUS_PASSWORD", user_id)
    if email and pw:
        return (email, pw)
    return None


def _copernicus_get_token(user_id=None):
    """
    Holt ein OAuth2 Bearer-Token vom Copernicus Data Space
    via Resource Owner Password Grant (cdse-public Client).
    Cached den Token bis 60s vor Ablauf.
    """
    auth = _copernicus_auth(user_id)
    if not auth:
        return None

    cache_key = f"cdse:{auth[0]}:{user_id}"
    cached = _copernicus_token_cache.get(cache_key)
    if cached and cached["expires"] > time.time():
        return cached["token"]

    post_data = urlencode({
        "grant_type": "password",
        "client_id":  "cdse-public",
        "username":   auth[0],
        "password":   auth[1],
    }).encode("utf-8")

    req = Request(COPERNICUS_TOKEN_URL, data=post_data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")

    try:
        with urlopen(req, timeout=15) as resp:
            token_data = json.loads(resp.read().decode("utf-8"))
        access_token = token_data["access_token"]
        expires_in = token_data.get("expires_in", 600)
        _copernicus_token_cache[cache_key] = {
            "token":   access_token,
            "expires": time.time() + expires_in - 60,
        }
        log.info("Copernicus OAuth2-Token erhalten (gültig %ds)", expires_in)
        return access_token
    except HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        log.warning("Copernicus Token-Anfrage fehlgeschlagen (%s): %s", e.code, body)
        if e.code in (401, 400):
            raise CopernicusAuthError(
                "Copernicus-Zugangsdaten ungültig – bitte unter Admin → Transport-Tracking prüfen.")
        return None
    except (URLError, OSError) as e:
        log.warning("Copernicus Token-Netzwerkfehler: %s", e)
        return None


def _copernicus_request(url, payload, user_id=None, accept="application/json",
                        _retry=True):
    """
    POST gegen Sentinel Hub API mit Bearer-Token.
    payload: dict (wird als JSON gesendet).
    Gibt bytes (Bild) oder dict (JSON) zurück.
    """
    token = _copernicus_get_token(user_id)
    if not token:
        raise CopernicusAuthError("Keine Copernicus-Credentials konfiguriert.")

    body = json.dumps(payload).encode("utf-8")
    req = Request(url, data=body, method="POST")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", accept)

    try:
        with urlopen(req, timeout=60) as resp:
            raw = resp.read()
            if accept == "application/json":
                return json.loads(raw.decode("utf-8"))
            return raw  # Bild (PNG/JPEG)
    except HTTPError as e:
        if e.code == 401 and _retry:
            auth = _copernicus_auth(user_id)
            if auth:
                cache_key = f"cdse:{auth[0]}:{user_id}"
                _copernicus_token_cache.pop(cache_key, None)
                log.info("Copernicus 401 – Token-Refresh und Retry")
                return _copernicus_request(url, payload, user_id, accept,
                                           _retry=False)
        body_text = ""
        try:
            body_text = e.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        log.warning("Copernicus HTTP %s: %s", e.code, body_text)
        if e.code in (401, 403):
            raise CopernicusAuthError(body_text or "Copernicus-Zugriff verweigert.")
        raise
    except (URLError, OSError) as e:
        log.warning("Copernicus Netzwerk-Fehler: %s", e)
        raise



# ---------------------------------------------------------------------------
# Domain → Server-Standort (IP-Geolokation)
# ---------------------------------------------------------------------------

def resolve_domain_location(domain):
    """
    Löst eine Domain per DNS auf und bestimmt den Server-Standort via ip-api.com.
    Gibt dict zurück: {ip, lat, lon, country, city, org, isp, as_name} oder None.
    """
    import socket
    from urllib.parse import urlparse

    if "://" in domain:
        domain = urlparse(domain).hostname or domain
    domain = domain.strip().rstrip("/").split("/")[0]

    try:
        ip = socket.gethostbyname(domain)
    except socket.gaierror as e:
        log.warning("DNS-Auflösung fehlgeschlagen für %s: %s", domain, e)
        return None

    api_url = f"http://ip-api.com/json/{ip}?fields=status,message,country,city,lat,lon,isp,org,as,query"
    try:
        req = Request(api_url, headers={"User-Agent": "VeriTrend/1.0"})
        with urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        log.warning("IP-Geolokation fehlgeschlagen für %s (%s): %s", domain, ip, e)
        return None

    if data.get("status") != "success":
        log.warning("IP-Geolokation Fehler: %s", data.get("message", ""))
        return None

    return {
        "ip": data.get("query", ip),
        "lat": data.get("lat"),
        "lon": data.get("lon"),
        "country": data.get("country", ""),
        "city": data.get("city", ""),
        "org": data.get("org", ""),
        "isp": data.get("isp", ""),
        "as_name": data.get("as", ""),
    }
