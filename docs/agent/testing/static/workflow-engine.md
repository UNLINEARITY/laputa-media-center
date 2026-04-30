# 主动静态审查 - 工作流引擎

> 分析目标：通过阅读代码发现 `content_ingest` 与 `translation_dubbing` 主线工作流中的状态、产物、恢复和兼容风险。
> 涉及范围：`lib/workflow/engine.ts`、`lib/workflow/workflows/`、`lib/workflow/steps/`、`lib/jobs/workflow-artifact-manifest.ts`、`lib/dubbing/dubbing-run-plan.ts`、`lib/dubbing/applied-asset-summary.ts`、任务仓储与相关 API 调用边界。
> 优先级：P0（核心模块）
> 预计耗时：120 分钟

---

## 测试目的

核心目标：确保工作流引擎只把当前主线作为可创建、可执行、可恢复的成功路径，并让所有运行产物、长期资产摘要和样片到全片链路落到同一套 normal form。

具体要求：

1. 全面分析 `content_ingest`、`translation_dubbing`、任务队列、步骤状态、产物 manifest、样片到全片和历史兼容读取路径。
2. 按 P0（致命）、P1（严重）、P2（中等）、P3（轻微）分类问题。
3. 修复建议必须优先复用现有原语，避免重新引入旧剪辑链路。
4. 旧 `single-video`、`multi-video`、`style_id`、`storyboard_count`、分镜生成、Gemini 分析、Fish 旁白只能作为负向兼容检查，不得作为成功路径。

修复原则：

- 保证当前 `/api/ingest -> /api/dubbing -> /api/jobs -> QA -> sample-to-full -> compare/report -> long-term assets` 主线稳定。
- 新建任务只能映射到 `content_ingest` 或 `translation_dubbing`。
- 历史 DB 任务可以读取和展示日志，但不得重新注册、调度或创建旧工作流。
- 产物读取优先 `WorkflowArtifactManifest`，旧散落路径只作为无 manifest 时的兼容 fallback。
- 涉及配音任务创建时必须保留 声线使用边界确认。

---

## 一、Primitive / Normal Form 视图

### 1.1 当前原语

| 原语 | 代码位置 | 静态审查重点 |
| --- | --- | --- |
| `WorkflowId` / `JobType` 映射 | `lib/workflow/workflow-ids.ts`、任务创建路径 | 只允许 `content_ingest` 与 `translation_dubbing` 新建和调度 |
| `content_ingest` 工作流 | `lib/workflow/workflows/content-ingest.ts` | 来源识别、转录、创作素材整理的顺序和输出 |
| `translation_dubbing` 工作流 | `lib/workflow/workflows/translation-dubbing.ts` | resolve source、ASR、翻译、MiniMax TTS、可选 lip sync、合成、发布 |
| `WorkflowArtifactManifest` | `lib/jobs/workflow-artifact-manifest.ts` | 统一记录 transcript、segments、translations、script、TTS audio、final video |
| `DubbingRunPlan` | `lib/dubbing/dubbing-run-plan.ts` | 把 route 请求、来源校验、样片模式、长期资产和 声线使用边界确认 归一化为 job config |
| `AppliedAssetSummary` | `lib/dubbing/applied-asset-summary.ts` | form、workbench、QA、compare、report 展示同一套长期资产摘要 |
| `SourceClassifier` / ingest handoff | `lib/ingest/`、`lib/workflow/steps/ingest/` | URL、本地视频、本地音频、ingest 到 dubbing 的来源边界 |
| `sample-to-full` | `lib/jobs/dubbing-rerun.ts`、`lib/dubbing/sample-mode.ts` | 样片快照、全片复用和源素材一致性 |

### 1.2 Normal form 不变量

1. `JobType` 是主线身份来源；旧 `style_id/style_name/storyboard_count` 不得决定新任务类型。
2. `WorkflowDefinition` 只能注册当前主线；旧 `single-video` / `multi-video` 不应出现在 selector 的可执行集合中。
3. `WorkflowContext.input` 使用 `jobType + videos + config`，不注入旧 Gemini/Fish/分镜上下文。
4. `WorkflowArtifactManifest` 是 artifact 查找的权威入口；manifest 条目必须是安全路径，不能越权读取。
5. `content_ingest` 输出 `ingest.transcript_markdown/json/srt`、`ingest.source_audio`，本地化吸收成功时输出 `ingest.source_video`。
6. `translation_dubbing` 输出 `dubbing.segments`、`dubbing.translations`、`dubbing.script`、`dubbing.tts_audio`、`final_video`。
7. `DubbingRunPlan.config.usage_boundary_acknowledged` 必须来自明确确认，不得被默认补成 true。
8. sample-to-full 只能从同源、同语言、已完成的样片任务复用快照。
9. compare、report、QA、delivery package、long-term assets 必须优先消费 manifest 与 `AppliedAssetSummary`，不得手写另一套资产/产物规则。

