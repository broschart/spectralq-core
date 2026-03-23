"""Telegram Monitor — Daten-Cache (24h TTL).

Cachet Live-Ergebnisse pro Zone, damit wiederholte Aufrufe nicht
jedes Mal Telegram kontaktieren müssen.
"""

import time
import threading
import logging
import json
import hashlib

log = logging.getLogger(__name__)

_cache = {}  # key → {"data": ..., "ts": unix_timestamp}
_lock = threading.Lock()
_TTL = 86400  # 24 Stunden


def _make_key(zone_id, config):
    """Deterministic cache key from zone_id + stable config fields."""
    # Only use fields that affect search results (not dynamic enrichment)
    stable = {
        "keywords": config.get("keywords", "") or config.get("search", ""),
        "days": config.get("days", 7),
        "channels": config.get("channels", []),
        "source_zone_id": config.get("source_zone_id", ""),
    }
    tf = config.get("time_focus")
    if tf:
        stable["tf_from"] = tf.get("from", "")
        stable["tf_to"] = tf.get("to", "")
    raw = f"{zone_id}:{json.dumps(stable, sort_keys=True)}"
    return hashlib.sha256(raw.encode()).hexdigest()[:24]


def get(zone_id, config):
    """Get cached result or None if expired/missing."""
    key = _make_key(zone_id, config)
    with _lock:
        entry = _cache.get(key)
        if entry and (time.time() - entry["ts"]) < _TTL:
            log.debug("Cache hit for zone %s (age: %ds)", zone_id, time.time() - entry["ts"])
            return entry["data"]
        if entry:
            del _cache[key]  # expired
    return None


def put(zone_id, config, data):
    """Store result in cache."""
    key = _make_key(zone_id, config)
    with _lock:
        _cache[key] = {"data": data, "ts": time.time()}
    log.debug("Cached result for zone %s (%d bytes)", zone_id, len(json.dumps(data, default=str)))


def invalidate(zone_id=None):
    """Invalidate cache for a zone, or all if zone_id is None."""
    with _lock:
        if zone_id is None:
            _cache.clear()
        else:
            keys_to_del = [k for k, v in _cache.items() if k.startswith(str(zone_id))]
            # Can't match by prefix with hash keys, so clear all for safety
            _cache.clear()


def cleanup():
    """Remove all expired entries. Call periodically."""
    now = time.time()
    with _lock:
        expired = [k for k, v in _cache.items() if (now - v["ts"]) >= _TTL]
        for k in expired:
            del _cache[k]
        if expired:
            log.debug("Cache cleanup: removed %d expired entries", len(expired))


def stats():
    """Return cache stats."""
    with _lock:
        now = time.time()
        return {
            "entries": len(_cache),
            "oldest_age_s": max((now - v["ts"]) for v in _cache.values()) if _cache else 0,
        }
