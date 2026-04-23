#!/usr/bin/env bash
#
# No seu PC (host): cria/atualiza o venv Python, compila o frontend (Vite),
# valida arquivos PWA em app/static/, verifica sintaxe de app.py e sobe o app
# com Gunicorn (gthread) — mesmo fluxo mental do install-rpi.sh, sem systemd.
#
# PWA: o service worker é servido em /sw.js (Flask); em HTTP puro o Chrome pode
# não oferecer “Instalar”. Sem domínio próprio, o modo mais simples é HTTPS via
# Cloudflare Quick Tunnel (cloudflared) — ativo por padrão (USE_CLOUDFLARE_TUNNEL=1).
# Se não houver cloudflared no PATH, baixa linux-amd64 para deploy/.cloudflared/.
# Para só HTTP local: USE_CLOUDFLARE_TUNNEL=0 ./deploy/local-host-up.sh
# Com domínio + Nginx: deploy/nginx-https.example.conf
#
# Uso (na raiz do repo, sem sudo):
#   ./deploy/local-host-up.sh
#
# Pré-requisito: secrets.env na raiz (copie a partir de secrets.example).
#
# Variáveis opcionais (além das do secrets.env):
#   SKIP_FRONTEND=1     não roda npm ci / npm run build
#   SKIP_PIP=1          não roda pip install -r requirements.txt
#   FLASK_BIND          padrão se ausente em secrets.env: 0.0.0.0:8080
#   USE_CLOUDFLARE_TUNNEL=0  não inicia cloudflared (só Gunicorn em HTTP)
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
# Mensagens em stderr: funções usadas dentro de $() não podem poluir stdout (ex.: caminho do cloudflared).
info() { echo -e "${GRN}→${RST} $*" >&2; }
warn() { echo -e "${YLW}!${RST} $*" >&2; }

# cloudflared no PATH → baixa linux-amd64 para deploy/.cloudflared/ (PC host).
_resolve_cloudflared_for_host() {
  local bin="$DEPLOY_DIR/.cloudflared/cloudflared"
  if command -v cloudflared >/dev/null 2>&1; then
    command -v cloudflared
    return 0
  fi
  mkdir -p "$DEPLOY_DIR/.cloudflared"
  if [[ -x "$bin" ]]; then
    echo "$bin"
    return 0
  fi
  command -v curl >/dev/null 2>&1 || die "USE_CLOUDFLARE_TUNNEL=1: instale curl ou coloque cloudflared no PATH."
  _arch="$(uname -m 2>/dev/null || echo unknown)"
  [[ "$_arch" == "x86_64" ]] || warn "Host não é x86_64 (é ${_arch}) — o script baixa mesmo assim cloudflared-linux-amd64."
  info "Baixando cloudflared (linux-amd64) para $bin …"
  curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64" -o "${bin}.part"
  chmod +x "${bin}.part"
  mv -f "${bin}.part" "$bin"
  echo "$bin"
}

usage() {
  cat <<'EOF'
Compila o frontend, valida PWA (sw, manifest, PNG), prepara o venv e sobe o Gunicorn.

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
  USE_CLOUDFLARE_TUNNEL=0  só HTTP (sem túnel HTTPS Cloudflare)
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
  echo -e "${YLW}PWA / Chrome “Instalar app”:${RST}"
  echo "  • Abre o site normalmente (ex.: http://127.0.0.1:${port} ou o IP da LAN) — é a página principal, não o URL do sw.js."
  echo "  • No Chrome (PC ou Android): menu ⋮ → “Instalar Nossa Lista…” ou ícone de instalar na barra de endereços — só costuma aparecer em HTTPS (ou em http://127.0.0.1)."
  echo "  • Em http://IP-na-LAN:8080 (só HTTP) o Chrome muitas vezes NÃO oferece instalar; aí você precisa de HTTPS (este script tenta cloudflared por padrão; ver deploy/nginx-https.example.conf para Nginx + domínio)."
  echo -e "  • Para testar o SW: ${CYN}http://127.0.0.1:${port}/sw.js${RST} (arquivo do worker; não é a “home” do site)."
  echo ""
}

