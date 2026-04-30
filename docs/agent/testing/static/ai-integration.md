# 主动静态审查 - AI 与外部运行时集成

> 分析目标：通过阅读代码发现 Whisper、translator、MiniMax、dubbing runtime、FFmpeg、yt-dlp 与主线 artifact/资产 normal form 之间的潜在问题。
> 涉及范围：`lib/workflow/steps/ingest/`、`lib/workflow/steps/dubbing/`、`lib/media/`、`lib/dubbing/`、`scripts/`、相关 API route 与环境变量读取。
> 优先级：P0（核心功能）
> 预计耗时：80 分钟

---

## 测试目的

核心目标：确保外部 AI 与媒体工具只服务当前 `content_ingest` 和 `translation_dubbing` 主线，并把产物、错误、凭据、声线使用边界确认、样片到全片复用写回统一 normal form。

具体要求：

1. 全面分析 Whisper/ASR、translator、MiniMax TTS、可选 lip sync、FFmpeg、yt-dlp、外部 dubbing skill bridge、长期资产与 artifact manifest。
2. 按 P0（致命）、P1（严重）、P2（中等）、P3（轻微）分类问题。
3. 修复建议必须优先复用 `WorkflowArtifactManifest`、`DubbingRunPlan`、`AppliedAssetSummary` 和现有 runtime bridge。
4. 旧 Gemini 视频分析、Fish Audio 旁白、分镜拆条、旧 single/multi-video 只能作为负向检查，不得作为成功路径。

修复原则：

- 外部工具失败必须返回可诊断错误，不吞掉 stderr、退出码或关键上下文。
- API key、voice id、声线授权记录、临时路径不得在日志中泄露完整敏感信息。
- 真实配音任务必须保留 声线使用边界确认，不得由 runtime 默认放行。
- 所有主线产物优先写入或读取 `WorkflowArtifactManifest`。
- sample-to-full、compare、report、long-term assets 不应绕过 `DubbingRunPlan` 和 `AppliedAssetSummary` 自行拼规则。

---

## 一、Primitive / Normal Form 视图

### 1.1 当前原语

| 原语 | 代码位置 | 静态审查重点 |
| --- | --- | --- |
| Whisper / ASR runtime | `steps/ingest/transcribe-media.ts`、`steps/dubbing/whisper-asr.ts`、`scripts/whisper_asr.py` | 模型、语言参数、segments 输出、超时、stderr |
| Translator runtime | `steps/dubbing/translate-text.ts`、`scripts/translator.py` | 目标语言、翻译风格、术语表、时间轴保持 |
| MiniMax TTS runtime | `steps/dubbing/minimax-tts.ts`、`lib/dubbing/minimax-credentials.ts` | voice id、双声线、speech speed、凭据脱敏、音频集合输出 |
| Dubbing bridge | `scripts/voice_cloner.py`、`scripts/compose_dub.py`、外部 `DUBBING_SKILL_DIR` | 外部技能优先、fallback 脚本、语言参数兼容 |
| Lip sync runtime | `steps/dubbing/wav2lip-lipsync.ts`、Wav2Lip `inference.py` | 可选执行、失败语义、输入输出路径 |
| FFmpeg / yt-dlp | `lib/media/ffmpeg-service.ts`、ingest/dubbing source steps | 下载、抽音频、转 WAV、合成、路径安全 |
| `DubbingRunPlan` | `lib/dubbing/dubbing-run-plan.ts` | 创建前的运行配置、样片模式、声线使用边界确认 |
| `WorkflowArtifactManifest` | `lib/jobs/workflow-artifact-manifest.ts` | transcript、segments、translations、script、TTS audio、final video 的权威索引 |
| `AppliedAssetSummary` | `lib/dubbing/applied-asset-summary.ts` | 长期声线、语言风格、术语表、QA 修稿摘要的统一展示 |

### 1.2 Normal form 不变量

1. AI/runtime 集成不再以 Gemini/Fish/分镜为主线；这些引用只能是历史兼容或清理对象。
2. ingest 转录输出必须落到 `ingest.transcript_markdown/json/srt` 和 `ingest.source_audio`，本地化视频成功时才落到 `ingest.source_video`。
3. dubbing ASR、翻译、TTS、合成输出必须落到 `dubbing.segments`、`dubbing.translations`、`dubbing.script`、`dubbing.tts_audio`、`final_video`。
4. runtime 参数从 `DubbingRunPlan.config` 或 ingest config 来，不从旧 style/storyboard context 来。
5. `DUBBING_SCRIPT_ARG_MODE=detect` 是默认安全路径；`legacy/strict/force` 的语义必须清晰。
6. 声线使用边界确认 是 API/UI 到 runtime 的硬边界，不能被脚本 fallback 绕过。
7. sample-to-full 复用样片资产时，运行时只复用已验证快照，不重新猜测声线、术语表或语言风格。
8. compare/report/long-term assets 读取同一份产物和资产摘要，不另建 Gemini/Fish 成本或分镜指标。

