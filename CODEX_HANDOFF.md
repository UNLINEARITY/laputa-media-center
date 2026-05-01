# Codex 接手測試 — 移交報告（Read-Only Mandate）

> 由 Claude（前任 agent）於 2026-05-01 編寫，給 Codex（接手 agent）使用。

---

## ⚠️ 工作模式：READ-ONLY

**用戶開放全部權限給你，但要求**：

1. **不要直接修改任何代碼、配置、數據庫**
2. 你的職責是 **發現問題 → 寫進報告**（路徑見本文末段「報告格式」）
3. 凡是覺得「應該修」的地方都記入報告，由用戶決定要不要動 + 由用戶決定誰來動（自己 / Claude / 你）
4. 唯一允許的「寫入」操作：把報告寫到 `CODEX_FINDINGS.md`（用戶會 review）
5. **不要 git commit**、**不要 git push**、**不要動 .env\***、**不要動 data/db.sqlite**
6. 跑測試 / 探索是 OK 的（curl、瀏覽器、ffmpeg dry-run 等），但不要改文件

---

## 1. 項目簡介（30 秒理解）

**LaputaMediaCenter** — 中文自媒體生產線本地工具，從前身 ChuangCut 重構而來。
單機自用優先（朋友也能用），不對外 SaaS。Stack: Next.js 16 + React 19 + TS + Tailwind v4 + pnpm + SQLite + ffmpeg + whisper.cpp。

**用戶身份**：HK 個人自媒體創作者（YouTube / B 站 / 小紅書），主力素材是美英新聞 / 政客視頻 → 普通話 + 粵語版本。

**v1.0 主要功能**（4 個自媒體爆款工具 + 翻譯配音）：
- `/dubbing` — 翻譯配音（受保護資產，已穩定）
- `/ingest` — 素材吸收（YouTube / 本地視頻 → ASR + brief）
- `/podcast` — 文本稿改寫播客 + TTS
- `/title-hooks` — 5 候選標題 + 開頭 30s 優化（同步 LLM，不創 job）
- `/script-rewrite` — 4 平台腳本適配（YT 長 / 抖音 60s / 小紅書 / 公眾號）
- `/highlights` — 視頻高亮自動切片（LLM 找金句 + ffmpeg 切 + 字幕燒錄）

**所有 4 個自媒體工具都支援粵語輸出**。

---

## 2. 必讀順序（按這個讀，1 小時內 onboard）

```
1. PROJECT_PLAN.md       — 50 KB；整個項目地圖 + Phase 進度 + 決議理由
                           特別讀：行 1-15（當前狀態）、行 400-500（Phase 3.C）、
                           行 750-820（最近活動 log，2026-04-30 至 2026-05-01）
2. AGENTS.md             — TEAM 模式工作方法 + 保護資產規則（8 個受保護資產）
3. CLAUDE.md（如存在）   — Claude 特定習慣，你可參考但不必嚴格遵守
4. git log --oneline -50 — 最近 50 個 commit 知道剛改了什麼
5. lib/i18n/cantonese-prompt.ts                    — 粵語 prompt source of truth
6. lib/workflow/steps/highlights/                  — 高亮切片 4 個 step
7. lib/workflow/steps/script-rewrite/              — 多平台腳本 3 個 step
8. lib/workflow/steps/podcast/                     — 播客 4 個 step
9. lib/title-hooks/                                — 標題鉤子（按需觸發，不創 job）
10. components/settings/llm-provider-switcher.tsx  — Provider 切換 UI
11. lib/providers/llm/openai.ts                    — 強制 streaming（兼容國內中轉站）
12. lib/utils/ffmpeg-utils.ts                      — Windows ffmpeg 雙轉義
13. lib/db/index.ts                                — DB 自動 migration（dropCheckConstraint）
```

