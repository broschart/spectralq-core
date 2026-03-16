"""Satellite plugin API routes — Sentinel-2 image endpoint."""

import logging
from flask import request, jsonify, Response

log = logging.getLogger(__name__)


def api_sentinel_image():
    """Sentinel-2 True-Color Bild für eine Bounding-Box."""
    from flask_login import current_user
    from plugins.watchzone.satellite._transport import fetch_sentinel_image
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
    width = min(1024, max(64, int(request.args.get("width", 512))))
    height = min(1024, max(64, int(request.args.get("height", 512))))
    try:
        png, used_bbox, cropped = fetch_sentinel_image(bbox, date_from, date_to,
                                                        width, height,
                                                        user_id=current_user.id)
        headers = {"Cache-Control": "public, max-age=86400"}
        if cropped:
            headers["X-Sentinel-Cropped"] = "1"
            headers["X-Sentinel-Bbox"] = ",".join(f"{v:.4f}" for v in used_bbox)
        return Response(png, mimetype="image/png", headers=headers)
    except CopernicusAuthError as e:
        return jsonify({"error": str(e)}), 401
    except Exception as e:
        log.warning("Sentinel Image Fehler: %s", e)
        return jsonify({"error": str(e)}), 502
