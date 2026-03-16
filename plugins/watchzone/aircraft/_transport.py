"""Aircraft transport layer — ADS-B via airplanes.live."""

import json
import logging
import math
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Hilfsfunktionen
# ---------------------------------------------------------------------------

def _feet_to_m(val):
    """Konvertiert Fuß → Meter. Gibt None zurück bei ungültigem Wert."""
    if val is None or val == "ground":
        return None
    try:
        return round(float(val) * 0.3048, 1)
    except (ValueError, TypeError):
        return None


def _knots_to_ms(val):
    """Konvertiert Knoten → m/s."""
    if val is None:
        return None
    try:
        return round(float(val) * 0.514444, 1)
    except (ValueError, TypeError):
        return None


def _fpm_to_ms(val):
    """Konvertiert ft/min → m/s."""
    if val is None:
        return None
    try:
        return round(float(val) * 0.00508, 2)
    except (ValueError, TypeError):
        return None


def _reg_to_country(reg):
    """Ermittelt das Registrierungsland aus dem Kennzeichen-Präfix."""
    if not reg:
        return ""
    r = reg.upper()
    _PREFIXES = [
        ("D-",    "Germany"),
        ("OE-",   "Austria"),
        ("HB-",   "Switzerland"),
        ("N",     "USA"),
        ("G-",    "United Kingdom"),
        ("F-",    "France"),
        ("I-",    "Italy"),
        ("EC-",   "Spain"),
        ("PH-",   "Netherlands"),
        ("OO-",   "Belgium"),
        ("SE-",   "Sweden"),
        ("OH-",   "Finland"),
        ("OY-",   "Denmark"),
        ("LN-",   "Norway"),
        ("EI-",   "Ireland"),
        ("CS-",   "Portugal"),
        ("SX-",   "Greece"),
        ("TC-",   "Turkey"),
        ("RA-",   "Russia"),
        ("SP-",   "Poland"),
        ("OK-",   "Czech Republic"),
        ("HA-",   "Hungary"),
        ("OM-",   "Slovakia"),
        ("YR-",   "Romania"),
        ("LZ-",   "Bulgaria"),
        ("9A-",   "Croatia"),
        ("S5-",   "Slovenia"),
        ("ES-",   "Estonia"),
        ("YL-",   "Latvia"),
        ("LY-",   "Lithuania"),
        ("9H-",   "Malta"),
        ("4X-",   "Israel"),
        ("A6-",   "UAE"),
        ("A7-",   "Qatar"),
        ("HZ-",   "Saudi Arabia"),
        ("EP-",   "Iran"),
        ("AP-",   "Pakistan"),
        ("VT-",   "India"),
        ("JA-",   "Japan"),
        ("HL-",   "South Korea"),
        ("B-",    "China/Taiwan"),
        ("9V-",   "Singapore"),
        ("9M-",   "Malaysia"),
        ("HS-",   "Thailand"),
        ("PK-",   "Indonesia"),
        ("VH-",   "Australia"),
        ("ZK-",   "New Zealand"),
        ("C-",    "Canada"),
        ("XA-",   "Mexico"),
        ("PT-",   "Brazil"),
        ("PP-",   "Brazil"),
        ("PR-",   "Brazil"),
        ("LV-",   "Argentina"),
        ("CC-",   "Chile"),
        ("ZS-",   "South Africa"),
        ("SU-",   "Egypt"),
        ("CN-",   "Morocco"),
        ("ET-",   "Ethiopia"),
        ("5N-",   "Nigeria"),
    ]
    for prefix, country in _PREFIXES:
        if r.startswith(prefix):
            return country
    return ""


# ---------------------------------------------------------------------------
# Klassifizierung
# ---------------------------------------------------------------------------

