"""
Authentifizierungs-Abstraktionsschicht fuer Open-Core-Betrieb.

    MULTI_USER=true   → Enterprise: echtes Login, Multi-User, Rollen
    MULTI_USER=false   → Community:  Auto-Login als Phantom-User, kein Login noetig

Alle Module importieren login_required, current_user etc. aus diesem Modul
statt direkt aus flask_login.  Im Community-Modus sind die Dekoratoren
No-Ops und current_user zeigt immer auf den Phantom-User.
"""

import os
from functools import wraps

# Feature-Flag: "true" / "1" → Enterprise, alles andere → Community
MULTI_USER = os.getenv("MULTI_USER", "false").lower() in ("true", "1", "yes")

# ── Re-Exports (unveraendert in beiden Modi) ──────────────────────────────
from flask_login import current_user, login_user, logout_user  # noqa: F401

if MULTI_USER:
    # ── Enterprise-Modus: volle Flask-Login-Funktionalitaet ────────────────
    from flask_login import login_required  # noqa: F401

    def superadmin_required(f):
        """Nur Superadmins duerfen zugreifen."""
        @wraps(f)
        def decorated(*args, **kwargs):
            if not current_user.is_authenticated or not current_user.is_superadmin:
                from flask import abort
                abort(403)
            return f(*args, **kwargs)
        return decorated

    def init_auth(app):
        """Enterprise: login_view auf Blueprint-Endpoint setzen."""
        app.config["SQ_MULTI_USER"] = True
        from models import login_manager
        login_manager.login_view = "enterprise.login"

else:
    # ── Community-Modus: Auto-Login, Dekoratoren sind No-Ops ───────────────

    def login_required(f):
        """No-Op — jeder Request ist authentifiziert."""
        return f

    def superadmin_required(f):
        """No-Op — Community-User hat alle Rechte."""
        return f

    def init_auth(app):
        """Community: Phantom-User automatisch einloggen bei jedem Request."""
        app.config["SQ_MULTI_USER"] = False

        @app.before_request
        def _auto_login():
            if current_user.is_authenticated:
                return
            from models import User
            user = User.query.first()
            if user:
                login_user(user, remember=True)
