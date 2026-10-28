# Publica uma versao nova do Chronos.
#
#   .\native\release.ps1 1.2.1
#
# Cria a release no GitHub ANTES de compilar. Sem isso o electron-builder
# publica o instalador e o blockmap em paralelo, cada um cria uma release com
# a mesma tag, e sobra uma duplicada vazia na pagina.

param(
  [Parameter(Mandatory = $true)][string]$Versao,
  [string]$Notas = ""
)

$ErrorActionPreference = "Stop"
$raiz = Split-Path -Parent $PSScriptRoot
$gh = "C:\Users\thiag\Apps\gh\bin\gh.exe"
if (-not (Test-Path $gh)) { $gh = "gh" }

Set-Location $raiz

if ($Versao -notmatch '^\d+\.\d+\.\d+$') { throw "Versao precisa ser no formato 1.2.3" }

# 1. grava a versao no package.json (pelo node, para nao mexer no resto do
#    arquivo nem estragar acentos)
node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));console.log(p.version);p.version=process.argv[1];fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')" $Versao
Write-Output "versao agora: $Versao"

# 2. cria a release vazia, para os dois uploads caírem na mesma
if ($Notas -eq "") { $Notas = "Chronos $Versao" }
& $gh release view "v$Versao" --repo Thiagofernandes-bot/chronos 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  & $gh release create "v$Versao" --repo Thiagofernandes-bot/chronos --title "Chronos $Versao" --notes $Notas
  Write-Output "release v$Versao criada"
} else {
  Write-Output "release v$Versao ja existia, vou reaproveitar"
}

# 3. compila e sobe os arquivos para dentro dela
$env:GH_TOKEN = (& $gh auth token)
npm run release
if ($LASTEXITCODE -ne 0) { throw "falha ao publicar" }

Write-Output ""
Write-Output "pronto: https://github.com/Thiagofernandes-bot/chronos/releases/tag/v$Versao"
Write-Output "os apps instalados vao achar essa versao na proxima checagem."
