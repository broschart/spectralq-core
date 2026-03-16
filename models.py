from datetime import datetime, timezone
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin

db = SQLAlchemy()
login_manager = LoginManager()
login_manager.login_view = "login"
login_manager.login_message = "Bitte einloggen."


# ── User ──────────────────────────────────────────────────────────────────
class User(UserMixin, db.Model):
    __tablename__ = "users"

    id          = db.Column(db.Integer, primary_key=True)
    username    = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    display_name  = db.Column(db.String(120), default="")
    role        = db.Column(db.String(20), default="user", nullable=False)  # "superadmin" | "user"
    active      = db.Column(db.Boolean, default=True, nullable=False)
    created_at  = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    # ── Berechtigungen / Kontingente ──
    can_use_own_apis    = db.Column(db.Boolean, default=False, nullable=False)
    can_custom_workflow = db.Column(db.Boolean, default=False, nullable=False)
    # JSON-Liste erlaubter Backends, z.B. '["playwright","pytrends","serpapi"]'; "" = keine
    allowed_backends    = db.Column(db.Text, default="")
    max_serpapi_calls   = db.Column(db.Integer, default=100)   # pro Monat; 0 = unbegrenzt
    max_llm_calls       = db.Column(db.Integer, default=50)    # pro Monat; 0 = unbegrenzt
    max_projects        = db.Column(db.Integer, default=5)     # 0 = unbegrenzt
    max_keywords        = db.Column(db.Integer, default=20)    # 0 = unbegrenzt

    # Eigene API-Keys (nur wenn can_use_own_apis=True)
    own_serpapi_key     = db.Column(db.String(255), default="")
    own_llm_api_key    = db.Column(db.String(255), default="")
    own_llm_provider   = db.Column(db.String(30), default="")   # "openai" | "anthropic" | …

    def set_password(self, password):
        import bcrypt
        self.password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

    def check_password(self, password):
        import bcrypt
        return bcrypt.checkpw(password.encode(), self.password_hash.encode())

    @property
    def is_superadmin(self):
        return self.role == "superadmin"

    def get_allowed_backends(self):
        import json as _j
        if not self.allowed_backends:
            return []
        try:
            return _j.loads(self.allowed_backends)
        except (ValueError, _j.JSONDecodeError):
            return []

    def to_dict(self):
        return {
            "id":                self.id,
            "username":          self.username,
            "display_name":      self.display_name or self.username,
            "role":              self.role,
            "active":            self.active,
            "created_at":        self.created_at.isoformat() if self.created_at else None,
            "can_use_own_apis":  self.can_use_own_apis,
            "can_custom_workflow": self.can_custom_workflow,
            "allowed_backends":  self.get_allowed_backends(),
            "max_serpapi_calls": self.max_serpapi_calls,
            "max_llm_calls":    self.max_llm_calls,
            "max_projects":     self.max_projects,
            "max_keywords":     self.max_keywords,
        }


@login_manager.user_loader
def load_user(user_id):
    return db.session.get(User, int(user_id))


# Many-to-many: Keywords <-> Projects
keyword_projects = db.Table(
    'keyword_projects',
    db.Column('keyword_id', db.Integer, db.ForeignKey('keywords.id', ondelete='CASCADE'), primary_key=True),
    db.Column('project_id', db.Integer, db.ForeignKey('projects.id', ondelete='CASCADE'), primary_key=True),
)


class AppSetting(db.Model):
    __tablename__ = "app_settings"
    __table_args__ = (
        db.UniqueConstraint('key', 'user_id', name='uq_appsetting_key_user'),
    )

    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(50), nullable=False)
    value = db.Column(db.Text, default="")
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)


