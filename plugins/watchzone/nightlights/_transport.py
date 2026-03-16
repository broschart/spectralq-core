"""Nightlights transport layer — NASA GIBS VIIRS."""

import logging
from urllib.request import Request, urlopen
from urllib.parse import urlencode

log = logging.getLogger(__name__)

GIBS_WMS_URL = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi"
VIIRS_LAYER  = "VIIRS_SNPP_DayNightBand_At_Sensor_Radiance"


def _calc_mean_brightness(png_bytes):
    """Berechne mittlere Pixelhelligkeit aus PNG-Bytes (simpel, ohne PIL)."""
    try:
        from PIL import Image
        import io
        img = Image.open(io.BytesIO(png_bytes)).convert("L")
        pixels = list(img.getdata())
        if not pixels:
            return None
        nonzero = [p for p in pixels if p > 2]
        if not nonzero:
            return 0.0
        return round(sum(nonzero) / len(nonzero), 1)
    except ImportError:
        size_kb = len(png_bytes) / 1024
        return round(min(size_kb / 2, 255), 1)
    except Exception as e:
        log.warning("Brightness-Berechnung fehlgeschlagen: %s", e)
        return None


def fetch_nightlights_snapshot(bbox, date_str):
    """
    Ruft ein Nighttime-Lights-Bild von NASA GIBS (VIIRS) ab.
    bbox = [lon_min, lat_min, lon_max, lat_max]
    date_str = "YYYY-MM-DD"
    Gibt (image_url, mean_brightness) zurück.
    """
    import base64
    lon_min, lat_min, lon_max, lat_max = bbox
    params = urlencode({
        "SERVICE": "WMS",
        "REQUEST": "GetMap",
        "VERSION": "1.1.1",
        "LAYERS": VIIRS_LAYER,
        "SRS": "EPSG:4326",
        "BBOX": f"{lat_min},{lon_min},{lat_max},{lon_max}",
        "WIDTH": "512",
        "HEIGHT": "512",
        "FORMAT": "image/png",
        "TIME": date_str,
        "TRANSPARENT": "true",
    })
    url = f"{GIBS_WMS_URL}?{params}"
    log.info("GIBS nightlights request: %s", url)

    try:
        req = Request(url)
        resp = urlopen(req, timeout=20)
        img_bytes = resp.read()
        content_type = resp.headers.get("Content-Type", "image/png")

        mean_brightness = _calc_mean_brightness(img_bytes)

        b64 = base64.b64encode(img_bytes).decode("ascii")
        data_url = f"data:{content_type};base64,{b64}"
        return data_url, mean_brightness

    except Exception as e:
        log.warning("GIBS Nightlights Fehler: %s", e)
        return None, None


def _fetch_nightlights_brightness(bbox, date_str):
    """Schneller Helligkeitsabruf: kleines 32x32 Bild."""
    lon_min, lat_min, lon_max, lat_max = bbox
    params = urlencode({
        "SERVICE": "WMS",
        "REQUEST": "GetMap",
        "VERSION": "1.1.1",
        "LAYERS": VIIRS_LAYER,
        "SRS": "EPSG:4326",
        "BBOX": f"{lat_min},{lon_min},{lat_max},{lon_max}",
        "WIDTH": "32",
        "HEIGHT": "32",
        "FORMAT": "image/png",
        "TIME": date_str,
        "TRANSPARENT": "true",
    })
    url = f"{GIBS_WMS_URL}?{params}"
    try:
        req = Request(url)
        resp = urlopen(req, timeout=10)
        img_bytes = resp.read()
        return _calc_mean_brightness(img_bytes)
    except Exception as e:
        log.warning("GIBS brightness Fehler für %s: %s", date_str, e)
        return None


def fetch_nightlights_history(bbox, date_from, date_to):
    """
    Ruft historische Nighttime-Lights-Helligkeit ab.
    Gibt Liste von {date, value, label} zurück.
    """
    from datetime import datetime as _dt, timedelta as _td
    d_from = _dt.strptime(date_from, "%Y-%m-%d")
    d_to = _dt.strptime(date_to, "%Y-%m-%d")
    total_days = (d_to - d_from).days
    if total_days < 1:
        return []

    step = max(1, total_days // 20)
    results = []
    current = d_from

    while current <= d_to:
        date_str = current.strftime("%Y-%m-%d")
        try:
            brightness = _fetch_nightlights_brightness(bbox, date_str)
            if brightness is not None:
                results.append({
                    "date": date_str,
                    "value": brightness,
                    "label": f"Helligkeit: {brightness}",
                })
        except Exception as e:
            log.warning("Nightlights history Fehler für %s: %s", date_str, e)
        current += _td(days=step)

    return results