---

## 二、模块概述

AI 与外部运行时集成负责：

- `content_ingest`：下载或读取来源、抽取音频、调用 Whisper、生成 transcript artifact。
- `translation_dubbing`：解析来源、ASR、翻译、MiniMax TTS、可选 Wav2Lip、FFmpeg 合成、发布 final video。
- 管理外部脚本和环境变量：`DUBBING_SKILL_DIR`、`DUBBING_PYTHON_EXE`、`DUBBING_RVC_PYTHON_EXE`、`DUBBING_SCRIPT_ARG_MODE`、`INGEST_FFMPEG_EXE`、`INGEST_YTDLP_EXE`、`INGEST_PYTHON_EXE`、`INGEST_WHISPER_CLI`、`INGEST_WHISPER_MODEL`。
- 将所有产物回写 `WorkflowArtifactManifest`，供 QA、下载、delivery package、compare、report 复用。

当前结构：

```text
lib/workflow/steps/
├── ingest/
│   ├── inspect-source.ts
│   ├── transcribe-media.ts
│   └── build-content-brief.ts
└── dubbing/
    ├── resolve-dubbing-source.ts
    ├── whisper-asr.ts
    ├── translate-text.ts
    ├── minimax-tts.ts
    ├── wav2lip-lipsync.ts
    ├── compose-final.ts
    └── publish-final-video.ts

lib/dubbing/
├── dubbing-run-plan.ts
├── minimax-credentials.ts
├── applied-asset-summary.ts
└── voice-assets.ts

scripts/
├── whisper_asr.py
├── translator.py
├── voice_cloner.py
├── compose_dub.py
└── Wav2Lip/inference.py
```

---

## 三、分析检查清单

### 3.1 Whisper / ASR

| 检查项 | 文件 | 检查内容 | 状态 |
| --- | --- | --- | --- |
| SA-AI-001 | `steps/ingest/transcribe-media.ts` | `INGEST_WHISPER_CLI`、`INGEST_WHISPER_MODEL`、Python fallback 缺失时错误是否明确 | [ ] |
| SA-AI-002 | `steps/ingest/transcribe-media.ts` | YouTube、本地视频、本地音频是否统一抽取为 canonical WAV | [ ] |
| SA-AI-003 | `steps/dubbing/whisper-asr.ts` | ASR segments 是否保留时间轴、speaker 信息和原文 | [ ] |
| SA-AI-004 | `scripts/whisper_asr.py` 调用方 | 语言参数、sample duration、stderr、退出码是否正确处理 | [ ] |
| SA-AI-005 | manifest 写入路径 | ingest transcript 与 dubbing segments 是否写入对应 artifact ID | [ ] |

### 3.2 Translator

| 检查项 | 文件 | 检查内容 | 状态 |
| --- | --- | --- | --- |
| SA-AI-006 | `steps/dubbing/translate-text.ts` | Mandarin/Cantonese 目标语言、翻译风格、creator context 是否传入 | [ ] |
| SA-AI-007 | `scripts/translator.py` 调用方 | `DUBBING_SCRIPT_ARG_MODE` 是否按 detect/legacy/strict/force 正确传参 | [ ] |
| SA-AI-008 | 翻译输出解析 | translations 是否与 segments 对齐，缺行、空文本、时间轴错位是否失败可诊断 | [ ] |
| SA-AI-009 | 术语表处理 | `localization_glossary` 是否来自 run plan 或样片快照，不散落手写规则 | [ ] |

### 3.3 MiniMax TTS 与声线安全

| 检查项 | 文件 | 检查内容 | 状态 |
| --- | --- | --- | --- |
| SA-AI-010 | `dubbing-run-plan.ts`、API route | `usage_boundary_acknowledged` 未明确确认时是否阻止真实创建或标记不可执行 | [ ] |
| SA-AI-011 | `minimax-tts.ts` | voice id、secondary voice、speaker mode、speech speed 是否从 config 读取 | [ ] |
| SA-AI-012 | `minimax-credentials.ts` | MiniMax key/group id 是否只在服务端读取并脱敏记录 | [ ] |
| SA-AI-013 | `minimax-tts.ts` | 单段 TTS 失败是否有重试/隔离策略，且不会产出半成功 manifest | [ ] |
| SA-AI-014 | `voice-assets.ts`、`AppliedAssetSummary` 调用方 | 创作者声线、声线授权记录、AI 旁白是否标注来源，不伪装成公众人物真实发言 | [ ] |