class Keyword(db.Model):
    __tablename__ = "keywords"
    __table_args__ = (
        db.UniqueConstraint('keyword', 'timeframe', 'geo', 'gprop', 'user_id', name='uq_keyword_tf_geo_gprop_user'),
    )

    id = db.Column(db.Integer, primary_key=True)
    keyword = db.Column(db.String(255), nullable=False)
    geo = db.Column(db.String(10), default="DE", nullable=False)  # country code
    active = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    note = db.Column(db.Text, default="")
    detected_lang = db.Column(db.String(10), default="")
    translation_de = db.Column(db.String(255), default="")
    timeframe = db.Column(db.String(30), default="")   # "" = globale Einstellung verwenden
    gprop = db.Column(db.String(20), default="")       # "" | "news" | "images" | "youtube" | "froogle"
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)

    trends = db.relationship("TrendData", backref="keyword_ref", lazy=True,
                             cascade="all, delete-orphan")
    related_queries = db.relationship("RelatedQuery", backref="keyword_ref", lazy=True,
                                      cascade="all, delete-orphan")
    region_interests = db.relationship("RegionInterest", backref="keyword_ref", lazy=True,
                                       cascade="all, delete-orphan")
    kw_projects = db.relationship("Project", secondary=keyword_projects, lazy="subquery",
                                  backref=db.backref("kw_keywords", lazy=True))

    def to_dict(self):
        return {
            "id": self.id,
            "keyword": self.keyword,
            "geo": self.geo,
            "active": self.active,
            "created_at": self.created_at.isoformat(),
            "note": self.note,
            "detected_lang": self.detected_lang or "",
            "translation_de": self.translation_de or "",
            "timeframe": self.timeframe or "",
            "gprop": self.gprop or "",
            "project_ids": [p.id for p in self.kw_projects],
        }


class TrendData(db.Model):
    __tablename__ = "trend_data"

    id = db.Column(db.Integer, primary_key=True)
    keyword_id = db.Column(db.Integer, db.ForeignKey("keywords.id"), nullable=False)
    date = db.Column(db.DateTime, nullable=False)   # war db.Date; jetzt DateTime fur Stunden/Minuten-Granularitat
    value = db.Column(db.Integer, nullable=False)   # 0-100 Google Trends Index
    fetched_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    # Bezeichner fur parallele Abruf-Reihen (Leerstring = Standard-Tagesabruf)
    run_tag = db.Column(db.String(100), nullable=False, default="", server_default="")
    # Gemeinsame Abruf-Gruppe: Keywords mit gleichem fetch_group wurden in EINER
    # Google-Trends-Abfrage geholt und sind daher quantitativ vergleichbar.
    fetch_group = db.Column(db.String(100), nullable=True)

    __table_args__ = (
        # run_tag als Teil des Schlussels erlaubt mehrere Reihen je Keyword+Datum
        db.UniqueConstraint("keyword_id", "date", "run_tag", name="uq_keyword_date_run"),
    )

    def to_dict(self):
        d = self.date
        # Mitternacht -> nur Datum ausgeben (Ruckwartskompatibilitat)
        if isinstance(d, datetime) and d.hour == 0 and d.minute == 0 and d.second == 0:
            date_str = d.strftime("%Y-%m-%d")
        elif isinstance(d, datetime):
            date_str = d.strftime("%Y-%m-%dT%H:%M")
        else:
            date_str = str(d)
        return {
            "date": date_str,
            "value": self.value,
            "run_tag": self.run_tag,
            "fetch_group": self.fetch_group,
        }


class LlmLog(db.Model):
    __tablename__ = "llm_log"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    source = db.Column(db.String(50), default="")  # ai-analyze, ai-project-analyze, ai-keyword-suggestions, ai-intro-generate, ai-chat, apa-translate, apa-pick, apa-report
    detail = db.Column(db.String(255), default="")  # z.B. Keyword oder Projektname

    def to_dict(self):
        return {
            "id": self.id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "source": self.source,
            "detail": self.detail,
        }


class FetchLog(db.Model):
    __tablename__ = "fetch_log"

    id = db.Column(db.Integer, primary_key=True)
    started_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    finished_at = db.Column(db.DateTime)
    keywords_total = db.Column(db.Integer, default=0)
    keywords_ok = db.Column(db.Integer, default=0)
    keywords_failed = db.Column(db.Integer, default=0)
    errors = db.Column(db.Text, default="")
    status = db.Column(db.String(20), default="running")  # running | ok | partial | failed
    backend = db.Column(db.String(20), default="")  # serpapi | playwright | pytrends
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)

    def to_dict(self):
        return {
            "id": self.id,
            "started_at": self.started_at.isoformat(),
            "finished_at": self.finished_at.isoformat() if self.finished_at else None,
            "keywords_total": self.keywords_total,
            "keywords_ok": self.keywords_ok,
            "keywords_failed": self.keywords_failed,
            "errors": self.errors,
            "status": self.status,
            "backend": self.backend or "",
        }


