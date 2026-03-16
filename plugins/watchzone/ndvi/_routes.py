"""NDVI plugin API routes — Sentinel-2 NDVI stats endpoint."""

import logging
from flask import request, jsonify

log = logging.getLogger(__name__)


def api_sentinel_ndvi():
    """NDVI-Zeitreihe für eine Bounding-Box."""
    from flask_login import current_user
    from plugins.watchzone.ndvi._transport import fetch_sentinel_ndvi_stats
    from transport import CopernicusAuthError

    bbox_str = request.args.get("bbox", "")
    date_from = request.args.get("from", "")
    date_to = request.args.get("to", "")
    if not bbox_str or not date_from or not date_to:
        return jsonify({"error": "bbox, from, to erforderlich"}), 400
    try:
        bbox = [float(x) for x in bbox_str.split(",")]
        if len(bbox) != 4:
            raise ValueError
    except (ValueError, TypeError):
        return jsonify({"error": "bbox: lon_min,lat_min,lon_max,lat_max"}), 400
    interval = request.args.get("interval", "P7D")
    if interval not in ("P1D", "P7D", "P1M"):
        interval = "P7D"
    try:
        data = fetch_sentinel_ndvi_stats(bbox, date_from, date_to, interval,
                                         user_id=current_user.id)
        labels_str = request.args.get("labels", "")
        if labels_str and data:
            from bisect import bisect_right
            labels = [l.strip() for l in labels_str.split(",") if l.strip()]
            if labels:
                day_map = {}
                for pt in data:
                    day_map[pt["date"]] = pt["mean_ndvi"]
                sorted_days = sorted(day_map.keys())
                agg = {}
                for d in sorted_days:
                    idx = bisect_right(labels, d) - 1
                    if 0 <= idx < len(labels):
                        lbl = labels[idx]
                        agg.setdefault(lbl, []).append(day_map[d])
                data = [{"date": lbl, "mean_ndvi": round(sum(vs)/len(vs), 4)}
                        for lbl, vs in agg.items()]
        return jsonify(data)
    except CopernicusAuthError as e:
        return jsonify({"error": str(e)}), 401
    except Exception as e:
        log.warning("Sentinel NDVI Fehler: %s", e)
        return jsonify({"error": str(e)}), 502
