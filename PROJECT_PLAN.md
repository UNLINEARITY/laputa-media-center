# LaputaMediaCenter 開發計劃

**最後更新**：2026-05-01（每次對話結束 AI 助手會更新這裡）
**當前 Phase**：🟡 **Phase 5 進行中**（Wave 5.1 secrets 掃描完成：強義 secrets = 0 leak；B+ 已完成 working tree / future commit author 脫敏；push 前仍需 history rewrite 清舊工作流帳號殘留。下一步：LICENSE / README / install scripts / 首次嚮導 / push）
**下次從哪裡繼續**：✅ Codex 兩輪所有 issue 全修完（commit `f2200d0` `f6f0216` `d6f4333` `82333c2` `331ca8f`）。**主線：進 Phase 5 開源就緒**（secrets 全項目掃描 / history rewrite 清舊工作流帳號殘留 / README EN/ZH / install scripts / demo GIF / GitHub push）。

**Phase 5 push 前阻塞項**:
- Git history rewrite：清除 history 中所有舊工作流帳號 slug / 對應 Gmail / 相關衍生字串（不要在 repo 再寫成連續明文；記法：`laputa` + `gong-zuo-liu`）；**保留** `hkdadinsz@gmail.com`、`hkdadinsz`、`laputa`。

**Phase 5 跟進清單**（不阻塞 release，但建議在 GitHub push 前處理）:
- `tests/workflow/podcast-tts-mode.test.ts` 13 tests 是 schema 重寫 + 文檔斷言，需改成 import `@/app/api/podcast/route` 內部 schema export，並 execute `PodcastTtsStep` 真 early return path（Codex P3，user 確認非阻塞）
- `scripts/migrations/` 29 個 .js legacy archive 評估是否一併砍掉或移到 `_archive/`（Codex P2 #9 後續）
- prod 型別漂移收歛（Phase 4 W6 期間 cast 吸收的 3 處：`StepContext` 兩個定義、`TranslationCredentialStatusForDisplay`、`ClosedLoopReadiness`）— 真 cross-file refactor，建議列開源後 v1.1 再做

**📅 2026-05-14 自我提醒（remote schedule 暫不可用，手寫於此）**：
- 跑 `git log --oneline -20` 看最近 2 週 Phase 3.C 實機驗收狀態
- 跑 `pnpm test:unit` 確認 685 pass / 0 fail 仍 hold
- 4 工具實機驗收清單：
  1. POST /api/podcast 真實 transcript → 看 podcast brief LLM 質量
  2. POST /api/script-rewrite 真實觀點稿 → 4 平台 .md 質量
  3. POST /api/title-hooks 真實文稿 → 5 候選標題 + 開頭優化
  4. POST /api/highlights 真實視頻 → 5 段切片 + 微調 recut
- 如全 OK：開 Phase 4 TEAM 模式（V/W/X agent 重做 closed-loop / provider-smoke-audit deferred 重寫）
- 如有 prompt 質量問題：改 prompt 不動架構，重跑驗收
- 用 `/schedule` 試試 remote 是否恢復，能用就轉 background agent 自動跑

**Phase 0 commit**：`ac7dc06` chore: Phase 0 — 從 ChuangCut 重構為 LaputaMediaCenter（636 文件，144685 行）
**Phase 1.A 完成**：Auth 默認關 / Rate limit 寬鬆 / 砍 stress test / 砍混淆構建 / 砍 Docker 腳本
/ 砍 Zeabur 文檔 / 砍 GCS 全鏈路 / package.json 移除 `@google-cloud/storage` + `javascript-obfuscator`
**Phase 1.B 完成**：砍 Fish Audio 全鏈路（provider/UI/verify/types/legacy-constants）+ 修測試 hardcode
+ 砍考古測試（docs guard / Fish Audio runtime / GCS verification）

**Phase 0 + 1 驗收結果**：
- `pnpm install` / `pnpm db:init` / `pnpm dev` 全部跑通
- `http://localhost:8899` + `/settings` 返回 HTTP 200，無紅色 error
- `pnpm test:unit` ✅ 101 文件 / 685 pass / 17 skip / **0 fail**
- 受保護資產 8 個全保留

---

## 1. 項目背景

### 動機

用戶做中文自媒體（YouTube / B站 / 小紅書）。每做一條視頻要在多個網頁版工具之間
切換：YouTube 下載 → Whisper 網頁版轉錄 → 翻譯網頁 → MiniMax 後台配音 → 剪映合成
→ 各種人工 QA。整個流程**碎片化、不可重複、靠記憶**。

學會 n8n 後意識到：把這些工具的 API 串起來，就能**一條工作流跑完整個生產線**。

### 主要素材類型

用戶實際處理的素材以美英新聞 + 名人政客視頻為主：
- 翻譯名人政客視頻為普通話 / 粵語配音版
- 自媒體觀點稿改寫為播客 / 旁白
- 評論性短視頻製作

### 終極願景

```
入口層（多源）：
  ├─ MD / TXT 文本稿
  ├─ PDF 文檔（保留結構）
  ├─ MP4 / MOV 視頻
  ├─ MP3 / WAV 音頻
  ├─ YouTube URL
  └─ 網頁視頻 URL
        ↓
理解層（LLM 深度閱讀）：
  ├─ ASR（音視頻）/ 解析（文檔）
  └─ context_brief：summary + speaker_notes + glossary + ASR 修正建議
        ↓
產出層（多目標）：
  ├─ 翻譯配音視頻（用戶主力）
  ├─ 播客腳本 + 音頻（v1.0 新增）
  ├─ 旁白音頻（同播客機制）
  ├─ 短視頻腳本（v1.x）
  └─ 高亮片段（v1.x）
        ↓
聲線層（MiniMax 統一）：
  ├─ creator_owned / authorized_clone / public_figure
  └─ 合規披露機制
        ↓
交付層：
  └─ MP4 / MP3 / SRT / MD / JSON / QA 報告 / 交付包
```

### 核心賣點

1. **多 API 供應商隨時切換** —— ASR / LLM / lipsync 不綁死
2. **LLM 深度理解（不是字面翻譯）** —— 兩階段 build_context_brief + translate
3. **免費優先** —— 朋友 $0 預算也能跑完整生產線（Edge TTS 兜底）
4. **本地運行、數據不上雲** —— 私密性
5. **買斷一次永久使用** —— 不訂閱
6. **中文自媒體合規** —— 公眾人物聲線披露、聲線授權追蹤
7. **完整工作流 + QA** —— 8 維度 QA 系統，是有質量保證的生產線

### 是否商業化

**不是首要目標**。順序是：自己用 → 朋友用 → 開源 → 看能不能變現。

---

## 2. 用戶與合作模式

- 用戶不寫代碼、不看代碼
- 繁體中文交流，可混英文
- 一切驗證透過瀏覽器 / UI / 終端可見輸出
- AI 助手必須「自驅動 + 主動匯報」
- 用戶硬件：i5-14600KF / 64GB RAM / RTX 5060 Ti 16GB / Win11

詳見 `AGENTS.md`。

---

## 3. Provider 策略：分層架構

### 3.1 ASR（語音轉文字）—— 標準 Provider 抽象

| 層級 | Provider | 備註 |
|---|---|---|
| 🟢 免費 | **whisper.cpp（默認）** | 本地，無 API key，CPU 也能跑 |
| 🟢 免費 | Gemini Flash Audio | Google 免費額度 1500 請求/天 |
| 🟡 付費 | OpenAI Whisper API | $0.006/分鐘 |
| 🔴 高級 | AssemblyAI / Deepgram | 質量最好 |

### 3.2 翻譯 —— ⚠️ 不抽象成「翻譯 Provider」，抽象成「LLM 後端」

**保留前身項目 `scripts/translator.py` 兩階段邏輯不動**。只把底層 LLM 調用做成可切：

| LLM 後端 | 用途 | 備註 |
|---|---|---|
| **Gemini Flash（默認）** | 兩階段深度翻譯 | 免費額度大，質量很好 |
| OpenAI GPT | 替代 LLM 後端 | 用戶提供 key |
| Mistral / Together AI | 替代 LLM 後端 | 開源模型備選 |
| ❌ Anthropic Claude | **不採用** | 朋友負擔不起 |

**保留的業務邏輯**：
- creator_context 注入
- user_glossary（強制覆蓋）
- 風格映射（faithful / conversational / localized_script / short_video）
- 粵語特殊 prompt
- ASR 錯誤推斷
- 數字 / 名字 / 專有名詞保護

### 3.3 TTS（文本轉語音）—— MiniMax 主力 + Edge TTS 免費備援

用戶選定 MiniMax 為主力（中文聲線業界最佳性價比 + 用戶認可的克隆技術）。

| 層級 | Provider | 備註 |
|---|---|---|
| 🟢 免費備援 | **Edge TTS** | 朋友無 key 也能跑通流程體驗 |
| 🔴 主力 | **MiniMax（默認,用戶選定）** | 中文聲線最好 + 克隆 |
| 🔴 可選擴展 | ElevenLabs / OpenAI TTS / Azure | v1.x 視需要再加 |

**TTS 切換邏輯**：
- 用戶填了 MiniMax key → 用 MiniMax
- 沒填 MiniMax key → 自動降級 Edge TTS（UI 標示「演示模式 / 質量受限」）
- 用戶不被強制付費才能體驗

### 3.4 口型同步 —— Wav2Lip 為主，LatentSync 留作未來升級

| 階段 | Provider | 狀態 |
|---|---|---|
| **v1.0** | **Wav2Lip（本地）默認啟用** | 主力選擇 |
| **v1.0** | LatentSync 預留接口但不打包 | 後備選項，用戶手動安裝才啟用 |
| **v1.1 加** | D-ID API（最便宜雲端，~$0.10-0.15/分鐘） | 給沒 GPU 的朋友 |
| **v1.1 加** | Sync.so（高質量雲端，~$0.50-1.00/分鐘） | 給沒 GPU 但要高質量的朋友 |
| v1.2+ 可選 | MuseTalk / HeyGen / Hedra | 補充選項 |

