#!/usr/bin/env bash
#
# Build no PC (host) e envia o bundle Vite + PWA (sw.js, manifest, ícones PNG) e,
# por defeito, app/app.py e app/templates/base.html (rota /sw.js, registo do service worker).
# Pensado para placas com pouca RAM (ex.: Pi Zero 2W ~512 MB), onde
# "npm run build" (Vite) costuma falhar com "JavaScript heap out of memory".
#
# HTTPS sem domínio (defeito): após o rsync, instala cloudflared linux-arm64 em
# deploy/.cloudflared/, grava systemd movies-app-cloudflared e reinicia app + túnel
# (salvo --no-restart ou SKIP_PI_CLOUDFLARED=1). Com domínio próprio: nginx-https.example.conf
#
# Só estáticos (sem sobrescrever app.py):
#   FROM_HOST_ONLY_STATIC=1 ./install-rpi.sh from-host
#
# Uso (na raiz do repo, SEM sudo):
#   ./install-rpi.sh from-host
#
# Variáveis (opcionais):
#   MOVIES_APP_SSH          destino SSH (padrão: gabeevi@raspberrypi.local)
#   MOVIES_APP_REMOTE_DIR   raiz do repositório NA PI (padrão: /home/gabeevi/lovers-movies)
#   MOVIES_APP_RSYNC_EXTRA  ex.: "-e ssh -i ~/.ssh/id_pi"
#
# Flags:
#   --sync-only   não roda npm ci/build (só rsync do que já existe em app/static/build/)
#   --no-restart  não reinicia movies-app nem o túnel na Pi (SKIP_PI_CLOUDFLARED=0)
#   -h, --help    ajuda
#
set -euo pipefail

RED='\033[0;31m'
GRN='\033[0;32m'
YLW='\033[0;33m'
CYN='\033[0;36m'
RST='\033[0m'

die() { echo -e "${RED}Erro:${RST} $*" >&2; exit 1; }
info() { echo -e "${GRN}→${RST} $*"; }
warn() { echo -e "${YLW}!${RST} $*"; }

usage() {
  cat <<'EOF'
Build no PC e envia app/static/build/, PWA (sw.js, manifest, PNG) e, salvo
FROM_HOST_ONLY_STATIC=1, app/app.py + base.html para a Raspberry via SSH/rsync.

Uso:
  ./install-rpi.sh from-host [opções]

Variáveis de ambiente:
  MOVIES_APP_SSH          padrão: gabeevi@raspberrypi.local
  MOVIES_APP_REMOTE_DIR   raiz do repo na Pi (padrão: /home/gabeevi/lovers-movies)
  MOVIES_APP_RSYNC_EXTRA  texto extra entre os args do rsync (ex.: -e "ssh -i ...")
  FROM_HOST_ONLY_STATIC=1  não envia app.py nem base.html (só build + ficheiros PWA em static/)
  SKIP_PI_CLOUDFLARED=1  não instala/configura túnel HTTPS na Pi (só rsync + restart movies-app se aplicável)

Opções:
  --sync-only     só rsync (pula npm ci && npm run build)
  --no-restart    não reinicia movies-app nem movies-app-cloudflared na Pi
  -h, --help      esta ajuda
EOF
}

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DEPLOY_DIR/.." && pwd)"
FRONTEND_DIR="$REPO_ROOT/frontend"
BUILD_DIR="$REPO_ROOT/app/static/build"
STATIC_DIR="$REPO_ROOT/app/static"
SW_FILE="$STATIC_DIR/sw.js"
APP_PY_FILE="$REPO_ROOT/app/app.py"
BASE_HTML_FILE="$REPO_ROOT/app/templates/base.html"

MOVIES_APP_SSH="${MOVIES_APP_SSH:-gabeevi@raspberrypi.local}"
FROM_HOST_ONLY_STATIC="${FROM_HOST_ONLY_STATIC:-0}"
SKIP_PI_CLOUDFLARED="${SKIP_PI_CLOUDFLARED:-0}"

SYNC_ONLY=0
NO_RESTART=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --sync-only) SYNC_ONLY=1 ;;
    --no-restart) NO_RESTART=1 ;;
    *) die "Argumento desconhecido: $1 (use --help)" ;;
  esac
  shift
done

[[ -f "$FRONTEND_DIR/package.json" ]] || die "Não achei frontend/package.json em $FRONTEND_DIR"
[[ -f "$REPO_ROOT/app/app.py" ]] || die "Não achei app/app.py — confira REPO_ROOT=$REPO_ROOT"

RSYNC=(rsync -avz --delete)
if [[ -n "${MOVIES_APP_RSYNC_EXTRA:-}" ]]; then
  # shellcheck disable=SC2206
  RSYNC+=($MOVIES_APP_RSYNC_EXTRA)
fi

SSH_BASE=(ssh -o ConnectTimeout=20)

