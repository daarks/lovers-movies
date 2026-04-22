#!/usr/bin/env bash
#
# Instalação na Raspberry Pi (ou Debian/Ubuntu):
# - pacotes de sistema (python3-venv, openssl, Node.js 20 LTS)
# - venv + dependências Python (incl. gunicorn)
# - build do frontend React/Vite (app/static/build/)
# - monta /etc/movies-app.env a partir de secrets.env na raiz do repo
# - systemd: serviço movies-app, inicia no boot, reinicia se cair
#
# Raspberry Pi Zero 2W (~512 MB RAM): o "npm run build" (Vite) quase sempre
# estoura memória (FATAL ERROR: JavaScript heap out of memory). Nesse caso:
#   SKIP_FRONTEND=1 sudo ./install-rpi.sh
# e no PC (com o mesmo clone), SEM sudo:
#   ./install-rpi.sh from-host
# (builda no host, rsync para gabeevi@raspberrypi.local e reinicia o serviço)
#
# Uso (único passo necessário após clonar o repositório):
#   cp secrets.example secrets.env
#   nano secrets.env   # GEMINI_API_KEY, TMDB_READ_ACCESS_TOKEN, TMDB_API_KEY
#   sudo ./install-rpi.sh
#   sudo ./install-rpi.sh /caminho/absoluto/para/movies-app/app
#
# Flags:
#   SKIP_FRONTEND=1 sudo ./install-rpi.sh   # pula npm ci && npm run build
#   SKIP_APT=1 sudo ./install-rpi.sh        # pula apt-get update/install
#
# Deploy do frontend a partir do PC (não exige sudo local):
#   ./install-rpi.sh from-host [--sync-only] [--no-restart]
#
# Só no PC: compilar e subir Gunicorn (sem systemd):
#   ./deploy/local-host-up.sh
#
# Padrão: 0.0.0.0:8080 (LAN e, com redirecionamento no roteador, internet).
# Se quiser só local: FLASK_BIND=127.0.0.1:8080 em secrets.env
#
set -euo pipefail

_INSTALL_SH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ "${1:-}" == "from-host" ]]; then
  shift
  exec bash "$_INSTALL_SH_DIR/deploy/from-host-to-pi.sh" "$@"
fi

RED='\033[0;31m'
GRN='\033[0;32m'
YLW='\033[0;33m'
RST='\033[0m'

die() { echo -e "${RED}Erro:${RST} $*" >&2; exit 1; }
info() { echo -e "${GRN}→${RST} $*"; }
warn() { echo -e "${YLW}!${RST} $*"; }

[[ "$(id -u)" -eq 0 ]] || die "Execute com sudo: sudo $0"

REPO_ROOT="$_INSTALL_SH_DIR"
APP_DIR="${1:-$REPO_ROOT/app}"
DEPLOY_DIR="$REPO_ROOT/deploy"
FRONTEND_DIR="$REPO_ROOT/frontend"
SECRETS_SRC="$REPO_ROOT/secrets.env"
SKIP_FRONTEND="${SKIP_FRONTEND:-0}"
SKIP_APT="${SKIP_APT:-0}"

[[ -f "$APP_DIR/app.py" ]] || die "Não achei app.py em: $APP_DIR"
[[ -f "$DEPLOY_DIR/start-gunicorn.sh" ]] || die "Pasta deploy incompleta em: $DEPLOY_DIR"
if [[ ! -f "$SECRETS_SRC" ]]; then
  echo -e "${RED}Erro:${RST} Crie secrets.env na raiz do repositório:" >&2
  echo "  cp $REPO_ROOT/secrets.example $REPO_ROOT/secrets.env" >&2
  echo "  nano $REPO_ROOT/secrets.env" >&2
  exit 1
fi

SVC_USER="${SUDO_USER:-${USER:-pi}}"
if ! id "$SVC_USER" &>/dev/null; then
  die "Usuário '$SVC_USER' não existe. Defina com: export SUDO_USER=seu_usuario e rode de novo."
fi

