"""Vessel transport layer — AIS ship tracking via AISHub."""

import json
import logging
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode

log = logging.getLogger(__name__)

AISHUB_API_URL = "https://data.aishub.net/ws.php"


def _classify_vessel(v):
    """
    Klassifiziert ein Schiff anhand des AIS-Schiffstyps (IMO-Kategorien).
    """
    try:
        t = int(v.get("type", 0) or 0)
    except (ValueError, TypeError):
        t = 0

    name = (v.get("name") or "").upper()

    _MIL_KEYWORDS = ["NAVY", "MARINE", "WARSHIP", "FRIGATE", "CORVETTE",
                     "DESTROYER", "SUBMARINE", "PATROL", "KÜSTENWACHE",
                     "COAST GUARD", "COASTGUARD", "BUNDESMARINE"]
    for kw in _MIL_KEYWORDS:
        if kw in name:
            return "military"
    if t in (35,):
        return "military"

    if t in (51, 52, 53, 54, 55):
        return "government"
    if 60 <= t <= 69:
        return "passenger"
    if 70 <= t <= 79:
        return "cargo"
    if 80 <= t <= 89:
        return "tanker"
    if t == 30:
        return "fishing"
    if t in (31, 32):
        return "tug"
    if t == 36:
        return "sailing"
    if t == 37:
        return "pleasure"
    if 40 <= t <= 49:
        return "hsc"
    if t == 50:
        return "pilot"

    return "other"


def _vessel_anomaly_score(v):
    """
    Berechnet einen Anomalie-Score (0–100) für ein Schiff.
    Gibt (score, flags) zurück.
    """
    score = 0
    flags = []

    if not v.get("name"):
        flags.append("No Vessel Name")
        score += 10
    if not v.get("mmsi"):
        flags.append("No MMSI")
        score += 15

    speed = v.get("speed")
    if speed is not None:
        try:
            spd = float(speed)
            if spd > 30:
                flags.append(f"Very High Speed ({spd:.1f} kn)")
                score += 20
            elif spd > 20:
                flags.append(f"High Speed ({spd:.1f} kn)")
                score += 10
        except (ValueError, TypeError):
            pass

    if not v.get("dest"):
        flags.append("No Destination Port")
        score += 5

    if v.get("usage") == "military":
        flags.append("Military Vessel")
        score += 15

    try:
        t = int(v.get("type", 0) or 0)
    except (ValueError, TypeError):
        t = 0
    if t == 0:
        flags.append("Vessel Type Unspecified")
        score += 8

    if not v.get("flag"):
        flags.append("No Flag")
        score += 5

    return min(100, score), flags


def fetch_ais_vessels(bbox, user_id=None):
    """
    Ruft aktuelle Schiffspositionen in einer Bounding-Box ab (AISHub API).
    bbox: [lon_min, lat_min, lon_max, lat_max]
    Gibt Liste von Schiffs-Dicts zurück.
    """
    from transport import _get_credential

    username = _get_credential("aishub_user", "AISHUB_USER", user_id)
    if not username:
        raise RuntimeError("Keine AISHub-Zugangsdaten konfiguriert. "
                           "Bitte unter Admin → Einstellungen eintragen.")

    params = urlencode({
        "username":  username,
        "format":    "1",
        "output":    "json",
        "compress":  "0",
        "latmin":    bbox[1],
        "latmax":    bbox[3],
        "lonmin":    bbox[0],
        "lonmax":    bbox[2],
    })
    url = f"{AISHUB_API_URL}?{params}"
    req = Request(url)

    try:
        with urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8")
    except (HTTPError, URLError, OSError) as e:
        log.warning("AISHub Fehler: %s", e)
        raise RuntimeError(f"AISHub nicht erreichbar: {e}")

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        raise RuntimeError("AISHub: ungültige Antwort")

    if isinstance(data, list) and len(data) >= 2:
        ships = data[1] if isinstance(data[1], list) else []
    elif isinstance(data, list):
        ships = data
    else:
        ships = data.get("ships", data.get("data", []))

    results = []
    for v in ships:
        if isinstance(v, dict):
            lat = v.get("LATITUDE") or v.get("lat")
            lon = v.get("LONGITUDE") or v.get("lon")
            if lat is None or lon is None:
                continue
            results.append({
                "mmsi":     v.get("MMSI", ""),
                "name":     (v.get("NAME") or v.get("name") or "").strip(),
                "lat":      float(lat),
                "lon":      float(lon),
                "speed":    v.get("SOG") or v.get("speed"),
                "course":   v.get("COG") or v.get("course"),
                "type":     v.get("TYPE") or v.get("ship_type", ""),
                "dest":     (v.get("DEST") or v.get("destination") or "").strip(),
                "flag":     v.get("FLAG") or v.get("country", ""),
            })
    for entry in results:
        entry["usage"] = _classify_vessel(entry)
        entry["anomaly_score"], entry["anomaly_flags"] = _vessel_anomaly_score(entry)

    results.sort(key=lambda x: x["anomaly_score"], reverse=True)
    return results
