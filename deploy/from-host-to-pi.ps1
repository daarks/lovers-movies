#requires -Version 5.1
<#
  Deploy completo a partir do Windows: prepara o PC, envia o código para a Raspberry Pi,
  executa install-rpi.sh na Pi (sem build Node na Pi — SKIP_FRONTEND=1), envia o bundle
  Vite (app/static/build) e reinicia o serviço.

  Padrões (sobrescreva com variáveis de ambiente):
    MOVIES_APP_SSH          = gabeevi@raspberrypi.local
    MOVIES_APP_REMOTE_DIR   = /home/pi/lovers-movies
    MOVIES_APP_SSH_EXTRA    = ex.: -i C:\Users\Voce\.ssh\id_rsa

  Uso (PowerShell, na raiz do repositório):
    powershell -ExecutionPolicy Bypass -File .\deploy\from-host-to-pi.ps1
    powershell -ExecutionPolicy Bypass -File .\deploy\from-host-to-pi.ps1 -SomenteFrontend
    powershell -ExecutionPolicy Bypass -File .\deploy\from-host-to-pi.ps1 -SyncOnly -NoRestart

  -SomenteFrontend  só npm ci/build + envio de app/static/build (não roda install na Pi nem tarball).
  -SyncOnly         não roda npm ci/build no Windows (usa build já existente).
  -NoRestart         não reinicia movies-app.service após enviar o frontend.

  Quando algo obrigatório falhar (ferramenta ausente, SSH, install na Pi), o script explica o que
  fazer e só continua depois que você digitar Y e Enter.
#>
param(
  [switch] $SomenteFrontend,
  [switch] $SyncOnly,
  [switch] $NoRestart
)

$ErrorActionPreference = "Stop"

