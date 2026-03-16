"""Weather transport layer — DWD Bright Sky / Open-Meteo."""

import json
import logging
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode

log = logging.getLogger(__name__)

BRIGHTSKY_API_URL = "https://api.brightsky.dev"


def _fetch_openmeteo_current(lat, lon):
    """Fallback: aktuelle Wetterdaten von Open-Meteo (weltweit verfügbar)."""
    params = urlencode({
        "latitude": lat, "longitude": lon,
        "current": "temperature_2m,relative_humidity_2m,wind_speed_10m,"
                   "wind_direction_10m,wind_gusts_10m,precipitation,"
                   "pressure_msl,cloud_cover,weather_code",
    })
    url = f"https://api.open-meteo.com/v1/forecast?{params}"
    req = Request(url)
    with urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    c = data.get("current", {})
    wmo = c.get("weather_code", 0)
    condition = (
        "dry" if wmo in (0, 1) else
        "partly-cloudy" if wmo in (2, 3) else
        "fog" if wmo in (45, 48) else
        "rain" if wmo in (51, 53, 55, 61, 63, 65, 80, 81, 82) else
        "snow" if wmo in (71, 73, 75, 77, 85, 86) else
        "thunderstorm" if wmo in (95, 96, 99) else "unknown"
    )
    return {
        "temperature":     c.get("temperature_2m"),
        "wind_speed":      c.get("wind_speed_10m"),
        "wind_direction":  c.get("wind_direction_10m"),
        "wind_gust":       c.get("wind_gusts_10m"),
        "precipitation":   c.get("precipitation"),
        "pressure":        c.get("pressure_msl"),
        "humidity":        c.get("relative_humidity_2m"),
        "cloud_cover":     c.get("cloud_cover"),
        "visibility":      None,
        "dew_point":       None,
        "condition":       condition,
        "icon":            condition,
        "timestamp":       c.get("time", ""),
        "source_station":  "Open-Meteo",
    }


def fetch_dwd_weather(lat, lon):
    """
    Ruft aktuelle Wetterdaten ab. Versucht zuerst DWD (Bright Sky),
    fällt bei 404 auf Open-Meteo zurück (weltweit).
    """
    params = urlencode({"lat": lat, "lon": lon, "last": 1})
    url = f"{BRIGHTSKY_API_URL}/current_weather?{params}"
    req = Request(url)

    try:
        with urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except HTTPError as e:
        if e.code == 404:
            log.info("Bright Sky 404 für (%s, %s) – Fallback auf Open-Meteo", lat, lon)
            return _fetch_openmeteo_current(lat, lon)
        log.warning("Bright Sky Fehler: %s", e)
        raise RuntimeError(f"Wetterdaten nicht abrufbar: {e}")
    except (URLError, OSError) as e:
        log.warning("Bright Sky Fehler: %s – Fallback auf Open-Meteo", e)
        try:
            return _fetch_openmeteo_current(lat, lon)
        except Exception as e2:
            raise RuntimeError(f"Wetterdaten nicht abrufbar: {e2}")

    w = data.get("weather", {})
    return {
        "temperature":     w.get("temperature"),
        "wind_speed":      w.get("wind_speed_10") or w.get("wind_speed_30") or w.get("wind_speed"),
        "wind_direction":  w.get("wind_direction_10") or w.get("wind_direction_30") or w.get("wind_direction"),
        "wind_gust":       w.get("wind_gust_speed_10") or w.get("wind_gust_speed_30"),
        "precipitation":   w.get("precipitation_10") or w.get("precipitation_30") or w.get("precipitation_60"),
        "pressure":        w.get("pressure_msl"),
        "humidity":        w.get("relative_humidity"),
        "cloud_cover":     w.get("cloud_cover"),
        "visibility":      w.get("visibility"),
        "dew_point":       w.get("dew_point"),
        "condition":       w.get("condition"),
        "icon":            w.get("icon"),
        "timestamp":       w.get("timestamp", ""),
        "source_station":  data.get("sources", [{}])[0].get("station_name", ""),
    }


