# Codex 追加審查 — Claude Phase 4 後（2026-05-01）

## Executive Summary
- Read-only 執行；未改代碼、未改 DB、未 commit。唯一寫入是更新本報告。
- 驗證結果：`pnpm build` ✅、`pnpm lint` ✅、`pnpm test:unit` ✅（104 files / 765 pass / 17 skip）、`/api/health` ✅ 200、`/settings` ✅ 200。
- 但不是「完美」：`pnpm exec tsc --noEmit --incremental false` ❌ 仍大量測試型別錯；`pnpm test:e2e` ❌ 在已有 dev server 時啟動失敗；復用 8899 後 e2e 仍因 mobile `/jobs` overflow 失敗。
- 整體判斷：Claude 修掉前一輪多數 P0/P1 happy path，但還有明顯「不夠人性化」與驗證門問題。最需要先修：手機導航、Podcast 免費/備援路徑、9:16 字幕座標、mobile error overflow、README/Phase 記錄不一致。

## Primitive / normal form view

| UX primitive | 應有正常形 | Claude 後仍偏差 |
| --- | --- | --- |
| Navigation | 任意 viewport 都能進主要工具 | 手機 header 只剩 Logo + 簡繁切換，沒有主導航/工具選單 |
| TTS path | MiniMax 付費主力 + 無 key 可免費跑通 | Podcast 硬要求 MiniMax key + voice_id + paid gate，且 UI 還誤稱會 fallback |
| Output geometry | 9:16 影片與字幕 canvas 同一尺寸 | 影片輸出 1080x1920，但 ASS 仍用 1920x1080 |
| Verification | 一條命令可重現「全綠」 | build/unit/lint 過，但 full tsc/e2e 不過 |
| Docs/source of truth | Phase 狀態、README、實際文件一致 | migration/Fish/ChuangCut/CCUT 殘留與完成勾選互相矛盾 |

## Issues 列表

### [P1] 手機版 header 沒有主導航，朋友在非首頁會迷路
- **Scenario**: S-03 mobile UX
- **重現步驟**: 用 390px viewport 打開 `http://localhost:8899/jobs`，檢查 header 可見元素。
- **預期**: 手機也能進 `素材 / 轉譯 / 任務 / 設置 / 工具`，至少有漢堡選單或底部 nav。
- **實際**: Playwright DOM 只看到 Logo、`簡體` 按鈕；桌面才有 nav。原因是 `components/layout/header.tsx:101` 用 `hidden ... sm:flex` 隱藏 nav，但沒有 mobile replacement。
- **建議修復方向**:
  - 文件位置：`components/layout/header.tsx:101`
  - 改法描述：加 mobile menu / drawer，內容復用同一份 `navItems + TOOL_ITEMS` normal form，不要另寫第二份散落列表。
  - 預估工時：45-90 min
- **風險評估**: 低。屬 presentation 層，但要跑 mobile screenshot/e2e。

### [P1] Podcast 聲稱 fallback，但後端實際硬要求 MiniMax，違反「免費優先」
- **Scenario**: 朋友第一次用 `/podcast`
- **重現步驟**: 未配置 MiniMax key/voice 時看 Podcast 表單與 TTS step。
- **預期**: MiniMax 是付費主力；無 key 時可降級 Edge TTS 或至少只生成腳本、不阻塞整個播客體驗。
- **實際**:
  - UI 說「否則 TTS 會 fallback」，見 `components/podcast/podcast-form.tsx:398-402`。
  - 表單又說「至少 1 個 MiniMax 聲線 voice_id 才能合成」，見 `components/podcast/podcast-form.tsx:415-420`。
  - API schema 硬要求 `voice_id`，見 `app/api/podcast/route.ts:23-37`。
  - TTS step 無 key 直接 throw `PODCAST_MINIMAX_NOT_CONFIGURED`，見 `lib/workflow/steps/podcast/podcast-tts.ts:116-135`。
- **建議修復方向**:
  - 文件位置：`components/podcast/podcast-form.tsx`、`app/api/podcast/route.ts`、`lib/workflow/steps/podcast/podcast-tts.ts`
  - 改法描述：把 podcast TTS provider normal form 改成 `{ mode: 'minimax' | 'edge_tts' | 'script_only' }`。默認 `script_only` 或 `edge_tts`，MiniMax 才要求 paid gate。
  - 預估工時：0.5-1.5 day
- **風險評估**: 中。涉及 TTS policy，需保留 MiniMax 合規 gate。