### 3.4 Dubbing bridge 与 lip sync

| 检查项 | 文件 | 检查内容 | 状态 |
| --- | --- | --- | --- |
| SA-AI-015 | `voice_cloner.py` / 调用方 | 外部 dubbing skill 不存在时是否回退本地 bridge，并保留清晰日志 | [ ] |
| SA-AI-016 | `compose_dub.py` / `compose-final.ts` | TTS audio 集合、原视频、字幕/脚本输入是否路径安全 | [ ] |
| SA-AI-017 | `wav2lip-lipsync.ts` | lip sync 关闭、runtime 缺失、执行失败是否与 `lipsync_mode` 语义一致 | [ ] |
| SA-AI-018 | Wav2Lip `inference.py` 调用方 | 大文件、GPU/CPU、临时目录、超时和退出码是否可诊断 | [ ] |

### 3.5 FFmpeg / yt-dlp / 本地媒体处理

| 检查项 | 文件 | 检查内容 | 状态 |
| --- | --- | --- | --- |
| SA-AI-019 | `lib/media/ffmpeg-service.ts` | 命令参数是否使用数组或安全转义，避免字符串注入 | [ ] |
| SA-AI-020 | ingest source steps | `INGEST_YTDLP_EXE` 下载失败、受限视频、无音轨视频是否有明确错误 | [ ] |
| SA-AI-021 | ingest/dubbing compose steps | 抽音频、转码、合成、归档时是否验证输入存在和输出大小 | [ ] |
| SA-AI-022 | temp manager / lifecycle | 临时文件清理是否不删除 manifest 已发布产物 | [ ] |
| SA-AI-023 | `ffmpeg-service.ts` | 超时、stderr 截断、退出码、进度追踪是否足够定位失败 | [ ] |

### 3.6 sample-to-full、compare/report、长期资产

| 检查项 | 文件 | 检查内容 | 状态 |
| --- | --- | --- | --- |
| SA-AI-024 | `dubbing-run-plan.ts` | sample-to-full 是否复用样片快照的 voice、术语表、语言风格和 QA 修稿，而非重新猜测 | [ ] |
| SA-AI-025 | QA/compare/report loaders | 读取 final video、script、translations 时是否优先走 manifest | [ ] |
| SA-AI-026 | `applied-asset-summary.ts` 调用方 | form、workbench、QA、compare、report 的长期资产展示是否一致 | [ ] |
| SA-AI-027 | 成本/日志统计 | 统计项是否围绕 ASR、translator、MiniMax、FFmpeg、lip sync，而非 Gemini/Fish 分镜成本 | [ ] |

### 3.7 凭据、日志与安全边界

| 检查项 | 文件 | 检查内容 | 状态 |
| --- | --- | --- | --- |
| SA-AI-028 | logger / runtime wrappers | API key、token、本地绝对隐私路径、voice cloning 元数据是否脱敏 | [ ] |
| SA-AI-029 | API route 与 step input | 用户传入本地路径是否限制在允许范围，错误信息不暴露服务端敏感目录 | [ ] |
| SA-AI-030 | 声线使用边界确认 | UI、API、job config、runtime 之间是否保留明确确认链路 | [ ] |

---

## 四、关键代码审查

### 4.1 `transcribe-media.ts` 与 `whisper-asr.ts`

审查重点：

- [ ] 两条 ASR 路径都能处理配置缺失、模型缺失、脚本失败、空转录。
- [ ] ingest transcript 与 dubbing segments 的 artifact ID 不混用。
- [ ] sample mode 只截取指定时长，不污染全片任务的 manifest。
- [ ] stderr 与退出码进入日志，但不包含敏感命令参数。

### 4.2 `translate-text.ts` 与 `translator.py`

审查重点：

- [ ] 目标语言明确支持普通话、粤语或双语配置。
- [ ] translator 输出必须能映射回 segment ID / 时间段。
- [ ] 创作者定位、语言风格、术语表、QA 修稿只从 `DubbingRunPlan.config` 进入。
- [ ] detect 模式下只传脚本支持的语言参数，strict 模式下缺参能力应失败。

### 4.3 `minimax-tts.ts`

审查重点：

- [ ] MiniMax 凭据读取、错误处理、429/5xx 重试和超时策略。
- [ ] voice id 缺失必须在 run plan 阶段失败，不到 runtime 才发现。
- [ ] TTS audio 以 collection 写入 `dubbing.tts_audio`。
- [ ] 公开人物语音不得被描述为本人真实配音；只允许声线授权记录或清晰标注 AI 旁白。

### 4.4 `compose-final.ts`、`publish-final-video.ts` 与 FFmpeg