**用戶切換邏輯**：
- 默認用 Wav2Lip（用戶本人 RTX 5060 Ti 跑得很快）
- 朋友沒 NVIDIA GPU 或無 CUDA 環境 → UI 提示跳過口型同步（多數素材其實不需要）
- v1.1 上線後沒 GPU 的朋友可選雲端 API
- LatentSync 留 stub 接口，未來想升級質量時再裝

**設計原則**：
- 用戶目標素材（評論 / 播客 / 旁白）多數不需要口型同步
- 只有翻譯配音的人物特寫視頻才需要
- 默認可跳過，避免不必要的環境依賴

### 3.5 設計原則（總）

1. UI 上展示每個 Provider 的「成本標籤」（免費 / $X 每分鐘 / $X 每月）
2. 每個 Provider 都有「測試連接」按鈕
3. **永遠不在用戶不知情下發起付費調用**
4. UI 上展示每次任務的預估成本
5. 切換 Provider 不需改代碼，只需改設置

---

## 4. 整體計劃（7 個 Phase）

### Phase 0：項目初始化 🟡 待開始

**目標**：建立乾淨的新項目骨架,能跑起來。

**步驟**：
1. 從前身項目選擇性複製代碼到當前根目錄(**注意保護資產清單**)
2. 改 `package.json`：name → `laputa-media-center`、version → `0.1.0`
3. 改全項目 `ChuangCut` / `chuangcut` 顯示文案 → `LaputaMediaCenter` / `laputa-media-center`
4. `.env.example` 重寫為乾淨版本（無個人路徑）
5. 確認 `.gitignore` 完整
6. `pnpm install`、`pnpm db:init`、`pnpm dev` 跑通
7. `git init` 全新倉庫、第一次 commit

**驗證標準**：
- ✅ `http://localhost:8899` 能加載首頁
- ✅ 沒有紅色 error
- ✅ `git log` 看到第一次 commit

**預估對話次數**：1 次

---

### Phase 1：砍 SaaS 偽裝 ✅ 完成（2026-04-30，commits `d0ac9f3` + `3e7c7b5` + 收尾）

**目標**：清理 SaaS 殘留，**但保護受保護資產**。

**砍掉**：
- License V1/V2 兼容代碼（保留 V3 機制）
- `obfuscate-build.mjs` + `build:production` script
- GCS（`lib/storage/gcs-client.ts` + `@google-cloud/storage`）
- Fish Audio TTS
- Stress test 套件（5 個 stress 文件）
- Docker 多平台 buildx
- Zeabur 整套部署文檔

**簡化但保留核心**：
- `provider-smoke-audit.ts` 1351 → ~400 行（**保留付費前確認 gate + 公眾人物聲線確認 gate**）
- `closed-loop-readiness.ts` 760 → ~250 行（**保留 MiniMax credential + Voice registry 校驗**）
- Auth 系統默認 `AUTH_ENABLED=false`，登錄/註冊頁保留代碼但默認隱藏入口
- Rate limiting 改寬鬆

**Wav2Lip 處理（更新後決議）**：
- 代碼**保留並啟用**為默認口型同步引擎
- `.env.example` 保留 `DUBBING_RVC_PYTHON_EXE` 配置（用戶提供路徑）
- UI 默認**顯示**口型同步選項，並提供「跳過」按鈕
- 沒配 NVIDIA GPU 的朋友 → UI 友好提示「跳過此步」，不阻塞流程
- LatentSync 預留 stub 接口位於 `lib/dubbing/lipsync-engines/`，本期不實作

**🔒 完全保留（受保護資產）**：
- 兩階段翻譯（`scripts/translator.py`）
- Voice registry 5 類別（`lib/dubbing/voice-registry.ts`）
- Creator profile（`lib/dubbing/creator-profile.ts`）
- 公眾人物披露（`lib/dubbing/applied-asset-summary.ts`）
- 8 維度 QA（`lib/jobs/dubbing-qa.ts`）
- Source classifier（`lib/ingest/source-classifier.ts`）
- 工作流引擎（`lib/workflow/engine.ts`）
- 20 種語言配置（`lib/config/languages.ts`）

**驗證標準**：
- ✅ 應用首頁仍能加載
- ✅ 設置頁打開正常，無 Fish Audio / GCS 配置區
- ✅ 兩階段翻譯邏輯完整保留（運行一次 dummy 測試確認）
- ✅ Voice registry 完整保留
- ✅ 不再看到 License 過期 / 登錄牆
- ✅ `pnpm test` 通過

**預估對話次數**：2-3 次

---

### Phase 2：替換 Python 依賴 ✅ 完成（2026-04-30）

**目標**：擺脫 GPT-SoVITS 5GB 依賴，用 whisper.cpp 二進制取代。

**步驟**：
1. 集成 whisper.cpp（自動下載對應平台二進制 + 模型）
2. 改 `transcribe-media.ts` 後端為 whisper.cpp
3. 改 `.env.example`：移除 `DUBBING_PYTHON_EXE`，改為 `WHISPER_CPP_PATH`
4. **保留 Python translator.py**（兩階段翻譯，用 system Python 即可，不需 GPT-SoVITS 環境）
5. 更新安裝引導文檔

**驗證標準**：
- ✅ 一個 1 分鐘 YouTube 視頻能轉錄出文字
- ✅ Whisper 不需要 Python
- ✅ 翻譯仍透過 Python translator.py 跑通（系統 Python ≥3.9 即可）
- ✅ Windows / Mac 都能跑

**預估對話次數**：2 次

---

### Phase 3.A：ASR + LLM Provider 抽象 ✅ 完成（2026-04-30）

**目標**：把「多供應商統一控制台」核心賣點代碼化（ASR + LLM 後端）。

**步驟**：
1. 設計 `lib/providers/asr/` 和 `lib/providers/llm/`
   ```
   lib/providers/
   ├── asr/
   │   ├── types.ts          # IASRProvider
   │   ├── whisper-cpp.ts    # 🟢 默認
   │   ├── gemini-audio.ts   # 🟢 免費額度
   │   └── openai-whisper.ts # 🟡 付費
   ├── llm/
   │   ├── types.ts          # ILLMProvider（被翻譯/腳本改寫等使用）
   │   ├── gemini.ts         # 🟢 默認
   │   ├── openai.ts         # 🟡
   │   └── mistral.ts        # 🟢 開源備選
   └── registry.ts
   ```

2. **不動 `scripts/translator.py` 兩階段邏輯**，只把它的 LLM 調用層改成讀 registry
3. UI：設置頁加 ASR 和 LLM 切換器，明確標示 🟢🟡🔴
4. 每個 Provider 加「測試連接」按鈕

**驗證標準**：
- ✅ 設置頁能切換 ASR / LLM 後端
- ✅ 切換後翻譯邏輯（兩階段 + creator_context + glossary）依然正確運作
- ✅ 零 API key 場景下，🟢 默認 Provider 能跑通整條流程

**預估對話次數**：2-3 次

---

### Phase 3.B：MD/PDF 入口 + 播客模式（A1 決議）✅ 完成（2026-04-30）

**目標**：擴展素材入口，實現播客 / 旁白生產線。

**步驟**：

1. **MD 文件入口**：
   - `source-classifier.ts` 加 `.md` 檢測
   - 解析 frontmatter / 標題 / 引用塊 / 列表結構（保留結構化）
   - 套件選擇：`gray-matter` + `remark` 或 `marked`

2. **PDF 文件入口（B2 決議：保留結構）**：
   - `source-classifier.ts` 加 `.pdf` 檢測
   - 套件選擇：**`unpdf`**（純 JS，無 native dep）或 `pdfjs-dist`
   - 提取文本 + 章節結構 + 段落分頁
   - **不做 OCR**（v1.x 再說）

3. **`text_draft` 拆分**：
   - 現有 `text_draft` 保留（純文本貼入）
   - 新增 `md_draft`、`pdf_draft` 兩個 source_type
   - 各自在 `inspect-source` 步驟做對應解析

4. **播客模式核心**：
   - 實現 `ingest_goal: 'podcast'` 的 LLM 改寫步驟
   - 套用兩階段套路：先 build_podcast_brief（理解原素材），再 generate_podcast_script（改寫成播客口語腳本）
   - 輸出包含：開場白 / 分段 / 轉場 / 結尾
   - 接 MiniMax TTS 產出純音頻 MP3
   - **跳過視頻合成步驟**

5. **新工作流定義**：
   - `lib/workflow/workflows/podcast-production.ts`
   - 階段：素材吸收 → 理解 + 改寫 → 配音 → 音頻交付包

6. **UI 新頁面**：
   - `app/podcast/page.tsx` 入口
   - `components/podcast/podcast-form.tsx`
   - `components/podcast/podcast-workbench.tsx`

**驗證標準**：
- ✅ 上傳 MD 文件能被識別並解析結構
- ✅ 上傳 PDF 文件能提取文本 + 保留章節結構
- ✅ 一篇 800 字觀點稿能跑通 → MiniMax 配音 → 輸出 MP3
- ✅ 播客腳本有開場 / 分段 / 結尾結構
- ✅ 旁白用途同一機制可用（純文本 → 配音）

**預估對話次數**：3-4 次

---

### Phase 4：清理 + 重置 ⚪ 未開始

**目標**：項目進入「v1.0 正式版」氣質。

**步驟**：
1. 三份 Agent docs（CLAUDE.md / AGENTS.md / WARP.md）統一為一份 **AGENTS.md**
2. `docs/` 從 17,700 行砍到 ~3,000 行（保留架構、workflow、troubleshooting）
3. 刪除 `tsconfig.tsbuildinfo`、`.DS_Store`、`logs/`、所有 dev server log
4. 數據庫 29 個 migration 合併為一個 `001_init.sql`
5. 版本號：`package.json` 改回 `1.0.0`
6. 環境變數可選改 `LMC_` prefix
7. 寫 CHANGELOG.md 從 v1.0.0 開始

