# Laputa 内容引擎 — LaputaMediaCenter

**版本**：1.0.0（自媒體生產台 v1，2026-05-01）

LaputaMediaCenter（中文 display：Laputa 内容引擎）是面向中文自媒体创作者的内容生产系统。覆盖 6 条工具链：影片本地化、播客整理、高亮切片、多平台改写、标题与开头优化、配音 QA。普通话与粤语都跑得通。

当前可用工作流：

```text
影片本地化：  /ingest -> /dubbing -> /jobs -> QA -> sample-to-full
播客整理：    /podcast (长文/字幕 -> 双人脚本 + MiniMax 配音)
高亮切片：    /highlights (长视频 -> 30-60s 短片 + 烧录字幕)
多平台改写：  /script-rewrite (一份稿 -> YT/抖音/小红书/公众号)
标题与开头：  /title-hooks (5 个候选标题 + 开头 30s 重写)
```

旧 AI 剪辑链路已从主线下架；当前重心是上述 6 条已上线工具的稳态与开源准备。

## 技术栈

- **前端**：Next.js 16.2.4 + React 19.2 + TypeScript 5.9
- **UI**：Tailwind CSS v4.1 + 项目内 `components/ui/` 组件
- **数据库**：SQLite + better-sqlite3
- **工作流**：Next.js API Routes + `lib/workflow`
- **媒体处理**：FFmpeg、yt-dlp、Whisper CLI、本地 Python bridge scripts
- **AI / 外部工具**：Gemini 翻译凭证、MiniMax TTS、可选 Wav2Lip
- **部署**：Docker / Node.js runtime

## 快速开始

> **本地 / 开源模式**：`LICENSE_KEY` 可不设置，所有功能仍可用（health check 会标记 `mode: "local_dev"`）。
> **付费授权模式**：设置 `LICENSE_KEY` 环境变量后，health check 会校验授权状态。

### 开发环境

Windows PowerShell：

```powershell
pnpm install
pnpm db:init
pnpm dev
```

或使用项目脚本：

```powershell
.\scripts\dev.ps1
```

访问：

```text
http://localhost:8899
```

### 常用命令

```bash
pnpm install
pnpm db:init
pnpm dev
pnpm lint
pnpm test
pnpm build
```

## 环境变量

创建 `.env.local`：

```env
LICENSE_KEY=CCUT-XXXXXXXX-XXXX
DATABASE_URL=file:./data/db.sqlite

# 运行时目录。建议放在项目根目录之外，避免生成视频触发 Next.js 重编译。
# RUNTIME_DIR=C:/tmp/chuangcut
# TEMP_DIR=C:/tmp/chuangcut/temp
# OUTPUT_DIR=C:/tmp/chuangcut/output

ENCRYPTION_KEY=your-64-character-hex-encryption-key
AUTH_ENABLED=true
SESSION_SECRET=your-64-character-random-session-secret

# ingest runtime
# INGEST_FFMPEG_EXE=ffmpeg
# INGEST_YTDLP_EXE=yt-dlp
# INGEST_PYTHON_EXE=python
# INGEST_WHISPER_CLI=whisper
# INGEST_WHISPER_MODEL=base

# dubbing runtime
# DUBBING_PYTHON_EXE=python
# DUBBING_RVC_PYTHON_EXE=python
# DUBBING_SKILL_DIR=C:/path/to/dubbing/runtime
```

生成密钥：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 当前使用流程

### 1. 注册管理员账号

生产环境应设置：

```env
AUTH_ENABLED=true
```

首次访问系统会进入注册页。系统默认单用户模式，只允许注册一个管理员账号。

### 2. 配置运行时与凭证

在设置页配置：

- Gemini 翻译凭证：用于正式口语化翻译。
- MiniMax 配音凭证：用于正式 TTS；验证和保存需要显式确认，避免误触发付费调用。
- MiniMax 声线元数据：登记 `voice_id`、讲者别名、授权状态、公众人物属性和披露要求。
- Whisper / FFmpeg / yt-dlp / Wav2Lip 路径：用于本地吸收、转录、合成和可选口型同步。

### 3. 素材吸收

进入 `/ingest`，输入 YouTube URL、本地视频路径或本地音频路径。系统会：

1. 分类来源。
2. 校验本地文件或远端来源。
3. 抽音频并转录。
4. 生成 transcript Markdown / JSON / SRT。
5. 在可本地化时保留 canonical source video artifact。

