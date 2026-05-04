$ErrorActionPreference = "Stop"

$PackageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ResourcesDir = Join-Path $PackageRoot "resources"
$LocalAppDataRoot = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $env:USERPROFILE "AppData\Local" }
$AppDataDir = Join-Path $LocalAppDataRoot "LaputaMediaCenter"
$RuntimeDir = Join-Path $AppDataDir "runtime"
$TempDir = Join-Path $RuntimeDir "temp"
$OutputDir = Join-Path $RuntimeDir "output"
$DatabasePath = Join-Path $AppDataDir "laputa.sqlite"
$ServerPath = Join-Path $PackageRoot "server.js"
$PackagedNode = Join-Path $ResourcesDir "node\node.exe"

foreach ($Directory in @($ResourcesDir, $AppDataDir, $RuntimeDir, $TempDir, $OutputDir)) {
  New-Item -ItemType Directory -Force -Path $Directory | Out-Null
}

if (-not (Test-Path -LiteralPath $ServerPath)) {
  Write-Host "server.js not found in $PackageRoot"
  Write-Host "Please create the Lite package after a standalone build:"
  Write-Host '  $env:NEXT_OUTPUT_STANDALONE="true"; pnpm build; pnpm package:lite:win'
  exit 1
}

if (Test-Path -LiteralPath $PackagedNode) {
  $NodeExe = $PackagedNode
} else {
  $NodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if (-not $NodeCommand) {
    Write-Host "node.exe not found. Recreate the Lite package so resources\node\node.exe is bundled."
    exit 1
  }
  $NodeExe = $NodeCommand.Source
}

$env:LMC_LITE_MODE = "true"
$env:LMC_LITE_RESOURCES_DIR = $ResourcesDir
$env:LMC_APP_DATA_DIR = $AppDataDir
$env:RUNTIME_DIR = $RuntimeDir
$env:TEMP_DIR = $TempDir
$env:OUTPUT_DIR = $OutputDir
$env:DATABASE_URL = "file:$DatabasePath"
$env:AUTH_ENABLED = "false"
$env:LMC_BYPASS_LICENSE = "true"
$env:PORT = "8899"

$Url = "http://localhost:$($env:PORT)"
Write-Host "Starting LaputaMediaCenter Lite at $Url"
Start-Process $Url | Out-Null

Push-Location $PackageRoot
try {
  & $NodeExe .\server.js
} finally {
  Pop-Location
}