def _classify_aircraft(ac):
    """
    Klassifiziert ein Flugzeug als 'military', 'private' oder 'commercial'.
    Basiert auf ICAO-Typecode, ADS-B-Kategorie, Registration und Betreiber.
    """
    typ = (ac.get("type") or "").upper()
    cat = (ac.get("category") or "")
    reg = (ac.get("reg") or "").upper()
    desc = (ac.get("desc") or "").upper()
    oper = (ac.get("operator") or "").upper()
    callsign = (ac.get("callsign") or "").upper()

    _MIL_TYPES = {
        "F16", "F15", "F18", "FA18", "F22", "F35", "F35A", "F35B", "F35C",
        "F14", "F4", "F5", "F104", "F111", "F117",
        "EUFI", "EF2K",
        "RFAL", "RFA3",
        "TOR",
        "GR4", "GR1",
        "MG29", "M29", "MG31",
        "SU27", "SU30", "SU34", "SU35", "SU57",
        "JAS39", "J39",
        "HAWK", "T45",
        "A10", "A10A",
        "AV8",
        "B1", "B1B", "B2", "B52", "B52H", "TU95", "TU160",
        "C130", "C17", "C5", "C5M", "C2",
        "A400", "A400M",
        "KC10", "KC46", "KC135",
        "IL76", "AN12", "AN124", "AN22",
        "E3", "E3TF", "E6", "E8", "E2C",
        "GLEX",
        "P3", "P8", "P8A",
        "RQ4", "MQ9", "MQ1",
        "U2", "U2S",
        "RC135", "EC135",
        "AH64", "AH1", "UH60", "CH47", "CH53",
        "MI24", "MI28", "MI8", "MI17", "KA52",
        "NH90", "LYNX", "WILD",
        "AS32", "EC65", "H60",
    }

    _MIL_OPER = [
        "AIR FORCE", "NAVY", "ARMY", "MARINE", "LUFTWAFFE",
        "BUNDESWEHR", "MILITARY", "ROYAL AIR", "RAF ",
        "USAF", "NATO", "OTAN", "NORAD",
    ]

    _MIL_CALLSIGNS = [
        "RRR", "RCH",
        "GAF",
        "IAM",
        "FAF",
        "SHF",
        "BAF",
        "NAF",
        "PLF",
        "HAF",
        "TAF",
        "CNV", "NAVY",
    ]

    _COMMERCIAL_OPER = [
        "LUFTHANSA", "EUROWINGS", "CONDOR", "TUIFLY", "SUNDAIR",
        "RYANAIR", "EASYJET", "WIZZ", "VUELING", "TRANSAVIA",
        "BRITISH AIRWAYS", "KLM", "AIR FRANCE", "SWISS", "AUSTRIAN",
        "SAS ", "SCANDINAVIAN", "FINNAIR", "NORWEGIAN", "ICELANDAIR",
        "IBERIA", "TAP ", "AEGEAN", "TURKISH AIRLINES", "PEGASUS",
        "AEROFLOT", "LOT ", "CZECH AIRLINES",
        "UNITED", "DELTA", "AMERICAN AIRLINES", "SOUTHWEST",
        "EMIRATES", "QATAR", "ETIHAD", "SINGAPORE", "CATHAY",
        "ANA ", "JAL ", "KOREAN AIR", "CHINA ",
        "FLYDUBAI", "SAUDIA", "OMAN AIR",
        "FEDEX", "UPS ", "DHL", "CARGO",
        "ATLAS AIR", "CARGOLUX",
    ]

    _PRIVATE_TYPES = {
        "C150", "C152", "C170", "C172", "C177", "C180", "C182", "C185",
        "C205", "C206", "C207", "C210", "C337",
        "PA18", "PA22", "PA24", "PA28", "PA32", "PA34", "PA38", "PA44", "PA46",
        "DA20", "DA40", "DA42", "DA62",
        "SR20", "SR22", "TBM7", "TBM8", "TBM9", "TBM",
        "M20T", "M20P", "M20J", "M20K",
        "BE33", "BE35", "BE36", "BE23",
        "AA5", "AA1", "DR40",
        "P28A", "P28B", "P28R", "P28T",
        "COLT", "J3", "RV7", "RV8", "RV10", "PIVI",
        "TAMP", "AQUI", "SIRA", "ECHO", "ELST", "JABI",
        "DIMO", "C42", "FK9", "BREE",
        "C510", "C525", "C550", "C560", "C680", "C700", "C750",
        "CL30", "CL35", "CL60", "GL5T", "GL7T", "GLEX",
        "LJ24", "LJ25", "LJ31", "LJ35", "LJ40", "LJ45", "LJ60", "LJ70", "LJ75",
        "E35L", "E50P", "E55P", "E545", "E550",
        "FA50", "FA7X", "FA8X", "FA90", "F900",
        "G150", "G200", "G280", "GA5C", "GA6C", "GLF4", "GLF5", "GLF6", "G650",
        "H25B", "H25C",
        "PC12", "PC24", "P180",
        "BE40", "BE9L", "BE20", "BE30", "BE99", "BE10",
        "PRM1",
        "R22", "R44", "R66",
        "EC20", "EC30", "EC35", "EC45", "EC55", "AS50", "AS55", "AS65",
        "A109", "A119", "A139", "A169",
        "B06", "B105", "B206", "B212", "B407", "B412", "B429",
        "S76", "S92",
    }

    # 1. Militärisch?
    if typ in _MIL_TYPES:
        return "military"
    for kw in _MIL_OPER:
        if kw in oper:
            return "military"
    for pref in _MIL_CALLSIGNS:
        if callsign.startswith(pref):
            return "military"
    if reg and any(reg.startswith(p) for p in ("98+", "46+", "45+", "44+", "43+", "41+")):
        return "military"
    if "MILITARY" in desc or "COMBAT" in desc or "FIGHTER" in desc or "TANKER" in desc:
        return "military"
    if cat.startswith("B") and cat not in ("B1", "B2"):
        return "military"

    # 2. Kommerziell?
    if cat in ("A3", "A4", "A5"):
        return "commercial"
    for kw in _COMMERCIAL_OPER:
        if kw in oper:
            return "commercial"
    _AIRLINER = {
        "A319", "A320", "A321", "A332", "A333", "A338", "A339",
        "A342", "A343", "A345", "A346",
        "A359", "A35K", "A388",
        "B731", "B732", "B733", "B734", "B735", "B736", "B737", "B738", "B739",
        "B38M", "B39M",
        "B741", "B742", "B743", "B744", "B748",
        "B752", "B753", "B762", "B763", "B764",
        "B772", "B773", "B77L", "B77W", "B788", "B789", "B78X",
        "E170", "E175", "E190", "E195", "E290", "E295",
        "CRJ1", "CRJ2", "CRJ7", "CRJ9", "CRJX",
        "AT43", "AT45", "AT72", "AT76", "DH8A", "DH8B", "DH8C", "DH8D",
        "A306", "A30B", "A310",
        "MD11", "MD80", "MD82", "MD83", "MD87", "MD88", "MD90",
        "DC9", "DC10", "B712",
        "BCS1", "BCS3",
    }
    if typ in _AIRLINER:
        return "commercial"

    # 3. Privat?
    if typ in _PRIVATE_TYPES:
        return "private"
    if cat in ("A1", "A2"):
        return "private"

    return "civil"


