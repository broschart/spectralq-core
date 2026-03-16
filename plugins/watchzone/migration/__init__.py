"""Migration & Displacement Watch Zone Plugin — UNHCR Refugee Statistics API."""

import logging
from datetime import datetime, timezone

from flask import jsonify
from plugins import PluginManager
from plugins.watchzone import WatchZonePlugin
from plugins.watchzone._helpers import geojson_to_bbox

log = logging.getLogger(__name__)

UA = "VeriTrend.ai/1.0 (forensic trend analysis; contact@veritrend.ai)"
UNHCR_API = "https://api.unhcr.org/population/v1"

# Rough bbox → ISO3 country mapping for major countries
# bbox = (lat_min, lon_min, lat_max, lon_max), UNHCR-code, display-name
COUNTRY_BOXES = [
    ((47, 5, 55, 15), "GFR", "Germany"),
    ((42, -5, 51, 10), "FRA", "France"),
    ((36, -10, 44, 4), "SPA", "Spain"),
    ((36, 6, 47, 19), "ITA", "Italy"),
    ((49, 14, 55, 24), "POL", "Poland"),
    ((46, 9, 49, 17), "AUS", "Austria"),
    ((45, 5, 48, 11), "SWI", "Switzerland"),
    ((50, -8, 59, 2), "GBR", "United Kingdom"),
    ((54, 8, 58, 16), "DEN", "Denmark"),
    ((55, 11, 69, 24), "SWE", "Sweden"),
    ((58, 4, 71, 31), "NOR", "Norway"),
    ((50, 3, 54, 8), "NET", "Netherlands"),
    ((49, 2, 52, 7), "BEL", "Belgium"),
    ((35, 19, 42, 30), "GRE", "Greece"),
    ((45, 16, 49, 23), "HUN", "Hungary"),
    ((43, 22, 48, 30), "ROM", "Romania"),
    ((41, 22, 44, 29), "BUL", "Bulgaria"),
    ((44, 22, 53, 41), "UKR", "Ukraine"),
    ((35, 25, 42, 45), "TUR", "Turkiye"),
    ((29, 34, 33, 36), "JOR", "Jordan"),
    ((33, 35, 35, 37), "LEB", "Lebanon"),
    ((32, 34, 38, 43), "IRQ", "Iraq"),
    ((32, 35, 37, 42), "SYR", "Syria"),
    ((25, 43, 37, 60), "IRN", "Iran"),
    ((29, 56, 40, 76), "PAK", "Pakistan"),
    ((-5, 28, 5, 41), "COD", "DR Congo"),
    ((3, 25, 22, 37), "SUD", "Sudan"),
    ((-2, 29, 4, 35), "UGA", "Uganda"),
    ((-5, 36, 5, 48), "KEN", "Kenya"),
    ((-12, 23, -1, 31), "ZAM", "Zambia"),
    ((3, 23, 15, 36), "CHD", "Chad"),
    ((-5, 8, 12, 15), "NIG", "Nigeria"),
    ((4, 33, 15, 48), "ETH", "Ethiopia"),
    ((0, 41, 12, 52), "SOM", "Somalia"),
    ((-4, -74, 13, -60), "COL", "Colombia"),
    ((1, -80, 6, -67), "VEN", "Venezuela"),
    ((24, -106, 32, -86), "MEX", "Mexico"),
    ((29, 46, 49, 63), "AFG", "Afghanistan"),
    ((-7, 94, 21, 102), "MYA", "Myanmar"),
]

def _find_countries_for_bbox(bbox):
    """Find countries whose rough bbox overlaps with the given bbox."""
    min_lon, min_lat, max_lon, max_lat = bbox
    matches = []
    for (b_lat_min, b_lon_min, b_lat_max, b_lon_max), iso3, name in COUNTRY_BOXES:
        # Check overlap
        if (min_lat <= b_lat_max and max_lat >= b_lat_min and
                min_lon <= b_lon_max and max_lon >= b_lon_min):
            matches.append({"iso3": iso3, "name": name})
    return matches

