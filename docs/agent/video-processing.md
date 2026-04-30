# 视频处理链路

本文档只描述当前主线：`content_ingest` 素材吸收与 `translation_dubbing` 翻译配音。

旧 AI 剪辑链路已经下架。Gemini 视频上传、分镜拆条、逐分镜处理、场景拼接等内容只作为历史归档说明，不再作为当前流程、入口或排障依据。

---

## 一、主线入口

| 入口 | Job Type | Workflow ID | 用途 |
|------|----------|-------------|------|
| `POST /api/ingest` | `content_ingest` | `content-ingest` | 接收 YouTube URL、本地视频路径、本地音频路径或普通网页视频 URL，生成转录稿和素材产物 |
| `POST /api/dubbing` | `translation_dubbing` | `translation-dubbing` | 使用本地 MP4 或素材吸收产出的原片 artifact，生成中文翻译配音成片 |
| `GET /api/ingest/status` | - | - | 返回素材吸收运行时状态 |
| `GET /api/dubbing/status` | - | - | 返回翻译配音运行时状态 |
| `GET /api/ingest/dubbing-readiness` | - | - | 返回 ingest -> dubbing 闭环就绪度，区分 runtime level 与 delivery audit readiness，并返回 provider/dry-run/cost confirmation gates |

### Provider 调用边界正常形

视频处理链路把“准备检查”“真实 provider smoke”“正式配音任务”分成三条边界：

| 边界 | 入口 | 外部/费用 | source | gate |
|------|------|-----------|--------|------|
| `dry_run_provider_smoke` | `POST /api/ingest/dubbing-readiness`, `mode="dry_run"` | 否 | 普通探测不需要；作为真实 smoke 前置证据时必须传同一 `source_url`，只保存 `source_ref` | 不传 `confirmed_gate_ids` |
| `real_provider_smoke` | 内部 API endpoint: `POST /api/ingest/dubbing-readiness`, `mode="real_provider_smoke"`；CLI 执行入口: `pnpm provider-smoke:armed-run` | 是 | 确认 ID 不是执行授权；必须通过 `provider_smoke_preflight_receipt` / `PROVIDER_SMOKE_PREFLIGHT_RECEIPT_FILE`，并提供 `job_id`、source-bound dry-run evidence、`source_url`、`manual_authorization`、paid/stress gates、预算、次数/并发上限和 NDJSON 证据 | `youtube_download`, `translation_provider`, `minimax_tts` |
| `dubbing_job` | `POST /api/dubbing` | 是 | `video_url` 或 `source_job_id + source_artifact_id` | 只允许 `translation_provider`, `minimax_tts` |

`youtube_download` 只属于 provider smoke；正式 `/api/dubbing` job 不混入 YouTube gate，不接受 `source_url` 作为配音源字段。

真实 provider smoke 不提供裸 JSON 快捷入口；必须使用动态测试文档的 armed-run SOP。前置 dry-run evidence 与每轮真实 smoke 响应都必须绑定并校验 `runtime_fingerprint` / `audit.runtime_fingerprint`；`PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE` 提供的 `manual_authorization` 必须绑定确认人、确认时间、同一 `job_id`、同一 `source_ref`、runs/concurrency/budget 和固定确认项。进入付费 armed run 前先用 `pnpm provider-smoke:readiness:bundle` 汇总 redacted readiness；该报告只做 no-network 审查，不授权真实 provider 调用。

### 来源分类

`/api/ingest` 使用 `lib/ingest/source-classifier.ts` 识别来源：

| 来源类型 | 输入示例 | 处理策略 |
|----------|----------|----------|
| `youtube` | `https://youtube.com/...`、`https://youtu.be/...` | `yt-dlp` 读取视频或音频，再交给 `ffmpeg` 与 Whisper |
| `web_video` | 普通 HTTP(S) 视频页或直链 | `yt-dlp` 下载或抽取音频 |
| `local_video` | `C:\media\clip.mp4` | 校验本地文件存在，用 `ffmpeg` 抽音频；本地化目标会保留 `source_video.mp4` |
| `local_audio` | `C:\media\voice.wav` | 用 `ffmpeg` 规范化为 Whisper 可读 WAV |
| `unknown` | 无法识别 | 拒绝创建任务 |

