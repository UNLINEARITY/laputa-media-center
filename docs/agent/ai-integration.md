# AI 集成

本文档描述当前主线的 AI 与外部运行时边界：ASR、翻译、TTS、可选口型同步、QA 和运行时状态。旧 Gemini 视频分析、Fish Audio 分镜旁白、多轮旁白优化和分镜处理只属于历史剪辑链路，不再是主线数据流。

---

## 一、当前核心边界

| 能力 | 主线入口 | 类型 | 当前职责 |
|------|----------|------|----------|
| 来源分类 | `lib/ingest/source-classifier.ts` | 本地规则 | 识别 YouTube、本地视频、本地音频、网页视频 |
| 素材抽取 | `lib/ingest/runner.ts` | 本地工具 | 调用 `ffmpeg` / `yt-dlp` 准备音频和可选原片 |
| Ingest ASR | Whisper CLI / `python -m whisper` | 本地或 Python AI | 为素材吸收生成转录稿、时间码和字幕 |
| Dubbing ASR | `scripts/whisper_asr.py` | Python AI | 为配音链路生成 `segments.json` |
| 翻译 | `scripts/translator.py` | 云端 AI 或脚本模式 | 生成中文口播译文，当前正式凭证来自 Gemini / AI Studio |
| TTS | `scripts/voice_cloner.py` + MiniMax | 云端 AI | 按自有或有本地授权记录的声线生成普通话 / 粤语配音音频 |
| 口型同步 | Wav2Lip `inference.py` | 本地 Python AI | 可选，把 TTS 音频与画面对齐 |
| 合成 | `scripts/compose_dub.py` + FFmpeg | 本地媒体 | 合成并发布最终配音视频 |
| QA | `lib/jobs/dubbing-qa.ts` | 本地规则 | 检查 artifact、段落对齐、词库、数字、节奏、声线与交付 |

当前主线的云端 AI 依赖集中在翻译凭证和 MiniMax TTS。Gemini 不再负责视频上传、分镜识别或多轮旁白优化。

---

## 二、主线数据流

### 2.1 素材吸收

```text
/api/ingest
  -> classifyIngestSource()
  -> inspect_source
  -> ffmpeg / yt-dlp 准备 source.wav 和可选 source_video.mp4
  -> Whisper 生成 transcript.md / transcript.json / transcript.srt
  -> build_content_brief
  -> WorkflowArtifactManifest 写入 ingest.* artifacts
```

关键产物：

| Artifact ID | 说明 |
|-------------|------|
| `ingest.transcript_markdown` | 创作者可读转录稿 |
| `ingest.transcript_json` | 结构化转录和时间码 |
| `ingest.transcript_srt` | 字幕 |
| `ingest.source_audio` | 规范化音频 |
| `ingest.source_video` | 可交给配音链路的 MP4 原片 |

### 2.2 翻译配音

```text
/api/dubbing
  -> usage_boundary_acknowledged 校验
  -> resolve_dubbing_source
  -> whisper_asr.py 生成 segments.json
  -> translator.py 生成 translations.json
  -> voice_cloner.py / MiniMax 生成 tts_audio/
  -> Wav2Lip inference.py 可选口型同步
  -> compose_dub.py 合成
  -> publish_final_video
  -> WorkflowArtifactManifest 写入 dubbing.* 和 final_video
```

关键产物：

| Artifact ID | 说明 |
|-------------|------|
| `dubbing.segments` | 原文 ASR 分段 |
| `dubbing.translations` | 目标语言口播稿 |
| `dubbing.script` | 派生脚本 |
| `dubbing.tts_audio` | MiniMax 生成音频集合 |
| `final_video` | 可下载、QA、报告和交付包读取的最终成片 |

---

## 三、凭证与运行时状态

### 3.1 翻译凭证

**关键文件**:
- `lib/dubbing/translation-credentials.ts`
- `scripts/translator.py`

优先级：
1. `GEMINI_API_KEY`
2. `GOOGLE_AI_STUDIO_API_KEY`
3. `/settings` 中保存的 `google_ai_studio` 凭证

可选模型与 base URL：
- `GEMINI_MODEL_ID`
- `GEMINI_API_BASE_URL`
- `GOOGLE_AI_STUDIO_API_BASE_URL`

当前 Gemini 凭证用于翻译脚本，不代表重新启用 Gemini 视频分析链路。

### 3.2 MiniMax TTS 凭证

