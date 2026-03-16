"""Radiation Monitoring Watch Zone Plugin — BfS ODL + EURDEP."""

import logging
from datetime import datetime, timezone

from flask import jsonify
from plugins import PluginManager
from plugins.watchzone import WatchZonePlugin

log = logging.getLogger(__name__)

UA = "VeriTrend.ai/1.0 (forensic trend analysis; contact@veritrend.ai)"
BFS_WFS = "https://www.imis.bfs.de/ogc/opendata/ows"

# Normal background gamma range (µSv/h) — above 0.3 is elevated
NORMAL_MAX = 0.3

def _wfs_params(type_name, bbox=None, max_features=500, cql=None):
    """Build WFS GetFeature params."""
    p = {
        "service": "WFS", "version": "1.1.0", "request": "GetFeature",
        "typeName": type_name, "outputFormat": "application/json",
        "maxFeatures": str(max_features),
    }
    if bbox:
        # bbox = (min_lon, min_lat, max_lon, max_lat)
        # BfS WFS expects lon,lat order despite WFS 1.1 spec
        p["bbox"] = f"{bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]},EPSG:4326"
    if cql:
        p["CQL_FILTER"] = cql
    return p

def _fetch_latest(bbox, source="odl"):
    """Fetch latest gamma dose rate for stations in bbox."""
    import requests as _rq

    type_name = "opendata:odlinfo_odl_1h_latest" if source == "odl" else "opendata:eurdep_latestValue"
    params = _wfs_params(type_name, bbox=bbox, max_features=500)

    try:
        r = _rq.get(BFS_WFS, params=params, headers={"User-Agent": UA}, timeout=20)
        r.raise_for_status()
        data = r.json()
    except Exception as exc:
        return {"error": str(exc)[:200]}

    features = data.get("features", [])
    stations = []
    elevated = []

    for f in features:
        p = f.get("properties", {})
        geom = f.get("geometry", {})
        coords = geom.get("coordinates", [None, None]) if geom else [None, None]

        value = p.get("value")
        station = {
            "id": p.get("id") or p.get("kenn", ""),
            "kenn": p.get("kenn", ""),
            "name": p.get("name", ""),
            "lat": coords[1] if len(coords) >= 2 else None,
            "lon": coords[0] if len(coords) >= 2 else None,
            "value": value,
            "unit": p.get("unit", "µSv/h"),
            "start": (p.get("start_measure") or "")[:19],
            "end": (p.get("end_measure") or "")[:19],
            "status": p.get("site_status_text", ""),
            "height": p.get("height_above_sea"),
            "validated": p.get("validated", 0),
        }
        stations.append(station)
        if value is not None and value > NORMAL_MAX:
            elevated.append(station)

    stations.sort(key=lambda s: -(s.get("value") or 0))

    return {
        "source": source,
        "count": len(stations),
        "elevated_count": len(elevated),
        "stations": stations,
        "elevated": elevated,
    }

def _fetch_timeseries(kenn, hours="24h"):
    """Fetch time series for a single station by kenn.

    hours='1h' → ~7 days of hourly data (odlinfo_timeseries_odl_1h)
    hours='24h' → ~180 days of daily averages (odlinfo_timeseries_odl_24h)
    """
    import requests as _rq

    type_name = "opendata:odlinfo_timeseries_odl_1h" if hours == "1h" else "opendata:odlinfo_timeseries_odl_24h"
    cql = f"kenn='{kenn}'"
    max_feat = 1000 if hours == "1h" else 5000
    params = _wfs_params(type_name, cql=cql, max_features=max_feat)

    try:
        r = _rq.get(BFS_WFS, params=params, headers={"User-Agent": UA}, timeout=20)
        r.raise_for_status()
        data = r.json()
    except Exception as exc:
        return {"kenn": kenn, "error": str(exc)[:200]}

    features = data.get("features", [])
    series = []
    name = ""
    for f in features:
        p = f.get("properties", {})
        if not name:
            name = p.get("name", "")
        series.append({
            "time": (p.get("end_measure") or "")[:19],
            "value": p.get("value"),
            "unit": p.get("unit", "µSv/h"),
        })

    series.sort(key=lambda s: s["time"])

    return {
        "kenn": kenn,
        "name": name,
        "count": len(series),
        "series": series,
    }