`/api/dubbing` 当前只接受已准备好的本地 `.mp4`。远程视频、YouTube 和非 MP4 本地视频应先走 `/api/ingest`，并把 `ingest_goal` 设置为 `localize`，再用 `ingest.source_video` artifact 创建配音任务。

---

## 二、素材吸收链路

**Workflow**: `lib/workflow/workflows/content-ingest.ts`

```text
inspect_source -> transcribe_media -> build_content_brief
```

### 2.1 来源检查

**Step**: `inspect_source`

**关键文件**:
- `lib/workflow/steps/ingest/inspect-source.ts`
- `lib/ingest/source-classifier.ts`

**职责**:
1. 读取任务输入中的第一个素材来源。
2. 确认来源类型、输入模式和处理策略。
3. 对本地文件做存在性校验。
4. 产出后续转录步骤可读的结构化来源信息。

### 2.2 抽取音频与转录

**Step**: `transcribe_media`

**关键文件**:
- `lib/workflow/steps/ingest/transcribe-media.ts`
- `lib/ingest/runner.ts`
- `lib/ingest/runtime.ts`

**处理方式**:
1. `local_video`: 使用 `ffmpeg` 从原片抽出 `source.wav`；当 `ingest_goal=localize` 时，把原片复制或转码为 `source_video.mp4`。
2. `local_audio`: 使用 `ffmpeg` 规范化为单声道、16 kHz 的 `source.wav`。
3. `youtube` / `web_video`: 使用 `yt-dlp` 下载或抽音频；本地化目标会尽量生成标准 `source_video.mp4`。
4. 调用 Whisper CLI 或 `python -m whisper` 生成全文、分段时间码和字幕。
5. 写出 Markdown、JSON、SRT、音频和可选原片 artifact。

**输出目录**:

```text
OUTPUT_DIR/ingest/{jobId}/
├── transcript.md
├── transcript.json
├── transcript.srt
├── source.wav
└── source_video.mp4    # 仅本地化目标且原片可用时生成
```

### 2.3 素材简报

**Step**: `build_content_brief`

**关键文件**:
- `lib/workflow/steps/ingest/build-content-brief.ts`
- `lib/ingest/dubbing-content-brief.ts`

**职责**:
1. 读取转录文本、时间码和来源信息。
2. 生成后续播客、短视频、本地化或人工审稿可复用的素材摘要。
3. 为 ingest -> dubbing handoff 提供原片、语言和处理目标提示。

### 2.4 Manifest 正常形

素材吸收的产物优先写入 `WorkflowArtifactManifest`，路径定义集中在 `lib/jobs/workflow-artifact-manifest.ts`。

| Artifact ID | 文件 | 说明 |
|-------------|------|------|
| `ingest.transcript_markdown` | `transcript.md` | 给创作者阅读和复用的转录稿 |
| `ingest.transcript_json` | `transcript.json` | 结构化全文与时间码 |
| `ingest.transcript_srt` | `transcript.srt` | 字幕文件，有分段时生成 |
| `ingest.source_audio` | `source.wav` | 规范化音频 |
| `ingest.source_video` | `source_video.mp4` | 本地化配音可用原片 |

工作台、产物下载和配音交接都应优先读取 manifest。旧的 `artifact_urls`、`video_path`、`dubbing_source` 只作为没有 manifest 时的兼容回退。

---

## 三、翻译配音链路

**Workflow**: `lib/workflow/workflows/translation-dubbing.ts`

```text
resolve_dubbing_source
  -> asr_transcribe
  -> translate_text
  -> voice_clone_generate
  -> lipsync_process
  -> compose_final
  -> publish_final_video
```

### 3.1 配音源准备

