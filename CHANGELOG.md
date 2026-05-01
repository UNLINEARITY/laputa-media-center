# CHANGELOG

LaputaMediaCenter 的版本變更紀錄。語意化版本（major.minor.patch），日期格式 YYYY-MM-DD。

## [1.0.0] — 2026-05-01（自媒體生產台 v1，commit `<TBD>`）

從 ChuangCut（v16.x）重構為 LaputaMediaCenter v1.0.0。版本號 reset 為「v1 自媒體生產台」起點。

**主要工具線**：
- 影片本地化（普通话 / 粤语）— `/dubbing`
- 播客整理（长文/字幕 → 双人脚本 + MiniMax 配音）— `/podcast`
- 高亮切片（长视频 → 30-60s 短片 + 烧录字幕）— `/highlights`
- 多平台改写（YT/抖音/小红书/公众号）— `/script-rewrite`
- 标题与开头优化（5 候选标题 + 开头 30s 重写）— `/title-hooks`
- 配音 QA（8 维度，dubbing 模式內建）

**Phase 4 cleanup（W0-W3 + Fish Audio purge + 版本號 reset）**：
- W0：6 类 TS production error + 51 文件 biome auto-fix + 9 个手动 lint（commit `831a876`）
- W1：Mandarin prompt 6 step + 5 SYSTEM_INSTRUCTION + UI 文案 + 35 测试（commit `60becb4`）
- W2：4 工具 nav + dashboard + AUTH-aware login + health 4-mode + MD/PDF clear + podcast CTA + UI 术语去工程化（commit `9bb63d0`）
- W3：9:16 ffmpeg + settings 404 silent + mobile chip + 品牌統一 + CHANGELOG.md（commit `570e9f0`）
- Plan A 实机验证：W2-W3 改动 + S-01 并发 jobs / S-04 上传边界 / S-05 并发 recut 全过
- Plan B：Fish Audio UI 完全砍除（types `TTSProvider` 收歛為 `'edge_tts'` / `tts-config.tsx` 移除 Fish 全部 state+handler+UI / `status-badge.tsx` 移除 fish_audio_* labels），版本號 reset 16.0.0 → 1.0.0

**保留**（為向後兼容）：
- `lib/cost/`、`lib/db/tables/job-costs.ts`、`lib/loaders/report-loader.ts` — 歷史 cost tracking 不砍，舊 job report 仍能渲染 fish_audio 列（顯示 0 次）
- `lib/db/index.ts` `dropCheckConstraint` × 3 — 為未升級的舊 dev DB 提供 idempotent migration（fresh install 自動 no-op）

**Plan C/D（docs/migrations 終結）**：
- 砍 `docs/agent/legacy-editing-removal-plan.md`（267KB Phase 1 計劃稿）+ `docs/agent/changelog.md`（重複）+ `docs/agent/testing/` 整目錄（17 plan 檔 ~250KB）
- 砍 `docs/migrations-archive/` 11 個歷史 SQL（54KB，無代碼 ref）
- README / docs/agent/index.md / docs/dubbing-guide.md 死連結修復
- 構建緩存 `.next` 1.4GB 清理（gitignored，不入 commit）

**Phase 4 ✅ 完成**：v1.0.0 是「自媒體生產台」起點，從 ChuangCut v16.x 重構接手後第一個 cleaned, audited, version-reset 版本。

## [Unreleased] — Phase 5（開源就緒，未開始）

### 2026-05-01 Plan D — recut file lock（S-05 race fix）

新增 `lib/utils/key-mutex.ts` 通用 per-key async mutex helper（in-process FIFO 序列化 + 引用計數清理 + 例外不阻塞排隊）+ 6 個單元測試（FIFO 順序 / 不同 key 並行 / 例外釋放 lock / 清理 entry / 返回值 / 多 caller 順序）。

`app/api/highlights/[id]/recut/route.ts`：
- 把 cuts.json/manifest.json 的 read-modify-write 整段（含 ffmpeg）包進 `withKeyLock(\`highlights-recut:${jobId}\`, async () => { ... })`
- 同 job 並發 recut 自動 FIFO 排隊；不同 job 並行
- 解決 S-05 測試發現的 race：之前 3 個 concurrent recut 雖無 cuts.json corrupt（fs.writeFile atomic），但 last-writer-wins 是隨機的；現在保證 FIFO 順序

樣本：765 unit tests pass（從 759 升 +6 mutex tests）；tsc / biome 全綠。

修 Codex 獨立測試報告（CODEX_FINDINGS.md）的 13 個 issue，分 W0-W3 四波交付。

### W0 — TS production errors + biome lint 全綠（commit `831a876`）

- TS：6 类 production error 修复（md_draft/pdf_draft union、duplicate ok key、Fish Audio @deprecated 兼容、ASR re-export 路径、readdirSync 类型、MajorStep union 同步）
- Lint：51 文件 biome 自动修（safe + unsafe）+ 9 个手动修（noImplicitAnyLet、a11y backdrop modal、useExhaustiveDependencies、noAssignInExpressions）
- 验证：tsc 0 errors、biome 0 issues、103 测试文件 / 724 通过

### W1 — Mandarin prompt 分支 + cost/lang form copy（commit `60becb4`）

- 新增 i18n helpers：`isMandarinTarget` / `MANDARIN_HARD_RULES` / `getMandarinStyleInstruction` / `getMandarinLanguageLabel` / `getMandarinRules` / `resolveLanguageInstruction` 3-way 分支
- 6 个 LLM step prompt + 5 个 SYSTEM_INSTRUCTION 加 Mandarin 分支：之前选「普通话」prompt 只说「保持源语言」，英文素材直接吐英文 → 现在明确要求标准普通话 / 简体中文翻译
- 字幕翻译（translate-segments.ts）：之前粵語才翻字幕，普通话保持原文 → 现在两种都用 LLM 翻译
- /title-hooks page：动态拉 active LLM provider，显示实际 provider name + tier badge（免费/付费），paid 时提示去 /settings 切换
- /highlights form：字幕翻译文案改为人话「粵语/普通话：hook+summary+字幕都翻；自动：保持源语言」
- 测试：+35 个 Mandarin tests（759 通过，从 724 升）

### W2 — 4 工具 nav + 首頁 + AUTH-aware login + health + UX polish（commit `9bb63d0`）

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
