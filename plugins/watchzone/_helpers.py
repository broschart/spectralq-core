"""
Shared Helpers fuer Watch-Zone-Plugins.
"""

import json as _json


def parse_zone_data(zone):
    """Parsed geometry und config einer WatchZone-Instanz.

    Returns:
        (config_dict, geo_dict, bbox_or_none)
    """
    geo = _json.loads(zone.geometry) if zone.geometry else {}
    config = _json.loads(zone.config) if zone.config else {}
    bbox = geojson_to_bbox(geo)
    return config, geo, bbox


def geojson_to_bbox(geo):
    """Berechnet [lon_min, lat_min, lon_max, lat_max] aus einer GeoJSON-Geometrie.

    Identisch mit app.py:_geojson_to_bbox — wird schrittweise hierher migriert.
    """
    coords = []

    def _extract(obj):
        if isinstance(obj, list):
            if len(obj) >= 2 and isinstance(obj[0], (int, float)):
                coords.append(obj)
            else:
                for item in obj:
                    _extract(item)

    _extract(geo.get("coordinates", []))
    if not coords:
        return None
    lons = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    return [min(lons), min(lats), max(lons), max(lats)]


def geo_center(geo):
    """Berechnet den Mittelpunkt einer GeoJSON-Geometrie als (lat, lon)."""
    bbox = geojson_to_bbox(geo)
    if not bbox:
        return None, None
    lat = (bbox[1] + bbox[3]) / 2
    lon = (bbox[0] + bbox[2]) / 2
    return lat, lon