**关键文件**:
- `lib/dubbing/minimax-credentials.ts`
- `lib/workflow/steps/dubbing/minimax-tts.ts`

优先级：
1. `MINIMAX_API_KEY`
2. `/settings` 中保存的 `minimax_tts` 凭证
3. `config/minimax.json`

可选验证声线：
- `MINIMAX_VERIFICATION_VOICE_ID`
- `MINIMAX_DEFAULT_VOICE_ID`（旧兼容别名）

该 voice id 只用于 MiniMax 凭证付费验证或 smoke 验证；正式配音声线由请求、声线注册表和创作者默认声线决定。

没有 MiniMax 凭证时，正式配音任务会被拒绝。只有 `DUBBING_ALLOW_PLACEHOLDER_TTS=true` 时才允许占位 smoke。

### 3.3 运行时状态 API

| API | 实现 | 返回重点 |
|-----|------|----------|
| `GET /api/ingest/status` | `lib/ingest/runtime-status.ts` | Whisper、ffmpeg、yt-dlp、YouTube cookies |
| `GET /api/dubbing/status` | `lib/dubbing/runtime-status.ts` | Python 脚本、Gemini 翻译凭证、`translation_credential_status.runtime`、MiniMax、Wav2Lip、RVC Python |
| `GET /api/ingest/dubbing-readiness` | `lib/workflow/closed-loop-readiness.ts` | YouTube -> ingest -> dubbing -> lipsync 闭环是否可跑；同时区分 `runtime_readiness_level` 和 `delivery_audit`，`provider_gates[]` 标记 real/dry-run/blocked、外部调用、可能费用和所需确认 |

状态 API 会隐藏本地路径，只暴露是否存在、是否必需、缺失项和下一步建议。
`translation_credential_status.runtime` 只暴露 Gemini 翻译运行时来源摘要：`api_key_source`、`model_id`、`model_source`、`api_base_url_configured`、`api_base_url_source`，不会返回 API key。`/ingest` readiness 和 `/dubbing` 真实 provider 确认区都应复用这套摘要，让用户在确认可能付费的翻译 provider 前看到模型与 Base URL 来源。

`production_ready` 只表示真实运行链路完整，不代表交付包已经审计完成。`/api/ingest/dubbing-readiness` 的 `delivery_audit_ready` / `delivery_audit` 是环境级交付审计前置检查，只说明声线用途和披露元数据是否足够进入正式交付检查；声线用途或披露元数据缺失时，运行链路仍可跑，但环境审计保持 warning。已完成任务的正式交付判断必须看 `deliveryPackage.deliveryAuditReadiness`，它才会检查 `final_video`、`delivery_readme`、`qa_json` 和 `voice_disclosure` 等 job artifact。

---

## 四、Python Bridge

当前主线使用最小 Python bridge，外部增强 skill 可通过 `DUBBING_SKILL_DIR` 接入。

| 脚本 | 当前调用者 | 职责 |
|------|------------|------|
| `scripts/whisper_asr.py` | `asr_transcribe` | 视频转 ASR 分段 |
| `scripts/translator.py` | `translate_text` | 原文分段翻译为目标语言口播稿 |
| `scripts/voice_cloner.py` | `voice_clone_generate` | 调 MiniMax 生成音频 |
| `scripts/compose_dub.py` | `compose_final` | 合成配音成片 |
| Wav2Lip `inference.py` | `lipsync_process` | 可选口型同步 |

脚本查找顺序集中在 `lib/dubbing/runtime.ts`：
1. 项目内 `skills/` 或 `scripts/`
2. `DUBBING_SKILL_DIR`
3. 约定的外部 skill Python 目录

语言参数由 `lib/dubbing/script-args.ts` 控制。默认 `DUBBING_SCRIPT_ARG_MODE=detect`，只传脚本看起来支持的参数；`strict` 用于集成检查，`legacy` 用于旧脚本兼容，`force` 用于强制传新参数。

---

## 五、FFmpeg 与本地媒体处理

FFmpeg 不再承担旧分镜拆条和逐分镜调速主流程。当前职责是：

| 场景 | 调用位置 | 用途 |
|------|----------|------|
| 素材吸收 | `lib/ingest/runner.ts` | 抽取 `source.wav`、规范化本地视频、从远程视频提取音频 |
| 配音源准备 | `resolve_dubbing_source` | 读取视频时长、分辨率、帧率等 metadata |
| sample 模式 | `whisper-asr.ts` | 截取样片 |
| 合成发布 | `compose_dub.py` / `publish_final_video` | 输出最终视频并写入稳定路径 |

