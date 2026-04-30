# LaputaMediaCenter 開發計劃

**最後更新**：2026-04-30（每次對話結束 AI 助手會更新這裡）
**當前 Phase**：Phase 3.B ✅ 完成 → Phase 3.C 待開始
**下次從哪裡繼續**：Phase 3.C 自媒體爆款工具（4 個：高亮切片 / 短視頻腳本適配 / 標題鉤子優化 / 字幕樣式預設庫）

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

### Phase 5：開源就緒 ⚪ 未開始

**目標**：可以推送 GitHub 公開。

**步驟**：
1. 全文搜索殘留 secrets / 個人路徑（多輪 grep）
2. 寫 README.md（中文 + 英文）
3. 加 LICENSE（用戶確認 MIT 或 AGPL）
4. CONTRIBUTING.md（明確「貢獻者可用任何 AI 工具」）
5. 錄 1-2 分鐘 demo GIF / 視頻
6. UI 截圖 3-5 張
7. 安裝引導：`scripts/install.ps1` + `install.sh`
8. 第一次運行嚮導 UI
9. 刪 `_archive/`
10. 用戶確認 → push GitHub

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

### Phase 3.C：自媒體爆款工具（v1.x，2026-04-30 加入計劃）⚪ 未開始

**目標**：在現有 ingest + LLM provider 基礎上加 4 個自媒體創作高 ROI 工具。**核心策略**：復用 Phase 3.A registry 的 LLM 抽象 + Phase 3.B 的 rewrite step 模式（podcast 已建好參考），新組件最小化。

**A. 高亮自動切片**（v1.x 主推）
- 工作流：transcribe → LLM 標出「金句 / 笑點 / 反轉 / 情緒高潮」段落 → ffmpeg 切 30-60s 短視頻 + 自動配字幕
- 新建：`lib/workflow/steps/highlights/find-highlights.ts`（LLM step，輸出 `[{start, end, hook_text, score}]`）+ `extract-highlights.ts`（ffmpeg 切片）
- 新工作流：`highlights-extraction` (4 stages: ingest → score → cut → delivery)
- UI：`app/highlights/page.tsx` + 候選片段列表 + 預覽 + 一鍵導出

**B. 短視頻腳本適配**（v1.x 主推）
- 同一觀點稿 → 一鍵生成 YT 長視頻 / 抖音 60s / 小紅書 / 公眾號 4 種版本
- 新建：`lib/workflow/steps/script-rewrite/` 含 `short-video-script.ts` / `xhs-post.ts` / `wechat-article.ts`
- 復用 podcast 的兩階段框架（brief → rewrite）
- UI：`app/script-rewrite/page.tsx` + 多平台版本切換

**C. 標題/封面建議 + 開頭鉤子優化器**
- LLM 給 5 個備選標題（含 SEO 關鍵詞 + 鉤子強度評分） + 開頭前 30 秒文案優化
- 純後端 step + 簡單 UI 卡片
- 可作為 highlights / podcast / dubbing 的「後處理」共用組件

**D. 字幕樣式預設庫**
- 利用 Phase 0 保留的 21MB 字體
- 預設模板：粵語潮流體 / 嚴肅政論體 / 解說綜藝體 / 小紅書清新體 / 4 套
- 改 `lib/subtitle/generator.ts`：抽 ASS style 為 preset，UI 切換器

**預估對話次數**：3-4 次（4 個功能各 1 次中段 + 收尾 commit）

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

### Phase 4：清理 + 重置
- [ ] Agent docs 合併
- [ ] docs/ 大瘦身
- [ ] 構建緩存類文件刪除
- [ ] migration 合併為 001_init.sql
- [ ] 版本號重置 1.0.0
- [ ] 寫 CHANGELOG

### Phase 5：開源就緒
- [ ] secrets 全項目掃描
- [ ] README 中英文
- [ ] LICENSE
- [ ] CONTRIBUTING.md
- [ ] demo GIF / 截圖
- [ ] install.ps1 / install.sh
- [ ] 首次運行嚮導
- [ ] 刪 _archive/
- [ ] push GitHub

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
