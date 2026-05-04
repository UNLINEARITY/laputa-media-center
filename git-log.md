这是一个git commit log 文件，如果用户有需要，你应该读取同级的 log.md 文件的最新一次日志，并撰写对应的 git commit 的 summary和 description
- 重要：没有用户的明确指示，你不应该主动修改此文件，不得做出任何修改！！！
- 由于日志可能过长，你不用全部阅读，仅需阅读部分内容，你可以学习仿照相关的格式
- 每次将新的日志放置在开头，也就是此行说明的下面（防止上下文爆炸）

## [2026-05-04] fix(desktop): 修正安裝版無法開啟窗口

**commit summary**
fix(desktop): 修正安裝版無法開啟窗口

**description**
Fix the Windows desktop installer so the packaged Next sidecar can start outside the development checkout. The Lite packaging step now dereferences pnpm symlinks, hoists runtime packages from the virtual store into real `node_modules` directories, removes the deep `.pnpm` tree from the distributable bundle, and verifies required runtime dependencies before producing the desktop resources. This prevents installed apps from failing with `Cannot find module 'next'` or missing nested Next dependencies, allowing Tauri to wait for `/api/health` and open the desktop WebView normally.

修正 Windows 桌面安裝版在開發 checkout 之外無法啟動隨包 Next sidecar 的問題。Lite 打包流程現在會展開 pnpm 符號連結，將虛擬 store 中的 runtime package hoist 成真實 `node_modules` 目錄，從可分發包移除深層 `.pnpm` 樹，並在產出桌面 resources 前驗證必要 runtime dependency。這避免安裝後出現 `Cannot find module 'next'` 或 Next 巢狀依賴缺失，讓 Tauri 可以等到 `/api/health` 成功並正常打開桌面 WebView。

**verification**
- `corepack pnpm package:lite:win`
- Lite package smoke: bundled `resources/node/node.exe server.js` served `GET /api/health` with HTTP 200
- `node scripts/prepare-desktop-win.mjs`
- NSIS installer rebuild produced `src-tauri/target/release/bundle/nsis/LaputaMediaCenter_1.0.0_x64-setup.exe`
- NSIS installer smoke: silent install to `dist/desktop-smoke-install-v2`, installed app had `next` and `@swc/helpers` as real dependencies, no `.pnpm`, main window opened, and `/api/health` returned OK
- `corepack pnpm typecheck:app`
- `cargo check --manifest-path src-tauri\Cargo.toml`
- `corepack pnpm test:unit` (116 files / 827 pass / 17 skip)

## [2026-05-04] feat(desktop): 打包 Windows 桌面安裝版

**commit summary**
feat(desktop): 打包 Windows 桌面安裝版

**description**
Add a real Tauri v2 desktop shell and NSIS Windows installer for LaputaMediaCenter. The desktop app bundles the Lite standalone server plus Node, FFmpeg, yt-dlp, whisper.cpp, the base ggml model, embeddable Python, helper scripts, schema, fonts, and runtime resource wiring, while keeping API keys out of the package. It starts the bundled Next sidecar on a free localhost port, waits for `/api/health`, opens the WebView only after readiness, writes user data to AppData, logs sidecar output, and cleans the sidecar on normal app exit. Also tighten the Lite package contents so desktop bundling avoids traced source noise and NSIS long-path failures.

新增真正的 Tauri v2 桌面外殼與 NSIS Windows 安裝包。桌面版會隨包攜帶 Lite standalone server，以及 Node、FFmpeg、yt-dlp、whisper.cpp、base ggml 模型、嵌入式 Python、helper scripts、schema、字體與 runtime resource wiring，同時不把 API key 放進包內。應用會在空閒 localhost 端口啟動隨包 Next sidecar，等待 `/api/health` 成功後再打開 WebView，將用戶資料寫入 AppData，記錄 sidecar 日誌，並在正常退出時清理 sidecar。也收窄 Lite 包內容，避免 traced source noise 和 NSIS 長路徑打包失敗。

**verification**
- `corepack pnpm desktop:prepare:win`
- `corepack pnpm exec tauri build`
- NSIS installer smoke: silent install to `dist/desktop-smoke-install`, desktop exe starts bundled node sidecar, `/api/health` returns `ok`, and normal window close cleans the sidecar
- `corepack pnpm exec biome check package.json scripts/package-lite-win.mjs scripts/prepare-desktop-win.mjs src-tauri\tauri.conf.json`
- `cargo fmt --manifest-path src-tauri\Cargo.toml --check`
- `cargo check --manifest-path src-tauri\Cargo.toml`
- `corepack pnpm typecheck:app`
- `corepack pnpm test:unit` (116 files / 827 pass / 17 skip)

## [2026-05-04] fix(packaging): 自動清理 Lite 啟動端口

**commit summary**
fix(packaging): 自動清理 Lite 啟動端口

**description**
Teach the Lite Windows launcher to preflight the target port before starting the bundled server. It now accepts `PORT` overrides, validates the port, stops stale Laputa/Next/server.js `node.exe` processes that already own the port, and refuses to kill unknown programs while printing their PIDs and a fallback port command. Also allow `LMC_APP_DATA_DIR` to override the default AppData path and add `LMC_SKIP_BROWSER=true` for smoke tests or non-browser launches.

讓 Lite Windows 啟動腳本在啟動隨包 server 前先檢查目標端口。現在腳本支援 `PORT` 覆蓋、校驗端口、停止已占用端口的舊 Laputa / Next / `server.js` `node.exe` 進程；若端口屬於未知程序，則不誤殺，輸出 PID 並提示換端口命令。同時支援 `LMC_APP_DATA_DIR` 覆蓋默認 AppData 路徑，並加入 `LMC_SKIP_BROWSER=true` 供 smoke test 或不自動開瀏覽器場景使用。