class RelatedQuery(db.Model):
    __tablename__ = "related_queries"

    id = db.Column(db.Integer, primary_key=True)
    keyword_id = db.Column(
        db.Integer,
        db.ForeignKey("keywords.id", ondelete="CASCADE"),
        nullable=False,
    )
    query_type = db.Column(db.String(10), nullable=False)   # "rising" | "top"
    query = db.Column(db.String(255), nullable=False)
    value = db.Column(db.String(50), default="")            # "100", "Breakout", "1900%"
    rank = db.Column(db.Integer, default=0)
    fetched_at = db.Column(db.DateTime, nullable=False)

    def to_dict(self):
        return {
            "query": self.query,
            "value": self.value,
            "rank": self.rank,
            "fetched_at": self.fetched_at.isoformat(),
        }


class RegionInterest(db.Model):
    __tablename__ = "region_interest"

    id         = db.Column(db.Integer, primary_key=True)
    keyword_id = db.Column(db.Integer, db.ForeignKey("keywords.id", ondelete="CASCADE"),
                           nullable=False)
    resolution = db.Column(db.String(10), nullable=False)   # "REGION" | "CITY"
    geo_name   = db.Column(db.String(255), nullable=False)  # z. B. "Bavaria"
    geo_code   = db.Column(db.String(20), default="")       # z. B. "DE-BY"
    value      = db.Column(db.Integer, nullable=False)      # 0-100
    fetched_at = db.Column(db.DateTime, nullable=False)     # Batch-Zeitstempel
    run_tag    = db.Column(db.String(100), nullable=False, default="", server_default="")

    __table_args__ = (
        db.UniqueConstraint("keyword_id", "resolution", "geo_name", "fetched_at",
                            name="uq_region_kw_res_name_ts"),
        db.Index("ix_region_kw_res_ts", "keyword_id", "resolution", "fetched_at"),
    )

    def to_dict(self):
        return {
            "geo_name":   self.geo_name,
            "geo_code":   self.geo_code,
            "value":      self.value,
            "fetched_at": self.fetched_at.isoformat(),
            "run_tag":    self.run_tag or "",
        }


class Alert(db.Model):
    __tablename__ = "alerts"

    id         = db.Column(db.Integer, primary_key=True)
    name       = db.Column(db.String(100), nullable=False, default="")
    # "occurrence" | "disappearance" | "spike"
    alert_type = db.Column(db.String(20), nullable=False)
    # occurrence/disappearance: Wort, das in Verwandten Anfragen gesucht wird
    # spike: Wort im Keyword-Text (optional, um Keywords zu filtern)
    watch_term = db.Column(db.String(255), default="")
    # JSON-Liste von Keyword-IDs; "" = alle (Filterung uber watch_term)
    keyword_ids_json     = db.Column(db.Text, default="")
    spike_threshold      = db.Column(db.Integer, default=20)
    # "percent" = prozentualer Anstieg; "value" = absoluter Mindestwert
    spike_threshold_type = db.Column(db.String(10), default="percent")
    spike_hours          = db.Column(db.Integer, default=24)
    comment    = db.Column(db.Text, default="")
    active     = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.DateTime,
                            default=lambda: datetime.now(timezone.utc))
    user_id    = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)

    events = db.relationship("AlertEvent", backref="parent_alert", lazy=True,
                              cascade="all, delete-orphan")

    def to_dict(self):
        import json as _j
        last_ev = (AlertEvent.query
                   .filter_by(alert_id=self.id)
                   .order_by(AlertEvent.triggered_at.desc())
                   .first())
        unseen = AlertEvent.query.filter_by(alert_id=self.id, seen=False).count()
        return {
            "id":                   self.id,
            "name":                 self.name,
            "alert_type":           self.alert_type,
            "watch_term":           self.watch_term,
            "keyword_ids":          _j.loads(self.keyword_ids_json) if self.keyword_ids_json else [],
            "spike_threshold":      self.spike_threshold,
            "spike_threshold_type": self.spike_threshold_type,
            "spike_hours":          self.spike_hours,
            "comment":              self.comment or "",
            "active":               self.active,
            "created_at":           self.created_at.isoformat() if self.created_at else None,
            "last_triggered":       last_ev.triggered_at.isoformat() if last_ev else None,
            "unseen_count":         unseen,
        }


