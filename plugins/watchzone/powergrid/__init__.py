"""Power Grid Watch Zone Plugin — ENTSO-E Transparency Platform."""

import logging
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

from flask import jsonify
from plugins import PluginManager
from plugins.watchzone import WatchZonePlugin
from plugins.watchzone._helpers import geojson_to_bbox

log = logging.getLogger(__name__)

UA = "VeriTrend.ai/1.0 (forensic trend analysis; contact@veritrend.ai)"
ENTSOE_API = "https://transparency.entsoe.eu/api"

# Major European bidding zones (country → EIC code)
BIDDING_ZONES = {
    "DE": "10Y1001A1001A83F",  # Germany
    "FR": "10YFR-RTE------C",  # France
    "ES": "10YES-REE------0",  # Spain
    "IT": "10YIT-GRTN-----B",  # Italy (north)
    "PL": "10YPL-AREA-----S",  # Poland
    "NL": "10YNL----------L",  # Netherlands
    "BE": "10YBE----------2",  # Belgium
    "AT": "10YAT-APG------L",  # Austria
    "CH": "10YCH-SWISSGRIDZ",  # Switzerland
    "CZ": "10YCZ-CEPS-----N",  # Czech Republic
    "DK": "10Y1001A1001A65H",  # Denmark (DK1)
    "SE": "10YSE-1--------K",  # Sweden (SE1)
    "NO": "10YNO-1--------2",  # Norway (NO1)
    "FI": "10YFI-1--------U",  # Finland
    "PT": "10YPT-REN------W",  # Portugal
    "RO": "10YRO-TEL------P",  # Romania
    "BG": "10YCA-BULGARIA-R",  # Bulgaria
    "GR": "10YGR-HTSO-----Y",  # Greece
    "HU": "10YHU-MAVIR----U",  # Hungary
    "SK": "10YSK-SEPS-----K",  # Slovakia
    "HR": "10YHR-HEP------M",  # Croatia
    "SI": "10YSI-ELES-----O",  # Slovenia
    "RS": "10YCS-SERBIANSOB",  # Serbia
    "BA": "10YBA-JPCC-----D",  # Bosnia
    "UA": "10Y1001C--00003F",  # Ukraine
    "GB": "10YGB----------A",  # Great Britain
    "IE": "10YIE-1001A00010",  # Ireland
    "LT": "10YLT-1001A0008Q",  # Lithuania
    "LV": "10YLV-1001A00074",  # Latvia
    "EE": "10Y1001A1001A39I",  # Estonia
}

# Reverse: EIC → country code
EIC_TO_COUNTRY = {v: k for k, v in BIDDING_ZONES.items()}

NS = {"ns": "urn:iec62325.351:tc57wg16:451-6:generationloaddocument:3:0"}

def _get_entsoe_token(user_id=None):
    from transport import _get_credential
    return _get_credential("entsoe_token", "ENTSOE_TOKEN", user_id)

def _entsoe_dt(dt):
    """Format datetime for ENTSO-E API (YYYYMMDDHHmm UTC)."""
    return dt.strftime("%Y%m%d%H%M")

def _find_zone_for_bbox(bbox):
    """Find the best matching ENTSO-E bidding zone for a bbox center."""
    # Rough country detection by center point
    center_lat = (bbox[1] + bbox[3]) / 2
    center_lon = (bbox[0] + bbox[2]) / 2

    # Simple geographic lookup for European countries
    zones = [
        ((47, 5, 55, 15), "DE"),
        ((42, -5, 51, 10), "FR"),
        ((36, -10, 44, 4), "ES"),
        ((36, 6, 47, 19), "IT"),
        ((49, 14, 55, 24), "PL"),
        ((50, 3, 54, 8), "NL"),
        ((49, 2, 52, 7), "BE"),
        ((46, 9, 49, 17), "AT"),
        ((45, 5, 48, 11), "CH"),
        ((48, 12, 51, 19), "CZ"),
        ((54, 8, 58, 16), "DK"),
        ((55, 11, 69, 24), "SE"),
        ((58, 4, 71, 31), "NO"),
        ((59, 19, 70, 32), "FI"),
        ((37, -10, 42, -6), "PT"),
        ((43, 22, 48, 30), "RO"),
        ((41, 22, 44, 29), "BG"),
        ((35, 19, 42, 30), "GR"),
        ((45, 16, 49, 23), "HU"),
        ((47, 16, 50, 23), "SK"),
        ((42, 13, 47, 20), "HR"),
        ((45, 13, 47, 17), "SI"),
        ((42, 18, 47, 23), "RS"),
        ((42, 15, 46, 20), "BA"),
        ((44, 22, 53, 41), "UA"),
        ((50, -8, 59, 2), "GB"),
        ((51, -11, 55, -5), "IE"),
        ((53, 20, 57, 27), "LT"),
        ((55, 20, 58, 29), "LV"),
        ((57, 21, 60, 28), "EE"),
    ]

    best = None
    best_dist = float("inf")
    for (lat_min, lon_min, lat_max, lon_max), cc in zones:
        c_lat = (lat_min + lat_max) / 2
        c_lon = (lon_min + lon_max) / 2
        dist = (center_lat - c_lat) ** 2 + (center_lon - c_lon) ** 2
        if dist < best_dist:
            best_dist = dist
            best = cc

    return best