**8 個受保護資產**（任何修改前必須跟用戶確認）— 路徑修正後（Codex 在 CODEX_FINDINGS.md 第 211 行指出原 handoff 路徑不對）：
- `scripts/translator.py` — Phase 1 兩階段翻譯邏輯（包含 ChuangCut 滿意的粵語 prompt）
- `lib/dubbing/voice-registry.ts`
- `lib/dubbing/creator-profile.ts`（前 handoff 寫 `lib/creator-profile/*` 為錯，正確在 lib/dubbing/）
- `lib/dubbing/applied-asset-summary.ts`
- `lib/jobs/dubbing-qa.ts`（前 handoff 寫 `lib/dubbing/dubbing-qa.ts` 為錯，正確在 lib/jobs/）
- `lib/ingest/source-classifier.ts`（核心邏輯，可擴展不可改）
- `lib/workflow/engine.ts`
- `lib/config/languages.ts`（前 handoff 寫 `lib/i18n/languages.ts` 為錯，正確在 lib/config/）

---

## 3. 環境信息

```
OS:           Windows 11
Shell:        Git Bash (some PowerShell)
Node:         24.x
pnpm:         latest
ffmpeg:       8.1 at C:/Users/user/Desktop/Claude Code/tools/ffmpeg-8.1-essentials_build/bin/ffmpeg.exe
whisper.cpp:  ~/.laputa/whisper/whisper-cli.exe + ggml-base.bin
SQLite:       data/db.sqlite
Dev server:   pnpm dev at http://localhost:8899
Runtime root: C:/tmp/laputa
  - temp/jobs/{jobId}/        — 運行中工件
  - output/{date}-{jobId}/    — 完成後工件（cleanJobFiles 移過去）
  - output/ingest/{jobId}/    — ingest stage 工件
```

**LLM Provider 配置**（`/settings`）：
- **Active**: `openai`（OpenAI-compatible proxy）
- Base URL: `https://api.deepai.wang/v1`
- Model: `gpt-5.4`
- Key: 已設（從 settings UI 配置，加密存 SQLite）
- 注意：proxy 強制 streaming，已修 `lib/providers/llm/openai.ts` 改用 streaming + 累積

**Gemini 直連**：用戶試過但 `TypeError: fetch failed sending request`（HK ISP 對 generativelanguage.googleapis.com 有 routing issue），不建議切換。

**MiniMax TTS**：未配置（`/podcast` 端到端 TTS 因此未測）。

---

## 4. 已驗證 vs 未驗證 矩陣

### ✅ 已實機驗收（真 LLM 跑通）

| 項目 | 驗證內容 | Job ID（可查 output dir）|
|---|---|---|
| /script-rewrite 中文 | 825 字 AI 評論稿 → 4 平台 .md（YT 1385/抖音 598/小紅書 593/公眾號 1218 字）| `sbinejvn` |
| /title-hooks 中文 | 825 字 AI 評論稿 → 5 標題 + SEO + score | — |
| /title-hooks 粵語 | 同稿 → 4 條粵語標題（「OpenAI 變『摺』咗」「點解外國玩閉源」）| — |
| /script-rewrite 粵語 | 同稿 → 4 平台粵語版（地道港式）| `hbts412e` |
| /highlights 粵語 | OFTC 332MB 英文 trading 課 → 5 段切片 + 粵語 hook + **粵語燒錄字幕** | `zvs06ozl` |
| Settings UI | API key + base_url + 保存並測試 ✓ 4813ms | — |
| ffmpeg cut + 字幕燒錄 | Windows 雙轉義 + 0.1s gap padding 都驗 | — |
| splitIntoSegments 字幕 | ASR 25s 段切成 ~3-5s 短 chunk | — |
| 翻譯 + 燒錄 | OFTC 1 個 LLM call 翻 ~50 segs 約 10s | recut on `zvs06ozl` |

### ⚠️ 未驗收 / 部分驗

| 項目 | 為何未驗 | 你應做的測試 |
|---|---|---|
| /podcast 真 TTS 端到端 | 缺 MiniMax key | 跳過 OR 跟用戶要 key 後跑一次（dubbing voice 你也測同樣 path）|
| /title-hooks 開頭 30s retry | 需要 LLM 真 echo 觸發 | 故意餵 LLM 一段它會「懶得改」的內容（譬如已經很短的 hook）|
| 並發 jobs | task-queue 是 single concurrency | 同時 POST 2 個 highlights，看會不會 409 QUEUE_FULL |
| 並發 recut | recut sync 寫 cuts.json，沒 lock | 同 job 連發 3 個 recut，看 race |
| 上傳邊界 | 限 500MB（單機友善），未測 499MB | 用 `dd` 造 499MB / 501MB 假 mp4 各 POST |
| 9:16 豎屏裁剪 | 代碼有 `crop=ih*9/16:ih`，但實際輸出 mp4 沒 frame 級驗證 | recut 一條 9:16 看 output mp4 metadata |
| 移動端 UI | 沒測過 iPhone/Android | Chrome devtools mobile mode 測 4 個工具 form |
| 翻譯後字幕視覺 | UI 渲染需要清 cache 才看到（瀏覽器 60s mp4 cache）| 用 incognito 看 `zvs06ozl` 第 1 段 |
| 錯誤路徑 | happy path 都驗了，error path 沒系統測 | 故意給壞 key / 壞 URL / 不存在文件 |

