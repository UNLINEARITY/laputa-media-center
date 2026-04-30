# LaputaMediaCenter 翻譯配音管線 - 一鍵安裝腳本 (Windows PowerShell)
# 用法: 右鍵以管理員身份運行，或在 PowerShell 中: .\scripts\setup-dubbing.ps1

$ErrorActionPreference = "Stop"
$SKILL_DIR = Join-Path $PSScriptRoot ".." "laputa-video-chuangcut-editing"
$SCRIPTS_DIR = Join-Path $SKILL_DIR "scripts" "python"

Write-Host "================================================" -ForegroundColor Cyan
Write-Host " LaputaMediaCenter 翻譯配音管線 - 安裝程序" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# ============================================================
# Step 1: 檢查前置條件
# ============================================================
Write-Host "[1/7] 檢查前置條件..." -ForegroundColor Yellow

# Python 3.14
$py314 = Get-Command python -ErrorAction SilentlyContinue
if ($py314) {
    $pyVer = & python --version 2>&1
    Write-Host "  Python: $pyVer" -ForegroundColor Green
} else {
    Write-Host "  ERROR: Python 未安裝，請先安裝 Python 3.14" -ForegroundColor Red
    Write-Host "  下載: https://www.python.org/downloads/" -ForegroundColor Red
    exit 1
}

# Python 3.10 (for Wav2Lip + pyannote)
$py310Path = "C:\Users\$env:USERNAME\AppData\Local\Programs\Python\Python310\python.exe"
if (Test-Path $py310Path) {
    Write-Host "  Python 3.10: OK" -ForegroundColor Green
} else {
    Write-Host "  安裝 Python 3.10 (Wav2Lip 需要)..." -ForegroundColor Yellow
    winget install Python.Python.3.10 --accept-package-agreements --accept-source-agreements
    if (-not (Test-Path $py310Path)) {
        Write-Host "  ERROR: Python 3.10 安裝失敗" -ForegroundColor Red
        exit 1
    }
}

# FFmpeg
$ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
if ($ffmpeg) {
    Write-Host "  FFmpeg: OK" -ForegroundColor Green
} else {
    Write-Host "  ERROR: FFmpeg 未安裝" -ForegroundColor Red
    Write-Host "  請先安裝 FFmpeg 並加入 PATH" -ForegroundColor Red
    Write-Host "  下載: https://www.gyan.dev/ffmpeg/builds/" -ForegroundColor Red
    exit 1
}

# NVIDIA GPU
$gpu = & nvidia-smi --query-gpu=name --format=csv,noheader 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "  GPU: $gpu" -ForegroundColor Green
} else {
    Write-Host "  WARNING: 未檢測到 NVIDIA GPU，部分功能可能較慢" -ForegroundColor Yellow
}

Write-Host ""

# ============================================================
# Step 2: 建立虛擬環境
# ============================================================
Write-Host "[2/7] 建立 Python 虛擬環境..." -ForegroundColor Yellow

# venv-dub (Python 3.14) - Whisper + MiniMax + 翻譯
$venvDub = Join-Path $SCRIPTS_DIR "venv-dub"
if (-not (Test-Path $venvDub)) {
    Write-Host "  建立 venv-dub (Python 3.14)..."
    & python -m venv $venvDub
} else {
    Write-Host "  venv-dub 已存在" -ForegroundColor Green
}

# venv-rvc (Python 3.10) - Wav2Lip
$venvRvc = Join-Path $SCRIPTS_DIR "venv-rvc"
if (-not (Test-Path $venvRvc)) {
    Write-Host "  建立 venv-rvc (Python 3.10)..."
    & $py310Path -m venv $venvRvc
} else {
    Write-Host "  venv-rvc 已存在" -ForegroundColor Green
}

# venv-diarize (Python 3.10) - pyannote
$venvDiarize = Join-Path $SCRIPTS_DIR "venv-diarize"
if (-not (Test-Path $venvDiarize)) {
    Write-Host "  建立 venv-diarize (Python 3.10)..."
    & $py310Path -m venv $venvDiarize
} else {
    Write-Host "  venv-diarize 已存在" -ForegroundColor Green
}

Write-Host ""

# ============================================================
# Step 3: 安裝 PyTorch CUDA
# ============================================================
Write-Host "[3/7] 安裝 PyTorch + CUDA..." -ForegroundColor Yellow

$pipDub = Join-Path $venvDub "Scripts" "pip.exe"
$pipRvc = Join-Path $venvRvc "Scripts" "pip.exe"
$pipDiarize = Join-Path $venvDiarize "Scripts" "pip.exe"