审查重点：

- [ ] 合成输入来自 manifest 或当前步骤输出，不从旧分镜目录猜路径。
- [ ] `final.mp4` / `final_with_bgm.mp4` 写入 `final_video`。
- [ ] 失败时不发布半成品；成功时归档路径重写 manifest。
- [ ] FFmpeg 参数安全、输出文件大小和媒体 metadata 可校验。

### 4.5 `AppliedAssetSummary`、QA、compare/report

审查重点：

- [ ] 长期资产摘要统一来自 `AppliedAssetSummary`。
- [ ] report/compare 不再显示旧 Gemini 分析、Fish 旁白、分镜处理成功路径。
- [ ] QA rerun 前后的资产摘要一致，修稿备注进入 sample-to-full config。
- [ ] long-term assets 回写不绕过声线授权记录与 声线使用边界确认。

---

## 五、历史兼容负向检查

这些检查只用于确认旧链路不会回到成功路径：

| 检查项 | 负向期望 |
| --- | --- |
| Gemini 视频分析 client | 不应被 `content_ingest` 或 `translation_dubbing` 作为必须 runtime 引用 |
| Fish Audio 旁白 client | 不应作为当前配音成功路径；MiniMax/dubbing runtime 是主线 |
| 分镜拆条、旧 process scene、concatenate scenes | 不应被当前 workflow steps 注册或调用 |
| `/api/jobs POST style_id/storyboard_count` | 应不可创建新任务；只能提示使用 `/api/ingest` 或 `/api/dubbing` |
| `single-video` / `multi-video` | 不应注册、选择或作为 AI 集成测试的成功路径 |
| 旧成本统计 | Gemini/Fish/分镜成本不得成为当前 report/compare 的主线指标 |

---

## 六、发现的问题

> 在实际分析代码后填写此部分。

### 问题 SA-AI-XXX

严重程度：P0/P1/P2/P3
文件位置：`lib/workflow/steps/xxx.ts:123`
检查项：SA-AI-XXX

问题描述：
（详细描述发现的问题）

风险分析：
（说明对 ASR、翻译、TTS、lip sync、manifest、样片到全片或声线安全的影响）

修复建议：
（优先复用现有 runtime wrapper、manifest、run plan 或 asset summary）

---

## 七、分析结果汇总

| 指标 | 数值 |
| --- | --- |
| 检查项总数 | 30 |
| 已检查 | 0 |
| 发现问题 | 0 |
| P0 问题 | 0 |
| P1 问题 | 0 |
| P2 问题 | 0 |
| P3 问题 | 0 |

### 按类别统计

| 类别 | 检查项数 | 问题数 |
| --- | --- | --- |
| Whisper / ASR | 5 | 0 |
| Translator | 4 | 0 |
| MiniMax TTS 与声线安全 | 5 | 0 |
| Dubbing bridge 与 lip sync | 4 | 0 |
| FFmpeg / yt-dlp / 本地媒体处理 | 5 | 0 |
| sample-to-full、compare/report、长期资产 | 4 | 0 |
| 凭据、日志与安全边界 | 3 | 0 |

---

## 八、修复方案书写规则

发现问题后，修复方案应按以下顺序描述：

1. 归属原语：ASR、translator、MiniMax、lip sync、FFmpeg/yt-dlp、manifest、run plan、asset summary 或历史负向检查。
2. 最小改动：只修改当前主线所需的 runtime wrapper、配置解析或 manifest 写入。
3. 安全边界：说明凭据脱敏、声线使用边界确认、声线授权记录或路径安全如何保持。
4. 验证建议：列出单元测试、脚本 dry run、artifact manifest 断言或 report/compare 回归检查。

---

## 附录：相关代码路径

```text
lib/workflow/steps/ingest/
├── inspect-source.ts
├── transcribe-media.ts
└── build-content-brief.ts

lib/workflow/steps/dubbing/
├── resolve-dubbing-source.ts
├── whisper-asr.ts
├── translate-text.ts
├── minimax-tts.ts
├── wav2lip-lipsync.ts
├── compose-final.ts
└── publish-final-video.ts

lib/dubbing/
├── dubbing-run-plan.ts
├── minimax-credentials.ts
├── applied-asset-summary.ts
├── sample-mode.ts
└── voice-assets.ts

lib/jobs/
├── workflow-artifact-manifest.ts
├── job-artifact-contract.ts
├── job-artifacts.ts
└── dubbing-rerun.ts

lib/media/
├── ffmpeg-service.ts
├── tracking.ts
└── utils/

scripts/
├── whisper_asr.py
├── translator.py
├── voice_cloner.py
├── compose_dub.py
└── Wav2Lip/inference.py
```
