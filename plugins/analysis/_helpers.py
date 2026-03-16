"""Shared helpers for analysis plugins."""
from collections import OrderedDict


def load_series(body):
    """Lädt Zeitreihendaten aus keyword_ids (DB) oder data (JSON).

    Akzeptiert:
      - keyword_ids: [id, ...] + optionaler run_tag
      - data: [{keyword, values: [int|null], dates: [str]}] (direktes Format)

    Gibt zurück: (labels, series_list) mit series_list = [{keyword, values, kwId}]
    """
    run_tag = body.get("run_tag", "")

    # Direkte Daten
    if "data" in body and body["data"]:
        raw = body["data"]
        if not raw:
            return None, None
        first = raw[0]
        labels = first.get("dates") or first.get("labels") or []
        series = []
        for entry in raw:
            series.append({
                "keyword": entry.get("keyword", "?"),
                "values": entry.get("values", []),
                "kwId": entry.get("kwId") or entry.get("keyword_id"),
            })
        return labels, series

    # Aus Datenbank laden
    kw_ids = body.get("keyword_ids", [])
    if not kw_ids:
        return None, None

    from models import Keyword, TrendData

    all_dates = OrderedDict()
    series_raw = []

    for kid in kw_ids:
        kw = Keyword.query.get(kid)
        if not kw:
            continue
        trends = (TrendData.query
                  .filter_by(keyword_id=kid, run_tag=run_tag)
                  .order_by(TrendData.date).all())
        if not trends:
            continue
        pts = [(t.date.isoformat(), t.value) for t in trends]
        series_raw.append({"keyword": kw.keyword, "kwId": kid, "pts": pts})
        for d, _ in pts:
            all_dates[d] = True

    if not series_raw:
        return None, None

    labels = list(all_dates.keys())
    date_idx = {d: i for i, d in enumerate(labels)}

    series = []
    for sr in series_raw:
        values = [None] * len(labels)
        for d, v in sr["pts"]:
            values[date_idx[d]] = v
        series.append({"keyword": sr["keyword"], "values": values, "kwId": sr["kwId"]})

    return labels, series