def _fetch_population(country_code, year_from=None, year_to=None, as_asylum=True):
    """Fetch UNHCR population data for a country (using UNHCR country codes)."""
    import requests as _rq

    params = {"limit": 100}
    if as_asylum:
        params["coa"] = country_code
    else:
        params["coo"] = country_code
    if year_from:
        params["yearFrom"] = str(year_from)
    if year_to:
        params["yearTo"] = str(year_to)

    try:
        r = _rq.get(f"{UNHCR_API}/population/", params=params,
                     headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"},
                     timeout=15)
        r.raise_for_status()
        return r.json().get("items", [])
    except Exception as exc:
        log.warning("UNHCR population error for %s: %s", country_code, exc)
        return []

def _fetch_asylum_applications(country_code, year_from=None, year_to=None):
    """Fetch asylum application data (using UNHCR country codes)."""
    import requests as _rq

    params = {
        "limit": 100,
        "coa": country_code,
    }
    if year_from:
        params["yearFrom"] = str(year_from)
    if year_to:
        params["yearTo"] = str(year_to)

    try:
        r = _rq.get(f"{UNHCR_API}/asylum-applications/", params=params,
                     headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"},
                     timeout=15)
        r.raise_for_status()
        return r.json().get("items", [])
    except Exception as exc:
        log.warning("UNHCR asylum apps error for %s: %s", country_code, exc)
        return []