build_env_file() {
  local out="$1"
  : > "$out"
  # Valores do secrets.env (podem conter '=' no JWT — repassa linhas válidas)
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "${line//[[:space:]]/}" ]] && continue
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" == *"="* ]] || continue
    printf '%s\n' "$line" >> "$out"
  done < "$SECRETS_SRC"

  # Defaults (não sobrescreve se já vierem do secrets.env)
  grep -q '^FLASK_BIND=' "$out" || echo 'FLASK_BIND=0.0.0.0:8080' >> "$out"
  grep -q '^GUNICORN_WORKERS=' "$out" || echo 'GUNICORN_WORKERS=2' >> "$out"
  # SECRET_KEY para sessões Flask; gera se ausente ou só espaços
  sk_line=$(grep '^SECRET_KEY=' "$out" 2>/dev/null | tail -1 || true)
  sk_val="${sk_line#SECRET_KEY=}"
  if [[ -z "${sk_val// /}" ]]; then
    sed -i '/^SECRET_KEY=/d' "$out"
    if command -v openssl >/dev/null 2>&1; then
      echo "SECRET_KEY=$(openssl rand -hex 32)" >> "$out"
    else
      echo "SECRET_KEY=$(python3 -c 'import secrets; print(secrets.token_hex(32))')" >> "$out"
    fi
  fi
}

# Verifica se Node.js atende a versão mínima (>=18). Retorna 0 se ok.
node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  local major
  major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [[ "$major" =~ ^[0-9]+$ ]] || return 1
  [[ "$major" -ge 18 ]]
}

install_nodejs() {
  info "Instalando Node.js 20 LTS (NodeSource)…"
  # NodeSource suporta Debian/Ubuntu em armv7/arm64/x64.
  apt-get install -y -qq curl ca-certificates gnupg
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
}

# -------------------------------------------------------------------
# 1) Pacotes de sistema
# -------------------------------------------------------------------
if [[ "$SKIP_APT" == "1" ]]; then
  warn "SKIP_APT=1 definido — pulando apt-get."
else
  info "Instalando pacotes de sistema (python3-venv, openssl, curl)…"
  apt-get update -qq
  apt-get install -y -qq python3 python3-venv python3-pip openssl curl ca-certificates
fi

# -------------------------------------------------------------------
# 2) Node.js (apenas se o frontend for buildado)
# -------------------------------------------------------------------
if [[ "$SKIP_FRONTEND" != "1" ]]; then
  if ! node_ok; then
    if [[ "$SKIP_APT" == "1" ]]; then
      warn "Node.js >= 18 ausente, mas SKIP_APT=1 — pulando instalação."
    else
      install_nodejs
    fi
  fi
  if node_ok; then
    info "Node.js $(node -v) / npm $(npm -v) disponíveis."
  else
    warn "Node.js >= 18 não disponível. O build do frontend será pulado."
    SKIP_FRONTEND=1
  fi
fi

# -------------------------------------------------------------------
# 3) Python venv + deps
# -------------------------------------------------------------------
info "Criando venv e instalando requirements…"
if [[ ! -d "$APP_DIR/.venv" ]]; then
  sudo -u "$SVC_USER" python3 -m venv "$APP_DIR/.venv"
fi
sudo -u "$SVC_USER" "$APP_DIR/.venv/bin/pip" install --upgrade pip
sudo -u "$SVC_USER" "$APP_DIR/.venv/bin/pip" install -r "$APP_DIR/requirements.txt"

chmod +x "$DEPLOY_DIR/start-gunicorn.sh"

# -------------------------------------------------------------------
# 4) Build do frontend (React/Vite → app/static/build/)
# -------------------------------------------------------------------
if [[ "$SKIP_FRONTEND" != "1" ]] && [[ -r /proc/meminfo ]]; then
  _mem_mb="$(awk '/MemTotal:/ {print int($2/1024)}' /proc/meminfo)"
  if [[ "${_mem_mb:-99999}" -lt 900 ]]; then
    warn "RAM total ~${_mem_mb} MB: o build Node (Vite) costuma falhar com \"heap out of memory\" neste hardware."
    warn "Use na Pi: SKIP_FRONTEND=1 sudo $0"
    warn "No PC (Linux/macOS): ./install-rpi.sh from-host   (deploy/from-host-to-pi.sh)"
    warn "No Windows: PowerShell .\\deploy\\from-host-to-pi.ps1 (instala na Pi + frontend)"
  fi