### [P1] 9:16 輸出影片尺寸修了，但字幕 ASS canvas 還是 16:9
- **Scenario**: S-06 9:16 highlights
- **重現步驟**: 選 `highlights_aspect='9:16'` 跑 highlights；檢查 `extract-highlights.ts`。
- **預期**: 9:16 影片 filter 與 ASS `PlayResX/PlayResY` 都是 1080x1920，字幕位置、字重、邊距正常。
- **實際**:
  - 影片 filter 輸出 `scale=1080:1920,pad=1080:1920`，見 `lib/workflow/steps/highlights/extract-highlights.ts:147-150`。
  - 但 `buildClipAss` 永遠傳 `VIDEO_BASE_SIZE = { width: 1920, height: 1080 }`，見 `lib/workflow/steps/highlights/extract-highlights.ts:56`、`:115-118`。
  - `generateSegmentedASS` 會把這個尺寸寫入 `PlayResX/PlayResY`，見 `lib/subtitle/generator.ts:209-221`。
- **建議修復方向**:
  - 文件位置：`lib/workflow/steps/highlights/extract-highlights.ts`
  - 改法描述：把 `videoSize` 派生為 aspect normal form：`16:9 -> 1920x1080`，`9:16 -> 1080x1920`，並補一個 ASS header test。
  - 預估工時：30-60 min
- **風險評估**: 中。需要 ffprobe + screenshot/像素級字幕位置驗證。

### [P1] mobile `/jobs` 仍會被長錯誤訊息撐爆，e2e 已抓到
- **Scenario**: S-03 mobile e2e
- **重現步驟**: `PLAYWRIGHT_REUSE_SERVER=true PLAYWRIGHT_PORT=8899 pnpm test:e2e`
- **預期**: mobile routes 無水平 overflow。
- **實際**: e2e 失敗：`mobile /jobs simplified viewport overflow elements`。失敗元素是 job error card，長 `yt-dlp` 錯誤訊息把 390px viewport 撐到 right=477。
- **定位**:
  - `components/jobs/job-list-client.tsx:257-283` 的錯誤卡片缺 `min-w-0` / `break-words` / `overflow-wrap:anywhere`。
  - e2e assertion 在 `tests/e2e/mainline-visual-smoke.spec.ts:252-257`。
- **建議修復方向**:
  - 文件位置：`components/jobs/job-list-client.tsx:257-283`
  - 改法描述：錯誤訊息容器加 `min-w-0`，文字加 `break-words` 或 `break-all`，長 command/path 類文本用 `overflow-wrap:anywhere`。
  - 預估工時：20-40 min
- **風險評估**: 低。純 UI。

### [P1] `pnpm test:e2e` 對已開 dev server 不友好，普通驗證命令會失敗
- **Scenario**: verification UX
- **重現步驟**: dev server 已在 8899 跑時執行 `pnpm test:e2e`。
- **預期**: 要麼自動使用獨立 port，要麼清楚復用既有 server，要麼給一條可直接複製的命令。
- **實際**: 直接失敗：`Another next dev server is already running`。`playwright.config.ts:121-143` 默認 `reuseExistingServer=false`，而 Next 16 同一 repo 不能同時起第二個 dev server。
- **建議修復方向**:
  - 文件位置：`playwright.config.ts:4-6`、`:121-143`、`package.json:17`
  - 改法描述：加 `test:e2e:reuse` script，或讓 config 在 localhost target alive 時提示/復用；至少 README 寫清 `PLAYWRIGHT_REUSE_SERVER=true PLAYWRIGHT_PORT=8899 pnpm test:e2e`。
  - 預估工時：30 min
- **風險評估**: 低。

### [P1] full TypeScript 還是紅的，測試型別已和核心 normal form 漂移
- **Scenario**: static validation
- **重現步驟**: `pnpm exec tsc --noEmit --incremental false`
- **預期**: 0 TypeScript errors，或 repo 明確區分 `tsc:app` / `tsc:tests`。
- **實際**: build 能過，但 full tsc 大量 fail，集中在 tests 仍使用舊型別：`ApiKeyService` 收斂後變 `never`、mock tuple `[]` 取 `[0]`、`StepContext`/`Job` mock 缺字段、`ClosedLoopReadiness` 新增字段未同步等。
- **建議修復方向**:
  - 文件位置：`tests/api/*`、`tests/components/*`、`tests/jobs/*`、`tsconfig.json`
  - 改法描述：建立測試 fixture builders 作為 normal form，不要每個 test 手寫半截 `Job` / `StepContext`。若暫不修，至少新增明確 script：`typecheck:app` 與 `typecheck:all`。
  - 預估工時：0.5-1 day