**Step**: `resolve_dubbing_source`

**关键文件**:
- `lib/workflow/steps/dubbing/resolve-dubbing-source.ts`
- `lib/dubbing/video-source.ts`

**职责**:
1. 校验输入是可访问的本地 `.mp4`。
2. 读取媒体元数据。
3. 写回 `job_videos.local_path` 与批量 metadata。

如果来源来自素材吸收任务，`/api/dubbing` 会先确认：
- 来源任务是已完成的 `content_ingest`。
- 来源任务的 `ingest_goal` 是 `localize`。
- artifact 是 `ingest.source_video`。
- 当前调用方有权限使用该来源任务。

### 3.2 ASR 语音识别

**Step**: `asr_transcribe`

**关键文件**:
- `lib/workflow/steps/dubbing/whisper-asr.ts`
- `scripts/whisper_asr.py`

**流程**:
1. 读取本地视频或 sample 截取文件。
2. 调用 `whisper_asr.py`。
3. 传入 `source_language` 和 `whisper_model`。
4. 输出 `segments.json`。

Manifest 写入：

| Artifact ID | 文件 |
|-------------|------|
| `dubbing.segments` | `segments.json` |

### 3.3 文本翻译

**Step**: `translate_text`

**关键文件**:
- `lib/workflow/steps/dubbing/translate-text.ts`
- `scripts/translator.py`
- `lib/dubbing/translation-credentials.ts`

**流程**:
1. 读取 `segments.json`。
2. 根据 `source_language`、`target_language`、`translation_style`、长期词库和创作者上下文生成口播译文。
3. 正式本地化必须配置 Gemini 翻译凭证；没有凭证时会失败并停止创建/执行任务。
   只有显式设置 `DUBBING_ALLOW_PASSTHROUGH_TRANSLATION=true` 时，才允许原文占位 smoke。
4. 输出 `translations.json`。

Manifest 写入：

| Artifact ID | 文件 |
|-------------|------|
| `dubbing.translations` | `translations.json` |
| `dubbing.script` | `script.txt` 派生产物 |

### 3.4 MiniMax TTS

**Step**: `voice_clone_generate`

**关键文件**:
- `lib/workflow/steps/dubbing/minimax-tts.ts`
- `scripts/voice_cloner.py`
- `lib/dubbing/minimax-credentials.ts`

**流程**:
1. `/api/dubbing` 要求 `config.usage_boundary_acknowledged=true`；历史 `config.voice_usage_confirmed=true` 仅作为兼容 fallback 读取。
2. 真实翻译或 MiniMax TTS 会调用外部 provider 时，`/api/dubbing` 要求 `config.confirmed_gate_ids` 覆盖 `translation_provider` 与 `minimax_tts`。
3. 读取 `translations.json`。
4. 使用 MiniMax `voice_id`、可选第二声线、讲者模式和语速配置生成目标语言音频。
5. 输出到 `tts_audio/`。

默认正式配音必须配置 MiniMax 凭证。只有 `DUBBING_ALLOW_PLACEHOLDER_TTS=true` 时，才允许使用占位方式做 smoke。
当 `confirmed_gate_ids` 包含 `minimax_tts` 时，`voice_cloner.py` 必须写出真实 MiniMax provider proof；如果 MiniMax 失败后降级为静音占位，任务会失败而不是被算作真实 TTS 成功。

Manifest 写入：

| Artifact ID | 文件 |
|-------------|------|
| `dubbing.tts_audio` | `tts_audio/` 与其中音频文件 |

### 3.5 可选口型同步

**Step**: `lipsync_process`

**关键文件**:
- `lib/workflow/steps/dubbing/wav2lip-lipsync.ts`
- Wav2Lip `inference.py`

**流程**:
1. `lipsync_mode=none` 时跳过。
2. `lipsync_mode=wav2lip` 时，逐段把原片画面与 TTS 音频送入 Wav2Lip。
3. 输出到 `lipsync_scenes/`。