if [[ -n "${MOVIES_APP_REMOTE_DIR:-}" ]]; then
  RDIR="${MOVIES_APP_REMOTE_DIR%/}"
else
  RDIR="/home/gabeevi/lovers-movies"
  info "Usando raiz remota padrão: $RDIR (exporte MOVIES_APP_REMOTE_DIR para outro caminho)"
fi

info "Destino: $MOVIES_APP_SSH:$RDIR"
info "Verificando pasta app/ na Pi…"
"${SSH_BASE[@]}" "$MOVIES_APP_SSH" "test -d \"$RDIR/app\"" \
  || die "Pasta remota inexistente: $RDIR/app — ajuste MOVIES_APP_REMOTE_DIR (ex.: export MOVIES_APP_REMOTE_DIR=/home/gabeevi/codes/movies-app)"

if [[ "$SYNC_ONLY" == "0" ]]; then
  if ! command -v node >/dev/null 2>&1; then
    die "Node.js não encontrado no PATH desta máquina. Instale Node 18+ e rode de novo."
  fi
  _major="$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)"
  [[ "$_major" -ge 18 ]] || die "Node.js >= 18 necessário no host (atual: $(node -v 2>/dev/null || echo desconhecido))"

  info "npm ci (frontend)…"
  (cd "$FRONTEND_DIR" && npm ci --no-audit --no-fund)

  info "npm run build (Vite → app/static/build/)…"
  (cd "$FRONTEND_DIR" && npm run build)
else
  warn "--sync-only: usando build já existente em $BUILD_DIR"
fi

[[ -f "$BUILD_DIR/manifest.json" ]] || die "manifest.json ausente em $BUILD_DIR — rode sem --sync-only ou faça o build antes."

# PWA: ficheiros obrigatórios (além do build Vite)
for _pwa in manifest.webmanifest pwa-192.png pwa-512.png; do
  [[ -f "$STATIC_DIR/$_pwa" ]] || die "PWA: falta $STATIC_DIR/$_pwa"
done
[[ -f "$SW_FILE" ]] || die "Falta $SW_FILE"

info "Enviando app/static/build/ …"
"${RSYNC[@]}" "$BUILD_DIR/" "$MOVIES_APP_SSH:$RDIR/app/static/build/"

# Ficheiros PWA e estáticos partilhados (rsync avulso, sem --delete no destino pai)
RSYNC_FILE=(rsync -avz)
if [[ -n "${MOVIES_APP_RSYNC_EXTRA:-}" ]]; then
  # shellcheck disable=SC2206
  RSYNC_FILE+=($MOVIES_APP_RSYNC_EXTRA)
fi

info "Enviando PWA (sw.js, manifest, ícones, offline)…"
"${RSYNC_FILE[@]}" "$SW_FILE" "$MOVIES_APP_SSH:$RDIR/app/static/sw.js"
"${RSYNC_FILE[@]}" "$STATIC_DIR/manifest.webmanifest" "$MOVIES_APP_SSH:$RDIR/app/static/manifest.webmanifest"
"${RSYNC_FILE[@]}" "$STATIC_DIR/pwa-192.png" "$MOVIES_APP_SSH:$RDIR/app/static/pwa-192.png"
"${RSYNC_FILE[@]}" "$STATIC_DIR/pwa-512.png" "$MOVIES_APP_SSH:$RDIR/app/static/pwa-512.png"
if [[ -f "$STATIC_DIR/offline.html" ]]; then
  "${RSYNC_FILE[@]}" "$STATIC_DIR/offline.html" "$MOVIES_APP_SSH:$RDIR/app/static/offline.html"
fi

info "Enviando scripts de túnel HTTPS (Cloudflare, grátis)…"
"${SSH_BASE[@]}" "$MOVIES_APP_SSH" "mkdir -p \"$RDIR/deploy\""
"${RSYNC_FILE[@]}" "$DEPLOY_DIR/cloudflared-tunnel.sh" "$MOVIES_APP_SSH:$RDIR/deploy/cloudflared-tunnel.sh"
"${RSYNC_FILE[@]}" "$DEPLOY_DIR/movies-app-cloudflared.service.example" "$MOVIES_APP_SSH:$RDIR/deploy/movies-app-cloudflared.service.example"
"${RSYNC_FILE[@]}" "$DEPLOY_DIR/pi-remote-cloudflared.sh" "$MOVIES_APP_SSH:$RDIR/deploy/pi-remote-cloudflared.sh"
"${SSH_BASE[@]}" "$MOVIES_APP_SSH" "chmod +x \"$RDIR/deploy/cloudflared-tunnel.sh\""