class MigrationPlugin(WatchZonePlugin):
    plugin_id = "migration"

    meta = {
        "label": "Migration",
        "icon_svg": (
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" '
            'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
            '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>'
            '<circle cx="9" cy="7" r="4"/>'
            '<path d="M23 21v-2a4 4 0 0 0-3-3.87"/>'
            '<path d="M16 3.13a4 4 0 0 1 0 7.75"/>'
            '</svg>'
        ),
        "color": "#8b5cf6",
        "description": "Flucht & Migration via UNHCR Refugee Statistics",
        "category": "geo",
        "required_credentials": [],
        "has_live": True,
        "has_history": True,
        "panel_template": "migration/_panel.html",
        "js_file": "/plugins/watchzone/migration/static/migration.js",

    }

    def live_handler(self, zone, config, geo, bbox, user_id):
        if not bbox:
            return {"error": "Zone hat keine gueltige Geometrie"}

        countries = _find_countries_for_bbox(bbox)
        if not countries:
            return {"error": "Kein Land fuer diese Region erkannt. UNHCR-Daten sind laenderbezogen."}

        now = datetime.now(timezone.utc)
        current_year = now.year
        year_from = current_year - 10

        results = []
        for c in countries[:3]:  # max 3 countries
            iso3 = c["iso3"]
            name = c["name"]

            # As host country
            pop_asylum = _fetch_population(iso3, year_from=year_from, year_to=current_year, as_asylum=True)
            # As origin country
            pop_origin = _fetch_population(iso3, year_from=year_from, year_to=current_year, as_asylum=False)

            # Build yearly series
            asylum_series = {}
            for p in pop_asylum:
                y = p.get("year")
                if y:
                    asylum_series[y] = {
                        "refugees": p.get("refugees", 0),
                        "asylum_seekers": p.get("asylum_seekers", 0),
                        "idps": p.get("idps", 0),
                        "stateless": p.get("stateless", 0),
                    }

            origin_series = {}
            for p in pop_origin:
                y = p.get("year")
                if y:
                    origin_series[y] = {
                        "refugees": p.get("refugees", 0),
                        "asylum_seekers": p.get("asylum_seekers", 0),
                        "idps": p.get("idps", 0),
                    }

            # Latest year
            latest_asylum = asylum_series.get(current_year) or asylum_series.get(current_year - 1, {})
            latest_origin = origin_series.get(current_year) or origin_series.get(current_year - 1, {})

            results.append({
                "iso3": iso3,
                "name": name,
                "latest_as_asylum": latest_asylum,
                "latest_as_origin": latest_origin,
                "asylum_series": [
                    {"year": y, **v} for y, v in sorted(asylum_series.items())
                ],
                "origin_series": [
                    {"year": y, **v} for y, v in sorted(origin_series.items())
                ],
            })

        return {
            "zone_id": zone.id,
            "zone_name": zone.name,
            "zone_type": "migration",
            "count": len(results),
            "countries": results,
        }

    def history_routes(self):
        return [{"suffix": "migration-history", "handler": self._history_handler}]

    def _history_handler(self, zone, args, user_id):
        import json as _j

        geo = _j.loads(zone.geometry) if zone.geometry else {}
        bbox = geojson_to_bbox(geo)
        countries = _find_countries_for_bbox(bbox) if bbox else []
        if not countries:
            return jsonify({"error": "Kein Land erkannt."}), 400

        iso3 = countries[0]["iso3"]
        date_from = args.get("from", "")[:4]  # just year
        date_to = args.get("to", "")[:4]

        year_from = int(date_from) if date_from.isdigit() else 2015
        year_to = int(date_to) if date_to.isdigit() else datetime.now(timezone.utc).year
        # UNHCR data is yearly and may lag 1-2 years — always include last 10 years
        year_from = min(year_from, year_to - 10)
        year_to = max(year_to, datetime.now(timezone.utc).year)

        pop = _fetch_population(iso3, year_from=year_from, year_to=year_to, as_asylum=True)
        data = [
            {"date": f"{p['year']}-01-01", "value": p.get("refugees", 0) + p.get("asylum_seekers", 0)}
            for p in pop if p.get("year")
        ]
        data.sort(key=lambda d: d["date"])

        return jsonify({
            "zone_id": zone.id, "zone_name": zone.name,
            "country": iso3, "data": data,
        })

    def ai_tools(self):
        return [{
            "name": "get_migration_data",
            "description": "Ruft UNHCR-Fluechtlings- und Migrationsdaten fuer eine Watch Zone ab.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "zone_id": {"type": "integer", "description": "ID der Watch Zone"},
                    "country": {"type": "string", "description": "ISO3 Laendercode (z.B. DEU, SYR, UKR)"},
                },
                "required": [],
            },
        }]

    def ai_tool_handler(self, tool_name, inputs, user_id):
        if tool_name != "get_migration_data":
            return {"error": f"Unbekanntes Tool: {tool_name}"}

        iso3 = inputs.get("country")
        if not iso3 and inputs.get("zone_id"):
            import json as _j
            from models import WatchZone
            z = WatchZone.query.filter_by(id=inputs["zone_id"], user_id=user_id).first()
            if z:
                geo = _j.loads(z.geometry) if z.geometry else {}
                bbox = geojson_to_bbox(geo)
                countries = _find_countries_for_bbox(bbox) if bbox else []
                if countries:
                    iso3 = countries[0]["iso3"]

        if not iso3:
            return {"error": "Kein Land angegeben (zone_id oder country erforderlich)"}

        now = datetime.now(timezone.utc)
        pop = _fetch_population(iso3, year_from=now.year - 5, year_to=now.year, as_asylum=True)
        origin = _fetch_population(iso3, year_from=now.year - 5, year_to=now.year, as_asylum=False)

        return {
            "country": iso3,
            "as_host": [{"year": p["year"], "refugees": p.get("refugees", 0),
                         "asylum_seekers": p.get("asylum_seekers", 0)} for p in pop],
            "as_origin": [{"year": p["year"], "refugees": p.get("refugees", 0)} for p in origin],
        }

    def analysis_provider(self):
        return {"data_types": ["migration"], "history_endpoint_suffix": "migration-history"}

PluginManager.register(MigrationPlugin())