class AlertEvent(db.Model):
    __tablename__ = "alert_events"

    id           = db.Column(db.Integer, primary_key=True)
    alert_id     = db.Column(db.Integer, db.ForeignKey("alerts.id"), nullable=False)
    triggered_at = db.Column(db.DateTime,
                              default=lambda: datetime.now(timezone.utc))
    keyword_id   = db.Column(db.Integer, db.ForeignKey("keywords.id"), nullable=True)
    keyword_text = db.Column(db.String(255), default="")
    details_json = db.Column(db.Text, default="")
    seen         = db.Column(db.Boolean, default=False, nullable=False)

    def to_dict(self):
        import json as _j
        a = self.parent_alert
        return {
            "id":           self.id,
            "alert_id":     self.alert_id,
            "alert_name":   a.name       if a else "",
            "alert_type":   a.alert_type if a else "",
            "triggered_at": self.triggered_at.isoformat() if self.triggered_at else None,
            "keyword_id":   self.keyword_id,
            "keyword_text": self.keyword_text,
            "details":      _j.loads(self.details_json) if self.details_json else {},
            "seen":         self.seen,
        }


class Project(db.Model):
    __tablename__ = "projects"

    id          = db.Column(db.Integer, primary_key=True)
    name        = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, default="")
    briefing    = db.Column(db.Text, default="")
    color       = db.Column(db.String(20), default="#4f8ef7")
    sort_order  = db.Column(db.Integer, default=0, nullable=False)
    created_at  = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    user_id     = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)

    snapshots = db.relationship("Snapshot", backref="project", lazy=True)

    def to_dict(self):
        return {
            "id":             self.id,
            "name":           self.name,
            "description":    self.description or "",
            "briefing":       self.briefing or "",
            "color":          self.color or "#4f8ef7",
            "created_at":     self.created_at.isoformat() if self.created_at else None,
            "snapshot_count": len(self.snapshots),
        }


class Snapshot(db.Model):
    __tablename__ = "snapshots"

    id           = db.Column(db.Integer, primary_key=True)
    title        = db.Column(db.String(255), default="")
    comment      = db.Column(db.Text, default="")
    chart_json   = db.Column(db.Text, nullable=False)   # labels, datasets, keywords_meta, visible_range
    markers_json = db.Column(db.Text, default="[]")     # [{num, label_idx, label, comment}]
    sort_order   = db.Column(db.Integer, default=0, nullable=False)
    created_at   = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    project_id   = db.Column(db.Integer, db.ForeignKey("projects.id", ondelete="SET NULL"), nullable=True)
    user_id      = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    content_hash = db.Column(db.String(64), default="")  # SHA-256 Integritäts-Hash

    def compute_hash(self):
        """Berechnet SHA-256 über die inhaltlich relevanten Felder."""
        import hashlib
        payload = (
            (self.title or "") + "\n"
            + (self.comment or "") + "\n"
            + (self.chart_json or "") + "\n"
            + (self.markers_json or "[]") + "\n"
            + (self.created_at.isoformat() if self.created_at else "")
        )
        self.content_hash = hashlib.sha256(payload.encode("utf-8")).hexdigest()
        return self.content_hash

    def verify_hash(self):
        """Prüft ob der gespeicherte Hash mit dem aktuellen Inhalt übereinstimmt."""
        if not self.content_hash:
            return None  # kein Hash vorhanden
        import hashlib
        payload = (
            (self.title or "") + "\n"
            + (self.comment or "") + "\n"
            + (self.chart_json or "") + "\n"
            + (self.markers_json or "[]") + "\n"
            + (self.created_at.isoformat() if self.created_at else "")
        )
        expected = hashlib.sha256(payload.encode("utf-8")).hexdigest()
        return self.content_hash == expected

    def to_dict(self):
        import json as _j
        return {
            "id":           self.id,
            "title":        self.title or "",
            "comment":      self.comment or "",
            "chart":        _j.loads(self.chart_json) if self.chart_json else {},
            "markers":      _j.loads(self.markers_json) if self.markers_json else [],
            "project_id":   self.project_id,
            "created_at":   self.created_at.isoformat() if self.created_at else None,
            "content_hash": self.content_hash or "",
        }


