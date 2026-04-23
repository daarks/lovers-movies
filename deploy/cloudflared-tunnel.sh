#!/usr/bin/env bash
# Túnel HTTPS público grátis (Cloudflare Quick Tunnel) → backend local (Gunicorn/Flask).
# Não precisa de domínio próprio; o URL é tipo https://xxxx.trycloudflare.com (muda
# em cada execução do modo "quick", salvo túnel nomeado na conta Cloudflare).
#
# Uso:
#   ./deploy/cloudflared-tunnel.sh
#   ./deploy/cloudflared-tunnel.sh http://127.0.0.1:8080
#
# Instalação rápida do binário (escolha a arquitectura; veja a tua com: uname -m):
#   aarch64 / arm64 (Raspberry Pi 64-bit):
#     curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64" -o /tmp/cloudflared && chmod +x /tmp/cloudflared && sudo mv /tmp/cloudflared /usr/local/bin/cloudflared
#   armv7l (Pi 32-bit):
#     curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm" -o /tmp/cloudflared && chmod +x /tmp/cloudflared && sudo mv /tmp/cloudflared /usr/local/bin/cloudflared
#   x86_64 (PC Linux):
#     curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64" -o /tmp/cloudflared && chmod +x /tmp/cloudflared && sudo mv /tmp/cloudflared /usr/local/bin/cloudflared
#
# Documentação: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_CF="${SCRIPT_DIR}/.cloudflared/cloudflared"

UP="${1:-http://127.0.0.1:8080}"

CF_EXE=""
if [[ -x "$LOCAL_CF" ]]; then
  CF_EXE="$LOCAL_CF"
elif command -v cloudflared >/dev/null 2>&1; then
  CF_EXE="$(command -v cloudflared)"
else
  echo ""
  echo "cloudflared não encontrado (nem em deploy/.cloudflared/ nem no PATH)."
  echo "No PC: ./deploy/local-host-up.sh descarrega amd64 automaticamente; na Pi: ./deploy/from-host-to-pi.sh."
  echo "Manual: comandos curl no cabeçalho deste script."
  echo "Página oficial: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
  exit 1
fi

echo ""
echo "→ A iniciar túnel Cloudflare (Quick Tunnel) para $UP …"
echo "  Aguarde: o Chrome mostrará um URL https://....trycloudflare.com abaixo — use-o nos outros dispositivos (PWA / HTTPS)."
echo ""

exec "$CF_EXE" tunnel --url "$UP"
