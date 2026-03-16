"""Website plugin API routes — Traceroute SSE + result storage."""

import logging
from flask import request, jsonify, abort, Response, stream_with_context

log = logging.getLogger(__name__)


def api_traceroute(zid):
    """Traceroute zum Domain-Server einer Website-Watchzone als SSE-Stream."""
    import json as _j
    import re
    import subprocess
    import urllib.parse
    from flask_login import current_user
    from models import WatchZone

    z = WatchZone.query.filter_by(id=zid, user_id=current_user.id).first()
    if not z:
        abort(404)
    config = _j.loads(z.config) if z.config else {}
    url = config.get("url", "")
    if not url:
        return jsonify({"error": "Keine URL konfiguriert"}), 400

    parsed = urllib.parse.urlparse(url)
    hostname = parsed.hostname or url.split("/")[0]

    def generate():
        import socket as _sock
        import datetime as _dt
        yield f"data: {_j.dumps({'type': 'start', 'target': hostname})}\n\n"
        try:
            proc = subprocess.Popen(
                ["tracepath", "-n", "-m", "20", hostname],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True
            )
            for raw in proc.stdout:
                line = raw.strip()
                if not line:
                    continue
                m = re.match(r'^\s*(\d+)[?:]?\s+(\S+)\s+(\S+)', line)
                if not m:
                    continue
                hop_num = int(m.group(1))
                ip = m.group(2)
                rtt = m.group(3)
                if ip in ("???", "[LOCALHOST]", "no", "localhost"):
                    ts = _dt.datetime.utcnow().isoformat(timespec='seconds') + 'Z'
                    yield f"data: {_j.dumps({'type': 'hop', 'hop': hop_num, 'ip': None, 'rtt': rtt, 'lat': None, 'lng': None, 'city': None, 'country': None, 'asn': None, 'org': None, 'rdns': None, 'ts': ts})}\n\n"
                    continue
                lat, lng, city, country = None, None, None, None
                asn, org = '', ''
                try:
                    import requests as _req
                    geo = _req.get(
                        f"http://ip-api.com/json/{ip}?fields=status,lat,lon,city,country,as,org",
                        timeout=4
                    ).json()
                    if geo.get("status") == "success":
                        lat, lng = geo.get("lat"), geo.get("lon")
                        city, country = geo.get("city", ""), geo.get("country", "")
                        asn = geo.get("as", "")
                        org = geo.get("org", "")
                except Exception:
                    pass
                rdns = None
                try:
                    rdns = _sock.gethostbyaddr(ip)[0]
                except Exception:
                    pass
                ts = _dt.datetime.utcnow().isoformat(timespec='seconds') + 'Z'
                yield f"data: {_j.dumps({'type': 'hop', 'hop': hop_num, 'ip': ip, 'rtt': rtt, 'lat': lat, 'lng': lng, 'city': city, 'country': country, 'asn': asn, 'org': org, 'rdns': rdns, 'ts': ts})}\n\n"
            proc.wait()
            yield f"data: {_j.dumps({'type': 'done'})}\n\n"
        except Exception as exc:
            yield f"data: {_j.dumps({'type': 'error', 'msg': str(exc)})}\n\n"

    return Response(
        stream_with_context(generate()),
        content_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def api_traceroute_result(zid):
    """Traceroute-Ergebnis speichern (POST) oder die letzten abrufen (GET)."""
    import json as _j
    from flask_login import current_user
    from models import WatchZone, TracerouteResult, db

    z = WatchZone.query.filter_by(id=zid, user_id=current_user.id).first()
    if not z:
        abort(404)

    if request.method == "GET":
        limit = min(int(request.args.get("limit", 20)), 100)
        rows = (TracerouteResult.query
                .filter_by(zone_id=zid, user_id=current_user.id)
                .order_by(TracerouteResult.created_at.desc())
                .limit(limit).all())
        return jsonify([r.to_dict() for r in rows])

    # POST
    d = request.get_json(force=True) or {}
    res = TracerouteResult(
        zone_id       = zid,
        user_id       = current_user.id,
        target        = d.get("target", ""),
        hops_json     = _j.dumps(d.get("hops", [])),
        anomalies_json= _j.dumps(d.get("anomalies", [])),
        total_km      = d.get("total_km"),
        last_rtt      = d.get("last_rtt"),
        hops_count    = d.get("hops_count", 0),
        hops_visible  = d.get("hops_visible", 0),
        hops_anon     = d.get("hops_anon", 0),
    )
    db.session.add(res)
    all_ids = [r.id for r in (TracerouteResult.query
                               .filter_by(zone_id=zid, user_id=current_user.id)
                               .order_by(TracerouteResult.created_at.desc()).all())]
    if len(all_ids) >= 100:
        TracerouteResult.query.filter(
            TracerouteResult.id.in_(all_ids[99:])
        ).delete(synchronize_session=False)
    db.session.commit()
    return jsonify(res.to_dict()), 201


def api_traceroute_result_patch(zid, rid):
    """Anomalien + angereicherte Hops nach Enrichment nachpatchen."""
    import json as _j
    from flask_login import current_user
    from models import TracerouteResult, db

    res = TracerouteResult.query.filter_by(id=rid, zone_id=zid, user_id=current_user.id).first()
    if not res:
        abort(404)
    d = request.get_json(force=True) or {}
    if "anomalies" in d:
        res.anomalies_json = _j.dumps(d["anomalies"])
    if "hops" in d:
        res.hops_json = _j.dumps(d["hops"])
    db.session.commit()
    return jsonify({"ok": True})
