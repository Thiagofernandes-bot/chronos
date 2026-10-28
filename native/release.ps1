# Publica uma versao nova do Chronos.
#
#   .\native\release.ps1 1.2.1
#   .\native\release.ps1 1.3.0 "Agora com relatorio semanal"
#
# Cria a release no GitHub ANTES de compilar: sem isso o electron-builder sobe
# o instalador e o blockmap em paralelo, cada upload cria uma release com a
# mesma tag, e a URL por tag passa a apontar para a duplicata vazia (foi o que
# deu 404 no app na versao 1.2.0).
#
# Nao use $ErrorActionPreference = "Stop" aqui: no PowerShell 5.1 qualquer
# linha que um .exe escreve no stderr viraria erro fatal, e o gh escreve
# avisos normais por ali.

param(
  [Parameter(Mandatory = $true)][string]$Versao,
  [string]$Notas = ""
)

$repo = "Thiagofernandes-bot/chronos"
$raiz = Split-Path -Parent $PSScriptRoot
$gh = "C:\Users\thiag\Apps\gh\bin\gh.exe"
if (-not (Test-Path $gh)) { $gh = "gh" }

Set-Location $raiz

if ($Versao -notmatch '^\d+\.\d+\.\d+$') {
  Write-Output "ERRO: a versao precisa ser no formato 1.2.3"
  exit 1
}

# ---------------------------------------------------------------- versao
node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));fs.writeFileSync('package.json',JSON.stringify(Object.assign(p,{version:process.argv[1]}),null,2)+'\n')" $Versao
if ($LASTEXITCODE -ne 0) { Write-Output "ERRO: nao consegui gravar a versao no package.json"; exit 1 }
Write-Output "versao: $Versao"

# ----------------------------------------------------- release no GitHub
if ($Notas -eq "") { $Notas = "Chronos $Versao" }

$antes = $ErrorActionPreference
$ErrorActionPreference = "SilentlyContinue"
& $gh release create "v$Versao" --repo $repo --title "Chronos $Versao" --notes $Notas | Out-Null
$criou = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = $antes

if ($criou) { Write-Output "release v$Versao criada (vazia, esperando os arquivos)" }
else { Write-Output "release v$Versao ja existia - vou subir os arquivos nela" }

# ------------------------------------------------------- compila e sobe
$env:GH_TOKEN = (& $gh auth token)
if (-not $env:GH_TOKEN) { Write-Output "ERRO: faca o login com 'gh auth login' antes"; exit 1 }

npm run release
if ($LASTEXITCODE -ne 0) { Write-Output "ERRO: falha ao compilar ou publicar"; exit 1 }

Write-Output ""
Write-Output "pronto: https://github.com/$repo/releases/tag/v$Versao"
Write-Output "no app: Ajustes -> Procurar atualizacoes"
