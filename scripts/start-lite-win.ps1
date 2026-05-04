$ErrorActionPreference = "Stop"

$PackageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ResourcesDir = Join-Path $PackageRoot "resources"
$LocalAppDataRoot = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $env:USERPROFILE "AppData\Local" }
$AppDataDir = if ($env:LMC_APP_DATA_DIR) { $env:LMC_APP_DATA_DIR } else { Join-Path $LocalAppDataRoot "LaputaMediaCenter" }
$RuntimeDir = Join-Path $AppDataDir "runtime"
$TempDir = Join-Path $RuntimeDir "temp"
$OutputDir = Join-Path $RuntimeDir "output"
$DatabasePath = Join-Path $AppDataDir "laputa.sqlite"
$ServerPath = Join-Path $PackageRoot "server.js"
$PackagedNode = Join-Path $ResourcesDir "node\node.exe"
$PortText = if ($env:PORT) { $env:PORT } else { "8899" }
$Port = 0
if (-not [int]::TryParse($PortText, [ref]$Port) -or $Port -lt 1 -or $Port -gt 65535) {
  Write-Host "Invalid PORT: $PortText"
  exit 1
}

function Get-PortListeners {
  param([int]$ListenPort)

  try {
    return @(Get-NetTCPConnection -LocalPort $ListenPort -State Listen -ErrorAction SilentlyContinue)
  } catch {
    Write-Host "Port cleanup skipped: Get-NetTCPConnection is unavailable."
    return @()
  }
}

function Get-ProcessCommand {
  param([int]$ProcessId)

  try {
    return Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
  } catch {
    return $null
  }
}

function Test-IsLaputaNodeProcess {
  param($ProcessInfo)

  if (-not $ProcessInfo) {
    return $false
  }

  $Name = [string]$ProcessInfo.Name
  $CommandLine = [string]$ProcessInfo.CommandLine
  if ($Name -notmatch '^node(\.exe)?$') {
    return $false
  }

  return $CommandLine -match 'LaputaMediaCenter|laputa-media-center|server\.js|next(\\|/)dist(\\|/)bin(\\|/)next'
}

function Clear-LitePort {
  param([int]$ListenPort)

  $Listeners = Get-PortListeners -ListenPort $ListenPort
  if ($Listeners.Count -eq 0) {
    return
  }

  $UnknownBlockers = @()
  $ProcessIds = $Listeners | Select-Object -ExpandProperty OwningProcess -Unique

  foreach ($ProcessId in $ProcessIds) {
    if (-not $ProcessId) {
      continue
    }

    $ProcessInfo = Get-ProcessCommand -ProcessId $ProcessId
    if (Test-IsLaputaNodeProcess -ProcessInfo $ProcessInfo) {
      Write-Host "Port $ListenPort is already used by an old Laputa process (PID $ProcessId). Stopping it..."
      Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
      continue
    }

    $UnknownBlockers += [pscustomobject]@{
      ProcessId = $ProcessId
      Name = if ($ProcessInfo) { $ProcessInfo.Name } else { "unknown" }
      CommandLine = if ($ProcessInfo) { $ProcessInfo.CommandLine } else { "" }
    }
  }

  Start-Sleep -Milliseconds 500

  $Remaining = Get-PortListeners -ListenPort $ListenPort
  if ($Remaining.Count -gt 0) {
    Write-Host "Port $ListenPort is still occupied and was not stopped automatically:"
    foreach ($ProcessId in ($Remaining | Select-Object -ExpandProperty OwningProcess -Unique)) {
      $ProcessInfo = Get-ProcessCommand -ProcessId $ProcessId
      $Name = if ($ProcessInfo) { $ProcessInfo.Name } else { "unknown" }
      Write-Host "  PID $ProcessId $Name"
    }
    Write-Host "Close that program, or run this script with another port, for example:"
    Write-Host '  $env:PORT="8898"; .\start-lite-win.ps1'
    exit 1
  }
}

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
$env:PORT = [string]$Port

Clear-LitePort -ListenPort $Port

$Url = "http://localhost:$($env:PORT)"
Write-Host "Starting LaputaMediaCenter Lite at $Url"
if ($env:LMC_SKIP_BROWSER -ne "true") {
  Start-Process $Url | Out-Null
}

Push-Location $PackageRoot
try {
  & $NodeExe .\server.js
} finally {
  Pop-Location
}
