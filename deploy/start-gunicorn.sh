#!/usr/bin/env bash
# Iniciado pelo systemd; variáveis vêm de EnvironmentFile=/etc/movies-app.env e MOVIES_APP_DIR no unit.
set -euo pipefail

APP_DIR="${MOVIES_APP_DIR:?MOVIES_APP_DIR não definido no unit systemd}"
cd "$APP_DIR"

# 0.0.0.0 = aceita conexões da rede local (LAN). 127.0.0.1 só na própria máquina.
BIND="${FLASK_BIND:-0.0.0.0:8080}"
# SSE em memória: um único worker evita ouvintes em processos diferentes.
# Ajuste GUNICORN_WORKERS se no futuro migrar pub/sub (ex.: Redis).
WORKERS="${GUNICORN_WORKERS:-1}"

exec "${APP_DIR}/.venv/bin/gunicorn" \
  --worker-class gthread \
  --workers "${WORKERS}" \
  --threads "${GUNICORN_THREADS:-4}" \
  --timeout 120 \
  --bind "${BIND}" \
  --access-logfile - \
  --error-logfile - \
  "app:app"