**verification**
- PowerShell syntax check for `scripts/start-lite-win.ps1`
- `corepack pnpm package:lite:win`
- Controlled port cleanup smoke on `PORT=8905`: old Lite PID stopped, new PID took over the same port, and `GET http://127.0.0.1:8905/api/health` returned HTTP 200

## [2026-05-04] feat(packaging): 建立 Lite 便攜版運行時

**commit summary**
feat(packaging): 建立 Lite 便攜版運行時

**description**
Add a Lite portable runtime layer that resolves bundled resources before falling back to PATH, cache, or download flows. Ingest, ASR, dubbing, and runtime output paths now understand `LMC_LITE_RESOURCES_DIR` and `LMC_APP_DATA_DIR`, while explicit env overrides remain highest priority. Add a Windows Lite package script and launcher that produce `dist/laputa-lite-win` with a standalone server, bundled Node runtime, Python helper scripts, DB schema, resources layout, and local AppData storage. Set `turbopack.root` explicitly so Windows standalone builds no longer inherit the parent lockfile workspace root.

新增 Lite 便攜運行時層，讓隨包 resources 優先於 PATH、cache 或下載流程被解析。ingest、ASR、dubbing 與 runtime output path 現在都能識別 `LMC_LITE_RESOURCES_DIR` 與 `LMC_APP_DATA_DIR`，同時保留明確 env 覆蓋最高優先級。新增 Windows Lite 打包腳本與啟動腳本，可生成 `dist/laputa-lite-win`，內含 standalone server、隨包 Node、Python helper scripts、DB schema、resources layout 與本機 AppData 儲存。同步固定 `turbopack.root`，避免 Windows standalone build 因上層 lockfile 誤判 workspace root。

**verification**
- `corepack pnpm exec biome check ...`
- `corepack pnpm exec vitest run tests/packaging/lite-runtime.test.ts tests/ingest/runtime.test.ts tests/asr/binary-installer.test.ts tests/asr/model-installer.test.ts tests/jobs/dubbing-runtime.test.ts tests/utils/paths.test.ts tests/api/whisper-cpp-install-route.test.ts tests/api/runtime-status-redaction.test.ts`
- `corepack pnpm typecheck:app`
- `corepack pnpm test:unit`
- `$env:NEXT_OUTPUT_STANDALONE='true'; corepack pnpm build`
- `corepack pnpm package:lite:win`
- Lite package smoke: bundled `resources/node/node.exe` served `GET http://127.0.0.1:8903/api/health` with HTTP 200

## [2026-05-04] fix(settings): 修正 whisper.cpp 安裝限流提示

**commit summary**
fix(settings): 修正 whisper.cpp 安裝限流提示

**description**
Adjust the whisper.cpp install endpoint for local installer ergonomics: duplicate in-flight installs now return `409 install_in_progress` before consuming another rate-limit slot, while fresh install attempts use a local-friendly 3/minute guard. Return structured retry guidance on 429 and teach the Settings installer to surface readable 429/409 messages instead of raw HTTP status strings.

修正 whisper.cpp 本地安裝入口的限流體驗：重複安裝會先回傳 `409 install_in_progress`，不再消耗第二次限流名額；新的安裝嘗試改用較適合本地操作的 3 次/分鐘保護。429 會回傳結構化重試提示，Settings 安裝器也會顯示可讀的 429/409 文案，不再只顯示裸 `HTTP 429`。

**verification**
- `corepack pnpm exec biome check app\api\runtime\whisper-cpp\install\route.ts components\settings\whisper-cpp-installer.tsx tests\api\whisper-cpp-install-route.test.ts tests\components\whisper-cpp-installer.test.tsx`
- `corepack pnpm exec vitest run tests/api/whisper-cpp-install-route.test.ts tests/components/whisper-cpp-installer.test.tsx`
- `corepack pnpm test:unit`
- `corepack pnpm build`
- production smoke on `http://localhost:8899/settings` and `GET /api/runtime/whisper-cpp/status`

## [2026-05-04] feat(settings): 加入工具前置條件檢查

**commit summary**
feat(settings): 加入工具前置條件檢查

**description**
Add a setup requirement primitive and a read-only requirements API so each product tool can be evaluated against real provider, runtime, and local asset readiness. Surface the result in Settings as a per-tool checklist that shows required blockers, optional enhancements, and direct configuration links without triggering live Gemini or MiniMax calls. Keep the tool catalog as the source of product metadata, add focused product tests, and improve narrow mobile layout pressure in the provider switchers.

新增 setup requirement primitive 與只讀 requirements API，讓每個產品工具都能對應到真實 provider、runtime 與本地資產就緒狀態。Settings 現在提供按工具分組的前置條件檢查，顯示必需阻塞項、可選增強項與設定入口，且不觸發 Gemini 或 MiniMax 真實調用。保留 tool catalog 作為工具元資料真相源，新增聚焦產品測試，並小幅改善 provider switcher 在窄螢幕上的布局壓力。

**verification**
- `corepack pnpm exec biome check ...`
- `corepack pnpm exec vitest run tests/product/tool-catalog.test.ts tests/product/setup-requirements.test.ts`
- `corepack pnpm test:unit`
- `corepack pnpm build`
- production smoke on `http://localhost:8899/settings` and `GET /api/setup-requirements`
