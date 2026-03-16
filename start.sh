#!/usr/bin/env bash
# Startet den VeriTrend
# Entwicklung: direkt mit Flask
# Produktion:  mit gunicorn (empfohlen)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Virtuelle Umgebung anlegen falls nicht vorhanden
if [ ! -d "venv" ]; then
  echo "Lege virtuelle Umgebung an…"
  python3 -m venv venv
fi

source venv/bin/activate
pip install -q -r requirements.txt

# Umgebungsvariablen (optional überschreiben)
export FLASK_APP=app.py
export FLASK_ENV=${FLASK_ENV:-production}
export FETCH_HOUR=${FETCH_HOUR:-6}
export FETCH_MINUTE=${FETCH_MINUTE:-0}
# export DATABASE_URL=postgresql://user:pass@host/db  # für PostgreSQL

if [ "${1}" = "dev" ]; then
  echo "Starte im Entwicklungsmodus auf http://localhost:5000"
  FLASK_ENV=development python app.py
else
  echo "Starte mit gunicorn auf http://0.0.0.0:5000"
  gunicorn \
    --bind 0.0.0.0:5000 \
    --workers 1 \
    --threads 4 \
    --timeout 120 \
    --preload \
    app:app
fi
