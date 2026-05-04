这是一份日志文件 log ，如用户有需要，你应该将最近几次的修改加入到此文件当中
- 重要：没有用户的明确指示，你不应该主动修改此文件，不得做出任何修改！！！
- 由于日志可能过长，你不用全部阅读，仅需阅读部分内容，你可以学习仿照相关的格式
- 每次将新的日志放置在开头，也就是此行说明的下面（防止上下文爆炸）

## [2026-05-04] 建立 Lite 小白版便攜運行時基礎

### 用戶提出的問題
1. 上游前置鏈路太多，不利於小白朋友直接安裝使用。
2. 需要開始實作 Lite 小白版，先把前置鏈路往完整、精簡、可分發方向收斂。

### 問題原因/修改思路
- 原項目依賴本機 PATH、`~/.laputa` cache、Python 腳本位置與 `RUNTIME_DIR`，對開發者可用，但對小白分發不穩定。
- 第一刀不直接做 Tauri 外殼，而是先建立 portable runtime foundation：產品運行時能優先讀隨包 resources，資料寫到本機 AppData，並生成可啟動的 Windows Lite 包。
- 優先級保持可控：明確環境變數覆蓋最高，其次是 Lite 隨包資源，最後才回退 PATH / cache / 自動下載。

### 實際修改記錄
- **`lib/packaging/lite-runtime.ts`**:
  - 新增 Lite resources / app data resolver。
  - 支援 ffmpeg、ffprobe、yt-dlp、whisper-cli、Python、Python scripts、whisper ggml model 的隨包路徑解析。
- **`lib/ingest/runtime.ts`**:
  - ffmpeg、yt-dlp、whisper.cpp binary 支援 `source: 'packaged'`。
  - `getIngestFfmpeg()`、`getIngestYtDlp()`、`getWhisperCppPath()` 會在 env 後優先使用隨包 resources。
- **`lib/asr/binary-installer.ts` / `lib/asr/model-installer.ts`**:
  - whisper.cpp binary / model 支援 packaged source。
  - Lite mode 下 cache root 改走 `LMC_APP_DATA_DIR`，避免寫到開發者 home。
- **`lib/dubbing/runtime.ts`**:
  - Lite mode 下 skill dir / Python / helper scripts / credentials / Wav2Lip 資源可從 `LMC_LITE_RESOURCES_DIR` 解析。
  - 未修改受保護的 `scripts/translator.py`，只在打包時複製。
- **`lib/utils/paths.ts`**:
  - Lite mode 下 runtime temp/output 預設落到 `LMC_APP_DATA_DIR/runtime`。
- **`scripts/package-lite-win.mjs` / `scripts/start-lite-win.ps1` / `package.json`**:
  - 新增 `pnpm package:lite:win`，生成 `dist/laputa-lite-win`。
  - 包內包含 standalone server、隨包 Node、Python helper scripts、DB schema、resources layout、啟動腳本。
  - 啟動腳本設置 `LMC_LITE_MODE`、`LMC_LITE_RESOURCES_DIR`、`LMC_APP_DATA_DIR`、runtime/temp/output/database、`AUTH_ENABLED=false`、`LMC_BYPASS_LICENSE=true`、`PORT=8899`。
  - 打包時會複製 PATH / cache 中已有的 ffmpeg、ffprobe、yt-dlp、whisper.cpp binary、ggml-base；缺失時保留 resources 占位。
- **`next.config.ts`**:
  - 明確設置 `turbopack.root = process.cwd()`，消除 Windows 上因上層 lockfile 導致的 workspace root 誤判。
- **新增測試**:
  - `tests/packaging/lite-runtime.test.ts`
  - `tests/ingest/runtime.test.ts`
  - `tests/asr/binary-installer.test.ts`
  - `tests/asr/model-installer.test.ts`
  - `tests/jobs/dubbing-runtime.test.ts`
  - `tests/utils/paths.test.ts`
- **`PROJECT_PLAN.md`**:
  - 更新 Lite 小白版進度與下一步前置鏈路打包方向。

