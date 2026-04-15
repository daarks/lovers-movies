#!/usr/bin/env bash
#
# Instalação na Raspberry Pi (ou Debian/Ubuntu):
# - venv + dependências (incl. gunicorn)
# - monta /etc/movies-app.env a partir de secrets.env na raiz do repo
# - systemd: serviço movies-app, inicia no boot, reinicia se cair
#
# Uso (único passo necessário após clonar o repositório):
#   cp secrets.example secrets.env
#   nano secrets.env   # GEMINI_API_KEY, TMDB_READ_ACCESS_TOKEN, TMDB_API_KEY
#   sudo ./install-rpi.sh
#   sudo ./install-rpi.sh /caminho/absoluto/para/movies-app/app
#
# Padrão: 0.0.0.0:8080 (LAN e, com redirecionamento no roteador, internet).
# Se quiser só local: FLASK_BIND=127.0.0.1:8080 em secrets.env
#
set -euo pipefail

RED='\033[0;31m'
GRN='\033[0;32m'
RST='\033[0m'

die() { echo -e "${RED}Erro:${RST} $*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || die "Execute com sudo: sudo $0"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${1:-$REPO_ROOT/app}"
DEPLOY_DIR="$REPO_ROOT/deploy"
SECRETS_SRC="$REPO_ROOT/secrets.env"

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

echo -e "${GRN}→${RST} Instalando pacotes de sistema (python3-venv)…"
apt-get update -qq
apt-get install -y -qq python3 python3-venv python3-pip openssl

echo -e "${GRN}→${RST} Criando venv e instalando requirements…"
if [[ ! -d "$APP_DIR/.venv" ]]; then
  sudo -u "$SVC_USER" python3 -m venv "$APP_DIR/.venv"
fi
sudo -u "$SVC_USER" "$APP_DIR/.venv/bin/pip" install --upgrade pip
sudo -u "$SVC_USER" "$APP_DIR/.venv/bin/pip" install -r "$APP_DIR/requirements.txt"

chmod +x "$DEPLOY_DIR/start-gunicorn.sh"

TMP_ENV="$(mktemp)"
build_env_file "$TMP_ENV"
install -m 0600 "$TMP_ENV" /etc/movies-app.env
chown root:root /etc/movies-app.env
rm -f "$TMP_ENV"
echo -e "${GRN}→${RST} Atualizado /etc/movies-app.env a partir de $SECRETS_SRC"

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