**預估對話次數**：1-2 次

---

### Phase 5：開源就緒 🟡 進行中

**目標**：可以推送 GitHub 公開。

**步驟**：
1. 全文搜索殘留 secrets / 個人路徑（多輪 grep）
2. Git history rewrite 清舊工作流帳號殘留（保留 `hkdadinsz*` / `laputa`）
3. 寫 README.md（中文 + 英文）
4. 加 LICENSE（用戶確認 MIT 或 AGPL）
5. CONTRIBUTING.md（明確「貢獻者可用任何 AI 工具」）
6. 錄 1-2 分鐘 demo GIF / 視頻
7. UI 截圖 3-5 張
8. 安裝引導：`scripts/install.ps1` + `install.sh`
9. 第一次運行嚮導 UI
10. 刪 `_archive/`
11. 用戶確認 → push GitHub

**驗證標準**：
- ✅ 從零環境（新 Windows）按 README 5 分鐘內跑通
- ✅ 不填任何 API key 也能用 🟢 第一層 Provider 跑出第一個視頻 / 播客
- ✅ 整個倉庫 grep 不到任何 API key / license / 用戶名

**預估對話次數**：2 次

---

### Phase 6（v1.1，後續）：口型同步雲端 + 短視頻 / 高亮模式

- D-ID + Sync.so API 接入
- `ingest_goal: 'short_video'` 實現
- `ingest_goal: 'highlights'` 實現
- LatentSync stub 實作（用戶想升級質量時）
- 暫不寫具體計劃，留 v1.0 上線後評估

---

### Phase 3.C：自媒體爆款工具（v1.x，2026-04-30 加入計劃）✅ 完成（A+B+C+D 全做完）

**目標**：在現有 ingest + LLM provider 基礎上加 4 個自媒體創作高 ROI 工具。**核心策略**：復用 Phase 3.A registry 的 LLM 抽象 + Phase 3.B 的 rewrite step 模式（podcast 已建好參考），新組件最小化。

**A. 高亮自動切片** ✅ 完成（commit `079d172`）
- 工作流：transcribe → score（LLM 標金句 / 笑點 / 反轉 / 情緒高潮 / 論點）→ cut（ffmpeg 切 30-60s + 燒字幕）→ delivery
- LLM score：`find-highlights.ts`（走 registry + 5 種 type enum + 1-10 score + hook_text + fallback 兜底）
- ffmpeg cut：`extract-highlights.ts`（單步 -ss/-to + ass filter 切片燒字幕，可選 9:16 豎屏裁剪）
- 字幕：復用 Phase 3.C-D `generateSegmentedASS` + 5 套 preset；相對時間戳，clip 起點對齊 0
- 新工作流：`highlights-extraction` (4 stages: ingest → score → cut → delivery)
- API：POST /api/highlights（建任務）/ GET /api/highlights/[id]（拉狀態+manifest）/ POST /api/highlights/[id]/recut（手動 ±10s 微調批量重切）/ GET /api/highlights/[id]/clips/[filename]（mp4 stream + path traversal 防護）
- UI：`app/highlights/page.tsx`（form）+ `app/highlights/[id]/page.tsx`（3s 輪詢結果頁）+ `components/highlights/{highlights-workbench,highlights-form,highlight-clip-card,highlight-trim-controls}.tsx`（video preview + 雙 Slider ±10s 微調 + recut + 下載）
- 限制：只接受 video 類素材（API 層 z.enum 強校驗：youtube/local_video/local_audio/web_video）
- transcribe-media keepVideo 條件擴展：`ingest_goal === 'localize' || === 'highlights'`

**B. 短視頻腳本適配** ✅ 完成（commit `5a67d30`）
- 同一觀點稿 → **單次 LLM call** 輸出 4 個版本（YT 長 / 抖音 60s / 小紅書 / 公眾號）+ 平台 subset 支援（4 選 N）
- 兩階段 LLM rewrite：Stage 1 brief（核心觀點 + 鉤子候選 + 4 平台 hint + glossary）+ Stage 2 generate（單次 call 出選定平台）
- 4 stages workflow：ingest → analyze (build-multi-platform-brief) → rewrite (generate-platform-scripts) → delivery
- 新建 step：`lib/workflow/steps/script-rewrite/{artifact-paths,build-multi-platform-brief,generate-platform-scripts,script-delivery}.ts`
- 新建 workflow：`lib/workflow/workflows/multi-platform-script.ts`
- API：`app/api/script-rewrite/route.ts`（z.schema：source_type 6 種 / script_platforms enum / 可選 target 時長）
- UI：`app/script-rewrite/page.tsx` + `components/script-rewrite/{script-workbench,script-form}.tsx`（3 種素材 + 4 平台 toggle）
- 走 LLM Provider Registry（自動 fallback 到 mock 兜底，避免空白頁）
- 交付：4 個 .md（youtube_script / douyin_script / xhs_post / wechat_article）+ script_manifest.json

**C. 標題/封面建議 + 開頭鉤子優化器** ✅ 完成（commit `8896468`）
- 5 候選標題（含 SEO 關鍵詞 + 鉤子強度 1-5）+ 開頭前 30 秒對比優化
- `lib/title-hooks/{types,optimizer}.ts`（走 registry，含兜底）
- `app/api/title-hooks/route.ts`（POST，z.schema + rate limit + 同步返回）
- `components/title-hooks/{title-hook-modal,use-title-hooks}.tsx`（modal + 一鍵複製）
- 獨立演示頁 `app/title-hooks/page.tsx`（粘貼任意文稿即可使用）
- 按需觸發（不自動跑），不創 job

**D. 字幕樣式預設庫** ✅ 完成（commit `8896468`）
- 4+1 套預設（default / cantonese_trendy / serious_political / variety_explainer / xhs_fresh）
- 全部基於既有 Noto Sans SC family，靠 size/color/outline/shadow/weight 差異化
- **零新字體 + 零 license 風險**（不引入新字體）
- 擴展 `lib/subtitle/{types,adaptive-size,generator}.ts`（保默認行為不變）
- 新建 `lib/subtitle/presets.ts` + `app/api/subtitle-presets/route.ts` + `components/subtitle/subtitle-preset-selector.tsx`
- dubbing-form 集成 deferred（2000+ 行，待專項對話）

**驗收（Phase 3.C-CD）**：
- pnpm test:unit ✅ 685 pass / 17 skip / 0 fail
- GET /api/subtitle-presets 200 + 5 條 preset
- POST /api/title-hooks 200 + 兜底 5 條候選
- /title-hooks 演示頁 200

**驗收（Phase 3.C-B）**：
- pnpm test:unit ✅ 685 pass / 17 skip / 0 fail
- /script-rewrite HTTP 200
- POST /api/script-rewrite 空 body 返回 400 + Zod schema 校驗訊息（path: ["source"]）
- 4 個新 step + 1 個新 workflow + API + UI 全部 wire 通

**驗收（Phase 3.C-A）**：
- pnpm test:unit ✅ 685 pass / 17 skip / 0 fail
- /highlights HTTP 200
- POST /api/highlights 空 body 返 400 + Zod schema 校驗
- POST /api/highlights {source: text} 返 400「仅支持视频类」（API 層 enum 守門）
- POST /api/highlights {source_type: md_draft} 返 400 + enum 限制
- 4 個新 step + 1 個新 workflow + 4 個 API route + 4 個 UI 文件全部 wire 通
- 手動微調 ±10s 通過 /api/highlights/[id]/recut sync 重切實現

**Phase 3.C 整體完成 — 4 個自媒體爆款工具全部就緒**：
- A. 高亮自動切片 ✅
- B. 多平台腳本適配（YT 長 / 抖音 60s / 小紅書 / 公眾號）✅
- C. 標題鉤子優化器 ✅
- D. 字幕樣式預設庫 ✅

---

## 5. 當前進度

### Phase 0：項目初始化 ✅ 完成（2026-04-30，commit `ac7dc06`）
- [x] 從前身項目選擇性複製代碼
- [x] 改 package.json name + version（laputa-media-center@0.1.0）
- [x] 全項目重命名 ChuangCut → LaputaMediaCenter（顯示文案 + 運行時字串）
- [x] 重寫 .env.example（乾淨模板，無個人路徑）
- [x] 跑通 pnpm install + db:init + dev（http://localhost:8899 HTTP 200）
- [x] git init + 第一次 commit（main branch）

**Phase 0 額外做的決定（用戶批准）**：
- proxy.ts 加 `NODE_ENV=development` license bypass（保留 V3 機制，僅放寬門禁）
- session cookie：`chuangcut_session` → `laputa_session`
- API token prefix：`cca_` → `lmc_`
- runtime tmp：`/tmp/chuangcut` → `/tmp/laputa`

**Phase 0 沒處理（留給後續 Phase）**：
- 測試斷言裡 hardcode 的 `chuangcut-video-workflow@16.0.0` → Phase 1
- `docs/test-reports/e2e-results.json` 過時測試報告 → Phase 4（已被 .gitignore）
- `docs/agent/*` 裡 Docker / Zeabur 文檔 → Phase 1 砍 SaaS / Phase 4 docs 大砍
- `laputa-video-chuangcut-editing` 引用 → 不改（用戶機器真實 skill 目錄路徑）
- `lib/license/crypto.ts` SALT → 不改（避免破壞已生成 license）