function Info($msg) { Write-Host "→ $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "! $msg" -ForegroundColor Yellow }
function Die($msg) {
  Write-Host "Erro: $msg" -ForegroundColor Red
  exit 1
}

function Wait-UserReady {
  param(
    [Parameter(Mandatory)][string] $Titulo,
    [string[]] $Instrucoes
  )
  Write-Host ""
  Write-Host "──────────  ATENÇÃO  ──────────" -ForegroundColor Yellow
  Write-Host $Titulo -ForegroundColor Yellow
  Write-Host ""
  foreach ($line in $Instrucoes) {
    Write-Host $line
  }
  Write-Host ""
  $ans = Read-Host "Quando tiver concluído, digite Y e Enter para continuar (N cancela)"
  if ($ans -notmatch '^[yY]') { Die "Operação cancelada." }
}

function Test-CommandOrPause {
  param(
    [Parameter(Mandatory)][string] $Nome,
    [Parameter(Mandatory)][string[]] $TextoAjuda
  )
  while (-not (Get-Command $Nome -ErrorAction SilentlyContinue)) {
    Wait-UserReady -Titulo "Comando '$Nome' não encontrado no PATH" -Instrucoes $TextoAjuda
  }
}

function Test-NodeVersion {
  try {
    $maj = [int]((node -p "process.versions.node.split('.')[0]" 2>$null) -as [int])
    return ($maj -ge 18)
  } catch {
    return $false
  }
}

$DeployDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $DeployDir
$FrontendDir = Join-Path $RepoRoot "frontend"
$BuildDir = Join-Path $RepoRoot "app\static\build"
$SwFile = Join-Path $RepoRoot "app\static\sw.js"
$SecretsEnv = Join-Path $RepoRoot "secrets.env"
$SecretsExample = Join-Path $RepoRoot "secrets.example"

if (-not (Test-Path (Join-Path $FrontendDir "package.json"))) {
  Die "Não achei frontend\package.json em $FrontendDir"
}
if (-not (Test-Path (Join-Path $RepoRoot "app\app.py"))) {
  Die "Não achei app\app.py — confira o caminho do repositório."
}
if (-not (Test-Path $SecretsExample)) {
  Die "Não achei secrets.example na raiz do repositório."
}

$SshTarget = if ($env:MOVIES_APP_SSH) { $env:MOVIES_APP_SSH.Trim() } else { "gabeevi@raspberrypi.local" }
$SshOpts = @("-o", "ConnectTimeout=25", "-o", "BatchMode=no")
if ($env:MOVIES_APP_SSH_EXTRA) {
  $extra = @($env:MOVIES_APP_SSH_EXTRA.Trim() -split '\s+') | Where-Object { $_ }
  if ($extra.Count -gt 0) { $SshOpts = $SshOpts + $extra }
}

$RDir = if ($env:MOVIES_APP_REMOTE_DIR) { $env:MOVIES_APP_REMOTE_DIR.Trim().TrimEnd("/", "\") } else { "/home/pi/lovers-movies" }

# --- Ferramentas no Windows ---
Test-CommandOrPause -Nome "ssh" -TextoAjuda @(
  "Instale o Cliente OpenSSH no Windows:",
  "  Configurações → Aplicativos → Recursos opcionais → Cliente OpenSSH → Instalar",
  "Ou instale Git for Windows e use Git Bash com ssh no PATH."
)
Test-CommandOrPause -Nome "scp" -TextoAjuda @(
  "O cliente OpenSSH inclui o comando scp. Instale-o como acima."
)
Test-CommandOrPause -Nome "tar" -TextoAjuda @(
  "O Windows 10/11 costuma ter o comando 'tar' nativo (Prompt de Comando / PowerShell).",
  "Se não existir, instale atualizações do sistema ou use Windows 10 versão 1803+."
)

if (-not $SomenteFrontend) {
  if (-not $SyncOnly) {
    Test-CommandOrPause -Nome "node" -TextoAjuda @(
      "Instale Node.js 18 ou superior: https://nodejs.org/ (LTS).",
      "Reabra o PowerShell depois da instalação."
    )
    Test-CommandOrPause -Nome "npm" -TextoAjuda @(
      "O npm vem com o Node.js. Reinstale o Node LTS se npm não existir."
    )
    while (-not (Test-NodeVersion)) {
      Wait-UserReady -Titulo "Node.js precisa ser versão 18 ou superior" -Instrucoes @(
        "Versão atual: $(try { node -v } catch { 'desconhecida' })",
        "Instale Node 18+ em https://nodejs.org/ e confira com: node -v"
      )
    }
  }
}

# --- secrets.env (obrigatório para install na Pi) ---
if (-not $SomenteFrontend) {
  while (-not (Test-Path $SecretsEnv)) {
    Wait-UserReady -Titulo "Arquivo secrets.env não encontrado" -Instrucoes @(
      "Na raiz do repositório ($RepoRoot), crie secrets.env a partir do exemplo:",
      "  copy secrets.example secrets.env",
      "Edite secrets.env e preencha TMDB_READ_ACCESS_TOKEN (e demais chaves que usar).",
      "Guarde o ficheiro e volte aqui."
    )
  }
}

# --- SSH até a Pi ---
function Test-SshSession {
  & ssh @SshOpts $SshTarget "echo ok" 2>$null
  return ($LASTEXITCODE -eq 0)
}

while (-not (Test-SshSession)) {
  Wait-UserReady -Titulo "Não consegui conectar por SSH a: $SshTarget" -Instrucoes @(
    "Confirme que a Pi está ligada e na mesma rede.",
    "Teste no PowerShell: ssh $SshTarget",
    "A primeira vez pode pedir fingerprint — aceite e teste de novo.",
    "Chave SSH: use `$env:MOVIES_APP_SSH_EXTRA = '-i C:\caminho\para\chave'",
    "Outro utilizador/host: `$env:MOVIES_APP_SSH = 'utilizador@ip.da.pi'",
    "Caminho do projeto na Pi (se não for padrão): `$env:MOVIES_APP_REMOTE_DIR = '/caminho/absoluto'"
  )
}

Info "Destino SSH: $SshTarget"
Info "Pasta na Pi:  $RDir"

# --- Build frontend no Windows ---
if (-not $SyncOnly) {
  Info "npm ci (frontend)…"
  Push-Location $FrontendDir
  try {
    npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) {
      Wait-UserReady -Titulo "npm ci falhou" -Instrucoes @(
        "Corrija o erro acima (rede, package-lock.json, versão do Node).",
        "Se precisar: apague frontend\node_modules e rode de novo."
      )
      npm ci --no-audit --no-fund
      if ($LASTEXITCODE -ne 0) { Die "npm ci falhou de novo." }
    }
    Info "npm run build (Vite → app\static\build\)…"
    npm run build
    if ($LASTEXITCODE -ne 0) {
      Wait-UserReady -Titulo "npm run build falhou" -Instrucoes @(
        "Leia a mensagem de erro do Vite acima, corrija e guarde os ficheiros."
      )
      npm run build
      if ($LASTEXITCODE -ne 0) { Die "npm run build falhou de novo." }
    }
  } finally {
    Pop-Location
  }
} else {
  Warn "-SyncOnly: usando build já existente em $BuildDir"
}

$manifest = Join-Path $BuildDir "manifest.json"
if (-not (Test-Path $manifest)) {
  Die "manifest.json ausente em $BuildDir — rode sem -SyncOnly ou faça o build antes."
}

if ($SomenteFrontend) {
  Warn "-SomenteFrontend: não envio código Python nem executo install-rpi.sh na Pi."
  $remoteApp = "$RDir/app"
  Info "Verificando se existe $remoteApp na Pi…"
  & ssh @SshOpts $SshTarget "test -d `"$remoteApp`""
  if ($LASTEXITCODE -ne 0) {
    Wait-UserReady -Titulo "Pasta remota não encontrada: $remoteApp" -Instrucoes @(
      "Para instalação completa na Pi, rode este script SEM -SomenteFrontend uma vez.",
      "Ou crie o clone do projeto manualmente nesse caminho."
    )
    & ssh @SshOpts $SshTarget "test -d `"$remoteApp`""
    if ($LASTEXITCODE -ne 0) { Die "Ainda não existe $remoteApp na Pi." }
  }
} else {
  # --- Pacote (app + deploy + install) sem venv, sem build estático pesado ---
  $bundleName = "movies-app-bundle.tgz"
  $bundleLocal = Join-Path $env:TEMP $bundleName
  if (Test-Path $bundleLocal) { Remove-Item -Force $bundleLocal }

  Info "Criando pacote para a Pi ($bundleLocal)…"
  $tarList = @(
    "-cf", $bundleLocal,
    "--exclude=app/.venv",
    "--exclude=app/__pycache__",
    "--exclude=app/instance",
    "--exclude=app/static/build",
    "-C", $RepoRoot,
    "app", "deploy", "install-rpi.sh", "secrets.example", "secrets.env"
  )
  & tar @tarList
  if ($LASTEXITCODE -ne 0) {
    Wait-UserReady -Titulo "O comando tar falhou ao criar o pacote" -Instrucoes @(
      "Verifique se está na raiz do repo e se os nomes app, deploy, install-rpi.sh existem.",
      "No PowerShell, teste: tar --version"
    )
    & tar @tarList
    if ($LASTEXITCODE -ne 0) { Die "tar falhou de novo." }
  }

  Info "Enviando pacote para /tmp na Pi…"
  & scp @SshOpts $bundleLocal "${SshTarget}:/tmp/$bundleName"
  if ($LASTEXITCODE -ne 0) {
    Wait-UserReady -Titulo "scp do pacote falhou" -Instrucoes @(
      "Verifique rede, espaço em disco na Pi e permissões em /tmp."
    )
    & scp @SshOpts $bundleLocal "${SshTarget}:/tmp/$bundleName"
    if ($LASTEXITCODE -ne 0) { Die "scp falhou de novo." }
  }

  Info "Extraindo em $RDir na Pi…"
  $extractCmd = "mkdir -p `"$RDir`" && cd `"$RDir`" && tar xf /tmp/$bundleName && rm -f /tmp/$bundleName && chmod +x install-rpi.sh deploy/start-gunicorn.sh 2>/dev/null; echo done"
  & ssh @SshOpts $SshTarget $extractCmd
  if ($LASTEXITCODE -ne 0) {
    Wait-UserReady -Titulo "Extração SSH falhou" -Instrucoes @(
      "Na Pi, verifique permissões em $RDir (utilizador da SSH precisa de escrita).",
      "Espaço: df -h /tmp e df -h $RDir"
    )
    & ssh @SshOpts $SshTarget $extractCmd
    if ($LASTEXITCODE -ne 0) { Die "Extração falhou de novo." }
  }

  Info "Executando install-rpi.sh na Pi (SKIP_FRONTEND=1 — sem npm na Pi)…"
  Write-Host "  (Se pedir, introduza a palavra-passe de sudo na Pi.)" -ForegroundColor DarkGray
  $installCmd = "cd `"$RDir`" && sudo env SKIP_FRONTEND=1 bash ./install-rpi.sh"
  & ssh -t @SshOpts $SshTarget $installCmd
  if ($LASTEXITCODE -ne 0) {
    Wait-UserReady -Titulo "install-rpi.sh terminou com erro na Pi" -Instrucoes @(
      "Na Pi, veja: sudo journalctl -u movies-app -n 80 --no-pager",
      "Corrija apt, secrets.env em $RDir, ou permissões.",
      "Quando estiver pronto, o script vai tentar de novo o mesmo comando."
    )
    & ssh -t @SshOpts $SshTarget $installCmd
    if ($LASTEXITCODE -ne 0) {
      Warn "install-rpi.sh ainda falhou. Continuo mesmo assim para enviar o frontend?"
      $ans2 = Read-Host "Digite Y para enviar app/static/build mesmo assim, ou N para sair"
      if ($ans2 -notmatch '^[yY]') { Die "Pare aqui e corrija a Pi antes de voltar a correr o script." }
    }
  }
}

# --- Enviar bundle estático ---
Info "A preparar app/static/build na Pi…"
& ssh @SshOpts $SshTarget "rm -rf `"$RDir/app/static/build/`"* && mkdir -p `"$RDir/app/static/build`""
if ($LASTEXITCODE -ne 0) {
  Wait-UserReady -Titulo "Não consegui limpar/criar app/static/build na Pi" -Instrucoes @(
    "Na Pi: sudo chown -R `$USER `$RDir/app/static",
    "Ou crie manualmente: mkdir -p $RDir/app/static/build"
  )
  & ssh @SshOpts $SshTarget "rm -rf `"$RDir/app/static/build/`"* && mkdir -p `"$RDir/app/static/build`""
  if ($LASTEXITCODE -ne 0) { Die "Falha ao preparar pasta de build na Pi." }
}

Info "A enviar ficheiros de app\static\build …"
$buildParent = (Resolve-Path $BuildDir).Path.TrimEnd("\")
& scp @SshOpts -r "$buildParent\*" "${SshTarget}:$RDir/app/static/build/"
if ($LASTEXITCODE -ne 0) {
  Wait-UserReady -Titulo "scp do build falhou" -Instrucoes @(
    "Verifique espaço em disco e permissões em $RDir/app/static/build"
  )
  & scp @SshOpts -r "$buildParent\*" "${SshTarget}:$RDir/app/static/build/"
  if ($LASTEXITCODE -ne 0) { Die "scp do build falhou de novo." }
}

if (Test-Path $SwFile) {
  Info "Enviando app\static\sw.js …"
  & scp @SshOpts (Resolve-Path $SwFile).Path "${SshTarget}:$RDir/app/static/sw.js"
  if ($LASTEXITCODE -ne 0) { Warn "scp do sw.js falhou (opcional)." }
}

if ($NoRestart) {
  Warn "-NoRestart: não reiniciei o serviço na Pi."
  Write-Host "Na Pi: sudo systemctl restart movies-app.service"
} else {
  Info "Reiniciando movies-app.service na Pi…"
  & ssh -t @SshOpts $SshTarget "sudo systemctl restart movies-app.service && sudo systemctl --no-pager status movies-app.service || true"
}

$piIpRaw = (& ssh @SshOpts $SshTarget "hostname -I" 2>$null)
$piIp = if ($piIpRaw) { ($piIpRaw.ToString().Trim() -split "\s+")[0] } else { "" }
$piBind = (& ssh @SshOpts $SshTarget "grep ^FLASK_BIND= /etc/movies-app.env 2>/dev/null | tail -1 | cut -d= -f2-" 2>$null)
if (-not $piBind) { $piBind = "0.0.0.0:8080" }
$parts = $piBind -split ":"
$piPort = if ($parts.Length -ge 2) { $parts[-1] } else { "8080" }
$piHost = if ($parts.Length -ge 2) { $parts[0] } else { "0.0.0.0" }

Write-Host ""
Write-Host "Concluído." -ForegroundColor Green
Write-Host "URLs (FLASK_BIND na Pi ≈ $piBind):"
Write-Host "  - Na própria Pi:     http://127.0.0.1:$piPort"
if ($piHost -eq "0.0.0.0" -or $piHost -eq "*") {
  $ipTrim = if ($piIp) { $piIp.Trim() } else { "" }
  if ($ipTrim) {
    Write-Host "  - Na LAN:            http://${ipTrim}:$piPort"
  }
  $hostPart = ($SshTarget -split "@")[-1]
  Write-Host "  - Hostname:          http://${hostPart}:$piPort"
} else {
  Write-Host "  (Serviço em ${piHost}:$piPort)"
}
Write-Host ""
Write-Host "Variáveis úteis:"
Write-Host '  $env:MOVIES_APP_SSH = "pi@192.168.1.x"'
Write-Host '  $env:MOVIES_APP_REMOTE_DIR = "/home/pi/lovers-movies"'
