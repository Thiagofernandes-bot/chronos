# Compila o chronos-probe.exe usando o compilador C# que ja vem no Windows.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$csc  = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$wpf  = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\WPF"

if (-not (Test-Path $csc)) { throw "csc.exe nao encontrado: instale o .NET Framework 4.x" }
New-Item -ItemType Directory -Force -Path "$root\resources" | Out-Null

& $csc /nologo /target:exe /platform:anycpu /optimize+ /warn:1 `
  /out:"$root\resources\chronos-probe.exe" `
  /r:"$wpf\UIAutomationClient.dll" /r:"$wpf\UIAutomationTypes.dll" `
  "$root\native\ChronosProbe.cs"

Write-Output "probe compilado em $root\resources\chronos-probe.exe"
