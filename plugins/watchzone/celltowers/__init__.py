"""Cell Tower Watch Zone Plugin — OpenCelliD."""

import logging
from datetime import datetime, timezone

from flask import jsonify
from plugins import PluginManager
from plugins.watchzone import WatchZonePlugin
from plugins.watchzone._helpers import geojson_to_bbox

log = logging.getLogger(__name__)

UA = "VeriTrend.ai/1.0 (forensic trend analysis; contact@veritrend.ai)"
OCID_AREA = "https://opencellid.org/cell/getInArea"
OCID_COUNT = "https://opencellid.org/cell/getInAreaSize"

RADIO_COLORS = {
    "LTE":   "#3b82f6",
    "UMTS":  "#22c55e",
    "GSM":   "#eab308",
    "NR":    "#8b5cf6",
    "CDMA":  "#f59e0b",
    "NBIOT": "#06b6d4",
}

def _get_ocid_key(user_id=None):
    from transport import _get_credential
    return _get_credential("opencellid_api_key", "OPENCELLID_API_KEY", user_id)

def _fetch_cells_in_area(bbox, api_key, radio=None, limit=50, offset=0):
    """Fetch cell towers in bounding box from OpenCelliD.

    bbox = (min_lon, min_lat, max_lon, max_lat)
    Returns list of cell dicts.
    """
    import requests as _rq

    # OpenCelliD BBOX format: latmin,lonmin,latmax,lonmax
    bbox_str = f"{bbox[1]},{bbox[0]},{bbox[3]},{bbox[2]}"

    params = {
        "key": api_key,
        "BBOX": bbox_str,
        "format": "json",
        "limit": str(limit),
        "offset": str(offset),
    }
    if radio:
        params["radio"] = radio

    try:
        r = _rq.get(OCID_AREA, params=params, headers={"User-Agent": UA}, timeout=15)
        r.raise_for_status()
        data = r.json()
    except Exception as exc:
        log.warning("OpenCelliD API error: %s", exc)
        return {"error": str(exc)[:200]}

    cells_raw = data.get("cells", [])
    cells = []
    for c in cells_raw:
        cells.append({
            "lat": _safe_float(c.get("lat")),
            "lon": _safe_float(c.get("lon")),
            "radio": c.get("radio", ""),
            "mcc": c.get("mcc"),
            "mnc": c.get("mnc"),
            "lac": c.get("lac"),
            "cellid": c.get("cellid"),
            "range": c.get("range", 0),
            "samples": c.get("samples", 0),
            "changeable": c.get("changeable", 0),
            "created": c.get("created"),
            "updated": c.get("updated"),
            "averageSignal": c.get("averageSignal"),
        })

    return {"cells": cells, "count": data.get("count", len(cells))}

def _fetch_cell_count(bbox, api_key, radio=None):
    """Fetch cell tower count in bounding box (costs 2 credits)."""
    import requests as _rq

    bbox_str = f"{bbox[1]},{bbox[0]},{bbox[3]},{bbox[2]}"
    params = {"key": api_key, "BBOX": bbox_str, "format": "json"}
    if radio:
        params["radio"] = radio

    try:
        r = _rq.get(OCID_COUNT, params=params, headers={"User-Agent": UA}, timeout=15)
        r.raise_for_status()
        data = r.json()
        return data.get("count", 0)
    except Exception as exc:
        log.warning("OpenCelliD count error: %s", exc)
        return 0

def _fetch_all_pages(bbox, api_key, radio=None, max_pages=6):
    """Fetch multiple pages to get up to 300 cells."""
    all_cells = []
    total = 0
    for page in range(max_pages):
        result = _fetch_cells_in_area(bbox, api_key, radio=radio, limit=50, offset=page * 50)
        if isinstance(result, dict) and "error" in result:
            return result
        cells = result.get("cells", [])
        total = result.get("count", total)
        all_cells.extend(cells)
        if len(cells) < 50:
            break
    return {"cells": all_cells, "count": total}

def _safe_float(v):
    try:
        return float(v) if v is not None else None
    except (ValueError, TypeError):
        return None

class CellTowerPlugin(WatchZonePlugin):
    plugin_id = "celltowers"

    meta = {
        "label": "Mobilfunk",
        "icon_svg": (
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" '
            'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
            '<path d="M2 20h20"/>'
            '<path d="M12 4v16"/>'
            '<path d="M8 8l4-4 4 4"/>'
            '<path d="M6 12l6-4 6 4"/>'
            '<path d="M4 16l8-4 8 4"/>'
            '</svg>'
        ),
        "color": "#3b82f6",
        "description": "Mobilfunk-Sendemasten via OpenCelliD",
        "category": "geo",
        "required_credentials": ["opencellid_api_key"],
        "has_live": True,
        "has_history": False,
        "panel_template": "celltowers/_panel.html",
        "js_file": "/plugins/watchzone/celltowers/static/celltowers.js",

    }

    def live_handler(self, zone, config, geo, bbox, user_id):
        if not bbox:
            return {"error": "Zone hat keine gueltige Geometrie"}

        api_key = _get_ocid_key(user_id)
        if not api_key:
            return {"error": "OpenCelliD API-Key fehlt. Bitte unter Plugins eintragen."}

        result = _fetch_all_pages(bbox, api_key, max_pages=6)
        if isinstance(result, dict) and "error" in result:
            return result

        cells = result.get("cells", [])
        total_in_zone = result.get("count", len(cells))

        # Aggregate by radio type
        radio_counts = {}
        total_samples = 0
        for c in cells:
            r = c.get("radio") or "Unknown"
            radio_counts[r] = radio_counts.get(r, 0) + 1
            total_samples += c.get("samples") or 0

        # Sort by samples descending (most-reported towers first)
        cells.sort(key=lambda c: -(c.get("samples") or 0))

        return {
            "zone_id": zone.id,
            "zone_name": zone.name,
            "zone_type": "celltowers",
            "count": len(cells),
            "total_in_zone": total_in_zone,
            "radio_counts": radio_counts,
            "total_samples": total_samples,
            "items": cells[:200],
        }

    def ai_tools(self):
        return [{
            "name": "get_celltower_data",
            "description": "Ruft Mobilfunk-Sendemasten-Daten (OpenCelliD) fuer eine Watch Zone ab.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "zone_id": {"type": "integer", "description": "ID der Watch Zone"},
                },
                "required": ["zone_id"],
            },
        }]

    def ai_tool_handler(self, tool_name, inputs, user_id):
        if tool_name != "get_celltower_data":
            return {"error": f"Unbekanntes Tool: {tool_name}"}
        import json as _j
        from models import WatchZone
        z = WatchZone.query.filter_by(id=inputs["zone_id"], user_id=user_id).first()
        if not z:
            return {"error": f"Zone {inputs['zone_id']} nicht gefunden"}
        geo = _j.loads(z.geometry) if z.geometry else {}
        bbox = geojson_to_bbox(geo)
        if not bbox:
            return {"error": "Zone hat keine gueltige Geometrie"}
        result = self.live_handler(z, _j.loads(z.config) if z.config else {}, geo, bbox, user_id)
        if "error" in result:
            return result
        return {
            "zone_id": z.id,
            "cell_count": result["count"],
            "total_in_zone": result["total_in_zone"],
            "radio_counts": result["radio_counts"],
            "total_samples": result["total_samples"],
            "cells": result["items"][:30],
        }

PluginManager.register(CellTowerPlugin())
