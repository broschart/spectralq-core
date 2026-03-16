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