# 升級 pip
& $pipDub install -U pip -i https://pypi.org/simple/ 2>&1 | Out-Null
& $pipRvc install -U pip -i https://pypi.org/simple/ 2>&1 | Out-Null
& $pipDiarize install -U pip -i https://pypi.org/simple/ 2>&1 | Out-Null

# venv-dub: PyTorch cu128 (for RTX 50 series) or cu126 (for RTX 30/40)
Write-Host "  venv-dub: PyTorch..."
& $pipDub install typing-extensions -i https://pypi.org/simple/ 2>&1 | Out-Null
& $pipDub install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128 2>&1 | Out-Null

# venv-rvc: PyTorch cu128
Write-Host "  venv-rvc: PyTorch..."
& $pipRvc install typing-extensions -i https://pypi.org/simple/ 2>&1 | Out-Null
& $pipRvc install torch torchaudio --index-url https://download.pytorch.org/whl/cu128 2>&1 | Out-Null

# venv-diarize: PyTorch cu124 (pyannote 3.x 需要)
Write-Host "  venv-diarize: PyTorch 2.5 (pyannote 兼容)..."
& $pipDiarize install typing-extensions -i https://pypi.org/simple/ 2>&1 | Out-Null
& $pipDiarize install torch==2.5.1+cu124 torchaudio==2.5.1+cu124 --index-url https://download.pytorch.org/whl/cu124 2>&1 | Out-Null

Write-Host ""

# ============================================================
# Step 4: 安裝 Python 依賴
# ============================================================
Write-Host "[4/7] 安裝 Python 依賴..." -ForegroundColor Yellow

# venv-dub: Whisper + MiniMax SDK + 翻譯
Write-Host "  venv-dub: Whisper + httpx + ormsgpack..."
& $pipDub install openai-whisper anthropic openai httpx ormsgpack edge-tts -i https://pypi.org/simple/ 2>&1 | Out-Null

# venv-rvc: RVC + Wav2Lip deps
Write-Host "  venv-rvc: RVC + Wav2Lip..."
& $pipRvc install rvc-python librosa opencv-contrib-python -i https://pypi.org/simple/ 2>&1 | Out-Null

# venv-diarize: pyannote
Write-Host "  venv-diarize: pyannote..."
& $pipDiarize install "pyannote.audio>=3,<4" "huggingface_hub<1" "speechbrain<1" pandas -i https://pypi.org/simple/ 2>&1 | Out-Null

Write-Host ""

# ============================================================
# Step 5: 下載 Wav2Lip 模型
# ============================================================
Write-Host "[5/7] 下載 Wav2Lip 模型..." -ForegroundColor Yellow

$wav2lipDir = Join-Path $SCRIPTS_DIR "wav2lip-HD" "Wav2Lip-master"
if (-not (Test-Path (Join-Path $SCRIPTS_DIR "wav2lip-HD"))) {
    Write-Host "  克隆 Wav2Lip-HD..."
    git clone --depth 1 https://github.com/indianajson/wav2lip-HD.git (Join-Path $SCRIPTS_DIR "wav2lip-HD")
}

$checkpointDir = Join-Path $wav2lipDir "checkpoints"
$modelFile = Join-Path $checkpointDir "wav2lip_gan.pth"
if (-not (Test-Path $modelFile)) {
    Write-Host "  下載 wav2lip_gan.pth (436MB)..."
    Invoke-WebRequest -Uri "https://huggingface.co/camenduru/Wav2Lip/resolve/main/checkpoints/wav2lip_gan.pth" -OutFile $modelFile
}

$sfdDir = Join-Path $wav2lipDir "face_detection" "detection" "sfd"
$sfdFile = Join-Path $sfdDir "s3fd.pth"
if (-not (Test-Path $sfdFile)) {
    New-Item -ItemType Directory -Path $sfdDir -Force | Out-Null
    Write-Host "  下載 s3fd.pth (90MB)..."
    Invoke-WebRequest -Uri "https://www.adrianbulat.com/downloads/python-fan/s3fd-619a316812.pth" -OutFile $sfdFile
}

Write-Host "  Wav2Lip 模型: OK" -ForegroundColor Green
Write-Host ""

# ============================================================
# Step 6: 配置憑證
# ============================================================
Write-Host "[6/7] 配置憑證..." -ForegroundColor Yellow

$credDir = Join-Path $SKILL_DIR "credentials"
New-Item -ItemType Directory -Path $credDir -Force | Out-Null