def _aircraft_anomaly_score(ac):
    """
    Berechnet einen Anomalie-Score (0–100) für ein Flugzeug.
    Gibt (score, flags) zurück, wobei flags eine Liste von Auffälligkeiten ist.
    """
    score = 0
    flags = []

    # 1. Notfall-Squawk-Codes
    squawk = ac.get("squawk", "")
    emergency = ac.get("emergency", "none")
    EMERGENCY_SQUAWKS = {
        "7500": ("Hijacking", 40),
        "7600": ("Radio Failure", 30),
        "7700": ("Emergency", 35),
    }
    if squawk in EMERGENCY_SQUAWKS:
        label, pts = EMERGENCY_SQUAWKS[squawk]
        flags.append(f"Squawk {squawk} ({label})")
        score += pts
    if emergency and emergency != "none":
        flags.append(f"Emergency: {emergency}")
        score += 30

    # 2. No callsign
    if not ac.get("callsign"):
        flags.append("No Callsign")
        score += 10

    # 3. No registration
    if not ac.get("reg"):
        flags.append("No Registration")
        score += 5

    # 4. Unusual altitude
    alt = ac.get("alt_m")
    on_ground = ac.get("on_ground", False)
    if alt is not None and not on_ground:
        if alt < 300:
            flags.append(f"Very Low Altitude ({int(alt)} m)")
            score += 20
        elif alt < 600:
            flags.append(f"Low Altitude ({int(alt)} m)")
            score += 10
        elif alt > 13000:
            flags.append(f"Very High Altitude ({int(alt)} m)")
            score += 5

    # 5. High sink rate
    vr = ac.get("vert_rate")
    if vr is not None and vr < -15:
        flags.append(f"Rapid Descent ({round(vr, 1)} m/s)")
        score += 15
    elif vr is not None and vr < -10:
        flags.append(f"Fast Descent ({round(vr, 1)} m/s)")
        score += 8

    # 6. Very low airspeed
    vel = ac.get("velocity")
    if vel is not None and not on_ground:
        if vel < 40 and alt and alt > 300:
            flags.append(f"Very Slow ({round(vel * 3.6)} km/h)")
            score += 12

    # 7. Weak signal
    rssi = ac.get("rssi")
    if rssi is not None and rssi < -30:
        flags.append(f"Weak Signal ({rssi} dBFS)")
        score += 5

    # 8. Stale position
    seen = ac.get("seen_pos")
    if seen is not None and seen > 60:
        flags.append(f"Stale Position ({int(seen)}s)")
        score += 8

    # 9. Heavy/large aircraft
    cat = ac.get("category", "")
    if cat in ("A6", "A7", "B6", "B7"):
        flags.append(f"Heavy/Large Aircraft (Cat. {cat})")
        score += 3

    return min(100, score), flags


