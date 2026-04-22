#!/usr/bin/env bash
#
# No seu PC (host): cria/atualiza o venv Python, compila o frontend (Vite) e
# sobe o app com Gunicorn — mesmo fluxo mental do install-rpi.sh, sem systemd.
#
# Uso (na raiz do repo, sem sudo):
#   ./deploy/local-host-up.sh
#
# Pré-requisito: secrets.env na raiz (copie de secrets.example).
#
# Variáveis opcionais (além das do secrets.env):
#   SKIP_FRONTEND=1     não roda npm ci / npm run build
#   SKIP_PIP=1          não roda pip install -r requirements.txt
#   FLASK_BIND          padrão se ausente em secrets.env: 0.0.0.0:8080
#
# Flags:
#   --skip-frontend   equivalente a SKIP_FRONTEND=1
#   --skip-pip        equivalente a SKIP_PIP=1
#   -h, --help        ajuda
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
Compila o frontend, prepara o venv em app/.venv e sobe Gunicorn neste PC.

Uso:
  ./deploy/local-host-up.sh [opções]

Requisito:
  secrets.env na raiz do repositório (cp secrets.example secrets.env)

Opções:
  --skip-frontend   pula npm ci && npm run build
  --skip-pip        pula pip install -r requirements.txt
  -h, --help        esta ajuda

Variáveis de ambiente:
  SKIP_FRONTEND=1   mesmo que --skip-frontend
  SKIP_PIP=1        mesmo que --skip-pip
EOF
}

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DEPLOY_DIR/.." && pwd)"
APP_DIR="$REPO_ROOT/app"
FRONTEND_DIR="$REPO_ROOT/frontend"
SECRETS_SRC="$REPO_ROOT/secrets.env"
REQ_FILE="$APP_DIR/requirements.txt"

SKIP_FRONTEND="${SKIP_FRONTEND:-0}"
SKIP_PIP="${SKIP_PIP:-0}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --skip-frontend) SKIP_FRONTEND=1 ;;
    --skip-pip) SKIP_PIP=1 ;;
    *) die "Argumento desconhecido: $1 (use --help)" ;;
  esac
  shift
done

[[ -f "$APP_DIR/app.py" ]] || die "Não achei app.py em: $APP_DIR"
[[ -f "$DEPLOY_DIR/start-gunicorn.sh" ]] || die "Pasta deploy incompleta em: $DEPLOY_DIR"
[[ -f "$SECRETS_SRC" ]] || die "Crie secrets.env na raiz: cp $REPO_ROOT/secrets.example $REPO_ROOT/secrets.env"

# Carrega secrets.env no ambiente (linhas KEY=VAL; ignora comentários e vazias).
load_env_from_secrets() {
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "${line//[[:space:]]/}" ]] && continue
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" == *"="* ]] || continue
    key="${line%%=*}"
    val="${line#*=}"
    key="${key%"${key##*[![:space:]]}"}"
    [[ -n "$key" ]] || continue
    export "${key}=${val}"
  done < "$SECRETS_SRC"

  export FLASK_BIND="${FLASK_BIND:-0.0.0.0:8080}"
  export GUNICORN_WORKERS="${GUNICORN_WORKERS:-1}"
  _sk="${SECRET_KEY-}"
  if [[ -z "$_sk" || -z "${_sk//[[:space:]]/}" ]]; then
    if command -v openssl >/dev/null 2>&1; then
      export SECRET_KEY="$(openssl rand -hex 32)"
    else
      export SECRET_KEY="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
    fi
    warn "Flask SECRET_KEY ausente em secrets.env (é outra coisa das chaves TMDB/Gemini). Gerando uma só para esta execução — para fixar, adicione SECRET_KEY=... ao arquivo ou rode sudo ./install-rpi.sh na Pi (ele grava em /etc/movies-app.env)."
  fi
}

print_urls_banner() {
  local bind="${FLASK_BIND:-0.0.0.0:8080}"
  local host_part="${bind%:*}"
  local port="${bind##*:}"
  [[ "$port" == "$bind" ]] && port="8080"
  local lan_ip
  lan_ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  echo ""
  echo -e "${GRN}App no ar (Gunicorn).${RST} Aperte Ctrl+C para encerrar."
  echo -e "${CYN}URLs (conforme FLASK_BIND=${bind}):${RST}"
  echo "  - Nesta máquina:     http://127.0.0.1:${port}"
  if [[ "$host_part" == "0.0.0.0" ]] || [[ "$host_part" == "*" ]]; then
    if [[ -n "${lan_ip:-}" ]]; then
      echo "  - Outros na mesma rede: http://${lan_ip}:${port}"
    else
      echo "  - Outros na mesma rede: http://<IP-deste-PC>:${port}"
    fi
  else
    echo "  (Bind ${host_part} — só escuta nesse endereço; ajuste FLASK_BIND em secrets.env para 0.0.0.0:${port} se quiser a LAN.)"
  fi
  echo ""
}

load_env_from_secrets
export MOVIES_APP_DIR="$APP_DIR"
chmod +x "$DEPLOY_DIR/start-gunicorn.sh" 2>/dev/null || true

# --- Python venv ---
if [[ ! -d "$APP_DIR/.venv" ]]; then
  info "Criando venv em $APP_DIR/.venv …"
  python3 -m venv "$APP_DIR/.venv"
fi
if [[ "$SKIP_PIP" != "1" ]]; then
  info "pip install -r requirements.txt …"
  "$APP_DIR/.venv/bin/pip" install -q --upgrade pip
  "$APP_DIR/.venv/bin/pip" install -q -r "$REQ_FILE"
else
  warn "SKIP_PIP=1 — pulando pip install."
fi

# --- Frontend ---
if [[ "$SKIP_FRONTEND" != "1" ]]; then
  if ! command -v node >/dev/null 2>&1; then
    die "Node.js não encontrado. Instale Node 18+ ou rode com SKIP_FRONTEND=1 se já tiver build."
  fi
  _major="$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)"
  [[ "$_major" -ge 18 ]] || die "Node.js >= 18 necessário (atual: $(node -v 2>/dev/null || echo desconhecido))"
  info "npm ci (frontend)…"
  (cd "$FRONTEND_DIR" && npm ci --no-audit --no-fund)
  info "npm run build (Vite → app/static/build/)…"
  (cd "$FRONTEND_DIR" && npm run build)
  info "Build do frontend em $APP_DIR/static/build/"
else
  warn "SKIP_FRONTEND=1 — pulando npm ci/build."
  [[ -f "$APP_DIR/static/build/manifest.json" ]] || die "manifest.json ausente — faça o build do frontend ou rode sem --skip-frontend."
fi

cd "$APP_DIR"
print_urls_banner

# Reusa o mesmo script usado pelo systemd na Pi (gthread + GUNICORN_THREADS).
# SSE precisa de gthread senão uma conexão longa bloqueia o worker síncrono
# e o resto do site congela até o stream fechar.
export GUNICORN_THREADS="${GUNICORN_THREADS:-4}"
exec "$DEPLOY_DIR/start-gunicorn.sh"