- **風險評估**: 中。不是 production build blocker，但會讓測試成為假綠。

### [P2] README 仍殘留 CCUT / chuangcut，Phase 5 開源會誤導朋友
- **Scenario**: docs / first install
- **重現步驟**: grep README。
- **實際**:
  - `README.md:72` 還是 `LICENSE_KEY=CCUT-XXXXXXXX-XXXX`。
  - `README.md:76-78` 還是 `C:/tmp/chuangcut`。
  - `README.md:153` 項目結構還是 `chuangcut-video-workflow/`。
- **建議修復方向**:
  - 文件位置：`README.md`
  - 改法描述：把 README 當 user-facing canonical doc，一次清成 `laputa-media-center` / `C:/tmp/laputa`，license 改成 optional / legacy note。
  - 預估工時：20-40 min
- **風險評估**: 低。

### [P2] 「Fish Audio 完全砍除」說法不準，使用者報告與 docs 仍有殘留
- **Scenario**: Plan B claim audit
- **實際**:
  - `components/report/sections/SummarySection.tsx:133-158` 仍可能顯示 `Fish Audio 調用`。
  - `components/report/sections/IntegritySection.tsx:97-106` legacy 場景仍顯示 Fish Audio。
  - `types/ai/clients.ts`、`lib/cost/*`、`docs/agent/*` 仍有大量 Fish Audio 名稱。
- **判斷**: 若定位是「歷史 job 兼容」，可以保留；但不能再對用戶說「完全砍除」。這是文案/邊界問題，不是立即 bug。
- **建議修復方向**:
  - 文件位置：`CHANGELOG.md`、`PROJECT_PLAN.md`、report components
  - 改法描述：統一說法為「主線 UI / provider removed；legacy report/cost compatibility retained」。report 上對 legacy 加「歷史記錄」標籤。
  - 預估工時：30-60 min
- **風險評估**: 低。

### [P2] PROJECT_PLAN.md 對 migration 狀態自相矛盾
- **Scenario**: project handoff accuracy
- **實際**:
  - `PROJECT_PLAN.md:592` 勾選「migration 合併為 001_init.sql」。
  - `PROJECT_PLAN.md:594` 又保留同一項未勾選。
  - 實際 `scripts/migrations/` 仍有 29 個 migration 文件；fresh init 走 `lib/db/schema.sql`，見 `scripts/init-db.js:28-32`、`lib/db/index.ts:120-126`。
- **建議修復方向**:
  - 文件位置：`PROJECT_PLAN.md`
  - 改法描述：normal form 二選一：A「schema.sql 是 fresh install source of truth，舊 migrations 保留 legacy/manual」；B「真的合併/刪除 migrations」。不要同時勾已完成又列待辦。
  - 預估工時：15-30 min
- **風險評估**: 低，但影響下一個 agent 判斷。

### [P2] UI 仍有不少工程術語，不符合「朋友不用懂代碼」
- **Scenario**: user-friendly static review
- **例子**:
  - `components/highlights/highlight-clip-card.tsx:114`：`微调 start/end`
  - `components/podcast/podcast-form.tsx:409`：`来自本地 voice-registry`
  - `components/podcast/podcast-form.tsx:419-440`：多次直接顯示 `voice_id`
  - `app/settings/page.tsx:447-449`：狀態卡 label 是 `minimax_tts`
  - `components/settings/llm-provider-switcher.tsx:310-315`：對用戶顯示 `translation_provider` gate
- **建議修復方向**:
  - 文件位置：上述 UI components
  - 改法描述：建立一張「internal key -> user-facing label/help」表；UI 只用人話，例如「片段開始/結束時間」、「本機聲線清單」、「MiniMax 配音服務」。
  - 預估工時：1-2 hr
- **風險評估**: 低。

### [P2] recut commit 說是 file lock，但實作只是 in-process mutex
- **Scenario**: S-05 concurrent recut
- **實際**:
  - `lib/utils/key-mutex.ts:13-20` 自己註明「In-process」且「不防止跨 process race」。
  - `app/api/highlights/[id]/recut/route.ts:118-121` 用它保護同一 job 的 read-modify-write。
