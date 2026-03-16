"""Bluesky Monitor plugin API routes — Bluesky mention timeline."""

from flask import request, jsonify, abort


def api_bluesky_mentions():
    """Bluesky-Postingvolumen pro Tag für Suchbegriffe."""
    import requests as _req_bsky
    from collections import Counter
    import time as _time
    import bisect
    from datetime import datetime, timedelta, timezone
    from flask_login import current_user
    from transport import _get_credential

    terms_param = request.args.get("terms", "")
    if not terms_param:
        abort(400, "terms Parameter fehlt")
    terms = [t.strip() for t in terms_param.split(",") if t.strip()][:5]
    days = min(int(request.args.get("days", 180)), 365)

    end_dt = datetime.now(timezone.utc)
    start_dt = end_dt - timedelta(days=days)

    labels_param = request.args.get("labels", "")
    chart_labels = sorted([l.strip() for l in labels_param.split(",")
                           if l.strip()]) if labels_param else None

    uid = current_user.id if current_user.is_authenticated else None
    bsky_handle = _get_credential("bluesky_handle", "BLUESKY_HANDLE", uid)
    bsky_pw = _get_credential("bluesky_app_password", "BLUESKY_APP_PASSWORD", uid)

    if not bsky_handle or not bsky_pw:
        return jsonify([{"term": t, "error": "Bluesky-Zugangsdaten fehlen. "
                         "Bitte Handle und App-Password unter Admin eintragen."}
                        for t in terms])

    try:
        sess_resp = _req_bsky.post(
            "https://bsky.social/xrpc/com.atproto.server.createSession",
            json={"identifier": bsky_handle, "password": bsky_pw},
            timeout=15,
        )
        sess_resp.raise_for_status()
        access_token = sess_resp.json().get("accessJwt")
    except Exception as exc:
        return jsonify([{"term": t, "error": f"Bluesky-Login fehlgeschlagen: {str(exc)[:100]}"}
                        for t in terms])

    headers = {"Authorization": f"Bearer {access_token}"}

    result = []
    for term in terms:
        posts_per_day = Counter()
        fetched = 0
        try:
            cursor = None
            for _ in range(50):
                params = {"q": term, "limit": 100, "sort": "latest"}
                if cursor:
                    params["cursor"] = cursor
                r = _req_bsky.get(
                    "https://bsky.social/xrpc/app.bsky.feed.searchPosts",
                    params=params, headers=headers, timeout=20,
                )
                if r.status_code == 429:
                    _time.sleep(2)
                    continue
                r.raise_for_status()
                data = r.json()
                posts = data.get("posts", [])
                if not posts:
                    break
                stop = False
                for post in posts:
                    indexed_at = post.get("indexedAt", "")
                    if not indexed_at:
                        continue
                    day_str = indexed_at[:10]
                    if day_str < start_dt.strftime("%Y-%m-%d"):
                        stop = True
                        break
                    posts_per_day[day_str] += 1
                    fetched += 1
                if stop:
                    break
                cursor = data.get("cursor")
                if not cursor:
                    break
                _time.sleep(0.3)

            if chart_labels and len(chart_labels) > 1 and posts_per_day:
                aggregated = Counter()
                for day_str, count in posts_per_day.items():
                    idx = bisect.bisect_right(chart_labels, day_str)
                    if idx > 0:
                        idx -= 1
                    best = chart_labels[idx]
                    if idx + 1 < len(chart_labels):
                        try:
                            d0 = abs((datetime.strptime(day_str, "%Y-%m-%d") -
                                      datetime.strptime(chart_labels[idx], "%Y-%m-%d")).days)
                            d1 = abs((datetime.strptime(day_str, "%Y-%m-%d") -
                                      datetime.strptime(chart_labels[idx+1], "%Y-%m-%d")).days)
                            if d1 < d0:
                                best = chart_labels[idx + 1]
                        except Exception:
                            pass
                    aggregated[best] += count
                series = [{"date": d, "count": aggregated[d]}
                          for d in sorted(aggregated.keys())]
            else:
                series = [{"date": d, "count": posts_per_day[d]}
                          for d in sorted(posts_per_day.keys())]

            result.append({"term": term, "total": fetched, "series": series})
        except Exception as exc:
            result.append({"term": term, "error": str(exc)[:120]})

    return jsonify(result)
