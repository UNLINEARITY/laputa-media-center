# LaputaMediaCenter — Windows installer
# Reads required versions from package.json (single source of truth: engines.node + packageManager).

$ErrorActionPreference = 'Stop'

Write-Host '=== LaputaMediaCenter installer ===' -ForegroundColor Cyan
Write-Host ''

# 1. Read required versions from package.json
$pkg = Get-Content -Raw -Path 'package.json' | ConvertFrom-Json
$requiredNode = ($pkg.engines.node -replace '[^\d.]', '').Split('.')[0]
$requiredPnpm = ($pkg.packageManager -replace '^pnpm@', '')
$requiredPnpmMajor = $requiredPnpm.Split('.')[0]

Write-Host "Required: Node >= $requiredNode, pnpm $requiredPnpm"

# 2. Check Node
try {
    $nodeVer = (& node --version) -replace '^v', ''
    $nodeMajor = $nodeVer.Split('.')[0]
    if ([int]$nodeMajor -lt [int]$requiredNode) {
        Write-Host "❌ Node $nodeVer is too old. Need >= $requiredNode. Install from https://nodejs.org" -ForegroundColor Red
        exit 1
    }
    Write-Host "✓ Node $nodeVer" -ForegroundColor Green
} catch {
    Write-Host "❌ Node not found on PATH. Install Node $requiredNode+ from https://nodejs.org" -ForegroundColor Red
    exit 1
}

# 3. Check pnpm
try {
    $pnpmVer = & pnpm --version
    $pnpmMajor = $pnpmVer.Split('.')[0]
    if ([int]$pnpmMajor -lt [int]$requiredPnpmMajor) {
        Write-Host "⚠️ pnpm $pnpmVer is older than recommended $requiredPnpm. Continue anyway? (Ctrl+C to abort)" -ForegroundColor Yellow
        Start-Sleep -Seconds 3
    } else {
        Write-Host "✓ pnpm $pnpmVer" -ForegroundColor Green
    }
} catch {
    Write-Host "❌ pnpm not found. Install with: npm install -g pnpm@$requiredPnpm" -ForegroundColor Red
    exit 1
}

# 4. Soft-check optional native tools (warn only, don't block)
foreach ($tool in @('ffmpeg', 'yt-dlp')) {
    if (Get-Command $tool -ErrorAction SilentlyContinue) {
        Write-Host "✓ $tool on PATH" -ForegroundColor Green
    } else {
        Write-Host "⚠️ $tool not on PATH (needed for /ingest /highlights /dubbing)." -ForegroundColor Yellow
    }
}
Write-Host '   whisper.cpp will auto-download to ~/.laputa/whisper/ on first ASR run.' -ForegroundColor DarkGray
Write-Host ''

# 5. Install + init DB
Write-Host '→ pnpm install ...' -ForegroundColor Cyan
& pnpm install
if ($LASTEXITCODE -ne 0) { Write-Host '❌ pnpm install failed' -ForegroundColor Red; exit 1 }

Write-Host '→ pnpm db:init ...' -ForegroundColor Cyan
& pnpm db:init
if ($LASTEXITCODE -ne 0) { Write-Host '❌ pnpm db:init failed' -ForegroundColor Red; exit 1 }

Write-Host ''
Write-Host '✅ Install complete.' -ForegroundColor Green
Write-Host ''
Write-Host '   Run dev server: pnpm dev   (http://localhost:8899)'
Write-Host '   Run E2E tests:  pnpm test:e2e'
Write-Host '   See README.md / README.en.md for next steps.'