Wav2Lip 是可选增强链路。缺失时仍可生成配音成片，但不会做口型同步。

### 3.6 合成与发布

**Steps**:
- `compose_final`
- `publish_final_video`

**关键文件**:
- `lib/workflow/steps/dubbing/compose-final.ts`
- `lib/workflow/steps/dubbing/publish-final-video.ts`
- `scripts/compose_dub.py`

**流程**:
1. 有 Wav2Lip 场景时使用 `lipsync_scenes/`；否则使用 `tts_audio/`。
2. 调用 `compose_dub.py` 合成配音视频。
3. 先写出 `OUTPUT_DIR/{jobId}_dubbed.mp4`。
4. `publish_final_video` 再把最终产物稳定落到任务 final path，供下载、QA、报告和 delivery package 读取。

Manifest 写入：

| Artifact ID | 文件 |
|-------------|------|
| `final_video` | `final.mp4` 或 `final_with_bgm.mp4` |

---

## 四、运行时目录

运行时文件应尽量放在项目根目录外，避免 Next.js 监听生成视频后反复重编译。

| 变量 | 用途 |
|------|------|
| `RUNTIME_DIR` | 运行时数据根目录 |
| `TEMP_DIR` | 临时目录，包含任务执行中间文件 |
| `OUTPUT_DIR` | 输出目录，包含 ingest artifact 与最终成片 |

默认开发环境会倾向使用系统临时目录。生产环境建议显式配置到持久化数据盘。

---

## 五、关键环境变量

### 素材吸收

| 变量 | 说明 |
|------|------|
| `INGEST_FFMPEG_EXE` | `ffmpeg` 路径；未设置时可复用 `DUBBING_FFMPEG_EXE` 或 PATH |
| `INGEST_YTDLP_EXE` | `yt-dlp` 路径 |
| `INGEST_PYTHON_EXE` | Whisper Python 路径；未设置时可复用 `DUBBING_PYTHON_EXE` |
| `INGEST_WHISPER_CLI` | Whisper CLI 命令 |
| `INGEST_WHISPER_MODEL` | 素材吸收默认 Whisper 模型；未设置时可复用 `DUBBING_WHISPER_MODEL` |
| `INGEST_YTDLP_COOKIES` | YouTube cookies.txt 路径 |
| `INGEST_YTDLP_COOKIES_FROM_BROWSER` | 从浏览器读取 cookies，例如 `edge` 或 `chrome` |
| `INGEST_YTDLP_JS_RUNTIME` | `yt-dlp` JS runtime；默认尝试使用当前 Node |

### 翻译配音

| 变量 | 说明 |
|------|------|
| `DUBBING_SKILL_DIR` | 外部增强配音 skill 目录 |
| `DUBBING_PYTHON_EXE` | ASR、翻译、TTS、合成脚本的 Python |
| `DUBBING_RVC_PYTHON_EXE` | Wav2Lip / RVC 类脚本 Python |
| `DUBBING_FFMPEG_EXE` | 配音链路可复用的 `ffmpeg` |
| `DUBBING_SCRIPT_ARG_MODE` | Python 参数兼容模式：`detect`、`legacy`、`strict`、`force` |
| `GEMINI_API_KEY` / `GOOGLE_AI_STUDIO_API_KEY` | 当前主线翻译凭证 |
| `GEMINI_MODEL_ID` | 翻译模型 |
| `GEMINI_API_BASE_URL` / `GOOGLE_AI_STUDIO_API_BASE_URL` | 可选翻译 API base URL |
| `MINIMAX_API_KEY` | MiniMax TTS 凭证 |
| `MINIMAX_VERIFICATION_VOICE_ID` / `MINIMAX_DEFAULT_VOICE_ID` | MiniMax 凭证验证用 voice id；`MINIMAX_DEFAULT_VOICE_ID` 仅为旧兼容别名 |
| `DUBBING_ALLOW_PLACEHOLDER_TTS` | 允许无 MiniMax 时做占位 smoke |