$minimaxCred = Join-Path $credDir "minimax.json"
if (-not (Test-Path $minimaxCred)) {
    $key = Read-Host "  請輸入 MiniMax API Key (platform.minimaxi.com)"
    @{
        schema_version = "1.0"
        name = "minimax"
        kind = "api_key"
        status = "active"
        provider = "MiniMax"
        auth = @{ method = "bearer"; header = "Authorization"; token = $key }
        config = @{ model = "speech-2.8-hd"; language_boost = "Chinese,Yue"; api_base = "https://api.minimaxi.com/v1" }
    } | ConvertTo-Json -Depth 3 | Set-Content $minimaxCred -Encoding UTF8
    Write-Host "  MiniMax 憑證: 已保存" -ForegroundColor Green
} else {
    Write-Host "  MiniMax 憑證: 已存在" -ForegroundColor Green
}

$hfCred = Join-Path $credDir "huggingface.json"
if (-not (Test-Path $hfCred)) {
    $hfKey = Read-Host "  請輸入 HuggingFace Token (多人模式需要，可跳過按 Enter)"
    if ($hfKey) {
        @{
            schema_version = "1.0"
            name = "huggingface"
            kind = "api_key"
            status = "active"
            provider = "HuggingFace"
            auth = @{ method = "bearer"; header = "Authorization"; token = $hfKey }
        } | ConvertTo-Json -Depth 3 | Set-Content $hfCred -Encoding UTF8
        Write-Host "  HuggingFace 憑證: 已保存" -ForegroundColor Green
    } else {
        Write-Host "  HuggingFace: 已跳過（多人模式不可用）" -ForegroundColor Yellow
    }
} else {
    Write-Host "  HuggingFace 憑證: 已存在" -ForegroundColor Green
}

Write-Host ""

# ============================================================
# Step 7: 驗證安裝
# ============================================================
Write-Host "[7/7] 驗證安裝..." -ForegroundColor Yellow

$pyDub = Join-Path $venvDub "Scripts" "python.exe"
$pyRvc = Join-Path $venvRvc "Scripts" "python.exe"

& $pyDub -c "import torch; print(f'  venv-dub: torch={torch.__version__}, cuda={torch.cuda.is_available()}')" 2>&1
& $pyDub -c "import whisper; print('  Whisper: OK')" 2>&1
& $pyRvc -c "print('  venv-rvc: OK')" 2>&1

Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host " 安裝完成！" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
Write-Host ""
Write-Host "翻譯方式（三選一）:" -ForegroundColor White
Write-Host "  方式 A: MiniMax API 自動翻譯（默認，只需 MiniMax Key）" -ForegroundColor Cyan
Write-Host "  方式 B: Claude Code / VS Code Codex session 內免費翻譯" -ForegroundColor Cyan
Write-Host "  方式 C: Anthropic / OpenAI API 翻譯" -ForegroundColor Cyan
Write-Host ""
Write-Host "用法:" -ForegroundColor White
Write-Host ""
Write-Host "  # 方式 A: 一鍵配音（默認用 MiniMax 翻譯，只需一個 Key）" -ForegroundColor Gray
Write-Host "  cd $SCRIPTS_DIR" -ForegroundColor Gray
Write-Host '  venv-dub\Scripts\python.exe dub_pipeline.py -i video.mp4 --voice-id YOUR_VOICE_ID' -ForegroundColor Gray
Write-Host ""
Write-Host "  # 方式 B: 用 Claude Code 或 VS Code Codex 免費翻譯" -ForegroundColor Gray
Write-Host '  venv-dub\Scripts\python.exe dub_pipeline.py -i video.mp4 --translate-mode session --voice-id YOUR_VOICE_ID' -ForegroundColor Gray
Write-Host "  # → 腳本會暫停，在 Claude Code / Codex 中完成翻譯後繼續" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  # 多人配音" -ForegroundColor Gray
Write-Host '  venv-dub\Scripts\python.exe dub_pipeline.py -i interview.mp4 --diarize --hf-token YOUR_TOKEN --voice-map "SPEAKER_00=minimax:Cantonese_PlayfulMan,SPEAKER_01=minimax:Cantonese_GentleLady"' -ForegroundColor Gray
Write-Host ""
Write-Host "  # Web 儀表板" -ForegroundColor Gray
Write-Host "  cd $PSScriptRoot\.." -ForegroundColor Gray
Write-Host "  pnpm install && pnpm db:init && pnpm dev" -ForegroundColor Gray
Write-Host ""
