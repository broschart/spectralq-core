"""
Alert-Auswertung für VeriTrend
-------------------------------------------
Drei Alarm-Typen:

  occurrence    – ein Suchbegriff taucht in Verwandten Anfragen auf
  disappearance – ein Suchbegriff verschwindet aus Verwandten Anfragen
  spike         – ein Keyword-Trend steigt auf einen Mindestwert oder
                  um einen Mindest-Prozentsatz

Wird am Ende jedes run_fetch()-Aufrufs und auf Anfrage ausgeführt.
"""

import json
import logging
import re
from datetime import datetime, timezone, timedelta

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Hilfsfunktionen
# ---------------------------------------------------------------------------

def _word_match(term: str, text: str) -> bool:
    """True wenn `term` als eigenständiges Wort (oder Substring) in `text` vorkommt."""
    if not term or not text:
        return False
    return bool(re.search(r'(?<![^\W_])' + re.escape(term.strip().lower()) + r'(?![^\W_])',
                           text.lower()))


def _already_triggered(alert_id: int, keyword_id, db, hours: int = 12,
                        query_text: str | None = None) -> bool:
    """Dedup: True wenn in den letzten `hours` Stunden bereits ein Event für
    denselben Alert + Keyword (+ ggf. Query-Text) existiert."""
    from models import AlertEvent
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    events = (AlertEvent.query
              .filter(AlertEvent.alert_id == alert_id,
                      AlertEvent.keyword_id == keyword_id,
                      AlertEvent.triggered_at >= since)
              .all())
    if not events:
        return False
    if query_text is None:
        return True          # Beliebiges Event im Zeitfenster genügt
    for ev in events:
        try:
            if json.loads(ev.details_json or "{}").get("query", "").lower() == query_text.lower():
                return True
        except Exception:
            pass
    return False


# ---------------------------------------------------------------------------
# Typ-spezifische Prüffunktionen
# ---------------------------------------------------------------------------

def _check_occurrence(alert, kw_ids, db) -> None:
    from models import AlertEvent, RelatedQuery, Keyword

    term = alert.watch_term.strip()
    if not term:
        return

    # Neueste Batch-Zeit der Related Queries
    latest_rq = (db.session.query(RelatedQuery)
                 .order_by(RelatedQuery.fetched_at.desc())
                 .first())
    if not latest_rq:
        return

    batch_cutoff = latest_rq.fetched_at - timedelta(minutes=30)
    q = db.session.query(RelatedQuery).filter(RelatedQuery.fetched_at >= batch_cutoff)
    if kw_ids:
        q = q.filter(RelatedQuery.keyword_id.in_(kw_ids))

    for rq in q.all():
        if not _word_match(term, rq.query):
            continue
        if _already_triggered(alert.id, rq.keyword_id, db, hours=12, query_text=rq.query):
            continue
        kw = db.session.get(Keyword, rq.keyword_id)
        db.session.add(AlertEvent(
            alert_id=alert.id,
            triggered_at=datetime.now(timezone.utc),
            keyword_id=rq.keyword_id,
            keyword_text=kw.keyword if kw else "",
            details_json=json.dumps({
                "query":      rq.query,
                "query_type": rq.query_type,
                "value":      rq.value,
                "match_term": term,
            }),
        ))
        log.info("Alert '%s' (Auftreten): '%s' in RQ von '%s'",
                 alert.name, rq.query, kw.keyword if kw else rq.keyword_id)
    db.session.commit()


def _check_disappearance(alert, kw_ids, db) -> None:
    from models import AlertEvent, RelatedQuery, Keyword

    term = alert.watch_term.strip()
    if not term:
        return

    # Die zwei neuesten Fetch-Zeiten ermitteln
    times = (db.session.query(RelatedQuery.fetched_at)
             .distinct()
             .order_by(RelatedQuery.fetched_at.desc())
             .limit(20)
             .all())
    times = [r[0] for r in times]
    if len(times) < 2:
        return

    t_new, t_old = times[0], times[1]
    window = timedelta(minutes=30)

    def rq_with_term(around):
        q = (db.session.query(RelatedQuery)
             .filter(RelatedQuery.fetched_at >= around - window,
                     RelatedQuery.fetched_at <= around + window))
        if kw_ids:
            q = q.filter(RelatedQuery.keyword_id.in_(kw_ids))
        out = {}
        for rq in q.all():
            if _word_match(term, rq.query) and rq.keyword_id not in out:
                out[rq.keyword_id] = rq.query
        return out

    present_old = rq_with_term(t_old)
    present_new = rq_with_term(t_new)

    for kid, query_text in present_old.items():
        if kid in present_new:
            continue
        if _already_triggered(alert.id, kid, db, hours=24, query_text=query_text):
            continue
        kw = db.session.get(Keyword, kid)
        db.session.add(AlertEvent(
            alert_id=alert.id,
            triggered_at=datetime.now(timezone.utc),
            keyword_id=kid,
            keyword_text=kw.keyword if kw else "",
            details_json=json.dumps({
                "query":      query_text,
                "match_term": term,
                "last_seen":  t_old.isoformat(),
            }),
        ))
        log.info("Alert '%s' (Verschwinden): '%s' nicht mehr in RQ von '%s'",
                 alert.name, query_text, kw.keyword if kw else kid)
    db.session.commit()