def _fetch_batch_timeseries(bbox, hours="1h"):
    """Fetch timeseries for ALL stations in bbox at once via WFS bbox filter.

    hours='1h'  → odlinfo_timeseries_odl_1h  (~7 days, hourly)
    hours='24h' → odlinfo_timeseries_odl_24h (~180 days, daily)
    Returns dict keyed by kenn: {kenn: {name, lat, lon, series: [{time, value}]}}
    """
    import requests as _rq

    type_name = ("opendata:odlinfo_timeseries_odl_1h" if hours == "1h"
                 else "opendata:odlinfo_timeseries_odl_24h")
    max_feat = 5000 if hours == "1h" else 20000
    params = _wfs_params(type_name, bbox=bbox, max_features=max_feat)

    try:
        r = _rq.get(BFS_WFS, params=params, headers={"User-Agent": UA}, timeout=30)
        r.raise_for_status()
        data = r.json()
    except Exception as exc:
        return {"error": str(exc)[:200]}

    stations = {}
    for f in data.get("features", []):
        p = f.get("properties", {})
        geom = f.get("geometry", {})
        coords = geom.get("coordinates", [None, None]) if geom else [None, None]
        kenn = p.get("kenn", "")
        if not kenn:
            continue
        if kenn not in stations:
            stations[kenn] = {
                "kenn": kenn,
                "name": p.get("name", ""),
                "lat": coords[1] if coords and len(coords) >= 2 else None,
                "lon": coords[0] if coords and len(coords) >= 2 else None,
                "series": [],
            }
        stations[kenn]["series"].append({
            "time": (p.get("end_measure") or "")[:19],
            "value": p.get("value"),
        })

    # Sort series by time
    for st in stations.values():
        st["series"].sort(key=lambda s: s["time"])

    return stations


def _fetch_eurdep_trend(bbox):
    """Fetch EURDEP data for all aggregation windows (6h,12h,24h,48h,72h).

    Returns dict keyed by station id:
    {id: {name, lat, lon, trend: [{window_h, value, start, end}]}}
    """
    import requests as _rq

    stations = {}
    for typ in ("eurdep_latestValue", "eurdep_maxValue"):
        params = _wfs_params(f"opendata:{typ}", bbox=bbox, max_features=2000)
        try:
            r = _rq.get(BFS_WFS, params=params, headers={"User-Agent": UA}, timeout=25)
            r.raise_for_status()
            data = r.json()
        except Exception:
            continue

        for f in data.get("features", []):
            p = f.get("properties", {})
            geom = f.get("geometry", {})
            coords = geom.get("coordinates", [None, None]) if geom else [None, None]
            sid = p.get("id", "")
            if not sid:
                continue
            window_h = p.get("analyzed_range_in_h", 0)
            if not window_h:
                continue

            if sid not in stations:
                stations[sid] = {
                    "id": sid,
                    "name": p.get("name", ""),
                    "lat": coords[1] if coords and len(coords) >= 2 else None,
                    "lon": coords[0] if coords and len(coords) >= 2 else None,
                    "trend": [],
                }
            stations[sid]["trend"].append({
                "window_h": window_h,
                "value": p.get("value"),
                "start": (p.get("start_measure") or "")[:19],
                "end": (p.get("end_measure") or "")[:19],
                "type": typ.replace("eurdep_", ""),
            })

    # Sort trend by window_h
    for st in stations.values():
        st["trend"].sort(key=lambda t: t["window_h"])

    return stations