def fetch_dwd_alerts(lat, lon):
    """Ruft aktuelle DWD-Wetterwarnungen via Bright Sky ab."""
    params = urlencode({"lat": lat, "lon": lon})
    url = f"{BRIGHTSKY_API_URL}/alerts?{params}"
    req = Request(url)

    try:
        with urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except (HTTPError, URLError, OSError) as e:
        log.warning("Bright Sky Alerts Fehler: %s", e)
        raise RuntimeError(f"DWD-Warnungen nicht abrufbar: {e}")

    results = []
    for a in data.get("alerts", []):
        results.append({
            "headline":    a.get("headline", ""),
            "description": a.get("description", ""),
            "severity":    a.get("severity", ""),
            "event":       a.get("event", ""),
            "effective":   a.get("effective", ""),
            "expires":     a.get("expires", ""),
        })
    return results


def _fetch_openmeteo_history(lat, lon, date_from, date_to, data_type):
    """Fallback: historische Wetterdaten von Open-Meteo (weltweit)."""
    from datetime import datetime as _dt, timedelta as _td
    daily_vars = {
        "temperatur":   "temperature_2m_max",
        "niederschlag": "precipitation_sum",
        "pegel":        "precipitation_sum",
        "sturm":        "wind_gusts_10m_max",
    }
    var = daily_vars.get(data_type, "temperature_2m_max")

    start = _dt.strptime(date_from, "%Y-%m-%d")
    end = _dt.strptime(date_to, "%Y-%m-%d")
    today = _dt.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    days_back = (today - start).days

    all_dates = []
    all_values = []

    if days_back <= 92:
        params = urlencode({
            "latitude": lat, "longitude": lon,
            "daily": var, "timezone": "auto",
            "past_days": min(days_back + 2, 92),
            "forecast_days": 0,
        })
        url = f"https://api.open-meteo.com/v1/forecast?{params}"
        try:
            req = Request(url)
            with urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            daily = data.get("daily", {})
            all_dates = daily.get("time", [])
            all_values = daily.get(var, [])
        except Exception as e:
            log.warning("Open-Meteo Forecast Fehler: %s", e)
    else:
        archive_end = (today - _td(days=7)).strftime("%Y-%m-%d")
        params = urlencode({
            "latitude": lat, "longitude": lon,
            "start_date": date_from, "end_date": archive_end,
            "daily": var, "timezone": "auto",
        })
        url = f"https://archive-api.open-meteo.com/v1/archive?{params}"
        try:
            req = Request(url)
            with urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            daily = data.get("daily", {})
            all_dates = daily.get("time", [])
            all_values = daily.get(var, [])
        except Exception as e:
            log.warning("Open-Meteo Archive Fehler: %s", e)

        params2 = urlencode({
            "latitude": lat, "longitude": lon,
            "daily": var, "timezone": "auto",
            "past_days": 14,
            "forecast_days": 0,
        })
        url2 = f"https://api.open-meteo.com/v1/forecast?{params2}"
        try:
            req2 = Request(url2)
            with urlopen(req2, timeout=30) as resp2:
                data2 = json.loads(resp2.read().decode("utf-8"))
            daily2 = data2.get("daily", {})
            existing = set(all_dates)
            for d, v in zip(daily2.get("time", []), daily2.get(var, [])):
                if d not in existing:
                    all_dates.append(d)
                    all_values.append(v)
        except Exception as e:
            log.warning("Open-Meteo Forecast Ergänzung Fehler: %s", e)

    dates = []
    values = []
    for d, v in zip(all_dates, all_values):
        if date_from <= d <= date_to:
            dates.append(d)
            values.append(v)
    label_map = {
        "temperatur": "Temperatur (\u00b0C)",
        "niederschlag": "Niederschlag (mm)",
        "pegel": "Niederschlag (mm)",
        "sturm": "Windböen (km/h)",
    }
    lbl = label_map.get(data_type, data_type)
    results = []
    for d, v in zip(dates, values):
        if v is None:
            continue
        v = round(v, 1)
        # Sturm-Filter nur bei Triangulation (nicht bei History-Chart)
        results.append({"date": d, "value": v, "label": lbl})
    return results