- **判斷**: 對單機單 Node process 可接受；但 commit message `file lock` 與 Plan A「並發 recut 全過」容易讓人誤以為跨 process / 真 file lock 也安全。
- **建議修復方向**:
  - 文件位置：`lib/utils/key-mutex.ts`、`PROJECT_PLAN.md`、commit/CHANGELOG 文案
  - 改法描述：改名/文案為 `per-process recut mutex`；若要真 file lock，另做 lockfile + atomic rename。
  - 預估工時：文案 15 min；真 file lock 1-2 hr
- **風險評估**: 中（如果未來打包成多 worker / serverless）。

## 已修 / 沒問題的項目
- `/api/health` 現在 200，service name 是 `LaputaMediaCenter`，無 `LICENSE_KEY` 時是 `local_dev` warning。
- `/settings` 可以打開，`/api/configs/laputa_project_glossary` 不存在時回 `{"value":null}`，不再 404。
- `pnpm build` 過；`pnpm lint` 過；`pnpm test:unit` 過。
- 8 個受保護資產在 `f17e1f7..HEAD` 之間沒有被修改。

## 本輪未做的高風險實測
- 沒有 POST 新 job 或改 settings key，避免改 `data/db.sqlite` / 真實憑證。
- 沒有做 499MB / 501MB upload 邊界測試。
- 沒有跑真 MiniMax Podcast TTS，因本機 MiniMax 未配置。
- 沒有重切實際 9:16 影片做像素級字幕檢查；目前先以代碼路徑判定風險。

## 受保護資產 hash（後續對照用）
- `scripts/translator.py`: `7AE03C51522299AB4D215D22563928B227D3F5223664EEEBE039FF6496160997`
- `lib/dubbing/voice-registry.ts`: `BF921EE6520AC62D6368B0C9310FC03DB4CEAC8E15C0FD2876AE6354119A9F99`
- `lib/dubbing/creator-profile.ts`: `23EBC7B2119714C88F8D947357F215823259D38F69AF68303647C6D3372B7DEC`
- `lib/dubbing/applied-asset-summary.ts`: `6912B0B77BFE75019AD3A78F4B681E358F7681778E4DB9183876D6CDCF25C2ED`
- `lib/jobs/dubbing-qa.ts`: `202E972FE67EA2220BF5762DE5E21C4F4BADE9DE1C9939AD7CD62BD3F7106E6F`
- `lib/ingest/source-classifier.ts`: `5618013F801C9D1577B16DAD047CC8587F93051CEB1A4F50A72DEBD63CFE3D2F`
- `lib/workflow/engine.ts`: `6DE3713B687296EF1AA2095B8AA9D37383D328A55899EEFA4A6AD26A9A521EE9`
- `lib/config/languages.ts`: `ED9E82168134CBE0412A86D760988C1524B462EA1760930EF7A19AB3134FF546`

---

# 舊版報告保留區

> 以下是 Claude Phase 4 修復前的原始 Codex 報告。多數舊 issue 已被後續 commit 處理；請以上方「Claude Phase 4 後」追加審查作為目前優先級。

# Codex 測試報告 — 2026-05-01

## Executive Summary
- Read-only 執行；未改代碼、未改 DB、未 commit。唯一寫入是本報告。
- 跑/查了 8 類檢查：`pnpm test:unit`、`pnpm lint`、`tsc --noEmit --incremental false`、mobile DOM 掃描、既有 output 工件、LLM JSON parser targeted check、受保護資產 hash、user-friendly UX 靜態審查。
- 發現：1 個 P0、8 個 P1、4 個 P2。整體推薦：功能 happy path 已有不少實機成果，但 Phase 4 前不建議宣稱「個人落地穩定」，先修 build/type/lint 與入口/語言/成本 UX。
- Read-only 限制：未 POST 新 job、未做 499/501MB upload、未做 recut race，因為這些會寫 `data/db.sqlite` 或 `C:/tmp/laputa/output`。

## Primitive / normal form view
用戶友善度我按這個 normal form 查：

| UX primitive | 應有正常形 | 目前主要偏差 |
| --- | --- | --- |
| Entry | 首頁/導航能直接找到已完成工具 | 4 個新工具多數不在 nav；首頁仍標「下一步」 |
| Input | 切換素材類型時狀態一致 | MD/PDF 切換會沿用舊 upload path |
| Language | 選普通話/粵語就真的產生對應語言 | 粵語有實作；普通話多處其實等同 auto |
| Cost/provider | 觸發前知道會用哪個 provider、是否付費 | `/title-hooks` 說默認 Gemini 免費，但實際 active 是 OpenAI paid |
| Progress/error | 失敗後知道下一步去哪裡修 | podcast 無聲線時只禁用，缺直達設定/建立聲線入口 |
| Result preview | 輸出預覽符合選項 | 9:16 預覽固定 16:9；字幕語言說明過期 |

