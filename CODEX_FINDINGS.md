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
