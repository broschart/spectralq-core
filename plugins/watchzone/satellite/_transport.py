"""Satellite transport layer — Copernicus Sentinel-2 True-Color."""

import logging

log = logging.getLogger(__name__)


def fetch_sentinel_image(bbox, date_from, date_to, width=512, height=512,
                         user_id=None):
    """
    Ruft ein True-Color Sentinel-2 Bild für eine Bounding-Box ab.
    bbox: [lon_min, lat_min, lon_max, lat_max] (WGS84/CRS84)
    Passt Auflösung automatisch an Regionsgröße an.
    Gibt (PNG-Bytes, bbox, cropped) zurück.
    """
    from transport import COPERNICUS_PROCESS_URL, _copernicus_request

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
    width  = min(width,  1024)
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
                    "maxCloudCoverage": 80,
                    "mosaickingOrder": "leastCC",
                }
            }]
        },
        "output": {
            "width": width,
            "height": height,
            "responses": [{"identifier": "default", "format": {"type": "image/png"}}]
        },
        "evalscript": """//VERSION=3
function setup() {
  return {
    input: ["B02","B03","B04","SCL","dataMask"],
    output: { bands: 4, sampleType: "AUTO" }
  };
}
function evaluatePixel(s) {
  // SCL: 0=nodata, 3=cloud shadow, 8=cloud medium, 9=cloud high, 10=cirrus
  var scl = s.SCL;
  if (s.dataMask === 0 || scl === 0) return [0, 0, 0, 0];
  var gain = 3.0;
  var r = gain * s.B04;
  var g = gain * s.B03;
  var b = gain * s.B02;
  // Clamp to [0,1]
  r = r > 1 ? 1 : r;
  g = g > 1 ? 1 : g;
  b = b > 1 ? 1 : b;
  return [r, g, b, 1];
}"""
    }
    png = _copernicus_request(COPERNICUS_PROCESS_URL, payload, user_id,
                              accept="image/png")
    return png, bbox, cropped