## Issues 列表

### [P0] TypeScript 現在無法通過，會阻擋 build/CI
- **Scenario**: 靜態驗證
- **重現步驟**: `pnpm exec tsc --noEmit --incremental false`
- **預期**: 0 TypeScript errors。
- **實際**: 失敗。主要 production code error：
  - `lib/ingest/source-classifier.ts` / `app/api/{ingest,podcast,script-rewrite}/route.ts`: `md_draft` / `pdf_draft` 未進 `IngestSourceType` union。
  - `components/settings/tts-config.tsx`: 仍引用已不存在的 `TTS_CONFIG_KEYS.FISH_AUDIO_*`。
  - `lib/asr/index.ts`: 從 `./types` re-export `WhisperCppRuntimeStatus`，但該 type 實際在 `runtime-status`。
  - `lib/asr/binary-installer.ts`: `typeof readdirSync<{ withFileTypes: true }>` 類型寫法不合法。
  - `lib/workflow/state/step-manager.ts`: `MajorStep` type 仍是舊步驟集合，漏 `rewrite/analyze/score/cut` 等新 step。
- **建議修復方向**:
  - 文件位置：`types/core/job.ts`、`lib/ingest/source-classifier.ts`、`lib/workflow/step-definitions.ts`、`components/settings/tts-config.tsx`、`lib/asr/index.ts`。
  - 改法描述：把 source type / step type 收斂成同一個 source of truth；移除或隔離 Fish Audio UI 殘留；修 ASR type export。
  - 預估工時：1-2 小時。
- **風險評估**: 會碰到 sleeping bug 5.1（TS/SQLite 名單漂移）。不要重新加 SQLite CHECK。

### [P1] 已完成的新工具在首頁/導航仍像未完成，用戶找不到
- **Scenario**: User-friendly UX audit
- **重現步驟**: 開 `/`、看 header nav 與工作模組。
- **預期**: `/podcast`、`/highlights`、`/script-rewrite`、`/title-hooks` 能從首頁或導航直接進入。
- **實際**:
  - Header nav 只有 `/ingest`、`/dubbing`、`/jobs`、`/settings`、`/guide`，見 `components/layout/header.tsx:35`。
  - 首頁仍把「播客整理」「短视频切片」標成「下一步」，且 href 指向 `/ingest`，見 `components/dashboard/engine-dashboard.tsx:69`、`:78`。
- **建議修復方向**:
  - 文件位置：`components/dashboard/engine-dashboard.tsx`、`components/layout/header.tsx`。
  - 改法描述：首頁工作模組改成已完成 4 工具入口；header 可加「工具」下拉或二級入口，避免 nav 太擠。
  - 預估工時：45-90 min。
- **風險評估**: 純 UI，低風險。

### [P1] 「普通話」選項多處其實等同「保持源語言」
- **Scenario**: User-friendly UX audit / S-08 靜態審查
- **重現步驟**: 查 target_language prompt。
- **預期**: 用戶選「普通話」時，英文/粵語/其他來源會輸出普通話。
- **實際**: 多個 prompt 只有粵語分支；非粵語都寫「不進行語言翻譯；保持源語言」：
  - `lib/title-hooks/optimizer.ts:65`
  - `lib/workflow/steps/script-rewrite/generate-platform-scripts.ts:125`
  - `lib/workflow/steps/podcast/generate-podcast-script.ts:95`
  - `lib/workflow/steps/highlights/find-highlights.ts:99`
  - 高亮字幕翻譯也明確「不是粵語直接返回原文」，見 `lib/workflow/steps/highlights/translate-segments.ts:37`。
- **建議修復方向**:
  - 文件位置：上述 5 個 LLM step。
  - 改法描述：建立 `lib/i18n/target-language-prompt.ts` 之類 normal form，明確處理 `auto/mandarin/cantonese`。普通話至少要有「輸出自然繁/簡中文普通話口吻」規則。
  - 預估工時：1-2 小時，加 characterization tests。
- **風險評估**: 會碰 prompt 質量，不要動 `scripts/translator.py` 兩階段核心。

### [P1] `/title-hooks` 成本/provider 文案誤導
- **Scenario**: User-friendly UX audit
- **重現步驟**:
  - GET `/api/providers/llm` 回傳 activeId = `openai`，provider tier = `paid`。
  - 看 `/title-hooks` 頁面底部文案。
