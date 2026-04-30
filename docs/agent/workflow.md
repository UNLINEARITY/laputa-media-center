# 工作流引擎

核心文件：`lib/workflow/engine.ts`

当前只保留两个主线 workflow：

- `content_ingest`
- `translation_dubbing`

旧 `single-video` / `multi-video` AI 剪辑 workflow 已下架，相关 step 不再注册。

## content_ingest

文件：`lib/workflow/workflows/content-ingest.ts`

| Stage | Step | 文件 | 说明 |
| --- | --- | --- | --- |
| `ingest` | `inspect_source` | `steps/ingest/inspect-source.ts` | 识别 YouTube、本地视频、本地音频来源并校验输入 |
| `transcribe` | `transcribe_media` | `steps/ingest/transcribe-media.ts` | 抽取音频，调用 Whisper CLI，输出 Markdown、JSON、SRT、WAV |
| `package` | `build_content_brief` | `steps/ingest/build-content-brief.ts` | 生成结构化内容摘要和后续处理计划 |

转写产物写入 `OUTPUT_DIR/ingest/{jobId}/`，工作台通过 `transcribe_media` 的 step output 读取 artifact 链接。

## translation_dubbing

文件：`lib/workflow/workflows/translation-dubbing.ts`

| Stage | Step | 文件 | 说明 |
| --- | --- | --- | --- |
| `asr` | `resolve_dubbing_source` | `steps/dubbing/resolve-dubbing-source.ts` | 确认本地配音源并写入媒体元数据 |
| `asr` | `asr_transcribe` | `steps/dubbing/whisper-asr.ts` | ASR 转写，sample mode 时生成样片输入 |
| `translate` | `translate_text` | `steps/dubbing/translate-text.ts` | 按目标语言、长期资产、固定读法翻译 |
| `voiceclone` | `voice_clone_generate` | `steps/dubbing/minimax-tts.ts` | 生成目标语言配音 |
| `lipsync` | `lipsync_process` | `steps/dubbing/wav2lip-lipsync.ts` | 可选口型同步 |
| `compose` | `compose_final` | `steps/dubbing/compose-final.ts` | 合成配音成片 |
| `compose` | `publish_final_video` | `steps/dubbing/publish-final-video.ts` | 将最终成片稳定发布到任务目录 |

`translation_dubbing` 不再依赖旧 `fetch_metadata` 或 `download` step。

## 状态持久化

运行时状态由 `lib/workflow/state/` 维护：

| 模块 | 职责 |
| --- | --- |
| `context-manager.ts` | 创建 workflow context |
| `step-manager.ts` | 更新当前 stage/sub step 和历史记录 |
| `data-persistence.ts` | 将主线 step 输出写入 `WorkflowArtifactManifest`，并同步保存最终视频状态 |
| `lifecycle-manager.ts` | 任务生命周期和失败状态 |

`data-persistence.ts` 会把 `content_ingest` 的转录稿、字幕、源音频、可复用原片，以及 `translation_dubbing` 的 segments、translations、TTS 音频和最终视频写入 manifest。其他 step 的完整输出仍写入 `job_step_history`。

## 历史兼容

`step-definitions.ts` 和 `step-registry.ts` 保留部分旧 step 字符串，用于历史任务显示和日志翻译。这些字符串不是可执行 step 注册表。

可执行 step 的唯一注册入口是 `lib/workflow/steps/index.ts`，目前只注册 ingest 与 dubbing 主线步骤。
