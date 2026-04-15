#!/usr/bin/env bash
# Iniciado pelo systemd; variáveis vêm de EnvironmentFile=/etc/movies-app.env e MOVIES_APP_DIR no unit.
set -euo pipefail

APP_DIR="${MOVIES_APP_DIR:?MOVIES_APP_DIR não definido no unit systemd}"
cd "$APP_DIR"

# 0.0.0.0 = aceita conexões da rede local (LAN). 127.0.0.1 só na própria máquina.
BIND="${FLASK_BIND:-0.0.0.0:8080}"
WORKERS="${GUNICORN_WORKERS:-2}"

exec "${APP_DIR}/.venv/bin/gunicorn" \
  --workers "${WORKERS}" \
  --threads 1 \
  --timeout 120 \
  --bind "${BIND}" \
  --access-logfile - \
  --error-logfile - \
  "app:app"
