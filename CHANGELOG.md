# CHANGELOG

LaputaMediaCenter 的版本變更紀錄。語意化版本（major.minor.patch），日期格式 YYYY-MM-DD。

## [1.0.0] — 2026-05-01（自媒體生產台 v1，commit `5df8bd0`）

從 ChuangCut（v16.x）重構為 LaputaMediaCenter v1.0.0。版本號 reset 為「v1 自媒體生產台」起點。

**主要工具線**：
- 影片本地化（普通话 / 粤语）— `/dubbing`
- 播客整理（长文/字幕 → 双人脚本 + MiniMax 配音）— `/podcast`
- 高亮切片（长视频 → 30-60s 短片 + 烧录字幕）— `/highlights`
- 多平台改写（YT/抖音/小红书/公众号）— `/script-rewrite`
- 标题与开头优化（5 候选标题 + 开头 30s 重写）— `/title-hooks`
- 配音 QA（8 维度，dubbing 模式內建）

**Phase 4 cleanup（W0-W3 + Fish Audio purge + 版本號 reset）**：
- W0：6 类 TS production error + 51 文件 biome auto-fix + 9 个手动 lint（commit `5086379`）
- W1：Mandarin prompt 6 step + 5 SYSTEM_INSTRUCTION + UI 文案 + 35 测试（commit `da26ac5`）
- W2：4 工具 nav + dashboard + AUTH-aware login + health 4-mode + MD/PDF clear + podcast CTA + UI 术语去工程化（commit `1437bd7`）
- W3：9:16 ffmpeg + settings 404 silent + mobile chip + 品牌統一 + CHANGELOG.md（commit `e2dc1e7`）
- Plan A 实机验证：W2-W3 改动 + S-01 并发 jobs / S-04 上传边界 / S-05 并发 recut 全过
- Plan B：Fish Audio **主線 UI / provider 已移除**，types `TTSProvider` 收歛為 `'edge_tts'` / `tts-config.tsx` 移除 Fish 全部 state+handler+UI / `status-badge.tsx` 移除 fish_audio_* labels；**legacy report/cost compat 保留**（lib/cost/、lib/db/tables/job-costs.ts、components/report/sections/* 仍能渲染歷史 job 的 fish_audio 統計欄位，顯示 0 次時隱藏）。版本號 reset 16.0.0 → 1.0.0

**保留**（為向後兼容）：
- `lib/cost/`、`lib/db/tables/job-costs.ts`、`lib/loaders/report-loader.ts` — 歷史 cost tracking 不砍，舊 job report 仍能渲染 fish_audio 列（顯示 0 次）
- `lib/db/index.ts` `dropCheckConstraint` × 3 — 為未升級的舊 dev DB 提供 idempotent migration（fresh install 自動 no-op）

**Plan C/D（docs/migrations 終結）**：
- 砍 `docs/agent/legacy-editing-removal-plan.md`（267KB Phase 1 計劃稿）+ `docs/agent/changelog.md`（重複）+ `docs/agent/testing/` 整目錄（17 plan 檔 ~250KB）
- 砍 `docs/migrations-archive/` 11 個歷史 SQL（54KB，無代碼 ref）
- README / docs/agent/index.md / docs/dubbing-guide.md 死連結修復
- 構建緩存 `.next` 1.4GB 清理（gitignored，不入 commit）

**Phase 4 ✅ 完成**：v1.0.0 是「自媒體生產台」起點，從 ChuangCut v16.x 重構接手後第一個 cleaned, audited, version-reset 版本。

## [Unreleased] — Phase 5（開源就緒，進行中）

### 2026-05-01 Push 前 UI P0 收尾

根據 Claude Design 對 7 個頁面的 rendered UI review，先修 push 前會被截圖看到的矛盾 / broken state，不做大規模 redesign。

- Footer 法律文案與 MIT 對齊：`All rights reserved` → `LaputaMediaCenter contributors · MIT License`
- Header auth widget 改為載入態佔位，避免本地模式頁面先閃出「登录 / 注册」
- `/jobs` 任務類型改以 `job_type` 為 normal form：`content_ingest` / `translation_dubbing` / `podcast_production` / `multi_platform_script` / `highlights_extraction` 都有固定使用者文案，避免高亮 / 多平台任務被 legacy fallback 誤顯示為「素材吸收」
- 分頁 range 判斷改用 number/finite checks，避免顯示範圍變數缺值時產生空洞文案
- `/jobs` 頁面文案把「素材吸收」收斂為「素材导入」
- 新增 job-display 測試，鎖定 podcast / multi-platform / highlights 不再被 legacy config hints 誤判

驗證：
- `pnpm typecheck:app`: 0 errors
- `pnpm typecheck:all`: 0 errors
- `pnpm exec biome check`（7 touched files）: 0 issues
- `pnpm vitest run tests/jobs/job-display.test.ts`: 31 pass
- Playwright rendered `/jobs`: 本地模式 1、login/register links 0、MIT License 1、All rights reserved 0、素材吸收 0、分頁 `显示 1 到 10 条，共 14 条`

### 2026-05-01 Codex P1 #2 — Podcast 加 script_only 模式（兌現「免費優先」承諾）

**根因**：Codex 第二輪審查指出 Podcast 工具 UI 寫「TTS 會 fallback」但 API 硬要求 MiniMax voice_id + paid gate，無 key 用戶完全卡住。

**設計決策（用戶拍板）**：
- normal form `tts_mode: 'script_only' | 'minimax'`，**默認 `script_only`**
- 不引入 `edge_tts`（W2 Plan B 砍 Fish UI 後不再加 legacy provider，質量差且混淆主線）
- UI 文案誠實：兩個獨立模式而非 fallback

**改動範圍**:

`types/core/job.ts`:
- 加 `podcast_tts_mode?: 'script_only' | 'minimax'`，含完整註解（為何不加 edge_tts）

`app/api/podcast/route.ts`:
- 加 `podcastTtsModeSchema` enum
- `voice_id` 從 required 變 optional
- z `.refine()`：minimax 模式才校驗 voice_id 必填

`lib/workflow/steps/podcast/podcast-tts.ts`:
- 加 `ttsMode` 到 PodcastTtsOutput
- script_only 模式 early return（不調 MiniMax，audioCount=0，skipped=true）
- minimax 模式錯誤訊息加「或切回 script_only 模式」提示

`lib/workflow/steps/podcast/podcast-delivery.ts`:
- script_only 模式跳過 ffmpeg concat
- manifest 加 `tts_mode` 欄位 + `notice` 提示重跑切 minimax 加配音
- script_only 時 finalAudioPath = null

`components/podcast/podcast-form.tsx`:
- 加 TTS 模式 picker（兩個誠實的卡片：📄 只生成播客稿 / 🎙️ MiniMax 配音）
- script_only 模式隱藏聲線 / 合规確認 區塊
- 提交按鈕文案隨模式變（「生成播客稿」vs「生成播客 + MiniMax 配音」）
- 移除粵語區「TTS 會 fallback」誤導文案

`tests/workflow/podcast-tts-mode.test.ts`（新增）:
- 13 tests 涵蓋 schema 默認值 / minimax voice_id 校驗 / 白名單拒絕 edge_tts / normal form 契約

**驗證**:
- pnpm typecheck:app: 0 errors
- pnpm typecheck:all: 0 errors
- pnpm exec biome check .: 0 errors
- pnpm test:unit: 106 files / 781 tests pass / 17 skipped（+13 from 768 baseline）

**朋友體驗變化**:
- Before: 開 /podcast → 看到 voice 列表空 → 提示去 settings 配 MiniMax key → 卡死
- After: 開 /podcast → 默認 script_only → 直接生成播客腳本 .md → 想加配音再切 minimax 重跑

### 2026-05-01 Codex P1 #6 — full tsc 收斂 119→0（測試 fixture drift 全清）

**根因**：`pnpm tsc --noEmit --incremental false` 之前 119 errors 全在 tests/，原因是 mock 型別推導過窄（`vi.fn()` 無泛型默認推為 `() => undefined` / `() => never[]`）+ Job/StepContext fixture 對不上 prod 型別。

**Step 1**（quick win）— `tsconfig.app.json` + scripts:
- 新增 `tsconfig.app.json`：extends base，excludes `tests/`
- 新增 `pnpm typecheck:app`（production 0 errors，CI gate）
- 新增 `pnpm typecheck:all`（包含 tests，可獨立追蹤測試債）
- CI 該過 typecheck:app；typecheck:all 紅不阻 build

**Step 2**（mock 簽名收斂）— LooseFn pattern 應用到 5 個高密度檔:
- `tests/api/api-keys.test.ts`：11→0（mock declaration 加 `vi.fn<Sig>()` + `ApiKeyService` 類型）
- `tests/api/dubbing-route.test.ts`：28→0（17 個 mock + `DubbingTranslationCredentialLike` union）
- `tests/components/workbench-client.test.tsx`：11→0（`JobOverride` 型別 + `as unknown as Job['stepHistory']` cast）
- `tests/components/dubbing-form.test.tsx`：10→0（onSubmit mock 類型化）
- `tests/api/ingest-dubbing-readiness-smoke-route.test.ts`：8→0（11 個 mock）

**Step 3**（推廣到剩餘 16 個零散檔）— 按類別批量修:
- 5 個 auth-style tests（configs-auth / storage-admin-auth / job-logs-cost-auth）：`{valid: boolean; tokenId?: string}` union
- minimax-tts-audit / dubbing-qa-backfill：mock 簽名 + 解 spread `unknown` 為 object
- voice-cloner / translator-script：`Partial<NodeJS.ProcessEnv>`（@types/node 24+ NODE_ENV 變 required）
- 7 個小檔（ingest-route / api-key-verification / status-badge / dubbing-workbench-prefill 等）：cast pattern (`as unknown as Job` / `as unknown as ClosedLoopReadiness`)
- 3 個 artifact_manifest 引用：`@ts-expect-error` 註解（兩個 StepContext 定義漂移，#6 範圍外要 prod refactor 統一）
- 2 個 ingest-workbench-readiness：`TranslationCredentialStatusForDisplay` 已收歛為 `{configured, runtime?}`，移除舊 fixture 欄位

**新增** `tests/helpers/fixture-builders.ts` — `DeepPartial<T>` + `castPartial<T>()` helpers，給未來測試 fixture 共用 normal form。

**驗證**:
- pnpm typecheck:app: **0 errors**（production blocker 為 0）
- pnpm typecheck:all: **0 errors**（從 119 降到 0，100% reduction）
- pnpm exec biome check .: 0 errors / 1 acceptable warning
- pnpm test:unit: 105 files / 768 tests pass / 17 skipped（runtime 行為不變）

**設計決策**:
- 不動 prod 型別重構（StepContext 兩個定義 / TranslationCredentialStatusForDisplay 收歛 / ClosedLoopReadiness 加欄位）— 這些都是 cross-file refactor，#6 範圍外
- Tests cast 為 `as unknown as T` + 加註解說明「prod refactor 後可移除 cast」
- mock typing 用泛型 `vi.fn<Sig>()` 不引入 fixture builder，因為主要 bug 是 mock 推導不是 fixture builder 缺失

### 2026-05-01 修 e2e reuse mode 環境匹配 + Codex #5 reuseExistingServer DX

**Root cause**：之前 `pnpm test:e2e` 默認模式 12/12 全綠，但 reuse mode（`PLAYWRIGHT_REUSE_SERVER=true PLAYWRIGHT_PORT=8899`）下會 fixture 404。原因：
- Reuse mode 下 playwright 不啟 webserver，但 `playwright.config.ts:17` 仍把 `process.env.DATABASE_URL` 設為 `tmp/playwright-e2e/no-paid-mainline.sqlite`
- Seed 寫進這個 e2e DB
- 但用戶的 `pnpm dev` 啟的 dev server 用默認 `data/db.sqlite`
- 結果：seed 寫的 fixture job 在 e2e DB，dev server 從 data DB 讀，找不到 → 404

**修法**（commit `84007c0`）:

注：原 commit subject `feat(D): recut file lock` 用詞不準（Codex P2 #11），實作是 in-process mutex；本 CHANGELOG 標題已校正。多 process 部署仍需單獨升級。

- 加 `pnpm dev:e2e` script：用 cross-env 把 DATABASE_URL/RUNTIME_DIR/TEMP_DIR/OUTPUT_DIR/AUTH_ENABLED/ALLOW_PAID_DYNAMIC_TESTS 等對應到 playwright 預期 paths，dev server 與 seed 走同一個 DB
- 加 `pnpm test:e2e:reuse` script：直接設 `PLAYWRIGHT_REUSE_SERVER=true PLAYWRIGHT_PORT=8899`，不再要用戶手寫 env
- 加 `cross-env` devDep（10KB pure-JS，跨 Win/Unix shell）
- `playwright.config.ts` reuse mode 啟用時 console.log 大字提示「dev server 必須用 `pnpm dev:e2e` 啟動」

**驗證**:
- Default mode：`pnpm test:e2e` → 12/12 pass / 1.1 min（已驗）
- Reuse mode 新 flow：`pnpm dev:e2e &` + `pnpm test:e2e:reuse` → 12/12 pass / 58s（已驗）
- 對比修前 reuse mode：fixture 404 cascade 失敗

**順帶修 Codex 第二輪 P1 #5**（reuseExistingServer DX 改善）。

附帶 README 更新:
- 加「E2E 測試兩種模式」章節，明確說明 default vs reuse 的 trade-off
- 修 README 殘留 CCUT/chuangcut（line 72/76-78/153）→ 統一 LaputaMediaCenter / C:/tmp/laputa
- LICENSE_KEY 改為註解（默認可空）

### 2026-05-01 Codex 第二輪 P1 三個 fix（commit `512b330`）

修 Codex 後續審查抓到的「W1-W3 半完成」3 個 P1：

- **#3 9:16 ASS canvas**：W3.1 修了 ffmpeg filter 但忘了同步 ASS canvas（VIDEO_BASE_SIZE 寫死 1920x1080）→ 9:16 影片字幕位置 + 字體 scale 全錯。抽 `getVideoSizeForAspect(aspect)` exported helper，buildClipAss 加 aspect 參數，processHighlightCandidate 傳遞，加 3 unit tests。
- **#4 mobile /jobs error overflow**：長 yt-dlp/ffmpeg 命令訊息撐爆 390px viewport（Codex e2e 抓到 → 477px）。job error card 加 `min-w-0` + `[overflow-wrap:anywhere]` + `break-words`。
- **#1 mobile header 無導航**：W2.1 加桌面「工具」下拉但忘了 mobile drawer。新增 sm:hidden DropdownMenu 漢堡 icon，復用同一份 navItems + TOOL_ITEMS（normal form 不分裂）。

驗證：
- pnpm tsc --noEmit production: 0 errors
- pnpm exec biome check .: 0 errors / 0 warnings / 0 infos
- pnpm test:unit: 105 files / 768 tests pass / 17 skipped（+3 ASS canvas tests）
- live curl /jobs + / : 200，mobile drawer DOM `aria-label="打开导航菜单"` 確認在
- ⚠️ **未實際跑 pnpm test:e2e**：報告說「3 個 bug 已修」是真的，但 e2e suite 整體仍非全綠，後面卡在 downstream fixture job 404（`/jobs/e2e-dub-full` / `/jobs/e2e-dub-sample`，`tests/e2e/mainline-fixtures.ts` seed 流程或 mainline DB query 還有獨立 bug，與本三個 fix 無關）。下一輪可獨立修。

### 2026-05-01 Plan D — recut **in-process mutex**（S-05 race fix；非 file lock，重要區別見下）

> **命名澄清（Codex P2 #11）**：原 commit subject 寫「file lock」是錯的。實作只是 in-process per-key async mutex（`lib/utils/key-mutex.ts:13` 自註明「In-process」「不防止跨 process race」）。這個區別重要：
> - ✅ 適用：當前單 Node server 部署模式（朋友本地 / 單 instance Docker）
> - ❌ 不適用：多 worker / serverless / 多 instance 部署（需升級為 `lockfile + atomic rename` 或 DB-level lock）
>
> Plan A S-05「並發 recut 全過」也只在單 process 場景成立。多 process race 未測試。

新增 `lib/utils/key-mutex.ts` 通用 per-key async mutex helper（in-process FIFO 序列化 + 引用計數清理 + 例外不阻塞排隊）+ 6 個單元測試（FIFO 順序 / 不同 key 並行 / 例外釋放 lock / 清理 entry / 返回值 / 多 caller 順序）。

`app/api/highlights/[id]/recut/route.ts`：
- 把 cuts.json/manifest.json 的 read-modify-write 整段（含 ffmpeg）包進 `withKeyLock(\`highlights-recut:${jobId}\`, async () => { ... })`
- 同 job 並發 recut 自動 FIFO 排隊；不同 job 並行
- 解決 S-05 測試發現的 race：之前 3 個 concurrent recut 雖無 cuts.json corrupt（fs.writeFile atomic），但 last-writer-wins 是隨機的；現在保證 FIFO 順序

樣本：765 unit tests pass（從 759 升 +6 mutex tests）；tsc / biome 全綠。

修 Codex 獨立測試報告（CODEX_FINDINGS.md）的 13 個 issue，分 W0-W3 四波交付。

### W0 — TS production errors + biome lint 全綠（commit `5086379`）

- TS：6 类 production error 修复（md_draft/pdf_draft union、duplicate ok key、Fish Audio @deprecated 兼容、ASR re-export 路径、readdirSync 类型、MajorStep union 同步）
- Lint：51 文件 biome 自动修（safe + unsafe）+ 9 个手动修（noImplicitAnyLet、a11y backdrop modal、useExhaustiveDependencies、noAssignInExpressions）
- 验证：tsc 0 errors、biome 0 issues、103 测试文件 / 724 通过

### W1 — Mandarin prompt 分支 + cost/lang form copy（commit `da26ac5`）

- 新增 i18n helpers：`isMandarinTarget` / `MANDARIN_HARD_RULES` / `getMandarinStyleInstruction` / `getMandarinLanguageLabel` / `getMandarinRules` / `resolveLanguageInstruction` 3-way 分支
- 6 个 LLM step prompt + 5 个 SYSTEM_INSTRUCTION 加 Mandarin 分支：之前选「普通话」prompt 只说「保持源语言」，英文素材直接吐英文 → 现在明确要求标准普通话 / 简体中文翻译
- 字幕翻译（translate-segments.ts）：之前粵語才翻字幕，普通话保持原文 → 现在两种都用 LLM 翻译
- /title-hooks page：动态拉 active LLM provider，显示实际 provider name + tier badge（免费/付费），paid 时提示去 /settings 切换
- /highlights form：字幕翻译文案改为人话「粵语/普通话：hook+summary+字幕都翻；自动：保持源语言」
- 测试：+35 个 Mandarin tests（759 通过，从 724 升）

### W2 — 4 工具 nav + 首頁 + AUTH-aware login + health + UX polish（commit `1437bd7`）

- Header：加「工具」下拉（4 个 Phase 3.C 自媒体工具）；AUTH disabled 时显示「本地模式」badge 而非登入/註冊
- Dashboard（首頁）：4 个工具从「下一步」→「可用」+ 各自 href + cta；hero 文案「6 个工具已可跑」
- /api/health：拆分 service liveness（永远 200）vs license status（{valid,mode,warning} 4 种 mode）；service.name 从「创剪视频工作流」→「LaputaMediaCenter」
- MD/PDF mode switch（script-rewrite + podcast）：切换时清空 uploadedPath，避免「上传 MD 后切到 PDF 但 path 是 MD」错误
- Podcast no-voice CTA：之前只 disable button → 现在给 3 个明确入口（MiniMax key 配置 / 跑 dubbing 自动注册 / 手动添加 voice_id）
- UI 术语去工程化（Codex 第 5 点朋友视角）：「hook_text 输出语言」→「亮点文案与字幕语言」、「manifest」→「产物清单」、「voice_id」→「声线（voice_id）」、「N 个 .md + manifest」→「N 个 markdown 脚本 + 产物清单」

### W3 — 9:16 polish + settings 404 + mobile chip + 品牌統一 + Phase 4 整理

- 9:16 ffmpeg：crop 后加 scale=1080:1920 + pad + setsar=1，避免下游平台二次拉伸
- 9:16 preview：HighlightClipCard 接受 aspect prop，9:16 时用 max-w-[320px] aspect-[9/16]，桌面不会过高
- /api/configs/[key]：加 KNOWN_OPTIONAL_KEYS 白名单，已知可选 key 不存在时返 200 + value:null（避免前端 console 404）
- Mobile chip：4 个 form 的 chip 从 py-1.5（30px）改 py-2（32px）+ sm:py-1.5（桌面保留紧凑）
- 品牌統一：site-logo「LE / Laputa Content Engine」→「LMC / LaputaMediaCenter」；footer「Laputa工作流」→「LaputaMediaCenter」；license-error page「Laputa工作流」→「LaputaMediaCenter」；README 标题加「— LaputaMediaCenter」+ 新版主线 6 工具列表 + LICENSE_KEY 改为可选说明
- Phase 4：CODEX_HANDOFF.md 修 3 个错误的受保护资产路径（`lib/creator-profile/*` → `lib/dubbing/creator-profile.ts`、`lib/dubbing/dubbing-qa.ts` → `lib/jobs/dubbing-qa.ts`、`lib/i18n/languages.ts` → `lib/config/languages.ts`）；新增 CHANGELOG.md（本檔）

---

## [16.0.0] — 2026-04 (Phase 3.C — 4 自媒體工具 + 粵語 ship)

- /podcast：长文/字幕 → 双人播客脚本 + MiniMax 配音
- /highlights：长视频 → LLM 找金句 → 30-60s 短片 + 烧录字幕（粵語也支援字幕翻译）
- /script-rewrite：一份稿 → YouTube 长视频 / 抖音 60s / 小红书 / 公众号 4 平台
- /title-hooks：5 候选标题（含 SEO + hook_strength）+ 开头 30s 重写
- 粤语 i18n：`lib/i18n/cantonese-prompt.ts` source of truth，4 个工具都注入粵语硬规则
- Settings UI：LLM provider switcher（Gemini / OpenAI-compatible / Mistral）+ ASR switcher（Gemini / whisper.cpp）

## [15.x] — 2026-03 (Phase 3.B — Settings/Provider 抽象)

- LLM provider registry（gemini/openai/mistral）+ active 切换 UI
- ASR provider registry（gemini-audio/whisper-cpp）+ 本地 whisper.cpp 安装器
- creator-profile + glossary + 多语言风格指南统一存 SQLite

## [14.x 及更早] — Phase 1-3 主线

参见 PROJECT_PLAN.md activity log。Phase 1 = 翻译配音 MVP；Phase 2 = ingest + sample-to-full；Phase 3.A = QA + creator assets；Phase 3.B = settings 抽象；Phase 3.C = 4 自媒体工具。