---

## 六、排障速查

| 现象 | 优先检查 |
|------|----------|
| YouTube 读取失败，提示登录或机器人验证 | 配置 `INGEST_YTDLP_COOKIES` 或 `INGEST_YTDLP_COOKIES_FROM_BROWSER` |
| 本地视频不能进入配音 | `/api/dubbing` 只接受本地 `.mp4`；其他格式先走 `/api/ingest` 本地化吸收 |
| Whisper 未生成转录 | 检查 `INGEST_PYTHON_EXE`、`INGEST_WHISPER_CLI`、`INGEST_WHISPER_MODEL` 和 `ffmpeg` |
| 正式配音任务被拒绝 | 检查 MiniMax 凭证；无凭证时除非开启 `DUBBING_ALLOW_PLACEHOLDER_TTS`，否则不会创建任务 |
| 翻译结果像占位或未本地化 | 检查 Gemini 翻译凭证、目标语言、长期词库和创作者上下文 |
| Wav2Lip 没有生效 | 检查 `lipsync_mode`、`DUBBING_RVC_PYTHON_EXE`、Wav2Lip `inference.py` 和 checkpoint |
| 下载页找不到成片 | 优先查 manifest 的 `final_video`，再查 state 中的 `final_video_local_path` 兼容字段 |
| 开发环境 CPU 飙升 | 确认 `TEMP_DIR`、`OUTPUT_DIR` 不在项目 watched 目录内 |

---

## 七、当前文件索引

| 链路 | 关键文件 |
|------|----------|
| 来源分类 | `lib/ingest/source-classifier.ts` |
| 素材吸收 API | `app/api/ingest/route.ts` |
| 素材吸收状态 | `app/api/ingest/status/route.ts` |
| 闭环就绪度 | `app/api/ingest/dubbing-readiness/route.ts` |
| 素材吸收 workflow | `lib/workflow/workflows/content-ingest.ts` |
| ingest steps | `lib/workflow/steps/ingest/` |
| ingest runtime | `lib/ingest/runtime.ts`、`lib/ingest/runtime-status.ts` |
| ingest runner | `lib/ingest/runner.ts` |
| 配音 API | `app/api/dubbing/route.ts` |
| 配音状态 | `app/api/dubbing/status/route.ts` |
| 配音 workflow | `lib/workflow/workflows/translation-dubbing.ts` |
| dubbing steps | `lib/workflow/steps/dubbing/` |
| dubbing runtime | `lib/dubbing/runtime.ts`、`lib/dubbing/runtime-status.ts` |
| artifact manifest | `lib/jobs/workflow-artifact-manifest.ts` |
| artifact 下载契约 | `lib/jobs/job-artifact-contract.ts`、`lib/jobs/job-artifacts.ts` |
| QA | `lib/jobs/dubbing-qa.ts`、`lib/jobs/dubbing-qa-persistence.ts` |
| Python bridge | `scripts/whisper_asr.py`、`scripts/translator.py`、`scripts/voice_cloner.py`、`scripts/compose_dub.py` |

---

## 八、历史归档：旧 AI 剪辑链路

以下能力属于旧剪辑系统，不再是当前主线：

- Gemini 视频上传到 GCS 或 File API 后做视频分析。
- Gemini 生成 storyboard / 分镜脚本。
- 按分镜时间戳执行 FFmpeg 拆条。
- Fish Audio 或多轮旁白优化为每个分镜生成多版旁白。
- `process_scene_loop` 对每个分镜调速、换音轨、合成。
- `concatenate_scenes` 拼接所有分镜并混 BGM。
- `/api/jobs` 使用 `style_id + storyboard_count` 创建剪辑任务。

历史任务日志中仍可能出现 `prepare_gemini`、`gemini_analysis`、`batch_generate_narrations`、`process_scene_loop` 等旧 step 名称。它们只用于读取旧任务或展示历史日志，不能作为新任务创建、排障或产品说明的依据。