class Slide(db.Model):
    """Eine Text-Zwischenseite innerhalb eines Projekts (Titelseite, Abschnitt, Karte, Website ...)."""
    __tablename__ = "slides"

    id          = db.Column(db.Integer, primary_key=True)
    project_id  = db.Column(db.Integer, db.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    slide_type  = db.Column(db.String(20), default="section", nullable=False)  # "title"|"section"|"maps"|"website"
    title       = db.Column(db.String(300), default="")
    description = db.Column(db.Text, default="")
    content     = db.Column(db.Text, default="")   # JSON - typ-spezifische Daten (embed_url, url, screenshot_b64 ...)
    sort_order  = db.Column(db.Integer, default=0, nullable=False)
    created_at  = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    project = db.relationship("Project", backref="slides")

    def to_dict(self):
        return {
            "id":          self.id,
            "item_type":   "slide",
            "project_id":  self.project_id,
            "slide_type":  self.slide_type,
            "title":       self.title or "",
            "description": self.description or "",
            "content":     self.content or "",
            "sort_order":  self.sort_order,
            "created_at":  self.created_at.isoformat() if self.created_at else None,
        }


class Event(db.Model):
    __tablename__ = "events"

    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, default="")
    event_type = db.Column(db.String(10), default="point")  # "point" | "range"
    start_dt = db.Column(db.DateTime, nullable=False)
    end_dt = db.Column(db.DateTime, nullable=True)
    color = db.Column(db.String(20), default="#f75f4f")
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    project_id = db.Column(db.Integer, db.ForeignKey("projects.id", ondelete="SET NULL"), nullable=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)

    def to_dict(self):
        def fmt(dt):
            if dt is None:
                return None
            if dt.hour == 0 and dt.minute == 0 and dt.second == 0:
                return dt.strftime("%Y-%m-%d")
            return dt.strftime("%Y-%m-%dT%H:%M")

        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "event_type": self.event_type,
            "start_dt": fmt(self.start_dt),
            "end_dt": fmt(self.end_dt),
            "color": self.color,
            "created_at": self.created_at.isoformat(),
            "project_id": self.project_id,
        }


class AuditEntry(db.Model):
    """Strukturierter Audit Trail mit Hash-Verkettung für forensische Nachweisbarkeit."""
    __tablename__ = "audit_trail"

    id          = db.Column(db.Integer, primary_key=True)
    created_at  = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    user_id     = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    project_id  = db.Column(db.Integer, db.ForeignKey("projects.id", ondelete="SET NULL"), nullable=True)
    action      = db.Column(db.String(50), nullable=False)     # z.B. keyword_fetch, snapshot_create, analysis_run, export_docx, apa_start
    object_type = db.Column(db.String(30), default="")         # z.B. keyword, snapshot, project, slide
    object_id   = db.Column(db.Integer, nullable=True)
    detail      = db.Column(db.Text, default="")               # JSON oder Freitext mit Kontextinfos
    content_hash = db.Column(db.String(64), default="")        # SHA-256 des betroffenen Objekts (falls vorhanden)
    prev_hash   = db.Column(db.String(64), default="")         # Hash des vorherigen Audit-Eintrags (Kette)
    entry_hash  = db.Column(db.String(64), default="")         # SHA-256 dieses Eintrags (inkl. prev_hash)

    user    = db.relationship("User", backref="audit_entries", lazy=True)
    project = db.relationship("Project", backref="audit_entries", lazy=True)

    def compute_entry_hash(self):
        """Berechnet den Hash dieses Eintrags inkl. Verkettung zum Vorgänger."""
        import hashlib
        payload = (
            (self.created_at.isoformat() if self.created_at else "") + "\n"
            + str(self.user_id or "") + "\n"
            + str(self.project_id or "") + "\n"
            + (self.action or "") + "\n"
            + (self.object_type or "") + "\n"
            + str(self.object_id or "") + "\n"
            + (self.detail or "") + "\n"
            + (self.content_hash or "") + "\n"
            + (self.prev_hash or "")
        )
        self.entry_hash = hashlib.sha256(payload.encode("utf-8")).hexdigest()
        return self.entry_hash

    def to_dict(self):
        return {
            "id":           self.id,
            "created_at":   self.created_at.isoformat() if self.created_at else None,
            "user_id":      self.user_id,
            "username":     self.user.display_name or self.user.username if self.user else None,
            "project_id":   self.project_id,
            "project_name": self.project.name if self.project else None,
            "action":       self.action,
            "object_type":  self.object_type or "",
            "object_id":    self.object_id,
            "detail":       self.detail or "",
            "content_hash": self.content_hash or "",
            "prev_hash":    self.prev_hash or "",
            "entry_hash":   self.entry_hash or "",
        }


