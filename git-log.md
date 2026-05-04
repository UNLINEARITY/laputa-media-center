这是一个git commit log 文件，如果用户有需要，你应该读取同级的 log.md 文件的最新一次日志，并撰写对应的 git commit 的 summary和 description
- 重要：没有用户的明确指示，你不应该主动修改此文件，不得做出任何修改！！！
- 由于日志可能过长，你不用全部阅读，仅需阅读部分内容，你可以学习仿照相关的格式
- 每次将新的日志放置在开头，也就是此行说明的下面（防止上下文爆炸）

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