def fetch_dwd_weather_history(lat, lon, date_from, date_to, data_type="pegel"):
    """
    Ruft historische Wetterdaten ab. Versucht zuerst DWD (Bright Sky),
    fällt bei 404 auf Open-Meteo zurück (weltweit).
    """
    from datetime import datetime as _dt, timedelta as _td

    if data_type == "warnung":
        try:
            alerts = fetch_dwd_alerts(lat, lon)
            results = []
            for a in alerts:
                eff = a.get("effective", "")[:10]
                if eff and date_from <= eff <= date_to:
                    results.append({
                        "date": eff,
                        "value": {"minor": 1, "moderate": 2, "severe": 3, "extreme": 4}.get(
                            (a.get("severity") or "").lower(), 1),
                        "label": a.get("headline", a.get("event", "Warnung")),
                    })
            return results
        except Exception:
            return []

    if data_type == "sturm":
        data_type_internal = "wind"
    else:
        data_type_internal = data_type

    results = []
    day_agg = {}
    start = _dt.strptime(date_from, "%Y-%m-%d")
    end = _dt.strptime(date_to, "%Y-%m-%d")
    chunk = _td(days=10)
    cur = start
    brightsky_failed = False
    while cur <= end:
        chunk_end = min(cur + chunk, end + _td(days=1))
        params = urlencode({
            "lat": lat, "lon": lon,
            "date": cur.strftime("%Y-%m-%dT00:00"),
            "last_date": chunk_end.strftime("%Y-%m-%dT00:00"),
        })
        url = f"{BRIGHTSKY_API_URL}/weather?{params}"
        try:
            req = Request(url)
            with urlopen(req, timeout=20) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            for w in data.get("weather", []):
                ts = w.get("timestamp", "")[:10]
                if not ts:
                    continue
                if data_type == "temperatur":
                    val = w.get("temperature")
                    if val is None:
                        continue
                elif data_type == "niederschlag" or data_type == "pegel":
                    val = w.get("precipitation") or 0
                elif data_type_internal == "wind":
                    val = w.get("wind_gust_speed_10") or w.get("wind_gust_speed_30") or w.get("wind_speed_10") or w.get("wind_speed_30") or 0
                else:
                    val = w.get("temperature")
                    if val is None:
                        continue
                if ts not in day_agg:
                    day_agg[ts] = []
                day_agg[ts].append(val)
        except HTTPError as e:
            if e.code == 404:
                log.info("Bright Sky 404 – Fallback auf Open-Meteo für History")
                brightsky_failed = True
                break
            log.warning("Bright Sky History Fehler: %s", e)
        except (URLError, OSError) as e:
            log.warning("Bright Sky History Fehler: %s", e)
            brightsky_failed = True
            break
        cur = chunk_end

    if brightsky_failed:
        try:
            return _fetch_openmeteo_history(lat, lon, date_from, date_to, data_type)
        except Exception as e:
            log.warning("Open-Meteo History Fallback Fehler: %s", e)
            return []

    label_map = {
        "temperatur": "Temperatur (\u00b0C)",
        "niederschlag": "Niederschlag (mm)",
        "pegel": "Niederschlag (mm)",
        "wind": "Windböen (km/h)",
    }
    lbl = label_map.get(data_type, label_map.get(data_type_internal, data_type))

    for d in sorted(day_agg.keys()):
        vals = day_agg[d]
        if not vals:
            continue
        if data_type == "temperatur":
            agg = round(max(vals), 1)
        elif data_type in ("niederschlag", "pegel"):
            agg = round(sum(vals), 1)
        elif data_type_internal == "wind":
            agg = round(max(vals), 1)
        else:
            agg = round(sum(vals) / len(vals), 1)
        results.append({"date": d, "value": agg, "label": lbl})

    return results