if [[ "$FROM_HOST_ONLY_STATIC" != "1" ]]; then
  info "Enviando app.py e base.html (rota /sw.js, PWA)…"
  "${RSYNC_FILE[@]}" "$APP_PY_FILE" "$MOVIES_APP_SSH:$RDIR/app/app.py"
  "${RSYNC_FILE[@]}" "$BASE_HTML_FILE" "$MOVIES_APP_SSH:$RDIR/app/templates/base.html"
else
  warn "FROM_HOST_ONLY_STATIC=1 — não enviei app.py nem base.html. Garanta git pull na Pi se precisar da rota /sw.js."
fi

# --- FLASK_BIND na Pi + utilizador SSH (túnel systemd corre como User=…) ---
_pi_ip="$("${SSH_BASE[@]}" "$MOVIES_APP_SSH" 'hostname -I 2>/dev/null | awk "{print \$1}"' 2>/dev/null || true)"
_pi_bind="$("${SSH_BASE[@]}" "$MOVIES_APP_SSH" 'grep ^FLASK_BIND= /etc/movies-app.env 2>/dev/null | tail -1 | cut -d= -f2-' 2>/dev/null || true)"
_pi_bind="${_pi_bind:-0.0.0.0:8080}"
_pi_host="${_pi_bind%:*}"
_pi_port="${_pi_bind##*:}"
[[ "$_pi_port" == "$_pi_bind" ]] && _pi_port="8080"

if [[ "$MOVIES_APP_SSH" == *@* ]]; then
  SSH_USER_NAME="${MOVIES_APP_SSH%%@*}"
else
  SSH_USER_NAME="$("${SSH_BASE[@]}" "$MOVIES_APP_SSH" "whoami" 2>/dev/null || true)"
  [[ -n "${SSH_USER_NAME:-}" ]] || SSH_USER_NAME="gabeevi"
fi

if [[ "$SKIP_PI_CLOUDFLARED" != "1" ]]; then
  [[ -f "$DEPLOY_DIR/pi-remote-cloudflared.sh" ]] || die "Falta deploy/pi-remote-cloudflared.sh"
  info "Pi (arm64): cloudflared em ${RDIR}/deploy/.cloudflared/ + systemd movies-app-cloudflared …"
  # -t para sudo pedir senha; o script remoto reinicia movies-app e o túnel (salvo NO_RESTART=1)
  "${SSH_BASE[@]}" -t "$MOVIES_APP_SSH" bash -s "$RDIR" "$_pi_port" "$SSH_USER_NAME" "$NO_RESTART" <"$DEPLOY_DIR/pi-remote-cloudflared.sh"
else
  if [[ "$NO_RESTART" == "1" ]]; then
    warn "--no-restart: não reiniciei movies-app.service na Pi."
    echo "Na Pi: sudo systemctl restart movies-app.service"
  else
    info "Reiniciando movies-app.service na Pi (SKIP_PI_CLOUDFLARED=1, sem túnel)…"
    "${SSH_BASE[@]}" -t "$MOVIES_APP_SSH" "sudo systemctl restart movies-app.service && sudo systemctl --no-pager status movies-app.service || true"
  fi
fi

echo ""
echo -e "${GRN}Deploy (frontend + PWA) concluído.${RST}"
if [[ "$SKIP_PI_CLOUDFLARED" != "1" ]]; then
  echo -e "${YLW}HTTPS (Cloudflare Quick Tunnel):${RST} o serviço movies-app-cloudflared está activo; veja o URL em:"
  echo "  ssh $MOVIES_APP_SSH 'sudo journalctl -u movies-app-cloudflared -n 40 --no-pager'"
  echo "  (em tempo real: sudo journalctl -u movies-app-cloudflared -f na Pi)"
else
  echo -e "${YLW}SKIP_PI_CLOUDFLARED=1:${RST} não configurei o túnel; para HTTPS sem domínio rode de novo sem essa variável ou veja deploy/cloudflared-tunnel.sh na Pi."
fi
echo -e "${YLW}Com domínio próprio + Nginx:${RST} deploy/nginx-https.example.conf"
echo -e "${CYN}URLs HTTP na Raspberry (FLASK_BIND na Pi = ${_pi_bind}):${RST}"
echo "  - Na própria Pi:     http://127.0.0.1:${_pi_port}"
if [[ "$_pi_host" == "0.0.0.0" ]] || [[ "$_pi_host" == "*" ]]; then
  if [[ -n "${_pi_ip:-}" ]]; then
    echo "  - Na sua rede:      http://${_pi_ip}:${_pi_port}"
  fi
  echo "  - Hostname .local:  http://$(printf '%s' "$MOVIES_APP_SSH" | sed 's/.*@//'):${_pi_port}  (se mDNS responder)"
else
  echo "  (Serviço escutando em ${_pi_host}:${_pi_port} — só acessível conforme essa interface na Pi.)"
fi
echo ""
echo "  Se o repo não estiver em /home/gabeevi/lovers-movies: export MOVIES_APP_REMOTE_DIR=/caminho/absoluto/na/pi"