---

## 5. 已知 Sleeping Bug 風險區

過去一日修了 8 個 sleeping bug。以下是你**改動相關代碼時要特別小心**的地方：

### 5.1 SQLite CHECK 約束 vs TS 名單漂移
**位置**：`lib/db/schema.sql` + `lib/db/index.ts:dropCheckConstraint` + `types/core/job.ts:JOB_STEPS`
**risk**：加新 JobType / JobStep 時，3 個位置要同步：
- `JOB_STEPS as const`（types）
- `JOB_TYPE_TO_WORKFLOW_ID`（workflow-ids.ts）
- 不要在 schema.sql 加 CHECK（已決議用 TS 層守門）

### 5.2 Windows ffmpeg 雙轉義
**位置**：`lib/utils/ffmpeg-utils.ts:escapeFFmpegPath`
**risk**：路徑含 `:`（譬如 Windows `C:\`），要 `\\:` 雙轉義。改 escape 邏輯時對照 `processHighlightCandidate` 實機跑一次。

### 5.3 OpenAI provider 強制 streaming
**位置**：`lib/providers/llm/openai.ts`
**risk**：當前 `testConnection` + `generateContent` 都用 `stream: true` + 累積 chunks。國內中轉站（譬如 deepai.wang / x666.me）都強制流式。如果改回 non-streaming 會壞。

### 5.4 路徑優先級 temp / output
**位置**：`lib/workflow/steps/highlights/artifact-paths.ts:resolveHighlights*`
**risk**：job 完成後 cleanJobFiles 把 temp 移 output。GET API 必須 fallback。新加 highlights 子工件時要走 resolver。

### 5.5 safeParseScript anyMatch 守門
**位置**：`lib/workflow/steps/script-rewrite/generate-platform-scripts.ts`
**risk**：LLM 偶爾返非標準 key 名（譬如 `youtube` 而非 `youtube_long`）導致全 null 靜默失敗。改 schema 時要保 backward compat。

### 5.6 粵語 prompt 注入
**位置**：`lib/i18n/cantonese-prompt.ts`
**risk**：`getCantoneseRules` 非粵語返 `[]`，調用方直接 spread。不要改成 throw 或返 undefined。

### 5.7 LLM raw 響應 sanitize
**位置**：`lib/ai/gemini/parsers/json-extractor.ts:safeParseJson`
**risk**：5 個 LLM step 都改用此函數處理 markdown ```json``` 包裝 + 拖尾逗號。改它要全鏈路 regression。

### 5.8 字幕 0.1s gap padding
**位置**：`lib/workflow/steps/highlights/extract-highlights.ts:buildClipAss`
**risk**：相鄰 sub chunks 加 100ms gap 防疊加。改 splitIntoSegments 邊界邏輯時要保此 gap。

---

## 6. 推薦的測試 Scenario（按優先級）

### 🔥 P0 — 必測（影響真實使用）

#### S-01：並發 highlights jobs
```bash
# 同時 POST 兩個 highlights，看 task-queue 行為
curl -X POST .../api/highlights -d '{...job1...}' &
curl -X POST .../api/highlights -d '{...job2...}'
```
**預期**：第 2 個返 409 QUEUE_FULL（task queue 是 single concurrency by design）。
**報告應記**：實際行為、是否符合預期、UI 是否友好提示用戶「等待中」。

#### S-02：錯誤 LLM key 行為
**步驟**：故意把 settings 的 openai key 改成 `sk-INVALID`，跑 4 個工具 + dubbing。
**預期**：每個工具走 fallback，UI 紅色 chip 提示，job 完成（不 throw）。
**報告應記**：哪幾個工具 fallback 不漂亮、有沒有 throw 而不是 fallback、UI 錯誤訊息夠不夠清楚。

#### S-03：移動端響應式
**步驟**：Chrome DevTools 切 iPhone 14 / Galaxy S22 模擬，跑 `/highlights` form 完整流程。
**預期**：所有 form 元素點得到、文字不溢出、語言 radio 不擠。
**報告應記**：每個工具的移動端問題（overflow / 點不到 / 字太小）。

#### S-04：上傳邊界
**步驟**：造 499MB 跟 501MB 兩個 mp4，分別走 `/api/upload/video`。
**預期**：499MB 200 OK；501MB 400 「超過 500MB」清楚錯誤。
**報告應記**：實際邊界行為、錯誤訊息友好度、有沒有 silent fail。

### 🟡 P1 — 建議測（暴露低概率 bug）

#### S-05：並發 recut 同一 clip
```bash
# 同時 recut 同一個 clip 3 次
for i in 1 2 3; do
  curl -X POST .../highlights/$JOB_ID/recut -d "{cuts:[{clip_id:'highlight-01',start:225,end:281}]}" &
