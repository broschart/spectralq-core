"""NDVI transport layer — Copernicus Sentinel-2 Vegetation Index."""

import logging
import math

log = logging.getLogger(__name__)


def fetch_sentinel_ndvi_stats(bbox, date_from, date_to, interval="P1D",
                              user_id=None):
    """
    Ruft NDVI-Statistiken (Mittelwert pro Zeitintervall) für eine Region ab.
    bbox: [lon_min, lat_min, lon_max, lat_max]
    interval: "P1D" (täglich), "P7D" (wöchentlich), "P1M" (monatlich)
    Gibt Liste von {date, mean_ndvi} zurück.
    """
    from transport import COPERNICUS_STATS_URL, _copernicus_request

    date_from = date_from[:10]
    date_to   = date_to[:10]

    MAX_SPAN = 2.0
    lon_span = abs(bbox[2] - bbox[0])
    lat_span = abs(bbox[3] - bbox[1])
    if lon_span > MAX_SPAN or lat_span > MAX_SPAN:
        cx = (bbox[0] + bbox[2]) / 2
        cy = (bbox[1] + bbox[3]) / 2
        half = MAX_SPAN / 2
        bbox = [cx - half, cy - half, cx + half, cy + half]
        lon_span = MAX_SPAN
        lat_span = MAX_SPAN
        log.info("NDVI: Region auf 2°×2° zugeschnitten (Zentrum: %.2f, %.2f)", cx, cy)

    m_per_deg_lat = 111320
    m_per_deg_lon = 111320 * math.cos(math.radians((bbox[1] + bbox[3]) / 2))
    region_w_m = lon_span * m_per_deg_lon
    region_h_m = lat_span * m_per_deg_lat
    w_pixels = max(10, min(500, math.ceil(region_w_m / 1400)))
    h_pixels = max(10, min(500, math.ceil(region_h_m / 1400)))

    payload = {
        "input": {
            "bounds": {
                "bbox": bbox,
                "properties": {"crs": "http://www.opengis.net/def/crs/OGC/1.3/CRS84"}
            },
            "data": [{
                "type": "sentinel-2-l2a",
                "dataFilter": {
                    "timeRange": {
                        "from": date_from + "T00:00:00Z",
                        "to":   date_to   + "T23:59:59Z",
                    },
                    "maxCloudCoverage": 50,
                }
            }]
        },
        "aggregation": {
            "timeRange": {
                "from": date_from + "T00:00:00Z",
                "to":   date_to   + "T23:59:59Z",
            },
            "aggregationInterval": {"of": interval},
            "evalscript": """//VERSION=3
function setup() {
  return { input: ["B04","B08","dataMask"], output: [{ id:"ndvi", bands:1 }, { id:"dataMask", bands:1 }] };
}
function evaluatePixel(s) {
  let ndvi = (s.B08 - s.B04) / (s.B08 + s.B04 + 1e-10);
  return { ndvi: [ndvi], dataMask: [s.dataMask] };
}""",
            "width": w_pixels,
            "height": h_pixels,
        }
    }

    raw = _copernicus_request(COPERNICUS_STATS_URL, payload, user_id,
                              accept="application/json")

    results = []
    for entry in raw.get("data", []):
        interval_data = entry.get("outputs", {}).get("ndvi", {}).get("bands", {}).get("B0", {})
        stats = interval_data.get("stats", {})
        mean_val = stats.get("mean")
        if mean_val is not None:
            date_str = entry.get("interval", {}).get("from", "")[:10]
            results.append({"date": date_str, "mean_ndvi": round(mean_val, 4)})
    return results


def _clip_bbox(bbox):
    """BBox auf max 2°×2° zuschneiden."""
    MAX_SPAN = 2.0
    lon_span = abs(bbox[2] - bbox[0])
    lat_span = abs(bbox[3] - bbox[1])
    cropped = False
    if lon_span > MAX_SPAN or lat_span > MAX_SPAN:
        cx = (bbox[0] + bbox[2]) / 2
        cy = (bbox[1] + bbox[3]) / 2
        half = MAX_SPAN / 2
        bbox = [cx - half, cy - half, cx + half, cy + half]
        cropped = True
    return bbox, cropped


