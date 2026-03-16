"""Censys transport layer — Censys Search API v2."""

import logging

log = logging.getLogger(__name__)


def fetch_censys_search(query, api_id, api_secret, per_page=50):
    """
    Sucht Hosts in der Censys Search API v2 anhand einer Suchanfrage.
    Gibt eine normalisierte Liste von Host-Dicts zurück.
    """
    import requests as _req
    url = "https://search.censys.io/api/v2/hosts/search"
    params = {"q": query, "per_page": min(int(per_page), 100)}
    try:
        r = _req.get(url, params=params, auth=(api_id, api_secret), timeout=30)
        if r.status_code == 401:
            raise RuntimeError("Ungültige Censys-Credentials (API ID / Secret prüfen)")
        if r.status_code == 429:
            raise RuntimeError("Censys API Rate-Limit erreicht")
        r.raise_for_status()
        data = r.json()
        hits = data.get("result", {}).get("hits", [])
        items = []
        for h in hits:
            svcs = h.get("services", [])
            ports = sorted(set(s.get("port") for s in svcs if s.get("port")))
            service_names = list(dict.fromkeys(
                s.get("service_name", "") for s in svcs if s.get("service_name")
            ))
            asn_info = h.get("autonomous_system", {})
            loc = h.get("location", {})
            coords = loc.get("coordinates") or {}
            items.append({
                "ip":           h.get("ip", ""),
                "ports":        ports,
                "services":     service_names,
                "asn":          asn_info.get("asn"),
                "org":          asn_info.get("name", ""),
                "country":      loc.get("country", ""),
                "country_code": loc.get("country_code", ""),
                "city":         loc.get("city", ""),
                "lat":          coords.get("latitude"),
                "lon":          coords.get("longitude"),
                "last_updated": h.get("last_updated_at", "")[:10] if h.get("last_updated_at") else "",
            })
        return items
    except RuntimeError:
        raise
    except Exception as e:
        log.warning("Censys Fehler für Query '%s': %s", query, e)
        raise RuntimeError(f"Censys-Anfrage fehlgeschlagen: {e}")