done
wait
```
**預期**：3 個 race 寫 cuts.json + manifest，最後一個贏（沒 lock）。
**報告應記**：是否有文件損壞、cuts.json 是否合法 JSON、manifest cuts[] 是否仍 5 條。

#### S-06：9:16 豎屏裁剪
**步驟**：跑 `/highlights` 用 16:9 視頻 + 選 `highlights_aspect: '9:16'`。
**預期**：output mp4 是 1080x1920 或 720x1280（豎屏）。
**驗證**：`ffprobe -i mp4 | grep Stream` 看 width:height。
**報告應記**：實際分辨率、字幕位置是否仍 OK（豎屏底部對齊）、人物是否被 crop 掉重要內容。

#### S-07：/title-hooks 開頭 30s retry 觸發
**步驟**：餵一段已經很短（譬如 60 字）的內容，LLM 大概率 echo。
**預期**：optimizer.ts 的 isOpeningRewriteEffective 偵測到 → retry 1 次 → 仍 echo 則 fallback + warning。
**報告應記**：retry 是否真觸發、retry 後是否成功改寫、warning 是否傳到 UI。

#### S-08：粵語 vs 普通話質量對比
**步驟**：同一篇文稿（譬如 `tests/fixtures/oftc-trading.txt`）跑 4 個工具兩遍，target_language 分別 `mandarin` 跟 `cantonese`。
**預期**：兩種輸出明顯不同，粵語有助詞「我哋/嘅/喺」。
**報告應記**：每個工具粵語質量主觀打分（1-5）+ 失準的具體例子。

### 🟢 P2 — Nice to have

#### S-09：受保護資產靜態檢查
**步驟**：grep 8 個受保護資產的 import 點，確認沒被修改 / 替換。
**報告應記**：受保護資產 hash（給用戶後續對照）。

#### S-10：DB CHECK 約束自動遷移
**步驟**：`pnpm db:init` 跑一次，看 `lib/db/index.ts:dropCheckConstraint` 有沒有重複觸發 / panic。
**報告應記**：dev DB 啟動 log 是否乾淨。

#### S-11：JSON 解析容錯
**步驟**：自製一個 mock LLM response（JSON 含 markdown 包裝 + 拖尾逗號 + 截斷）餵 `safeParseJson`。
**報告應記**：哪幾種異常解析失敗、修復建議。

---

## 7. Test Fixtures（已有）

```
C:/Users/user/Desktop/OFTC Lesson 1 - Introduction To Order Flow.mp4
  — 332MB English trading 教學 32 分鐘
  — 用於 /highlights 測試（已驗 zvs06ozl）

C:/tmp/laputa/output/20260501-1244-zvs06ozl/
  — 已生成的 5 段粵語 highlights（含 ass + mp4）
  — 你可直接讀 ass 對照預期粵語

C:/tmp/laputa/output/20260501-0851-sbinejvn/
  — 已生成的 4 平台中文 script-rewrite 結果

C:/tmp/laputa/output/20260501-0919-hbts412e/
  — 已生成的 4 平台粵語 script-rewrite 結果