def fetch_sentinel_ndvi_image(bbox, date_from, date_to, width=512,
                               height=512, user_id=None):
    """
    Farbcodiertes NDVI-Bild als PNG.
    Grün = hoher NDVI, Gelb = mittel, Rot = niedrig, Transparent = kein Wert.
    Gibt (PNG-Bytes, bbox, cropped) zurück.
    """
    from transport import COPERNICUS_PROCESS_URL, _copernicus_request

    bbox, cropped = _clip_bbox(bbox)
    width = min(width, 1024)
    height = min(height, 1024)

    payload = {
        "input": {
            "bounds": {
                "bbox": bbox,
                "properties": {"crs": "http://www.opengis.net/def/crs/OGC/1.3/CRS84"}
            },
            "data": [{
                "type": "sentinel-2-l2a",
                "dataFilter": {
                    "timeRange": {
                        "from": date_from + "T00:00:00Z",
                        "to":   date_to   + "T23:59:59Z",
                    },
                    "maxCloudCoverage": 50,
                    "mosaickingOrder": "leastCC",
                }
            }]
        },
        "output": {
            "width": width, "height": height,
            "responses": [{"identifier": "default",
                           "format": {"type": "image/png"}}]
        },
        "evalscript": """//VERSION=3
function setup() {
  return {
    input: ["B04","B08","dataMask"],
    output: { bands: 4, sampleType: "AUTO" }
  };
}
function evaluatePixel(s) {
  if (s.dataMask === 0) return [0, 0, 0, 0];
  let ndvi = (s.B08 - s.B04) / (s.B08 + s.B04 + 1e-10);
  // Farbcodierung: rot (-1..0) → gelb (0..0.3) → grün (0.3..1)
  let r, g, b;
  if (ndvi < 0) { r = 0.8; g = 0.1; b = 0.1; }
  else if (ndvi < 0.15) { r = 0.9; g = 0.3; b = 0.1; }
  else if (ndvi < 0.3) { r = 0.9; g = 0.7; b = 0.1; }
  else if (ndvi < 0.5) { r = 0.5; g = 0.8; b = 0.2; }
  else if (ndvi < 0.7) { r = 0.1; g = 0.7; b = 0.1; }
  else { r = 0.0; g = 0.5; b = 0.0; }
  return [r, g, b, 0.85];
}"""
    }
    png = _copernicus_request(COPERNICUS_PROCESS_URL, payload, user_id,
                              accept="image/png")
    return png, bbox, cropped