def _fetch_actual_load(domain, token, period_start, period_end):
    """Fetch Actual Total Load (documentType A65)."""
    import requests as _rq

    try:
        r = _rq.get(ENTSOE_API, params={
            "securityToken": token,
            "documentType": "A65",
            "processType": "A16",
            "outBiddingZone_Domain": domain,
            "periodStart": _entsoe_dt(period_start),
            "periodEnd": _entsoe_dt(period_end),
        }, headers={"User-Agent": UA}, timeout=20)

        if r.status_code == 401:
            return {"error": "ENTSO-E Token ungueltig"}
        if r.status_code == 400:
            return {"error": "Keine Daten fuer diese Region/Zeitraum"}
        r.raise_for_status()
    except Exception as exc:
        log.warning("ENTSO-E load error: %s", exc)
        return {"error": str(exc)[:200]}

    return _parse_load_xml(r.text)

def _parse_load_xml(xml_text):
    """Parse ENTSO-E GL_MarketDocument XML for load timeseries."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return {"error": "XML-Parsing fehlgeschlagen"}

    # Try multiple namespace patterns
    ns_prefixes = [
        "urn:iec62325.351:tc57wg16:451-6:generationloaddocument:3:0",
        "urn:iec62325.351:tc57wg16:451-6:generationloaddocument:3:0",
    ]

    series = []
    # Namespace-agnostic parsing
    for ts in root.iter():
        if ts.tag.endswith("}TimeSeries") or ts.tag == "TimeSeries":
            for period in ts.iter():
                if period.tag.endswith("}Period") or period.tag == "Period":
                    # Get start time
                    start_el = None
                    resolution = None
                    for child in period:
                        tag = child.tag.split("}")[-1] if "}" in child.tag else child.tag
                        if tag == "timeInterval":
                            for tc in child:
                                ttag = tc.tag.split("}")[-1] if "}" in tc.tag else tc.tag
                                if ttag == "start":
                                    start_el = tc.text
                        elif tag == "resolution":
                            resolution = child.text

                    if not start_el:
                        continue

                    try:
                        base_time = datetime.fromisoformat(start_el.replace("Z", "+00:00"))
                    except ValueError:
                        continue

                    # Determine step
                    step_minutes = 60  # default
                    if resolution and "15" in resolution:
                        step_minutes = 15
                    elif resolution and "30" in resolution:
                        step_minutes = 30

                    # Extract points
                    for point in period.iter():
                        ptag = point.tag.split("}")[-1] if "}" in point.tag else point.tag
                        if ptag == "Point":
                            pos = None
                            qty = None
                            for pc in point:
                                pctag = pc.tag.split("}")[-1] if "}" in pc.tag else pc.tag
                                if pctag == "position":
                                    pos = int(pc.text)
                                elif pctag == "quantity":
                                    qty = float(pc.text)
                            if pos is not None and qty is not None:
                                ts_time = base_time + timedelta(minutes=(pos - 1) * step_minutes)
                                series.append({
                                    "time": ts_time.strftime("%Y-%m-%dT%H:%M"),
                                    "value": qty,
                                })

    series.sort(key=lambda x: x["time"])
    return series

class PowerGridPlugin(WatchZonePlugin):
    plugin_id = "powergrid"

    meta = {
        "label": "Stromnetz",
        "icon_svg": (
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" '
            'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
            '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>'
            '</svg>'
        ),
        "color": "#f59e0b",
        "description": "Stromnetz-Lastdaten via ENTSO-E Transparency",
        "category": "geo",
        "required_credentials": ["entsoe_token"],
        "has_live": True,
        "has_history": True,
        "panel_template": "powergrid/_panel.html",
        "js_file": "/plugins/watchzone/powergrid/static/powergrid.js",

    }

    def live_handler(self, zone, config, geo, bbox, user_id):
        if not bbox:
            return {"error": "Zone hat keine gueltige Geometrie"}

        token = _get_entsoe_token(user_id)
        if not token:
            return {"error": "ENTSO-E Token fehlt. Kostenlos beantragen auf transparency.entsoe.eu."}

        country = _find_zone_for_bbox(bbox)
        if not country or country not in BIDDING_ZONES:
            return {"error": "Keine ENTSO-E-Zone fuer diese Region (nur Europa verfuegbar)."}

        domain = BIDDING_ZONES[country]
        now = datetime.now(timezone.utc)
        period_end = now
        period_start = now - timedelta(hours=48)

        series = _fetch_actual_load(domain, token, period_start, period_end)
        if isinstance(series, dict) and "error" in series:
            return series
        if not series:
            return {"error": "Keine Lastdaten verfuegbar fuer " + country}

        vals = [p["value"] for p in series if p.get("value") is not None]
        current = vals[-1] if vals else None
        avg_val = round(sum(vals) / len(vals)) if vals else None
        min_val = min(vals) if vals else None
        max_val = max(vals) if vals else None

        # Detect anomaly: current < 70% of average
        anomaly = None
        if current and avg_val and current < avg_val * 0.7:
            drop_pct = round((1 - current / avg_val) * 100)
            anomaly = {"drop_pct": drop_pct, "current": current, "avg": avg_val}

        return {
            "zone_id": zone.id,
            "zone_name": zone.name,
            "zone_type": "powergrid",
            "country": country,
            "domain": domain,
            "current_mw": current,
            "avg_mw": avg_val,
            "min_mw": min_val,
            "max_mw": max_val,
            "anomaly": anomaly,
            "series": series,
            "count": len(series),
        }

    def history_routes(self):
        return [{"suffix": "powergrid-history", "handler": self._history_handler}]

    def _history_handler(self, zone, args, user_id):
        import json as _j

        token = _get_entsoe_token(user_id)
        if not token:
            return jsonify({"error": "ENTSO-E Token fehlt."}), 400

        geo = _j.loads(zone.geometry) if zone.geometry else {}
        bbox = geojson_to_bbox(geo)
        country = _find_zone_for_bbox(bbox) if bbox else None
        if not country or country not in BIDDING_ZONES:
            return jsonify({"error": "Keine ENTSO-E-Zone fuer diese Region."}), 400

        date_from = args.get("from", "")
        date_to = args.get("to", "")
        if not date_from or not date_to:
            return jsonify({"error": "Parameter 'from' und 'to' erforderlich"}), 400

        try:
            start = datetime.fromisoformat(date_from + "T00:00:00+00:00")
            end = datetime.fromisoformat(date_to + "T23:59:00+00:00")
        except ValueError:
            return jsonify({"error": "Ungueltige Datumsformate"}), 400

        domain = BIDDING_ZONES[country]
        series = _fetch_actual_load(domain, token, start, end)
        if isinstance(series, dict) and "error" in series:
            return jsonify(series), 502

        # Aggregate to daily averages
        by_date = {}
        for p in series:
            d = p["time"][:10]
            if d not in by_date:
                by_date[d] = []
            by_date[d].append(p["value"])

        data = [
            {"date": d, "value": round(sum(vs) / len(vs)) if vs else None}
            for d, vs in sorted(by_date.items())
        ]

        return jsonify({
            "zone_id": zone.id, "zone_name": zone.name,
            "country": country, "data": data,
        })

    def ai_tools(self):
        return [{
            "name": "get_powergrid_data",
            "description": "Ruft aktuelle Stromnetz-Lastdaten (ENTSO-E) fuer eine europaeische Watch Zone ab.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "zone_id": {"type": "integer", "description": "ID der Watch Zone"},
                },
                "required": ["zone_id"],
            },
        }]

    def ai_tool_handler(self, tool_name, inputs, user_id):
        if tool_name != "get_powergrid_data":
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
            "zone_id": z.id, "country": result["country"],
            "current_mw": result["current_mw"],
            "avg_mw": result["avg_mw"],
            "min_mw": result["min_mw"],
            "max_mw": result["max_mw"],
            "anomaly": result["anomaly"],
            "data_points": result["count"],
        }

    def analysis_provider(self):
        return {"data_types": ["powergrid"], "history_endpoint_suffix": "powergrid-history"}

PluginManager.register(PowerGridPlugin())