fi

if [[ "$SKIP_FRONTEND" == "1" ]]; then
  warn "Pulando build do frontend (SKIP_FRONTEND=1 ou Node indisponível)."
  if [[ ! -f "$APP_DIR/static/build/manifest.json" ]]; then
    warn "Nenhum build prévio encontrado em $APP_DIR/static/build/ —"
    warn "a UI pode quebrar até você rodar: cd $FRONTEND_DIR && npm ci && npm run build"
  fi
else
  if [[ ! -f "$FRONTEND_DIR/package.json" ]]; then
    warn "frontend/package.json não encontrado — pulando build."
  else
    info "Instalando dependências do frontend (npm ci)…"
    # Roda como SVC_USER para manter node_modules/ e build/ com o dono correto
    sudo -u "$SVC_USER" -H bash -c "cd '$FRONTEND_DIR' && npm ci --no-audit --no-fund"

    info "Gerando bundle React/Vite (npm run build)…"
    sudo -u "$SVC_USER" -H bash -c "cd '$FRONTEND_DIR' && npm run build"

    # Garante que o serviço (rodando como SVC_USER) lê os assets
    chown -R "$SVC_USER:$SVC_USER" "$APP_DIR/static/build" 2>/dev/null || true
    info "Build do frontend concluído em $APP_DIR/static/build/."
  fi
fi

# -------------------------------------------------------------------
# 5) /etc/movies-app.env
# -------------------------------------------------------------------
TMP_ENV="$(mktemp)"
build_env_file "$TMP_ENV"
install -m 0600 "$TMP_ENV" /etc/movies-app.env
chown root:root /etc/movies-app.env
rm -f "$TMP_ENV"
info "Atualizado /etc/movies-app.env a partir de $SECRETS_SRC"

# -------------------------------------------------------------------
# 6) Unit systemd
# -------------------------------------------------------------------
UNIT_PATH="/etc/systemd/system/movies-app.service"
TMP_UNIT="$(mktemp)"
sed -e "s|__APP_DIR__|${APP_DIR}|g" \
    -e "s|__DEPLOY_DIR__|${DEPLOY_DIR}|g" \
    -e "s|^User=.*|User=${SVC_USER}|" \
    -e "s|^Group=.*|Group=${SVC_USER}|" \
    "$DEPLOY_DIR/movies-app.service" > "$TMP_UNIT"
install -m 0644 "$TMP_UNIT" "$UNIT_PATH"
rm -f "$TMP_UNIT"

systemctl daemon-reload
systemctl enable movies-app.service
systemctl restart movies-app.service

echo ""
echo -e "${GRN}Serviço movies-app instalado.${RST}"
systemctl --no-pager status movies-app.service || true
echo ""
_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo "URLs (conforme FLASK_BIND em /etc/movies-app.env):"
echo "  - Nesta máquina: http://127.0.0.1:8080 (se estiver escutando em 0.0.0.0 ou 127.0.0.1)"
echo "  - Outros aparelhos na mesma rede: http://${_ip:-IP_DA_PI}:8080"
echo "  (Da internet: configure encaminhamento de porta no roteador para ${_ip:-IP}:8080.)"
echo ""
echo "Comandos úteis:"
echo "  sudo systemctl status movies-app"
echo "  sudo journalctl -u movies-app -f"
echo "  # Rebuild só do frontend (na própria máquina, com RAM suficiente):"
echo "  cd $FRONTEND_DIR && npm run build && sudo systemctl restart movies-app"
echo "  # Pi fraca (ex. Zero 2W): build no PC e enviar por SSH —"
echo "  ./install-rpi.sh from-host"