### Phase 1：砍 SaaS 偽裝（完成於 2026-04-30）
- [x] License V1/V2 砍掉（前身已收斂為 V3-only，無 V1/V2 殘留）
- [x] 混淆構建砍掉（含 javascript-obfuscator dep + obfuscate-build.mjs）
- [x] GCS 砍掉全鏈路
- [x] Fish Audio 砍掉全鏈路（provider/UI/verify/types/legacy-constants）
- [ ] Wav2Lip 默認啟用驗證 → Phase 2 一併驗（whisper.cpp 集成時整體驗收）
- [ ] LatentSync stub 接口預留 → Phase 2
- [x] Stress test 砍掉（5 個 stress 文件 + test:stress script）
- [ ] **provider-smoke-audit 簡化 deferred 到 Phase 3.A**：
      reservation + permit 邏輯被 dubbing-readiness/route.ts (1700+ 行) 深度使用，
      Phase 1 砍會破壞主流程。Phase 3.A Provider 抽象階段一併重構。
- [ ] **closed-loop-readiness 簡化 deferred 到 Phase 3.A**：同樣狀況。
- [x] Auth 默認關（lib/auth/config.ts + proxy.ts isAuthEnabled() 默認 false）
- [x] Rate limit 寬鬆（QUERY 60→600，CREATE_JOB 6→60，UPLOAD 1→30 等）
- [x] Docker 多平台砍掉（build-multiplatform.sh / publish-docker.sh + provider-smoke CLI mjs）
- [x] Zeabur 文檔砍掉（docs/agent/deployment.md / credentials.md / cloud-*.md）
- [x] 受保護資產 8 個全部驗證保留：translator.py / voice-registry.ts /
      creator-profile.ts / applied-asset-summary.ts / dubbing-qa.ts /
      source-classifier.ts / workflow/engine.ts / config/languages.ts

### Phase 2：替換 Python（完成於 2026-04-30）
- [x] 集成 whisper.cpp（lib/asr/ 6 個新檔：types/binary-installer/model-installer/whisper-cpp-runner/runtime-status/index）
- [x] transcribe-media.ts 改後端（ingest 流程 runner.ts:runWhisper 用 WhisperCppRunner）
- [x] dubbing/whisper-asr.ts 同步遷移（保留 dubbing.segments artifact schema）
- [x] .env.example 更新（移除 INGEST_PYTHON_EXE/INGEST_WHISPER_CLI，加 WHISPER_CPP_PATH/MODEL/THREADS/GPU）
- [x] 保留 translator.py 兩階段邏輯（受保護資產，零改動）
- [x] scripts/whisper_asr.py 加 DEPRECATED 注釋（保留作 fallback）
- [x] tests/ingest/runner.test.ts mock WhisperCppRunner（避免測試觸發真實下載）
- [x] **真實驗收完成**：whisper-cli.exe + ggml-base.bin 自動下載到 ~/.laputa/whisper/，
      1 秒 wav 轉錄 748ms 完成（CPU AVX2/FMA），JSON 輸出格式對齊 normalize 邏輯
- [x] **install API**：POST /api/runtime/whisper-cpp/install (SSE 推送進度) +
      GET /api/runtime/whisper-cpp/status；session-only + rate limit 1/min + module-level single-flight
- [x] **UI 按鈕**：components/settings/whisper-cpp-installer.tsx，集成在 settings/maintenance tab
- [x] **修 binary URL**：v1.7.4 → v1.8.4 + repo 改名 ggerganov → ggml-org（v1.7.4 release assets 沒遷移，404）
- [x] **修 model 下載**：Node undici fetch 對 HuggingFace cas-bridge redirect 鏈有 UND_ERR_CONNECT_TIMEOUT，
      改用 spawn curl（Win10+/macOS/Linux 預裝）