load_env_from_secrets
export MOVIES_APP_DIR="$APP_DIR"
chmod +x "$DEPLOY_DIR/start-gunicorn.sh" 2>/dev/null || true

# Arquivos PWA esperados em app/static/ (além do build Vite em static/build/)
verify_pwa_static() {
  local f
  for f in sw.js manifest.webmanifest pwa-192.png pwa-512.png; do
    [[ -f "$APP_DIR/static/$f" ]] || die "PWA: falta $APP_DIR/static/$f (precisa estar no repositório)."
  done
  if [[ -f "$APP_DIR/static/offline.html" ]]; then
    : # opcional
  else
    warn "PWA: offline.html ausente em app/static/ (opcional mas recomendado)."
  fi
}

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

info "Validando arquivos PWA (sw.js, manifest, ícones)…"
verify_pwa_static

_PY="$APP_DIR/.venv/bin/python"
[[ -x "$_PY" ]] || _PY=python3
info "Verificando sintaxe de app.py (py_compile)…"
"$_PY" -m py_compile "$APP_DIR/app.py" || die "app.py com erro de sintaxe — corrija antes de subir o Gunicorn."

cd "$APP_DIR"

# Reusa o mesmo script usado pelo systemd na Pi (gthread + GUNICORN_THREADS).
# SSE precisa de gthread senão uma conexão longa bloqueia o worker síncrono
# e o resto do site congela até o stream fechar.
export GUNICORN_THREADS="${GUNICORN_THREADS:-4}"

USE_CLOUDFLARE_TUNNEL="${USE_CLOUDFLARE_TUNNEL:-1}"
_bind="${FLASK_BIND:-0.0.0.0:8080}"
_cf_port="${_bind##*:}"
[[ "$_cf_port" == "$_bind" ]] && _cf_port="8080"

_gunicorn_cleanup() {
  if [[ -n "${_GUNICORN_BG_PID:-}" ]] && kill -0 "$_GUNICORN_BG_PID" 2>/dev/null; then
    kill "$_GUNICORN_BG_PID" 2>/dev/null || true
    wait "$_GUNICORN_BG_PID" 2>/dev/null || true
  fi
}

_wait_gunicorn_ready() {
  local p="$1" n=0
  while [[ $n -lt 80 ]]; do
    if command -v curl >/dev/null 2>&1; then
      if curl -sf "http://127.0.0.1:${p}/healthz" >/dev/null 2>&1; then
        return 0
      fi
    elif bash -c "echo >/dev/tcp/127.0.0.1/${p}" 2>/dev/null; then
      return 0
    fi
    sleep 0.25
    n=$((n + 1))
  done
  return 1
}

if [[ "$USE_CLOUDFLARE_TUNNEL" == "1" ]]; then
  _CF_EXE="$(_resolve_cloudflared_for_host)"
  print_urls_banner
  info "Gunicorn em segundo plano + túnel HTTPS grátis (Cloudflare Quick Tunnel)…"
  trap _gunicorn_cleanup EXIT INT TERM
  ( export MOVIES_APP_DIR="$APP_DIR" && "$DEPLOY_DIR/start-gunicorn.sh" ) &
  _GUNICORN_BG_PID=$!
  if ! _wait_gunicorn_ready "$_cf_port"; then
    warn "Gunicorn não respondeu a tempo em 127.0.0.1:${_cf_port}/healthz — verifique FLASK_BIND e os logs."
  fi
  echo ""
  echo -e "${GRN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RST}"
  echo -e "${GRN}  Link final para você acessar com o Cloudflare (HTTPS público):${RST}"
  echo -e "${CYN}  (o endereço https://….trycloudflare.com aparece nas próximas linhas — copie quando surgir)${RST}"
  echo -e "${YLW}  Nota:${RST} no modo quick o URL muda a cada reinício do túnel; URL fixo exige conta/domínio na Cloudflare."
  echo -e "${GRN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RST}"
  echo ""
  "$_CF_EXE" tunnel --url "http://127.0.0.1:${_cf_port}"
else
  print_urls_banner
  exec "$DEPLOY_DIR/start-gunicorn.sh"
fi