範例文稿（825 字 AI 評論稿，可用於 /title-hooks 與 /script-rewrite 重複測試）：
  詳見 PROJECT_PLAN.md activity log 2026-04-30 條目（搜「閉源優先」）
```

---

## 8. 你應該寫的報告：`CODEX_FINDINGS.md`

**位置**：`C:/Users/user/Desktop/LaputaMediaCenter/CODEX_FINDINGS.md`
**格式**：見下方模板

```markdown
# Codex 測試報告 — {date}

## Executive Summary
- 跑了 N 個 scenario（列 ID）
- 發現 X 個 P0、Y 個 P1、Z 個 P2 issue
- 整體推薦：可上線 / 暫不可上線 / 部分可上線

## Issues 列表

### [P0] Issue 標題（譬如：並發 jobs 第 2 個沒返 409）
- **Scenario**: S-01
- **重現步驟**: ...
- **預期**: ...
- **實際**: ...
- **建議修復方向**（不要直接動代碼，只描述）:
  - 文件位置：lib/...
  - 改法描述：...
  - 預估工時：30 min
- **風險評估**: 修這個是否會踩 sleeping bug 區（5.1-5.8）

### [P1] ...
（同上格式）

## 沒問題的 Scenario（只列 ID + 結果好評）
S-XX ✓
S-XX ✓

## 額外觀察（不在 scenario 但發現的問題）
- ...
- ...

## 對 Phase 4 / 5 的建議
- 譬如：「Phase 4 docs 砍之前，先把 X.md 內容遷移到 Y.md」
- 譬如：「Phase 5 README 應該突出粵語 differentiator」

## 受保護資產 hash（後續對照用）
- scripts/translator.py: sha256 ...
- lib/dubbing/voice-registry.ts: sha256 ...
（共 8 個）
```

---

## 9. 你**不可**做的事（再強調）

- ❌ 修改任何 .ts / .tsx / .sql / .md 文件（除了寫 `CODEX_FINDINGS.md`）
- ❌ git commit / push / 改 branch
- ❌ 改 .env.local / .env.example / package.json
- ❌ 改 data/db.sqlite（包括 ALTER / INSERT）
- ❌ 動受保護資產
- ❌ 跑 destructive command（rm -rf、`dropTable`、git reset --hard）

可以做：
- ✅ 讀任何文件（grep / cat）
- ✅ 跑 dev server 已起的 API（curl POST GET）
- ✅ 用 ffprobe 看視頻 metadata
- ✅ 用 Chrome DevTools 測 UI
- ✅ pnpm test:unit（read-only）
- ✅ pnpm tsc --noEmit（read-only）
- ✅ 創建 `CODEX_FINDINGS.md` 報告
- ✅ 在 CODEX_FINDINGS.md 中提建議

---

## 10. 完成後

1. 把 `CODEX_FINDINGS.md` 留在項目根目錄
2. **不要 commit**（用戶會自己 review 後決定）
3. 在 chat 給用戶 1-2 段中文摘要：「跑了 N 個 scenario，X 個 P0 issue，最緊要修 ... 詳見 CODEX_FINDINGS.md」

---

## 11. 上下文：今天為何到此

過去一天 Claude 完成的工作（給你了解項目最近脈絡）：

1. ✅ Phase 3.C 4 個自媒體工具全 ship + 粵語接入
2. ✅ 7 個 sleeping bug 修復（DB CHECK / JOB_STEPS / safeParseScript / etc）
3. ✅ Settings UI 加 base_url + 保存並測試
4. ✅ OpenAI provider 改 streaming（兼容國內中轉站）
5. ✅ Windows ffmpeg 雙轉義
6. ✅ Path resolver temp/output 兜底
7. ✅ 字幕 splitIntoSegments 切短 + 0.1s gap
8. ✅ **字幕粵語翻譯**（最後一塊拼圖）

**還未做**：Phase 4（清理 + reset）+ Phase 5（開源就緒）。

**用戶需求**：在 Phase 4 之前，由你做一輪獨立測試，確保「個人落地」狀態真的紮實 + 可能漏的 sleeping bug 提前發現。

---

**祝測試順利。有任何疑問先寫進 `CODEX_FINDINGS.md`，由用戶判斷是否回答後再繼續。**