class WatchZone(db.Model):
    """Geo-Beobachtungszone für Schiffe, Flugzeuge, Wetter etc."""
    __tablename__ = "watch_zones"

    id          = db.Column(db.Integer, primary_key=True)
    name        = db.Column(db.String(200), nullable=False, default="")
    zone_type   = db.Column(db.String(20), nullable=False)   # "vessel" | "aircraft" | "weather"
    # GeoJSON geometry (Polygon / Rectangle)
    geometry    = db.Column(db.Text, nullable=False, default="{}")
    # Quellenspezifische Konfiguration als JSON
    # z.B. {"source":"vesselfinder","interval_min":30,"ship_types":["cargo","tanker"]}
    config      = db.Column(db.Text, default="{}")
    active      = db.Column(db.Boolean, default=True, nullable=False)
    project_id  = db.Column(db.Integer, db.ForeignKey("projects.id", ondelete="SET NULL"), nullable=True)
    user_id     = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    created_at  = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    project = db.relationship("Project", backref="watch_zones")

    def to_dict(self):
        import json as _j
        return {
            "id":         self.id,
            "name":       self.name,
            "zone_type":  self.zone_type,
            "geometry":   _j.loads(self.geometry) if self.geometry else {},
            "config":     _j.loads(self.config) if self.config else {},
            "active":     self.active,
            "project_id": self.project_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class TracerouteResult(db.Model):
    """Gespeichertes Traceroute-Ergebnis einer Website-Watchzone."""
    __tablename__ = "traceroute_results"

    id            = db.Column(db.Integer, primary_key=True)
    zone_id       = db.Column(db.Integer, db.ForeignKey("watch_zones.id", ondelete="CASCADE"), nullable=False)
    user_id       = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    target        = db.Column(db.String(500), default="")
    hops_json     = db.Column(db.Text, default="[]")      # JSON-Array der Hop-Objekte
    anomalies_json= db.Column(db.Text, default="[]")      # JSON-Array der Anomalie-Objekte
    total_km      = db.Column(db.Float, nullable=True)
    last_rtt      = db.Column(db.Float, nullable=True)
    hops_count    = db.Column(db.Integer, default=0)
    hops_visible  = db.Column(db.Integer, default=0)
    hops_anon     = db.Column(db.Integer, default=0)
    created_at    = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    zone = db.relationship("WatchZone", backref=db.backref("traceroute_results", cascade="all, delete-orphan"))

    def to_dict(self):
        import json as _j
        return {
            "id":         self.id,
            "zone_id":    self.zone_id,
            "target":     self.target,
            "hops":       _j.loads(self.hops_json)      if self.hops_json      else [],
            "anomalies":  _j.loads(self.anomalies_json) if self.anomalies_json else [],
            "total_km":   self.total_km,
            "last_rtt":   self.last_rtt,
            "hops_count": self.hops_count,
            "hops_visible":self.hops_visible,
            "hops_anon":  self.hops_anon,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class WaitlistEntry(db.Model):
    """Interessenten-Registrierung für Launch-Benachrichtigung."""
    __tablename__ = "waitlist"

    id         = db.Column(db.Integer, primary_key=True)
    email      = db.Column(db.String(255), nullable=False, unique=True)
    name       = db.Column(db.String(120), default="")
    interest   = db.Column(db.String(50), default="")       # z.B. journalist, analyst, researcher, other
    created_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