- **預期**: 顯示實際 active provider 與成本等級，或至少不承諾「默認 Gemini 免費」。
- **實際**: `app/title-hooks/page.tsx:135` 寫「會調用當前激活的 LLM provider（默認 Gemini，免費額度內）」，但當前 active 是 OpenAI paid。
- **建議修復方向**:
  - 文件位置：`app/title-hooks/page.tsx`，可復用 `/api/providers/llm`。
  - 改法描述：頁面載入 active provider badge；paid provider 顯示 inline paid notice。
  - 預估工時：30-45 min。
- **風險評估**: 低風險，但涉及付費前透明度，建議優先。

### [P1] `/highlights` 語言說明過期，與實際功能相反
- **Scenario**: User-friendly UX audit
- **重現步驟**: 看 `/highlights` form。
- **預期**: 文案說清楚 target language 會影響 hook/summary，也會在粵語模式翻譯燒錄字幕。
- **實際**: `components/highlights/highlights-form.tsx:318` 寫「視頻字幕 (.ass) 仍來自原 transcript」。但 `extract-highlights.ts:280` 已調 `translateSegmentsForSubtitle`，粵語會翻譯字幕。
- **建議修復方向**:
  - 文件位置：`components/highlights/highlights-form.tsx`。
  - 改法描述：改成「粵語會翻譯 hook/summary 與燒錄字幕；auto/普通話目前保持原字幕」或修完普通話後更新文案。
  - 預估工時：10-20 min。
- **風險評估**: 純文案，低風險。

### [P1] Podcast 端到端入口對無聲線用戶不友好
- **Scenario**: User-friendly UX audit
- **重現步驟**:
  - GET `/api/dubbing/voices` 回傳 `{"voices":[],"total":0}`。
  - 開 `/podcast`。
- **預期**: 無聲線時能清楚告訴用戶下一步，最好有「去設定 MiniMax / 新增聲線」按鈕；若產品承諾免費優先，應有 demo/free fallback 路徑。
- **實際**: `components/podcast/podcast-form.tsx:418` 只提示「本地未注册任何声线，请先在 dubbing 流程注册并验证你的克隆声线」，提交按鈕直接 disabled。用戶不知道要去 `/settings`、`/dubbing` 還是哪一步。
- **建議修復方向**:
  - 文件位置：`components/podcast/podcast-form.tsx`。
  - 改法描述：加入 CTA（去 MiniMax 設定、去 voice registry、用 synthetic narration demo voice）；或明確標「播客目前需 MiniMax voice_id」。
  - 預估工時：45-90 min。
- **風險評估**: 會碰 voice registry UX，但不用改受保護核心。

### [P1] MD/PDF 上傳狀態可跨模式沿用，容易送錯 source_type
- **Scenario**: User-friendly UX audit
- **重現步驟**: 在 `/script-rewrite` 或 `/podcast` 上傳 MD，再切到 PDF；`uploadedPath` 未清空，提交時會用同一路徑但 source_type 變 `pdf_draft`。
- **預期**: 切換 text/md/pdf 時清空不相容的 uploaded file，或至少重新要求上傳。
- **實際**:
  - `components/script-rewrite/script-form.tsx:155` 只 `setSourceMode(m)`，沒有清 `uploadedPath`；提交時 `:95-96` 用目前 mode 決定 source_type。
  - `components/podcast/podcast-form.tsx:241` 同樣只切 mode；提交時 `:143-144` 用目前 mode 決定 source_type。
- **建議修復方向**:
  - 文件位置：`components/script-rewrite/script-form.tsx`、`components/podcast/podcast-form.tsx`。
  - 改法描述：mode change 時清空 `uploadedPath/uploadedFilename`；或保存 `{ path, kind }`，submit 時用 upload kind 而不是 current tab。
  - 預估工時：30 min。
- **風險評估**: 純前端狀態，低風險。

### [P1] Dev health check 仍被 LICENSE_KEY 擋住，且回傳舊品牌名
- **Scenario**: Health/API smoke
- **重現步驟**: GET `http://localhost:8899/api/health`
- **預期**: local dev/proxy bypass 下 health 應該回 200，方便用戶/agent 判斷服務是否活著。
- **實際**: 回 500：`{"status":"error","message":"未配置授权码"...}`。`app/api/health/route.ts:14` 直接要求 `LICENSE_KEY`，`proxy.ts:288` 的 dev bypass 沒作用；同文件 `:76` 還寫 service name `创剪视频工作流`。
- **建議修復方向**:
  - 文件位置：`app/api/health/route.ts`。
  - 改法描述：health 分成 service liveness 與 license status；dev/bypass 下 liveness 回 200，license 作 warning。品牌改 LaputaMediaCenter。
  - 預估工時：30-45 min。