def fetch_sentinel_ndvi_change(bbox, user_id=None, days_back=30):
    """
    Change-Detection: Vergleicht aktuellen NDVI mit dem Zustand vor N Tagen.
    Gibt ein farbcodiertes PNG zurück:
      Rot = starker Rückgang (Abholzung, Brand, Dürre)
      Transparent = keine signifikante Änderung
      Blau = starke Zunahme
    Sowie Hotspot-Statistiken.
    """
    from datetime import datetime as _dt, timedelta as _td
    from transport import COPERNICUS_PROCESS_URL, _copernicus_request

    bbox, cropped = _clip_bbox(bbox)

    now = _dt.utcnow()
    # Aktueller Zeitraum: letzte 14 Tage
    cur_to = now.strftime("%Y-%m-%d")
    cur_from = (now - _td(days=14)).strftime("%Y-%m-%d")
    # Vergleichszeitraum: N Tage zurück, 14-Tage-Fenster
    ref_to = (now - _td(days=days_back)).strftime("%Y-%m-%d")
    ref_from = (now - _td(days=days_back + 14)).strftime("%Y-%m-%d")

    width = min(512, 512)
    height = min(512, 512)

    # Evalscript: Zwei Datensätze (aktuell + Referenz), Differenz berechnen
    # Sentinel Hub unterstützt keine Multi-Temporal-Differenz in einem Call,
    # daher zwei separate Requests
    def _fetch_ndvi_raw(d_from, d_to):
        payload = {
            "input": {
                "bounds": {
                    "bbox": bbox,
                    "properties": {
                        "crs": "http://www.opengis.net/def/crs/OGC/1.3/CRS84"}
                },
                "data": [{
                    "type": "sentinel-2-l2a",
                    "dataFilter": {
                        "timeRange": {
                            "from": d_from + "T00:00:00Z",
                            "to":   d_to   + "T23:59:59Z",
                        },
                        "maxCloudCoverage": 50,
                        "mosaickingOrder": "leastCC",
                    }
                }]
            },
            "output": {
                "width": width, "height": height,
                "responses": [{"identifier": "default",
                               "format": {"type": "image/png"}}]
            },
            "evalscript": """//VERSION=3
function setup() {
  return {
    input: ["B04","B08","dataMask"],
    output: { bands: 4, sampleType: "UINT8" }
  };
}
function evaluatePixel(s) {
  if (s.dataMask === 0) return [0, 0, 0, 0];
  let ndvi = (s.B08 - s.B04) / (s.B08 + s.B04 + 1e-10);
  // NDVI als Grauwert kodieren: 0..255 = -1..+1
  let v = Math.round((ndvi + 1) * 0.5 * 255);
  return [v, v, v, 255];
}"""
        }
        return _copernicus_request(COPERNICUS_PROCESS_URL, payload,
                                   user_id, accept="image/png")

    try:
        from PIL import Image
        import io
        import numpy as np

        png_cur = _fetch_ndvi_raw(cur_from, cur_to)
        png_ref = _fetch_ndvi_raw(ref_from, ref_to)

        img_cur = np.array(Image.open(io.BytesIO(png_cur)).convert("RGBA"),
                           dtype=np.float32)
        img_ref = np.array(Image.open(io.BytesIO(png_ref)).convert("RGBA"),
                           dtype=np.float32)

        # NDVI aus Grauwert: (v/255)*2 - 1
        ndvi_cur = (img_cur[:, :, 0] / 255.0) * 2 - 1
        ndvi_ref = (img_ref[:, :, 0] / 255.0) * 2 - 1
        alpha_cur = img_cur[:, :, 3] / 255.0
        alpha_ref = img_ref[:, :, 3] / 255.0

        # Differenz
        diff = ndvi_cur - ndvi_ref
        valid = (alpha_cur > 0.5) & (alpha_ref > 0.5)

        # Farbcodierung der Differenz
        out = np.zeros((*diff.shape, 4), dtype=np.uint8)
        for y in range(diff.shape[0]):
            for x in range(diff.shape[1]):
                if not valid[y, x]:
                    continue
                d = diff[y, x]
                if d < -0.15:  # starker Rückgang → rot
                    intensity = min(1.0, abs(d) / 0.4)
                    out[y, x] = [int(220 * intensity), 30, 30,
                                 int(200 * intensity)]
                elif d < -0.05:  # leichter Rückgang → orange
                    intensity = min(1.0, abs(d) / 0.2)
                    out[y, x] = [int(240 * intensity),
                                 int(160 * intensity), 30,
                                 int(150 * intensity)]
                elif d > 0.15:  # starke Zunahme → blau
                    intensity = min(1.0, d / 0.4)
                    out[y, x] = [30, 30, int(220 * intensity),
                                 int(180 * intensity)]
                elif d > 0.05:  # leichte Zunahme → hellblau
                    intensity = min(1.0, d / 0.2)
                    out[y, x] = [30, int(150 * intensity),
                                 int(200 * intensity),
                                 int(120 * intensity)]
                # else: transparent (keine signifikante Änderung)

        # Hotspot-Statistiken
        decline_strong = np.sum((diff < -0.15) & valid)
        decline_moderate = np.sum((diff >= -0.15) & (diff < -0.05) & valid)
        increase_strong = np.sum((diff > 0.15) & valid)
        increase_moderate = np.sum((diff >= 0.05) & (diff <= 0.15) & valid)
        total_valid = np.sum(valid)
        mean_change = float(np.mean(diff[valid])) if total_valid > 0 else 0

        # PNG erzeugen
        change_img = Image.fromarray(out, "RGBA")
        buf = io.BytesIO()
        change_img.save(buf, format="PNG")
        change_png = buf.getvalue()

        hotspots = {
            "decline_strong": int(decline_strong),
            "decline_moderate": int(decline_moderate),
            "increase_strong": int(increase_strong),
            "increase_moderate": int(increase_moderate),
            "total_pixels": int(total_valid),
            "mean_change": round(mean_change, 4),
            "decline_pct": round(
                (decline_strong + decline_moderate) / max(1, total_valid) * 100, 1),
            "increase_pct": round(
                (increase_strong + increase_moderate) / max(1, total_valid) * 100, 1),
            "period_current": f"{cur_from} – {cur_to}",
            "period_reference": f"{ref_from} – {ref_to}",
        }

        return change_png, bbox, cropped, hotspots

    except ImportError:
        log.warning("PIL/numpy nicht verfügbar – Change-Detection deaktiviert")
        return None, bbox, cropped, {}
    except Exception as e:
        log.warning("NDVI Change-Detection Fehler: %s", e)
        return None, bbox, cropped, {"error": str(e)}