class RadiationPlugin(WatchZonePlugin):
    plugin_id = "radiation"

    meta = {
        "label": "Radioaktivit\u00e4t",
        "icon_svg": (
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" '
            'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
            '<circle cx="12" cy="12" r="2"/>'
            '<path d="M12 2v4"/><path d="M12 18v4"/>'
            '<path d="M4.93 4.93l2.83 2.83"/><path d="M16.24 16.24l2.83 2.83"/>'
            '<path d="M2 12h4"/><path d="M18 12h4"/>'
            '<path d="M4.93 19.07l2.83-2.83"/><path d="M16.24 7.76l2.83-2.83"/>'
            '</svg>'
        ),
        "color": "#eab308",
        "description": "Radioaktivit\u00e4tsmessung via BfS ODL + EURDEP",
        "category": "geo",
        "required_credentials": [],
        "has_live": True,
        "has_history": True,
        "panel_template": "radiation/_panel.html",
        "js_file": "/plugins/watchzone/radiation/static/radiation.js",

    }

    def live_handler(self, zone, config, geo, bbox, user_id):
        if not bbox:
            return {"error": "Zone hat keine gueltige Geometrie"}

        source = config.get("source", "auto")

        # Auto-detect: if bbox is within Germany, use ODL; otherwise EURDEP
        if source == "auto":
            min_lon, min_lat, max_lon, max_lat = bbox
            in_germany = (min_lat >= 47.0 and max_lat <= 55.5
                          and min_lon >= 5.5 and max_lon <= 15.5)
            source = "odl" if in_germany else "eurdep"

        result = _fetch_latest(bbox, source=source)
        if "error" in result:
            return {"error": result["error"]}

        return {
            "zone_id": zone.id, "zone_name": zone.name,
            "zone_type": "radiation",
            "count": result["count"],
            "elevated_count": result["elevated_count"],
            "source": result["source"],
            "stations": result["stations"],
            "elevated": result["elevated"],
        }

    def history_routes(self):
        return [
            {"suffix": "radiation-timeseries", "handler": self._timeseries_handler},
            {"suffix": "radiation-batch-ts", "handler": self._batch_ts_handler},
        ]

    def _batch_ts_handler(self, zone, args, user_id):
        import json as _j
        from plugins.watchzone._helpers import geojson_to_bbox

        geo = _j.loads(zone.geometry) if zone.geometry else {}
        bbox = geojson_to_bbox(geo)
        if not bbox:
            return jsonify({"error": "Zone hat keine gueltige Geometrie"}), 400

        hours = args.get("hours", "1h")
        if hours not in ("1h", "24h"):
            hours = "1h"

        # Auto-detect source like live_handler
        cfg = _j.loads(zone.config) if zone.config else {}
        source = cfg.get("source", "auto")
        if source == "auto":
            min_lon, min_lat, max_lon, max_lat = bbox
            in_germany = (min_lat >= 47.0 and max_lat <= 55.5
                          and min_lon >= 5.5 and max_lon <= 15.5)
            source = "odl" if in_germany else "eurdep"

        if source != "odl":
            # EURDEP: Trend-Daten (6h→72h Aggregationsfenster)
            trend_data = _fetch_eurdep_trend(bbox)
            return jsonify({
                "zone_id": zone.id, "zone_name": zone.name,
                "hours": hours, "source": "eurdep",
                "station_count": len(trend_data),
                "stations": trend_data,
                "mode": "trend",
            })

        result = _fetch_batch_timeseries(bbox, hours=hours)
        if isinstance(result, dict) and "error" in result:
            return jsonify(result), 502

        return jsonify({
            "zone_id": zone.id,
            "zone_name": zone.name,
            "hours": hours,
            "station_count": len(result),
            "stations": result,
        })

    def _timeseries_handler(self, zone, args, user_id):
        import json as _j
        from plugins.watchzone._helpers import geojson_to_bbox

        kenn = args.get("kenn", "")
        hours = args.get("hours", "24h")
        if hours not in ("1h", "24h"):
            hours = "24h"

        # Build candidate list: requested kenn first, then ODL stations in zone
        candidates = []
        if kenn:
            candidates.append(kenn)

        geo = _j.loads(zone.geometry) if zone.geometry else {}
        bbox = geojson_to_bbox(geo)

        # Always fetch ODL stations in zone to have numeric-kenn fallbacks
        if bbox:
            live = _fetch_latest(bbox, source="odl")
            for s in live.get("stations", []):
                sk = s.get("kenn", "")
                if sk and sk not in candidates and sk.isdigit():
                    candidates.append(sk)

        # If no ODL stations in zone (e.g. zone outside Germany), use
        # Germany-wide bbox as fallback to find any ODL station with data
        if not any(c.isdigit() for c in candidates):
            de_live = _fetch_latest((5.5, 47.0, 15.5, 55.5), source="odl")
            for s in de_live.get("stations", []):
                sk = s.get("kenn", "")
                if sk and sk not in candidates and sk.isdigit():
                    candidates.append(sk)
                    if len(candidates) >= 5:
                        break

        # Try each candidate until we get data
        for c in candidates:
            result = _fetch_timeseries(c, hours=hours)
            if result.get("count", 0) > 0:
                return jsonify({"zone_id": zone.id, "zone_name": zone.name, **result})

        # No data found — return empty result with hint
        return jsonify({
            "zone_id": zone.id, "zone_name": zone.name,
            "kenn": kenn, "name": "", "count": 0, "series": [],
        })

    def ai_tools(self):
        return [{
            "name": "get_radiation_data",
            "description": "Ruft aktuelle Gamma-Dosisleistungsdaten fuer eine Watch Zone ab (BfS ODL / EURDEP).",
            "input_schema": {
                "type": "object",
                "properties": {
                    "zone_id": {"type": "integer", "description": "ID der Watch Zone"},
                    "source": {"type": "string", "enum": ["odl", "eurdep", "auto"],
                               "description": "Datenquelle (Standard: auto)"},
                },
                "required": ["zone_id"],
            },
        }]

    def ai_tool_handler(self, tool_name, inputs, user_id):
        if tool_name != "get_radiation_data":
            return {"error": f"Unbekanntes Tool: {tool_name}"}
        import json as _j
        from models import WatchZone
        from plugins.watchzone._helpers import geojson_to_bbox
        z = WatchZone.query.filter_by(id=inputs["zone_id"], user_id=user_id).first()
        if not z:
            return {"error": f"Zone {inputs['zone_id']} nicht gefunden"}
        geo = _j.loads(z.geometry) if z.geometry else {}
        bbox = geojson_to_bbox(geo)
        if not bbox:
            return {"error": "Zone hat keine gueltige Geometrie"}
        source = inputs.get("source", "auto")
        cfg = _j.loads(z.config) if z.config else {}
        if source == "auto":
            source = cfg.get("source", "auto")
        if source == "auto":
            min_lon, min_lat, max_lon, max_lat = bbox
            source = "odl" if (min_lat >= 47 and max_lat <= 55.5
                               and min_lon >= 5.5 and max_lon <= 15.5) else "eurdep"
        result = _fetch_latest(bbox, source=source)
        if "error" in result:
            return {"error": result["error"]}
        # Summarize for AI
        vals = [s["value"] for s in result["stations"] if s["value"] is not None]
        summary = {
            "zone_id": z.id, "source": source,
            "station_count": result["count"],
            "elevated_count": result["elevated_count"],
            "avg_uSv_h": round(sum(vals) / len(vals), 4) if vals else None,
            "max_uSv_h": round(max(vals), 4) if vals else None,
            "elevated_stations": result["elevated"][:10],
            "sample": result["stations"][:20],
        }
        return summary

    def analysis_provider(self):
        return {"data_types": ["radiation"], "history_endpoint_suffix": "radiation-timeseries"}

PluginManager.register(RadiationPlugin())
