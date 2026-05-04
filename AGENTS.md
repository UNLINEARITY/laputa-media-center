# AGENTS.md — LaputaMediaCenter

> 所有 AI 編程助手（Claude Code、Codex、Cursor、Aider 等）在本項目啟動時都會自動讀取本文檔。
> 詳細計劃、進度、待決策事項請看同目錄 `PROJECT_PLAN.md`。

> ⚠️ **本文檔是開發工具的提示文件**。LaputaMediaCenter 產品本身對任何 AI 工具零依賴。
> 維護者可自由選用任何 AI 編程助手或完全手寫代碼。
> 用戶端（朋友安裝使用 LaputaMediaCenter 時）不需要任何 AI 訂閱。

## 工具中立守則

無論你是 Claude Code、Codex、Cursor、Aider、GitHub Copilot 還是其他 AI 助手：
- 遵守同一份 AGENTS.md 和 PROJECT_PLAN.md
- 不假設用戶在用某個特定 AI 工具
- 不在代碼裡寫死任何 AI 工具特定路徑或習慣
- 任何 AI 助手都能無縫接手前任的工作

## 你正在協助的項目

**LaputaMediaCenter** 是「中文自媒體創作者的素材到內容生產線」：

- **入口任意**：MD / PDF / TXT / 音視頻 / YouTube / 網頁視頻 URL
- **中段 LLM 深度理解**：不是字面翻譯，是讀懂後重寫
- **多輸出目標**：翻譯配音視頻 / 播客 / 旁白 / 短視頻腳本 / 高亮片段
- **聲線統一 MiniMax** + 完整合規披露（公眾人物邊界）
- **全程可重複**、有 QA、可交付包

精神類比 n8n（用戶從 n8n 啟發），專為視頻內容本地化和自媒體生產垂直定制。

底層代碼從前身項目 **ChuangCut** 重構而來。
前身項目位置（**只讀參考，禁止修改**）：
`C:\Users\user\Desktop\ChuangCut-Full333\chuangcut-video-workflow-036e966`

當前項目位置：
`C:\Users\user\Desktop\LaputaMediaCenter`

## 關於用戶

- **不寫代碼、不看代碼**。所有驗證透過 UI 或瀏覽器
- 使用繁體中文交流，可混用英文技術詞
- 錯別字 / 簡轉繁混用 → 結合上下文理解
- 偏好風格：先說結論、複雜問題拆解、給選項而非單一方案
- 維護者聯絡方式：開源後填 GitHub profile / public email（Wave 5.1 secrets 掃描後脫敏）
- 用戶硬件：Intel i5-14600KF / 64GB RAM / RTX 5060 Ti 16GB（Blackwell）/ Windows 11 64-bit

## 核心設計原則

### 1. 「LLM 深度理解優先於 Vendor 抽象」

⚠️ **翻譯不是普通 vendor 抽象**。前身項目 `scripts/translator.py` 的「兩階段深度翻譯」是核心資產：

1. **第一階段 build_context_brief**：LLM 讀整篇 transcript 產出 summary / speaker_notes / ASR 修正建議 / glossary / 改寫策略
2. **第二階段 translate**：基於 brief 注入 creator_context + user_glossary 後逐段翻

**抽象只應用到「LLM 後端切換」（Gemini / OpenAI-compatible / Mistral / Claude-Anthropic 等可插拔），不能簡化成 `translate(text)` 函數**。簡化即災難。

### 2. 「免費優先」

朋友不用付錢給 AI 公司也能跑全套流程：
- 任何新功能必須有 **免費 / 免費額度方案** 作為默認選項
- 付費 API 是**升級項**，不是必需項
- UI 必須清楚標示每個 Provider 是「🟢 免費 / 🟡 付費 / 🔴 高級」

**TTS 例外**：MiniMax 是用戶選定的主力（中文聲線業界最佳性價比），但無 key 時自動降級 Edge TTS（免費）讓朋友能跑通流程體驗。

### 3. 「無 Vendor Lock-in」

- 不寫死任何特定 API 供應商（除 MiniMax 是 TTS 主力）
- 所有外部 AI 服務透過 `lib/providers/` 抽象層調用
- 用戶可隨時切換供應商不需改代碼

### 4. 「本地優先」

- 默認所有處理在用戶本地完成
- 文件、數據庫、轉錄結果 → 本地存儲
- 雲端 API 只在必要時調用，且用戶可禁用任何單項

### 5. 「中文自媒體合規」（你護城河）