- **風險評估**: 涉 license 遺留，注意 Phase 1 決議「不再看到 License 過期 / 登錄牆」。

### [P1] Header 在 AUTH_ENABLED=false 時仍顯示「登錄 / 註冊」
- **Scenario**: User-friendly UX audit / mobile DOM scan
- **重現步驟**: 開任意頁，header 顯示「登錄」「註冊」。
- **預期**: 本地默認免登錄時，不應一直露出 login/register，避免朋友以為必須註冊。
- **實際**: `components/layout/header.tsx:111` 註解就是「登录按钮（始终显示）」；`AUTH_ENABLED=false` 場景也顯示。
- **建議修復方向**:
  - 文件位置：`components/layout/header.tsx`、`/api/auth/status` response。
  - 改法描述：auth disabled 時顯示「本地模式」或不顯示登入入口；auth enabled 才顯示。
  - 預估工時：45 min。
- **風險評估**: Auth UX，低到中；不要移除 auth code。

### [P1] Lint 目前紅，會拖累每小單元驗收
- **Scenario**: 靜態驗證
- **重現步驟**: `pnpm lint`
- **預期**: Biome 0 errors。
- **實際**: 87 errors / 11 warnings。多數是 format/import ordering，但也有真 lint，如 `app/api/highlights/[id]/clips/[filename]/route.ts:77` 的 `noImplicitAnyLet`。
- **建議修復方向**:
  - 文件位置：多處；先跑 `biome check . --max-diagnostics 200` 列全量，再小批修。
  - 改法描述：先修真正 lint，再做 format/import mechanical pass。
  - 預估工時：1 小時。
- **風險評估**: 大多機械；注意不要用 format 大改碰受保護資產。

### [P2] 9:16 輸出與預覽仍有體驗風險
- **Scenario**: S-06 靜態審查（未重切，避免寫 output）
- **重現步驟**: 查 9:16 filter 與 preview。
- **預期**: 9:16 片段輸出為標準短視頻尺寸，預覽容器也用 9:16。
- **實際**:
  - ffmpeg 只做 `crop=ih*9/16:ih`，沒有 `scale` / `setsar`，見 `lib/workflow/steps/highlights/extract-highlights.ts:148`。
  - preview 固定 `aspect-video`，見 `components/highlights/highlight-clip-card.tsx:81`。
- **建議修復方向**:
  - 文件位置：上述兩處。
  - 改法描述：輸出 normalize 到 1080x1920 或 720x1280；manifest 帶 aspect，card 按 aspect 切 class。
  - 預估工時：45-90 min，需真視頻驗證。
- **風險評估**: 會碰 ffmpeg Windows escape；對照 sleeping bug 5.2。

### [P2] Settings 首屏有可避免的 404 console error
- **Scenario**: Mobile DOM scan
- **重現步驟**: 開 `/settings`，Playwright response log 看到 404。
- **預期**: 未建立 creator profile 是正常空狀態，不應在 console 顯示 failed resource。
- **實際**: GET `/api/configs/laputa_creator_profile` 回 404 `配置不存在`。
- **建議修復方向**:
  - 文件位置：`components/settings/creator-assets-config.tsx:137`、`app/api/configs/[key]/route.ts`。
  - 改法描述：前端接受 404 為 normal empty state；或 API 對 known optional keys 回 `{value:null}` 200。
  - 預估工時：20-30 min。
- **風險評估**: 低。

### [P2] Mobile touch targets 偏小
- **Scenario**: S-03 mobile DOM scan（390x844）
- **重現步驟**: 掃 `/title-hooks`、`/highlights`、`/script-rewrite`、`/podcast`、`/settings`。
- **預期**: 主要可點擊控件至少約 32-44px 高。
- **實際**: 無水平 overflow，但多個 chip/button 只有 26-30px；footer link 高約 20px。例：podcast 時長 chip 26px、語言 chip 30px。
- **建議修復方向**:
  - 文件位置：各 form 的 chip controls。
  - 改法描述：mobile 下把 chip `py-1` 提到 `py-2`，footer links 加 vertical padding。
  - 預估工時：30-45 min。
- **風險評估**: 純 CSS。