### 4. 翻译配音

进入 `/dubbing`，选择来源、目标语言、翻译风格、声线和可选口型同步。提交前会显示本次将套用的长期资产，例如语言风格、修稿备注、固定读法、声线用途和披露要求。

API 创建任务时仍要求本次声线使用确认；本地 registry 的授权元数据不会自动替代单次任务确认。

### 5. 任务、质检与交付

进入 `/jobs` 查看任务状态。配音任务完成后可进入：

- `/jobs/{id}/qa`：自动质检数字、专名、节奏、讲者、交付状态和声线披露。
- `/jobs/{id}/compare`：比较版本、口播稿和已套用资产。
- `/jobs/{id}/report`：查看执行记录、产物、成本、配音上下文和交付包。

交付包包含 final video、口播稿、translations、segments、QA JSON 和 `delivery-readme.md`。公开人物或需要披露的声线会在 README、QA 和 report 中保守提示。

## 项目结构

```text
chuangcut-video-workflow/
├── app/                    # Next.js 页面和 API Routes
│   ├── api/                # ingest / dubbing / jobs / settings APIs
│   ├── ingest/             # 素材吸收工作台
│   ├── dubbing/            # 翻译配音入口
│   ├── jobs/               # 任务、QA、compare、report
│   └── settings/           # 配置与长期资产
├── components/             # React 组件
│   ├── dubbing/
│   ├── ingest/
│   ├── jobs/
│   ├── report/
│   ├── settings/
│   └── ui/
├── lib/                    # 核心业务逻辑
│   ├── db/                 # SQLite repository / manager
│   ├── dubbing/            # 声线、资产摘要、配音计划
│   ├── ingest/             # 来源分类、运行时状态、artifact
│   ├── jobs/               # job 展示、artifact contract、QA、交付包
│   └── workflow/           # workflow engine / steps / manifests
├── scripts/                # Python bridge 与运维脚本
├── tests/                  # Vitest / Playwright 测试
├── docs/agent/             # 代理与工程文档
└── data/                   # SQLite 数据目录
```

## 关键正常形

- `JobType / WorkflowId`：只把 `content_ingest` 和 `translation_dubbing` 作为当前主线。
- `WorkflowArtifactManifest`：统一 transcript、segments、translations、TTS audio、final video 的路径。
- `AppliedAssetSummary`：统一表单、QA、compare、report 的长期资产展示。
- `DubbingRunPlan`：把 `/api/dubbing` 的纯决策从 route 中抽出。
- `MiniMaxVoiceRegistryEntry`：统一声线 ID、别名、授权、公众人物属性和披露要求。
- `DeliveryPackage`：统一 final video、脚本、JSON、QA、report、compare 和交付 README。

## 安全边界

- 优先使用创作者自有声线、明确授权声线或清楚标注的 AI 旁白声线。
- 公众人物素材可用于翻译、评论、批评或明确标注的转化，不应设计成让观众误以为本人说过目标语言内容。
- 会触发付费或外部服务的验证必须显式确认。
- 运行时产物应写到项目根目录之外。

## 开发文档

- [AGENTS.md](./AGENTS.md)：当前产品方向、开发规则和代理工作约束。
- [docs/agent/architecture.md](./docs/agent/architecture.md)：架构。
- [docs/agent/workflow.md](./docs/agent/workflow.md)：工作流。
- [docs/agent/api-routes.md](./docs/agent/api-routes.md)：API Routes。
- [docs/agent/ai-integration.md](./docs/agent/ai-integration.md)：AI 与外部工具边界。
- [docs/agent/video-processing.md](./docs/agent/video-processing.md)：视频处理。
- [docs/agent/env-vars.md](./docs/agent/env-vars.md)：环境变量。
- [docs/agent/database.md](./docs/agent/database.md)：DB schema。
- [docs/agent/troubleshooting.md](./docs/agent/troubleshooting.md)：常见问题排查。
- [docs/dubbing-guide.md](./docs/dubbing-guide.md)：翻译配音用户指南。
- [CHANGELOG.md](./CHANGELOG.md)：版本变更纪录。

## License

LaputaMediaCenter v1.0.0：本地 / 开发模式 `LICENSE_KEY` 可不设置。付费授权模式参考 `app/api/health/route.ts` 与 `lib/license/`。
