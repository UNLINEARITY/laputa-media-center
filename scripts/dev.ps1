$ErrorActionPreference = "Stop"

Write-Host "Starting LaputaMediaCenter dev server..." -ForegroundColor Cyan

$port = 8899
$connections = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
if ($connections) {
  $pids = $connections | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($processId in $pids) {
    if ($processId -and $processId -ne $PID) {
      Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
  }
}

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  npm install -g pnpm
}

if (-not (Test-Path "node_modules")) {
  pnpm install
}

if (-not (Test-Path "data")) {
  New-Item -ItemType Directory -Force -Path data, temp, output, logs | Out-Null
  pnpm db:init
}

pnpm dev