### 驗證
- ✅ `corepack pnpm exec biome check ...` 通過。
- ✅ `corepack pnpm exec vitest run tests/packaging/lite-runtime.test.ts tests/ingest/runtime.test.ts tests/asr/binary-installer.test.ts tests/asr/model-installer.test.ts tests/jobs/dubbing-runtime.test.ts tests/utils/paths.test.ts tests/api/whisper-cpp-install-route.test.ts tests/api/runtime-status-redaction.test.ts` 通過：8 files / 16 pass。
- ✅ `corepack pnpm typecheck:app` 通過。
- ✅ `corepack pnpm test:unit` 通過：116 files / 827 pass / 17 skip。
- ✅ `$env:NEXT_OUTPUT_STANDALONE='true'; corepack pnpm build` 通過，Next workspace-root 警告消失。
- ✅ `corepack pnpm package:lite:win` 通過，生成 `dist/laputa-lite-win`，包根有 `server.js`、`start-lite-win.ps1`、`resources/node/node.exe`、`resources/scripts/translator.py`、`lib/db/schema.sql`。
- ✅ 使用生成包內的 `resources/node/node.exe` 在 `PORT=8903` 啟動 Lite server，`curl http://127.0.0.1:8903/api/health` 返回 200。
- ⚠️ 本機 PATH 未找到 ffmpeg / ffprobe / yt-dlp / whisper-cli，`~/.laputa` 也未找到 `ggml-base.bin`；本次先完成可攜 layout 與已存在資源複製，下一步補自動下載或隨包攜帶策略。

## [2026-05-04] 修正 whisper.cpp 安裝 429 體驗

### 用戶提出的問題
1. 在瀏覽器 console 看到 `POST http://localhost:8899/api/runtime/whisper-cpp/install 429 (Too Many Requests)`。
2. 需要直接修正並實際跑起項目確認。

### 問題原因/修改思路
- 安裝 API 原本把 whisper.cpp 首次安裝限制為 1 分鐘 1 次 POST，但本地安裝按鈕容易因失敗重試、重複點擊或頁面刷新再次觸發。
- 後端已經有 module-level single-flight 保護，真正需要的是「同一時間只跑一個下載」，不是把正常重試直接變成裸 429。
- 修法保持最小切片：先判斷 single-flight，再套用較寬鬆的本地安裝限流；前端解析 429/409 JSON，給出可讀中文提示。

### 實際修改記錄
- **`app/api/runtime/whisper-cpp/install/route.ts`**:
  - 將重複安裝請求優先回傳 `409 install_in_progress`，避免佔用額外限流名額。
  - 將本地安裝限流從 `1/min` 調整為 `3/min`。
  - 429 response 增加 `message`、`retry_after` 與 `Retry-After` header。
- **`components/settings/whisper-cpp-installer.tsx`**:
  - 新增 HTTP error body 解析，針對 `429` 顯示「請 X 秒後再試」。
  - 針對 `409` 顯示「安裝已在進行中」，不再只暴露 `HTTP 429` / `HTTP 409`。
  - 補充無 SSE body 時的安全 fallback 文案。
- **`tests/api/whisper-cpp-install-route.test.ts`**:
  - 覆蓋 duplicate install 先回 409、不再消耗第二次限流。
  - 覆蓋 429 retry guidance 與外部 token 禁止安裝。
- **`tests/components/whisper-cpp-installer.test.tsx`**:
  - 模擬安裝 API 回 429，驗證 UI 顯示中文重試提示而不是裸 `HTTP 429`。
- **`PROJECT_PLAN.md`**:
  - 更新當前進度與下次繼續方向。

### 驗證
- ✅ `corepack pnpm exec biome check app\api\runtime\whisper-cpp\install\route.ts components\settings\whisper-cpp-installer.tsx tests\api\whisper-cpp-install-route.test.ts tests\components\whisper-cpp-installer.test.tsx` 通過。
- ✅ `corepack pnpm exec vitest run tests/api/whisper-cpp-install-route.test.ts tests/components/whisper-cpp-installer.test.tsx` 通過：2 files / 4 pass。
- ✅ `corepack pnpm test:unit` 通過：110 files / 816 pass / 17 skip。
- ✅ `corepack pnpm build` 通過，`/api/runtime/whisper-cpp/install` 出現在 Next route table。
- ✅ production 服務已重啟：`http://localhost:8899/api/health` 返回 200，`http://localhost:8899/api/runtime/whisper-cpp/status` 返回 200。
- ✅ 使用系統 Edge 打開 `http://localhost:8899/settings`，切到維護兼容頁可看到 `安裝 whisper.cpp` 按鈕，console 未出現 429；截圖保存在 `tmp/whisper-installer-smoke.png`。

