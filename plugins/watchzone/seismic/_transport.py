"""Seismic transport layer — USGS Earthquake Catalog."""

import json
import logging
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode

log = logging.getLogger(__name__)

USGS_API_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query"


def fetch_usgs_earthquakes(bbox, date_from, date_to, min_magnitude=1.0):
    """
    Ruft Erdbebendaten vom USGS Earthquake Catalog ab.
    bbox: [lon_min, lat_min, lon_max, lat_max]
    Gibt Liste von {date, magnitude, depth, place, lat, lon} zurück.
    """
    params = urlencode({
        "format": "geojson",
        "starttime": date_from,
        "endtime": date_to,
        "minlatitude": bbox[1],
        "maxlatitude": bbox[3],
        "minlongitude": bbox[0],
        "maxlongitude": bbox[2],
        "minmagnitude": min_magnitude,
        "orderby": "time",
        "limit": 2000,
    })
    url = f"{USGS_API_URL}?{params}"
    req = Request(url)

    try:
        with urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except (HTTPError, URLError, OSError) as e:
        log.warning("USGS Earthquake Fehler: %s", e)
        raise RuntimeError(f"USGS-Daten nicht abrufbar: {e}")

    results = []
    for f in data.get("features", []):
        props = f.get("properties", {})
        coords = f.get("geometry", {}).get("coordinates", [])
        ts = props.get("time")
        if not ts:
            continue
        from datetime import datetime as _dt, timezone as _tz
        dt = _dt.fromtimestamp(ts / 1000, tz=_tz.utc)
        results.append({
            "date": dt.strftime("%Y-%m-%d"),
            "time": dt.strftime("%H:%M:%S"),
            "magnitude": props.get("mag"),
            "depth": coords[2] if len(coords) > 2 else None,
            "place": props.get("place", ""),
            "lat": coords[1] if len(coords) > 1 else None,
            "lon": coords[0] if coords else None,
            "event_id": f.get("id", ""),
            "detail_url": props.get("detail", ""),
        })
    return results


def fetch_usgs_earthquake_history(bbox, date_from, date_to):
    """
    Ruft Erdbebendaten ab und aggregiert tageweise.
    Gibt Liste von {date, value, count, max_mag, label} zurück.
    """
    quakes = fetch_usgs_earthquakes(bbox, date_from, date_to, min_magnitude=1.0)
    day_agg = {}
    for q in quakes:
        d = q["date"]
        mag = q.get("magnitude") or 0
        if d not in day_agg:
            day_agg[d] = []
        day_agg[d].append(mag)

    results = []
    for d in sorted(day_agg.keys()):
        mags = day_agg[d]
        results.append({
            "date": d,
            "value": round(max(mags), 1),
            "count": len(mags),
            "max_mag": round(max(mags), 1),
            "label": f"{len(mags)} Beben, max. M{max(mags):.1f}",
        })
    return results
