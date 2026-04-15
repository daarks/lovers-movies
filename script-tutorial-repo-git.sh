#!/usr/bin/env bash
set -euo pipefail

confirmar_passo() {
  local mensagem="$1"
  local resposta=""
  while true; do
    read -r -p "$mensagem [y/n]: " resposta
    case "${resposta,,}" in
      y|yes) return 0 ;;
      n|no) echo "Beleza, passo pausado por você."; return 1 ;;
      *) echo "Resposta inválida. Digite y ou n." ;;
    esac
  done
}

exibir_bloco() {
  printf "\n====================================================\n"
  printf "%s\n" "$1"
  printf "====================================================\n\n"
}

exibir_bloco "Tutorial guiado: transformar este app em repositório Git + GitHub"
echo "Pasta atual: $(pwd)"
echo "Este script executa automaticamente o que for possível e para nos passos manuais."

if ! command -v git >/dev/null 2>&1; then
  echo "Erro: git não encontrado. Instale o Git e rode novamente."
  exit 1
fi

echo
if [ ! -d ".git" ]; then
  echo "Inicializando repositório local..."
  git init
else
  echo "Repositório Git já existe nesta pasta. Vamos continuar."
fi

if [ ! -f ".gitignore" ]; then
  cat > .gitignore <<'EOF'
# Python
__pycache__/
*.pyc
*.pyo
*.pyd
.pytest_cache/
.mypy_cache/
.venv/
venv/

# Flask / ambiente local
instance/
*.sqlite3
*.db

# Segredos
secrets.env
.env

# Editor / SO
.DS_Store
.idea/
.vscode/
EOF
  echo ".gitignore criado com padrões básicos."
else
  echo ".gitignore já existe (mantido como está)."
fi

if [ -f "$HOME/.ssh/id_ed25519.pub" ]; then
  echo
  echo "Chave SSH encontrada em: $HOME/.ssh/id_ed25519.pub"
else
  echo
  echo "Nenhuma chave SSH id_ed25519 encontrada."
  if confirmar_passo "Quer que eu gere uma chave SSH agora?"; then
    read -r -p "Digite seu e-mail do GitHub para identificar a chave: " email_ssh
    ssh-keygen -t ed25519 -C "$email_ssh" -f "$HOME/.ssh/id_ed25519" -N ""
    echo "Chave criada com sucesso."
  fi
fi

if [ -f "$HOME/.ssh/id_ed25519.pub" ]; then
  exibir_bloco "Passo manual (GitHub): adicionar chave SSH"
  echo "1) Abra: https://github.com/settings/keys"
  echo "2) Clique em \"New SSH key\""
  echo "3) Cole esta chave pública:"
  echo
  cat "$HOME/.ssh/id_ed25519.pub"
  echo
  confirmar_passo "Terminou de adicionar a chave SSH no GitHub?" || true
fi

if command -v gh >/dev/null 2>&1; then
  echo
  if ! gh auth status >/dev/null 2>&1; then
    exibir_bloco "Autenticação GitHub CLI"
    echo "O comando abaixo é interativo e vai te guiar."
    echo "Dica: você pode autenticar por browser ou token pessoal (PAT)."
    if confirmar_passo "Executar 'gh auth login' agora?"; then
      gh auth login
    fi
  else
    echo "GitHub CLI já autenticado."
  fi
else
  echo
  echo "GitHub CLI (gh) não encontrado."
  echo "Se quiser instalar depois: https://cli.github.com/"
fi

echo
echo "Preparando commit inicial..."
git add .
if git diff --cached --quiet; then
  echo "Nada novo para commit no momento."
else
  git commit -m "chore: inicializa repositório do app"
fi

branch_atual="$(git branch --show-current || true)"
if [ -z "$branch_atual" ]; then
  branch_atual="main"
  git checkout -b "$branch_atual"
fi
if [ "$branch_atual" = "master" ]; then
  git branch -M main
  branch_atual="main"
fi

repo_url=""
echo
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  if confirmar_passo "Quer criar o repositório remoto automaticamente com GitHub CLI?"; then
    read -r -p "Nome do novo repositório no GitHub (ex: movies-app): " repo_name
    read -r -p "Visibilidade (private/public) [private]: " repo_vis
    repo_vis="${repo_vis:-private}"
    if [ "$repo_vis" != "public" ]; then
      repo_vis="private"
    fi
    gh repo create "$repo_name" "--$repo_vis" --source=. --remote=origin
    repo_url="$(git remote get-url origin)"
  fi
fi

if [ -z "$repo_url" ]; then
  exibir_bloco "Passo manual: URL do repositório remoto"
  echo "Crie um repo vazio no GitHub e cole aqui a URL SSH (recomendado)."
  echo "Exemplo SSH: git@github.com:SEU_USUARIO/SEU_REPO.git"
  echo "Exemplo HTTPS: https://github.com/SEU_USUARIO/SEU_REPO.git"
  read -r -p "URL do repositório remoto: " repo_url
  if git remote get-url origin >/dev/null 2>&1; then
    git remote set-url origin "$repo_url"
  else
    git remote add origin "$repo_url"
  fi
fi

echo
echo "Enviando para o remoto..."
git push -u origin "$branch_atual"

exibir_bloco "Concluído"
echo "Seu projeto agora está versionado e conectado ao remoto:"
echo "$repo_url"
echo
echo "Próximos comandos úteis:"
echo "  git status"
echo "  git add . && git commit -m \"sua mensagem\""
echo "  git push"