- [x] **修 binary 名**：v1.8.4 起 main.exe → whisper-cli.exe（舊名是 deprecation wrapper）；
      解壓後拍平 Release/* 內容到 cacheDir 頂層讓 ggml*.dll 與 exe 同目錄

### Phase 3.A：ASR + LLM Provider 抽象（後端完成於 2026-04-30）
- [x] 設計 lib/providers/asr/ 和 llm/ 接口（types.ts + IASRProvider/ILLMProvider）
- [x] ASR：whisper-cpp（🟢，包 WhisperCppRunner）+ gemini-audio（🟢，Hybrid: whisper 時間戳 + Gemini 文本對齊）
      （openai-whisper **砍**：朋友用 whisper.cpp 已夠，避免維護面 + 體積）
- [x] LLM：gemini（🟢，包 lib/ai/gemini）+ openai（🟡，SDK）+ mistral（🟢，SDK）
- [x] 改 translator.py L719：擴展 provider 分支接受 gemini/openai/mistral，
      OpenAI/Mistral 走 OpenAI-compatible 路徑（call_gemini_json 已內建判斷）；**兩階段 prompt 0 動**
- [x] 改 lib/ingest/runner.ts:runWhisper() + lib/workflow/steps/dubbing/whisper-asr.ts 走 registry
- [x] 改 lib/workflow/steps/dubbing/translate-text.ts 走 registry.getActiveLlmProviderId()
- [x] 4 個 API routes：GET/POST `/api/providers/{asr,llm}` + POST `/api/providers/{asr,llm}/test`
- [x] **UI 切換器**（Claude Design 風格完成 2026-04-30）：
      asr-provider-switcher.tsx + llm-provider-switcher.tsx，集成到 settings system tab。
      Tier badge / Ready chip / 測試連接 / 切換 active / OpenAI 付費確認 checkbox / Mistral 開源 / 配置編輯器
- [x] **closed-loop-readiness.ts 重寫** 760 → 730（4% reduction，inline fallback + dict-driven detail）。
      **不達 ~250 目標**：Agent L 評估後保 8 個 consumer 完整序列化 + 5 個 provider gate（受保護資產邊界）使進一步削減 risk 太高
- [ ] **provider-smoke-audit.ts 重寫 deferred 到 Phase 4**（Agent M 坦誠評估：reservation/permit 450 行被
      dubbing-readiness/route.ts 深度耦合，最多砍到 ~830，達不到 ~400 目標，且觸發 8 個 consumer 回歸風險）

### Phase 3.B：MD/PDF 入口 + 播客模式（後端完成 2026-04-30）
- [x] MD 入口（gray-matter 解析 frontmatter + 標題/段落結構）
- [x] PDF 入口（unpdf 純 JS 提取，按頁分段）
- [x] source-classifier 擴展（加 .md/.markdown/.pdf 識別 + SOURCE_LABELS/STRATEGIES）
- [x] text_draft 拆 md_draft / pdf_draft（types/runner/source-classifier 全鏈路）
- [x] 播客 LLM 改寫步驟（兩階段）：
      `build-podcast-brief.ts` + `generate-podcast-script.ts`，走 `lib/providers/llm/registry`
      （**不複用 translator.py**，獨立 prompt + JSON schema）
- [x] podcast-production 工作流（4 stages: ingest → rewrite → tts → delivery）
- [x] `podcast-tts.ts` 直接 fetch MiniMax t2a_v2（不走 voice_cloner.py，但用同一 voice-registry / boundary / gate）
- [x] `podcast-delivery.ts` ffmpeg concat + manifest
- [x] `app/api/upload/document/route.ts` (.md/.pdf 上傳，50MB 限制)
- [x] `app/api/ingest/route.ts` schema 加 md_draft/pdf_draft
- [x] workflow-ids + artifact-manifest + steps registry 全鏈路註冊
- [x] **UI 完成**：`app/podcast/page.tsx` + `components/podcast/{podcast-form, podcast-workbench}.tsx`
      （3 種素材 / 4 種風格 / 5 種時長 / 雙人模式 / 主+次聲線 / boundary + minimax_tts gate 雙重確認）
- [x] **API 完成**：`app/api/podcast/route.ts` 創建 podcast job（schema 校驗 + voice_id 必填 + workflow 註冊）
- [ ] **真實驗收**：留用戶手動跑（需要 Gemini key + MiniMax key + 已註冊聲線）

### Phase 4：清理 + 重置 ✅ 完成（2026-05-01）
- [x] **W0**：TS production errors 全修 + biome lint 全綠（commit `831a876`）
- [x] **W1**：Mandarin prompt 分支補齊 + /title-hooks cost 文案修正（commit `60becb4`）
- [x] **W2**：4 工具 nav + 首頁 dashboard + AUTH-aware login + /api/health + MD/PDF 切換清空 + podcast 無聲線 CTA + UI 術語去工程化（commit `9bb63d0`）
- [x] **W3**：9:16 ffmpeg scale+pad+setsar + preview aspect + settings 404 silent + mobile chip 32px + 品牌統一（site-logo / footer / license-error / README）+ CODEX_HANDOFF.md 受保護資產路徑修正 + CHANGELOG.md 起步（commit `570e9f0`）
- [x] **Plan A 實機驗證**：/api/health + dashboard + 9:16 ffprobe + S-01 並發 jobs + S-04 上傳邊界 + S-05 並發 recut 全過
- [x] **Plan B**：Fish Audio 主線 UI/provider 移除（tts-config.tsx + types/ai/tts.ts + status-badge.tsx）；legacy report/cost compat 保留（lib/cost/ + report sections 仍渲染歷史 fish_audio 欄位）+ 版本號 reset 16.0.0 → 1.0.0
- [x] **Plan C**：docs/ 大瘦身（19 個過期 doc 砍除：legacy-editing-removal-plan 267KB / agent/changelog 17KB / agent/testing 整目錄 17 個檔；33→13 markdown）+ index.md / README.md / dubbing-guide.md ref 修正
- [x] Agent docs 合併（repo 只有 AGENTS.md，CLAUDE.md / WARP.md 不在 repo 內，無事可做 — 跳過）
- [x] **Plan D**：migrations-archive 砍（11 個歷史 SQL / 54KB，無代碼 ref）+ .next 構建緩存清理（1.4GB）+ Phase 4 標 ✅ 完成
- [x] **migration「合一」現狀**（Codex P2 #9 修自相矛盾後的精確說明）:
  - **fresh install source of truth**: `lib/db/schema.sql`（415 行，含現役 schema）
  - **legacy 殘留**: `scripts/migrations/` 29 個 `.js`（從前身 ChuangCut 帶來的歷史 migration），加 `scripts/run-migration.js` 是一次性 CLI；**production code / package.json scripts / fresh init 都不引用**
  - **dynamic helper**: `lib/db/index.ts:dropCheckConstraint × 3`（idempotent，舊 dev DB 升級用，fresh install no-op）
  - **未做** 真正物理合併到 `001_init.sql` 也不打算做（schema.sql 就是 init）；scripts/migrations/ 可在 Phase 5 開源前一併砍掉（或移到 `_archive/`）
- [x] 構建緩存類文件刪除（一次性：Plan D 已清過 `.next` 1.4GB；`.next` 與 `node_modules` 都 gitignored，不入 commit；不適合做為自動化 task）
- [x] 版本號重置 1.0.0（package.json + README）
- [x] 寫 CHANGELOG（CHANGELOG.md，1.0.0 entry + W0-W3 + Phase 1-3.C 歷史摘要）

### Phase 5：開源就緒（進行中 2026-05-01）
- [x] **Wave 5.1 secrets 全項目掃描完成**（commit `0eaf878` B+ 脫敏）:
  - **強義 secrets = 0 leak**：無 OpenAI/Google/GitHub/HF/AWS/Anthropic key、無 SESSION_SECRET / ENCRYPTION_KEY 真值、無 LICENSE_KEY 真值、無 私鑰 PEM、無 URL embedded credentials、無 yt-dlp cookies、working tree 完全乾淨
  - **個資 5 類**（非 security incident，是隱私決策）：
    1. `hkdadinsz@gmail.com` 在 AGENTS.md:43 + 全 55 commit author metadata
    2. 舊工作流 Gmail 在 commits `ac7dc06` / `d0ac9f3` 已刪除的 docs/agent/credentials.md（在 history 仍可 git show；不要在 repo 再寫成連續明文）
    3. Zeabur project IDs（已 Phase 1 decommissioned，曝光無實際風險）
    4. 舊工作流 GitHub username 在 deleted history（PAT 是 `ghp_xxx` 占位符不是實值；不要在 repo 再寫成連續明文）
    5. Cloudflare R2 public bucket URL（intentionally 公開，無風險）
  - **採 B+ 方案**（先做 working tree / future commit author 脫敏；push 前仍需 history rewrite 清舊工作流帳號殘留）：
    - AGENTS.md:43 working tree 脫敏為「維護者聯絡方式：開源後填」
    - repo-local `user.email` 改為 `noreply@laputamediacenter.local`（後續 commit 不再用 personal email；GLOBAL git config 不動）
    - 不重寫已存 55 commit 的 `hkdadinsz` author metadata（保留）
    - 5/1 之後 commits 都用 noreply alias
- [ ] Git history rewrite 清舊工作流帳號殘留（push GitHub 前阻塞；保留 `hkdadinsz*` / `laputa`）
- [ ] README 中英文
- [ ] LICENSE（暫定 MIT，未落檔）
- [ ] CONTRIBUTING.md
- [ ] demo GIF / 截圖
- [ ] install.ps1 / install.sh
- [ ] 首次運行嚮導
- [ ] 刪 _archive/
- [ ] push GitHub（必須在 Wave 5.1 + 至少 LICENSE / README / install scripts 完成後）

---

## 6. 已決定事項

| # | 問題 | 決定 |
|---|---|---|
| A | 播客模式優先級 | **A1：v1.0 包含播客**（Phase 3.B）|
| B | PDF 解析精細度 | **B2：保留結構**（unpdf / pdfjs-dist）|
| C | TTS 抽象策略 | **C2：MiniMax 主力 + Edge TTS 免費備援** |
| D | 口型同步策略 | **D3 修訂：v1.0 Wav2Lip 默認啟用為主力，LatentSync 預留 stub，v1.1 加 D-ID + Sync.so** |
| E | 舊項目凍結告示 | **E：是**，給 ChuangCut-Full333 加凍結告示 |

## 7. 待用戶決定的事項

| # | 問題 | 選項 | 何時要決定 |
|---|---|---|---|
| 1 | 開源 License | MIT / AGPL / 暫不開源 | Phase 5 之前 |
| 2 | 默認 ASR Provider | **whisper.cpp（建議）** / Gemini Audio | Phase 3.A |
| 3 | 默認 LLM 後端 | **Gemini（建議）** / OpenAI / Mistral | Phase 3.A |
| 4 | 是否做安裝 .exe | 是 / 否（v1.1 再做） | Phase 5 |
| 5 | 是否保留 Auth 系統 | 完全砍 / 默認關但保留代碼 | Phase 1 |
| 6 | 開發 port | 保留 8899 / 改 3000 | Phase 0 |
| 7 | 環境變數要不要加 LMC_ prefix | 加 / 不加 | Phase 4 |
| 8 | v1.1 口型同步 API 順序 | D-ID 先 / Sync.so 先 | v1.0 完成後 |

**規則**：除非用戶在當次對話明確回答，**不擅自選定**，到那一步要問。

---

## 8. 從前身項目複製清單

**前身項目位置**：
`C:\Users\user\Desktop\ChuangCut-Full333\chuangcut-video-workflow-036e966`

### ✅ 必須複製
```
app/                              整個目錄
components/                       整個目錄
lib/                              整個目錄
public/                           整個目錄
config/                           整個目錄
hooks/                            整個目錄
store/                            整個目錄
types/                            整個目錄
scripts/                          整個目錄（特別保留 translator.py / whisper_asr.py / voice_cloner.py / compose_dub.py）
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
tsconfig.json
biome.json
next.config.ts
postcss.config.mjs
proxy.ts
.gitignore
.npmrc
.dockerignore
playwright.config.ts
vitest.config.ts
```

### ⚠️ 複製但要清理 / 重寫
```
.env.example                      ← 重寫成乾淨模板
docs/                             ← 整個複製，Phase 4 大砍
tests/                            ← 整個複製，Phase 1 砍 stress
README.md                         ← Phase 5 重寫
LICENSE                           ← Phase 5 確認
```

### ❌ 絕對不要複製
```
node_modules/
.next/
.git/                             舊歷史可能藏 secrets
logs/
tmp/
data/                             含用戶數據庫
.env.local                        🚨 真實 secrets
.codex-dev-server*.log
.DS_Store
tsconfig.tsbuildinfo
playwright-report/
test-results/
.coverage/
```

### 🤔 用戶單獨決定
```
data/db.sqlite                    要保留歷史任務記錄嗎？
docker-compose.yml + Dockerfile   保留也行，個人不需要
zeabur.yaml + ZEABUR_DEPLOYMENT.md Phase 1 砍
AGENTS.md + CLAUDE.md + WARP.md   全部統一為一份 AGENTS.md
VERSION.md                        Phase 4 改寫或刪除
```

---

## 9. 風險登記

| 風險 | 影響 | 應對 |
|---|---|---|
| 砍 SaaS 偽裝時誤砍受保護資產 | 用戶幾個月成果灰飛煙滅 | Phase 1 動受保護資產**必須先問用戶** |
| 兩階段翻譯被誤簡化 | 翻譯質量斷崖式下跌 | AGENTS.md 紅線、PROJECT_PLAN.md 第 10 章警告 |
| API key 不小心 commit | 開源時洩露 | Phase 5 多輪 grep + git history 全新 init |
| whisper.cpp 在 Windows 編譯 / 下載失敗 | Phase 2 卡住 | 留 Python Whisper 為後備 |
| Provider 接口設計不好導致重寫 | Phase 3.A 工期翻倍 | 先實現 1 家完整、再抽象、再加第 2 家 |
| Edge TTS endpoint 被微軟限制 | 🟢 默認 TTS 失效 | 預留 Azure Speech 免費額度作備援 |
| Gemini 免費額度政策變化 | 🟢 默認 LLM 失效 | 預留 Mistral / Together AI 作備援 |
| 用戶決策延遲 | Phase 阻塞 | 對話結束就拋出問題清單，給用戶慢慢想 |
| 對話太長導致 AI 失憶 | 進度丟失 | 每次對話結束 commit + 更新本文檔 |
| 用戶 API 額度耗盡 | 真實調用失敗 | 開發期用 dummy / mock，重要里程碑才真調 |
| PDF 含掃描圖片無法解析 | 部分 PDF 入口失敗 | 明確 v1.0 不支持 OCR，UI 給用戶提示 |
| Wav2Lip 在 Blackwell GPU（5060 Ti）兼容問題 | 用戶本地 lipsync 失效 | Phase 1 驗證一次，必要時更新 PyTorch / CUDA 版本 |

---

## 10. 資產保護清單（重要）

### 🔒 級別 1：核心資產，砍前必須三問用戶

#### 1. `scripts/translator.py`（798 行）
- **價值**：兩階段深度翻譯（build_context_brief + translate）
- **獨特性**：注入 creator_context + user_glossary + 風格映射 + 粵語特化
- **替代方案**：無。這是用戶 + Codex 多月磨出的精品，市面 OSS 沒有等價物
- **可動部分**：底層 LLM 調用層（為了支持切換 Gemini / OpenAI / Mistral）
- **不可動部分**：兩階段流程結構、prompt 設計、規則列表、JSON schema

#### 2. `lib/dubbing/voice-registry.ts`
- **價值**：聲線註冊表 5 類別 + 公眾人物披露
- **獨特性**：對「翻譯名人政客」這個高敏感場景的合規打底
- **不可動**：5 個 category 枚舉、disclosure_required 字段、authorization_proof 機制

#### 3. `lib/dubbing/creator-profile.ts`
- **價值**：創作者畫像（人設 / 受眾 / 用詞風格 / 普粵 style guide）
- **獨特性**：注入翻譯 prompt 讓配音聽起來像「這個創作者本人在說中文」
- **不可動**：CreatorProfileConfig 接口、注入到 translator.py 的鏈路

#### 4. `lib/dubbing/applied-asset-summary.ts`
- **價值**：公眾人物使用披露 + 聲線使用展示
- **不可動**：disclosure_status 計算邏輯、voice usage 展示

#### 5. `lib/jobs/dubbing-qa.ts`
- **價值**：8 維度 QA 系統（artifacts / glossary / numbers / rhythm / language / speakers / assets / delivery）
- **不可動**：8 個 category 枚舉、QaCheck 接口、評分邏輯

### 🟡 級別 2：穩定資產，砍前需要說明理由

- `lib/ingest/source-classifier.ts`（多源入口分類器）
- `lib/workflow/engine.ts`（工作流引擎核心）
- `lib/workflow/state/`（狀態機）
- `lib/jobs/delivery-package.ts`（交付包）
- `lib/config/languages.ts`（20 種語言 + 粵語特化）

### 🟢 級別 3：可自由清理 / 重構

- 三份 Agent docs（合併）
- License V1/V2（保留 V3 即可）
- 混淆構建
- GCS / Fish Audio / Stress test
- `provider-smoke-audit` / `closed-loop-readiness`（簡化但保留核心）

### 操作規則

任何 AI 助手在動級別 1 資產前：
1. 在對話裡明確說「我準備修改 [文件]，原因是 [X]，影響範圍 [Y]」
2. 等用戶說「OK」或「繼續」
3. 修改後立即 git commit，commit 信息要清楚標明這是受保護資產的修改
4. 在 PROJECT_PLAN.md 的「變更日誌」記錄

---

## 11. 變更日誌

> 每次對話結束 AI 助手在這裡加一行記錄。

- **2026-04-30**：D 決議微調 — Wav2Lip 從「默認關」改為「默認啟用主力」；LatentSync 從「v1.0 高級選項」降為「預留 stub，後備未來升級」。原因：用戶目前用 Wav2Lip 滿足，先穩定再升級。
- **2026-04-30**：項目計劃 v3 確立。納入：A1（v1.0 含播客）、B2（PDF 保留結構）、C2（MiniMax + Edge TTS）、D3 修訂（Wav2Lip 默認啟用 + v1.1 D-ID/Sync.so）、E（凍結舊項目）。資產保護清單建立。
- **2026-04-30**：Phase 0 完成（commit `ac7dc06`）。代碼骨架從 ChuangCut 拷貝就位，受保護資產原封不動，dev server 跑通。proxy.ts 加 dev mode license bypass（保留 V3 機制）。下一步進 Phase 1。
- **2026-04-30**：Phase 1.A 完成。砍 stress test (5)、混淆構建 (obfuscate-build + dep)、Docker scripts、Zeabur 文檔、GCS 全鏈路 (50+ 引用點)、provider-smoke CLI mjs；改 Auth 默認 false、Rate limit 寬鬆。License V1/V2 任務跳過（前身已收斂為 V3-only）。Phase 1.B 待做：Fish Audio 砍除 + provider-smoke-audit/closed-loop-readiness 簡化 + 修測試 hardcode。
- **2026-04-30**：Phase 1.B 完成。砍 Fish Audio 全鏈路（provider 400 行/UI 105 行/verify ~70 行/types/legacy-constants/8 個 routes 引用清理）；修 8 個測試 hardcode（chuangcut@16.0.0 → laputa@0.1.0）；砍 4 個考古測試文件（mainline-positioning-guard / api-routes-safety-guard / tts-legacy-auth / settings-page-legacy-tts）；skip 17 個 Fish Audio + GCS 對象已砍的舊 case。**Phase 1 收尾驗收**：pnpm test:unit 685 pass / 17 skip / 0 fail；dev server 200 OK；受保護資產 8 個全保留。**Defer**：provider-smoke-audit / closed-loop-readiness 簡化任務超出 Phase 1 範圍（會傷主流程 dubbing-readiness/route.ts 1700+ 行），轉到 Phase 3.A Provider 抽象階段重構。
- **2026-04-30**：Phase 2 代碼層集成完成（TEAM 模式：3 個 agent 並行盤點 + 設計）。新建 `lib/asr/` 6 個檔（WhisperCppRunner + binary-installer 自動下載 GitHub releases v1.7.4 prebuild + model-installer 從 HuggingFace 拉 ggml-base / 共 ~150MB 緩存到 ~/.laputa/whisper/）。改 `lib/ingest/runner.ts:runWhisper()` 和 `lib/workflow/steps/dubbing/whisper-asr.ts` 兩個 ASR 入口都用 WhisperCppRunner，segments.json schema 保持與 translator.py 兼容。Phase 2 默認純 CPU（Blackwell sm_120 cuBLAS prebuild 不穩，base 模型 i5-14600KF 跑 1 分鐘音頻 ~3-5 秒夠用）。`scripts/whisper_asr.py` 加 DEPRECATED 注釋作 fallback。pnpm test:unit 685 pass / 17 skip / 0 fail。Phase 2 收尾待做：真實 YT 轉錄驗收 + install API + UI 按鈕。
- **2026-04-30**：Phase 2 收尾完成（TEAM 模式：3 個 agent 並行 — E 驗證 release URL / F 設計 install API / G 盤點 settings UI 風格）。新建 `app/api/runtime/whisper-cpp/install/route.ts`（SSE + session-only + 1/min rate + single-flight）+ `status/route.ts`（GET JSON）+ `components/settings/whisper-cpp-installer.tsx`（進度條 UI），集成到 settings/maintenance tab。**真實驗收**：自動下載 ~5MB whisper-cli.exe + 148MB ggml-base.bin 到 ~/.laputa/whisper/，1 秒 wav 轉錄 748ms 完成（CPU AVX2/FMA），JSON 輸出格式對齊。**修 3 個發現的問題**：(1) v1.7.4 release assets 沒遷到改名後的 ggml-org/whisper.cpp，升級到 v1.8.4；(2) Node undici fetch 對 HuggingFace cas-bridge redirect 有 timeout，model-installer 改用 spawn curl；(3) v1.8.4 zip 主可執行從 main.exe 改名 whisper-cli.exe，解壓後拍平 Release/ 內容到 cacheDir 讓 dll 與 exe 同目錄。pnpm test:unit 685 pass / 17 skip / 0 fail。Phase 2 整體完成，下一步 Phase 3.A Provider 抽象。
- **2026-04-30**：Phase 3.A 後端完成（TEAM 模式：3 個 agent 並行 — H 盤點 LLM 調用點 / I 設計 Provider 架構 / K 驗證 translator.py 契約）。新建 `lib/providers/{asr,llm}/` 9 個檔（types + 5 個 provider impl + registry）。ASR：whisper-cpp（默認，包 WhisperCppRunner）+ gemini-audio（Hybrid 模式：whisper 時間戳 + Gemini 文本對齊）。LLM：gemini（默認，包 lib/ai/gemini）+ openai（SDK）+ mistral（SDK）。**openai-whisper 砍**（朋友用 whisper.cpp 已夠）。改 `scripts/translator.py:L719` 擴展 provider 分支：accept gemini/openai/mistral（OpenAI/Mistral 走 OpenAI-compatible 路徑，call_gemini_json 已內建判斷），**兩階段 prompt 0 動**。改 `lib/ingest/runner.ts:runWhisper()` + `lib/workflow/steps/dubbing/{whisper-asr,translate-text}.ts` 走 registry。新建 4 個 API routes（GET/POST list + POST test）。**真實驗收**：GET `/api/providers/asr` 列出 2 個 + GET `/api/providers/llm` 列出 3 個 + POST `/api/providers/asr/test {whisper-cpp}` 1117ms ok=true。pnpm test:unit 685 pass / 17 skip / 0 fail。**UI deferred 到 Claude Design 階段**（用戶要求）。**Phase 1 deferred 兩個大檔重寫**：留下次（closed-loop-readiness 760→~250 + provider-smoke-audit 1351→~400）。
- **2026-04-30**：Phase 3.A 收尾完成（TEAM 模式：3 個 agent 並行 — L 重寫 closed-loop / M 評估 provider-smoke-audit / N 設計 UI）。**closed-loop-readiness 重寫**：760→730（4% reduction，inline fallback + dict-driven detail；保 8 個 consumer 序列化 + 5 個 provider gate 邊界）。Agent M 坦誠評估後 **provider-smoke-audit deferred 到 Phase 4**（reservation/permit 450 行深度耦合 dubbing-readiness/route.ts，砍會破壞付費 gate）。**UI 切換器（Claude Design）**：新建 `asr-provider-switcher.tsx` + `llm-provider-switcher.tsx`（Tier 🟢🟡🔴 badge / Ready chip / 測試連接按鈕 / 切換 active 按鈕 / OpenAI 付費確認 inline checkbox / Mistral 開源備選 / OpenAI+Mistral 凭證編輯器走 POST /api/configs / 配置入口跳轉 maintenance/ai-studio tab），集成到 settings system tab 內「運行 Provider」分組（不新開 tab）。pnpm test:unit 685 pass / 17 skip / 0 fail；/settings + GET/POST /api/providers/* 全部 200 OK。Phase 3.A 整體完成，下一步 Phase 3.B（MD/PDF 入口 + 播客模式）。
- **2026-04-30**：Phase 3.B 後端完成（TEAM 模式：3 agent 並行 — O 盤點 ingest 鏈 / P 設計播客 / Q 受保護資產守門員）。**MD/PDF 入口**：types `source_type` 加 `md_draft|pdf_draft` + JobType 加 `podcast_production`；source-classifier 加 .md/.markdown/.pdf 識別；runner.ts 新增 `createMarkdownDraftTranscription`（gray-matter 解析 frontmatter + 標題/段落）+ `createPdfDraftTranscription`（unpdf 純 JS 按頁提取）；新建 `app/api/upload/document/route.ts` (.md/.pdf 上傳)。**播客模式 4 stages**：ingest → rewrite → tts → delivery；新建 4 step + artifact-paths：`build-podcast-brief.ts`（LLM 第一階段，走 registry，獨立 prompt schema）+ `generate-podcast-script.ts`（LLM 第二階段，含 opening/body/transition/closing role + pacing_hint + pause_after_ms）+ `podcast-tts.ts`（**直接 fetch MiniMax t2a_v2**，沿用 voice-registry/boundary/gate，不走 voice_cloner.py）+ `podcast-delivery.ts`（ffmpeg concat + manifest）。新建 `lib/workflow/workflows/podcast-production.ts` + workflow-ids/artifact-manifest 全鏈路註冊。pnpm test:unit 685 pass / 17 skip / 0 fail。**未動受保護資產**：translator.py 兩階段邏輯 / voice-registry / creator-profile / source-classifier 核心邏輯（只擴展 enum + case，符合 PROJECT_PLAN line 305-309 計劃）。**UI deferred 到下次**：app/podcast/page.tsx + podcast-form + podcast-workbench + app/api/podcast/route.ts。
- **2026-04-30**：Phase 3.B 收尾完成。新建 `app/api/podcast/route.ts`（z.enum schema 校驗：source_type 限 text/md/pdf_draft + tone 4 種 + speaker_mode 雙人/單人 + voice_id 必填 + creator_context + boundary_ack + confirmed_gate_ids；taskQueue.enqueue + initState 完整鏈路）。新建 `components/podcast/podcast-form.tsx` ~480 行（3 種素材切換 / textarea 50 字下限 / .md/.pdf 走 /api/upload/document / 4 風格卡片 + 5 時長 chip + 雙人模式 / VoiceSelect 從 /api/dubbing/voices 拉本地聲線 / 雙重 inline checkbox 確認 / sonner toast）+ `podcast-workbench.tsx`（4-stage 進度卡）+ `app/podcast/page.tsx`。**驗收**：/podcast 200 + /api/podcast schema 400 校驗 + pnpm test:unit 685 pass / 0 fail。Phase 3.B 整體完成。**用戶決定加入 Phase 3.C**（自媒體爆款工具：高亮切片 / 短視頻腳本適配 / 標題鉤子優化 / 字幕樣式預設庫）作為下一階段。
- **2026-04-30**：Phase 3.C-CD 完成（commit `8896468`）。**C 標題鉤子優化器**：`lib/title-hooks/{types,optimizer}.ts`（走 LLM Provider Registry，5 候選標題 + SEO 關鍵詞 + 鉤子強度 1-5 + 開頭前 30 秒對比優化，含兜底）+ `app/api/title-hooks/route.ts`（POST，z.schema + rate limit + 同步返回）+ `components/title-hooks/{title-hook-modal,use-title-hooks}.tsx`（modal + 一鍵複製）+ `app/title-hooks/page.tsx`（獨立演示頁，粘貼任意文稿即可使用）。**按需觸發**（不自動跑、不創 job）。**D 字幕樣式預設庫**：`lib/subtitle/presets.ts`（4+1 套：default / cantonese_trendy / serious_political / variety_explainer / xhs_fresh）+ 擴展 `lib/subtitle/{types,adaptive-size,generator}.ts`（presetId 可選，保默認行為不變）+ `app/api/subtitle-presets/route.ts` + `components/subtitle/subtitle-preset-selector.tsx`。**全部基於既有 Noto Sans SC family，靠 size/color/outline/shadow/weight 差異化**（零新字體 + 零 license 風險）。dubbing-form 集成 deferred（2000+ 行，待專項對話）。pnpm test:unit 685 pass / 17 skip / 0 fail。
- **2026-04-30**：Phase 3.C-B 完成（commit `5a67d30`）。**多平台腳本適配**（YT 長 / 抖音 60s / 小紅書 / 公眾號，4 選 N）。**兩階段 LLM rewrite**：Stage 1 `build-multi-platform-brief`（核心觀點 + 鉤子候選 + 4 平台 hint + glossary，走 registry，含 fallback brief 兜底）；Stage 2 `generate-platform-scripts`（**單次 LLM call** 輸出選定平台版本，subset 支援；4 個平台 schema：YoutubeLongScript / DouyinShortScript / XhsPost / WechatArticle）；`script-delivery` 寫 4 個 .md（youtube_script / douyin_script / xhs_post / wechat_article）+ script_manifest.json。**4 stages workflow**：ingest → analyze → rewrite → delivery（`lib/workflow/workflows/multi-platform-script.ts`）。**API**：`app/api/script-rewrite/route.ts`（z.schema：6 種 source_type / platform enum / 可選 target 時長 + auth + rate limit + taskQueue.enqueue）。**UI**：`app/script-rewrite/page.tsx` + `components/script-rewrite/{script-workbench,script-form}.tsx`（3 種素材：text/md/pdf + 4 平台 toggle 多選）。**types/manifest 擴展**：`multi_platform_script` JobType + `script_platforms` config + 4 條 script.* artifact + workflow-ids 全鏈路常量。pnpm test:unit 685 pass / 17 skip / 0 fail；/script-rewrite HTTP 200；POST /api/script-rewrite 空 body 返回 400 + Zod schema 校驗。**Phase 3.C 只剩 A 高亮切片**（需用戶確認啟動）。
- **2026-04-30**：Phase 3.C-A 完成（commit `079d172`）。**高亮自動切片**：4 stages workflow（ingest → score → cut → delivery）。**LLM score `find-highlights.ts`**：transcript.json segments → 5-10 個 30-60s 片段（5 種 type enum：quotable/plot_twist/emotional_peak/storytelling/takeaway + score 1-10 + hook_text ≤80 字 + context_snippet），含 fallback（無時間碼或 LLM 失敗時用 segments 均勻採樣）+ normalize（clamp 5-90s 時長、type 白名單、score 1-10）。**ffmpeg cut `extract-highlights.ts`**：每 highlight 單步 ffmpeg `-ss/-to + -vf ass=...:fontsdir=...`（切片+燒字幕一氣呵成；libx264 + faststart）；可選 9:16 豎屏裁剪 `crop=ih*9/16:ih`；走 Phase 3.C-D `generateSegmentedASS` 多 Dialogue + 5 套 preset；clip 內字幕用相對時間戳（segment.start - clip_start）。**delivery `highlights-delivery.ts`**：寫 highlights_manifest.json（含 cuts metadata + summary + warning）。**API 4 條**：POST /api/highlights（建任務，z.schema：source_type 限 youtube/local_video/local_audio/web_video + target_count 3-10 + preset 5 選 1 + aspect 16:9/9:16）+ GET /api/highlights/[id]（拉 manifest + cuts + status，UI 輪詢）+ POST /api/highlights/[id]/recut（單/批量 ±10s 微調，clamp tolerance + 5-90s 時長校驗，sync 重切返回）+ GET /api/highlights/[id]/clips/[filename]（mp4 stream，path traversal 防護 + .mp4 enum）。**UI**：`app/highlights/page.tsx`（form：YouTube URL / 本地上傳 + 段數 3/5/7/10 + 5 套 preset + 16:9/9:16）+ `app/highlights/[id]/page.tsx`（3s 輪詢狀態 + 完成後 N 個 clip card：原生 `<video>` preview + score/type badge + 雙 Slider 微調 ±10s + recut 按鈕 + 下載按鈕）+ `components/highlights/{highlights-workbench,highlights-form,highlight-clip-card,highlight-trim-controls}.tsx`。**transcribe-media keepVideo 擴展**：`ingest_goal === 'localize' || === 'highlights'`（受保護 source-classifier 0 動）。**types/manifest 擴展**：`highlights_extraction` JobType + 3 條 highlights.* artifact + workflow-ids 全鏈路常量 + script_platforms/highlights_target_count/highlights_subtitle_preset/highlights_aspect 加入 JobConfig 正式類型。pnpm test:unit 685 pass / 17 skip / 0 fail；/highlights HTTP 200；POST /api/highlights 空 body 400；text source 400「仅支持视频类」；md_draft source_type 400 enum 校驗。**Phase 3.C 整體完成（A+B+C+D 4 工具全部就緒）**，下一步等用戶實機驗收後決定 Phase 4（清理 + reset）或 Phase 5（開源準備）。
- **2026-04-30**：Phase 3.C-A 收尾修補（commits `7887bd3` / `c93094f` / `b38571b` / `9ab538a`）。3 agent TEAM 並行 review（V 安全 / W simplify / X prompt 質量）後序列實作 11 fix + 1 個實機驗收暴露的 DB bug。**Batch 1 DRY**（`7887bd3`）：抽 `lib/utils/ffmpeg-utils.ts`（escapeFFmpegPath + execFfmpeg），刪除 3 處重複；`lib/subtitle/types.ts` 加 `SUBTITLE_PRESET_IDS as const` source of truth，API zod schema 派生（淨減 75 LoC）。**Batch 2 SEC**（`c93094f`）：clips/[filename] route 加 `isOwnedByToken` 防枚舉 + rate limit + .mp4 大小寫不敏感；[id] route GET 加 rate limit + ownership；[id]/recut 加 rate limit + ownership + artifact 缺失/ffmpeg 錯誤訊息脫敏（細節進 logger，前端只收泛文案）+ start/end Number.isFinite + 負數二次校驗；find-highlights normalizeBrief 強制覆蓋 LLM 返的 id 為 highlight-NN（防 prompt injection 影響 clip filename）+ totalDuration 用 reduce 防 Math.max(empty) 返 -Infinity。**Batch 3 PROMPT**（`b38571b`）：5 個 LLM step 全部改用 `lib/ai/gemini/parsers/json-extractor.safeParseJson`（提取 markdown ```json 包裝 + 拖尾逗號 + 截斷修復），預期 LLM JSON 容錯率 +30-50%；podcast-brief 加 MAX_SOURCE_CHARS=12000 截斷與 multi-platform-brief 對齊。**DB fix**（`9ab538a`）：實機 POST /api/highlights 暴露舊 `jobs.job_type CHECK` 漏掉 Phase 3.B/3.C 新加的 3 種類型（podcast_production / multi_platform_script / highlights_extraction），導致 SQLite 拒絕；schema.sql 移除 CHECK（API 層 z.enum + workflow-ids 已守門），lib/db/index.ts 加 migrateJobsTypeCheck() 幂等遷移（檢測到舊 CHECK 自動 ALTER+RENAME 重建表保 data）。pnpm test:unit 685 pass；POST /api/highlights {YouTube URL} 返 200 + job_id 確認端到端建任務跑通。**過濾掉 7 條低 ROI 建議 deferred 到 Phase 4/5**（runLlmJsonStep 抽基類 / Delivery step helper / prompt 版本號系統 / Windows 中文路徑 / 並發 race / fonts symlink / dubbing-form 集成 preset）。
- **2026-04-30**：實機 LLM 驗收 Phase 3.C 4 工具（OpenAI-compatible proxy x666.me + gemini-3-flash-preview）暴露 3 個 sleeping bug，commit `9acd3b2` 修：(1) `lib/db/tables/job-step-history.ts:insert` 硬編碼 12 個舊 step 漏 Phase 3.B/3.C 新加的 6 個（analyze/rewrite/tts/delivery/score/cut）→ 創任務即被 throw；(2) schema.sql `jobs.current_step` + `job_step_history.major_step` 兩條 CHECK 列表同樣漏新 step → SQLite 拒絕 INSERT；(3) `generate-platform-scripts.safeParseScript` 太鬆：LLM 返合法 JSON 但用了不同 key 名時所有 4 平台靜默變 null，manifest 是空的。**修法**：types/core/job.ts 抽 `JOB_STEPS as const` source of truth + 派生 JobStep type；`lib/db/tables/job-step-history.ts` import JOB_STEPS 替代硬編碼；schema.sql 移除兩條 CHECK + lib/db/index.ts dropCheckConstraint helper 應用到 3 處（jobs.job_type + jobs.current_step + job_step_history.major_step）；safeParseScript 加 anyMatch 守門 LLM 返的 JSON 至少要有一個 selected platform 的非空對象。**真 LLM 質量驗收**：/title-hooks ✅ 5 標題創意 + SEO 都好（「OpenAI 變 CloseAI」「上億美金研發卻免費送」）⚠️ 開頭 30s 優化 echo 原文（prompt bug 未修）；/script-rewrite ✅ 4 平台 .md 質量高（YT 1385 字 / 抖音 598 字 / 小紅書 593 字 / 公眾號 1218 字）⚠️ 小紅書 tags 重複 2 次（已修 prompt）；/podcast + /highlights 跳過真 LLM 測（缺 MiniMax key + 真視頻）。
- **2026-04-30**：粵語（港式）輸出接通 — B 方案首批 /title-hooks + /script-rewrite（commit `6238589`）。**新建 `lib/i18n/cantonese-prompt.ts`**：抽 ChuangCut translator.py:549-556 嘅 Cantonese rules（用戶滿意嘅那條 prompt）為 source of truth，分 Layer A 硬規則 3 條（我哋/嘅/喺/嚟/係 等粵語助詞 + 避免「用繁體寫普通話」+ 不過度切碎保 TTS 節奏）+ Layer B 風格 5 種（localized_script/short_video/faithful/podcast/written，'written' 為小紅書/公眾號圖文新增）+ Layer C 中文通用數字朗讀。主入口 `getCantoneseRules({ targetLanguage, style, includeSpokenNumbers })` 非粵語返 [] 不影響原 prompt。33 個單元測試全 pass。**接入 /title-hooks**：optimizer.ts + types.ts 加 target_language 欄位；UI 加 3 段 radio（自動 / 普通話 / 粵語港式）+ 強化開頭 30s prompt（「optimized_first_30s 必須明顯不同」）。**接入 /script-rewrite**：build-multi-platform-brief + generate-platform-scripts 按平台映射粵語 style（YouTube=localized_script / 抖音=short_video / 小紅書/公眾號=written）；types/core/job.ts JobConfig 加 script_target_language；UI 加同款 radio；fix 小紅書 tags 重複 bug。**實機驗收**：/title-hooks 4 條粵語標題質量極佳（「OpenAI 變『摺』咗」「點解外國玩閉源」「燒咗幾億美金先發現唔可以開源」用點解/咗/嘅/同/唔/呢/先/晒 地道粵語）⚠️ 開頭 30s 優化 LLM 仍 echo 原文（強化 prompt 沒生效，需 server-side 強制重寫，本輪未修）；/script-rewrite 4 平台全粵語生成（抖音「AI 圈變天啦！」「點解 OpenAI 變咗 CloseAI」「同 Google 呢啲巨頭」、小紅書「真係風起雲湧」「乜都唔 Open 嘞」「鎖喺櫃桶入面」、公眾號副標題「當矽谷巨頭築起高牆，開源主義點樣喺夾縫中求存？」全部用 我哋/嘅/喺度/呢啲/佢哋/攞/畀/嚟）。test:unit 102 files / 718 pass / 17 skip / 0 fail。**剩 2 個工具（/podcast + /highlights）下一輪用同一個 helper 接通即可**（B 方案 v2）。
- **2026-04-30**：粵語 B 方案 v2 + 修 /title-hooks 開頭 30s echo bug（commit `64d1b5a`）。**/podcast 接通**：build-podcast-brief.ts + generate-podcast-script.ts 注入 cantonese rules（podcast style + spoken_numbers），types/core/job.ts JobConfig 加 podcast_target_language；API schema + UI radio 同步。**/highlights 接通**：find-highlights.ts hook_text/summary 用粵語（short_video style + includeSpokenNumbers=false 因 hook_text 不會朗讀），types/core/job.ts JobConfig 加 highlights_target_language；API + UI radio 同步（提示「只影響 hook_text / summary 文案；視頻字幕仍來自原 transcript」）。**Bug #1 修**（/title-hooks 開頭 30s echo）：新建 `isOpeningRewriteEffective(orig, opt)`（歸一化空白標點後比對相似度，長度相近時要求 ≥15% 字符差異）；檢測到 LLM echo → 用更強 system_instruction（「YOU MUST REWRITE. Echoing or near-copying the original is a hard failure.」）+ mandate field retry 一次；兩次都失敗則 fallback 用原文 + warning 提示用戶。6 個單元測試覆蓋邊界（test:unit 103 files / 724 pass / 17 skip / 0 fail）。**至此 Phase 3.C 全 4 工具粵語接通**：/title-hooks ✅ /script-rewrite ✅ /podcast ✅ /highlights ✅。**待實機驗收**：/podcast（需 MiniMax key 才能跑 TTS） + /highlights（需真視頻才能跑 ffmpeg cut）。
- **2026-05-01**：Codex 獨立測試報告處理 — Phase 4 起步 4 波（W0-W3）。**Codex（前一日 read-only 跑了 8 類檢查）發現 13 個 issue**（1 P0 / 8 P1 / 4 P2），用戶選 "C" 全做：W0 必修 + W1 自己引入 UX bug + W2 朋友體驗 + W3 polish。**W0**（commit `831a876`）：6 类 TS production error 修（md_draft union / dup ok / Fish Audio @deprecated / re-export / readdirSync / MajorStep）+ 51 文件 biome auto-fix（safe + unsafe）+ 9 個手動 lint（noImplicitAnyLet / a11y backdrop / exhaustiveDeps / noAssignInExpressions）。**W1**（commit `60becb4`）：之前 mandarin target 多處 prompt 只說「保持源語言」→ 英文素材直接吐英文。新增 i18n helpers `isMandarinTarget` / `MANDARIN_HARD_RULES` / `getMandarinRules` / `resolveLanguageInstruction` 3-way 分支選擇器。6 個 LLM step prompt + 5 個 SYSTEM_INSTRUCTION 加 mandarin 分支；translate-segments.ts 字幕翻譯也支援 mandarin（之前只粵語）。/title-hooks page 動態拉 active provider 顯示 tier badge（避免「默認 Gemini 免費」誤導但實際 OpenAI paid）。+35 mandarin 測試（759 pass）。**W2**（commit `9bb63d0`）：Header 加「工具」下拉（4 個 Phase 3.C 工具）+ AUTH-aware login（disabled 時顯「本地模式」badge 不顯登入/註冊）；Dashboard 4 工具從「下一步」改「可用」；/api/health 拆 service liveness（永遠 200）vs license status（4 種 mode）+ brand「创剪视频工作流」→「LaputaMediaCenter」；MD/PDF mode 切換清空 uploadedPath；podcast 無聲線給 3 個明確入口 CTA；UI 術語去工程化（hook_text / manifest / voice_id 改人話）。**W3**（commit `570e9f0`）：9:16 ffmpeg 加 scale=1080:1920+pad+setsar=1（之前只 crop 下游可能再拉伸）+ HighlightClipCard 接受 aspect prop；/api/configs/[key] 加 KNOWN_OPTIONAL_KEYS 白名單（4 個可選 key 不存在時 200+null 避免前端 console 404）；4 form chip mobile padding 32px / desktop 30px；品牌統一 site-logo「LE/Laputa Content Engine」→「LMC/LaputaMediaCenter」+ footer + license-error + README；CODEX_HANDOFF.md 修 3 個錯誤的受保護資產路徑（lib/creator-profile/* → lib/dubbing/creator-profile.ts 等）；新增 CHANGELOG.md。**13/13 issue 全部覆蓋 + bonus UI 術語去工程化**。每波 verify 都全綠：tsc 0 production errors / biome 0 issues / 759 tests pass。**未做**：Phase 4 剩餘 4 項（agent docs 合併 / docs/ 大瘦身 / migration 合一 / 版本號重置 1.0.0），等用戶確認再啟動 Phase 5（開源就緒）。
