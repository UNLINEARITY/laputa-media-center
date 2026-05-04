这是一个git commit log 文件，如果用户有需要，你应该读取同级的 log.md 文件的最新一次日志，并撰写对应的 git commit 的 summary和 description
- 重要：没有用户的明确指示，你不应该主动修改此文件，不得做出任何修改！！！
- 由于日志可能过长，你不用全部阅读，仅需阅读部分内容，你可以学习仿照相关的格式
- 每次将新的日志放置在开头，也就是此行说明的下面（防止上下文爆炸）

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