### 1.3 表面到 normal form 映射

| 现有表面 | 原语 | Normal-form 表示 | 负向检查 |
| --- | --- | --- | --- |
| `/api/ingest` | `content_ingest` | `job_type=content_ingest`，步骤输出 ingest artifacts | 不接受旧 `style_id/storyboard_count` 作为创建参数 |
| `/api/dubbing` | `translation_dubbing` + `DubbingRunPlan` | `job_type=translation_dubbing`，config 含语言、声线、样片、声线使用边界确认 | 未确认 voice-use 时不得进入真实配音创建 |
| `/api/jobs GET` | 历史读取兼容 | 可读当前任务和历史任务 | `/api/jobs POST style_id/storyboard_count` 应返回下架语义，不应创建旧任务 |
| Workflow selector | `WorkflowId` | 只解析当前主线 ID | `single-video` / `multi-video` 应不可选、不可注册、不可调度 |
| Artifact 下载 | `WorkflowArtifactManifest` | manifest entry -> 安全路径 -> API URL | 旧 `temp/jobs/{jobId}` 只可 fallback，不得覆盖 manifest |
| QA/compare/report | `AppliedAssetSummary` + manifest | 统一展示长期资产、QA 结果、最终视频 | 不显示旧分镜完整性、Gemini/Fish 旁白成功路径 |

---

## 二、模块概述

工作流引擎负责：

- 任务状态管理：`pending -> processing -> completed/failed/cancelled`。
- 当前主线步骤执行：素材吸收、外语视频翻译配音。
- 步骤状态持久化、重试、恢复和日志。
- 工作流产物 manifest 写入、归档路径重写和下载查询。
- 样片任务到全片任务的配置与资产快照复用。
- 历史任务读取兼容，不恢复旧剪辑执行链路。

当前架构：

```text
lib/workflow/
├── engine.ts
├── workflow-ids.ts
├── workflows/
│   ├── content-ingest.ts
│   └── translation-dubbing.ts
├── steps/
│   ├── ingest/
│   │   ├── inspect-source.ts
│   │   ├── transcribe-media.ts
│   │   └── build-content-brief.ts
│   └── dubbing/
│       ├── resolve-dubbing-source.ts
│       ├── whisper-asr.ts
│       ├── translate-text.ts
│       ├── minimax-tts.ts
│       ├── wav2lip-lipsync.ts
│       ├── compose-final.ts
│       └── publish-final-video.ts
└── state/
    ├── step-manager.ts
    ├── context-manager.ts
    ├── lifecycle-manager.ts
    └── data-persistence.ts

lib/jobs/
├── workflow-artifact-manifest.ts
├── job-artifact-contract.ts
├── job-artifacts.ts
├── dubbing-qa*.ts
└── dubbing-rerun.ts

lib/dubbing/
├── dubbing-run-plan.ts
├── applied-asset-summary.ts
├── sample-mode.ts
└── voice-assets.ts
```

---

## 三、分析检查清单

### 3.1 工作流注册与选择

| 检查项 | 文件 | 检查内容 | 状态 |
| --- | --- | --- | --- |
| SA-WF-001 | `workflow-ids.ts`、`workflows/index.ts` | `JobType/WorkflowId` 映射是否只允许 `content_ingest` 和 `translation_dubbing` 新建 | [ ] |
| SA-WF-002 | `engine.ts` | 未知 workflow 或历史 workflow 是否失败为明确错误，而不是落回旧 single/multi | [ ] |
| SA-WF-003 | `step-definitions.ts`、`step-registry.ts` | 旧 step 名称是否只用于历史日志展示，不参与当前执行依赖 | [ ] |
| SA-WF-004 | 任务创建路径 | `/api/jobs POST style_id/storyboard_count` 是否不可创建新任务 | [ ] |

### 3.2 `content_ingest` 主线

| 检查项 | 文件 | 检查内容 | 状态 |
| --- | --- | --- | --- |
| SA-WF-005 | `steps/ingest/inspect-source.ts`、`lib/ingest/*` | YouTube URL、本地视频、本地音频分类是否稳定，错误信息是否可操作 | [ ] |
| SA-WF-006 | `steps/ingest/transcribe-media.ts` | `ffmpeg`、`yt-dlp`、Whisper CLI 路径和失败处理是否清晰 | [ ] |
| SA-WF-007 | `steps/ingest/transcribe-media.ts` | transcript Markdown/JSON/SRT、source WAV、source MP4 是否写入 manifest | [ ] |
| SA-WF-008 | `steps/ingest/build-content-brief.ts` | localize 目标是否能形成给 dubbing 的 handoff，而普通转录不误标 `ready_for_dubbing` | [ ] |