# ---------------------------------------------------------------------------
# Fetch
# ---------------------------------------------------------------------------

def fetch_aircraft_live(bbox, user_id=None):
    """
    Ruft aktuelle Flugzeugpositionen in einer Bounding-Box ab
    via airplanes.live (ADS-B Exchange Community Feed).
    bbox: [lon_min, lat_min, lon_max, lat_max]
    Gibt Liste von Flugzeug-Dicts zurück.
    """
    lon_min, lat_min, lon_max, lat_max = bbox
    center_lat = (lat_min + lat_max) / 2
    center_lon = (lon_min + lon_max) / 2

    dlat = abs(lat_max - lat_min) * 111.32
    dlon = abs(lon_max - lon_min) * 111.32 * math.cos(math.radians(center_lat))
    diag_km = math.sqrt(dlat**2 + dlon**2)
    radius_nm = max(1, min(250, diag_km / 2 / 1.852))

    url = f"https://api.airplanes.live/v2/point/{center_lat:.4f}/{center_lon:.4f}/{radius_nm:.0f}"
    req = Request(url)
    req.add_header("Accept", "application/json")
    req.add_header("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36")

    try:
        with urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except HTTPError as e:
        log.warning("airplanes.live HTTP %s", e.code)
        raise RuntimeError(f"airplanes.live-Fehler: HTTP {e.code}")
    except (URLError, OSError) as e:
        log.warning("airplanes.live Netzwerk-Fehler: %s", e)
        raise RuntimeError(f"airplanes.live nicht erreichbar: {e}")

    results = []
    for ac in data.get("ac", []):
        lat = ac.get("lat")
        lon = ac.get("lon")
        if lat is None or lon is None:
            continue
        if not (lat_min <= lat <= lat_max and lon_min <= lon <= lon_max):
            continue
        reg = ac.get("r", "")
        entry = {
            "icao24":    ac.get("hex", ""),
            "callsign":  (ac.get("flight") or "").strip(),
            "operator":  (ac.get("ownOp") or "").strip(),
            "country":   _reg_to_country(reg),
            "lat":       lat,
            "lon":       lon,
            "alt_m":     _feet_to_m(ac.get("alt_baro")),
            "alt_geo_m": _feet_to_m(ac.get("alt_geom")),
            "on_ground": ac.get("alt_baro") == "ground",
            "velocity":  _knots_to_ms(ac.get("gs")),
            "ias":       _knots_to_ms(ac.get("ias")),
            "tas":       _knots_to_ms(ac.get("tas")),
            "mach":      ac.get("mach"),
            "heading":   ac.get("track"),
            "mag_heading": ac.get("mag_heading"),
            "vert_rate": _fpm_to_ms(ac.get("baro_rate")),
            "type":      ac.get("t", ""),
            "desc":      ac.get("desc", ""),
            "reg":       reg,
            "squawk":    ac.get("squawk", ""),
            "emergency": ac.get("emergency", "none"),
            "category":  ac.get("category", ""),
            "nav_alt":   _feet_to_m(ac.get("nav_altitude_mcp")),
            "nav_qnh":   ac.get("nav_qnh"),
            "rssi":      ac.get("rssi"),
            "seen":      ac.get("seen"),
            "seen_pos":  ac.get("seen_pos"),
            "messages":  ac.get("messages"),
        }
        entry["usage"] = _classify_aircraft(entry)
        entry["anomaly_score"], entry["anomaly_flags"] = _aircraft_anomaly_score(entry)
        results.append(entry)

    results.sort(key=lambda x: x["anomaly_score"], reverse=True)
    return results


# Legacy-Alias
fetch_opensky_states = fetch_aircraft_live