运行时路径：
- `INGEST_FFMPEG_EXE`
- `DUBBING_FFMPEG_EXE`
- PATH 中的 `ffmpeg`

---

## 六、QA 边界

**关键文件**:
- `lib/jobs/dubbing-qa.ts`
- `lib/jobs/dubbing-qa-persistence.ts`
- `lib/jobs/dubbing-qa-summary.ts`

QA 读取 `segments.json`、`translations.json` 和 job config，主要检查：
- 关键 artifact 是否存在。
- 原文段落和翻译段落是否对齐。
- 长期词库是否命中。
- 中文数字、年份和读法是否适合口播。
- 口播节奏是否过密。
- 粤语自然度。
- 多讲者是否需要第二声线。
- 创作者上下文和长期资产是否充足。
- 最终成片是否可交付。

任务完成后，workflow engine 会尝试自动生成并持久化 QA 摘要。手动 QA 可通过 jobs QA API 读取同一套逻辑。

---

## 七、错误处理与重试

| 层级 | 当前行为 |
|------|----------|
| API 输入 | `zod` 校验来源、语言、口型模式、声线使用边界等字段 |
| 来源校验 | 本地文件不存在、非 `.mp4` 配音源、非法 ingest artifact 会被拒绝 |
| 运行时缺失 | status/readiness API 返回缺失项；任务步骤失败时记录 stderr 摘要 |
| Workflow step | engine 按步骤 retry policy 重试可重试错误 |
| Artifact 查找 | 优先读取 `WorkflowArtifactManifest`，没有 manifest 时才走旧路径回退 |
| 完成后 QA | QA 摘要失败不会阻断任务完成，但会写 warning 日志 |

常见配置错误应优先看：
- `/api/ingest/status`
- `/api/dubbing/status`
- `/api/ingest/dubbing-readiness`
- job step history 的 input/output/stderr 摘要

---

## 八、主线配置速查

### 素材吸收

```bash
INGEST_FFMPEG_EXE=
INGEST_YTDLP_EXE=
INGEST_PYTHON_EXE=
INGEST_WHISPER_CLI=
INGEST_WHISPER_MODEL=
INGEST_YTDLP_COOKIES=
INGEST_YTDLP_COOKIES_FROM_BROWSER=
INGEST_YTDLP_JS_RUNTIME=
```

### 翻译配音

```bash
DUBBING_SKILL_DIR=
DUBBING_PYTHON_EXE=
DUBBING_RVC_PYTHON_EXE=
DUBBING_FFMPEG_EXE=
DUBBING_SCRIPT_ARG_MODE=detect

GEMINI_API_KEY=
GOOGLE_AI_STUDIO_API_KEY=
GEMINI_MODEL_ID=
GEMINI_API_BASE_URL=
GOOGLE_AI_STUDIO_API_BASE_URL=

MINIMAX_API_KEY=
MINIMAX_VERIFICATION_VOICE_ID=
# MINIMAX_DEFAULT_VOICE_ID=  # 旧兼容别名，不作为正式配音默认声线
DUBBING_ALLOW_PLACEHOLDER_TTS=false
```

### 运行时目录

```bash
RUNTIME_DIR=
TEMP_DIR=
OUTPUT_DIR=
```

生成视频和中间文件应放在项目根目录外，避免 Next.js dev server 监听输出目录后重复重编译。

---

## 九、历史归档：非主线兼容项

以下模块或概念可能仍出现在历史版本记录、旧任务日志或兼容配置中，但不是当前主线依赖：

- 旧 Gemini 视频分析、File API、GCS URI、多视频标签、storyboard 解析和多轮旁白优化 client API 已从运行时代码移除。
- `lib/ai/tts` 中的 Fish Audio / Edge TTS 多提供商管理。
- `style_id`、`storyboard_count`、剪辑风格、分镜数量。
- `prepare_gemini`、`gemini_analysis`、`batch_generate_narrations`、`process_scene_loop`、`concatenate_scenes` 等旧 step 名称。

保留这些说明只是为了读懂历史任务和迁移残留。新增功能、排障文档和产品主流程应围绕 `content_ingest`、`translation_dubbing`、`WorkflowArtifactManifest`、MiniMax TTS 和当前 QA 正常形展开。