### 3.3 `translation_dubbing` 主线

| 检查项 | 文件 | 检查内容 | 状态 |
| --- | --- | --- | --- |
| SA-WF-009 | `dubbing-run-plan.ts`、`resolve-dubbing-source.ts` | URL、本地路径、`fromJob + ingest.source_video` 是否统一转成可执行来源 | [ ] |
| SA-WF-010 | `whisper-asr.ts` | ASR 结果是否产出 segments 并写入 `dubbing.segments` | [ ] |
| SA-WF-011 | `translate-text.ts` | translator 结果是否产出 translations/script，并保留源时间轴 | [ ] |
| SA-WF-012 | `minimax-tts.ts` | MiniMax voice、speaker mode、speech speed、双声线配置是否从 `DubbingRunPlan` 读取 | [ ] |
| SA-WF-013 | `wav2lip-lipsync.ts` | lip sync 关闭、失败或缺少 runtime 时是否有明确降级/失败语义 | [ ] |
| SA-WF-014 | `compose-final.ts`、`publish-final-video.ts` | final video 是否写入 manifest 并进入归档/下载 contract | [ ] |

### 3.4 产物 manifest 与路径安全

| 检查项 | 文件 | 检查内容 | 状态 |
| --- | --- | --- | --- |
| SA-WF-015 | `workflow-artifact-manifest.ts` | artifact ID 是否覆盖 ingest、dubbing、final video 的主线产物 | [ ] |
| SA-WF-016 | `data-persistence.ts`、`job-artifacts.ts` | manifest 路径归档重写是否保持相对目录安全 | [ ] |
| SA-WF-017 | artifact API routes | manifest 存在但条目不安全时是否拒绝，而不是静默 fallback 到旧路径 | [ ] |
| SA-WF-018 | `job-artifact-contract.ts` | 前端下载 URL、文件名、content type 是否来自统一 contract | [ ] |

### 3.5 状态机、恢复与并发

| 检查项 | 文件 | 检查内容 | 状态 |
| --- | --- | --- | --- |
| SA-WF-019 | `engine.ts` | 状态转换是否覆盖成功、失败、取消、重试耗尽 | [ ] |
| SA-WF-020 | `state/step-manager.ts` | 步骤状态保存、重试计数、恢复上下文是否不会丢失 manifest patch | [ ] |
| SA-WF-021 | `task-queue.ts` | 同一 job 是否避免重复执行，队列并发是否隔离 job 输出目录 | [ ] |
| SA-WF-022 | `state/lifecycle-manager.ts` | 临时资源清理是否不删除已归档 manifest 产物 | [ ] |

### 3.6 样片到全片、QA、compare/report、长期资产

| 检查项 | 文件 | 检查内容 | 状态 |
| --- | --- | --- | --- |
| SA-WF-023 | `dubbing-run-plan.ts`、`sample-mode.ts` | sample mode、sample-to-full、sample asset snapshot 的互斥关系是否正确 | [ ] |
| SA-WF-024 | `dubbing-run-plan.ts` | 样片快照是否校验来源任务完成、同源、同语言、同 token 权限 | [ ] |
| SA-WF-025 | `applied-asset-summary.ts` | form、workbench、QA、compare、report 是否复用同一资产摘要 | [ ] |
| SA-WF-026 | `dubbing-qa*.ts`、report/compare loaders | QA 重跑、报告、对比是否优先读取 manifest 和当前 job_type | [ ] |

---

## 四、关键代码审查

### 4.1 `engine.ts` - 执行引擎

审查重点：

- [ ] 只执行已注册的当前主线 workflow。
- [ ] 每个步骤失败都能保存可诊断日志和状态。
- [ ] 步骤输出合并到 context 时不覆盖已有 manifest。
- [ ] 取消或失败后不会继续发布 final video。

需要检查的关键函数：

```typescript
// executeWorkflow()
// handleStepFailure()
// transitionState()
// load/save workflow context
```

### 4.2 `workflows/content-ingest.ts` - 素材吸收定义

审查重点：

- [ ] 步骤顺序固定为 `inspect_source -> transcribe_media -> build_content_brief`。
- [ ] 本地文件校验、音频提取、Whisper 转录失败时有明确错误。
- [ ] `transcribe_media` 产物全部进入 `WorkflowArtifactManifest`。
- [ ] 可本地化的视频只通过 manifest 中的 `ingest.source_video` 交给配音。

### 4.3 `workflows/translation-dubbing.ts` - 翻译配音定义

审查重点：

