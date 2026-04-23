#!/usr/bin/env bash
# Corrido na Raspberry (arm64) via SSH a partir de deploy/from-host-to-pi.sh:
#   ssh … bash -s RDIR PORT SSH_USER NO_RESTART < deploy/pi-remote-cloudflared.sh
#
# Instala cloudflared em RDIR/deploy/.cloudflared/cloudflared (arm64),
# grava /etc/systemd/system/movies-app-cloudflared.service e, salvo NO_RESTART=1,
# reinicia movies-app.service e movies-app-cloudflared.service.
set -euo pipefail

RDIR="${1:?RDIR}"
PORT="${2:?PORT}"
USER_NAME="${3:?SSH_USER}"
NO_RESTART="${4:-0}"

CF_DIR="${RDIR}/deploy/.cloudflared"
CF_BIN="${CF_DIR}/cloudflared"

mkdir -p "$CF_DIR"
if [[ ! -x "$CF_BIN" ]]; then
  echo "→ A descarregar cloudflared (linux-arm64) para ${CF_BIN} …"
  curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64" -o "${CF_BIN}.part"
  chmod +x "${CF_BIN}.part"
  mv -f "${CF_BIN}.part" "$CF_BIN"
fi

sudo tee /etc/systemd/system/movies-app-cloudflared.service >/dev/null <<UNIT
[Unit]
Description=Cloudflare Quick Tunnel (HTTPS) Nossa Lista
After=network-online.target movies-app.service
Wants=network-online.target

[Service]
Type=simple
User=${USER_NAME}
ExecStart=${CF_BIN} tunnel --url http://127.0.0.1:${PORT}
Restart=on-failure
RestartSec=8

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable movies-app-cloudflared.service

if [[ "$NO_RESTART" != "1" ]]; then
  sudo systemctl restart movies-app.service
  sudo systemctl restart movies-app-cloudflared.service
else
  echo "! NO_RESTART=1 — não reiniciei movies-app nem movies-app-cloudflared."
  echo "  Na Pi: sudo systemctl restart movies-app.service movies-app-cloudflared.service"
fi

sudo systemctl --no-pager status movies-app.service --lines=4 || true
echo ""
sudo systemctl --no-pager status movies-app-cloudflared.service --lines=12 || true
echo ""
echo "→ URL HTTPS: sudo journalctl -u movies-app-cloudflared -n 30 --no-pager  (ou -f em tempo real)"