### [P2] 品牌命名仍不統一
- **Scenario**: User-friendly UX audit
- **重現步驟**: 看 header/footer/health/README。
- **預期**: 產品名對用戶一致：LaputaMediaCenter 或 Laputa 內容引擎，避免舊 ChuangCut/創剪痕跡。
- **實際**:
  - Header logo 是 `LE` / `Laputa Content Engine`，見 `components/layout/site-logo.tsx:11`。
  - Footer 是 `Laputa工作流`，見 `components/layout/footer.tsx:55`。
  - Health service name 是 `创剪视频工作流`，見 `app/api/health/route.ts:76`。
  - README 仍說需要 `LICENSE_KEY`，見 `README.md:27`。
- **建議修復方向**:
  - 文件位置：上述 UI/docs。
  - 改法描述：Phase 4/5 統一命名表，保留 display name 與 package/repo name 區分。
  - 預估工時：45 min。
- **風險評估**: 文案/docs，低。

## 沒問題的 Scenario
- `pnpm test:unit`: 103 files / 724 pass / 17 skip / 0 fail。
- S-03 mobile DOM scan: 5 個頁面無水平 overflow，頁面 JS 無 fatal error。
- S-09 受保護資產 hash 已記錄。
- S-11 JSON parser targeted check: markdown code block、trailing comma、截斷 object array、前綴文字四種都 parse OK。
- 既有 `/script-rewrite` output：`sbinejvn` 與 `hbts412e` manifest 都含 4/4 平台。
- 既有 `/highlights` output：`zvs06ozl` manifest 有 5 條 cuts，hook/summary 為港式粵語，`highlight_cuts/cuts.json` 存在。
- `/podcast`、`/highlights`、`/script-rewrite`、`/title-hooks` 頁面 HTTP 200。

## 額外觀察
- `CODEX_HANDOFF.md` 的受保護資產清單與 `AGENTS.md` 有兩個路徑命名不一致：handoff 寫 `lib/creator-profile/*`、`lib/dubbing/dubbing-qa.ts`、`lib/i18n/languages.ts`；AGENTS 實際是 `lib/dubbing/creator-profile.ts`、`lib/jobs/dubbing-qa.ts`、`lib/config/languages.ts`。本報告按 AGENTS 實際路徑 hash。
- `pnpm test:unit` 會讀本地 `data/db.sqlite`，但本次未新增/刪除 row；跑完 `git status --short` 仍乾淨。

## 對 Phase 4 / 5 的建議
- Phase 4 清理前，先修 P0 TypeScript 與 P1 入口/語言/cost UX，否則文件整理會掩蓋「實際不能 build」與「用戶找不到工具」。
- Phase 4 docs 可把「工作流 normal form」固定成：入口 → 輸入 → provider/cost gate → progress → result → recovery。所有新工具照同一張 checklist 驗收。
- Phase 5 README 應突出粵語 differentiator，但要同步說清楚「普通話」是否已支援，避免 UI 選項過度承諾。
- 不要把 `pnpm lint` 留到開源前最後一刻；現在 diagnostics 已超過 80，越晚越難分辨格式噪音與真 bug。

## 受保護資產 hash（後續對照用）
- `scripts/translator.py`: sha256 `7AE03C51522299AB4D215D22563928B227D3F5223664EEEBE039FF6496160997`
- `lib/dubbing/voice-registry.ts`: sha256 `BF921EE6520AC62D6368B0C9310FC03DB4CEAC8E15C0FD2876AE6354119A9F99`
- `lib/dubbing/creator-profile.ts`: sha256 `23EBC7B2119714C88F8D947357F215823259D38F69AF68303647C6D3372B7DEC`
- `lib/dubbing/applied-asset-summary.ts`: sha256 `6912B0B77BFE75019AD3A78F4B681E358F7681778E4DB9183876D6CDCF25C2ED`
- `lib/jobs/dubbing-qa.ts`: sha256 `202E972FE67EA2220BF5762DE5E21C4F4BADE9DE1C9939AD7CD62BD3F7106E6F`
- `lib/ingest/source-classifier.ts`: sha256 `5618013F801C9D1577B16DAD047CC8587F93051CEB1A4F50A72DEBD63CFE3D2F`
- `lib/workflow/engine.ts`: sha256 `6DE3713B687296EF1AA2095B8AA9D37383D328A55899EEFA4A6AD26A9A521EE9`
- `lib/config/languages.ts`: sha256 `ED9E82168134CBE0412A86D760988C1524B462EA1760930EF7A19AB3134FF546`