- [ ] 步骤顺序固定为 `resolve_dubbing_source -> asr_transcribe -> translate_text -> voice_clone_generate -> lipsync_process -> compose_final -> publish_final_video`。
- [ ] MiniMax TTS 作为当前配音输出路径，旧 Fish 旁白不得作为成功路径。
- [ ] lip sync 可选，但关闭或失败的语义必须可追踪。
- [ ] `publish_final_video` 只发布当前任务 final video，不复用旧 compose/download step。

### 4.4 `workflow-artifact-manifest.ts` - 产物 normal form

审查重点：

- [ ] manifest schema 固定为 `schema_version: 1`。
- [ ] ingest artifact ID 与 dubbing artifact ID 不混用。
- [ ] `path`/`paths` 解析、合并、归档重写不允许目录穿越。
- [ ] 旧 `segments.json`、`translations.json`、`final.mp4` filename fallback 不得覆盖 manifest 权威条目。

### 4.5 `dubbing-run-plan.ts` - 创建决策 normal form

审查重点：

- [ ] route 的纯决策都集中到 run plan，不散落在 API handler。
- [ ] `usage_boundary_acknowledged` 只在请求明确确认时为 true。
- [ ] `voice_id` 可来自请求或创作者默认声线，但缺失时必须失败。
- [ ] sample-to-full 复用样片快照时校验 job type、状态、样片标记、语言、来源和权限。

---

## 五、历史兼容负向检查

这些检查只验证旧链路不可作为当前成功路径：

| 检查项 | 负向期望 |
| --- | --- |
| `single-video` / `multi-video` workflow 文件或注册项 | 不应存在可执行注册；历史 step 字符串最多用于日志展示 |
| `/api/jobs POST` 携带 `style_id`、`storyboard_count` | 应返回旧入口下架语义，不应创建任务 |
| `prepare_gemini`、`gemini_analysis`、`batch_generate_narrations`、`process_scene_loop` | 不应被 `content_ingest` 或 `translation_dubbing` 引用 |
| `/styles`、风格模板、分镜数量 | 不应出现在主线创建、导航或工作台成功路径 |
| Report/QA 展示 | 主线任务不应显示旧分镜完整性、Gemini 分析、Fish 旁白进度 |

---

## 六、发现的问题

> 在实际分析代码后填写此部分。

### 问题 SA-WF-XXX

严重程度：P0/P1/P2/P3
文件位置：`lib/workflow/xxx.ts:123`
检查项：SA-WF-XXX

问题描述：
（详细描述发现的问题）

风险分析：
（说明对 ingest、dubbing、manifest、样片到全片或历史兼容的影响）

修复建议：
（优先复用现有原语；如需新增 helper，说明它归属哪个 normal form）

---

## 七、分析结果汇总

| 指标 | 数值 |
| --- | --- |
| 检查项总数 | 26 |
| 已检查 | 0 |
| 发现问题 | 0 |
| P0 问题 | 0 |
| P1 问题 | 0 |
| P2 问题 | 0 |
| P3 问题 | 0 |

### 按类别统计

| 类别 | 检查项数 | 问题数 |
| --- | --- | --- |
| 工作流注册与选择 | 4 | 0 |
| `content_ingest` 主线 | 4 | 0 |
| `translation_dubbing` 主线 | 6 | 0 |
| 产物 manifest 与路径安全 | 4 | 0 |
| 状态机、恢复与并发 | 4 | 0 |
| 样片到全片、QA、compare/report、长期资产 | 4 | 0 |

---

## 八、修复方案书写规则

发现问题后，修复方案应按以下顺序描述：

1. 归属原语：说明问题属于 workflow selector、manifest、run plan、asset summary、step runtime 还是历史兼容。
2. 最小改动：给出不恢复旧剪辑链路的最小修复点。
3. 保护性验证：列出应补的单元测试、静态检查或回归用例。
4. 兼容说明：如果影响历史任务读取，说明保留哪一层 fallback。

---

## 附录：相关代码路径

```text
lib/workflow/
├── engine.ts
├── workflow-ids.ts
├── step-definitions.ts
├── task-queue.ts
├── workflows/
│   ├── content-ingest.ts
│   └── translation-dubbing.ts
├── steps/
│   ├── ingest/
│   └── dubbing/
└── state/
    ├── step-manager.ts
    ├── context-manager.ts
    ├── lifecycle-manager.ts
    └── data-persistence.ts

lib/jobs/
├── workflow-artifact-manifest.ts
├── job-artifact-contract.ts
├── job-artifacts.ts
├── dubbing-qa.ts
├── dubbing-qa-persistence.ts
├── dubbing-qa-summary.ts
└── dubbing-rerun.ts

lib/dubbing/
├── dubbing-run-plan.ts
├── applied-asset-summary.ts
├── sample-mode.ts
└── voice-assets.ts
```