def _check_spike(alert, kw_ids, db) -> None:
    from models import AlertEvent, TrendData, Keyword

    base_q = db.session.query(Keyword).filter_by(active=True)
    if kw_ids:
        keywords = base_q.filter(Keyword.id.in_(kw_ids)).all()
    elif alert.watch_term.strip():
        term = alert.watch_term.strip().lower()
        keywords = [k for k in base_q.all() if term in k.keyword.lower()]
    else:
        keywords = base_q.all()

    for kw in keywords:
        latest = (db.session.query(TrendData)
                  .filter_by(keyword_id=kw.id)
                  .order_by(TrendData.date.desc())
                  .first())
        if not latest:
            continue

        triggered = False
        details   = {}

        if alert.spike_threshold_type == "value":
            if latest.value >= alert.spike_threshold:
                triggered = True
                details = {
                    "current_value": latest.value,
                    "threshold":     alert.spike_threshold,
                    "threshold_type": "value",
                }
        else:  # percent
            cutoff = latest.date - timedelta(hours=alert.spike_hours)
            old = (db.session.query(TrendData)
                   .filter(TrendData.keyword_id == kw.id,
                           TrendData.date <= cutoff)
                   .order_by(TrendData.date.desc())
                   .first())
            if old and old.value > 0:
                rise_pct = (latest.value - old.value) / old.value * 100
                if rise_pct >= alert.spike_threshold:
                    triggered = True
                    details = {
                        "current_value": latest.value,
                        "old_value":     old.value,
                        "rise_pct":      round(rise_pct, 1),
                        "threshold":     alert.spike_threshold,
                        "threshold_type": "percent",
                        "hours":         alert.spike_hours,
                    }

        if triggered:
            if _already_triggered(alert.id, kw.id, db, hours=12, query_text=None):
                continue
            db.session.add(AlertEvent(
                alert_id=alert.id,
                triggered_at=datetime.now(timezone.utc),
                keyword_id=kw.id,
                keyword_text=kw.keyword,
                details_json=json.dumps(details),
            ))
            log.info("Alert '%s' (Anstieg): '%s' Wert %d", alert.name, kw.keyword, latest.value)
    db.session.commit()


# ---------------------------------------------------------------------------
# Volumen-basierte Prüfungen (volume_rise / volume_drop)
# ---------------------------------------------------------------------------

def _terms_from_watch(alert) -> list[str]:
    """Kommaseparierte Begriffe aus watch_term als bereinigte Liste."""
    raw = alert.watch_term or ""
    return [t.strip().lower() for t in raw.split(",") if t.strip()]


def _keywords_for_volume(alert, kw_ids, db):
    """Liefert die relevanten Keyword-Objekte für Volumen-Alerts."""
    from models import Keyword
    terms = _terms_from_watch(alert)
    base_q = db.session.query(Keyword).filter_by(active=True)
    if kw_ids:
        candidates = base_q.filter(Keyword.id.in_(kw_ids)).all()
    else:
        candidates = base_q.all()
    if not terms:
        return candidates
    return [k for k in candidates if any(t in k.keyword.lower() for t in terms)]