## [2026-05-04] 落地工具前置条件检查面板

### 用户提出的问题
1. 项目上游前置链路较多，不利于朋友安装后分发使用。
2. 需要先实际部署看看，并尝试用可并行 agent 的方式收敛前置链路体验。
3. 在提交前要求补齐双 log。

### 问题原因/修改思路
- 原有 `tool-catalog` 已经记录每个工具的 `requiredSetup` / `optionalSetup`，但这些依赖还只是文档级标记，没有映射到真实 provider、runtime 和本地资产状态。
- Settings 页已经分散具备 LLM、ASR、MiniMax、ffmpeg、yt-dlp、Wav2Lip、声线库等检查入口，但用户需要的是“想跑哪个工具，还缺什么”的聚合视图。
- 采用最小切片：先抽出 Requirement primitive，再新增只读聚合 API，最后在 Settings 系统页展示按工具分组的缺项。

### 实际修改记录
- **`lib/product/setup-requirements.ts`**:
  - 新增 `SetupRequirementId`、Requirement definition、readiness state 和按工具汇总函数。
  - 锁定 `llm`、`minimax-tts`、`asr`、`ffmpeg`、`yt-dlp`、`voice-registry`、`wav2lip` 七类前置条件。
- **`lib/product/setup-requirement-readiness.ts`**:
  - 新增 server-side readiness 聚合，复用现有 LLM/ASR provider、MiniMax credential、ingest runtime、dubbing runtime、whisper.cpp、声线库检查。
  - 只读取本机状态和已保存配置，不触发 Gemini / MiniMax 真实调用。
- **`app/api/setup-requirements/route.ts`**:
  - 新增 `GET /api/setup-requirements`，返回 requirements 与 tools 两层聚合结果。
- **`components/settings/tool-requirements-overview.tsx`**、**`app/settings/page.tsx`**:
  - 在 Settings 系统设置页新增“按工具检查前置条件”面板。
  - 每个工具展示必需/可选前置条件、缺项数量、可运行/阻塞/降级状态，并可跳转到对应设置位置。
- **`components/settings/asr-provider-switcher.tsx`**、**`components/settings/llm-provider-switcher.tsx`**:
  - 小幅修正移动端布局，避免 provider 徽章和按钮在窄屏互相挤压。
- **`lib/product/tool-catalog.ts`**:
  - 将 `SetupRequirementId` 抽到独立 Requirement primitive，保留工具目录作为工具元数据真相源。
- **`tests/product/setup-requirements.test.ts`**:
  - 新增 setup requirement invariant 测试，覆盖定义完整性、Settings anchor、必需/可选缺项对工具 readiness 的影响。
- **`PROJECT_PLAN.md`**:
  - 更新 v1.1 跟进清单：Requirement primitive 已完成，下一步转向分发前置链路简化与 Tauri / Windows installer 评估。

### 验证
- ✅ `corepack pnpm exec biome check ...` 通过。
- ✅ `corepack pnpm exec vitest run tests/product/tool-catalog.test.ts tests/product/setup-requirements.test.ts` 通过：2 files / 28 pass。
- ✅ `corepack pnpm test:unit` 通过：108 files / 812 pass / 17 skip。
- ✅ `corepack pnpm build` 通过，新路由 `/api/setup-requirements` 出现在 Next 路由表。
- ✅ 生产模式实机启动：`LMC_BYPASS_LICENSE=true AUTH_ENABLED=false PORT=8899 pnpm start`，`http://localhost:8899/api/setup-requirements` 返回 200，`http://localhost:8899/settings` 返回 200 且包含新面板。
- ✅ 使用系统 Edge 通过 Playwright smoke 截图验证桌面与移动端布局；截图保存在 `tmp/settings-requirements-desktop.png` 与 `tmp/settings-requirements-mobile.png`。