- 公眾人物聲線（如政客 / 名人視頻）有強制披露機制
- Voice registry 5 類別不可砍：creator_owned / authorized_clone / public_figure_commentary / synthetic_narration / generic
- 翻譯 + 配音的素材如為公眾人物，必須帶 disclosure_required 標記
- 用戶主要素材是美英新聞 + 名人政客視頻 → 這層合規對用戶是必需

## 受保護的代碼資產（砍前必須三問用戶）

以下代碼是用戶與 Codex 磨了多月的精品，**任何 AI 助手砍之前必須明確獲得用戶批准**：

1. `scripts/translator.py`（798 行兩階段翻譯邏輯）
2. `lib/dubbing/voice-registry.ts`（聲線註冊表 5 類別）
3. `lib/dubbing/creator-profile.ts`（創作者畫像 / 受眾 / 風格 guide）
4. `lib/dubbing/applied-asset-summary.ts`（公眾人物披露）
5. `lib/jobs/dubbing-qa.ts`（8 維度 QA 系統）
6. `lib/ingest/source-classifier.ts`（多源入口分類器）
7. `lib/workflow/engine.ts`（工作流引擎核心）
8. `lib/config/languages.ts`（20 種語言 + 粵語特化）

詳見 `PROJECT_PLAN.md` 第 10 章「資產保護清單」。

## 合作工作方式

### 每次對話啟動的標準流程

1. **讀 `PROJECT_PLAN.md`**（必須，第一件事）
2. 跑 `git log --oneline -5` 確認最後幾次提交
3. 跟用戶確認本次對話的目標（哪個 Phase 的哪一步）
4. 動手前拆解任務（用 TodoWrite 等工具，視 AI 助手而定）
5. 動手

### 工作中

- 每完成一小單元 → 跑 `pnpm lint` / `pnpm test` / 啟動 dev server
- 完成後告訴用戶 **打開哪個 URL** 看效果
- 重要操作之前 **必須先問**：
  - 任何付費 API 真實調用
  - 大規模刪除文件（>5 個）
  - 動受保護資產（即使只動 1 個文件）
  - `git push`、`git reset --hard`、刪數據庫
  - 進入下一個 Phase

### 每次對話結束

1. `git commit`（消息用繁體中文 conventional commits）
2. 更新 `PROJECT_PLAN.md` 的「當前進度」和「下次從這裡繼續」
3. 告訴用戶：「下次說『繼續做 LaputaMediaCenter，先讀 PROJECT_PLAN.md』就行」

## 紅線

- ❌ 不 push GitHub 遠端，除非用戶說「push」
- ❌ 不動前身項目 ChuangCut-Full333（只讀，不寫不刪；唯一例外是項目根 AGENTS.md 開頭的凍結告示，已批准存在）
- ❌ 不 commit secrets / API keys / license keys
- ❌ 不刪 `_archive/` 內容（除非 Phase 5 統一清理）
- ❌ 不擅自決定「待用戶決定事項」未定的選項
- ❌ 不亂改 `.env.local`（含真實 secrets）
- ❌ **不簡化兩階段翻譯為單階段**
- ❌ 不引入特定 AI 公司硬依賴（MiniMax 例外）
- ❌ 不引入 Anthropic / Claude API 作為產品內硬依賴；只能作為用戶自填 Base URL + API Key 的通用 LLM 格式

## 技術棧

- Next.js 16 + React 19 + TypeScript 5
- Tailwind CSS v4
- SQLite + better-sqlite3
- Biome（lint+format，禁用 Prettier/ESLint）
- Vitest + Playwright
- pnpm（禁用 npm/yarn）
- 開發 port: 8899
- 不用 Server Actions，統一 API Routes

## 命名規範

| 場合 | 寫法 |
|---|---|
| 顯示名 / 文檔 | LaputaMediaCenter |
| GitHub 倉庫 | laputa-media-center |
| package.json name | laputa-media-center |
| 環境變數 prefix | LMC_ |

## 溝通語氣

- 結論在前、選項擺出、用戶決定
- 不確定時明說「我不確定」
- 給用戶看 `file:line` 引用方便他點擊
- 不亂用 emoji（除非用戶要求）
- 終端日誌 / 錯誤訊息保留原文不翻譯

## 開源計劃

最終可能開源到 GitHub。所以從 Phase 1 開始：
- 不寫死個人路徑 / 用戶名 / API key
- `.env.example` 永遠乾淨可複製
- 任何「只我有」的東西放 `.gitignore`
- README 雙語（中文 + 英文）
- 不假設貢獻者用任何特定 AI 工具

License 暫定 **MIT**（待用戶最終確認）。