def _check_volume_rise(alert, kw_ids, db) -> None:
    """Trigger wenn Trend-Wert eines Keywords von 'absent' (< threshold) auf
    'present' (>= threshold) steigt, gemessen über ein Zeitfenster von
    spike_hours Stunden."""
    from models import AlertEvent, TrendData

    threshold = max(int(alert.spike_threshold or 5), 1)
    hours     = max(int(alert.spike_hours     or 24), 1)

    for kw in _keywords_for_volume(alert, kw_ids, db):
        latest = (db.session.query(TrendData)
                  .filter_by(keyword_id=kw.id)
                  .order_by(TrendData.date.desc())
                  .first())
        if not latest or latest.value < threshold:
            continue   # aktuell nicht vorhanden

        cutoff = latest.date - timedelta(hours=hours)
        old    = (db.session.query(TrendData)
                  .filter(TrendData.keyword_id == kw.id,
                          TrendData.date       <= cutoff)
                  .order_by(TrendData.date.desc())
                  .first())
        if old is None or old.value >= threshold:
            continue   # früher bereits vorhanden (oder keine Vergleichsdaten)

        if _already_triggered(alert.id, kw.id, db, hours=hours):
            continue

        db.session.add(AlertEvent(
            alert_id=alert.id,
            triggered_at=datetime.now(timezone.utc),
            keyword_id=kw.id,
            keyword_text=kw.keyword,
            details_json=json.dumps({
                "current_value": latest.value,
                "old_value":     old.value,
                "threshold":     threshold,
                "hours":         hours,
            }),
        ))
        log.info("Alert '%s' (Volumen aufkommt): '%s' Wert %d (vorher %d)",
                 alert.name, kw.keyword, latest.value, old.value)
    db.session.commit()


def _check_volume_drop(alert, kw_ids, db) -> None:
    """Trigger wenn Trend-Wert eines Keywords von 'present' (>= threshold)
    auf 'absent' (< threshold) fällt, gemessen über spike_hours Stunden."""
    from models import AlertEvent, TrendData

    threshold = max(int(alert.spike_threshold or 5), 1)
    hours     = max(int(alert.spike_hours     or 24), 1)

    for kw in _keywords_for_volume(alert, kw_ids, db):
        latest = (db.session.query(TrendData)
                  .filter_by(keyword_id=kw.id)
                  .order_by(TrendData.date.desc())
                  .first())
        if not latest or latest.value >= threshold:
            continue   # aktuell noch vorhanden

        cutoff = latest.date - timedelta(hours=hours)
        old    = (db.session.query(TrendData)
                  .filter(TrendData.keyword_id == kw.id,
                          TrendData.date       <= cutoff)
                  .order_by(TrendData.date.desc())
                  .first())
        if old is None or old.value < threshold:
            continue   # früher bereits absent (oder keine Vergleichsdaten)

        if _already_triggered(alert.id, kw.id, db, hours=hours):
            continue

        db.session.add(AlertEvent(
            alert_id=alert.id,
            triggered_at=datetime.now(timezone.utc),
            keyword_id=kw.id,
            keyword_text=kw.keyword,
            details_json=json.dumps({
                "current_value": latest.value,
                "old_value":     old.value,
                "threshold":     threshold,
                "hours":         hours,
            }),
        ))
        log.info("Alert '%s' (Volumen verschwindet): '%s' Wert %d (vorher %d)",
                 alert.name, kw.keyword, latest.value, old.value)
    db.session.commit()


# ---------------------------------------------------------------------------
# Haupt-Einstiegspunkt
# ---------------------------------------------------------------------------

def evaluate_alerts(app) -> None:
    """Wertet alle aktiven Alerts aus. Nach jedem Fetch und auf Anfrage aufrufen."""
    from models import Alert, db

    with app.app_context():
        alerts = Alert.query.filter_by(active=True).all()
        if not alerts:
            return

        log.info("Werte %d Alert(s) aus …", len(alerts))
        for alert in alerts:
            try:
                kw_ids = json.loads(alert.keyword_ids_json) if alert.keyword_ids_json else None
                if alert.alert_type == "occurrence":
                    _check_occurrence(alert, kw_ids, db)
                elif alert.alert_type == "disappearance":
                    _check_disappearance(alert, kw_ids, db)
                elif alert.alert_type == "spike":
                    _check_spike(alert, kw_ids, db)
                elif alert.alert_type == "volume_rise":
                    _check_volume_rise(alert, kw_ids, db)
                elif alert.alert_type == "volume_drop":
                    _check_volume_drop(alert, kw_ids, db)
            except Exception as exc:
                log.warning("Alert %d ('%s') Auswertung fehlgeschlagen: %s",
                            alert.id, alert.name, exc)
                try:
                    db.session.rollback()
                except Exception:
                    pass
