#!/usr/bin/env bash
#
# Build no PC (host) e envia os assets estáticos para a Raspberry via SSH/rsync.
# Pensado para placas com pouca RAM (ex.: Pi Zero 2W ~512 MB), onde
# "npm run build" (Vite) costuma falhar com "JavaScript heap out of memory".
#
# Uso (na raiz do repo, SEM sudo):
#   ./install-rpi.sh from-host
#
# Variáveis (opcionais):
#   MOVIES_APP_SSH          destino SSH (padrão: gabeevi@raspberrypi.local)
#   MOVIES_APP_REMOTE_DIR   raiz do repositório NA PI (padrão: \$HOME/movies-app do usuário remoto)
#   MOVIES_APP_RSYNC_EXTRA  ex.: "-e ssh -i ~/.ssh/id_pi"
#
# Flags:
#   --sync-only   não roda npm ci/build (só rsync do que já existe em app/static/build/)
#   --no-restart  não executa systemctl restart na Pi
#   -h, --help    ajuda
#
set -euo pipefail

RED='\033[0;31m'
GRN='\033[0;32m'
YLW='\033[0;33m'
RST='\033[0m'

die() { echo -e "${RED}Erro:${RST} $*" >&2; exit 1; }
info() { echo -e "${GRN}→${RST} $*"; }
warn() { echo -e "${YLW}!${RST} $*"; }

usage() {
  cat <<'EOF'
Build no PC e envia app/static/build/ (+ sw.js) para a Raspberry via SSH/rsync.

Uso:
  ./install-rpi.sh from-host [opções]

Variáveis de ambiente:
  MOVIES_APP_SSH          padrão: gabeevi@raspberrypi.local
  MOVIES_APP_REMOTE_DIR   raiz do repo na Pi (padrão: <HOME remoto>/movies-app)
  MOVIES_APP_RSYNC_EXTRA  texto extra entre os args do rsync (ex.: -e "ssh -i ...")

Opções:
  --sync-only     só rsync (pula npm ci && npm run build)
  --no-restart    não reinicia movies-app.service na Pi
  -h, --help      esta ajuda
EOF
}

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DEPLOY_DIR/.." && pwd)"
FRONTEND_DIR="$REPO_ROOT/frontend"
BUILD_DIR="$REPO_ROOT/app/static/build"
SW_FILE="$REPO_ROOT/app/static/sw.js"

MOVIES_APP_SSH="${MOVIES_APP_SSH:-gabeevi@raspberrypi.local}"

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
  info "Detectando HOME na Pi (MOVIES_APP_REMOTE_DIR não definido)…"
  _rh="$("${SSH_BASE[@]}" "$MOVIES_APP_SSH" 'printf %s "$HOME"')" || die "SSH falhou para $MOVIES_APP_SSH (chave ou rede?)"
  RDIR="$_rh/movies-app"
  info "Usando raiz remota: $RDIR (exporte MOVIES_APP_REMOTE_DIR se o clone estiver noutro lugar)"
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

info "Enviando app/static/build/ …"
"${RSYNC[@]}" "$BUILD_DIR/" "$MOVIES_APP_SSH:$RDIR/app/static/build/"

if [[ -f "$SW_FILE" ]]; then
  info "Enviando app/static/sw.js …"
  "${RSYNC[@]}" "$SW_FILE" "$MOVIES_APP_SSH:$RDIR/app/static/sw.js"
fi

if [[ "$NO_RESTART" == "1" ]]; then
  warn "--no-restart: não reiniciei o serviço na Pi."
  echo "Na Pi: sudo systemctl restart movies-app.service"
else
  info "Reiniciando movies-app.service na Pi…"
  # -t permite sudo pedir senha, se necessário
  "${SSH_BASE[@]}" -t "$MOVIES_APP_SSH" "sudo systemctl restart movies-app.service && sudo systemctl --no-pager status movies-app.service || true"
fi

echo ""
echo -e "${GRN}Deploy do frontend concluído.${RST}"
echo "  URL típica: http://raspberrypi.local:8080 (ou o IP da Pi)"
echo "  Se o repo não estiver em ~/movies-app, defina: export MOVIES_APP_REMOTE_DIR=/caminho/absoluto/na/pi"
