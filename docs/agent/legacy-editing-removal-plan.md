# 旧剪辑系统下架计划

## 执行规则

后续处理旧剪辑系统时，先读取本文件，确认当前工作属于本计划内的阶段和范围。

- 属于本计划的工作：可以继续执行，并按阶段完成验证。
- 不属于本计划的工作：先暂停，不要顺手重构或删除。
- 发现新依赖或新风险：先补充到本计划，再进入实现。
- 每一阶段都保持小闭环，优先保留当前 `content_ingest` 和 `translation_dubbing` 主线稳定。

## 目标

从产品主线中移除旧的 AI 剪辑、风格模板、分镜复刻链路，只保留 Laputa 内容引擎当前主线：

```text
/ingest -> /dubbing -> /jobs -> QA -> sample-to-full -> compare/report -> long-term assets
```

## 保留范围

- `/api/ingest`
- `/api/dubbing`
- `/api/jobs` 的 `GET` 查询能力
- `/api/jobs/[id]/*` 的任务详情、日志、下载、artifact、QA、cost 等通用能力
- workflow engine、task queue、jobs DB、state/log persistence
- report、compare、QA、creator assets、MiniMax/dubbing runtime
- 当前主线仍依赖的通用组件和工具

## 下架范围

- 旧 `/api/jobs POST` 创建 `style_id + storyboard_count` 剪辑任务
- `single-video` / `multi-video` workflow 作为可执行路径
- `/styles` 风格库产品入口
- `components/task-creation/*`
- 旧 guide/docs 中的创建剪辑任务、剪辑风格、分镜数量说明
- 旧剪辑专用 steps：`analysis/`、`narration/`、`extract/`、`process/`、旧 `compose/` 中只服务剪辑的部分

## 风险原则

旧目录和旧执行入口已经完成下架；后续不再恢复旧剪辑链路。新增清理必须继续遵守两条边界：

- 历史 DB 任务仍要可读，旧 step/stage 名称可以保留为日志展示兼容。
- 当前 `content_ingest` 和 `translation_dubbing` 主线稳定优先，不做顺手大重构。

## 阶段 1：软下架旧入口 `[已完成]`

目标：阻止旧剪辑继续产生新任务，但不影响现有任务查询和当前配音主线。

任务：

1. 将 `/api/jobs POST` 改为旧入口下架响应。
   - 推荐状态码：`410 Gone`。
   - 响应说明素材吸收使用 `/api/ingest`，翻译配音使用 `/api/dubbing`。
2. 收窄 `selectWorkflow`。
   - 不再根据 `videoCount` 默认选择 `single-video` 或 `multi-video`。
   - 只接受显式新主线：`content_ingest`、`translation_dubbing`。
3. 移除首页和导航中对 `/styles` 的主线引导。
4. 更新相关测试。
   - 旧 `style_id/storyboard_count` payload 不再被视为可留在 `/api/jobs` 的普通任务。
   - 增加 workflow selector 合约测试。

验证：

```bash
pnpm test:unit tests/api/specialized-endpoint.test.ts
pnpm test:unit tests/workflow/workflows.test.ts
pnpm lint
```

## 阶段 2：断开配音工作流对旧 step 的依赖 `[已完成]`

目标：让 `translation_dubbing` 只依赖配音专用 step 和通用底座。

任务：

1. 新增或改造配音专用 `resolve_dubbing_source`，替代 `fetch_metadata`。
2. 新增或改造配音专用 `publish_final_video`，替代旧 `download`。
3. 更新 `translation-dubbing.ts`，移除旧 step 引用。
4. 确保 sample mode、full run、sample-to-full 都仍能找到正确输入和输出路径。

验证：

```bash
pnpm test:unit tests/api/dubbing-route.test.ts tests/jobs/dubbing-rerun.test.ts tests/jobs/sample-to-full-stress.test.ts
pnpm test
pnpm build
```

## 阶段 3：物理删除旧剪辑模块 `[已完成]`

目标：删除旧剪辑运行链路和旧产品入口。

删除前检查：

```bash
rg "single-video|multi-video|prepare_gemini|gemini_analysis|batch_generate_narrations|process_scene_loop|style_id|storyboard_count"
```

候选删除范围：

- `lib/workflow/workflows/single-video.ts`
- `lib/workflow/workflows/multi-video.ts`
- `components/task-creation/*`
- `store/task-creation-store.ts`
- `app/styles/*`
- `app/api/styles/*`
- 旧 style components
- 不再被主线引用的旧 workflow steps

同步清理：

- `lib/workflow/steps/index.ts`
- `types/core/job.ts` 中旧剪辑字段
- `docs/agent/architecture.md`
- `docs/agent/workflow.md`
- `docs/agent/api-routes.md`
- `docs/agent/frontend.md`

删除前新增风险补充：

- 删除旧 style system 前，先断开 `lib/loaders/report-loader.ts` 和 `app/api/dev/clear-cache/route.ts` 对 `styleLoader` 的编译引用。
- 删除 `types/core/style.ts` 前，先移除 `types/index.ts` 的统一导出，并确认 `StylePreset` 等类型只剩旧 `/styles` 或旧 step 内部引用。
- `lib/workflow/step-registry.ts` 的旧 step/stage 中文映射先保留，用于历史日志展示；这不等于保留旧执行链路。
- `lib/workflow/step-definitions.ts` 可以保留旧 step 字符串作为历史任务读取兼容，但当前主线步骤应补齐 `content_ingest` 和 `translation_dubbing` 的 normal form。
- `lib/workflow/state/data-persistence.ts` 是运行时写入路径；删除旧 workflow 后应移除旧剪辑 output 写入分支，只保留当前主线需要的最终视频持久化。

兼容要求：

- 旧 DB 任务读取不能炸掉。
- `style_id`、`style_name` 这类历史字段可以先保留为 optional 兼容字段，再逐步清理展示逻辑。

验证：

```bash
pnpm lint
pnpm test
pnpm build
```

## 阶段 4：主线 normal form 补强 `[进行中]`

目标：旧系统下架后，把新主线压成更稳定的原语和正常形。

任务：

1. `[已完成]` 建立 `JobType/WorkflowId` 映射表。
2. `[已完成]` 抽 `SourceClassifier`，供 `/api/ingest` 和 `inspect_source` 共用。
3. `[已完成]` 抽 `AppliedAssetSummary`，供 dubbing form、QA、compare、report 共用。
4. `[已完成]` 抽 `DubbingRunPlan`，把 `/api/dubbing` 内的纯决策迁出 route。
5. `[已完成]` 抽 `WorkflowArtifactManifest`，统一 `segments/translations/audio/final video` 产物路径。
   - 新增 manifest 正常形，覆盖 `dubbing.segments`、`dubbing.translations`、`dubbing.script`、`dubbing.tts_audio`、`final_video`。
   - `dubbing.script` 是由 `translations.json` 派生的 API artifact，不作为独立落盘 manifest 路径。
   - `job-artifacts`、artifact 下载、QA、delivery package、report/job loader 已优先读取 manifest，并保留旧 `temp/jobs/{jobId}` 与 `output/*-{jobId}` fallback。
   - workflow step 输出会把 ASR、翻译、TTS、最终视频写入 `artifact_manifest`；任务归档到 `output` 时会同步重写 manifest 路径。
6. `[已完成]` 把 `content_ingest` 的 transcript/source artifacts 接入同一套 `WorkflowArtifactManifest`。
   - `transcribe_media` 输出会写入 `ingest.transcript_markdown`、`ingest.transcript_json`、`ingest.transcript_srt`、`ingest.source_audio`、`ingest.source_video`。
   - `/api/ingest/[id]/artifact` 优先读取 manifest，并保留旧 `OUTPUT_DIR/ingest/{jobId}` 直接文件 fallback。
   - manifest 路径必须是 `OUTPUT_DIR/ingest/{jobId}` 的直接子文件；manifest 条目存在但不安全时不再静默回退。
   - 工作台转录稿下载入口会从 manifest 生成稳定 API URL；client 侧只引用无 `node:fs` 的 artifact 定义。
   - local MP4 在本地化吸收时会复制到 `source_video.mp4`，保证原片也成为可复用 artifact。
   - 远端视频只在成功产出 canonical `source_video.mp4` 时才写 `ingest.source_video` 并标记 `ready_for_dubbing`；raw webm/mkv 只用于抽音频转录。
   - ingest -> dubbing handoff 只接受已完成的 `content_ingest + localize` 来源任务，并用 `fromJob + ingest.source_video` 在服务端解析。
   - manifest 存在时是工作台 ingest artifact URL 与 dubbing handoff 的权威来源；旧 `artifact_urls/video_path/dubbing_source` 只在没有 manifest 时 fallback。

监察补充风险：

1. `[已完成]` `/api/jobs/validate` 已返回 `410 Gone`，并指向 `/api/ingest` 与 `/api/dubbing`。
2. `[已完成]` `lib/workflow/state/context-manager.ts` 已收敛为 `jobType + videos + config`，不再注入旧 Gemini storyboard/Fish/GCS/TTS context service。
3. `[已完成]` `scripts/import-styles.js` 与 `styles/_templates/*` 已不存在。
4. `[已完成] docs/agent/testing/dynamic/*` 主动测试路径已改为当前 `/api/ingest -> /api/dubbing -> /api/jobs -> QA -> sample-to-full -> compare/report -> long-term assets` 主线；旧 `/api/jobs + style_id + storyboard_count`、`/styles`、单视频/多视频混剪只保留为 410 或归档负向验证。
5. `[已完成]` `ZEABUR_DEPLOYMENT.md` 已清理旧 Gemini/Fish Audio/NCA/解说风格部署文案；`zeabur.yaml` 已是主线文案。
6. `[已完成]` `store/job-store.ts` 已无旧 `createJob(style_id)` 客户端入口。
7. `[已完成]` `jobsRepo.create()` 强制新建任务使用 `content_ingest` 或 `translation_dubbing`；DB schema 默认不再是旧 `single_video`。
8. `[已完成]` Report 基础信息、摘要和 layout 已按主线 job_type 优先；`content_ingest` / `translation_dubbing` 即使带历史 scene rows，也不会露出旧分镜、Gemini/Fish 或分镜完整性区块。
9. QA rerun 前资产摘要应继续复用 `AppliedAssetSummary`，避免与 dubbing form/workbench 展示的长期资产不一致。
10. `[已完成]` `job-display` 仍保留 `config/style_id/style_name` 历史 fallback，但已明确为 legacy/sparse-job 兼容；主线身份始终由 `job_type` 优先决定，并有旧字段污染测试覆盖。
11. `[已完成]` Report layout 对主线任务只显示 ingest/dubbing artifact 与 final video normal form；旧 section 仅由历史剪辑 job_type 兼容触发。
12. `WorkflowArtifactManifest` 已是 artifact 查找优先来源；后续继续收敛散落的 `segments.json`、`translations.json`、final video filename/API contract 常量，并保留旧路径 fallback。
    - `[已完成]` 新增纯前端可用的 `job-artifact-contract`，集中生成 dubbing artifact API URL、下载名、final video 下载 URL/文件名；`delivery-package` 已复用该 contract。
13. `[已澄清] AppliedAssetSummary` 已集中到 form/workbench/QA/compare/report 的主要展示路径，后续只需继续避免新增手写资产 rows/counts。
14. `[已完成]` `JobConfig` 与 workflow context 不再把旧剪辑 normal form 当成主线必需字段。
   - `WorkflowContext.input` 使用 `jobType + videos + config`，不再注入 `styleId`。
   - `WorkflowContext.services` 只保留当前 ingest/dubbing step 实际使用的 `ffmpeg`。
   - `JobConfig.max_concurrent_scenes` 已改为 optional；新主线 config 缺少该字段时会原样保留，旧坏数据才走默认兼容值。
15. `[已完成]` 新建主线任务不再主动写入旧剪辑字段。
   - `/api/ingest` 创建 `content_ingest` 时不再写 `max_concurrent_scenes` 或 `style_name`。
   - `DubbingRunPlan` 创建 `translation_dubbing` config 时不再写 `max_concurrent_scenes`。
   - 历史任务读取仍保留 `style_id/style_name/max_concurrent_scenes` 兼容。
16. `[已完成] docs/agent/api-routes.md` 已按当前 route 字段更新：
   - `/api/ingest` 使用 `source`、`source_language`、`target_language`、`ingest_goal`。
   - `/api/dubbing` 使用 `video_url` 或 `source_job_id/source_artifact_id`，顶层 `lipsync_mode`，以及 `config.voice_usage_confirmed`。
   - sample-to-full/rerun 说明已改为通过 `/dubbing` 预填与样片快照创建全片任务。
17. `[已完成] docs/agent/video-processing.md` 已改为 ingest/dubbing 的 ASR、翻译、MiniMax TTS、可选 lip sync、合成、manifest 产物链路；旧 Gemini 上传、分镜拆条、process scene、concatenate-scenes 仅作为历史归档。
18. `[已完成] docs/agent/ai-integration.md` 已改为当前主线 AI/外部工具边界：Whisper、translator、MiniMax、dubbing runtime、FFmpeg/yt-dlp、voice-use confirmation、QA/runtime status。
19. `[已完成]` 小型产品/维护文案残留已清理：
   - `app/(auth)/layout.tsx` 登录页不再显示 `Powered by Google Gemini AI`。
   - `app/api/upload/video/route.ts` 注释不再引用 `PrepareVideoStep + UploadGeminiStep`。
   - `docs/agent/workflow.md` 已补充当前 manifest 写入与归档职责。
20. `[已完成] docs/agent/testing/static/*` 主动静态审查文档已改成 primitive-first normal form：
   - `workflow-engine.md` 主审 `content_ingest`、`translation_dubbing`、workflow selector、manifest、sample-to-full 和历史兼容边界。
   - `ai-integration.md` 主审 Whisper/ASR、translator、MiniMax、dubbing bridge、FFmpeg/yt-dlp、voice-use confirmation 和 artifact normal form。
   - 旧 Gemini/Fish/分镜/`single-video`/`multi-video` 只作为负向检查或历史兼容说明。
21. `[已完成] components/settings/*` 设置页产品文案已从旧分镜处理、视频拆条、Gemini 视频分析、旁白生成，改为素材吸收、转录/翻译、MiniMax 配音、字幕产物、队列并发和兼容配置语义。
22. `[已完成] artifact contract / manifest 小闭环` 已把主线 artifact 文件名、下载 URL、下载名和 runtime 输入路径继续收敛：
   - `WorkflowArtifactManifest` 现在暴露 canonical filename/content type helper，避免 step persistence 重复手写 `segments.json`、`translations.json` 和 JSON content type。
   - 新增 dubbing step artifact path helper，`translate_text`、`voice_clone_generate`、`lipsync_process` 优先从 manifest 读取 `dubbing.segments`、`dubbing.translations`、`dubbing.tts_audio`，并保留 `temp/jobs/{jobId}` fallback。
   - compare/workbench 的口播稿下载、artifact preview 和成片预览 URL 改用 `job-artifact-contract`。
   - `/api/jobs/[id]/artifact` 与 `/api/jobs/[id]/download` 的 `Content-Disposition` 下载名改用同一 contract。
   - delivery package 现在可识别 manifest-only final video，并在本机不可下载时显示“已生成但不可下载”的交付项。
23. `[已完成] compose/publish canonical final video 小闭环` 已明确最终视频 normal form：
   - `compose_final` 只写 step checkpoint；`${jobId}_dubbed.mp4` 是中间产物，不写 `state.final_video_url/final_video_local_path`，也不写 `artifact_manifest.final_video`。
   - `publish_final_video` 从 `step_context.compose_final` 读取源产物，复制或下载到 `tempManager.getFinalPath()` 的 canonical `final.mp4`，再由 `saveFinalVideo` 写入最终视频状态与 manifest。
   - 最终视频下载合约只接受 `final.mp4` / `final_with_bgm.mp4`；`_dubbed.mp4` 不作为交付下载项。
   - 为历史 resume 保留旧 `state.final_video_url/final_video_local_path` source fallback，但该 fallback 只用于重新发布到 canonical final path，不直接暴露旧路径。
24. `[已拆分]` 范围外残留已拆分为独立小闭环：
   - Fish Audio / 旧 TTS 主动配置文案已在设置页与动态测试文档中降级为历史兼容入口；当前配音主线仍以 MiniMax 与授权 voice_id 为准。
   - 旧 Gemini 视频分析/分镜旁白 client 代码仍存在，但当前 workflow 未注册调用；后续单独判断保留为归档兼容还是删除。
25. `[已完成] delivery/report final-video presentation 小闭环` 已继续收敛交付与报告展示 normal form：
   - `delivery-package.ts` 已把 `script.txt`、`translations.json`、`segments.json` 收敛成 typed artifact spec table，避免重复拼装文案、URL、下载名和 availability。
   - `buildDubbingDeliveryPackage` 的默认 final video availability 不再只凭 `final_video_local_path` 字符串判定；只有 loader/API 传入安全检查结果 `finalVideoAvailable: true` 时才显示为可下载/可预览。
   - Report 基础信息和总结区已改用统一 `getReportFinalVideoPresentation` helper；主线 `translation_dubbing` 无交付包时不会把 `${jobId}_dubbed.mp4` 当最终视频 fallback 展示，旧剪辑报告仍保留 legacy fallback 链接。
   - `/api/jobs/[id]/download` 已补显式测试，确认 `final_video_local_path` 或 manifest `final_video` 指向 `_dubbed.mp4` 时返回 404。
26. `[已完成] dynamic docs / settings compatibility 小闭环`：
   - `docs/agent/testing/dynamic/*-task-control.md` 已改为 `/api/ingest -> /api/dubbing -> /api/jobs/[id]/*` 当前主线任务控制，并使用 `{jobId}-final.mp4` 下载 contract。
   - `docs/agent/testing/dynamic/*` 中旧 `/api/jobs POST` 只保留为 `410 Gone` 负向验证。
   - Fish Audio / 旧 TTS 在动态 UI/API 测试文档和设置页中已降级为历史兼容；当前配音示例使用 MiniMax、`/api/dubbing`、`voice_usage_confirmed`、`/api/dubbing/status`。
   - `components/settings/fish-audio-config.tsx`、`components/settings/tts-config.tsx`、`components/settings/status-badge.tsx`、`app/settings/page.tsx` 已同步兼容语义。
27. `[已完成] privileged API auth normal form 小闭环`：
   - `app/api/gemini/test/route.ts`、`app/api/gemini/models/route.ts`、`app/api/google-storage/test/route.ts` 已统一使用 `authenticateOrReject`，匿名请求在 `AUTH_ENABLED=true` 时不会继续进入外部 Gemini/GCS 测试调用。
   - `app/api/jobs/[id]/logs/route.ts`、`app/api/jobs/[id]/cost/route.ts` 已统一使用 `authenticateOrReject`，并保留 token 查询限流与 token 任务归属检查。
   - `app/api/storage/cleanup/route.ts`、`app/api/storage/stats/route.ts` 已统一使用 `authenticateOrReject`；通过认证的 API token 仍不能调用 Web 管理型存储接口。
   - 新增 `tests/api/privileged-route-auth.test.ts`、`tests/api/storage-admin-auth.test.ts`、`tests/api/job-logs-cost-auth.test.ts` 覆盖匿名拒绝、session-only 管理接口、token 归属检查和“不进入下游重型逻辑”。
28. `[已拆分]` 下一轮 P2 已拆成文档/UI 收敛与 Gemini legacy 判定两个小闭环：
   - Gemini 动态测试 contract、creator assets 动态文档和 `creator-assets-config` 简体 UI 已在第 29 项完成。
   - `lib/ai/gemini/index.ts` 旧视频分析、旁白优化、File API 上传兼容层继续作为第 30 项单独处理。
29. `[已完成] Gemini 动态 contract / creator assets 文案收敛小闭环`：
   - `docs/agent/testing/dynamic/cloud-api.md` 与 `docs/agent/testing/dynamic/local-api.md` 已按实际 route 校准：
     - `/api/gemini/test` 是 `POST`，需要认证，支持 `ai-studio` 与 `vertex` 两种 body，成功响应为 `{ text, raw }`。
     - `/api/gemini/models` 是 `POST`，需要认证，只列 Vertex 模型，body 为 `project_id`、`service_account_json`、可选 `location`，成功响应为 `{ models }`。
     - Gemini 测试接口只作为配置连通性测试，不恢复旧视频分析主线。
   - `components/settings/creator-assets-config.tsx` 已清理为简体 UI 文案，并统一“翻译配音”命名；对应组件测试已更新。
   - `docs/agent/testing/dynamic/cloud-ui.md`、`local-ui.md`、`cloud-workflow.md`、`local-workflow.md` 已把 creator assets 验证收窄到当前已实现资产：受众、用词倾向、语言口播偏好、授权声线、词库/固定读法。
   - 创作者照片、intro/outro、avatar、标题格式和频道交付预设只记录为后续规划能力，不作为当前动态 QA 通过条件。
30. `[已完成] Gemini legacy client / File API 兼容层删除小闭环`：
   - `app/api/api-keys/route.ts` 已不再依赖旧 `geminiClient.clearCache()`，改用轻量 `clearGeminiRuntimeCache()`。
   - `lib/ai/gemini/index.ts` 旧视频分析、storyboard 解析、旁白优化 client 已删除。
   - `lib/ai/gemini/file-manager.ts` 旧 Gemini File API 上传、URL 上传、File API metadata helper 已删除。
   - `types/ai/clients.ts` 已移除 `IGeminiClient`、`GeminiAnalyzeOptions`、`GeminiBatchNarrationOptions`、`GeminiBatchNarrationResult`、`GeminiGenerateResult`，保留仍在使用的 Fish/TTS/GCS client 类型。
   - `lib/ai/gemini/cache.ts`、`credentials-provider.ts`、`core/`、`utils/url-converter.ts`、`types/ai/gemini.ts` 保留，继续服务 `/api/gemini/test`、`/api/gemini/models`、API key verify 和翻译 provider 凭证链路。
   - `verifyGeminiAIStudio()` 已从旧 File API 上传验证收敛为 `generateContent` 连通性验证，避免翻译可用的 Gemini key 被旧视频分析能力阻断。
   - 新增测试固定 AI Studio 验证不访问 `/upload/v1beta/files`，并固定 `clearGeminiRuntimeCache()` 无注册 clearer 时是安全 no-op。
   - `docs/agent/retry.md` 已改为当前 `content_ingest` / `translation_dubbing` 的重试与排障语义；旧 Gemini/File API/`BatchFormatError` 仅作为历史日志兼容说明。
   - `components/settings/gcs-config.tsx` 已把 GCS 文案改为可选外部对象存储/历史兼容语义，不再描述为上传视频供 Gemini 分析。
31. `[已完成] 主线无付费 route 压力测试小闭环`：
   - `tests/api/dubbing-route.test.ts` 已新增样片资产快照 route 压测：80 次样片转全片 promotion，确认大词库/大风格/本次覆盖不会污染样片锁定资产，且不会读取当前 project assets。
   - 新增 `tests/api/mainline-free-route-stress.test.ts`，用 mock route contract 串起 `/api/ingest -> /api/dubbing -> /api/jobs`：无 Gemini/MiniMax credentials、显式 `DUBBING_ALLOW_PASSTHROUGH_TRANSLATION=true` 与 `DUBBING_ALLOW_PLACEHOLDER_TTS=true` 时仍可创建 1 个 ingest smoke job 和 35 个 dubbing smoke jobs，并确认没有外部 `fetch`。
   - `/api/jobs GET?status=pending&limit=100` 的主线列表 contract 已被压测覆盖，确认会按分页/状态返回 translation dubbing jobs 并调用 `attachJobState`。
   - `package.json` 的 `pnpm test:stress` 已扩展到 `tests/jobs/sample-to-full-stress.test.ts` 与 `tests/api/mainline-free-route-stress.test.ts`。
32. `[已完成] QA / compare / report / long-term assets 压力测试小闭环`：
   - 新增 `tests/jobs/mainline-asset-visibility-stress.test.tsx`，在不调用真实外部服务、不需要 API key 的前提下，压测 180 条样片 QA 到全片重跑链路。
   - 覆盖 `buildDubbingSampleFullRunHrefFromJob`、`getAssetRows`、`getQaCompareDiff`、`hasDubbingReportContext`、`getAppliedRuleCounts`、QA 资产保存候选抽取和长期风格 note 生成。
   - 固定 sample-to-full URL 不泄漏长 `content_brief`、`language_style`、`localization_glossary`，但会带入 `fromJob`、`sampleToFull`、`sampleAssetSnapshot` 和 QA 修稿备注。
   - 固定 compare/report 对样片确认快照、来源任务、已保存 QA 摘要、固定读法和已套用规则摘要的展示 normal form。
   - `package.json` 的 `pnpm test:stress` 已扩展到 `tests/jobs/mainline-asset-visibility-stress.test.tsx`。
33. `[已完成] QA route -> sample-to-full route 压力测试小闭环`：
   - 扩展 `tests/api/mainline-free-route-stress.test.ts`，在 mock route 层压测 24 条 completed sample dubbing jobs。
   - 通过 `/api/jobs/[id]/qa` 真实执行 `evaluateDubbingQa`，mock `readJobArtifactText` 提供本地 JSON 字符串，mock `tryPersistDubbingQaReportSummary` 返回当前 QA summary normal form。
   - 用 `/api/jobs/[id]/qa` 返回的 persisted summary 生成 `buildDubbingSampleFullRunHrefFromJob`，再 POST `/api/dubbing` 创建全片任务。
   - 固定 route 层 sample-to-full URL 不泄漏 `contentBrief`、`languageStyle`、`localizationGlossary`，但会带入 `fromJob`、`sampleToFull`、`sampleAssetSnapshot` 和“已保存 QA 摘要”修稿备注。
   - 固定 `/api/dubbing` 创建出的 full run 使用样片快照资产：`voice_id`、第二声线、讲者模式、语速、翻译口吻、语言风格和固定读法都来自来源样片，不被当前请求资产覆盖。
   - 全程不调用真实付费 TTS、真实外部视频下载、Python/ffmpeg/yt-dlp/Wav2Lip/MiniMax bridge 或外部 `fetch`。
34. `[已完成] 监察员中风险文案收敛小闭环`：
   - `docs/agent/testing/static/api-routes.md` 已把 `/api/gemini/models` 校准为 `POST`，并把 `/api/jobs/route.ts` 注释改为 `GET 任务列表；POST 旧剪辑创建返回 410`。
   - 静态 API 路由文档已明确 `/api/styles` 是已删除/归档路径，只做残留检查；不再把旧风格 CRUD 当成当前代码路径。
   - `components/settings/system-config.tsx` 已把 Gemini 媒体分辨率 / FPS UI 文案改为“预留视觉理解”兼容配置，并明确当前主线不恢复旧 Gemini 分镜分析入口。
   - `types/api/config.ts` 已同步把相关注释从旧“Gemini 视频分析/分镜/旁白”语义改为系统并发、预留视觉理解、配音文本和本地化字幕语义。
35. `[已完成] artifact delivery 异常压力测试小闭环`：
   - 新增 `tests/jobs/mainline-artifact-delivery-stress.test.ts`，在 mock/helper/route 层串起 manifest、delivery package 和 `/api/jobs/[id]/download`。
   - 覆盖 manifest-only `final.mp4`、`final_with_bgm.mp4`、missing/unsafe/outside/wrong-job/nested output、`_dubbed.mp4` 中间产物、以及 manifest `path` 坏但 `paths` 有安全候选的组合。
   - `getSafeJobFinalVideoPath` 现在会按最终成片 allowed filenames 过滤 manifest 候选，避免首个 `_dubbed.mp4` 或异常路径阻断后续安全 `final.mp4`。
   - `package.json` 的 `pnpm test:stress` 已扩展到 artifact delivery 压力测试。
   - 全程没有调用真实付费 TTS、真实外部视频下载、Python/ffmpeg/yt-dlp/Wav2Lip/MiniMax bridge 或外部 `fetch`。
36. `[已完成] 翻译 provider 正式/烟测边界小闭环`：
   - `/api/dubbing` 创建正式配音任务前会检查 Gemini 翻译凭证；缺凭证且未显式设置 `DUBBING_ALLOW_PASSTHROUGH_TRANSLATION=true` 时返回 `400 / DUBBING_TRANSLATION_NOT_CONFIGURED`，不会创建或入队任务。
   - `TranslateTextStep` 在调用 `translator.py` 前执行同样边界；即使旧任务绕过 route，也不会静默进入原文占位。
   - `TranslateTextStep` 会回读 `translations.json`，若产物标记 `used_provider:false` 且本轮不是 passthrough smoke，会直接失败，避免 provider 异常退化为假本地化。
   - `scripts/translator.py` 默认不再无 key passthrough；只有显式 `--allow-passthrough` 或 `DUBBING_ALLOW_PASSTHROUGH_TRANSLATION=true` 才允许原文占位 smoke。
   - readiness 现在区分 `passthrough_translation_allowed`：缺 Gemini 且未允许 passthrough 时 smoke blocked；允许 passthrough 时只能 smoke，production 仍为 false。
   - 设置页和任务控制台文案已同步：正式本地化需要 Gemini 翻译凭证、MiniMax 和授权 voice_id；任务控制台不再把旧自动剪辑写进主线说明。
37. `[已完成] artifact route 异常 manifest 矩阵小闭环`：
   - `/api/jobs/[id]/artifact` 的 `segments.json`、`translations.json`、`script.txt` 已覆盖 manifest 异常组合：路径逃逸、runtime 外部路径、output root 下嵌套目录、其他 job output、目录、缺失文件、错误文件名。
   - `findJobArtifactPath` 现在在 manifest 条目存在但没有安全候选时直接返回缺失，不再静默回退到 legacy temp/output artifact。
   - `script.txt` 继续由安全的 manifest `translations.json` 派生；不安全 manifest translations 不会回退生成口播稿。
   - 保留没有 manifest 条目时的旧 temp/output fallback，用于历史任务读取兼容。
38. `[已完成] 闭环预检翻译/TTS 徽标边界小闭环`：
   - `components/ingest/ingest-workbench.tsx` 现在读取 `passthrough_translation_allowed`，缺 Gemini 且未显式允许 passthrough 时显示“翻译：未配置 / 阻断”，不再误显示“占位模式”。
   - TTS 徽标同样区分 `placeholder_tts_allowed`；缺 MiniMax 且未允许 placeholder 时显示“配音：未配置 / 阻断”。
   - `docs/agent/video-processing.md`、`docs/agent/env-vars.md` 和本计划已同步正式翻译边界：正式本地化必须配置 Gemini，`DUBBING_ALLOW_PASSTHROUGH_TRANSLATION` 只用于 smoke。
39. `[已完成] QA JSON contract / QA freshness 小闭环`：
   - `job-artifact-contract` 新增 `getJobQaJsonHref()` 与 `getJobQaJsonDownloadName()`，`delivery-package` 与 QA 报告页不再手写 `/api/jobs/{id}/qa` 和 `{id}-qa.json`。
   - `buildDubbingQaInputFingerprint` 已把 `WorkflowArtifactManifest.final_video` 纳入 delivery fingerprint；manifest-only final video 也会影响 QA summary freshness。
   - `dubbing-qa-backfill` 检查已有 QA summary 时会把当前 workflow state 传给 `getJobArtifactsFingerprint`，避免 manifest artifact 下误判旧 QA 为当前。
40. `[已完成] Report final_video_url fallback 收敛小闭环`：
   - `components/report/final-video-presentation.ts` 不再让主线 `translation_dubbing` 通过 raw `state.final_video_url` 在基础信息或总结区展示最终视频。
   - 主线配音成片展示与下载继续以交付包和 `/api/jobs/{id}/download` contract 为准，避免绕过 `final.mp4` / `final_with_bgm.mp4` 安全检查。
   - 旧 `single_video` / `multi_video` 报告仍保留 raw `final_video_url` fallback，用于历史报告读取兼容。
41. `[已完成] QA / dubbing detail final video contract 收敛小闭环`：
   - `evaluateDubbingQa` 的成片交付检查改为复用 `isJobFinalVideoDownloadable(job.id, job.state)`，只有安全的 `final.mp4` / `final_with_bgm.mp4` 才能通过 delivery check。
   - stale `state.final_video_url`、`final_video_local_path` 或 manifest `final_video` 指向 `_dubbed.mp4` 时，QA 会标记为交付问题，不再把中间产物判为可交付成片。
   - `/api/dubbing/[id]` 已对齐 `/api/jobs/[id]`，返回 `deliveryPackage`；客户端即使看到 raw state，也能以 `final_video.available=false` 的交付 contract 为准。
42. `[已完成] Workbench 成片预览 final video contract 收敛小闭环`：
   - `components/workbench/workbench-client.tsx` 的成片预览只信任 `deliveryPackage` 中可用的 `final_video` 交付项，不再因为 raw `state.final_video_local_path` 存在就显示预览区。
   - 历史或异常 state 指向 `_dubbed.mp4` 时，workbench 不再给出“看似可预览”的 UI 假阳性；实际下载仍继续走 `/api/jobs/{id}/download` 安全 contract。
43. `[已完成] AppliedAssetSummary job builder 收敛小闭环`：
   - `lib/dubbing/applied-asset-summary.ts` 新增 `buildAppliedDubbingAssetItemsFromJob()` 与 `createAppliedDubbingAssetSummaryFromJob()`，集中生成配音任务的受众、用词、讲者、语言风格、长期词库、第二声线和讲者模式资产项。
   - Workbench 重跑确认、QA 报告预跑摘要和 compare 资产 rows 已复用同一套配音资产 builder，避免新增或修改长期资产展示时三处手写逻辑分叉。
   - 本轮只抽“配音长期资产”子集；来源素材、处理范围、修稿差异和 QA 分数对比仍保留在各自展示层。
44. `[已完成] Gemini URL helper File API 口径收敛小闭环`：
   - `lib/ai/gemini/utils/url-converter.ts` 已移除旧 Gemini File API URI 类型识别、`file-api` URL type、`isGeminiFileApiUri()` 和 `extractFileApiName()`。
   - 保留当前主线仍使用的 Vertex URL builder：`buildVertexGenerateContentUrl()` 与 `buildVertexModelsListUrl()`。
45. `[已完成] MiniMax 声线注册表 / 声线选择策略 normal form 小闭环`：
   - `lib/dubbing/voice-registry.ts` 新增 MiniMax 声线注册表 normal form，覆盖创作者自有声线、授权克隆声线、名人翻译/评论声线、合成旁白声线和通用声线。
   - 声线选择策略固定为：显式 `voice_id` 优先，其次根据来源元数据或人工讲者提示匹配已保存别名；未知或不可靠讲者落到 MiniMax 通用男/女/中性声线，最后才使用创作者默认声线。
   - 该策略不做生物识别或“听声认人”判断，只使用任务元数据、人工提示、注册表别名和已保存授权状态。
   - 名人或公众人物翻译/评论声线会标记 `requires_disclosure`，用于后续 UI/API 在花费 TTS 成本前提示“非本人原声 / 翻译或评论用途”。
   - `/api/dubbing/voices` 读取本地 `minimax_cloned_voices.json` 时兼容旧 `{ voice_id: { ref_audio, created_at } }` 格式，并可保存 display name、category、gender、languages、speaker aliases、disclosure、usage label、priority 等元数据；克隆来源、成本、授权证明和适用人物字段见第 58 项 normal form 扩展。
   - 本轮只建立本地注册表和纯选择策略，没有执行真实克隆、真实 MiniMax TTS 验证或任何付费外部调用。
46. `[已完成] MiniMax 声线选择接入创建链路 / 提交前披露小闭环`：
   - 新增 `lib/dubbing/minimax-voice-registry-store.ts`，让 `/api/dubbing/voices` 与 `/api/dubbing` 共用同一份本地声线注册表读写逻辑。
   - `buildDubbingRunPlan()` 已接入 `selectMiniMaxVoiceForDubbing()`；创建任务时会写入 `voice_selection_source`、`voice_usage_label`、`voice_disclosure_required`、`voice_matched_alias`、`voice_public_figure`、`voice_category`。
   - 显式 `voice_id` 仍优先决定实际声线，但如果讲者提示命中需披露的 registry alias，会保守写入披露要求；未登记的手动声线也会标记为需确认授权或标注 AI 翻译配音。
   - sample-to-full 使用样片资产快照时会沿用来源样片已确认的声线选择与披露元数据，不混入当前 registry 或项目资产新改动。
   - `/dubbing` 表单已消费 registry 返回的 `display_name`、`usage_label`、`requires_disclosure`、`public_figure` 等字段，在声线卡片、保存预览和提交前确认区显示用途与“需披露”提示。
   - 手动保存未知声线不再默认沉淀为“已授权克隆声线”；默认保存为需披露的 AI 合成旁白/未登记声线，后续应再补讲者、授权和用途元数据。
47. `[已完成] 声线披露贯穿交付 / QA / MiniMax 执行审计小闭环`：
   - `VoiceUsageDisplay` 继续作为展示层 canonical primitive，已进入 `DeliveryPackage.voiceUsage`、QA JSON/API、QA 预跑确认和交付包入口。
   - 交付包新增 `voice_disclosure` item，指向报告中的配音上下文锚点；`qa_json` item 也显示声线用途、来源和披露要求。
   - `voice_clone_generate` 步骤新增 raw `voice_audit` normal form，记录 `voice_id`、`usage_label`、`disclosure_required`、`source`、`category`、`public_figure`；它进入 input summary、MiniMax API call/response log 和 step output。
   - 执行审计不复用展示文案对象；当存在 `voice_id` 但缺少明确披露字段时，审计保守记录为需要披露。
   - 未改 artifact manifest；TTS 音频仍由 manifest 管产物，声线审计留在 step output / job step history。
48. `[已完成] MiniMax 声线元数据编辑器小闭环`：
   - 设置页 `MiniMax 配音` 区块新增本地声线元数据编辑器，用 `MiniMaxVoiceRegistryEntry` 作为 normal form，维护 category、gender、languages、speaker aliases、授权、公众人物、披露、usage label、notes 和 priority；克隆资产字段由第 58 项继续扩展。
   - 编辑器只调用 `/api/dubbing/voices` 的 `GET/PUT/DELETE`，不调用会触发真实 MiniMax TTS 的 `POST` 验证接口。
   - `/api/dubbing/voices` 的 PUT 使用 camelCase command object，并继续由 normalizer 写入 snake_case registry 字段；公众人物声线需要披露，缺少授权证明的授权克隆也保守保持披露要求。
   - 系统默认 MiniMax voice_id 在元数据编辑器中显示为只读，避免把设置凭证默认声线与本地长期 registry 记录混淆。
   - `/dubbing` 声线列表按 priority 优先展示，并在注册表自动匹配和手动选择场景都显示“管理声线元数据”入口；声线已授权元数据不会自动替代本次任务的 voice-use confirmation。
   - `/dubbing` 不再把第一条 registry voice 自动写成显式 `voice_id`；当用户没有手动选择 voice_id 但本地 registry 有候选时，提交保持空 `voice_id`，由服务端 registry 策略按讲者别名、通用旁白声线和默认声线选择。
   - `/api/dubbing/voices` 的 `POST` MiniMax TTS 验证必须带 `confirmPaidVerification`，否则直接返回 400 且不调用外部 MiniMax。
   - `/api/dubbing/voices` 的 `GET` 以本地 registry 元数据为 canonical；当设置里的默认 voice_id 与本地 registry 同名时，本地 category、授权、披露和 priority 不会被只读系统默认项覆盖。
   - 新增组件、route 和 normalizer 测试，覆盖优先级排序、无付费 POST、camelCase PUT、公众人物强制披露、授权克隆免披露、系统默认只读、本次任务仍需确认、空 voice_id 走服务端 registry 策略。
49. `[已完成] MiniMax 凭证验证付费确认小闭环`：
   - `/api/api-keys` 保存 `minimax_tts` 凭证前必须带 `confirmPaidVerification` 或 `confirm_paid_verification`，否则返回 400 且不调用 `verifyApiKey()`，避免保存设置时误触发真实 MiniMax 测试 TTS。
   - 设置页 `MiniMax 配音` 区块新增显式确认 checkbox；未确认时“验证并保存”不可点击，已确认后才会把确认字段传给 `/api/api-keys`。
   - 保存成功后重置确认状态，避免下一次修改 API Key 或 voice_id 时沿用旧确认。
   - 新增 API route 和组件测试，覆盖未确认不验证/不保存、确认后才验证保存，以及 UI 未勾选前不能触发保存。
50. `[已完成] 声线披露交付 README 小闭环`：
   - 交付包新增可下载 `delivery-readme.md`，由现有 `DeliveryPackage` 与 `VoiceUsageDisplay` 派生，不另建第二套声线披露规则。
   - `/api/jobs/[id]/artifact?file=delivery-readme.md` 会动态生成给人工剪辑/发布人员的交付说明，包含声线 ID、用途、来源、类别、公众人物属性、披露要求、确认状态和交付项清单。
   - 公众人物/需披露声线会在 README 中明确要求发布、剪辑交接或二次分发时保留“AI 翻译配音 / 非本人原声”等披露说明。
   - `voice_disclosure_required` 使用三态语义：`true` 必须披露，`false` 可写无需额外披露，缺失时不得当作无需披露，而是要求人工确认并保守标注。
   - README 是生成式 artifact，不落盘、不进入 `WorkflowArtifactManifest`，避免扩大 runtime 写入面；现有视频、script、translations、segments 仍由 manifest/legacy fallback 管理。
51. `[已完成] QA 页面交付披露 handoff 小闭环`：
   - `/jobs/[id]/qa` 现在把 `loadJobDetailDirect()` 已构造的 `DeliveryPackage` 传入 `JobQaReport`，不在 QA 页面重建第二套交付规则。
   - QA 页面从 `DeliveryPackage.items` 读取 `delivery_readme` 与 `voice_disclosure`，直接提供 `delivery-readme.md` 下载和报告配音上下文锚点。
   - QA 页面交付披露提示复用 `DeliveryPackage.voiceUsage` / `VoiceUsageDisplay`，让质检人员在重跑或交付前就能看到声线用途与披露要求。
52. `[已完成] QA JSON 交付披露 handoff 小闭环`：
   - `/api/jobs/[id]/qa` 响应新增 `handoffs`，从 `loadJobDetailDirect()` 传回的 `DeliveryPackage.items` 读取 `delivery_readme` 与 `voice_disclosure`。
   - QA JSON 只暴露交付项的 `id/label/description/href/action/download/available` 等 handoff 字段，不复制声线披露判断规则。
   - `getDeliveryPackageItem()` 已成为交付包 item 查找 primitive，供 QA、compare 和最终视频预览共用。
53. `[已完成] Closed-loop readiness 声线元数据 / 披露就绪小闭环`：
   - `ClosedLoopReadiness` 新增 `voice_metadata_ready` 与 `voice_metadata` stage，把“MiniMax 能跑 TTS”和“声线用途/披露可审计”拆成两件事。
   - `voice_metadata` 只读取现有 MiniMax 默认 `voice_id` 与本地 `MiniMaxVoiceRegistryEntry` normal form，不调用 MiniMax、Python、ffmpeg、yt-dlp 或 Wav2Lip。
   - 声线元数据缺失只产生 warning，不阻断 `smoke_ready` 或既有任务创建；正式交付前由 readiness 提前提示补齐本地声线注册表。
54. `[已完成] 公开入口文档主线收敛 / 静态守卫小闭环`：
   - `README.md`、`CLAUDE.md`、`WARP.md` 已改成当前 `/ingest -> /dubbing -> /jobs -> QA -> sample-to-full -> compare/report -> long-term assets` 主线，不再把旧 Gemini 视频分析、旧 TTS 或旧剪辑入口写成产品默认路径。
   - `docs/dubbing-guide.md` 已改成 Web/API 优先的翻译配音手册，明确 `/api/dubbing`、声线使用确认、MiniMax registry、公众人物披露、样片到全片和交付 README。
   - 新增 `tests/docs/mainline-positioning-guard.test.ts`，静态守卫公开入口文档必须包含当前主线信号，并禁止旧剪辑定位、旧直接脚本入口和未披露公众人物声线示例回流。
55. `[已完成] 旧 TTS 兼容外呼确认 / auth 小闭环`：
   - 新增 `LegacyTtsConfirmation` primitive，旧 TTS 兼容接口统一走 `auth gate -> legacy confirmation gate -> provider/network side effect`。
   - `/api/tts/verify-voice` 先认证，再要求 `confirmLegacyFishAudio` / `confirmLegacyTts`，确认前不读取 Fish API Key、不调用 Fish model lookup。
   - `/api/tts/voices` 先认证，再要求 `x-chuangcut-confirm-legacy-tts: true` 或 query confirmation；确认前不实例化 Edge/Fish provider，也不走默认 `ttsManager.getVoices()`。
   - `/api/tts/status` 只保留本地只读 provider 状态，并补认证边界。
   - `/api/api-keys` 保存 `fish_audio_vertex` / `fish_audio_ai_studio` 前必须带 `confirmLegacyTts`，否则不调用旧 Fish TTS 测试验证。
   - 设置页旧 TTS / Fish Audio 兼容配置新增显式确认 checkbox；未确认前不会自动加载旧 Edge voice catalog，也不能触发 Fish 旧验证。
   - 新增 API 与组件测试，覆盖匿名拒绝、未确认不调用 provider/ky/verifyApiKey、确认后才进入兼容外部路径。
56. `[已完成] 声线披露三态 normal form 小闭环`：
   - 新增并贯穿 `VoiceDisclosureStatus = required | not_required | unknown`，把“未知披露要求”和“明确无需披露”分开。
   - `VoiceUsageDisplay`、MiniMax TTS `voice_audit`、`MiniMaxVoiceSelectionResult`、`DubbingRunPlan` 与 `/api/dubbing` 创建响应都带三态；旧 `disclosureRequired` boolean 仅保留为兼容字段。
   - `voice_disclosure_required?: boolean` 继续作为旧 DB config 字段；缺失即 `unknown`，不会在 run plan 中写成 `false`。
   - `/dubbing` 提交前预览会把默认声线、注册表自动匹配和缺少披露元数据的声线显示为“未记录披露要求 / 待确认披露”，不会显示成“未要求额外披露”。
   - `/api/jobs/[id]`、`/api/dubbing/[id]`、`/api/jobs/[id]/qa` 的 unknown fixture 已覆盖 `disclosureStatus: unknown` 和“未记录披露要求”，避免 API 消费者只看旧 boolean 时误判。
   - 监察员指出 `VoiceUsageDisplay.disclosureRequired` 对 unknown 仍为 `false` 会让旧 API 消费者误读；已改为“有声线但披露未知”时保守返回 `true`，三态 `disclosureStatus` 仍是唯一 canonical。
57. `[已完成] compare 资产 stable key normal form 小闭环`：
   - `AppliedAssetSummaryItem` 新增稳定 `key`，主线 dubbing asset builder 输出 `target_audience`、`wording_style`、`speaker_identity`、`language_style`、`glossary`、`secondary_voice_id`、`speaker_mode`。
   - compare 页读取资产值时优先按 stable key，不再依赖 `用詞`、`受眾`、`語言風格`、`长期词库` 等展示文案；label 只保留为 UI 展示和旧手写 item fallback。
   - `formatAppliedAssetSummaryText` 的语言风格与固定读法预览也优先按 key 判断，避免简体化或文案调整后静默丢预览。
58. `[已完成] MiniMax 克隆声线资产 normal form 小闭环`：
   - `MiniMaxVoiceRegistryEntry` 继续作为唯一声线资产 normal form，不新增第二套 voice asset 模型。
   - registry 追加 `clone_origin`、`clone_source`、`cloned_at`、`clone_cost_usd`、`authorization_proof`、`applicable_people`，核心、存储和响应保持 snake_case。
   - `/api/dubbing/voices` PUT 输入收敛为 camelCase command object，保存本地 registry；局部更新保留既有克隆元数据，手动录入默认标记为 `manual_voice_id`。
   - 设置页声线编辑器展示和保存克隆来源、成本、授权证明、适用人物；保存只写本地 registry，不触发 MiniMax TTS、克隆或付费验证。
   - 声线匹配扩展到 `applicable_people`，但不做音频声纹或人物身份自动识别。
   - 公众人物、授权与披露仍由 `category/public_figure/authorized/requires_disclosure/authorization_proof` 和任务级 `voice_usage_confirmed` 共同约束；缺少授权证明的授权克隆不会自动免披露，registry metadata 不替代单次确认。
   - TEAM 监察员指出的输入 normal form、授权证明披露边界和文档残留已合并修复；已完成的代理已关闭。
59. `[已完成] 主线声线 registry / sample-to-full route stress 小闭环`：
   - `tests/api/mainline-free-route-stress.test.ts` 覆盖 18 条本地 MiniMax registry 声线与 54 次 `/api/dubbing` 创建，按 `applicable_people` 自动选择公众人物或授权克隆声线。
   - route stress 断言克隆成本、授权证明、克隆来源等 registry-only 元数据不会写入 job config；本轮不调用真实 MiniMax、TTS、克隆或外部 fetch。
   - sample-to-full route stress 已锁住样片快照中的 `voice_selection_source`、`voice_usage_label`、`voice_disclosure_required`、`voice_matched_alias`、`voice_public_figure`、`voice_category` 进入 full job。
   - `selectMiniMaxVoiceForDubbing()` 的讲者匹配改为“具体度评分 + 长别名优先 + priority 打平”，避免 `讲者1` 误匹配 `讲者10` 这类短别名抢占。
   - `docs/agent/testing/dynamic/cloud-api.md` 中旧 `/api/jobs + style_id + storyboard_count` 与旧 `/api/styles` 示例已改为 localhost/mock 负向验证，不再保留可复制执行的生产域名旧入口或旧风格写入口。
60. `[已完成] delivery package item matrix / 动态测试安全 normal form 小闭环`：
   - `tests/jobs/mainline-artifact-delivery-stress.test.ts` 新增交付项矩阵压测，锁住 `script.txt`、`translations.json`、`segments.json` 在不同 availability 下的 href、download name、action、available 和 unavailable reason。
   - `delivery_readme` 作为生成交接项保持可下载；README 文本必须列出交付项、不可用原因和声线披露要求。
   - `voice_disclosure` 保持为 report anchor，不提供 download，并在描述中保留公众人物/授权声线用途与“需要标注 AI 翻译配音”要求。
   - artifact delivery stress 增加全局 `fetch` 哨兵，防止未来测试 helper 意外接入外部网络调用。
   - `docs/agent/testing/dynamic/cloud-api.md` 与 `cloud-edge-cases.md` 已收敛为 `BASE_URL + TEST_API_TOKEN + ALLOW_*` 命令 normal form：默认本地/一次性测试环境，生产、付费、删除、并发、服务重启都必须显式确认。
   - `docs/agent/testing/dynamic/local-ui.md` 已把旧 `/styles` 成功路径验收改为负向检查，不再要求“预设风格 16 个”或旧风格预览通过。
   - `tests/docs/dynamic-testing-safety-guard.test.ts` 已把动态测试文档安全边界自动化为 `doc -> fenced code block / section -> risk class -> required gate` 正常形。
   - 动态文档守卫禁止完整 `cca_...` token、生产域名危险 API、真实 Zeabur CLI id、旧 `/styles` 成功验收文案回流。
   - 动态文档守卫要求付费、删除、并发压测、生产重启、云端 UI 配置保存分别显式出现 `ALLOW_PAID_DYNAMIC_TESTS`、`ALLOW_DESTRUCTIVE_DYNAMIC_TESTS`、`ALLOW_STRESS_DYNAMIC_TESTS`、`ALLOW_PROD_DYNAMIC_TESTS`、`ALLOW_CONFIG_DYNAMIC_TESTS`。
61. `[已完成] mainline closed-loop mock smoke/stress 小闭环`：
   - `tests/jobs/mainline-closed-loop-smoke-stress.test.tsx` 新增 `ingest job -> sample dubbing job -> QA summary -> full dubbing job -> compare/report/delivery -> long-term asset preview` 高层闭环矩阵。
   - 测试覆盖 90 个 mock case，循环公众人物评论声线、授权克隆声线、未知披露元数据三类声线 normal form。
   - 闭环断言 ingest `ingest.source_video` manifest handoff、sample-to-full 短 URL、QA 改善、version chain、compare 默认目标、report context、已套用规则摘要、固定读法预览、声线披露、delivery package href/download/readme 全部一致。
   - `test:stress` 已加入该闭环测试；全程使用 mock job/state，不调用真实 MiniMax、TTS、ASR、翻译、ffmpeg、yt-dlp、Wav2Lip 或外部网络。
62. `[已完成] ingest artifact availability / dubbing handoff 反向守门小闭环`：
   - `source_video.mp4` 的 ready normal form 已收敛为 `authoritative manifest + server artifactAvailability["source_video.mp4"] === true`。
   - `/api/jobs/[id]` 与 `loadJobDetailDirect()` 会为 `content_ingest` 返回 `ingestArtifactAvailability`，由服务端复用 ingest artifact resolver 检查文件存在、文件名、目录边界和 realpath。
   - `findIngestManifest()` 会用 availability 过滤 `source_video.mp4` URL、`dubbingSource` 和 `ready_for_dubbing`；manifest 存在但 source video 为 `false` 或未知时，不再当成可配音原片。
   - Workbench 会保存并轮询更新 `ingestArtifactAvailability`；权威 manifest 缺少可用原片时，不再 fallback 到旧 `primaryInputSource` 显示 ready CTA。
   - 监察员指出的边界已补：manifest 存在但当前无可用 artifact、无 step output 时，`findIngestManifest()` 仍返回 `hasAuthoritativeManifest: true`，避免 UI 把它误判为旧任务。
   - `/dubbing` 的 `fromJob` 来源任务预填也改为 availability-aware；权威 manifest 原片不可用时，不再把本地 MP4 primary input 回填成可提交来源。
   - 旧 fallback 只保留在“没有 manifest”的历史任务兼容路径，避免 stale legacy step output 绕过当前 artifact contract。
63. `[已完成] QA voice disclosure gate 小闭环`：
   - QA normal form 新增 `voice-disclosure` check：输入 `voice_id`、`VoiceUsageDisplay.disclosureStatus = required | not_required | unknown`、`voice_usage_confirmed`，输出 `DubbingQaCheck`。
   - 无 `voice_id`、披露状态为 `unknown`、或 `voice_usage_confirmed !== true` 都会进入 `issue`；声线、披露状态和使用确认齐全才 `pass`。
   - `voice-disclosure` 使用 `assets` category，不新增展示分类；issue 会自然进入 `issueCount`、`score`、`verdict` 和 QA JSON。
   - `DUBBING_QA_ENGINE_VERSION` 已 bump 到 `dubbing-qa-summary:v2`，避免旧 pass summary 被 freshness 判断为当前。
   - API QA fixture 已覆盖 unknown disclosure 与未确认声线使用；主线 stress 已同步 v2 summary。

监察补充风险：

1. `[已完成]` 根入口文档 `README.md`、`CLAUDE.md`、`WARP.md` 已改成当前 `/ingest -> /dubbing -> /jobs -> QA -> compare/report` 主线。
2. `[已完成]` `docs/dubbing-guide.md` 已改为 Web/API 主线，并补齐声线确认、registry 和公众人物披露边界。
3. `[已完成]` 旧 Fish/Edge TTS 兼容 API 已补 auth + legacy confirmation；确认前不会触发 provider、Fish model lookup 或 Fish TTS 验证。
4. `[已完成]` `VoiceUsageDisplay.disclosureRequired` 仍保留为 deprecated boolean 兼容字段；核心展示/API/执行审计已收敛到 `required | not_required | unknown` 三态，未知状态不会再显示为无需披露。
5. `[已完成]` compare 资产读取已改为 stable key normal form；展示 label 调整不会再导致已套用资产显示为“未指定”。

验证：

```bash
pnpm lint
pnpm test
pnpm build
```

最近验证：

- `[已通过]` `pnpm exec biome check --write lib/dubbing/applied-asset-summary.ts lib/jobs/delivery-package.ts lib/workflow/steps/dubbing/minimax-tts.ts lib/dubbing/voice-registry.ts lib/dubbing/dubbing-run-plan.ts app/api/dubbing/route.ts components/dubbing/dubbing-form.tsx tests/jobs/applied-asset-summary.test.ts tests/workflow/minimax-tts-audit.test.ts tests/components/job-qa-report.test.tsx tests/jobs/voice-registry.test.ts tests/jobs/dubbing-run-plan.test.ts tests/api/dubbing-route.test.ts tests/components/dubbing-form.test.tsx tests/components/report-delivery-package-section.test.tsx tests/api/job-detail.test.ts tests/api/job-qa.test.ts`（17 files）
- `[已通过]` `pnpm test:unit tests/api/job-detail.test.ts tests/api/job-qa.test.ts tests/api/dubbing-route.test.ts tests/jobs/voice-registry.test.ts tests/jobs/dubbing-run-plan.test.ts tests/components/dubbing-form.test.tsx tests/jobs/applied-asset-summary.test.ts tests/api/job-artifact.test.ts tests/workflow/minimax-tts-audit.test.ts tests/components/job-qa-report.test.tsx tests/components/report-delivery-package-section.test.tsx`（11 files / 128 tests）
- `[已通过]` `pnpm lint`（443 files）
- `[已通过]` `pnpm test`（75 files / 413 tests）
- `[已通过]` `pnpm build`
- `[已通过]` `pnpm exec biome check --write lib/dubbing/applied-asset-summary.ts components/jobs/job-compare-client.tsx tests/jobs/applied-asset-summary.test.ts tests/components/job-compare-client.test.tsx`
- `[已通过]` `pnpm test:unit tests/jobs/applied-asset-summary.test.ts tests/components/job-compare-client.test.tsx`（2 files / 15 tests）
- `[已通过]` `pnpm lint`（443 files）
- `[已通过]` `pnpm test`（75 files / 414 tests）
- `[已通过]` `pnpm build`
- `[已通过]` `pnpm exec biome check --write lib/dubbing/applied-asset-summary.ts components/jobs/job-compare-client.tsx tests/jobs/applied-asset-summary.test.ts tests/components/job-compare-client.test.tsx tests/api/dubbing-route.test.ts tests/api/job-detail.test.ts tests/api/job-qa.test.ts tests/components/job-qa-report.test.tsx`
- `[已通过]` `pnpm test:unit tests/jobs/applied-asset-summary.test.ts tests/components/job-compare-client.test.tsx tests/api/dubbing-route.test.ts tests/api/job-detail.test.ts tests/api/job-qa.test.ts tests/components/job-qa-report.test.tsx`（6 files / 57 tests）
- `[已通过]` `pnpm lint`（443 files）
- `[已通过]` `pnpm test`（75 files / 414 tests）
- `[已通过]` `pnpm build`
- `[已通过]` `pnpm lint`（442 files）
- `[已通过]` `pnpm test`（74 files / 408 tests）
- `[已通过]` `pnpm build`
- `[已通过]` `pnpm test:unit tests/api/tts-legacy-auth.test.ts tests/api/api-keys.test.ts tests/components/fish-audio-config.test.tsx`（3 files / 17 tests）
- `[已通过]` `pnpm exec biome check lib/ai/tts/legacy-policy.ts app/api/tts/verify-voice/route.ts app/api/tts/voices/route.ts app/api/tts/status/route.ts app/api/api-keys/route.ts components/settings/tts-config.tsx components/settings/fish-audio-config.tsx app/settings/page.tsx tests/api/tts-legacy-auth.test.ts tests/api/api-keys.test.ts tests/components/fish-audio-config.test.tsx`
- `[已通过]` `pnpm test:unit tests/docs/mainline-positioning-guard.test.ts`（1 file / 2 tests）
- `[已通过]` `pnpm exec biome check README.md CLAUDE.md WARP.md docs/dubbing-guide.md tests/docs/mainline-positioning-guard.test.ts`（Markdown 被当前 Biome 配置忽略；TS 守卫已检查）
- `[已通过]` `pnpm lint`（439 files）
- `[已通过]` `pnpm test`（72 files / 396 tests）
- `[已通过]` `pnpm build`
- `[已通过]` `pnpm test:unit tests/api/closed-loop-readiness.test.ts`（1 file / 7 tests）
- `[已通过]` `pnpm exec biome check lib/workflow/closed-loop-readiness.ts tests/api/closed-loop-readiness.test.ts`
- `[已通过]` `pnpm lint`（438 files）
- `[已通过]` `pnpm test`（71 files / 394 tests）
- `[已通过]` `pnpm build`
- `[已通过]` `pnpm exec biome check lib/workflow/state/data-persistence.ts lib/workflow/steps/dubbing/publish-final-video.ts tests/workflow/final-video-persistence.test.ts tests/jobs/job-artifacts.test.ts`
- `[已通过]` `pnpm test:unit tests/workflow/final-video-persistence.test.ts tests/jobs/job-artifacts.test.ts tests/api/job-download.test.ts tests/api/job-qa.test.ts tests/jobs/job-display.test.ts tests/jobs/sample-to-full-stress.test.ts`
- `[已通过]` `pnpm test:unit tests/jobs/job-display.test.ts tests/components/report-basic-summary-sections.test.tsx tests/api/job-download.test.ts tests/components/report-delivery-package-section.test.tsx`
- `[已通过]` `pnpm lint`
- `[已通过]` `pnpm exec biome check app/api/gemini/test/route.ts app/api/gemini/models/route.ts app/api/google-storage/test/route.ts app/api/storage/cleanup/route.ts app/api/storage/stats/route.ts app/api/jobs/[id]/logs/route.ts app/api/jobs/[id]/cost/route.ts tests/api/privileged-route-auth.test.ts tests/api/storage-admin-auth.test.ts tests/api/job-logs-cost-auth.test.ts`
- `[已通过]` `pnpm exec vitest run tests/api/auth.test.ts tests/api/probe-auth.test.ts tests/api/privileged-route-auth.test.ts tests/api/storage-admin-auth.test.ts tests/api/job-logs-cost-auth.test.ts`（5 files / 15 tests）
- `[已通过]` `pnpm exec biome check components/settings/creator-assets-config.tsx tests/components/creator-assets-config.test.tsx`
- `[已通过]` `pnpm test:unit tests/components/creator-assets-config.test.tsx`（1 file / 2 tests）
- `[已通过]` `pnpm exec vitest run tests/api/privileged-route-auth.test.ts tests/components/creator-assets-config.test.tsx`（2 files / 5 tests）
- `[已通过]` 文本检查确认 Gemini 动态文档无旧 `GET /api/gemini/models`、旧直接 curl models、旧 `response_time_ms` 响应 contract 残留。
- `[已通过]` 文本检查确认动态资产文档不再把照片、intro/outro、avatar、标题格式、频道交付预设写成当前通过条件。
- `[已通过]` `pnpm lint`
- `[已通过]` `pnpm test`（56 files / 286 tests）
- `[已通过]` `pnpm build`
- `[已通过]` `pnpm exec biome check app/api/api-keys/route.ts lib/ai/gemini/cache.ts types/ai/clients.ts tests/api/api-keys.test.ts`
- `[已通过]` `pnpm exec vitest run tests/api/api-keys.test.ts tests/api/privileged-route-auth.test.ts`（2 files / 7 tests）
- `[已通过]` `pnpm exec biome check lib/api-keys/verify.ts lib/ai/gemini/cache.ts tests/api/api-key-verification.test.ts`
- `[已通过]` `pnpm exec vitest run tests/api/api-key-verification.test.ts tests/api/api-keys.test.ts tests/api/privileged-route-auth.test.ts tests/api/dubbing-route.test.ts tests/api/ingest-route.test.ts`（5 files / 32 tests）
- `[已通过]` `pnpm exec biome check components/settings/gcs-config.tsx`
- `[已通过]` `pnpm exec vitest run tests/components`（12 files / 77 tests）
- `[已通过]` `pnpm lint`（422 files）
- `[已通过]` `pnpm test`（58 files / 294 tests）
- `[已通过]` `pnpm build`
- `[已通过]` `pnpm exec biome check tests/api/mainline-free-route-stress.test.ts tests/api/dubbing-route.test.ts`
- `[已通过]` `pnpm exec vitest run tests/api/mainline-free-route-stress.test.ts tests/api/dubbing-route.test.ts tests/api/ingest-route.test.ts tests/ingest/runner.test.ts tests/api/api-key-verification.test.ts`（5 files / 28 tests）
- `[已通过]` `pnpm test:stress`（2 files / 4 tests）
- `[已通过]` `pnpm lint`（423 files）
- `[已通过]` `pnpm test`（59 files / 296 tests）
- `[已通过]` `pnpm build`
- `[已通过]` `pnpm exec biome check tests/jobs/mainline-asset-visibility-stress.test.tsx package.json`
- `[已通过]` `pnpm test:unit tests/jobs/mainline-asset-visibility-stress.test.tsx`（1 file / 1 test）
- `[已通过]` `pnpm test:stress`（3 files / 5 tests）
- `[已通过]` `pnpm lint`（424 files）
- `[已通过]` `pnpm test`（60 files / 297 tests）
- `[已通过]` `pnpm build`
- `[已通过]` `pnpm exec biome check tests/api/mainline-free-route-stress.test.ts`
- `[已通过]` `pnpm test:unit tests/api/mainline-free-route-stress.test.ts`（1 file / 2 tests）
- `[已通过]` `pnpm test:stress`（3 files / 6 tests）
- `[已通过]` `pnpm lint`（424 files）
- `[已通过]` `pnpm test`（60 files / 298 tests）
- `[已通过]` `pnpm build`
- `[已通过]` `pnpm exec biome check components/settings/system-config.tsx types/api/config.ts`
- Markdown 目标文件的 `pnpm exec biome check ...` 会被当前 Biome 配置忽略并返回 `No files were processed`；实际格式验证由全量 `pnpm lint` 覆盖。
- `[已通过]` `pnpm exec biome check lib/jobs/job-artifacts.ts tests/jobs/mainline-artifact-delivery-stress.test.ts package.json`
- `[已通过]` `pnpm test:unit tests/jobs/mainline-artifact-delivery-stress.test.ts tests/jobs/job-artifacts.test.ts tests/api/job-download.test.ts`（3 files / 18 tests）
- `[已通过]` `pnpm test:stress`（4 files / 7 tests）
- `[已通过]` `pnpm lint`（425 files）
- `[已通过]` `pnpm test`（61 files / 299 tests）
- `[已通过]` `pnpm build`
- `[已通过]` `pnpm exec biome check app/api/dubbing/route.ts lib/dubbing/translation-credentials.ts lib/workflow/steps/dubbing/translate-text.ts lib/workflow/closed-loop-readiness.ts app/settings/page.tsx app/jobs/page.tsx tests/api/dubbing-route.test.ts tests/api/mainline-free-route-stress.test.ts tests/api/closed-loop-readiness.test.ts tests/workflow/translate-text.test.ts`
- `[已通过]` `pnpm test:unit tests/api/dubbing-route.test.ts tests/api/mainline-free-route-stress.test.ts tests/api/closed-loop-readiness.test.ts tests/workflow/translate-text.test.ts`（4 files / 32 tests）
- `[已通过]` `pnpm exec biome check scripts/translator.py lib/workflow/steps/dubbing/translate-text.ts tests/workflow/translate-text.test.ts tests/scripts/translator-script.test.ts`
- `[已通过]` `pnpm test:unit tests/workflow/translate-text.test.ts tests/scripts/translator-script.test.ts`（2 files / 5 tests）
- `[已通过]` `pnpm test`（63 files / 307 tests）
- `[已通过]` `pnpm build`
- `[已通过]` `pnpm exec biome check lib/jobs/job-artifacts.ts tests/api/job-artifact.test.ts`
- `[已通过]` `pnpm test:unit tests/api/job-artifact.test.ts tests/jobs/job-artifacts.test.ts tests/api/job-download.test.ts tests/jobs/mainline-artifact-delivery-stress.test.ts`（4 files / 53 tests）
- `[已通过]` `pnpm test:stress`（4 files / 7 tests）
- `[已通过]` `pnpm lint`（427 files）
- `[已通过]` `pnpm test`（63 files / 335 tests）
- `[已通过]` `pnpm build`
- `[已通过]` `pnpm exec biome check components/ingest/ingest-workbench.tsx tests/components/ingest-workbench-readiness.test.ts`
- `[已通过]` `pnpm test:unit tests/components/ingest-workbench-readiness.test.ts tests/api/closed-loop-readiness.test.ts`（2 files / 7 tests）
- `[已通过]` `pnpm exec biome check lib/jobs/job-artifact-contract.ts lib/jobs/delivery-package.ts components/jobs/job-qa-report.tsx lib/jobs/dubbing-qa-input-fingerprint.ts lib/jobs/dubbing-qa-backfill.ts tests/jobs/job-artifact-contract.test.ts tests/jobs/dubbing-qa-input-fingerprint.test.ts tests/jobs/dubbing-qa-backfill.test.ts`
- `[已通过]` `pnpm test:unit tests/jobs/job-artifact-contract.test.ts tests/jobs/dubbing-qa-input-fingerprint.test.ts tests/jobs/dubbing-qa-backfill.test.ts tests/jobs/job-display.test.ts tests/components/report-delivery-package-section.test.tsx`（5 files / 27 tests）
- `[已通过]` `pnpm lint`（430 files）
- `[已通过]` `pnpm test`（66 files / 340 tests）
- `[已通过]` `pnpm build`
- `[已通过]` `pnpm exec biome check components/report/final-video-presentation.ts tests/components/report-basic-summary-sections.test.tsx`
- `[已通过]` `pnpm test:unit tests/components/report-basic-summary-sections.test.tsx tests/components/report-layout-legacy-cleanup.test.tsx tests/components/report-delivery-package-section.test.tsx`（3 files / 13 tests）
- `[已通过]` `pnpm lint`（430 files）
- `[已通过]` `pnpm test`（66 files / 341 tests）
- `[已通过]` `pnpm build`
- `[已通过]` `pnpm exec biome check lib/jobs/dubbing-qa.ts app/api/dubbing/[id]/route.ts tests/jobs/dubbing-qa.test.ts tests/api/dubbing-route.test.ts`
- `[已通过]` `pnpm test:unit tests/jobs/dubbing-qa.test.ts tests/api/dubbing-route.test.ts tests/api/job-qa.test.ts tests/api/job-download.test.ts tests/jobs/job-artifacts.test.ts`（5 files / 46 tests）
- `[已通过]` `pnpm exec biome check tests/api/dubbing-route.test.ts tests/api/mainline-free-route-stress.test.ts`
- `[已通过]` `pnpm test:unit tests/api/dubbing-route.test.ts tests/api/mainline-free-route-stress.test.ts tests/jobs/dubbing-qa.test.ts`（3 files / 31 tests）
- `[已通过]` `pnpm lint`（430 files）
- `[已通过]` `pnpm test`（66 files / 344 tests）
- `[已通过]` `pnpm build`
- `[已通过]` `pnpm exec biome check components/workbench/workbench-client.tsx tests/components/workbench-client.test.tsx`
- `[已通过]` `pnpm test:unit tests/components/workbench-client.test.tsx tests/jobs/job-display.test.ts`（2 files / 29 tests）
- `[已通过]` `pnpm lint`（430 files）
- `[已通过]` `pnpm test`（66 files / 346 tests）
- `[已通过]` `pnpm build`
- `[已通过]` `pnpm exec biome check lib/ai/gemini/utils/url-converter.ts lib/dubbing/applied-asset-summary.ts components/workbench/workbench-client.tsx components/jobs/job-compare-client.tsx components/jobs/job-qa-report.tsx tests/jobs/applied-asset-summary.test.ts`
- `[已通过]` `pnpm test:unit tests/api/api-key-verification.test.ts tests/jobs/applied-asset-summary.test.ts tests/components/workbench-client.test.tsx tests/components/job-compare-client.test.tsx tests/components/job-qa-report.test.tsx tests/jobs/mainline-asset-visibility-stress.test.tsx`（6 files / 30 tests）
- `[已通过]` `pnpm lint`（430 files）
- `[已通过]` `pnpm test`（66 files / 346 tests）
- `[已通过]` `pnpm build`
- `[已通过]` `pnpm exec biome check lib/dubbing/voice-registry.ts app/api/dubbing/voices/route.ts tests/jobs/voice-registry.test.ts`
- `[已通过]` `pnpm test:unit tests/jobs/voice-registry.test.ts tests/components/dubbing-form.test.tsx tests/jobs/dubbing-run-plan.test.ts`（3 files / 24 tests）
- `[已通过]` `pnpm exec biome check lib/dubbing/voice-registry.ts lib/dubbing/minimax-voice-registry-store.ts lib/dubbing/dubbing-run-plan.ts app/api/dubbing/route.ts app/api/dubbing/voices/route.ts types/core/job.ts tests/jobs/voice-registry.test.ts tests/jobs/dubbing-run-plan.test.ts tests/api/dubbing-route.test.ts`
- `[已通过]` `pnpm test:unit tests/jobs/voice-registry.test.ts tests/jobs/dubbing-run-plan.test.ts tests/api/dubbing-route.test.ts tests/components/dubbing-form.test.tsx`（4 files / 52 tests）
- `[已通过]` `pnpm build`
- `[已通过]` `pnpm exec biome check components/dubbing/dubbing-form.tsx app/api/dubbing/voices/route.ts tests/components/dubbing-form.test.tsx`
- `[已通过]` `pnpm test:unit tests/components/dubbing-form.test.tsx tests/jobs/voice-registry.test.ts tests/jobs/dubbing-run-plan.test.ts tests/api/dubbing-route.test.ts`（4 files / 53 tests）
- `[已通过]` `pnpm lint`（433 files）
- `[已通过]` `pnpm test`（67 files / 354 tests）
- `[已通过]` `pnpm build`
- `[已通过]` `pnpm exec biome check --write components/dubbing/dubbing-form.tsx app/api/dubbing/voices/route.ts tests/components/dubbing-form.test.tsx tests/api/dubbing-voices-route.test.ts components/settings/minimax-voice-registry-editor.tsx components/settings/minimax-config.tsx tests/components/minimax-voice-registry-editor.test.tsx tests/jobs/voice-registry.test.ts`
- `[已通过]` `pnpm test:unit tests/components/dubbing-form.test.tsx tests/components/minimax-voice-registry-editor.test.tsx tests/api/dubbing-voices-route.test.ts tests/jobs/voice-registry.test.ts tests/jobs/dubbing-run-plan.test.ts tests/api/dubbing-route.test.ts tests/api/mainline-free-route-stress.test.ts`（7 files / 74 tests）
- `[已通过]` `pnpm lint`（437 files）
- `[已通过]` `pnpm test`（70 files / 379 tests）
- `[已通过]` `pnpm build`
- `[已通过]` `pnpm test:stress`（4 files / 7 tests）
- `[已通过]` `pnpm exec biome check --write app/api/api-keys/route.ts app/settings/page.tsx components/settings/minimax-config.tsx tests/api/api-keys.test.ts tests/components/minimax-config.test.tsx`
- `[已通过]` `pnpm test:unit tests/api/api-keys.test.ts tests/components/minimax-config.test.tsx tests/api/dubbing-voices-route.test.ts tests/components/minimax-voice-registry-editor.test.tsx tests/components/dubbing-form.test.tsx`（5 files / 37 tests）
- `[已通过]` `pnpm lint`（438 files）
- `[已通过]` `pnpm test`（71 files / 382 tests）
- `[已通过]` `pnpm build`
- `[已通过]` `pnpm test:stress`（4 files / 7 tests）
- `[已通过]` `pnpm exec biome check --write lib/dubbing/voice-registry.ts app/api/dubbing/voices/route.ts components/settings/minimax-voice-registry-editor.tsx tests/jobs/voice-registry.test.ts tests/api/dubbing-voices-route.test.ts tests/components/minimax-voice-registry-editor.test.tsx docs/dubbing-guide.md docs/agent/legacy-editing-removal-plan.md`（6 files；Markdown 被当前 Biome 配置忽略）
- `[已通过]` `pnpm test:unit tests/jobs/voice-registry.test.ts tests/api/dubbing-voices-route.test.ts tests/components/minimax-voice-registry-editor.test.tsx tests/jobs/dubbing-run-plan.test.ts tests/api/dubbing-route.test.ts tests/components/dubbing-form.test.tsx`（6 files / 81 tests）
- `[已通过]` `pnpm lint`（443 files）
- `[已通过]` `pnpm test`（75 files / 420 tests）
- `[已通过]` `pnpm build`
- `[已通过]` `pnpm lint`（443 files；计划记录更新后复跑）
- `[已通过]` `pnpm exec biome check --write lib/dubbing/voice-registry.ts tests/jobs/voice-registry.test.ts tests/api/mainline-free-route-stress.test.ts`
- `[已通过]` `pnpm test:unit tests/jobs/voice-registry.test.ts`（1 file / 13 tests）
- `[已通过]` `pnpm test:unit tests/api/mainline-free-route-stress.test.ts`（1 file / 3 tests）
- `[已通过]` `pnpm test:stress`（4 files / 8 tests）
- `[已通过]` `pnpm exec vitest run tests/api/jobs-route.test.ts tests/api/specialized-endpoint.test.ts tests/workflow/workflows.test.ts tests/api/dubbing-voices-route.test.ts`（4 files / 28 tests）
- `[已通过]` 文本检查确认 `docs/agent/testing/dynamic/cloud-api.md` 不再保留可复制执行的生产域名旧 `/api/jobs` POST、`/api/styles` POST/PUT/DELETE 或 R2 旧混剪素材示例。
- `[已通过]` `pnpm lint`（443 files）
- `[已通过]` `pnpm test`（75 files / 422 tests）
- `[已通过]` `pnpm build`
- `[已通过]` `pnpm exec biome check --write tests/jobs/mainline-artifact-delivery-stress.test.ts docs/agent/testing/dynamic/cloud-edge-cases.md docs/agent/testing/dynamic/cloud-api.md docs/agent/testing/dynamic/local-ui.md`（1 TS file；Markdown 被当前 Biome 配置忽略）
- `[已通过]` 文本检查确认云端动态测试文档无完整 `cca_...` token、无生产 `/api/dubbing`/`/api/jobs` 可复制 URL、无真实 Zeabur restart id。
- `[已通过]` `pnpm test:unit tests/jobs/mainline-artifact-delivery-stress.test.ts`（1 file / 2 tests）
- `[已通过]` `pnpm test:unit tests/docs/mainline-positioning-guard.test.ts`（1 file / 2 tests）
- `[已通过]` `pnpm test:stress`（4 files / 9 tests）
- `[已通过]` `pnpm lint`（443 files）
- `[已通过]` `pnpm test`（75 files / 423 tests）
- `[已通过]` `pnpm build`
- `[已通过]` `pnpm exec biome check --write tests/docs/dynamic-testing-safety-guard.test.ts docs/agent/testing/dynamic/cloud-edge-cases.md docs/agent/testing/dynamic/local-edge-cases.md docs/agent/testing/dynamic/local-api.md docs/agent/testing/dynamic/cloud-api.md docs/agent/testing/dynamic/cloud-ui.md`
- `[已通过]` `pnpm test:unit tests/docs/dynamic-testing-safety-guard.test.ts tests/docs/mainline-positioning-guard.test.ts`（2 files / 4 tests）
- `[已通过]` `pnpm test:stress`（4 files / 9 tests）
- `[已通过]` `pnpm lint`（444 files）
- `[已通过]` `pnpm test`（76 files / 425 tests）
- `[已通过]` `pnpm build`
- `[已通过]` `pnpm exec biome check --write tests/jobs/mainline-closed-loop-smoke-stress.test.tsx package.json`
- `[已通过]` `pnpm test:unit tests/jobs/mainline-closed-loop-smoke-stress.test.tsx`（1 file / 1 test）
- `[已通过]` `pnpm test:stress`（5 files / 10 tests）
- `[已通过]` `pnpm lint`（445 files）
- `[已通过]` `pnpm test`（77 files / 426 tests）
- `[已通过]` `pnpm build`
- `[已通过]` `pnpm exec biome check --write lib/ingest/artifact-definitions.ts lib/ingest/artifacts.ts lib/ingest/dubbing-content-brief.ts lib/loaders/job-loaders.ts app/api/jobs/[id]/route.ts components/workbench/workbench-client.tsx tests/ingest/dubbing-content-brief.test.ts tests/components/workbench-client.test.tsx`
- `[已通过]` `pnpm test:unit tests/ingest/dubbing-content-brief.test.ts tests/components/workbench-client.test.tsx tests/api/ingest-dubbing-handoff.test.ts`（3 files / 21 tests）
- `[已通过]` `pnpm test:unit tests/api/job-detail.test.ts tests/api/job-artifact.test.ts tests/api/ingest-artifact.test.ts tests/jobs/mainline-closed-loop-smoke-stress.test.tsx`（4 files / 44 tests）
- `[已通过]` `pnpm test:stress`（5 files / 10 tests）
- `[已通过]` `pnpm exec biome check --write lib/ingest/dubbing-content-brief.ts components/dubbing/dubbing-workbench.tsx tests/ingest/dubbing-content-brief.test.ts tests/components/workbench-client.test.tsx tests/components/dubbing-workbench-prefill.test.tsx tests/api/job-detail.test.ts tests/components/job-compare-client.test.tsx lib/jobs/dubbing-qa.ts lib/jobs/dubbing-qa-summary.ts tests/jobs/dubbing-qa.test.ts tests/api/job-qa.test.ts tests/jobs/dubbing-qa-backfill.test.ts tests/jobs/dubbing-rerun.test.ts tests/jobs/mainline-asset-visibility-stress.test.tsx tests/jobs/mainline-closed-loop-smoke-stress.test.tsx tests/jobs/sample-to-full-stress.test.ts tests/api/mainline-free-route-stress.test.ts`（17 files）
- `[已通过]` `pnpm test:unit tests/ingest/dubbing-content-brief.test.ts tests/components/workbench-client.test.tsx tests/components/dubbing-workbench-prefill.test.tsx tests/api/job-detail.test.ts tests/api/ingest-dubbing-handoff.test.ts`（5 files / 40 tests）
- `[已通过]` `pnpm test:unit tests/jobs/dubbing-qa.test.ts tests/api/job-qa.test.ts tests/jobs/dubbing-qa-summary.test.ts tests/jobs/dubbing-qa-backfill.test.ts tests/jobs/dubbing-rerun.test.ts tests/jobs/mainline-asset-visibility-stress.test.tsx tests/jobs/mainline-closed-loop-smoke-stress.test.tsx tests/jobs/sample-to-full-stress.test.ts tests/api/mainline-free-route-stress.test.ts tests/components/job-compare-client.test.tsx`（10 files / 43 tests）
- `[已通过]` `pnpm test:stress`（5 files / 10 tests）
- `[已通过]` `pnpm lint`（445 files）
- `[已通过]` `pnpm test`（77 files / 436 tests；e2e 命令通过）
- `[已通过]` `pnpm build`

## 当前建议下一步

继续阶段 4 小闭环：

64. `[已完成]` provider smoke dry-run / readiness gate normal form 小闭环：
    - `lib/workflow/closed-loop-readiness.ts` 新增 `provider_gates[]` 的 canonical gate 字段：`runtime`、`provider`、`capability`、`run_mode`、`risk`、`confirmation`，并返回 `required_confirmations`。
    - `/ingest` 的「闭环预检」显示 Provider smoke 预检，区分真实调用、dry-run、阻断、可跳过、外部调用、可能费用和写入产物。
    - 文档同步 `/api/ingest/dubbing-readiness` 的 gate 语义，动态 API/UI 测试在创建配音任务前先检查 `provider_gates[]`。
    - `[已通过]` `pnpm exec biome check --write lib/workflow/closed-loop-readiness.ts components/ingest/ingest-workbench.tsx tests/api/closed-loop-readiness.test.ts tests/components/ingest-workbench-readiness.test.ts docs/dubbing-guide.md docs/agent/ai-integration.md docs/agent/video-processing.md docs/agent/testing/dynamic/local-api.md docs/agent/testing/dynamic/cloud-api.md docs/agent/testing/dynamic/local-ui.md docs/agent/testing/dynamic/cloud-ui.md`
    - `[已通过]` `pnpm test:unit tests/api/closed-loop-readiness.test.ts tests/components/ingest-workbench-readiness.test.ts`（2 files / 10 tests）
    - `[已通过]` `pnpm test:unit tests/docs/dynamic-testing-safety-guard.test.ts`（1 file / 2 tests）
    - `[已通过]` `pnpm test:stress`（5 files / 10 tests）
    - `[已通过]` `pnpm lint`（445 files）
    - `[已通过]` `pnpm test`（77 files / 437 tests；e2e 命令通过）
    - `[已通过]` `pnpm build`

65. `[已完成]` provider gate / MiniMax proof 强制校验闭环：
    - `/api/dubbing` 改为直接根据真实 provider 凭证意图计算 `translation_provider` / `minimax_tts` 必需确认，不再依赖 readiness 降级状态决定付费 gate。
    - `translate-text` 与 `minimax-tts` step 增加运行时硬校验：只要真实翻译 key 或 MiniMax key 存在，缺少对应 `confirmed_gate_ids` 就在调用 provider 前失败。
    - `scripts/voice_cloner.py` 的 MiniMax provider 调用边界也要求 `minimax_tts` gate；即使环境里有 key，未确认 gate 时也只会输出 placeholder，不会直接触发付费调用。
    - `minimax-tts` provider proof 增加段级来源、状态、非静音、WAV 文件存在和输出目录归属校验，静音、占位或伪造来源不能算作真实 provider 成功。
    - 动态测试文档与静态 API 路由文档示例补齐 `confirmed_gate_ids`，避免 API 示例绕过 provider confirmation。
    - `[已通过]` `pnpm test:unit tests/workflow/minimax-tts-audit.test.ts tests/scripts/voice-cloner-script.test.ts tests/docs/api-routes-safety-guard.test.ts tests/docs/dynamic-testing-safety-guard.test.ts tests/api/dubbing-route.test.ts`（5 files / 43 tests）
    - `[已通过]` `python -m py_compile scripts\voice_cloner.py`
    - `[已通过]` `pnpm test:stress`（5 files / 10 tests）
    - `[已通过]` `pnpm lint`（447 files）
    - `[已通过]` `pnpm test`（79 files / 449 tests；e2e 命令通过）
    - `[已通过]` `pnpm build`

66. `[已完成]` provider smoke 执行入口 normal form 小闭环：
    - `POST /api/ingest/dubbing-readiness` 新增 provider smoke command：默认 `mode: "dry_run"`，只验证 readiness/gate 结构，不执行 YouTube、Gemini 或 MiniMax 外部调用。
    - 真实 provider smoke 使用 `mode: "real_provider_smoke"`，必须提交 readiness 的完整 `required_confirmations`；缺少或未知 `confirmed_gate_ids` 时返回 400，且不会执行外部调用。
    - `/ingest` 闭环预检卡新增 dry-run 触发按钮，只调用默认 dry-run 入口并显示最近 gate 通过数。
    - 补齐静态 API 文档、动态测试文档和安全 guard，确保真实 provider smoke 示例必须带 `ALLOW_PAID_DYNAMIC_TESTS` 与 `confirmed_gate_ids`。
    - 顺手修复监察员发现的旧 TTS 旁路：`POST /api/api-keys/verify` 对 Fish Audio 验证也要求 legacy TTS 显式确认。
    - 监察员复核后补强：真实 provider smoke 的 `youtube_download` gate 必须带 `source_url` 并先执行 YouTube metadata probe；YouTube 未通过时不会继续 Gemini/MiniMax 付费 provider 验证，避免完整确认但实际未 smoke 的假阳性。
    - 动态文档 guard 扩展到 `/api/api-keys` 与 `/api/api-keys/verify`，MiniMax key 保存示例必须同时带 `ALLOW_PAID_DYNAMIC_TESTS` 与 `confirmPaidVerification`。
    - 修复 `tests/db/jobs-repository.test.ts` 对全局 DB 总数的并发脆弱断言，改为检查 legacy marker 未落库。
    - `[已通过]` `pnpm test:unit tests/api/ingest-dubbing-readiness-smoke-route.test.ts tests/api/api-key-verify-route.test.ts tests/api/closed-loop-readiness.test.ts tests/docs/api-routes-safety-guard.test.ts tests/docs/dynamic-testing-safety-guard.test.ts`（5 files / 19 tests）
    - `[已通过]` `pnpm exec biome check --write components\ingest\ingest-workbench.tsx tests\docs\api-routes-safety-guard.test.ts`（2 files）
    - `[已通过]` `pnpm exec biome check --write app\api\ingest\dubbing-readiness\route.ts tests\api\ingest-dubbing-readiness-smoke-route.test.ts tests\docs\dynamic-testing-safety-guard.test.ts tests\docs\api-routes-safety-guard.test.ts`（4 files）
    - `[已通过]` `pnpm test:unit tests\api\ingest-dubbing-readiness-smoke-route.test.ts tests\docs\dynamic-testing-safety-guard.test.ts tests\docs\api-routes-safety-guard.test.ts`（3 files / 11 tests）
    - `[已通过]` `pnpm test:unit tests\db\jobs-repository.test.ts`（1 file / 4 tests）
    - `[已通过]` `pnpm lint`（449 files）
    - `[已通过]` `pnpm test`（81 files / 461 tests；e2e 命令通过）
    - `[已通过]` `pnpm build`
    - `[已通过]` `pnpm test:stress`（5 files / 10 tests）

67. `[已完成]` provider smoke audit 沉淀小闭环：
    - 把 `POST /api/ingest/dubbing-readiness` 的 dry-run / real provider smoke 结果收敛成 `ProviderSmokeAudit` normal form：`schema_version`、`mode`、`verdict`、`external_calls_executed`、`result_counts`、`top_blockers`、确认项和 gate rows。
    - 请求带 `job_id` 时，将同一份 audit 作为 `job_logs` 事件写入该任务；API token 只能写入自己创建的任务。
    - `GET /api/jobs/:id` 暴露最新 `providerSmokeAudit`，避免 report/job surface 解析 raw log details。
    - audit 只保存脱敏 `source_ref`，不长期保存完整 `source_url`、provider verification raw payload 或 probe raw payload。
    - TEAM 监察补充已记录后续风险：voice metadata 的“运行可跑”和“交付审计就绪”语义仍应拆清；provider gate id 后续应进一步集中，避免 readiness、dubbing API、UI 白名单漂移。
    - `[已通过]` `pnpm test:unit tests\docs\api-routes-safety-guard.test.ts tests\docs\dynamic-testing-safety-guard.test.ts tests\api\ingest-dubbing-readiness-smoke-route.test.ts tests\jobs\provider-smoke-audit.test.ts tests\api\job-detail.test.ts`（5 files / 20 tests）
    - `[已通过]` `pnpm lint`（451 files）
    - `[已通过]` `pnpm test`（82 files / 468 tests；e2e 命令通过）
    - `[已通过]` `pnpm build`

68. `[已完成]` readiness runtime / delivery audit 语义拆分小闭环：
    - `ClosedLoopReadiness` 保留 `production_ready` 作为“真实运行链路可跑”，新增 `runtime_ready`、`runtime_readiness_level`、`delivery_audit_ready` 和 `delivery_audit`。
    - `delivery_audit` 先以声线用途/披露元数据为最小交付审计 primitive；`voice_metadata_ready=false` 不阻断 smoke 或真实运行，但会让交付审计保持 warning。
    - `/ingest` 闭环预检把交付审计作为单独 badge 展示；运行可跑但审计缺失时不再显示成完整绿色状态。
    - TEAM 监察确认 report/QA/job detail 目前不直接消费 `ClosedLoopReadiness`；本轮不把 runtime readiness 混入旧剪辑 report 或 delivery package，后续若要扩展交付包，应在 `delivery-package` 层单独建交付审计正常形。
    - `[已通过]` `pnpm test:unit tests\api\closed-loop-readiness.test.ts tests\components\ingest-workbench-readiness.test.ts tests\api\ingest-dubbing-readiness-smoke-route.test.ts tests\docs\api-routes-safety-guard.test.ts tests\docs\dynamic-testing-safety-guard.test.ts`（5 files / 26 tests）
    - `[已通过]` `pnpm lint`（451 files）
    - `[已通过]` `pnpm test`（82 files / 469 tests；e2e 命令通过）
    - `[已通过]` `pnpm build`

69. `[已完成]` delivery package 交付审计正常形小闭环：
    - `DeliveryPackage` 新增 `deliveryAuditReadiness`，统一表达成片文件、`delivery_readme`、`qa_json` 和 `voice_disclosure` 的交付审计状态。
    - `buildDeliveryAuditReadiness()` 以 `DeliveryPackageItem` 和 `VoiceUsageDisplay` 为输入，输出 `ready/status/label/guidance/blockers/warnings/checks`；旧 `items`、`voiceUsage` 和下载 contract 保持稳定。
    - report/workbench 的交付包面板会显示交付审计 badge；QA 页面和 `GET /api/jobs/:id/qa` 复用同一份 `deliveryAuditReadiness`，不再各自推导交付审计。
    - `delivery-readme.md` 会写入交付审计状态；声线披露未知或未确认时保持 warning，成片不可下载时保持 blocked。
    - `[已通过]` `pnpm test:unit tests\jobs\job-display.test.ts tests\components\report-delivery-package-section.test.tsx tests\components\job-qa-report.test.tsx tests\api\job-qa.test.ts tests\api\job-detail.test.ts`（5 files / 41 tests）
    - `[已通过]` `pnpm lint`（451 files）
    - `[已通过]` `pnpm test`（82 files / 470 tests；e2e 命令通过）
    - `[已通过]` `pnpm build`

70. `[已完成]` provider gate confirmation scope 正常形小闭环：
    - 新增 `lib/workflow/provider-gate-confirmation.ts`，集中 `confirmed_gate_ids` 的 trim/dedupe、known/required 派生、missing/unknown 校验和 scope 常量。
    - `provider_smoke` scope 保留 `youtube_download + translation_provider + minimax_tts`；`dubbing_job` scope 只接受 `translation_provider + minimax_tts`，避免普通 `/api/dubbing` 创建误继承 YouTube smoke gate。
    - `/api/dubbing`、`/api/ingest/dubbing-readiness`、`ClosedLoopReadiness`、`translate-text` 和 `minimax-tts` 已迁到同一 primitive；旧 `validateClosedLoopProviderConfirmations()` 保留为兼容包装。
    - `/dubbing` UI 的 provider gate 白名单改用同一组 `DUBBING_PROVIDER_CONFIRMATION_IDS`，不再在前端手写字符串集合。
    - `[已通过]` `pnpm test:unit tests\workflow\provider-gate-confirmation.test.ts tests\api\closed-loop-readiness.test.ts tests\api\dubbing-route.test.ts tests\api\ingest-dubbing-readiness-smoke-route.test.ts tests\workflow\translate-text.test.ts tests\workflow\minimax-tts-audit.test.ts`（6 files / 65 tests）
    - `[已通过]` `pnpm lint`（453 files）
    - `[已通过]` `pnpm test`（83 files / 475 tests；e2e 命令通过）
    - `[已通过]` `pnpm build`

71. `[已完成]` provider gate 页面确认与真实 smoke 顺序执行小闭环：
    - `provider-gate-confirmation` 新增 `/dubbing` provider confirmation rows 正常形，统一从 readiness gates 过滤 `translation_provider + minimax_tts`，并排除 `youtube_download` smoke scope。
    - `/dubbing` 表单恢复与提交 `confirmedGateIds` 时统一 trim/dedupe，避免重跑或 API 客户端把非规范确认 ID 写入任务配置。
    - `/api/dubbing` 在校验通过后把规范化 `confirmed_gate_ids` 写入 `buildDubbingRunPlan`，错误响应同时保留旧 `*_gate_ids` 字段并补充 canonical `*_confirmations` 字段。
    - `real_provider_smoke` 改为按 provider gates 顺序执行；YouTube 或本地 ASR/ffmpeg runtime gate 阻断时，后续 Gemini/MiniMax 付费 provider gate 会标为 skipped，不再并发执行。
    - `minimax-tts` 在写入 `logApiCall` 前先校验 `minimax_tts` gate；缺少确认时不会产生日志误导，也不会 spawn provider bridge。
    - `[已通过]` `pnpm test:unit tests\api\ingest-dubbing-readiness-smoke-route.test.ts tests\api\dubbing-route.test.ts tests\workflow\provider-gate-confirmation.test.ts tests\components\dubbing-form.test.tsx tests\components\dubbing-workbench-submit.test.tsx tests\workflow\minimax-tts-audit.test.ts`（6 files / 77 tests）
    - `[已通过]` `pnpm lint`（453 files）
    - `[已通过]` `pnpm test`（83 files / 478 tests；e2e 命令通过）
    - `[已通过]` `pnpm build`

72. `[已完成]` Wav2Lip 可选链路与环境/交付审计语义小闭环：
    - `ClosedLoopReadiness` 继续按 primitive-first 正常形拆分为 `required_runtime`、`live_provider`、`optional_capability`、`audit_policy`，避免把可选口型同步误算成正式生产阻断。
    - Wav2Lip/RVC 缺失时只设置 `lipsync_ready=false` 和 `wav2lip` gate `optional_skip`，不再影响 `production_ready`、`runtime_readiness_level`、`delivery_audit_ready` 或 `missing_required`。
    - `/ingest` 的环境审计 badge 从 `已审计` 改为 `审计就绪`，避免和 job delivery package 的 artifact 审计混淆。
    - 可选 provider gate 的 blocker 文案改为 `跳过原因`，阻断型 gate 仍显示 `阻断`。
    - 文档明确区分环境级 `delivery_audit` 与 job 级 `deliveryPackage.deliveryAuditReadiness`；前者不检查 `final_video`、`delivery_readme`、`qa_json`、`voice_disclosure`。
    - 测试补齐 schema isolation，确保 readiness 响应不混入 delivery package 审计字段。
    - `[已通过]` `pnpm test:unit tests\api\closed-loop-readiness.test.ts tests\components\ingest-workbench-readiness.test.ts tests\api\ingest-dubbing-readiness-smoke-route.test.ts tests\docs\api-routes-safety-guard.test.ts tests\docs\dynamic-testing-safety-guard.test.ts`（5 files / 30 tests）
    - `[已通过]` `pnpm lint`（453 files）
    - `[已通过]` `pnpm test`（83 files / 481 tests；e2e 命令通过）
    - `[已通过]` `pnpm build`

73. `[已完成]` /dubbing provider confirmation fallback 正常形小闭环：
    - `/dubbing` 的 provider confirmation 从“可选对象”收敛为 `loading / ready / unavailable` 三态，只有 `ready` 才能表达“无需确认”或“已确认”。
    - `/api/ingest/dubbing-readiness` 非 2xx、异常或响应缺少 `provider_gates[]` 时，页面会显示真实 provider 调用不可确认，并禁用提交，避免提交空 `confirmed_gate_ids` 后才被服务端拒绝。
    - `DubbingForm` 的运行前摘要、检查清单和底部提示同步显示 `检查中 / 不可确认 / 待确认 / 已确认 / 无需确认`，保持用户提交前能看见费用确认状态。
    - 已保留成功读取 `provider_gates: []` 时的“无需确认”路径，避免把真实空 gate 状态误判为异常。
    - TEAM 监察确认 `providerSmokeAudit` 展示是独立 P2 闭环，本轮不混入 job detail/workbench 展示层。
    - `[已通过]` `pnpm exec biome check --write components\dubbing\dubbing-form.tsx components\dubbing\dubbing-workbench.tsx tests\components\dubbing-workbench-submit.test.tsx`
    - `[已通过]` `pnpm test:unit tests\components\dubbing-workbench-submit.test.tsx tests\components\dubbing-form.test.tsx`（2 files / 23 tests）
    - `[已通过]` `pnpm lint`（453 files）
    - `[已通过]` `pnpm test`（83 files / 482 tests；e2e 命令通过）
    - `[已通过]` `pnpm build`

74. `[已完成]` provider smoke audit job detail / workbench 展示闭环：
    - `JobDetailResponse` 将 `providerSmokeAudit` 收敛为稳定顶层字段：`ProviderSmokeAudit | null`；没有记录时返回 `null`，不再让 API、direct loader 和客户端类型漂移。
    - `loadJobDetailDirect()` 与 `GET /api/jobs/:id` 对齐读取 `findLatestProviderSmokeAudit(jobId)`；API response 使用 `satisfies JobDetailResponse` 防止字段再次漂移。
    - Workbench 增加 job 级 `ProviderSmokeAuditPanel`，直接消费 `jobDetail.providerSmokeAudit`，不解析 raw logs，也不混入 `deliveryPackage.deliveryAuditReadiness`。
    - 面板显示 mode、verdict、counts、外部调用状态、`checked_at` 和全部 `top_blockers`；content ingest job 与 dubbing job 都可展示同一份 smoke 证据。
    - Workbench 轮询会更新 `providerSmokeAudit`，当 API 返回 `null` 时清除旧 smoke 证据，避免 stale 状态残留。
    - `[已通过]` `pnpm exec biome check --write lib\loaders\job-loaders.ts app\api\jobs\[id]\route.ts components\workbench\workbench-client.tsx tests\components\workbench-client.test.tsx tests\loaders\job-loaders.test.ts`
    - `[已通过]` `pnpm test:unit tests\loaders\job-loaders.test.ts tests\api\job-detail.test.ts tests\components\workbench-client.test.tsx`（3 files / 20 tests）
    - `[已通过]` `pnpm lint`（454 files）
    - `[已通过]` `pnpm test`（84 files / 488 tests；e2e 命令通过）
    - `[已通过]` `pnpm build`

75. `[已完成]` report provider smoke evidence 小闭环：
    - `JobReportData` 新增 `providerSmokeAudit: ProviderSmokeAudit | null`，report loader 与 job detail 同源读取 `findLatestProviderSmokeAudit(jobId)`。
    - 抽出共享 `ProviderSmokeAuditPanel`，Workbench 和 Report 复用同一展示 primitive，显示 mode、verdict、counts、外部调用状态、`checked_at` 和 `top_blockers`。
    - Report 目录新增 `Provider Smoke 证据` 条件章节；有 audit 时展示，没有 audit 时隐藏。
    - 保持 provider smoke 是独立 evidence：不解析 raw logs，不改 `deliveryPackage.deliveryAuditReadiness`，不影响 QA score/verdict。
    - TEAM 监察确认本轮不把 smoke evidence 混入 `DubbingQaReport` 主体；如后续需要 QA 页展示，也应作为顶层旁路 evidence。
    - `[已通过]` `pnpm exec biome check --write components\jobs\provider-smoke-audit-panel.tsx components\workbench\workbench-client.tsx components\report\ReportLayout.tsx types\api\job-report.ts lib\loaders\report-loader.ts tests\components\report-layout-legacy-cleanup.test.tsx tests\components\report-basic-summary-sections.test.tsx tests\loaders\report-loader.test.ts`
    - `[已通过]` `pnpm test:unit tests\loaders\report-loader.test.ts tests\components\report-layout-legacy-cleanup.test.tsx tests\components\report-basic-summary-sections.test.tsx tests\components\workbench-client.test.tsx`（4 files / 29 tests）
    - `[已通过]` `pnpm lint`（456 files）
    - `[已通过]` `pnpm test`（85 files / 491 tests；e2e 命令通过）
    - `[已通过]` `pnpm build`

76. `[已完成]` delivery evidence rows 正常形小闭环：
    - `DeliveryPackage` 新增 `deliveryEvidence?: DeliveryEvidenceRow[]`，作为 job 级交付检查证据台账；`deliveryAuditReadiness` 仍只由成片文件、README、QA JSON、声线披露四个硬交付项决定。
    - 新增 `buildDeliveryEvidenceRows()`，当前生成三类 evidence：`qa_freshness`、`manual_final_listen`、`provider_smoke`。
    - QA freshness 只展示已有 QA summary 和 fingerprint 线索；由于本轮未重新计算当前 fingerprint，状态保守标为 `unknown`，避免把 stale QA 当作 fresh。
    - 人工终听没有真实持久化来源时标为 `not_recorded`；不会从 QA ready、成片存在或交付审计 ready 推断“已终听”。
    - Provider smoke evidence 复用 `ProviderSmokeAudit`，并通过 job detail/report/dubbing detail/artifact README 路径传入 delivery package；仍不影响 QA score/verdict 或交付审计 verdict。
    - `DeliveryPackagePanel` 和 `delivery-readme.md` 会显示同一份 `deliveryEvidence`，避免证据只存在 UI 而没有交付文件线索。
    - `[已通过]` `pnpm exec biome check --write lib\jobs\delivery-package.ts components\jobs\delivery-package-panel.tsx lib\loaders\job-loaders.ts lib\loaders\report-loader.ts app\api\jobs\[id]\route.ts app\api\dubbing\[id]\route.ts app\api\jobs\[id]\artifact\route.ts tests\jobs\job-display.test.ts tests\components\report-delivery-package-section.test.tsx tests\api\job-detail.test.ts tests\api\job-artifact.test.ts`
    - `[已通过]` `pnpm test:unit tests\jobs\job-display.test.ts tests\components\report-delivery-package-section.test.tsx tests\api\job-detail.test.ts tests\api\job-artifact.test.ts tests\loaders\job-loaders.test.ts tests\loaders\report-loader.test.ts tests\components\workbench-client.test.tsx`（7 files / 86 tests）
    - `[已通过]` `pnpm lint`（456 files）
    - `[已通过]` `pnpm test`（85 files / 493 tests；e2e 命令通过）
    - `[已通过]` `pnpm build`

77. `[已完成]` QA freshness current 判定小闭环：
    - 新增 `dubbing-qa-freshness` primitive：复用 `getJobArtifactsFingerprint`、`buildDubbingQaInputFingerprint` 与 `isDubbingQaSummaryCurrent`，把当前 fingerprint 判定作为已计算输入传给 delivery package。
    - `delivery-package` 仍只负责渲染 evidence row；`qa_freshness` 在有当前判定时显示 `ready/warning`，无判定时保留 `unknown` fallback，未生成 QA 时仍为 `not_recorded`。
    - 修复 `stateOverride` 未进入交付证据的风险：report/README 等传入 DB state 的路径现在能读取 `qa_summary` 与 `manual_final_listen`，不会误显示成未记录。
    - `deliveryAuditReadiness` 不消费 `qa_freshness`、`manual_final_listen` 或 `provider_smoke`；stale QA 与 blocked smoke 只作为交付证据展示，不改变交付审计 verdict 或 QA verdict。
    - job detail、dubbing detail、report loader 与 delivery README route 都会尝试计算 current QA freshness；计算失败时降级为 `unknown`，不阻断页面/API。
    - `[已通过]` `pnpm exec biome check --write lib\jobs\job-state-override.ts lib\jobs\dubbing-qa-freshness.ts lib\jobs\delivery-package.ts lib\loaders\job-loaders.ts lib\loaders\report-loader.ts app\jobs\[id]\report\page.tsx app\api\jobs\[id]\route.ts app\api\dubbing\[id]\route.ts app\api\jobs\[id]\artifact\route.ts tests\jobs\job-display.test.ts tests\jobs\dubbing-qa-freshness.test.ts tests\loaders\report-loader.test.ts tests\api\job-artifact.test.ts`
    - `[已通过]` `pnpm test:unit tests\jobs\job-display.test.ts tests\jobs\dubbing-qa-freshness.test.ts tests\api\job-artifact.test.ts tests\api\job-detail.test.ts tests\loaders\job-loaders.test.ts tests\loaders\report-loader.test.ts tests\components\report-delivery-package-section.test.tsx tests\components\workbench-client.test.tsx`（8 files / 90 tests）
    - `[已通过]` `pnpm lint`（459 files）
    - `[已通过]` `pnpm test`（86 files / 497 tests；e2e 命令通过）
    - `[已通过]` `pnpm build`

78. `[已完成]` 人工终听记录入口正常形小闭环：
    - 新增 `ManualFinalListenRecord` 正常形：`pending/passed/failed/waived + note + checked_at`，并用同一张 rule table 维护 UI 文案、交付证据状态和交付审计策略。
    - QA 页面新增人工终听记录入口；只在自动 QA 后记录最终听感确认，不混入自动 QA 分数或 verdict。
    - 新增 `PATCH /api/jobs/:id/manual-final-listen`，复用认证、token 归属、限流和事务写入；只允许已完成的转译配音任务写入。
    - 人工终听写入 `job_current_state.step_context.manual_final_listen`，保留现有 `qa_summary`，且缺少旧 step context 时不再制造 Gemini/分镜默认上下文。
    - Delivery evidence 继续显示人工终听状态；已记录的 `failed` 会阻断交付审计，`pending/waived` 会让交付审计进入待补，未记录时仍作为旁路证据提示，不破坏旧任务交付包读取。
    - `GET /api/jobs/:id/qa` 和 QA 页面会回传/展示已有人工终听记录；交付包面板保持只读证据，不放记录按钮。
    - TEAM 监察复核后已处理两项 normal form 风险：状态映射散落、缺 state 时写入伪 step context。
    - `[已通过]` `pnpm exec biome check --write lib\jobs\manual-final-listen.ts lib\jobs\manual-final-listen-persistence.ts components\jobs\manual-final-listen-panel.tsx lib\jobs\delivery-package.ts tests\api\job-manual-final-listen.test.ts tests\components\job-qa-report.test.tsx tests\jobs\job-display.test.ts`
    - `[已通过]` `pnpm test:unit tests\api\job-manual-final-listen.test.ts tests\components\job-qa-report.test.tsx tests\components\report-delivery-package-section.test.tsx tests\jobs\job-display.test.ts tests\api\job-qa.test.ts tests\api\job-artifact.test.ts tests\api\job-detail.test.ts`（7 files / 97 tests）
    - `[已通过]` `pnpm lint`（464 files）
    - `[已通过]` `pnpm test`（87 files / 510 tests；e2e 命令通过）
    - `[已通过]` `pnpm build`

79. `[已完成]` provider 调用边界正常形小闭环：
    - 将 provider 运行边界收敛成 `dry_run_provider_smoke`、`real_provider_smoke`、`dubbing_job` 三类 rule table，统一描述 endpoint、scope、确认 gate、外部调用、付费风险、任务/产物副作用。
    - `/api/ingest/dubbing-readiness` 的 `real_provider_smoke` 固定要求 `youtube_download + translation_provider + minimax_tts`，不再从 dry-run fallback 动态推导真实 smoke 的确认范围。
    - 正式 `/api/dubbing` job 只接受 `translation_provider + minimax_tts`，明确排除 `youtube_download`；YouTube/网页来源必须先走 `/ingest` 保存本地视频后再进入配音。
    - `/dubbing` 提交前会把 blocked provider gate 显示为不可确认并禁用提交，避免等 API 或付费步骤后才失败。
    - 动态测试文档和 API 文档同步补齐 provider boundary 表、`config.confirmed_gate_ids` 示例，以及正式 dubbing job 不混入 YouTube gate 的负向约束。
    - TEAM 监察复核未发现 P0/P1/P2 残留：`/api/dubbing`、`real_provider_smoke`、`/dubbing` UI 和动态文档均符合三类边界正常形。
    - `[已通过]` `pnpm test:unit tests\workflow\provider-gate-confirmation.test.ts tests\api\ingest-dubbing-readiness-smoke-route.test.ts tests\components\dubbing-workbench-submit.test.tsx tests\components\dubbing-form.test.tsx tests\components\ingest-workbench-readiness.test.ts tests\docs\api-routes-safety-guard.test.ts tests\docs\dynamic-testing-safety-guard.test.ts`（7 files / 55 tests）
    - `[已通过]` `pnpm lint`（464 files）
    - `[已通过]` `pnpm test`（87 files / 517 tests；e2e 命令通过）
    - `[已通过]` `pnpm build`

80. `[已完成]` provider smoke 压力测试前置正常形小闭环：
    - 动态 API 文档新增 provider smoke 压测 SOP，把准备阶段和真实 armed run 分开：
      - `dry_run_provider_smoke` rehearsal：【历史旧口径，已由第 141 条 source-bound rehearsal 取代】只打 `/api/ingest/dubbing-readiness` + `mode="dry_run"`，不传 `source_url`、不传 `confirmed_gate_ids`，只需要 `ALLOW_STRESS_DYNAMIC_TESTS`，不得触发 YouTube/Gemini/MiniMax。
      - `real_provider_smoke` armed run：同一路由 + `mode="real_provider_smoke"`，必须提供 `REAL_PROVIDER_SMOKE_SOURCE_URL`、完整 `confirmed_gate_ids`，并同时设置 `ALLOW_PAID_DYNAMIC_TESTS` 与 `ALLOW_STRESS_DYNAMIC_TESTS`。
      - `dubbing_job`：正式 `/api/dubbing` 只使用 `video_url` 或 `source_job_id + source_artifact_id`，只接受 `config.confirmed_gate_ids=["translation_provider","minimax_tts"]`。
    - `/api/dubbing` 新增 provider-smoke-shaped payload 拦截；顶层 `mode`、`source_url` 或 `confirmed_gate_ids` 会返回 `DUBBING_PROVIDER_SMOKE_SCOPE_MISMATCH`，不会创建 job、初始化 state 或 enqueue。
    - 文档守卫改为扫描所有 `/api/dubbing` 命令块，确保每个例子都使用 `config.voice_usage_confirmed`、`config.confirmed_gate_ids`，不包含 `youtube_download`、`real_provider_smoke` 或 `source_url`。
    - `docs/dubbing-guide.md` 与 `docs/agent/video-processing.md` 补齐三边界正常形，避免 API 文档、指南和视频处理链路叙述分叉。
    - readiness 测试补齐 `mode="dry_run"` 即使带 live smoke 字段也保持不外呼、不调用 provider probe 的守卫。
    - TEAM 两名只读监察员均已完成并关闭；其 P1/P2 建议中，本轮已处理 dry-run rehearsal、canonical id、local gate matrix、source_url 边界、文档扫描、provider-smoke-shaped payload、dry-run non-live 守卫。
    - `[已通过]` `pnpm test:unit tests\docs\dynamic-testing-safety-guard.test.ts tests\docs\api-routes-safety-guard.test.ts tests\api\dubbing-route.test.ts tests\api\ingest-dubbing-readiness-smoke-route.test.ts`（4 files / 53 tests）
    - `[已通过]` `pnpm lint`（464 files）
    - `[已通过]` `pnpm test`（87 files / 520 tests；e2e 命令通过）
    - `[已通过]` `pnpm build`

81. `[已完成]` 人工终听交付审计说明正常形小闭环：
    - `deliveryAuditReadiness` 现在始终包含 `manual_final_listen` check；未记录人工终听会让交付审计保持 `warning / 交付审计待补`，不再被成片、README、QA JSON 和声线披露齐全误判为 ready。
    - 人工终听状态 normal form 固定为：未记录 -> `warning`；`pending` -> `warning`；`passed` -> `ready`；`failed` -> `blocked`；`waived` -> `warning`。自动 QA score/verdict 仍不受人工终听影响。
    - QA 页人工终听面板新增“交付审计影响”说明，并在保存 `PATCH /api/jobs/:id/manual-final-listen` 成功后 `router.refresh()`，让服务端交付审计状态同步刷新。
    - 交付包面板和 `delivery-readme.md` 会展示 `deliveryAuditReadiness.checks`，显式列出人工终听、声线披露、QA JSON、README 和成片文件的状态。
    - `docs/dubbing-guide.md` 与 `docs/agent/api-routes.md` 已补齐人工终听状态表；API 文档守卫新增 `manual_final_listen`、`not_recorded` 和四状态映射检查。
    - TEAM 监察员已完成并关闭；其 P3 建议已处理：ready 顶层 guidance 明确包含人工终听，`GET /api/jobs/:id/qa` 契约测试断言 `manual_final_listen` check。
    - `[已通过]` `pnpm exec biome check --write lib\jobs\manual-final-listen.ts lib\jobs\delivery-package.ts components\jobs\manual-final-listen-panel.tsx components\jobs\delivery-package-panel.tsx tests\components\job-qa-report.test.tsx tests\components\report-delivery-package-section.test.tsx tests\jobs\job-display.test.ts tests\api\job-artifact.test.ts tests\api\job-qa.test.ts tests\docs\api-routes-safety-guard.test.ts`
    - `[已通过]` `pnpm test:unit tests\api\job-qa.test.ts tests\jobs\job-display.test.ts tests\components\job-qa-report.test.tsx tests\components\report-delivery-package-section.test.tsx tests\api\job-artifact.test.ts tests\api\job-detail.test.ts tests\docs\api-routes-safety-guard.test.ts`（7 files / 96 tests）
    - `[已通过]` `pnpm lint`（464 files）
    - `[已通过]` `pnpm test`（87 files / 521 tests；e2e 命令通过）
    - `[已通过]` `pnpm build`

82. `[已完成]` dry-run provider smoke 压测记录沉淀正常形小闭环：
    - `ProviderSmokeAudit` 的 dry-run result 现在只表达实际副作用：`external_call=false`、`may_spend_money=false`、`writes_artifacts=false`；不再把 gate 的潜在 artifact 风险误写成 dry-run 已执行写产物。
    - `/api/ingest/dubbing-readiness` 的 `job_id` 绑定只允许 `content_ingest` 或 `translation_dubbing` 主线任务；旧剪辑 job 会返回 `PROVIDER_SMOKE_AUDIT_JOB_SCOPE_MISMATCH`，避免 smoke evidence 贴到非主线任务。
    - 动态 API 文档新增 job-bound dry-run rehearsal SOP：固定 `BASE_URL + TEST_API_TOKEN + ALLOW_STRESS_DYNAMIC_TESTS + DRY_RUN_PROVIDER_SMOKE_AUDIT_JOB_ID`，并把每轮结果沉淀为 NDJSON，显式记录 `external_calls_executed=false`、`job_created=false`、`result_counts` 和 `top_blockers`。
    - 文档守卫强化：【历史旧口径，已由第 141 条 source-bound rehearsal 取代】dry-run rehearsal 必须精确调用 `mode="dry_run"`，必须写 `PROVIDER_SMOKE_AUDIT_LOG`，不得包含 `source_url`、`confirmed_gate_ids`、`ALLOW_PAID_DYNAMIC_TESTS` 或 `/api/dubbing`。
    - API 文档守卫补齐 dry-run 示例禁入字段检查，并说明 job-bound audit 只绑定主线 ingest/dubbing 任务。
    - TEAM 两名只读监察员均已完成并关闭；其 P1/P2 建议中，本轮已处理 dry-run audit 记录沉淀、artifact 写入语义、job-free rehearsal 断言、主线 job 绑定边界和 cloud/local gate 表述分歧。
    - `[已通过]` `pnpm exec biome check --write app\api\ingest\dubbing-readiness\route.ts tests\api\ingest-dubbing-readiness-smoke-route.test.ts tests\docs\dynamic-testing-safety-guard.test.ts tests\docs\api-routes-safety-guard.test.ts`
    - `[已通过]` `pnpm test:unit tests\api\ingest-dubbing-readiness-smoke-route.test.ts tests\docs\dynamic-testing-safety-guard.test.ts tests\docs\api-routes-safety-guard.test.ts`（3 files / 23 tests）
    - `[已通过]` `pnpm lint`（464 files）
    - `[已通过]` `pnpm test`（87 files / 523 tests；e2e 命令通过）
    - `[已通过]` `pnpm build`

83. `[已完成]` dry-run provider smoke evidence handoff 守卫正常形小闭环：
    - `dry_run_provider_smoke` 输入收敛为兼容但规范化：【历史旧口径，已由第 141 条 source-bound rehearsal 取代】旧调用即使带 `source_url`、`youtube_url` 或 `confirmed_gate_ids` 也不会外呼；进入 audit normal form 时会忽略这些 live-only 字段，避免 dry-run 证据沉淀 source_ref 或已确认 gate。
    - 新增 job-bound handoff 集成测试：真实创建 `translation_dubbing` job，调用 `POST /api/ingest/dubbing-readiness` dry-run 写入 `ProviderSmokeAudit`，再验证 direct loader、`GET /api/jobs/:id`、report loader 和 `delivery-readme.md` 读取到同一份 provider smoke 证据。
    - README artifact 与 job detail route 都明确显示 `Provider Smoke：已确认`、`dry-run`、`未调用外部 provider`，证明证据不是只停留在 POST 响应或 mock loader。
    - TEAM 两名只读监察员均已完成并关闭；P1 已处理，P2 明确保留现有边界：单次 `real_provider_smoke` 需要 paid/source/gates，压力测试才额外需要 stress gate；P3 的 NDJSON `job_created=false` 证据强度后续可在动态脚本小闭环中加强。
    - `[已通过]` `pnpm exec biome check --write app\api\ingest\dubbing-readiness\route.ts tests\api\ingest-dubbing-readiness-smoke-route.test.ts tests\api\provider-smoke-dry-run-evidence-handoff.test.ts`
    - `[已通过]` `pnpm test:unit tests\api\provider-smoke-dry-run-evidence-handoff.test.ts tests\api\ingest-dubbing-readiness-smoke-route.test.ts tests\api\job-detail.test.ts tests\api\job-artifact.test.ts tests\loaders\report-loader.test.ts tests\jobs\provider-smoke-audit.test.ts`（6 files / 65 tests）
    - `[已通过]` `pnpm lint`（465 files）
    - `[已通过]` `pnpm test`（88 files / 524 tests；e2e 命令通过）
    - `[已通过]` `pnpm build`

84. `[已完成]` dry-run provider smoke NDJSON 计数证据正常形小闭环：
    - 本地与云端动态 API 文档的 dry-run rehearsal 记录从硬编码 `job_created=false` 改成可复核 normal form：`audit_job_id + pre_job_count + post_job_count + job_count_delta + job_created`。
    - 每轮 dry-run 前后都会读取当前 `TEST_API_TOKEN` 可见的 `GET /api/jobs?limit=1&offset=0` `total`，并用 `job_count_delta=$((jobs_after - jobs_before))` 派生 `job_created: ($job_count_delta > 0)`。
    - 汇总阶段改用 `jq -e -s` fail closed：只要 `job_count_delta_total != 0`、`job_created=true`、`external_calls_executed=true` 或不是全 dry-run，脚本都会失败，不再只打印风险摘要。
    - 文档明确要求计数检查在同 token 静默环境执行，避免其它并行任务创建造成误判；若误判发生也会保守失败，不会放行到真实 provider smoke。
    - 动态文档守卫同步升级：要求 `audit_job_id/pre_job_count/post_job_count/job_count_delta`、`/api/jobs?limit=1&offset=0`、`jq -e '.total'`、`job_created: ($job_count_delta > 0)` 和 `job_count_delta_total == 0`；同时拒绝重新引入硬编码 `job_created: false`。
    - TEAM 两名只读监察员均已完成并关闭；其 P1 建议已处理，P2 噪声风险已通过静默环境说明与 fail-closed 汇总处理。
    - `[已通过]` `pnpm exec biome check --write tests\docs\dynamic-testing-safety-guard.test.ts`
    - `[已通过]` `pnpm test:unit tests\docs\dynamic-testing-safety-guard.test.ts tests\api\ingest-dubbing-readiness-smoke-route.test.ts tests\api\provider-smoke-dry-run-evidence-handoff.test.ts`（3 files / 20 tests）
    - `[已通过]` `pnpm lint`（465 files）
    - `[已通过]` `pnpm test`（88 files / 524 tests；e2e 命令通过）
    - `[已通过]` `pnpm build`

85. `[已完成]` 真实 provider smoke armed-run 护栏正常形小闭环：
    - 本地、云端动态 API 文档和 API routes 文档已移除可复制的单次真实 provider smoke 快捷 curl；所有可执行 `real_provider_smoke` 都收敛到 armed-run 正常形。
    - armed-run 必须同时具备 `ALLOW_PAID_DYNAMIC_TESTS`、`ALLOW_STRESS_DYNAMIC_TESTS`、`source_url`、同一个 audit `job_id`、完整 `confirmed_gate_ids`、已通过 dry-run evidence、预算上限、次数/并发上限和 armed NDJSON。
    - dry-run rehearsal 与 armed-run 都记录 `run_limit`，并用 `pids + wait "${pid}"`、`run_count == expected_runs` 和 run 序号完整性检查避免子进程失败或部分日志通过汇总。
    - armed-run 会校验 dry-run evidence 绑定同一个 audit job，且 `mode="dry_run"`、`verdict="ready"`、`external_calls_executed=false`、`job_count_delta=0`、`job_created=false`、`result_counts.blocked=0`。
    - 预算 normal form 收紧为正数金额：`PROVIDER_SMOKE_ESTIMATED_COST_PER_RUN_USD > 0` 且 `PROVIDER_SMOKE_MAX_BUDGET_USD > 0`，再计算 `estimated_total_cost_usd` 并 fail closed。
    - 本轮没有执行真实 provider smoke，没有触发外部 provider 调用，也没有创建 `/api/dubbing` job；TEAM 两名监察员均已完成并关闭，其 P1/P2 风险已处理。
    - `[已通过]` `pnpm exec biome check --write tests\docs\dynamic-testing-safety-guard.test.ts tests\docs\api-routes-safety-guard.test.ts`
    - `[已通过]` `pnpm test:unit tests\docs\dynamic-testing-safety-guard.test.ts tests\docs\api-routes-safety-guard.test.ts`（2 files / 6 tests）
    - `[已通过]` `pnpm lint`（465 files）
    - `[已通过]` `pnpm test`（88 files / 524 tests；e2e 命令通过）
    - `[已通过]` `pnpm build`

86. `[已完成]` MiniMax 声线使用确认与第二声线审计正常形小闭环：
    - 按 `primitive-first-reduction` 将本轮 normal form 收敛为：任何会传给 MiniMax 的 `voice_id` 都必须先形成同一种 voice selection/audit 结果；用户确认必须绑定当前主声线与第二声线选择。
    - `/dubbing` 表单在用户主动改变主声线、第二声线或移除当前声线时，会清掉本次声线使用确认并禁止提交，避免旧确认覆盖新的 `voice_id`。
    - `buildDubbingRunPlan()` 现在对 `secondary_voice_id` 复用 `selectMiniMaxVoiceForDubbing()`，并在 job config 中记录 `secondary_voice_selection_source`、`secondary_voice_usage_label`、`secondary_voice_disclosure_required`、`secondary_voice_public_figure`、`secondary_voice_category` 等审计字段。
    - `/api/dubbing` 响应新增 `secondary_voice_selection`，让提交后也能看到第二声线来源、披露要求、人物属性和类别。
    - MiniMax TTS step 的 raw audit、QA freshness fingerprint、QA 报告、delivery package 和 README 都纳入第二声线披露信息；任一第二声线缺披露元数据时会保守提示。
    - `/api/dubbing/voices` 对系统设置中的默认 voice 不再合成为 `authorized_clone`，改为 `synthetic_narration + system_default`，并标注“未登记授权元数据，需确认或披露”。
    - TEAM 两名只读监察员均已完成并关闭；其 P1/P2 建议中，本轮已处理 stale 确认、secondary voice 绕过 registry、TTS audit 缺第二声线、交付披露只看主声线、系统默认声线类别误导。
    - `[已通过]` `pnpm exec biome check --write components\dubbing\dubbing-form.tsx lib\dubbing\dubbing-run-plan.ts lib\dubbing\applied-asset-summary.ts lib\workflow\steps\dubbing\minimax-tts.ts lib\jobs\delivery-package.ts lib\jobs\dubbing-qa.ts lib\jobs\dubbing-qa-input-fingerprint.ts app\api\dubbing\route.ts app\api\dubbing\voices\route.ts types\core\job.ts tests\components\dubbing-form.test.tsx tests\jobs\dubbing-run-plan.test.ts tests\api\dubbing-route.test.ts tests\api\dubbing-voices-route.test.ts tests\workflow\minimax-tts-audit.test.ts tests\jobs\job-display.test.ts tests\jobs\dubbing-qa.test.ts`
    - `[已通过]` `pnpm test:unit tests\components\dubbing-form.test.tsx tests\jobs\dubbing-run-plan.test.ts tests\api\dubbing-route.test.ts tests\api\dubbing-voices-route.test.ts tests\workflow\minimax-tts-audit.test.ts tests\jobs\job-display.test.ts tests\jobs\dubbing-qa.test.ts tests\jobs\dubbing-qa-input-fingerprint.test.ts tests\jobs\applied-asset-summary.test.ts`（9 files / 128 tests）
    - `[已通过]` `pnpm lint`（465 files）
    - `[已通过]` `pnpm test`（88 files / 530 tests；e2e 命令通过）
    - `[已通过]` `pnpm build`

87. `[已完成]` 第二声线审计展示与普通 rerun 声线快照正常形小闭环：
    - 按 `primitive-first-reduction` 将本轮 normal form 收敛为 `VoiceUsageDisplay / VoiceUsageSnapshot`：任何用户可见的第二声线展示都必须显示 `voiceId + 用途/来源/类别/公众人物/披露要求`，URL/form raw ID 只作为 I/O fallback。
    - compare、workbench、QA 页面和 report 的第二声线展示已改为复用 `createSecondaryVoiceUsageDisplayFromJob()`，不再只露出 raw `secondary_voice_id`；对应测试补齐公众人物/披露详情断言。
    - 普通 rerun 现在在 `source_job_id` 指向可访问的 `translation_dubbing` 来源任务、且主/第二声线 ID 匹配时，继承来源任务已确认的声线用途、披露、公众人物、类别和 matched alias 元数据，避免 registry/profile 后续变化覆盖历史审计。
    - `/api/dubbing` 只在普通 rerun 隐藏未授权 token 来源任务的声线元数据；sample asset snapshot 仍把 source job 交给验证层，因此未授权来源保持返回 `403 DUBBING_SAMPLE_SNAPSHOT_SOURCE_FORBIDDEN`。
    - TEAM 监察员已完成并关闭；其 P2“普通 rerun 会重新解析第二声线元数据”已处理。P3“`secondary_voice_id` key 载入复合展示值”和“`voice_usage_confirmed` 命名为单数”保留为低风险后续 normal form 优化，不阻断当前闭环。
    - `[已通过]` `pnpm test:unit tests\components\job-compare-client.test.tsx tests\components\workbench-client.test.tsx tests\components\job-qa-report.test.tsx tests\components\report-dubbing-context-section.test.tsx`（4 files / 39 tests）
    - `[已通过]` `pnpm test:unit tests\api\dubbing-route.test.ts tests\jobs\dubbing-run-plan.test.ts`（2 files / 43 tests）
    - `[已通过]` `pnpm lint`（465 files）
    - `[已通过]` `pnpm test`（88 files / 531 tests；e2e 命令通过）
    - `[已通过]` `pnpm build`

88. `[已完成]` provider dry-run rehearsal 与真实 smoke evidence gate 正常形小闭环：
    - 按 `primitive-first-reduction` 将 provider smoke 命令收敛为三类 normal form：dry-run rehearsal 只读 readiness；真实 provider smoke 必须绑定 `job_id`、已有通过 dry-run evidence、提供 `source_url` 和完整 gate；正式 `/api/dubbing` 仍只接受配音 scope gate。
    - 新增 `scripts/provider-smoke-dry-run-rehearsal.mjs` 和 `pnpm provider-smoke:dry-run`：【历史旧口径，已由第 141 条 source-bound rehearsal 取代】跨平台执行 job-bound dry-run rehearsal，拒绝 `ALLOW_PAID_DYNAMIC_TESTS`，只 POST `/api/ingest/dubbing-readiness`，body 仅含 `mode/job_id`，并记录 NDJSON。
    - dry-run rehearsal 现在 fail closed：校验 `external_calls_executed=false`、不返回 job、audit results 不外呼/不花钱/不写 artifact、`result_counts.blocked` 必须是数值且总数为 0、job count delta 必须为 0。
    - `real_provider_smoke` 服务端新增 evidence gate：没有 `job_id` 或同一任务没有最近一次通过的 dry-run evidence 时，直接返回 400，不进入 YouTube probe、Gemini 或 MiniMax provider verification。
    - `ProviderSmokeAudit` 新增 `findLatestPassedDryRunProviderSmokeAudit()`，真实 smoke 多轮压测时不会被自己写入的 real smoke audit 覆盖 dry-run evidence。
    - 动态测试文档改以 `pnpm provider-smoke:dry-run` 作为 canonical runner；API/dubbing guide 修正真实 smoke `job_id` 必填、`config.translation_style` 示例和旧 `/api/jobs` 410 响应契约。
    - 静态测试/数据库文档清掉旧组件树、旧风格目录和旧 `single_video` 默认值，并加 mainline guard 防止回退。
    - TEAM 两名只读监察员均已完成并关闭；其 P1/P2 建议中，本轮已处理 real smoke job-bound evidence、脚本/route 响应字段对齐、dry-run blocked count fail closed、canonical command surface、文档与静态测试漂移。
    - `[已通过]` `pnpm test:unit tests\docs\mainline-positioning-guard.test.ts tests\docs\api-routes-safety-guard.test.ts tests\api\jobs-route.test.ts tests\api\ingest-dubbing-readiness-smoke-route.test.ts tests\scripts\provider-smoke-dry-run-rehearsal.test.ts tests\jobs\provider-smoke-audit.test.ts`（6 files / 42 tests）
    - `[已通过]` `pnpm test:unit tests\jobs\applied-asset-summary.test.ts tests\components\job-compare-client.test.tsx tests\components\job-qa-report.test.tsx tests\components\report-delivery-package-section.test.tsx tests\components\report-dubbing-context-section.test.tsx tests\jobs\mainline-asset-visibility-stress.test.tsx tests\jobs\mainline-closed-loop-smoke-stress.test.tsx`（7 files / 40 tests）
    - `[已通过]` `pnpm lint`（467 files）
    - `[已通过]` `pnpm test`（89 files / 542 tests；e2e 命令通过）
    - `[已通过]` `pnpm build`

89. `[已完成]` MiniMax 凭证保存与提交前声线自动匹配预览正常形小闭环：
    - 按 `primitive-first-reduction` 将本轮 normal form 收敛为 `DubbingSpeakerHint -> VoiceSelectionPreview -> VoiceUsagePreview`：UI 预览和 `/api/dubbing` 建任务共用 `speaker_identity + content_brief + source_label` 作为声线匹配输入。
    - 新增只读 `POST /api/dubbing/voices/select`：只读本地声线注册表和服务端 creator profile，不调用 MiniMax，不触发付费验证，并返回预计 voice_id、来源、matched alias、类别、公众人物与披露状态。
    - `/dubbing` 在未手动指定 voice_id 时，会在提交前显示“预计匹配”的长期声线资产；如果自动匹配预览尚未完成或失败，会禁止提交，避免 TTS 费用发生前用户看不到实际声线。
    - 预览 route 不再信任客户端传来的默认 voice_id，只使用服务端 creator profile；预览失败会清空旧结果，避免显示上一位讲者的声线。
    - MiniMax PowerShell 凭证保存 wrapper 保持 ASCII-only，避免 Windows PowerShell 5.1 编码解析失败；保存脚本只写本地加密 settings，不调用 `/api/api-keys` 或任何付费验证。
    - 增加 MiniMax 凭证保存行为级测试：临时数据库写入加密凭证后，通过 runtime `getMiniMaxCredential()` 读回，确认 `source=settings:minimax_tts` 且输出只显示脱敏 key。
    - TEAM 监察员已完成并关闭；其 P1/P2 建议中，本轮已处理 source_label 输入不一致、自动预览未完成仍可提交、预览失败保留旧结果、客户端 defaultVoiceId 影响预览、凭证保存缺行为测试。
    - `[已通过]` `pnpm test:unit tests\components\dubbing-form.test.tsx tests\api\dubbing-voices-select-route.test.ts tests\scripts\save-minimax-credential.test.ts tests\jobs\voice-registry.test.ts`（4 files / 49 tests）
    - `[已通过]` `pnpm test:unit tests\api\ingest-dubbing-readiness-smoke-route.test.ts tests\workflow\minimax-tts-audit.test.ts tests\docs\api-routes-safety-guard.test.ts tests\docs\mainline-positioning-guard.test.ts`（4 files / 36 tests）
    - `[已通过]` `pnpm lint`（472 files）
    - `[已通过]` `pnpm test`（91 files / 557 tests；e2e 命令通过）
    - `[已通过]` `pnpm build`

90. `[已完成]` provider smoke preflight 与付费验证 gate 收紧小闭环：
    - 按 `primitive-first-reduction` 将真实 provider smoke 前的命令正常形补成 `preflight -> dry-run rehearsal -> armed run`：`pnpm provider-smoke:dry-run:preflight` 只检查环境变量、次数和 gate 状态，不连接 localhost、YouTube、Gemini 或 MiniMax，不创建任务。
    - `scripts/provider-smoke-dry-run-rehearsal.mjs` 新增 `--preflight` JSON 输出，并把 `ALLOW_STRESS_DYNAMIC_TESTS` 从“非空即通过”收紧为必须等于 `true`；`ALLOW_PAID_DYNAMIC_TESTS` 仍会让 dry-run fail closed。
    - MiniMax 付费验证新增服务端 env gate：`POST /api/api-keys` 保存 `minimax_tts` 和 `POST /api/dubbing/voices` 验证 voice_id 除了请求体确认外，还必须设置 `ALLOW_PAID_DYNAMIC_TESTS=true`，否则不会调用 `verifyApiKey()` 或 MiniMax TTS。
    - `/api/ingest/dubbing-readiness` 不再接受 `mode="real"` 旧别名，只保留 canonical `mode="real_provider_smoke"`；`docs/dubbing-guide.md` 移除裸真实 smoke JSON，改为指向动态测试 armed-run SOP。
    - TEAM 监察员已完成并关闭；其 P1/P2 建议中，本轮已处理 MiniMax key/voice 付费验证旁路、dry-run stress gate 语义漂移、真实 smoke mode 别名和裸文档示例。
    - `[已通过]` `pnpm test:unit tests\scripts\provider-smoke-dry-run-rehearsal.test.ts tests\api\api-keys.test.ts tests\api\dubbing-voices-route.test.ts tests\api\ingest-dubbing-readiness-smoke-route.test.ts tests\docs\dynamic-testing-safety-guard.test.ts`（5 files / 53 tests）

91. `[已完成]` 本地 job-bound dry-run rehearsal 实跑与 API token proxy 修复小闭环：
    - 按 `primitive-first-reduction` 将本轮 normal form 固定为 `API Bearer token -> route-level DB 验证 -> job-bound dry-run audit`；`proxy.ts` 在 `AUTH_ENABLED=true` 时不再用 session cookie 挡住 Bearer API token，而是放行到 API route 统一鉴权。
    - 新增 `tests/proxy-auth.test.ts`，覆盖两条边界：Bearer API 请求可到达 route-level token validation；无 Bearer 且无 session 的 API 请求仍返回 `NO_SESSION`。
    - 使用本地临时 token-owned `content_ingest` audit target job `rsapgw48`，在 `http://localhost:8901` 执行 `pnpm provider-smoke:dry-run:preflight` 与 `pnpm provider-smoke:dry-run` 三轮 rehearsal。
    - 本轮 rehearsal 证据写入 `PROVIDER_SMOKE_AUDIT_LOG`：`run_count=3`、`external_calls_executed=false`、`job_count_delta_total=0`、`blocked_count_total=0`、`job_created=false`，未设置 `ALLOW_PAID_DYNAMIC_TESTS`，未调用 YouTube/Gemini/MiniMax，也未创建 `/api/dubbing` job。
    - DB job log 已沉淀 3 条 `major_step=ingest/sub_step=provider_smoke` 的 `provider_smoke_audit` details，可供 job detail/report loader 读取最新 ProviderSmokeAudit。
    - TEAM 两名只读监察员均已完成并关闭；其建议中，本轮已处理 dry-run 路径无 P0/P1/P2、token/proxy 阻塞和 dev server readiness 误判。

92. `[已完成]` provider smoke dry-run evidence 可见性与只读 probe 小闭环：
    - 按 `primitive-first-reduction` 将证据展示链路固定为 `job_logs.details.provider_smoke_audit -> findLatestProviderSmokeAudit(jobId) -> job detail/report providerSmokeAudit -> ProviderSmokeAuditPanel`。
    - `job_logs` 查询统一补上 `ORDER BY created_at ASC, rowid ASC`，避免多条 provider smoke log 同毫秒写入时 latest audit 选择不稳定。
    - `ProviderSmokeAuditPanel` 不再只显示汇总；现在展示确认项、来源 host/hash、每个 gate 的状态、provider/capability、run mode、外呼/花费/写产物标记、确认 id、message 和 blockers。
    - top blockers 的 UI 语义按 verdict 区分：`blocked` 显示“阻断原因/阻断”，`ready/review` 显示“关注项/关注”，避免 dry-run ready 但 optional Wav2Lip blocker 被误读成阻断。
    - 新增只读命令 `pnpm provider-smoke:evidence:check -- --job <job_id> --require-ready-dry-run`，直接 readonly 打开 SQLite，校验 ProviderSmokeAudit normal form 与 dry-run readiness，不写 DB、不连接 localhost、不调用 YouTube/Gemini/MiniMax。
    - 已用真实本地 audit target `rsapgw48` 验证：`provider_smoke_log_count=3`、最新 `mode=dry_run`、`verdict=ready`、`external_calls_executed=false`、`result_counts.blocked=0`、`dry_run_evidence_ready=true`；该 job 是 `content_ingest`，因此 delivery package evidence 预期为 false，稳定可见面是 job detail/workbench/report 顶层 `providerSmokeAudit`。
    - TEAM 两名只读监察员均已完成并关闭；其 P2 建议中，本轮已处理 latest audit 稳定排序、UI gate 明细不足和真实 DB 指定 job 只读验证缺口。
    - `[已通过]` `pnpm test:unit tests\jobs\provider-smoke-audit.test.ts tests\scripts\check-provider-smoke-audit.test.ts tests\components\workbench-client.test.tsx tests\components\report-layout-legacy-cleanup.test.tsx tests\api\provider-smoke-dry-run-evidence-handoff.test.ts`（5 files / 27 tests）
    - `[已通过]` `pnpm provider-smoke:evidence:check -- --job rsapgw48 --require-ready-dry-run`
    - `[已通过]` `pnpm lint`（476 files）
    - `[已通过]` `pnpm test`（93 files / 569 tests；e2e 命令通过）
    - `[已通过]` `pnpm build`

93. `[已完成]` 真实 provider smoke armed-run command object 正常形小闭环：
    - 按 `primitive-first-reduction` 将真实 provider smoke 前的可执行入口固定为 `dry-run evidence -> server latest ProviderSmokeAudit -> armed command object -> budget/run/concurrency gates -> readiness endpoint -> NDJSON summary`。
    - 新增 `scripts/provider-smoke-armed-run.mjs`：`--preflight` 只生成 `real_provider_smoke_preflight` command object，不连接 localhost、YouTube、Gemini 或 MiniMax；正式执行只调用 `/api/ingest/dubbing-readiness`。
    - 新增 `pnpm provider-smoke:armed-run:preflight` 与 `pnpm provider-smoke:armed-run`，把原先分散在动态测试文档里的真实 smoke armed-run SOP 收敛成版本化脚本。
    - armed-run 必须严格满足 `ALLOW_PAID_DYNAMIC_TESTS === "true"` 与 `ALLOW_STRESS_DYNAMIC_TESTS === "true"`，并要求测试 token、source URL、audit job、dry-run evidence、预算上限、次数/并发上限和 NDJSON 日志路径齐备。
    - preflight 输出只保留 source URL hash，不打印原始 URL 或 token；预算估算超过 `PROVIDER_SMOKE_MAX_BUDGET_USD` 时 fail closed。
    - 正式请求前会同时校验本地 dry-run NDJSON 与服务端最新 `ProviderSmokeAudit`：同一个 audit job、fresh、`dry_run`、`ok=true`、`verdict=ready`、`external_calls_executed=false`、`blocked=0`、无 missing/unknown confirmations、无 job count delta。
    - freshness gate 同时约束本地 NDJSON 每一条 `audit_checked_at` 和服务端 `ProviderSmokeAudit.checked_at`；任一证据过期都会在真实 provider 请求前 fail closed。
    - 真实 smoke 响应必须逐轮满足 `ok=true`、`verdict=ready`、`blocked=0`、missing/unknown confirmations 为空，且 job 总数不增加；汇总记录写入 NDJSON。
    - `scripts/provider-smoke-dry-run-rehearsal.mjs` 同步补上 dry-run max runs / max concurrency caps，避免 dry-run rehearsal 自身变成无界压力源。
    - `scripts/check-provider-smoke-audit.mjs` 新增 freshness gate，并把 `--require-ready-dry-run` 收紧为完整 dry-run audit normal form。
    - 动态测试文档改为引用 armed-run 脚本，并把 shell gate 从“非空”改为必须等于 `true`；文档守卫测试同步覆盖脚本和 package scripts。
    - TEAM 监察员已完成并关闭；其 P1/P2 建议中，本轮已处理无 canonical real armed-run、gate 非空误放行、file-only/stale dry-run evidence、真实 smoke 成功条件过弱、dry-run rehearsal 无 cap、本地 evidence 只看 newest freshness 和服务端 audit freshness 缺口。
    - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax，也没有创建 `/api/dubbing` job；`ALLOW_PAID_DYNAMIC_TESTS` 未用于任何真实服务。
    - `[已通过]` `pnpm test:unit tests\scripts\provider-smoke-armed-run.test.ts`（1 file / 8 tests）
    - `[已通过]` `pnpm test:unit tests\scripts\provider-smoke-armed-run.test.ts tests\scripts\provider-smoke-dry-run-rehearsal.test.ts tests\scripts\check-provider-smoke-audit.test.ts tests\docs\dynamic-testing-safety-guard.test.ts`（4 files / 24 tests）
    - `[已通过]` `pnpm lint`（478 files）
    - `[已通过]` `pnpm test`（94 files / 578 tests；e2e 命令通过）
    - `[已通过]` `pnpm build`

94. `[已完成]` 真实 provider smoke source URL 输入 fail-closed 小闭环：
    - 按 `primitive-first-reduction` 将真实 provider smoke 的 source 输入收紧为 command object invariant：`REAL_PROVIDER_SMOKE_SOURCE_URL` 必须先解析成 `http(s)` URL，才能进入 dry-run evidence 校验、server audit 读取或 readiness 请求。
    - `scripts/provider-smoke-armed-run.mjs` 新增 source URL normalizer：preflight 遇到非法 URL 会输出 `ok=false`、`network_requests_executed=false`、`paid_verification_called=false`、`job_created=false`，且不回显原始 URL。
    - 正式 `provider-smoke:armed-run` 在读取本地 evidence 或访问 API 前验证 source URL；非法 URL 直接 fail closed，不会连接 localhost/cloud API，也不会触发 YouTube/Gemini/MiniMax。
    - preflight command object 继续只输出 `source_ref.host` 与 64 位 `url_sha256`，不输出原始 source URL 或 token。
    - TEAM 监察员已完成并关闭；其 P1 建议中，本轮已处理 invalid `REAL_PROVIDER_SMOKE_SOURCE_URL` 可让 preflight 过度乐观的问题。第二声线 P3 经只读审计后决定暂缓，因现有 raw ID 与 `secondary_voice_usage` 展示 normal form 已分离，改名会触碰公开接口。
    - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax，也没有创建 `/api/dubbing` job；`ALLOW_PAID_DYNAMIC_TESTS` 未用于任何真实服务。
    - `[已通过]` `pnpm test:unit tests\scripts\provider-smoke-armed-run.test.ts`（1 file / 10 tests）
    - `[已通过]` `pnpm lint`（478 files）
    - `[已通过]` `pnpm test`（94 files / 580 tests；e2e 命令通过）
    - `[已通过]` `pnpm build`

95. `[已完成]` 真实 provider smoke 动态文档执行面收敛小闭环：
    - 按 `primitive-first-reduction` 将动态文档 normal form 收敛为 `package script -> command object script -> docs checklist`：真实 provider smoke armed run 的唯一可执行入口是 `scripts/provider-smoke-armed-run.mjs`。
    - 本地与云端动态 API 文档移除可复制的 `real_provider_smoke` curl/jq 长 shell SOP；文档只保留 `pnpm provider-smoke:armed-run:preflight`、`pnpm provider-smoke:armed-run` 和 invariant checklist。
    - checklist 固定记录 paid/stress gate、source URL、audit job、dry-run evidence、freshness、server latest ProviderSmokeAudit、预算/次数/并发上限、NDJSON 输出、无 `/api/dubbing` job 和 fail-closed 边界。
    - `tests/docs/dynamic-testing-safety-guard.test.ts` 不再要求文档复制 bash 内部实现；改为要求 canonical package scripts、armed-run script invariants、docs checklist，并拒绝重新引入 copyable `real_provider_smoke` curl。
    - TEAM 监察员已完成并关闭；其 P1/P2 建议中，本轮已处理“文档重新成为执行权威”和“guard 过度绑定 jq/pids shell 细节”的漂移风险。
    - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax，也没有创建 `/api/dubbing` job；`ALLOW_PAID_DYNAMIC_TESTS` 未用于任何真实服务。
    - `[已通过]` `pnpm test:unit tests\docs\dynamic-testing-safety-guard.test.ts`（1 file / 3 tests）
    - `[已通过]` `pnpm lint`（478 files）
    - `[已通过]` `pnpm test`（94 files / 580 tests；e2e 命令通过）
    - `[已通过]` `pnpm build`

96. `[已完成]` dry-run provider smoke blocked-count 文档 fail-closed 小闭环：
    - 按 `primitive-first-reduction` 将 dry-run evidence summary 收敛为单一 normal form：`result_counts.blocked` 必须是数值输入，汇总为 `blocked_count_total`，最终 invariant 是 `blocked_count_total == 0`。
    - 本地与云端动态 API 文档不再使用 `result_counts.blocked // 0` fallback；缺失或非数值 blocked count 会在 `jq -e -s` summary 阶段 fail closed。
    - `tests/docs/dynamic-testing-safety-guard.test.ts` 现在拒绝重新引入 blocked-count fallback，并要求 dry-run audit log summary 明确包含 numeric type check。
    - TEAM 只读检查员已用于核对 docs 与 guard 缺口；本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax，也没有创建 `/api/dubbing` job；`ALLOW_PAID_DYNAMIC_TESTS` 未用于任何真实服务。
    - `[已通过]` `pnpm test:unit tests\docs\dynamic-testing-safety-guard.test.ts`（1 file / 3 tests）
    - `[已通过]` `pnpm lint`（478 files）
    - `[已通过]` `pnpm test`（94 files / 580 tests；e2e 命令通过）
    - `[已通过]` `pnpm build`

97. `[已完成]` 真实 provider smoke redacted preflight handoff 小闭环：
    - 按 `primitive-first-reduction` 将真实 provider smoke 压测前的人工交接收敛为 `redacted preflight handoff checklist` normal form：人工授权、source reference、auth reference、audit binding、budget limit、evidence freshness、output reference、preflight result。
    - 本地与云端动态 API 文档现在要求 handoff 只记录 `source_ref.host + url_sha256`、env presence、预算/次数/并发上限、dry-run evidence 状态和 no-side-effect flags；不得记录原始 source URL、token、完整 NDJSON 或 provider 响应正文。
    - `scripts/provider-smoke-armed-run.mjs` 的 `REQUIRED_ENV` 与 handoff checklist 对齐：`DRY_RUN_PROVIDER_SMOKE_EVIDENCE_MAX_AGE_MS`、`PROVIDER_SMOKE_STRESS_RUNS`、`PROVIDER_SMOKE_MAX_RUNS`、`PROVIDER_SMOKE_MAX_CONCURRENCY`、`PROVIDER_SMOKE_ESTIMATED_COST_PER_RUN_USD`、`PROVIDER_SMOKE_ARMED_RUN_LOG` 都必须显式给出，避免默认值被误当作人工确认。
    - `app/api/ingest/dubbing-readiness/route.ts` 不再把 YouTube probe 的 `webpageUrl`、`sourceUrl` 或 raw error message 写入 provider smoke audit message/blockers；audit 只保留 source fingerprint。
    - `tests/docs/dynamic-testing-safety-guard.test.ts` 扩大 code fence 扫描面，防止非 bash fence 重新出现 copyable `real_provider_smoke` 执行面，并为 handoff section 增加 raw token/source URL 与 `ok=false` 后继续执行的负向 guard。
    - TEAM 只读检查员与监察员均已完成并关闭；P1 raw source URL audit 泄漏和 P2 handoff/docs/script guard 已在本轮处理。
    - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax，也没有创建 `/api/dubbing` job；`ALLOW_PAID_DYNAMIC_TESTS` 未用于任何真实服务。
    - `[已通过]` `pnpm test:unit tests\api\ingest-dubbing-readiness-smoke-route.test.ts tests\scripts\provider-smoke-armed-run.test.ts tests\docs\dynamic-testing-safety-guard.test.ts`（3 files / 36 tests）
    - `[已通过]` `pnpm lint`（478 files）
    - `[已通过]` `pnpm test`（94 files / 583 tests；e2e 命令通过）
    - `[已通过]` `pnpm build`

98. `[已完成]` provider-smoke preflight redacted handoff template 输出小闭环：
    - 按 `primitive-first-reduction` 将 preflight 输出收敛为 `redacted_handoff_template` normal form：`copyable_checklist`、人工授权、source reference、auth reference、audit binding、budget limit、evidence freshness、output reference、preflight result。
    - `pnpm provider-smoke:armed-run:preflight` 现在无论 `ok=true/false` 都输出非执行性的 `redacted_handoff_template`，只包含 host/hash、env presence、预算/次数/并发、dry-run evidence 摘要、输出路径和 no-side-effect flags；stdout 不包含 `TEST_API_TOKEN` 或原始 `REAL_PROVIDER_SMOKE_SOURCE_URL`。
    - preflight 的 `readCommandConfig()` 不再用默认值填充 required handoff inputs；缺失 `PROVIDER_SMOKE_STRESS_RUNS`、`PROVIDER_SMOKE_MAX_CONCURRENCY`、`PROVIDER_SMOKE_ARMED_RUN_LOG` 等字段时，`command_object=null`，template 对应值显示 `<missing>` / `null`，避免把默认值误当作人工确认。
    - `/api/ingest/dubbing-readiness` 的对外 `results` 也切到 sanitized normal form，不再返回 raw `probe` / `verification` payload；provider 原始错误不会进入 response/audit message 或 blockers。
    - 本地与云端动态 API 文档改为 `pnpm provider-smoke:armed-run:preflight && pnpm provider-smoke:armed-run`，并说明 `redacted_handoff_template` 的具体格式、字段顺序和渲染方式不作为公开契约。
    - TEAM 只读检查员与监察员均已完成并关闭；其 P1 response raw payload 泄漏与 P2 missing-env default / copyable command 风险已在本轮处理。
    - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax，也没有创建 `/api/dubbing` job；`ALLOW_PAID_DYNAMIC_TESTS` 未用于任何真实服务。
    - `[已通过]` `pnpm test:unit tests\scripts\provider-smoke-armed-run.test.ts tests\api\ingest-dubbing-readiness-smoke-route.test.ts tests\docs\dynamic-testing-safety-guard.test.ts`（3 files / 38 tests）
    - `[已通过]` `pnpm lint`（478 files）
    - `[已通过]` `pnpm test`（94 files / 585 tests；e2e 命令通过）
    - `[已通过]` `pnpm build`

99. `[已完成]` provider-smoke preflight 快照库与服务端 armed gate 收紧小闭环：
    - 按 `primitive-first-reduction` 将本轮 normal form 收敛为同一组 provider smoke policy primitives：`paid/stress gate -> fresh dry-run evidence -> run/concurrency/budget cap -> redacted handoff -> no job/artifact side effect`。
    - 新增 `docs/agent/testing/dynamic/provider-smoke-preflight-handoff-snapshots.md`，沉淀缺 env、invalid URL、over-budget、stale evidence 四类 no-paid / no-network preflight failure snapshots；快照只记录 redacted normal form，不复制 raw token、raw source URL、本地路径、完整 NDJSON 或 provider response。
    - local/cloud 动态 API 文档新增 no-paid preflight snapshot 锚点，并说明服务端 `/api/ingest/dubbing-readiness` 也会 fail closed 校验 stress gate、TTL、run/max/concurrency、estimated cost/budget 和 job-bound dry-run evidence freshness。
    - `tests/docs/dynamic-testing-safety-guard.test.ts` 新增 snapshot 文档守卫，防止快照库退化成可执行 armed-run 文档或泄漏 source/token/path。
    - `/api/ingest/dubbing-readiness` 的 `real_provider_smoke` 现在不再只依赖脚本自律；服务端会要求 `ALLOW_PAID_DYNAMIC_TESTS=true`、`ALLOW_STRESS_DYNAMIC_TESTS=true`、显式 TTL/次数/并发/预算 env、fresh strong dry-run evidence、latest dry-run 后的 real-run ledger 额度，以及进程内 active concurrency slot。
    - `provider-smoke-audit` 新增 ready dry-run predicate 与 latest dry-run 后 real-run ledger summary；弱 dry-run evidence（`ok=false`、missing/unknown confirmation、failed/blocked/requires confirmation、或 result 有 external_call/may_spend_money/writes_artifacts）不能作为真实 provider smoke 凭据。
    - TEAM 三名只读检查员均已完成并关闭；其 P1 建议中，本轮已处理 no-paid snapshot guard、snapshot 文档锚点、服务端 stress/budget/concurrency gate、fresh/strong dry-run evidence 和直打 route ledger/concurrency 绕过。
    - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax，也没有创建 `/api/dubbing` job；`ALLOW_PAID_DYNAMIC_TESTS` 未用于任何真实服务。
    - `[已通过]` `pnpm test:unit tests\api\ingest-dubbing-readiness-smoke-route.test.ts tests\jobs\provider-smoke-audit.test.ts tests\docs\dynamic-testing-safety-guard.test.ts`（3 files / 39 tests）
    - `[已通过]` `pnpm lint`（478 files）
    - `[已通过]` `pnpm test`（94 files / 593 tests；e2e 命令通过）
    - `[已通过]` `pnpm build`

100. `[已完成]` real provider smoke 服务端 command binding 小闭环：
    - 按 `primitive-first-reduction` 将真实 provider smoke 的执行入口收敛为 `server env -> request command object -> 服务端 fail-closed binding -> redacted evidence`。
    - `/api/ingest/dubbing-readiness` 的 `real_provider_smoke` 现在要求服务端 `REAL_PROVIDER_SMOKE_AUDIT_JOB_ID` 与 request `job_id` 匹配，`REAL_PROVIDER_SMOKE_SOURCE_URL` 与 request `source_url` 派生出的 `source_ref.host + url_sha256` 匹配；不匹配、缺 env、env/source 非 http(s) 时在 job access、dry-run evidence、ledger、provider probe/verification 前返回 400。
    - command binding 错误响应只返回 `mismatched_fields`、布尔匹配状态和 host/hash；不回显原始 source URL、token 或 provider payload。
    - 本地与云端动态 API 文档、动态测试文档守卫同步补上 `REAL_PROVIDER_SMOKE_AUDIT_JOB_ID == request job_id` 和 `source_ref.host + url_sha256 == request source_url` invariant。
    - TEAM 两名只读检查员均已完成并关闭；其 P1/P2 建议中，本轮已处理直打 route 绕过脚本 env 绑定、文档未声明 env == request 绑定、binding 失败仍可能读取 dry-run evidence 的缺口。
    - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax，也没有创建 `/api/dubbing` job；`ALLOW_PAID_DYNAMIC_TESTS` 未用于任何真实服务。
    - `[已通过]` `pnpm test:unit tests\api\ingest-dubbing-readiness-smoke-route.test.ts tests\docs\dynamic-testing-safety-guard.test.ts`（2 files / 35 tests）
    - `[已通过]` `pnpm lint`（478 files）
    - `[已通过]` `pnpm test`（94 files / 596 tests；e2e 命令通过）
    - `[已通过]` `pnpm build`

101. `[已完成]` baseline-browser-mapping 过旧提示收敛小闭环：
    - 按 `primitive-first-reduction` 将本轮 normal form 收敛为 `dependency freshness -> effective pnpm resolution -> clean build stderr`，只处理构建/启动 warning 噪音，不改主线 provider smoke 逻辑。
    - `pnpm update baseline-browser-mapping@latest` 与 `pnpm update --latest baseline-browser-mapping` 无法刷新传递解析；按该包 warning 建议新增顶层 devDependency `baseline-browser-mapping@^2.10.24`，使 Next/Browserslist 的有效解析统一到 `2.10.24`。
    - `pnpm why baseline-browser-mapping` 现在只显示一个有效版本 `2.10.24`；Next 的实际依赖链接也指向 `baseline-browser-mapping@2.10.24`。
    - TEAM 两名只读检查员均已完成并关闭；其建议中，本轮已区分有效 lockfile/symlink 与 `.pnpm` 旧目录残留，并标记后续真实 smoke 前需要重启旧 8898 服务，避免旧 Next 16.0.10 进程污染验证。
    - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax，也没有创建 `/api/dubbing` job；`ALLOW_PAID_DYNAMIC_TESTS` 未用于任何真实服务。
    - `[已通过]` `pnpm install --frozen-lockfile`
    - `[已通过]` `node -e "const pkg=require('baseline-browser-mapping'); if (typeof pkg.getAllVersions === 'function') { pkg.getAllVersions(); } console.log('baseline-browser-mapping-ok')"`
    - `[已通过]` `pnpm test:unit tests\scripts\provider-smoke-dry-run-rehearsal.test.ts tests\scripts\provider-smoke-armed-run.test.ts tests\docs\dynamic-testing-safety-guard.test.ts`（3 files / 26 tests）
    - `[已通过]` `pnpm lint`（478 files）
    - `[已通过]` `pnpm test`（94 files / 596 tests；e2e 命令通过）
    - `[已通过]` `pnpm build`，输出未再出现 `baseline-browser-mapping` 过旧提示。

102. `[已完成]` provider smoke runtime fingerprint fail-closed 小闭环：
    - 按 `primitive-first-reduction` 将目标环境校验收敛为 `target_url -> auth -> runtime_fingerprint -> allowed side effects -> provider smoke command`。
    - 新增受认证 `GET /api/runtime/fingerprint`，只返回 `schema_version`、`runtime_contract`、当前 repo 的 `package_name/package_version` 和 `checked_at`；响应不包含 token、license、本地路径或原始 source URL。
    - 新增脚本侧 primitive `scripts/provider-smoke-runtime-fingerprint.mjs`，`provider-smoke:dry-run` 和 `provider-smoke:armed-run` 在访问 `/api/jobs`、server latest `ProviderSmokeAudit` 或 `/api/ingest/dubbing-readiness` 前，必须先校验 `/api/runtime/fingerprint`。
    - mismatch、404、非 JSON、contract 不符或 `package_name/package_version` 不一致都会 fail closed；armed-run 不会写 `provider-smoke-real.ndjson`，dry-run 不会进入 readiness。
    - `provider-smoke:dry-run:preflight` 与 `provider-smoke:armed-run:preflight` 输出 `expected_runtime_fingerprint`，但 preflight 仍保持 no-network / no-paid。
    - 本地与云端动态 API 文档补上 runtime fingerprint invariant，并明确 `/api/health` 只作为 liveness/license 检查，不作为版本或 build 指纹；`docs/agent/api-routes.md` 同步记录新 endpoint。
    - TEAM 两名只读监察员均已完成；其 P0/P1 建议中，本轮已处理 provider smoke 脚本缺少强制 runtime identity、误用 `/api/health` 的风险。P2 build id 指纹暂缓，先以 package name/version 作为当前最小可用 primitive。
    - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax，也没有创建 `/api/dubbing` job；`ALLOW_PAID_DYNAMIC_TESTS` 未用于任何真实服务。
    - `[已通过]` `pnpm test:unit tests\api\runtime-fingerprint-route.test.ts tests\scripts\provider-smoke-dry-run-rehearsal.test.ts tests\scripts\provider-smoke-armed-run.test.ts tests\docs\dynamic-testing-safety-guard.test.ts`（4 files / 30 tests）
    - `[已通过]` `pnpm lint`（482 files）
    - `[已通过]` `pnpm test`（95 files / 600 tests；e2e 命令通过）
    - `[已通过]` `pnpm build`，输出未出现 `baseline-browser-mapping` 过旧提示。

103. `[已完成]` provider smoke runtime fingerprint build identity 补强小闭环：
    - 按 `primitive-first-reduction` 将 runtime identity normal form 收紧为 `package_name/package_version/next_build_id + runtime_booted_at`；`/api/health` 继续只作为 liveness/license，不作为版本或 build 指纹。
    - `lib/runtime/fingerprint.ts` 现在用 bundle 内静态 `package.json` 作为 package name/version 来源，避免旧进程在 request 时读取新磁盘 `package.json`；`.next/BUILD_ID` 在 runtime module 载入时固定成 boot snapshot。
    - `GET /api/runtime/fingerprint` 返回同一份 boot snapshot 与 `runtime_booted_at`；脚本侧 `fetchAndAssertRuntimeFingerprint()` 要求 contract 包含 `runtime_booted_at`，并比较 `package_name/package_version/next_build_id`。
    - `provider-smoke:dry-run:preflight` 与 `provider-smoke:armed-run:preflight` 输出 `runtime_fingerprint_fields`，明确三栏 fingerprint 正常形；dry-run 新增 `next_build_id` mismatch fail-closed 用例。
    - 本地/云端动态 API 文档和 preflight snapshot 文档同步说明 `next_build_id` 来自 `.next/BUILD_ID`、可为 `null`，preflight 只记录 expected fingerprint，不证明目标 runtime 已验证；动态文档守卫同步锁定这些字段。
    - TEAM 两名只读监察员均已完成；其建议中，本轮已处理 `next_build_id` normal form、文档/guard 覆盖和脚本测试落后问题。剩余 no-paid P1 已记录为下一步：dry-run NDJSON/server audit 绑定 runtime fingerprint，以及 latest failed dry-run invalidates older ready dry-run。
    - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax，也没有创建 `/api/dubbing` job；`ALLOW_PAID_DYNAMIC_TESTS` 未用于任何真实服务。
    - `[已通过]` `pnpm test:unit tests\api\runtime-fingerprint-route.test.ts tests\scripts\provider-smoke-dry-run-rehearsal.test.ts tests\scripts\provider-smoke-armed-run.test.ts tests\docs\dynamic-testing-safety-guard.test.ts`（4 files / 31 tests）

104. `[已完成]` provider smoke evidence epoch / runtime binding 小闭环：
    - 按 `primitive-first-reduction` 将真实 provider smoke 前置证据收敛为 `runtime_fingerprint -> latest dry-run epoch -> real-run ledger` normal form。
    - `ProviderSmokeAudit` 现在可携带 `runtime_fingerprint`；`/api/ingest/dubbing-readiness` 写入 dry-run/real smoke audit 时绑定当前 boot runtime fingerprint。
    - 服务端 real provider smoke gate 现在要求最新 dry-run epoch 是 fresh ready no-call 且 `runtime_fingerprint` 与当前 runtime 一致；若最新 dry-run 是 blocked/failed/stale/mismatched，不再回退使用更旧的 ready dry-run。
    - dry-run rehearsal NDJSON 每条 record 现在来自服务端 `ProviderSmokeAudit.runtime_fingerprint`，并且必须与 `/api/runtime/fingerprint` 当前结果一致；missing/mismatched 会在写 NDJSON 前 fail closed。
    - armed-run 现在同时校验本地 dry-run NDJSON、server `providerSmokeAudit` 和当前 `/api/runtime/fingerprint` 三者 runtime identity 一致，再允许读取 job count 和进入真实 provider smoke request。
    - 本地/云端动态 API 文档、preflight snapshot 文档和动态测试守卫已同步 `runtime_fingerprint`、latest dry-run epoch、fail-closed ordering 和 redacted handoff 边界。
    - TEAM 两名只读监察员均已完成并关闭；其建议中，本轮已处理 dry-run NDJSON 不绑定 server audit fingerprint、旧 ready dry-run 可越过最新失败 dry-run、文档/guard 没有明确 latest dry-run epoch 的缺口。
    - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax，也没有创建 `/api/dubbing` job；`ALLOW_PAID_DYNAMIC_TESTS` 未用于任何真实服务。
    - `[已通过]` `pnpm test:unit tests\jobs\provider-smoke-audit.test.ts tests\api\ingest-dubbing-readiness-smoke-route.test.ts tests\scripts\provider-smoke-dry-run-rehearsal.test.ts tests\scripts\provider-smoke-armed-run.test.ts tests\docs\dynamic-testing-safety-guard.test.ts`（5 files / 75 tests）
    - `[已通过]` `pnpm lint`（482 files）
    - `[已通过]` `pnpm test`（95 files / 608 tests；e2e 命令通过）
    - `[已通过]` `pnpm build`

105. `[已完成]` provider smoke 证据展示 normal form 小闭环：
    - 按 `primitive-first-reduction` 将展示层收敛为 `ProviderSmokeAudit + optional ProviderSmokeRealRunLedger -> ProviderSmokeEvidenceDisplay`，避免 workbench、report 和交付包各自解释 mode/verdict/counts/runtime。
    - `components/jobs/provider-smoke-audit-panel.tsx` 现在显示外部调用状态、latest dry-run epoch 状态和 `runtime_fingerprint.package_name/package_version/next_build_id`；该 panel 继续由 workbench 与 report 共用。
    - `GET /api/jobs/:id`、report loader、dubbing detail 和 delivery README 路径会用现有只读 `summarizeRealProviderSmokeAuditsSinceLatestReadyDryRun()` 带出 `providerSmokeDryRunLedger`，真实 smoke 记录也能显示对应 latest ready dry-run epoch 摘要。
    - `deliveryPackage.deliveryEvidence.provider_smoke` 和交付 README 现在同样包含外部调用状态、latest dry-run epoch 和运行指纹，供交付前人工核对；没有新增任何 provider 执行入口。
    - `docs/agent/api-routes.md` 与 `docs/agent/testing/dynamic/provider-smoke-preflight-handoff-snapshots.md` 已同步说明 no-paid 展示字段和边界。
    - TEAM 两名只读监察员均已完成并关闭；其建议中，本轮已处理运行指纹不展示、交付证据压缩掉 dry-run epoch、以及真实 smoke 后看不到 latest dry-run epoch 的展示缺口。
    - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax，也没有创建 `/api/dubbing` job；`ALLOW_PAID_DYNAMIC_TESTS` 未用于任何真实服务。
    - `[已通过]` `pnpm test:unit tests/jobs/provider-smoke-display.test.ts tests/components/workbench-client.test.tsx tests/components/report-layout-legacy-cleanup.test.tsx tests/components/report-delivery-package-section.test.tsx tests/jobs/job-display.test.ts tests/api/provider-smoke-dry-run-evidence-handoff.test.ts tests/loaders/job-loaders.test.ts tests/loaders/report-loader.test.ts tests/api/job-detail.test.ts tests/api/job-artifact.test.ts`（10 files / 101 tests）
    - `[已通过]` `pnpm lint`（484 files）
    - `[已通过]` `pnpm test`（96 files / 610 tests；e2e 命令通过）
    - `[已通过]` `pnpm build`，输出未出现 `baseline-browser-mapping` 过旧提示。

106. `[已完成]` `/dubbing` 提交前 MiniMax 声线选择展示小闭环：
    - 按 `primitive-first-reduction` 将提交前声线展示收敛为 `voice_id + selection_source + category + gender + public_figure + authorization + disclosure + blocker` normal form，只做 no-paid 展示层，不触发 MiniMax TTS、克隆或真实 provider。
    - `/dubbing` 的运行前确认新增“声线选择”卡片，明确本次实际或预计会使用的 `voice_id`、来源（手动指定、讲者声线库、通用旁白声线、创作者默认声线、未匹配）、类别、性别、公众人物/授权状态和披露状态。
    - 本地声线候选卡不再只写“已克隆声线”，改为本地声线清单，并显示类别、男声/女声/中性声线、公众人物、已授权、需披露等标签；公众人物授权克隆仍保留披露提示。
    - 空 `voice_id`、无注册表、无默认主声线时，表单和 `/api/dubbing` 都有明确阻断；`/api/dubbing` 在这种情况下返回 `DUBBING_VOICE_NOT_CONFIGURED`，不会创建 job、初始化 state 或入队。
    - 自动声线匹配结果变化时会撤销旧的“声线使用方式”确认，避免用户先确认通用声线后改成名人讲者仍沿用旧确认。
    - `/api/dubbing/voices/select` 的只读预览响应补充 `gender` 与 `authorized`；`/api/dubbing` 创建成功响应补充最终 `voice_id`，便于 UI/日志与 job config 对齐。
    - TEAM 三名只读检查员均已完成并关闭；其建议中，本轮已处理提交前 voice_id 不可见、通用男女声/公众人物授权克隆展示不足、空默认声线阻断提示、自动预览变化后确认未失效、以及创建响应缺最终 `voice_id` 的缺口。
    - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax，没有触发 TTS 或声线克隆；MiniMax API key 未用于付费验证或外部调用。
    - `[已通过]` `pnpm test:unit tests/components/dubbing-form.test.tsx tests/api/dubbing-voices-select-route.test.ts tests/api/dubbing-route.test.ts tests/jobs/voice-registry.test.ts tests/jobs/dubbing-run-plan.test.ts`（5 files / 92 tests）
    - `[已通过]` `pnpm lint`（484 files）
    - `[已通过]` `pnpm test`（96 files / 613 tests；e2e 命令通过）
    - `[已通过]` `pnpm build`，输出未出现 `baseline-browser-mapping` 过旧提示。

107. `[已完成]` MiniMax 声线注册表默认角色绑定小闭环：
    - 按 `primitive-first-reduction` 将设置页声线资产收敛为两层 normal form：`MiniMaxVoiceRegistryEntry` 只保存 voice_id 的授权、人物、性别、来源、披露和用途元数据；`CreatorProfile.default_voice_id / secondary_voice_id` 只保存默认主/第二声线引用，不复制元数据。
    - `components/settings/minimax-voice-registry-editor.tsx` 现在会读取创作者资产，左侧本地声线清单显示“默认主声线 / 默认第二声线”角色标签；右侧可将已登记的本地声线设为创作者默认主声线或默认第二声线。
    - 默认角色绑定只调用 `/api/configs/laputa_creator_profile` 保存 profile JSON，不调用 MiniMax、TTS、克隆或付费验证；未登记或系统合成默认声线不能直接设为默认角色，需先补本地声线元数据。
    - 公众人物评论/转译声线的 UI 默认授权状态改为未授权但强制披露，避免把“名人转译用途”误读为公众人物本人授权或本人真实发言；用户仍可在有授权证明时手动勾选授权。
    - `/api/dubbing/voices` 的注释和日志从 cloned voice 命名收敛到 voice registry / 声线元数据清单，避免把通用声线、手动 voice_id 和系统默认声线误归类为克隆声线。
    - TEAM 三名只读检查员均已完成；其建议中，本轮已处理默认 voice_id 与 registry 分离造成的可维护性缺口、公众人物默认授权语义风险、以及 cloned voices 命名残留。P2“MiniMax 凭证仅保存不验证”保留为下一条 no-paid 小闭环。
    - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax，没有触发 TTS 或声线克隆；MiniMax API key 未用于付费验证或外部调用。
    - `[已通过]` `pnpm test:unit tests/components/minimax-voice-registry-editor.test.tsx tests/api/dubbing-voices-route.test.ts tests/jobs/voice-registry.test.ts tests/components/creator-assets-config.test.tsx`（4 files / 32 tests）
    - `[已通过]` `pnpm lint`（484 files）
    - `[已通过]` `pnpm test`（96 files / 614 tests；e2e 命令通过）
    - `[已通过]` `pnpm build`

108. `[已完成]` MiniMax 凭证 save-only / 付费验证命令拆分小闭环：
    - 按 `primitive-first-reduction` 将 MiniMax 凭证配置收敛为 command normal form：`operation: "save_only"` 只加密保存 API Key 与默认 `voice_id`；`operation: "verify_and_save"` 才调用一次 MiniMax 测试 TTS。
    - `POST /api/api-keys` 对 `minimax_tts + operation: "save_only"` 不调用 `verifyApiKey()`、不调用 `fetch`、不要求 `ALLOW_PAID_DYNAMIC_TESTS`、不标记 `is_verified`；缺少 API Key 时仍返回 400。
    - `POST /api/api-keys` 的 MiniMax 付费验证分支继续要求 `confirmPaidVerification: true` 和服务端 `ALLOW_PAID_DYNAMIC_TESTS=true`；旧客户端不传 `operation` 但传确认字段时仍兼容为验证并保存；无 `operation` 且无确认仍返回 400，不会把漏参当作保存。
    - 设置页 MiniMax 区块拆成“保存配置”和“付费验证一次”：普通保存不依赖付费 checkbox；付费验证有独立说明、确认 checkbox 和按钮；两个 loading 状态分离。
    - 动态 API/UI 文档和 safety guard 已同步：`save_only` 示例不再被当作 provider verification；`verify_and_save` 示例仍必须带 `ALLOW_PAID_DYNAMIC_TESTS` 与 `confirmPaidVerification`。
    - TEAM 三名只读检查员均已完成；其建议中，本轮已处理 API/UI command 分离、显式 save-only、no-external-call 证明、以及文档 guard 识别 save-only 的缺口。
    - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax，没有触发 TTS 或声线克隆；MiniMax API key 未用于付费验证或外部调用。
    - `[已通过]` `pnpm test:unit tests/api/api-keys.test.ts tests/components/minimax-config.test.tsx tests/docs/dynamic-testing-safety-guard.test.ts`（3 files / 21 tests）
    - `[已通过]` `pnpm lint`（484 files）
    - `[已通过]` `pnpm test`（96 files / 622 tests；e2e 命令通过）
    - `[已通过]` `pnpm build`

109. `[已完成]` MiniMax save-only readiness/status 展示区分小闭环：
   - 按 `primitive-first-reduction` 将 MiniMax 凭证状态收敛为 `missing / saved_unverified / verified / not_tracked` normal form；`configured` 只表示运行时可读到凭证，`verified` 才表示设置页执行过一次付费 TTS 验证。
   - `lib/dubbing/minimax-credentials.ts` 新增 `getMiniMaxCredentialStatus()`；settings 保存但未验证会显示 `saved_unverified`，环境变量或本地文件凭证显示 `not_tracked`，不会假装有设置页验证记录。
   - `/api/dubbing/status` 的 runtime status 新增 `minimax_credential_status` 并继续脱敏路径；配音 workbench 的运行时检查从单一“已找到”改为“已验证 / 待验证 / 未记录验证 / 缺失”。
   - `/api/ingest/dubbing-readiness` 的 closed-loop readiness 新增 `tts_credential_status`；TTS stage、provider gate detail 和 ingest readiness badge 明确区分“已保存但未付费验证”和“已验证”。
   - `/dubbing` 表单的启用清单文案同步：MiniMax API Key 不再只写“已就绪”，会在可用时显示“已付费验证 / 已保存，待付费验证 / 已配置，未记录验证”。
   - TEAM 三名只读检查员均已完成；其建议中，本轮已处理 save-only 被 readiness/status 误读成已验证或已正式可用的主要缺口。公众人物声线本地登记 vs 付费 voice_id 验证仍保留为下一条 no-paid 小闭环。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax，没有触发 TTS 或声线克隆；MiniMax API key 未用于付费验证或外部调用。
   - `[已通过]` `pnpm test:unit tests/jobs/minimax-credentials.test.ts tests/api/runtime-status-redaction.test.ts tests/api/closed-loop-readiness.test.ts tests/components/ingest-workbench-readiness.test.ts tests/components/status-badge.test.tsx`（5 files / 23 tests）
   - `[已通过]` `pnpm test:unit tests/components/dubbing-form.test.tsx tests/components/dubbing-workbench-submit.test.tsx tests/api/dubbing-route.test.ts tests/api/ingest-dubbing-readiness-smoke-route.test.ts tests/api/provider-smoke-dry-run-evidence-handoff.test.ts tests/api/mainline-free-route-stress.test.ts`（6 files / 104 tests）
   - `[已通过]` `pnpm lint`（486 files）
   - `[已通过]` `pnpm test`（98 files / 628 tests；e2e 命令通过）
   - `[已通过]` `pnpm build`

110. `[已完成]` MiniMax voice_id 本地登记 vs 付费存在验证拆分小闭环：
   - 按 `primitive-first-reduction` 将声线输入状态收敛为 `idle / checking / local_registered / paid_verified_exists / not_found` normal form；`local_registered` 只表示本地声线清单命中或保存成功，`paid_verified_exists` 才保留给 MiniMax 付费存在验证。
   - `/dubbing` 表单不再用 `exists` 表达本地 registry 命中；本地登记显示蓝色保存语义和“尚未执行 MiniMax 付费验证”，避免绿色勾被误读成远端 voice_id 已验证。
   - `POST /api/dubbing/voices` 的付费验证响应现在用 `provider_checked` 表达 provider lookup 已完成；MiniMax `status_code=2054` 会返回 `exists=false`、`verified=false`、`status="not_found"` 和 `provider_status_code=2054`，不再把未找到声线标记为 verified。
   - 组件测试覆盖手动保存与点选本地声线都只走本地 `PUT/GET`，不会触发 `POST /api/dubbing/voices`；API 测试覆盖本地 registry response 不带 paid verification 语义，以及 mocked MiniMax missing voice 不会被标记为 verified。
   - TEAM 三名只读检查员/监察员均已完成并关闭；其 P1“missing MiniMax voice 被标记 verified”已在本轮处理，P2“授权是本地自声明”和“usage confirmation 命名像验证”保留为下一条 no-paid 小闭环。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax，没有触发 TTS 或声线克隆；MiniMax API key 未用于付费验证或外部调用，测试中的 MiniMax response 为 mock。
   - `[已通过]` `pnpm test:unit tests/components/dubbing-form.test.tsx tests/api/dubbing-voices-route.test.ts`（2 files / 41 tests）
   - `[已通过]` `pnpm test:unit tests/components/dubbing-form.test.tsx tests/api/dubbing-voices-route.test.ts tests/api/dubbing-voices-select-route.test.ts tests/api/dubbing-route.test.ts tests/jobs/voice-registry.test.ts tests/jobs/dubbing-run-plan.test.ts tests/workflow/minimax-tts-audit.test.ts`（7 files / 114 tests）
   - `[已通过]` `pnpm lint`（486 files）
   - `[已通过]` `pnpm test`（98 files / 629 tests；e2e 命令通过）
   - `[已通过]` `pnpm build`，输出未出现 `baseline-browser-mapping` 过旧提示。

111. `[已完成]` 声线授权记录 / 使用边界确认 normal form 小闭环：
   - 按 `primitive-first-reduction` 将声线安全语义拆成两个 primitive：`authorization_record_status` 表示本地授权记录/不适用/缺失；`usage_boundary_acknowledged` 表示本次任务的声线使用边界确认。
   - `/api/dubbing`、run plan、MiniMax TTS guard、QA、delivery package、fingerprint、report 和 compare 都改用 `usage_boundary_acknowledged` normal form；历史 `voice_usage_confirmed` 只作为 legacy fallback 读取，冲突时返回 400。
   - `/dubbing`、声线注册表和设置页不再裸写“已授权”作为平台验证语义，改为“本地授权记录”“已记录授权声明”“有本地授权记录的声线”；通用/合成旁白不再被展示成授权记录。
   - `/api/dubbing/voices/select` 与 `/api/dubbing` 响应补充 `authorization_record_status` / `authorization_record_label`，并保留短期兼容字段。
   - `docs/agent/api-routes.md`、动态/静态测试文档、`docs/dubbing-guide.md`、AI/视频/重试文档已同步使用 `config.usage_boundary_acknowledged`，并说明 legacy `voice_usage_confirmed` 仅兼容读取。
   - TEAM 两名只读审计员和一名 watchdog 已完成并关闭；本轮处理了本地授权记录被误读为 provider/platform 验证、usage confirmation 命名像验证、以及 docs guard 仍以 legacy 字段为主的缺口。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax/GCS，没有触发 TTS、声线克隆或付费验证。
   - `[已通过]` `pnpm test:unit tests/docs/api-routes-safety-guard.test.ts tests/docs/dynamic-testing-safety-guard.test.ts tests/jobs/voice-usage-boundary.test.ts tests/jobs/voice-registry.test.ts tests/components/dubbing-form.test.tsx tests/components/minimax-voice-registry-editor.test.tsx tests/api/dubbing-route.test.ts tests/api/dubbing-voices-select-route.test.ts tests/api/dubbing-voices-route.test.ts tests/jobs/dubbing-run-plan.test.ts tests/workflow/minimax-tts-audit.test.ts tests/jobs/dubbing-qa.test.ts tests/jobs/applied-asset-summary.test.ts tests/components/job-compare-client.test.tsx tests/components/report-dubbing-context-section.test.tsx tests/components/job-qa-report.test.tsx tests/api/job-qa.test.ts`（17 files / 174 tests）
   - `[已通过]` `pnpm test:unit tests/components/dubbing-workbench-submit.test.tsx tests/components/dubbing-form.test.tsx`（2 files / 32 tests）
   - `[已通过]` `pnpm lint`（488 files）
   - `[已通过]` `pnpm test`（99 files / 634 tests；e2e 命令通过）
   - `[已通过]` `pnpm build`

112. `[已完成]` Google/Gemini/GCS 凭证 save-only / 真实 provider 验证拆分小闭环：
   - 按 `primitive-first-reduction` 将凭证配置收敛为统一 command normal form：`save_only` 只做本地字段/JSON 形状校验并加密保存；`verify_and_save` 与 verify-only/direct test route 才是真实 provider 调用。
   - `POST /api/api-keys` 现在对 `google_ai_studio`、`google_vertex`、`google_storage` 默认走 `save_only`，不会调用 `verifyApiKey()`、不会获取 Google token、不会上传/删除 GCS 测试对象，也不会 `markVerified()`；Google AI Studio/Vertex 保存后只清理对应 Gemini runtime cache。
   - `POST /api/api-keys` 的 `verify_and_save`、`POST /api/api-keys/verify`、`POST /api/gemini/test`、`POST /api/gemini/models`、`POST /api/google-storage/test` 都必须同时具备 `confirmPaidVerification: true` 和服务端 `ALLOW_PAID_DYNAMIC_TESTS=true`，否则在 provider adapter 前 fail closed。
   - 设置页 Google AI Studio、Vertex、GCS 区块从“验证并保存”收敛为“保存配置”，文案明确保存不调用 Gemini/Vertex/GCS provider；MiniMax 付费验证仍保留独立按钮和确认。
   - 动态 API/UI 文档与 safety guard 已同步：`save_only` 被允许无 paid gate，真实 provider 验证和 direct test route 必须带 paid gate 与确认；GCS direct test 文档补充了 token/upload/delete 的受控边界。
   - TEAM 两名只读审计员均已完成并关闭；本轮处理了 Google/GCS 保存被误读成验证、direct provider test route 未被 paid gate 文档锁住、以及 API key verify 文档缺认证说明的缺口。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax/GCS，没有触发 TTS、声线克隆、Google token 获取或 GCS 上传/删除；测试中的 provider 调用均为 mock。
   - `[已通过]` `pnpm test:unit tests/api/api-keys.test.ts tests/api/api-key-verify-route.test.ts tests/api/api-key-verification.test.ts tests/api/privileged-route-auth.test.ts tests/docs/dynamic-testing-safety-guard.test.ts`（5 files / 47 tests）
   - `[已通过]` `pnpm lint`（489 files）
   - `[已通过]` `pnpm test`（99 files / 655 tests；e2e 命令通过）
   - `[已通过]` `pnpm build`，输出未出现 `baseline-browser-mapping` 过旧提示。

113. `[已完成]` Google/Gemini/GCS 凭证 readiness/status normal form 小闭环：
   - 按 `primitive-first-reduction` 将凭证状态收敛为 `missing / saved_unverified / verified / not_tracked` normal form；`configured` 只表示运行时可读到凭证，`verified` 只表示设置页执行过一次显式真实 provider 验证。
   - `GET /api/api-keys` 新增 `source`、`verification_state`、`verification_label`、`verification_detail`；Google/GCS save-only 现在显示 `saved_unverified`，不会被 UI 或文档误写成 `verified`。
   - `/api/ingest/dubbing-readiness` 新增 `translation_credential_status`；Gemini 翻译 stage、provider gate detail 和 ingest readiness badge 会区分“已验证 / 待验证 / 未记录验证 / 缺失”。
   - `/api/dubbing/status` 同步暴露 `translation_credential_status`，与现有 MiniMax runtime status 对齐；settings 状态 badge 同步支持 `not_tracked`。
   - 动态 API 文档和 safety guard 已同步锁定 `verification_state`、四态表、`google_ai_studio / google_vertex / google_storage` 和“保存不等于验证”。
   - TEAM 两名只读审计员均已完成并关闭；本轮处理了 Gemini readiness 被 boolean 折叠、settings status 缺 `not_tracked`、以及 Google/GCS 四态测试缺口。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax/GCS，没有触发 TTS、声线克隆、Google token 获取或 GCS 上传/删除；测试中的 provider 调用均为 mock。
   - `[已通过]` `pnpm test:unit tests/api/api-keys.test.ts tests/components/status-badge.test.tsx tests/jobs/translation-credentials.test.ts tests/api/closed-loop-readiness.test.ts tests/components/ingest-workbench-readiness.test.ts tests/api/runtime-status-redaction.test.ts tests/docs/dynamic-testing-safety-guard.test.ts`（7 files / 57 tests）
   - `[已通过]` `pnpm lint`（491 files）
   - `[已通过]` `pnpm test`（100 files / 666 tests；e2e 命令通过）
   - `[已通过]` `pnpm build`，输出未出现 `baseline-browser-mapping` 过旧提示。

114. `[已完成]` Google/GCS env/file detector 边界确认小闭环：
   - 按 `primitive-first-reduction` 将凭证来源映射收敛为 `service -> runtime adapter -> source kind -> consumed fields -> status meaning`；只有 runtime adapter 实际读取的 env/file 才允许显示 `not_tracked`。
   - 确认 `google_vertex` 与 `google_storage` 当前只读设置页加密凭证；`GOOGLE_APPLICATION_CREDENTIALS`、`GOOGLE_CLOUD_PROJECT`、`GCS_BUCKET` 是旧模板残留，不应让状态从 `missing` 变成 `not_tracked`。
   - `.env.example`、`docs/agent/env-vars.md`、`docs/agent/api-routes.md`、动态 API 文档已同步：Vertex/GCS 凭证走设置页保存；旧 Google/GCS env 即使存在，也不代表 runtime 可用。
   - 测试补齐：`GET /api/api-keys` 对 Google/GCS saved-only 一律显示 `saved_unverified`；`GEMINI_API_KEY` 与 `GOOGLE_AI_STUDIO_API_KEY` 都显示 Gemini env `not_tracked`；GCS/Vertex adapter 在旧 env 存在但 settings 缺失时仍报未配置。
   - TEAM 两名只读审计员均已完成并关闭；本轮处理了 Vertex/GCS false-ready 风险、Gemini env alias 测试缺口、以及动态文档锁点偏软的问题。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax/GCS，没有触发 TTS、声线克隆、Google token 获取或 GCS 上传/删除；测试中的 provider 调用均为 mock。
   - `[已通过]` `pnpm test:unit tests/api/api-keys.test.ts tests/jobs/translation-credentials.test.ts tests/storage/gcs-client.test.ts tests/ai/gemini-credentials-provider.test.ts tests/docs/api-routes-safety-guard.test.ts tests/docs/dynamic-testing-safety-guard.test.ts`（6 files / 43 tests）
   - `[已通过]` `pnpm lint`（493 files）
   - `[已通过]` `pnpm test`（102 files / 674 tests；e2e 命令通过）
   - `[已通过]` `pnpm build`，输出未出现 `baseline-browser-mapping` 过旧提示。

115. `[已完成]` Gemini 翻译运行时来源摘要小闭环：
   - 按 `primitive-first-reduction` 将 Gemini 翻译凭证拆成两层 normal form：`verification_state` 回答能不能用、是否验证；`runtime` 只读摘要回答实际会用哪个 key 来源、哪个模型来源、是否配置 API Base URL。
   - `/api/ingest/dubbing-readiness`、`/api/dubbing/status` 和 ingest workbench 现在会显示 `api_key_source`、`model_id`、`model_source`、`api_base_url_configured`、`api_base_url_source`；只显示来源和模型 ID，不返回 API key。
   - 环境变量优先级固定为 `GEMINI_API_KEY` > `GOOGLE_AI_STUDIO_API_KEY`，`GEMINI_API_BASE_URL` > `GOOGLE_AI_STUDIO_API_BASE_URL`；settings 保存的 `google_ai_studio.model_id/api_base_url` 只作为 settings 来源展示。
   - Gemini model id 已统一规范化：`models/gemini-*` 会在 TypeScript credential resolver、workflow translate step 和 `translator.py` 中转成 `gemini-*`，避免验证路径和实际翻译 URL 不一致。
   - `translator.py` 直跑 fallback 已补齐 `GEMINI_MODEL_ID` 与 `GOOGLE_AI_STUDIO_API_BASE_URL`；`/api/dubbing/status` guidance 不再在 Gemini 缺失时只说配音运行时就绪。
   - TEAM 两名只读审计员均已完成并关闭；本轮处理了模型 ID 规范化断点、Python env alias 不完整、runtime guidance MiniMax-only，以及动态文档字段锁点的问题。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax/GCS，没有触发 TTS、声线克隆、Google token 获取或 GCS 上传/删除；测试中的 provider 调用均为 mock 或 passthrough。
   - `[已通过]` `pnpm test:unit tests/jobs/translation-credentials.test.ts tests/workflow/translate-text.test.ts tests/scripts/translator-script.test.ts tests/jobs/dubbing-runtime-status.test.ts tests/api/closed-loop-readiness.test.ts tests/components/ingest-workbench-readiness.test.ts tests/docs/api-routes-safety-guard.test.ts tests/docs/dynamic-testing-safety-guard.test.ts tests/api/runtime-status-redaction.test.ts`（9 files / 45 tests）
   - `[已通过]` `pnpm lint`（494 files）
   - `[已通过]` `pnpm test`（103 files / 681 tests；e2e 命令通过）
   - `[已通过]` `pnpm build`，输出未出现 `baseline-browser-mapping` 过旧提示。

116. `[已完成]` `/dubbing` 真实 provider 确认前 Gemini runtime 摘要小闭环：
   - 按 `primitive-first-reduction` 将翻译运行时展示收敛为共享 display rows primitive：`translation_credential_status.runtime -> Key 来源 / 模型 / Base URL`，由 `/ingest` 和 `/dubbing` 共用，不复制两套标签规则。
   - 新增 `lib/dubbing/translation-runtime-summary.ts`；`components/ingest/ingest-workbench.tsx` 保留旧导出兼容测试，但 formatter 已迁到 client-safe 纯函数。
   - `/dubbing` 运行时卡片现在会显示 Gemini 翻译运行时来源摘要；`allow_passthrough_translation` 也会明确显示为原文占位 smoke。
   - `/dubbing` 创建任务的“已确认真实 provider 调用”区块现在从 `/api/ingest/dubbing-readiness` 读取 `translation_credential_status.runtime`，在用户勾选费用确认前展示 key 来源、模型来源和 Base URL 来源；仍不显示 API key。
   - `docs/agent/ai-integration.md` 已同步 `/api/dubbing/status` 返回重点和 `/dubbing` provider 确认区的展示要求。
   - TEAM 两名只读审计员均已完成并关闭；其指出的 `/dubbing` 提交前隐藏 Gemini model/base-url 来源、`/api/dubbing/status` UI 未消费 translation runtime、AI 集成文档遗漏 runtime 摘要，均已在本轮处理。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax/GCS，没有触发 TTS、声线克隆或付费验证；测试中的 provider/readiness 数据均为 mock。
   - `[已通过]` `pnpm test:unit tests/components/ingest-workbench-readiness.test.ts tests/components/dubbing-form.test.tsx tests/components/dubbing-workbench-submit.test.tsx tests/docs/api-routes-safety-guard.test.ts`（4 files / 45 tests）
   - `[已通过]` `pnpm lint`（495 files）
   - `[已通过]` `pnpm test`（103 files / 683 tests；e2e 命令通过）
   - `[已通过]` `pnpm build`，输出未出现 `baseline-browser-mapping` 过旧提示。

117. `[已完成]` 保存/验证/runtime 可用四态语义清理小闭环：
   - 按 `primitive-first-reduction` 将本轮残留语义收敛为 `missing / saved_unverified / verified / not_tracked`：保存记录、真实 provider 验证、runtime env/file 可读不再互相冒充。
   - `components/settings/tts-config.tsx` 不再把已保存 Fish Audio 兼容音色恢复成“验证通过”；已保存记录显示为“已保存兼容音色，未执行本次远端验证”，只有点击验证并真实返回成功才显示“远端验证通过”。
   - 兼容 TTS provider 状态不再对 Fish Audio 裸写“可用”，改为“兼容配置存在，不代表本次验证通过”；修改 Fish voice_id 后必须重新验证或恢复已保存记录，避免保存新未验证音色。
   - `components/settings/status-badge.tsx` 的 fallback 推导现在在缺少 `verification_state` 时仍按 `source: env/file` 显示 `not_tracked`，防止旧响应把 env/file runtime 状态误标为 saved-only。
   - `lib/api-keys/credential-status.ts` 现在在设置页状态中优先展示 Gemini/MiniMax runtime env 状态；若 env 和 settings 同时存在，UI 会显示 `not_tracked`，避免用户误以为正在使用 settings 中已验证的 key。
   - `docs/agent/api-routes.md`、`docs/dubbing-guide.md`、动态 API/UI 文档和 guard tests 已同步：复制 `/api/dubbing` 的正式执行命令必须带 `ALLOW_PAID_DYNAMIC_TESTS`；MiniMax runtime 成功条件必须看 `minimax_credential_status.verification_state`，不能只看“缺失项消失”。
   - TEAM 三名只读审计员均已完成并关闭；本轮处理了 Fish Audio “保存=验证”、runtime env 与 settings 状态不一致、以及动态测试文档成功断言偏软的问题。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax/GCS，没有触发 TTS、声线克隆或付费验证；测试中的 fetch/provider 数据均为 mock 或文档静态检查。
   - `[已通过]` `pnpm test:unit tests/docs/api-routes-safety-guard.test.ts tests/docs/dynamic-testing-safety-guard.test.ts tests/components/tts-config.test.tsx tests/components/status-badge.test.tsx tests/api/api-keys.test.ts`（5 files / 50 tests）
   - `[已通过]` `pnpm lint`（496 files）
   - `[已通过]` `pnpm test`（104 files / 689 tests；e2e 命令通过）
   - `[已通过]` `pnpm build`，输出未出现 `baseline-browser-mapping` 过旧提示。

118. `[已完成]` Fish Audio 旧兼容验证 paid gate 收敛小闭环：
   - 按 `primitive-first-reduction` 将真实 provider 验证收敛为 `auth gate -> legacy confirmation -> paid confirmation -> ALLOW_PAID_DYNAMIC_TESTS server gate -> provider side effect`。
   - `fish_audio_vertex` / `fish_audio_ai_studio` 已纳入 paid provider gate；Fish API Key 验证保存和 `/api/api-keys/verify` 现在必须同时具备 `confirmLegacyTts` / `confirmLegacyFishAudio`、`confirmPaidVerification: true` 和服务端 `ALLOW_PAID_DYNAMIC_TESTS=true`，否则不会调用 `verifyApiKey()`、不会保存、不会标记 verified。
   - `/api/tts/verify-voice` 的 Fish model lookup 也加了同一 paid gate；缺 paid confirmation 或缺 server env 时不会读取 Fish API Key，也不会调用 `https://api.fish.audio/model/{voiceId}`。
   - 设置页 Fish Audio 旧兼容 API Key 和旧兼容音色验证请求会同时发送 legacy 与 paid confirmation；UI 文案说明服务端还必须显式设置 `ALLOW_PAID_DYNAMIC_TESTS=true`。
   - 动态 API/UI 文档与 safety guard 已同步：Fish Audio 仍只是旧 TTS 兼容，不进入 `/dubbing` 主线 gate；但只要触发真实旧兼容验证，就不能再只靠 legacy checkbox bypass paid gate。
   - TEAM 三名只读审计员均已完成并关闭；本轮确认 Fish 不依赖 `/api/dubbing`、Gemini readiness、MiniMax readiness 或 closed-loop mainline gate，因此该收敛不阻断当前主线。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax/GCS/Fish Audio，没有触发 TTS、声线克隆或付费验证；测试中的 Fish/provider 数据均为 mock。
   - `[已通过]` `pnpm test:unit tests/api/api-keys.test.ts tests/api/api-key-verify-route.test.ts tests/api/tts-legacy-auth.test.ts tests/components/tts-config.test.tsx tests/components/fish-audio-config.test.tsx tests/docs/api-routes-safety-guard.test.ts tests/docs/dynamic-testing-safety-guard.test.ts`（7 files / 66 tests）
   - `[已通过]` `pnpm lint`（496 files）
   - `[已通过]` `pnpm test`（104 files / 696 tests；e2e 命令通过）
   - `[已通过]` `pnpm build`，输出未出现 `baseline-browser-mapping` 过旧提示。

119. `[已完成]` no-paid provider smoke evidence / 验证文档 normal form 小闭环：
   - 按 `primitive-first-reduction` 将 dry-run rehearsal 输出与 armed-run 输入收敛到同一 evidence primitive：`DRY_RUN_PROVIDER_SMOKE_EVIDENCE_LOG`。`scripts/provider-smoke-dry-run-rehearsal.mjs` 现在优先读取该变量，旧 `PROVIDER_SMOKE_AUDIT_LOG` 保留为兼容别名。
   - dry-run preflight 响应新增 `dry_run_evidence_log`，方便把 no-paid dry-run NDJSON 直接交给后续 `provider-smoke:armed-run:preflight`；没有设置 paid gate 时仍是 no-network/no-paid。
   - 动态 API 文档的 job logs 示例已从旧 `analysis/fetch_metadata/视频分析` 改为当前主线 `translate/translate_text/文本翻译`；`majorStep` 参数说明改为当前主线 stage 列表，旧 `analysis/extract_scenes/process_scenes` 只作为历史剪辑任务兼容查询。
   - `docs/agent/troubleshooting.md` 已把 Gemini File API、上传视频到 Gemini 和分镜拆条排障降级为历史兼容；当前主线排障指向 Gemini 文本翻译凭证、MiniMax/dubbing readiness、FFmpeg 抽音频/合成和 manifest artifact。
   - 文档守卫新增 active job log 示例检查，防止动态 API 文档再次把旧 `analysis/fetch_metadata` 当作主动成功路径。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax/GCS/Fish Audio，没有触发 TTS、声线克隆或付费验证。
   - `[已通过]` `pnpm test:stress`（5 files / 10 tests）
   - `[已通过]` `pnpm test:unit tests/scripts/provider-smoke-dry-run-rehearsal.test.ts tests/docs/dynamic-testing-safety-guard.test.ts`（2 files / 20 tests）
   - `[已通过]` `pnpm test:unit tests/scripts/provider-smoke-armed-run.test.ts`（1 file / 15 tests）
   - `[已通过]` `pnpm test:unit tests/docs/api-routes-safety-guard.test.ts tests/docs/mainline-positioning-guard.test.ts`（2 files / 10 tests）
   - `[已通过]` `pnpm lint`（496 files）
   - `[已通过]` `pnpm test`（104 files / 698 tests；e2e 命令通过）
   - `[已通过]` `pnpm build`，输出未出现 `baseline-browser-mapping` 过旧提示。

120. `[已完成]` active UI 简体 normal form / 简繁切换边界小闭环：
   - 按 `primitive-first-reduction` 将 UI 文案拆成两层 normal form：源码 canonical 使用简体中文；用户选择繁体时只由全局 `ChineseScriptProvider` 做显示层转换。
   - 主导航、站点 Logo、页脚、总控台首页、`/dubbing` 表单和配音工作台源码文案已统一为简体；繁体模式继续通过 header 的「简体 / 繁體」按钮输出港式繁体显示。
   - `tests/docs/mainline-positioning-guard.test.ts` 新增 active shell/dashboard/dubbing 简体源码 guard，防止主入口、首页、页脚和配音提交入口再次混入繁体 UI 文案。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax/GCS/Fish Audio，没有触发 TTS、声线克隆或付费验证。
   - `[已通过]` `pnpm test:unit tests/docs/mainline-positioning-guard.test.ts tests/i18n/chinese-script.test.ts`（2 files / 7 tests）
   - `[已通过]` `pnpm lint`（502 files）
   - `[已通过]` `pnpm test`（106 files / 706 tests；e2e 命令通过）
   - `[已通过]` `pnpm build`

121. `[已完成]` MiniMax 凭证验证 voice_id / 正式配音声线 normal form 小闭环：
   - 按 `primitive-first-reduction` 将 MiniMax voice_id 拆成两层 normal form：`provider credential verification voice_id` 只用于 MiniMax API Key 付费验证；`dubbing voice_id` 才是正式配音声线，由请求、声线注册表和创作者默认声线决定。
   - 设置页 MiniMax 区块已从“默认 voice_id”改为“验证用 voice_id（可选）”，文案明确它不作为正式配音默认声线；PowerShell 保存脚本同步改为 `MiniMax verification voice_id (optional)`，并保留旧输入变量兼容。
   - `/api/dubbing/voices` 的 `GET` 不再把 MiniMax 凭证里的验证 voice_id 合成为本地声线注册表记录；本地 registry 继续作为授权、人物、披露和创作者默认绑定的 canonical 来源。
   - closed-loop readiness 的声线元数据检查不再把 MiniMax 凭证 voice_id 当成默认声线，只认创作者默认声线或本地声线注册表；凭证 voice_id 只影响 provider 验证。
   - `MINIMAX_VERIFICATION_VOICE_ID` 成为推荐 env 名；`MINIMAX_DEFAULT_VOICE_ID` 仅保留为旧兼容别名，不作为正式配音默认声线。
   - TEAM 两名只读代理均已完成并关闭；本轮处理了设置页文案误导、credential voice 混入 registry、readiness 把凭证 voice 当默认声线，以及相关文档/脚本口径。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax/GCS/Fish Audio，没有触发 TTS、声线克隆或付费验证；测试中的 provider 行为均为 mock 或本地加密保存。
   - `[已通过]` `pnpm test:unit tests/components/minimax-config.test.tsx tests/components/minimax-voice-registry-editor.test.tsx tests/api/dubbing-voices-route.test.ts tests/api/closed-loop-readiness.test.ts tests/scripts/save-minimax-credential.test.ts tests/jobs/minimax-credentials.test.ts`（6 files / 40 tests）
   - `[已通过]` `pnpm lint`（502 files）
   - `[已通过]` `pnpm test`（106 files / 706 tests；e2e 命令通过）
   - `[已通过]` `pnpm build`

122. `[已完成]` active 主线 UI 简体 normal form 扩展小闭环：
   - 按 `primitive-first-reduction` 将 UI 字形 normal form 固定为：源码 canonical 简体；繁体只由 `ChineseScriptProvider` 在显示层转换；历史繁体任务字段和 QA 证据只作为兼容输入，不作为 UI 源码文案。
   - Workbench、compare、QA、report、provider smoke panel、settings/guide/license、report navigation、ingest handoff 文案和 workflow QA 日志已统一为简体源码。
   - `tests/docs/mainline-positioning-guard.test.ts` 的 active UI allowlist 已补齐 provider smoke、report active sections、settings/guide/license、i18n toggle、job/display/helper 文案和 ingest handoff，继续避免 glob 扫进旧剪辑章节或生成物。
   - `ChineseScriptToggle` 不再硬编码繁体字面量；按钮源码为简体，繁体模式由全局转换层处理，保持一个正常形来源。
   - 历史繁体 `source_label` fallback 与 QA 证据抽取继续兼容：`job-display` 可识别旧“樣片”标签，QA 资产保存可从旧繁体“應讀 / 詞庫 / 寫入”等文本中抽取固定读法；兼容字面量用 Unicode escape 避免打破源码简体 guard。
   - TEAM 监察员已完成并关闭；其指出的 guard 红线、active report/workbench 漏扫面和残留繁体 UI 文案均已处理。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax/GCS/Fish Audio，没有触发 TTS、声线克隆或付费验证。
   - `[已通过]` `pnpm test:unit tests/docs/mainline-positioning-guard.test.ts tests/i18n/chinese-script.test.ts tests/components/chinese-script-provider.test.tsx`
   - `[已通过]` `pnpm test:unit tests/docs/mainline-positioning-guard.test.ts tests/components/job-compare-client.test.tsx tests/components/job-qa-report.test.tsx tests/components/report-dubbing-context-section.test.tsx tests/components/workbench-client.test.tsx`
   - `[已通过]` `pnpm test:unit tests/jobs/applied-asset-summary.test.ts tests/jobs/dubbing-rerun.test.ts tests/jobs/job-display.test.ts tests/jobs/mainline-artifact-delivery-stress.test.ts tests/jobs/mainline-asset-visibility-stress.test.tsx tests/jobs/mainline-closed-loop-smoke-stress.test.tsx tests/jobs/sample-to-full-stress.test.ts`
   - `[已通过]` `pnpm test:unit tests/components/qa-asset-save-button.test.tsx tests/docs/mainline-positioning-guard.test.ts`
   - `[已通过]` `pnpm lint`
   - `[已通过]` `pnpm test`（106 files / 706 tests；e2e 命令通过）
   - `[已通过]` `pnpm build`

123. `[已完成]` no-paid 主线产品视觉 smoke 第一层小闭环：
   - 按 `primitive-first-reduction` 将视觉 smoke 收敛为 `route × script mode × viewport × no-paid side-effect policy × legacy-negative assertion`。
   - 新增 `tests/e2e/mainline-visual-smoke.spec.ts`，覆盖 `/`、`/ingest`、`/dubbing`、`/jobs` 在 desktop 与 mobile 下的默认简体、切繁体、繁体 reload 保持；截图写入 Playwright output，不点击提交、真实链接检测、付费验证或 provider armed-run。
   - `playwright.config.ts` 的 E2E dev server 默认不复用现有服务，固定 `AUTH_ENABLED=false`、`ALLOW_PAID_DYNAMIC_TESTS=false`、`ALLOW_STRESS_DYNAMIC_TESTS=false`，并可用 `PLAYWRIGHT_REUSE_SERVER=true` 手动复用已确认环境。
   - 视觉 smoke 暴露并修复了三处移动端布局问题：header 窄屏 Logo 文本撑宽、首页工作模块隐式 grid track 撑宽、`/dubbing` 表单隐式 grid track 撑宽，以及 `/jobs` 统计卡移动端固定四列导致数字裁切。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax/GCS/Fish Audio，没有触发 TTS、声线克隆、真实链接探测或付费验证。
   - `[已通过]` `pnpm exec playwright test tests/e2e/mainline-visual-smoke.spec.ts`
   - `[已通过]` `pnpm lint`
   - `[已通过]` `pnpm test`（106 unit files / 706 unit tests；E2E 2 tests）
   - `[已通过]` `pnpm build`

124. `[已完成]` no-paid 主线视觉 smoke 第二层状态 fixture：
   - 按 `primitive-first-reduction` 将第二层视觉 smoke 收敛为 `route × mainline state × script mode × viewport × side-effect policy × legacy-negative assertion × click policy`。
   - `playwright.config.ts` 默认注入隔离 SQLite 与 runtime 目录：`tmp/playwright-e2e/no-paid-mainline.sqlite`、`tmp/playwright-runtime/no-paid-mainline`；E2E 不再读取真实 `data/db.sqlite`，并固定 `AUTH_ENABLED=false`、`ALLOW_PAID_DYNAMIC_TESTS=false`、`ALLOW_STRESS_DYNAMIC_TESTS=false`。
   - 新增 `tests/e2e/mainline-fixtures.ts`，直接 SQL seed `content_ingest`、样片、样片→全片、失败配音任务，以及 translations/segments/transcript artifact；只写隔离 tmp 目录，不调用真实 provider、不删除真实数据。
   - 扩展 `tests/e2e/mainline-visual-smoke.spec.ts`：覆盖 `/jobs/:id`、`/jobs/:id/qa`、`/jobs/:id/compare`、`/jobs/:id/report`、`/settings` 在 desktop/mobile、简体/繁体下的主线锚点、旧剪辑负断言、GET-only 页面加载和视觉溢出检查。
   - 设置页 normal form 已调整：默认系统页只放当前主线设置、MiniMax 和 API Token；旧剪辑 TTS 与本机清理工具移入「维护兼容」标签，保持可达但不再作为主线首屏。
   - 视觉 smoke 暴露并修复：`/dubbing` 运行前确认卡声线摘要裁切、`/jobs/:id` 重跑确认卡移动端撑宽、`/compare` 版本/差异卡移动端撑宽、report 主线步骤表头泄漏“分镜”、report `new Date()` hydrate mismatch、视频 metadata 缺字段显示 `undefinedxundefined`。
   - TEAM 三名只读代理均已完成并关闭；本轮处理了下游页面旧剪辑泄漏点、隔离 DB normal form、settings 默认页兼容入口位置、以及 no-paid smoke 的只读点击边界。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax/GCS/Fish Audio，没有触发 TTS、声线克隆、真实链接探测、付费验证、清理或删除。
   - `[已通过]` `pnpm exec playwright test tests/e2e/mainline-visual-smoke.spec.ts`（5 tests）
   - `[已通过]` `pnpm lint`（504 files）
   - `[已通过]` `pnpm test`（106 unit files / 706 unit tests；E2E 5 tests）
   - `[已通过]` `pnpm build`

125. `[已完成]` no-paid 主线第三层交互 smoke / 长期资产写入边界小闭环：
   - 按 `primitive-first-reduction` 将交互 smoke 收敛为 `safe local write command -> allowed route -> isolated fixture DB -> no provider/no paid assertion`。
   - `tests/e2e/mainline-fixtures.ts` 新增 `e2e-dub-qa-issues` fixture，刻意制造固定读法与节奏 QA 问题；E2E 只写 `tmp/playwright-e2e/no-paid-mainline.sqlite` 与隔离 runtime，不接触真实任务数据。
   - `tests/e2e/mainline-visual-smoke.spec.ts` 新增交互测试，覆盖：
     - `/jobs/:id/qa` 人工终听保存，允许 `PATCH /api/jobs/:id/manual-final-listen`。
     - QA 长期资产保存，允许 `PUT /api/configs/dubbing_project_glossary` 与 `PUT /api/configs/laputa_creator_profile`。
     - `/jobs/:id/compare` 固定读法保存与语言风格保存，继续只允许本地 config 写入。
   - 交互 smoke 明确不点击会创建新任务或入队的路径：`带质检重跑`、`带 QA 跑全片`、`同设定重跑`、`套用资产再修一版` 只作为链接展示，不在 no-paid 交互层提交。
   - `/api/configs` 与 `/api/configs/[key]` 已收敛为 session-only 管理口：匿名在 `AUTH_ENABLED=true` 时拒绝；API token 即使有效也不能读写全局配置、长期词库或创作者资产；`AUTH_ENABLED=false` 的本地/E2E 环境仍可开发使用。
   - Report 主线 API 调用摘要与 layout 会过滤旧 Fish/Edge TTS 兼容 provider 污染；历史剪辑 report 仍保留旧 provider 展示兼容。
   - TEAM 两名只读代理均已完成并关闭；本轮处理了交互 smoke 测试盲区、config 全局资产写入口权限风险，以及主线 report 旧 provider 污染风险。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax/GCS/Fish Audio，没有触发 TTS、声线克隆、真实链接探测、付费验证、清理或删除。
   - `[已通过]` `pnpm test:unit tests/api/configs-auth.test.ts`
   - `[已通过]` `pnpm exec playwright test tests/e2e/mainline-visual-smoke.spec.ts --grep "no-paid downstream interactions"`
   - `[已通过]` `pnpm test:unit tests/components/report-basic-summary-sections.test.tsx tests/components/report-layout-legacy-cleanup.test.tsx`
   - `[已通过]` `pnpm exec playwright test tests/e2e/mainline-visual-smoke.spec.ts`（6 tests）
   - `[已通过]` `pnpm lint`（505 files）
   - `[已通过]` `pnpm test`（107 unit files / 711 unit tests；E2E 6 tests）
   - `[已通过]` `pnpm build`

126. `[已完成]` 文本稿素材来源 / text_draft ingest normal form 小闭环：
   - 按 `primitive-first-reduction` 将素材来源收敛为 `source_type + canonical payload -> transcript manifest`；`/ingest` 现在支持 `text_draft`，与 URL、文件同属 content ingest 入口。
   - 文本稿入口只生成 `transcript.md` 与 `transcript.json`，不调用 `ffmpeg`、`yt-dlp`、Whisper、MiniMax、TTS 或真实 provider，也不生成 audio/srt/video 产物。
   - 公开 job payload、job detail、job list、step history 和 logs 会 redaction `config.source_text` 与正文预览，只保留字数、隐藏标记和 artifact 指向；`text://draft` 作为输入哨兵值。
   - `/api/dubbing` 列表只返回 `translation_dubbing` 任务并做防御式 redaction；`/api/dubbing/[id]` 拒绝非配音任务，避免文本稿 ingest job 通过配音详情接口绕过 `/api/jobs/[id]`。
   - `/ingest` 的 text_draft query prefill 不再从 `source` 参数写入正文，避免全文进入地址栏、浏览器历史或 referer；text_draft artifact route 只允许 `transcript.md` 与 `transcript.json`。
   - 补齐 `attachPublicJobState` mock 覆盖，确认 `/api/jobs` list route 的公开 redaction helper 在 stress test 中不会因 mock 缺失失败。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax/GCS/Fish Audio，没有触发 TTS、声线克隆、真实链接探测、付费验证、清理或删除。
   - `[已通过]` `pnpm test:unit tests/api/mainline-free-route-stress.test.ts`
   - `[已通过]` `pnpm lint`（508 files）
   - `[已通过]` `pnpm test`（109 unit files / 723 unit tests；E2E 6 tests）
   - `[已通过]` `pnpm build`

127. `[已完成]` no-paid 只读 artifact 下载层小闭环：
   - 按 `primitive-first-reduction` 将下载层收敛为 `GET route -> auth/rate-limit/ownership -> resolve local artifact -> in-memory derive/read -> response`；默认下载不写 artifact/job/state/log 业务数据、不创建任务、不调用 provider。Bearer token 认证会更新 `last_used_at`，token rate-limit 会更新内存计数，这是横切副作用。
   - `/api/jobs/[id]/qa` 的 `GET` 默认改为纯读 QA JSON 下载：只计算报告和摘要并返回；需要写回 QA 摘要时改用同一路由的 `POST`，避免下载 GET 写状态。
   - QA JSON 下载补齐 `Content-Disposition: attachment; filename="{jobId}-qa.json"` 和 `Cache-Control: no-store`，与 delivery package 的下载合同一致。
   - `tests/e2e/mainline-fixtures.ts` 的 ingest transcript fixture 改写到 canonical `OUTPUT_DIR/ingest/{jobId}`，与 `/api/ingest/[id]/artifact` 路由一致。
   - `tests/e2e/mainline-visual-smoke.spec.ts` 新增 no-paid artifact 下载 smoke，覆盖 QA JSON、delivery README、script、translations、segments、ingest transcript.md/json；全程只发本地 GET，并断言没有 unexpected mutation。
   - sample-to-full 的 API stress 改为显式 `POST /api/jobs/[id]/qa`，保留“需要沉淀 QA 摘要时才写状态”的意图。
   - TEAM 两名只读代理均已完成并关闭；其指出的 QA GET 写状态和 QA JSON 缺下载 header 已处理。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax/GCS/Fish Audio，没有触发 TTS、声线克隆、真实链接探测、付费验证、清理或删除。
   - `[已通过]` `pnpm test:unit tests/api/job-qa.test.ts tests/api/mainline-free-route-stress.test.ts tests/jobs/job-artifact-contract.test.ts`
   - `[已通过]` `pnpm exec playwright test tests/e2e/mainline-visual-smoke.spec.ts --grep "no-paid artifact downloads"`
   - `[已通过]` `pnpm lint`（508 files）
   - `[已通过]` `pnpm test`（109 unit files / 724 unit tests；E2E 7 tests）
   - `[已通过]` `pnpm build`

128. `[已完成]` artifact 下载负例矩阵 / GET 只读契约加固小闭环：
   - 按 `primitive-first-reduction` 将负例矩阵收敛为：`route method × job state × source type × artifact whitelist × filename whitelist × path scope × file shape × range`。
   - `tests/api/job-download.test.ts` 补齐 final video 下载边界：job 不存在、未完成、全量附件下载、malformed range、unsatisfiable range、missing file、目录、其他 job output dir、旧中间 `_dubbed.mp4` 继续拒绝。
   - `tests/api/ingest-artifact.test.ts` 补齐 ingest artifact 边界：route 只暴露 GET、missing whitelisted artifact、text_draft 禁止 source.wav/source_video.mp4/transcript.srt、legacy direct 目录、manifest 嵌套路径、manifest 错文件名且不 fallback。
   - API `GET /api/jobs/[id]/qa?persist=summary` 现在仍保持纯读；需要持久化 QA summary 的 stress 路径已改为 `POST /api/jobs/[id]/qa`。
   - TEAM 三名代理均已完成并关闭；监察员未发现 P1 阻断，指出的 GET 写状态问题已迁移到 POST。Bearer token 的 `last_used_at` 与 token rate-limit 仍属于 auth/rate-limit 横切副作用，不属于 artifact 业务写入。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax/GCS/Fish Audio，没有触发 TTS、声线克隆、真实链接探测、付费验证、清理或删除。
   - `[已通过]` `pnpm test:unit tests/api/job-qa.test.ts tests/api/mainline-free-route-stress.test.ts tests/api/job-download.test.ts tests/api/ingest-artifact.test.ts`
   - `[已通过]` `pnpm lint`（508 files）
   - `[已通过]` `pnpm test`（109 unit files / 736 unit tests；E2E 7 tests）
   - `[已通过]` `pnpm build`

129. `[已完成]` artifact auth/rate-limit 横切副作用 normal form 小闭环：
   - 按 `primitive-first-reduction` 将下载层副作用边界收敛为：`Bearer header -> authenticateOrReject -> authenticate -> apiTokensRepo.verify -> updateLastUsed -> route-level checkRateLimit -> ownership -> artifact/read-only business response`。
   - `tests/api/artifact-auth-side-effects.test.ts` 现在覆盖四条 token GET 路径：`/api/jobs/[id]/artifact`、`/api/jobs/[id]/download`、`/api/ingest/[id]/artifact`、`/api/jobs/[id]/qa`。
   - 测试明确允许 `apiTokensRepo.updateLastUsed(tokenId)` 与 `checkRateLimit(tokenId)`，同时禁止 artifact/job/state 业务写入，并确认 API QA GET 不调用 `tryPersistDubbingQaReportSummary`。
   - `app/jobs/[id]/qa/page.tsx` 页面渲染时的 QA 摘要持久化已在第 130 项迁出；这是页面级纯读契约，不属于 `/api/jobs/[id]/qa` 下载 route 契约。
   - TEAM 三名代理均已完成并关闭；其指出的 3/4 覆盖缺口已补到 QA GET，文档中“业务只读”与“绝对无写入”的表述已分开。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax/GCS/Fish Audio，没有触发 TTS、声线克隆、真实链接探测、付费验证、清理或删除。
   - `[已通过]` `pnpm test:unit tests/api/artifact-auth-side-effects.test.ts`（1 file / 4 tests）
   - `[已通过]` `pnpm lint`
   - `[已通过]` `pnpm test`
   - `[已通过]` `pnpm build`

130. `[已完成]` QA 页面纯读 / 显式 backfill 写入 normal form 小闭环：
   - 按 `primitive-first-reduction` 将 QA 摘要拆成 `evaluate -> summarize -> persist` 三个 primitive；页面和 API GET 只做 evaluate，业务写回只走 `POST /api/jobs/[id]/qa`、`POST /api/jobs/qa/backfill` 或 workflow completion capture。
   - `app/jobs/[id]/qa/page.tsx` 已移除 render-time `tryPersistDubbingQaReportSummary`；打开质检页面不会创建或更新 `job_current_state.step_context.qa_summary`。
   - 新增 `tests/app/job-qa-page.test.tsx`，锁定页面仍会读取 artifact、计算 QA、生成重跑链接，但不会持久化 QA 摘要。
   - 新增 `tests/api/qa-backfill-route.test.ts`，覆盖 session scope、token scope、token rate-limit、auth rejection、`limit` 夹取到 `1..100`、`force` 传递和 429 前不进入 repo/backfill。
   - TEAM 两名只读代理均已完成并关闭；其指出的 backfill route 覆盖缺口已补齐。backfill 库 current/stale/force/failure 矩阵已在第 131 项补齐；`QaBackfillButton` 可见 UI command 已在第 132 项补测。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax/GCS/Fish Audio，没有触发 TTS、声线克隆、真实链接探测、付费验证、清理或删除。
   - `[已通过]` `pnpm test:unit tests/api/qa-backfill-route.test.ts tests/app/job-qa-page.test.tsx tests/api/artifact-auth-side-effects.test.ts`（3 files / 9 tests）
   - `[已通过]` `pnpm lint`（511 files）
   - `[已通过]` `pnpm test`（112 unit files / 745 unit tests；E2E 7 tests）
   - `[已通过]` `pnpm build`

131. `[已完成]` QA backfill 库行为矩阵加固小闭环：
   - 按 `primitive-first-reduction` 将 batch backfill 收敛为 `scan -> eligibility -> freshness -> persist -> aggregate result`。
   - `tests/jobs/dubbing-qa-backfill.test.ts` 已覆盖：非 completed/非 dubbing 任务跳过、current summary 跳过、stale/missing summary 生成、`force` 强制生成、单任务异常进入 `failed/failures` 且不阻断后续任务、`limit` 只扫描安全数量。
   - 保留已有 current workflow state -> artifact fingerprint 覆盖，确保 freshness 判断使用当前 `artifact_manifest` 和 state，而不是只看 job row。
   - 后续盘点确认 `QaBackfillButton` 实际已存在并挂在 `/jobs` 页面；该可见 UI command 已在第 132 项补齐组件测试，没有新增入口。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax/GCS/Fish Audio，没有触发 TTS、声线克隆、真实链接探测、付费验证、清理或删除。
   - `[已通过]` `pnpm test:unit tests/jobs/dubbing-qa-backfill.test.ts tests/api/qa-backfill-route.test.ts`（2 files / 11 tests）
   - `[已通过]` `pnpm lint`（511 files）
   - `[已通过]` `pnpm test`（112 unit files / 751 unit tests；E2E 7 tests）
   - `[已通过]` `pnpm build`

132. `[已完成]` QA backfill 可见 UI command 测试小闭环：
   - 按 `primitive-first-reduction` 将可见操作收敛为 `visible command -> POST /api/jobs/qa/backfill -> toast -> router.refresh`。
   - 新增 `tests/components/qa-backfill-button.test.tsx`，覆盖成功提交 `limit`、成功 toast 与刷新、API 错误提示、malformed response fallback。
   - 修正第 130/131 项中对 `QaBackfillButton` 的误判：该组件实际存在并挂在 `/jobs` 页面；本轮只补测现有入口，不新增 UI surface。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax/GCS/Fish Audio，没有触发 TTS、声线克隆、真实链接探测、付费验证、清理或删除。
   - `[已通过]` `pnpm test:unit tests/components/qa-backfill-button.test.tsx tests/api/qa-backfill-route.test.ts tests/jobs/dubbing-qa-backfill.test.ts`（3 files / 14 tests）

133. `[已完成]` active docs / UI source copy normal form 补强小闭环：
   - TEAM 两名只读代理均已完成并关闭；文档监察员将 docs 分成 active docs、archived docs、credentials-only docs、negative-test docs，UI 监察员确认无繁体源码残留并指出 `/jobs`、`/dubbing`、guide tabs、settings components 的 allowlist 漏洞。
   - 文档层已把 `/api/jobs POST` 移出主线创建表并放入已下架入口；credentials、testing index、agent index、database、utils、dynamic workflow docs 已改成当前 `content_ingest / translation_dubbing / WorkflowArtifactManifest / MiniMax` 主线语义，Fish Audio 和分镜表只作为历史兼容。
   - UI 层已把 `/jobs`、dubbing progress、guide tabs、settings components 纳入 `tests/docs/mainline-positioning-guard.test.ts` 的源码简体 normal form；guard 名称从 UI 扩展为 active mainline source copy，允许覆盖日志/交付包这类会被 UI 展示的数据 copy。
   - `/jobs` 删除确认不再写“视频分析结果、分镜数据”，改为任务产物、转录/配音资产和运行日志；`LogsPanel` 的“完整分镜数据”改为通用“完整详细资料”；API Token 删除确认按钮改为“删除 Token”。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax/GCS/Fish Audio，没有触发 TTS、声线克隆、真实链接探测、付费验证、清理或删除。
   - `[已通过]` `pnpm test:unit tests/docs/mainline-positioning-guard.test.ts`
   - `[已通过]` `pnpm lint`（512 files）
   - `[已通过]` `pnpm test`（113 unit files / 754 tests；E2E 7 tests）
   - `[已通过]` `pnpm build`

134. `[已完成]` active test recipes / source display / cost provider normal form 小闭环：
   - 按 `primitive-first-reduction` 将本轮表面收敛为三组 normal form：`current test recipe`、`source display row`、`provider cost row`。旧 `CreateJob/styleId/prepare_gemini/TTS 管理` 只能作为历史兼容或负向测试；主线 UI 不直接拼接空 `label: url`，而是先格式化成 `{label, value, detail}`；成本卡不再把 TTS 成本硬编码成 Gemini/Fish 两栏。
   - 文档层修正 `docs/agent/testing/static/type-system.md`、`api-routes.md`、`code-quality.md`、`dynamic/local-api.md`：当前示例改为 `/api/ingest` / `/api/dubbing`，旧 `/api/jobs` 多视频 payload 改成 410 负向快照，旧 TTS 标成 Fish/Edge 历史兼容。
   - `tests/docs/mainline-positioning-guard.test.ts` 新增 active recipe guard，禁止 `CreateJobRequest + styleId`、`CreateJobSchema + styleId`、`WorkflowStep + prepare_gemini`、普通 `TTS 管理` 表格和 “检查 styles 表” 回流。
   - `components/workbench/workbench-client.tsx` 现在对文本稿来源显示“文本稿（N 字，正文已隐藏）”，并提示查看转录稿文件；不会把 `text://draft` 或原始正文暴露成素材来源。
   - `lib/cost/calculator.ts` 与 `components/workbench/CostSummaryCard.tsx` 现在识别 `MiniMax` / `minimax_tts` 调用，显示 MiniMax TTS 调用次数、执行耗时和音频片段数；旧 Fish/Edge 记录显示为“旧 TTS 兼容”，不再作为当前主线 provider 名称。
   - `components/report/ReportLayout.tsx` 对 `content_ingest` / `translation_dubbing` report 清掉 video 层的 `gemini_uri`、`analysis_prompt`、`analysis_response`，避免被污染的主线 report 泄露旧 Gemini 分镜语义；旧剪辑 report 仍保留兼容展示。
   - `lib/jobs/job-display.ts` 的来源标题 fallback 会 trim 空白，避免旧/稀疏数据在 `/jobs`、dashboard、compare/report 中显示视觉空白；`app/api/configs/route.ts` 的 batch size 错误文案改为“配音文本批量处理数量”。
   - TEAM 两名文档/安全 smoke 只读代理和一名 UI 监察员均已完成并关闭；本轮处理其 P1/P2 建议。后续 no-paid smoke 建议只新增 `GET 页面/产物/预填`、`PUT 本地 configs`、`PATCH fixture job audit`，继续避开任务创建、provider probe、付费验证、删除和 token 生成。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax/GCS/Fish Audio，没有触发 TTS、声线克隆、真实链接探测、付费验证、清理或删除。
   - `[已通过]` `pnpm test:unit tests/components/workbench-client.test.tsx tests/cost-calculator.test.ts tests/components/cost-summary-card.test.tsx tests/components/report-layout-legacy-cleanup.test.tsx tests/docs/mainline-positioning-guard.test.ts`（5 files / 27 tests）
   - `[已通过]` `pnpm exec playwright test tests/e2e/mainline-visual-smoke.spec.ts`（8 tests）
   - `[已通过]` `pnpm lint`（514 files）
   - `[已通过]` `pnpm test`（115 unit files / 758 tests；E2E 8 tests）
   - `[已通过]` `pnpm build`

135. `[已完成]` no-paid rerun prefill / delivery visible links GET-only 小闭环：
   - 按 `primitive-first-reduction` 将本轮表面收敛为两组 primitive：`job/config -> /dubbing query -> 客户端预填` 与 `VisibleLink = {surface, linkText, href, localGetRoute, assertion}`。目标是在花 TTS/合成成本前，看见重跑参数、QA 修稿、样片转全片和交付包本地链接，且不创建任务。
   - `tests/e2e/mainline-visual-smoke.spec.ts` 新增 `getVisibleLinkHref`，并补三条 no-paid smoke：QA 样片的 `带 QA 跑全片` 链接只进入 `/dubbing` 预填；工作台交付包的 README、口播稿、翻译 JSON、原始分段、QA JSON、声线披露、质检报告、任务报告、版本比较都是本地 GET 链接；report/QA/compare 三个复用 surface 的链接也做 href 防漂移断言。
   - `/dubbing` 预填 smoke 覆盖 `fromJob`、`sampleToFull=true`、`sampleAssetSnapshot=true`、无 `sampleMode`、QA `revisionNotes`、视频来源、声线和“开始转译”按钮可见；测试没有点击提交、没有触发 `/api/dubbing` 创建任务。
   - `components/workbench/workbench-client.tsx` 收紧样片转全片入口：只有 `completed + sample_mode` 才显示 `带 QA 跑全片` / `同设置跑全片`；失败样片仍可 `同设定重跑` 修复，但不会直接推广为全片。
   - `tests/components/workbench-client.test.tsx` 新增失败样片保护用例，锁定 failed sample job 不显示 `跑全片` 链接。
   - TEAM 两名只读代理均已完成并关闭；其中一名指出 failed sample promotion 缺口，已修复；另一名建议的 report/QA/compare 可见链接防漂移已补入 E2E。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax/GCS/Fish Audio，没有触发 TTS、声线克隆、真实链接探测、付费验证、清理或删除。
   - `[已通过]` `pnpm test:unit tests/components/workbench-client.test.tsx`（1 file / 17 tests）
   - `[已通过]` `pnpm exec playwright test tests/e2e/mainline-visual-smoke.spec.ts --grep "no-paid rerun handoff|no-paid delivery package visible"`（2 tests）
   - `[已通过]` `pnpm exec playwright test tests/e2e/mainline-visual-smoke.spec.ts --grep "no-paid report qa compare"`（1 test）
   - `[已通过]` `pnpm exec playwright test tests/e2e/mainline-visual-smoke.spec.ts`（11 tests）
   - `[已通过]` `pnpm lint`（514 files）
   - `[已通过]` `pnpm test`（115 unit files / 759 tests；E2E 11 tests）
   - `[已通过]` `pnpm build`

136. `[已完成]` no-paid final video local delivery / download GET 小闭环：
   - 按 `primitive-first-reduction` 将成片交付收敛为一个三元组 normal form：`jobId -> safe local file -> job_current_state.final_video_local_path`，再映射到既有 `deliveryPackage.items[id="final_video"] -> /api/jobs/{jobId}/download`。
   - `tests/e2e/mainline-fixtures.ts` 为 `e2e-dub-full` 写入安全 job output 直接子目录 `OUTPUT_DIR/20260429-e2e-dub-full/final.mp4`，并保存到 `job_current_state.final_video_local_path`。该文件是 no-paid placeholder，只用于本地下载契约，不是 provider 产物。
   - `tests/e2e/mainline-visual-smoke.spec.ts` 扩展 `fetchLocalArtifact` header 读取，覆盖 `/api/jobs/e2e-dub-full/download` 的 `200`、`video/mp4`、`Content-Disposition`、`Content-Length`、`Accept-Ranges` 和本地 sentinel body；工作台交付包和 report 交付包都断言 `MP4` 链接指向同一个 `/download`，工作台 `<video>` 预览也使用同一个 src。
   - `tests/api/job-download.test.ts` 补齐 final video 下载 route header contract：完整下载与 Range 下载都返回 `video/mp4`、`Accept-Ranges: bytes`，Range 下载还断言 `Content-Length`。
   - TEAM 两名只读代理均已完成并关闭；其确认 dummy 文件可行，因为 route 只校验安全路径、文件名和普通文件，不校验 MP4 编码。若后续要验证真实浏览器 metadata，可再替换成 tiny valid MP4。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax/GCS/Fish Audio，没有触发 TTS、声线克隆、真实链接探测、付费验证、清理或删除。
   - `[已通过]` `pnpm test:unit tests/api/job-download.test.ts`（1 file / 13 tests）
   - `[已通过]` `pnpm exec playwright test tests/e2e/mainline-visual-smoke.spec.ts --grep "no-paid artifact downloads|no-paid delivery package visible|no-paid report qa compare"`（3 tests）
   - `[已通过]` `pnpm exec playwright test tests/e2e/mainline-visual-smoke.spec.ts`（11 tests）
   - `[已通过]` `pnpm lint`（514 files）
   - `[已通过]` `pnpm test`（115 unit files / 759 tests；E2E 11 tests）
   - `[已通过]` `pnpm build`

137. `[已完成]` no-paid 交付证据矩阵 / ready baseline 小闭环：
   - 按 `primitive-first-reduction` 将交付证据收敛为固定三行 normal form：`qa_freshness`、`manual_final_listen`、`provider_smoke`，每行统一检查 `id + status + summary + detail + href`。
   - `tests/e2e/mainline-fixtures.ts` 现在保留 `e2e-dub-sample` 作为 warning / not_recorded baseline；`e2e-dub-full` 写入匹配当前 artifact/config/delivery 的 QA input fingerprint、人工终听 `passed` 记录、本地 dry-run provider smoke audit log，并继续使用本地 final.mp4 placeholder。
   - provider smoke ready baseline 只写本地 `job_logs` dry-run audit：`external_calls_executed=false`，所有 gate 都是 no-paid dry-run，不调用 YouTube/Gemini/MiniMax/GCS/Fish Audio，不触发 TTS、声线克隆或真实链接探测。
   - `tests/e2e/mainline-visual-smoke.spec.ts` 新增 no-paid delivery evidence matrix smoke，直接断言 sample 的 `qa_freshness: warning`、`manual_final_listen: not_recorded`、`provider_smoke: warning`，以及 full 的三行 evidence 都为 `ready`，并验证 report `#delivery-package` 与 `#provider-smoke` 的可见文案。
   - 现有 no-paid downstream interaction smoke 在保存人工终听后，除了读 DB，也会通过 `/api/jobs/{id}` 和任务页确认 `manual_final_listen` evidence 已变为 ready。
   - TEAM 两名只读代理均已完成并关闭；其共同指出的缺口是 E2E 只测链接/下载，缺少 evidence badge/status 可见断言。本轮已按其建议补齐。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax/GCS/Fish Audio，没有触发 TTS、声线克隆、真实链接探测、付费验证、清理或删除。
   - `[已通过]` `pnpm exec playwright test tests/e2e/mainline-visual-smoke.spec.ts --grep "delivery evidence matrix|downstream interactions|delivery package visible"`（3 tests）
   - `[已通过]` `pnpm exec playwright test tests/e2e/mainline-visual-smoke.spec.ts`（12 tests）
   - `[已通过]` `pnpm lint`（514 files）
   - `[已通过]` `pnpm test`（115 unit files / 759 tests；E2E 12 tests）
   - `[已通过]` `pnpm build`

138. `[已完成]` negative-test docs / destructive cleanup / production config guard normal form 小闭环：
   - 按 `primitive-first-reduction` 将动态测试文档收敛为四类：当前主线、负向测试、破坏性测试、凭证测试。当前主线只允许 `/api/ingest -> /api/dubbing -> /api/jobs -> QA -> sample-to-full -> compare/report -> long-term assets` 作为成功路径。
   - 旧 `/api/jobs POST` 与旧 `/api/styles` 写入口负向验证已统一要求 `ALLOW_LEGACY_WRITE_NEGATIVE_TESTS`；旧 jobs payload 统一使用 `mock://legacy/...` 或 `mock://guide-legacy/...`，不再使用真实 R2 媒体 URL。
   - `docs/agent/testing/dynamic/local-workflow.md`、`cloud-workflow.md`、`local-task-control.md`、`cloud-task-control.md` 的手工负向检查也补上同一 normal form，避免绕过 API 文档直接执行旧写入口。
   - `POST /api/storage/cleanup` 在 `preview:false` 时新增服务端 `destructive_confirmation: "confirm_storage_cleanup"` 要求；设置页执行清理时同步发送该确认字段。预览仍不需要破坏性确认。
   - `scripts/obfuscate-config.json` 的生产保留标识移出旧 Gemini/分镜剪辑 step 和 `single-video/multi-video` workflow id，改为当前 `content-ingest`、`translation-dubbing` 与主线 step class；`tests/docs/mainline-positioning-guard.test.ts` 新增生产配置 guard。
   - 设置页 Fish Audio 成功 fallback 文案改为“旧兼容”；系统配置中的视觉理解字段改为“未启用视觉理解预留”，减少旧 Gemini 视频分析入口误读。
   - TEAM 三名只读代理均已完成并关闭；最后一名指出的 mock URI normal form 与 workflow/task-control 文字负向检查缺口已补齐。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax/GCS/Fish Audio，没有触发 TTS、声线克隆、真实链接探测、付费验证、清理或删除。
   - `[已通过]` `pnpm test:unit tests/docs/dynamic-testing-safety-guard.test.ts tests/docs/mainline-positioning-guard.test.ts tests/api/storage-admin-auth.test.ts`（3 files / 17 tests）
   - `[已通过]` `pnpm lint`（514 files）
   - `[已通过]` `pnpm test`（115 unit files / 763 tests；E2E 12 tests）
   - `[已通过]` `pnpm build`

139. `[已完成]` active instruction / database provider / license feature normal form 小闭环：
   - TEAM 两名只读代理均已完成并关闭；文档监察员指出 `AGENTS.md` 与 `docs/agent/database.md` 仍把旧剪辑/旧 provider 写得像当前能力，代码监察员指出授权码 feature bit 仍输出 `single_video / multi_video / all_styles`。
   - 按 `primitive-first-reduction` 将本轮表面收敛为三组 normal form：`product path policy`、`database step/provider taxonomy`、`license feature bit -> current capability`。旧剪辑只允许历史读取和负向兼容检查；当前能力只允许 `content_ingest / translation_dubbing / creator_assets` 这类主线能力名。
   - `AGENTS.md` 已把旧 AI 剪辑从“secondary functionality”改为仅保留历史记录读取和负向兼容检查，不再是可创建、可执行、次级或首页产品路径。
   - `docs/agent/database.md` 已把 `job_step_history.major_step`、`job_logs.service_name`、`api_calls.service` 与成本追踪说明改成当前主线 provider/step taxonomy；Fish Audio、Edge TTS、GCS、旧 Gemini 视频分析仅作为历史兼容读取。
   - V3 授权码保留旧 bit 位兼容，但 `validateLicenseCodeV3()` 现在解析为 `content_ingest / translation_dubbing / creator_assets`；`scripts/license-generate-v3.ts` 的输出文案也改为“素材吸收、翻译配音、创作者资产”，旧 feature 名称只保留为输入别名。
   - `scripts/license-generate-v3.ts` 移除带 BOM 的 shebang，修复当前 `tsx` 环境下的解析失败；`--features content_ingest,translation_dubbing,creator_assets` 已实跑并正确输出三项当前能力。
   - 新增 `tests/license/validator-v3.test.ts`，并扩展 `tests/docs/mainline-positioning-guard.test.ts`：锁定 AGENTS product path、数据库 active docs、license feature surface 和执行计划日志递增顺序。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax/GCS/Fish Audio，没有触发 TTS、声线克隆、真实链接探测、付费验证、清理或删除。
   - `[已通过]` `pnpm test:unit tests/docs/mainline-positioning-guard.test.ts tests/license/validator-v3.test.ts`（2 files / 11 tests）
   - `[已通过]` `pnpm exec tsx scripts/license-generate-v3.ts --customer 12 --months 72 --features content_ingest,translation_dubbing,creator_assets --max-jobs 25 --max-duration 0`
   - `[已通过]` `pnpm lint`（515 files）
   - `[已通过]` `pnpm test`（116 unit files / 768 tests；E2E 12 tests）
   - `[已通过]` `pnpm build`

140. `[已完成]` legacy Fish/Edge TTS 默认关闭 normal form 小闭环：
   - TEAM 三名只读代理均已完成并关闭；监察员指出旧 TTS API/UI 默认关闭后，仍需补运行时旁路、设置页 Fish 配置可见入口、`/api/api-keys/[service]` 预览和 Fish `save_only` 漏口。
   - 按 `primitive-first-reduction` 将旧 TTS 收敛为一个 normal form：`LEGACY_TTS_ENABLED=false` 默认只允许读取 disabled status；旧 voices、旧 voice verify、旧 Fish 凭证写入/验证、直接 provider class、manager getter 和 workflow TTS config resolver 都 fail closed。
   - `lib/ai/tts/legacy-policy.ts` 新增 `assertLegacyTtsEnabled()`；`ttsManager`、`EdgeTTSProvider`、`FishAudioProvider`、`resolveTTSConfig()` 统一使用该 gate，默认关闭时不会加载 voice catalog、不会读 Fish 凭证、不会调用 Edge/Fish provider。
   - `/api/tts/status` 与 `/api/tts/voices` 的旧运行时 import 改为 enabled 分支内动态导入；默认 disabled 分支保持纯本地返回。
   - `/settings` 的 Google Vertex / AI Studio 标签页默认不再显示 Fish Audio 状态和配置表单；维护兼容页只显示「旧 TTS 兼容已关闭」。只有 `LEGACY_TTS_ENABLED=true` 后才渲染历史兼容表单。
   - `TTSConfig` fail closed：`/api/tts/status` 失败或未明确返回 `legacy_tts_enabled: true` 时不渲染旧 TTS 表单、保存按钮或验证按钮。
   - Fish Audio 旧兼容凭证不支持 `save_only`；写入只能走 `verify_and_save`，并必须同时具备 `LEGACY_TTS_ENABLED=true`、legacy confirmation、paid confirmation 和 `ALLOW_PAID_DYNAMIC_TESTS=true`。`/api/api-keys/[service]` 也已加认证和 Fish disabled 410 gate。
   - 文档与 safety guard 已同步：`docs/agent/env-vars.md`、`api-routes.md`、credentials、dynamic/static testing docs 都明确 `LEGACY_TTS_ENABLED=false` 默认 410 disabled，以及旧 Fish 写入验证不支持 `save_only`。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax/GCS/Fish Audio，没有触发 TTS、声线克隆、真实链接探测、付费验证、清理或删除。
   - `[已通过]` `pnpm test:unit tests/ai/legacy-tts-runtime-gate.test.ts tests/api/tts-legacy-auth.test.ts tests/api/api-key-verify-route.test.ts tests/api/api-keys.test.ts tests/components/tts-config.test.tsx tests/app/settings-page-legacy-tts.test.tsx tests/docs/mainline-positioning-guard.test.ts tests/docs/api-routes-safety-guard.test.ts tests/docs/dynamic-testing-safety-guard.test.ts`（9 files / 87 tests）
   - `[已通过]` `pnpm exec playwright test tests/e2e/mainline-visual-smoke.spec.ts --grep "settings keeps compatibility"`（1 test）
   - `[已通过]` `pnpm test:unit tests/api/api-keys.test.ts tests/api/api-key-service-route.test.ts tests/docs/api-routes-safety-guard.test.ts tests/docs/dynamic-testing-safety-guard.test.ts tests/docs/mainline-positioning-guard.test.ts tests/app/settings-page-legacy-tts.test.tsx tests/components/tts-config.test.tsx tests/ai/legacy-tts-runtime-gate.test.ts`（8 files / 68 tests）
   - `[已通过]` `pnpm lint`（519 files）
   - `[已通过]` `pnpm test`（119 unit files / 785 tests；E2E 12 tests）
   - `[已通过]` `pnpm build`

141. `[已完成]` source-bound provider smoke / manual authorization normal form 小闭环：
   - 按 `primitive-first-reduction` 将真实 provider smoke 前置 normal form 收敛为：`runtime_fingerprint + source_ref + audit_job_id + dry_run_evidence + run/concurrency/budget + confirmed_gate_ids + manual_authorization`。
   - `dry-run provider smoke rehearsal` 现在必须带 `DRY_RUN_PROVIDER_SMOKE_SOURCE_URL`，但只写 `source_ref.host + url_sha256`，不访问 YouTube/Gemini/MiniMax；本地 NDJSON 与 server latest dry-run evidence 都必须 source-bound。
   - `real_provider_smoke` 和 `provider-smoke:armed-run` 现在必须提交机器可验证 `manual_authorization`，绑定确认人、确认时间、job、source fingerprint、runs/concurrency/budget 和固定确认项；占位符、过期或 scope mismatch 都在外部调用前 fail closed。
   - route 和 armed-run 都拒绝重复 `confirmed_gate_ids`，避免 `["youtube_download","youtube_download","translation_provider"]` 这类表面集合误判为通过。
   - `source_ref` 只接受 `http(s)` source URL；本地路径、`file:` 或其他协议不会生成可用于真实 provider smoke 的 source fingerprint。
   - armed-run 逐轮校验真实 smoke 响应的 `audit.runtime_fingerprint`、`audit.source_ref` 与 `audit.manual_authorization`，不再只信任启动前读取的 runtime fingerprint 或客户端提交参数。
   - `docs/agent/api-routes.md`、`docs/agent/video-processing.md`、`docs/dubbing-guide.md` 与 `docs/agent/testing/static/config-style.md` 已同步 provider smoke 边界，避免重新引入可复制 `real_provider_smoke` 裸 curl / 裸 JSON。
   - TEAM 文档监察员和代码监察员均已完成只读复核；其指出的旧口径、request/body duplicate gate、manual authorization duplicate gate 与响应漂移缺口已补齐。
   - 第 80/82/83/88 条中的 `dry-run 不传 source_url`、`避免 source_ref`、`body 仅含 mode/job_id` 属于历史旧口径，当前执行与守卫都以本条 source-bound rehearsal normal form 为准。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax/GCS/Fish Audio，没有触发 TTS、声线克隆、付费验证、清理或删除。
   - `[已通过]` `pnpm test:unit tests/workflow/provider-gate-confirmation.test.ts tests/api/ingest-dubbing-readiness-smoke-route.test.ts tests/api/dubbing-route.test.ts tests/jobs/provider-smoke-audit.test.ts tests/scripts/provider-smoke-armed-run.test.ts tests/docs/dynamic-testing-safety-guard.test.ts`（6 files / 121 tests）
   - `[已通过]` `pnpm lint`（519 files）
   - `[已通过]` `pnpm test`（119 unit files / 799 tests；E2E 12 tests）
   - `[已通过]` `pnpm build`

142. `[已完成]` no-network manual authorization preparation 小闭环：
   - 按 `primitive-first-reduction` 将真实 provider smoke 压测前授权收敛为本地 command object：`source_ref + audit_job_id + dry_run_evidence + runtime_fingerprint + runs/concurrency/budget + confirmed_by -> manual_authorization JSON`。
   - 新增 `pnpm provider-smoke:manual-auth:prepare -- --confirmed-by "<operator>"`，复用 `provider-smoke-armed-run.mjs` 的验证逻辑，只读本地 dry-run evidence、source/runtime/budget 环境变量和确认人，写入 `PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE`。
   - 该命令不读取 `TEST_API_TOKEN`，不要求或设置 `ALLOW_PAID_DYNAMIC_TESTS`，不连接 localhost/目标 API、YouTube、Gemini 或 MiniMax，不创建 job，不触发 TTS、声线克隆或付费验证。
   - 写入前会校验 dry-run evidence 的 job/source/runtime/freshness、预算和次数/并发上限，以及 `confirmed_by` 不能是占位符；失败时不写授权文件。
   - `docs/agent/api-routes.md`、`docs/dubbing-guide.md`、`docs/agent/testing/dynamic/local-api.md`、`cloud-api.md` 与 `provider-smoke-preflight-handoff-snapshots.md` 已同步：人工授权文件由本地 no-network 命令生成，不从文档手写裸 JSON。
   - TEAM 只读监察员已完成复核；其指出的缺口已收敛为本地 no-network CLI，而不是继续让 operator 手写裸 JSON。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax/GCS/Fish Audio，没有触发 TTS、声线克隆、付费验证、清理或删除。
   - `[已通过]` `pnpm test:unit tests/scripts/provider-smoke-manual-authorization.test.ts tests/scripts/provider-smoke-armed-run.test.ts tests/docs/dynamic-testing-safety-guard.test.ts tests/docs/api-routes-safety-guard.test.ts`（4 files / 36 tests）
   - `[已通过]` `pnpm lint`（520 files）
   - `[已通过]` `pnpm test`（120 unit files / 803 tests；E2E 12 tests）
   - `[已通过]` `pnpm build`

143. `[已完成]` no-network provider smoke readiness bundle / 付费前人工停顿小闭环：
   - 按 `primitive-first-reduction` 将真实 provider smoke 前的操作面收敛为：`dry-run evidence + manual_authorization + source/runtime/budget binding -> redacted readiness bundle -> 人工确认 -> armed-run preflight -> armed run`。
   - 新增 `pnpm provider-smoke:readiness:bundle`，复用 `provider-smoke-armed-run.mjs` 的本地校验原语，输出 `provider_smoke_readiness_bundle`、`ready_for_manual_authorization`、`ready_for_paid_armed_preflight`、`ready_to_arm`、stage statuses 和下一步动作。
   - readiness bundle 不连接 localhost/目标 API、YouTube、Gemini 或 MiniMax，不打印 `TEST_API_TOKEN` 或原始 source URL，不创建 job，不触发 TTS、声线克隆、付费验证或 provider 调用。
   - `manual-auth:prepare` 增加 `forbidden_env_present` 布尔报告，只显示 `TEST_API_TOKEN`、`ALLOW_PAID_DYNAMIC_TESTS`、`ALLOW_STRESS_DYNAMIC_TESTS` 是否存在，不回显值。
   - 动态测试文档已把 `preflight && armed-run` 拆成两个代码块，中间要求人工核对 redacted handoff、readiness bundle、预算、次数/并发、声线边界和 operator 后才运行真实 provider smoke。
   - local/cloud shell SOP 已补 `/api/runtime/fingerprint` 读取和 `runtime_fingerprint` 写入 dry-run NDJSON，避免文档生成的 evidence 与 armed-run 校验口径漂移。
   - snapshot 文档已改成简体中文 normal form，并新增 `manual-authorization-preparation` 与 `readiness-bundle` 快照说明。
   - TEAM 两名只读监察员均已完成并关闭；其指出的 readiness bundle 缺口、shell SOP/runtime fingerprint 漂移、`preflight && armed-run` 付费连跑风险和 snapshot 文档英文表面已处理。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax/GCS/Fish Audio，没有触发 TTS、声线克隆、付费验证、清理或删除。
   - `[已通过]` `pnpm test:unit tests/scripts/provider-smoke-readiness-bundle.test.ts tests/scripts/provider-smoke-manual-authorization.test.ts tests/docs/dynamic-testing-safety-guard.test.ts tests/docs/api-routes-safety-guard.test.ts`（4 files / 20 tests）
   - `[已通过]` `pnpm lint`（521 files）
   - `[已通过]` `pnpm test`（121 unit files / 808 tests；E2E 12 tests）
   - `[已通过]` `pnpm build`

144. `[已完成]` provider smoke readiness bundle 可归档文件输出小闭环：
   - 按 `primitive-first-reduction` 将 readiness bundle 拆成 canonical JSON report 和 file output adapter；stdout 仍是主契约，可选 `PROVIDER_SMOKE_READINESS_BUNDLE_FILE` / `PROVIDER_SMOKE_READINESS_BUNDLE_MARKDOWN_FILE` 只负责写本地 redacted JSON/Markdown。
   - JSON/Markdown 输出沿用同一脱敏 normal form：只允许 `source_ref.host + url_sha256`、runtime fingerprint、预算、stage statuses 和下一步动作；不得包含 `TEST_API_TOKEN`、原始 source URL、完整 NDJSON 或 provider 响应正文。
   - 动态 local/cloud 文档已把交接 archive 明确为本地 redacted JSON + optional Markdown view + `output_reference`，并要求设置 `PROVIDER_SMOKE_READINESS_BUNDLE_ROOT`、`PROVIDER_SMOKE_READINESS_BUNDLE_FILE`、`PROVIDER_SMOKE_READINESS_BUNDLE_MARKDOWN_FILE`。
   - 路径边界已补齐：archive 输出必须位于 root 内，JSON/Markdown 不可同一路径，不可覆盖 dry-run evidence、manual authorization 或 armed-run log；同时用 realpath/symlink guard 阻止 junction/symlink 逃出 root，并用 sensitive-text guard 阻止 token、原始 source URL 或 bearer-like 文本进入可见字段。
   - snapshot 文档已补 `readiness-bundle-archive-mode` shape：`schema_version/generated_at/status/safety/next_allowed_command/output_reference`，并禁止 raw source URL、token、bearer、完整 NDJSON 和 provider response body。
   - 本轮修改了 provider smoke armed-run script、readiness bundle 单测和动态测试文档；没有运行 provider/API，没有触发真实外部调用、TTS、声线克隆、付费验证、清理或删除。

145. `[已完成]` provider smoke paid-gate 前 no-paid handoff verifier / pressure plan 小闭环：
   - 按 `primitive-first-reduction` 将付费压力测试前的交接面收敛为 `scope + evidence + manual_authorization + budget_limit + gate_status + safety + next_allowed_command + copyable_checklist`，并新增显式 normal form：`no_paid_handoff_pressure_plan`。
   - `pnpm provider-smoke:handoff:verify` 现在输出 `provider_smoke_paid_handoff_verifier` + `normal_form=no_paid_handoff_pressure_plan`；它要求 paid/stress gates 尚未设置，只允许进入人工确认，不授权 provider call，不连接 localhost/YouTube/Gemini/MiniMax，不创建 job，也不能作为 armed-run 执行凭证。
   - 新增同义命令 `pnpm provider-smoke:pressure-plan`，指向同一个 `--handoff-verify` 路径，供人工交接时按“压力计划”理解，不新增第二套逻辑。
   - handoff checklist 增加“本命令不是 preflight，不能提前设置 paid/stress gates，也不能把 ok=true 当作付费授权”；同时补了缺失 `TEST_API_TOKEN` 时 blocked 的回归测试。
   - 动态 local/cloud SOP、snapshot 文档、API route 文档与 dubbing guide 已同步：真实 provider smoke 顺序固定为 `readiness:bundle -> handoff:verify / pressure-plan -> 人工确认 -> armed-run:preflight -> armed-run`。
   - 文档安全守卫已锁定 `handoff-verifier-ready`、`handoff-verifier-gates-present`、`provider_calls_authorized=false`、no-paid/no-network 边界和 package script surface，避免把 handoff verifier 写成新的付费入口。
   - TEAM 两名只读代理均已完成；代码侧指出的 alias、normal_form、token 缺失测试已补齐，文档侧指出的 SOP/API/dubbing/snapshot 同步已补齐。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax/GCS/Fish Audio，没有触发 TTS、声线克隆、付费验证、清理或删除。
   - `[已通过]` `pnpm test:unit tests/scripts/provider-smoke-armed-run.test.ts tests/scripts/provider-smoke-readiness-bundle.test.ts tests/docs/dynamic-testing-safety-guard.test.ts tests/docs/mainline-positioning-guard.test.ts`（4 files / 51 tests）
   - `[已通过]` `pnpm lint`（521 files）
   - `[已通过]` `pnpm test`（121 unit files / 820 tests；E2E 12 tests）
   - `[已通过]` `pnpm build`

146. `[已完成]` provider smoke no-paid handoff archive / fail-closed 语义收紧小闭环：
   - 按 `primitive-first-reduction` 将 paid gate 前链路收敛为：`dry-run evidence -> manual authorization -> readiness bundle -> no-paid handoff archive -> paid preflight -> armed run`。本轮只处理 no-paid archive adapter 和状态语义，不进入真实 provider smoke。
   - `pnpm provider-smoke:manual-auth:prepare` 在 `TEST_API_TOKEN`、`ALLOW_PAID_DYNAMIC_TESTS` 或 `ALLOW_STRESS_DYNAMIC_TESTS` 已存在时改为 fail closed：返回 `blocked_forbidden_env_present`，不写 manual authorization 文件，避免把带付费/凭证环境的 shell 误生成后续可用授权 artifact。
   - `provider-smoke:readiness:bundle` 顶层 `ok` 语义收窄为 `ready_for_paid_armed_preflight && outputPathsValid`；`ready_for_manual_authorization` 继续独立保留，避免人工或自动化把“可生成/复核授权材料”误读为“可进入 armed/preflight”。
   - `pnpm provider-smoke:handoff:verify` / `provider-smoke:pressure-plan` 新增本地 redacted archive adapter：可选 `PROVIDER_SMOKE_HANDOFF_VERIFY_ROOT`、`PROVIDER_SMOKE_HANDOFF_VERIFY_FILE`、`PROVIDER_SMOKE_HANDOFF_VERIFY_MARKDOWN_FILE` 写出 JSON/Markdown 归档，normal form 为 `no_paid_handoff_pressure_plan_archive`。
   - handoff archive 仍以 stdout 为 canonical contract，文件仅作交接归档；归档输出不授权 provider call，不读取或打印 token，不包含原始 source URL，不覆盖 dry-run evidence、manual authorization、armed-run log 或 readiness bundle 输出，且必须位于 configured root 内。
   - 动态 local/cloud SOP、snapshot 文档、API route 文档和 dubbing guide 已同步 manual auth fail-closed、readiness `ok` 语义、handoff archive env vars、`archive_adapter_only` 和 `stdout 仍是 canonical contract`。
   - TEAM 两名只读代理均已完成并关闭；其中两项 P2 已处理：manual auth forbidden env fail-closed、readiness `ok` 语义收窄。剩余 P2 是 paid preflight receipt 与 armed-run 的机器绑定，未在本轮实现，作为下一轮 no-paid 小闭环。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax/GCS/Fish Audio，没有触发 TTS、声线克隆、付费验证、清理或删除。
   - `[已通过]` `pnpm test:unit tests/scripts/provider-smoke-manual-authorization.test.ts tests/scripts/provider-smoke-readiness-bundle.test.ts tests/scripts/provider-smoke-armed-run.test.ts tests/docs/dynamic-testing-safety-guard.test.ts tests/docs/mainline-positioning-guard.test.ts`（5 files / 60 tests）
   - `[已通过]` `pnpm test:stress`（5 files / 10 tests）
   - `[已通过]` `pnpm lint`（521 files）
   - `[已通过]` `pnpm test`（121 unit files / 824 tests；E2E 12 tests）
   - `[已通过]` `pnpm build`

147. `[已完成]` provider smoke paid preflight receipt / armed-run 同机绑定小闭环：
   - 按 `primitive-first-reduction` 将真实 provider smoke 最后一道付费前凭证收敛为：`preflight receipt = command_hash + command_binding + machine_binding + source/runtime/manual authorization/dry-run evidence/budget/log path binding`。
   - `pnpm provider-smoke:armed-run:preflight` 现在会写出 `provider_smoke_preflight_receipt`；输出位置由 `PROVIDER_SMOKE_PREFLIGHT_RECEIPT_ROOT` 与 `PROVIDER_SMOKE_PREFLIGHT_RECEIPT_FILE` 控制，receipt 只保存 redacted hash / source_ref / runtime / budget / safety 字段。
   - `provider-smoke:armed-run` 现在必须读取 `PROVIDER_SMOKE_PREFLIGHT_RECEIPT_FILE`，并在第一次 network request 前校验 receipt shape、freshness、`machine_binding`、`command_hash`、`command_binding` 自身 hash、manual authorization、dry-run evidence 和当前命令 scope。
   - 缺失 receipt、过期 receipt、跨机器复制、base URL/source/budget/runs/log path/manual authorization/dry-run evidence 改动，都会在 provider 请求前 fail closed，避免把旧 preflight 或外机 receipt 当作付费授权。
   - receipt 不包含原始 source URL、token、Bearer、完整 NDJSON、provider response body、原始机器名、用户名或 home 路径；机器身份只用 redacted hash 绑定。
   - 动态 local/cloud SOP、preflight handoff snapshot、API route 文档、dubbing guide 与文档安全守卫已同步 receipt normal form、env vars、fail-closed 语义和 no-secret 字段边界。
   - TEAM 两名只读监察员均已完成并关闭；其指出的 `writePreflightReceiptOutput`、armed-run 入口 `readPreflightReceipt`、receipt 自身 command hash 校验和 docs/guard 同步缺口已补齐。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax/GCS/Fish Audio，没有触发 TTS、声线克隆、付费验证、清理或删除。
   - `[已通过]` `pnpm test:unit tests/scripts/provider-smoke-armed-run.test.ts`（1 file / 34 tests）
   - `[已通过]` `pnpm test:unit tests/scripts/provider-smoke-armed-run.test.ts tests/scripts/provider-smoke-readiness-bundle.test.ts tests/docs/dynamic-testing-safety-guard.test.ts tests/docs/api-routes-safety-guard.test.ts`（4 files / 57 tests）
   - `[已通过]` `pnpm lint`（521 files）
   - `[已通过]` `pnpm test:stress`（5 files / 10 tests）
   - `[已通过]` `pnpm test`（121 unit files / 829 tests；E2E 12 tests）
   - `[已通过]` `pnpm build`

148. `[已完成]` provider smoke preflight receipt no-network verify / 状态复核小闭环：
   - 按 `primitive-first-reduction` 将 preflight 后、armed-run 前的人工交接面补成：`preflight receipt -> no-network receipt verification -> human review -> armed-run`。
   - 新增 `pnpm provider-smoke:receipt:verify`，复用 `scripts/provider-smoke-armed-run.mjs --verify-preflight-receipt`，输出 `provider_smoke_preflight_receipt_verification`、`status=verified_ready_to_arm | blocked`、`ready_to_arm`、`checks`、`safety` 和 `next_allowed_command`。
   - receipt verify 不读取 `TEST_API_TOKEN`，不连接 localhost / 目标 API / YouTube / Gemini / MiniMax，不创建 job，不写 receipt、manual authorization、dry-run evidence 或 armed NDJSON；只读当前 command object、manual authorization、dry-run evidence hash、`PROVIDER_SMOKE_PREFLIGHT_RECEIPT_FILE` 和当前 machine binding。
   - 成功状态要求 receipt 与当前 command hash、machine binding、manual authorization、dry-run evidence、budget、runs/concurrency 和 log path 一致；缺 receipt 或 command hash drift 会返回 blocked，并指向重新运行 `provider-smoke:armed-run:preflight`。
   - 动态 local/cloud SOP、provider smoke snapshot 文档、API route 文档、dubbing guide、package script surface 和 docs safety guard 已同步：receipt verify 是 no-paid/no-network 状态复核，不是 API status，不是付费授权，也不替代 armed-run 内部校验。
   - TEAM 三名只读代理均已完成并关闭；其建议的 no-network verify、文档同步、旧口径约束已处理。监察员提出的 P1/P2 风险已记录为下一轮候选：真实 provider 调用异常后的 durable attempt ledger / partial armed NDJSON，以及 API 直调绕过 CLI receipt 的边界说明或 lease 设计。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax/GCS/Fish Audio，没有触发 TTS、声线克隆、付费验证、清理或删除。
   - `[已通过]` `pnpm test:unit tests/scripts/provider-smoke-armed-run.test.ts tests/docs/dynamic-testing-safety-guard.test.ts tests/docs/api-routes-safety-guard.test.ts`（3 files / 48 tests）
   - `[已通过]` `pnpm lint`（521 files）
   - `[已通过]` `pnpm test:stress`（5 files / 10 tests）
   - `[已通过]` `pnpm test`（121 unit files / 832 tests；E2E 12 tests）
   - `[已通过]` `pnpm build`

149. `[已完成]` real provider smoke durable attempt / partial ledger 小闭环：
   - 按 `primitive-first-reduction` 将真实 provider smoke 的执行记录收敛为 `attempt -> provider result/error -> server audit + local armed NDJSON -> summary/fail-closed`；成功和异常都先归一为可审计记录。
   - `/api/ingest/dubbing-readiness` 的 live provider gate 现在捕获 provider 抛错，并转成 `status=failed` 的 `ProviderSmokeGateResult`，继续走 `buildProviderSmokeAudit -> saveProviderSmokeAuditLog -> 200 + ok=false`；错误正文、token、原始 source URL、provider raw response 不进入 response 或 audit。
   - `scripts/provider-smoke-armed-run.mjs` 将真实 run 收集改为 `Promise.allSettled`；任一 run 因 HTTP 非 2xx、provider 抛错、超时、JSON 损坏、runtime/source/manual authorization mismatch 等失败时，先写 `PROVIDER_SMOKE_ARMED_RUN_LOG` partial ledger，再 fail closed。
   - partial ledger 行使用 `partial_ledger_record=true`、`ok=false`、`verdict=failed`、`external_calls_executed=true` 与脱敏 `failure.type=real_provider_smoke_run_failed`；不计为成功 summary，不包含 `TEST_API_TOKEN`、原始 source URL、Bearer、完整 NDJSON 或 provider response body。
   - 动态 local/cloud SOP、API route 文档、dubbing guide、preflight/handoff snapshot 文档与 docs safety guard 已同步，修正“runtime mismatch 不写 armed NDJSON”的旧口径为“真实请求已开始则写 failed/partial attempt ledger，但不算成功”。
   - TEAM 三名只读代理均已完成；API route、armed-run 脚本、文档监察员指出的 P1 缺口已处理。剩余 P2：API 直调与 CLI receipt 的边界说明可继续单独收敛，但当前 route 已保留服务端 env/command binding/manual authorization/ledger gate。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax/GCS/Fish Audio，没有触发 TTS、声线克隆、付费验证、清理或删除。
   - `[已通过]` `pnpm test:unit tests/api/ingest-dubbing-readiness-smoke-route.test.ts tests/scripts/provider-smoke-armed-run.test.ts tests/docs/dynamic-testing-safety-guard.test.ts tests/docs/api-routes-safety-guard.test.ts`（4 files / 88 tests）
   - `[已通过]` `pnpm lint`（521 files）
   - `[已通过]` `pnpm test:stress`（5 files / 10 tests）
   - `[已通过]` `pnpm test`（121 unit files / 834 tests；E2E 12 tests）
   - `[已通过]` `pnpm build`

150. `[已完成]` real provider smoke execution-surface boundary / dry-run fallback hardening 小闭环：
   - 按 `primitive-first-reduction` 将真实 provider smoke 的执行面收敛为 `execution surface -> guard owner -> receipt owner -> audit owner`：
     - `real_provider_smoke` 是内部 API endpoint：`POST /api/ingest/dubbing-readiness` + `mode="real_provider_smoke"`。
     - operator 唯一付费执行入口仍是 `pnpm provider-smoke:armed-run`。
     - CLI receipt 只保护 operator 本机 command path；API route 不读取 receipt 文件、不校验 `PROVIDER_SMOKE_PREFLIGHT_RECEIPT_FILE`、不保存 receipt，也不接受 receipt request 字段。
     - API route 直调只依赖服务端 env gate、服务端 command binding、`manual_authorization`、source-bound dry-run evidence、ledger/concurrency/budget gates 和 job 权限。
   - API route 已加真实 provider gate hardening：`youtube_download`、`translation_provider`、`minimax_tts` 三个必需 gate 在真实 provider smoke 中必须是 `run_mode=real`；若 readiness 只剩 passthrough translation 或 placeholder TTS 这类 dry-run fallback，会返回 blocked audit，不再把 `dry_run_passed` 算作真实 provider smoke 成功。
   - 动态 local/cloud SOP、API route 文档、dubbing guide、video-processing 文档和 preflight/handoff snapshot 文档已把摘要表改为“内部 API endpoint + CLI 执行入口”，并明确“确认 ID 不是执行授权”。
   - docs safety guard 已加固：不只拦 `curl`，也拦 fenced docs 中的 fetch / PowerShell / 裸 JSON command object 直调 `real_provider_smoke` 示例；真实 provider smoke 文档只能保留 CLI armed-run SOP。
   - TEAM 三名只读代理均已完成并关闭；其指出的 API/CLI receipt 边界、docs guard 漏洞和 dry-run fallback P1 已处理。
   - 监察员剩余 P2 已留作下一轮：`provider-smoke:armed-run` 当前把 `max_concurrency` 当作总 runs 上限并用 `Promise.allSettled` 同时发起所有 run；server active lease 仍是进程内 map，跨重启/多实例不持久。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax/GCS/Fish Audio，没有触发 TTS、声线克隆、付费验证、清理或删除。
   - `[已通过]` `pnpm test:unit tests/api/ingest-dubbing-readiness-smoke-route.test.ts tests/docs/dynamic-testing-safety-guard.test.ts tests/docs/api-routes-safety-guard.test.ts`（3 files / 51 tests）
   - `[已通过]` `pnpm lint`（521 files）
   - `[已通过]` `pnpm test:stress`（5 files / 10 tests）
   - `[已通过]` `pnpm test`（121 unit files / 835 tests；E2E 12 tests）
   - `[已通过]` `pnpm build`

151. `[已完成]` real provider smoke armed-run 本地并发调度 normal form 小闭环：
   - 按 `primitive-first-reduction` 将压测 scope 收敛为：`runs = 本次总尝试次数`、`max_runs = 总次数硬上限`、`max_concurrency = 同时在飞请求上限`、`budget = 总费用上限`、`ledger = 每个已启动 run 的 durable attempt record`。
   - `scripts/provider-smoke-armed-run.mjs` 已移除把 `runs > max_concurrency` 视为非法的旧口径；`assertBudgetScope`、preflight、receipt verify、readiness bundle 和 summary 均改为 `runs <= max_runs` + `effective_concurrency <= max_concurrency` + `estimated_total_cost_usd <= max_budget_usd`。
   - armed-run 执行从一次性启动全部 `runs` 改为 `runAllSettledWithConcurrencyLimit`：保留 all-settled-like 结果收集和 partial ledger 语义，但同时在飞 provider POST 不超过 `max_concurrency`；`runs > max_concurrency` 时按批次执行。
   - API route 的 armed policy 同步修正：服务端不再把 `runs > max_concurrency` 当作 policy limit；真实并发仍由进程内 active slot gate 拦截，超过 `max_concurrency` 的直调并发继续返回 429。
   - provider smoke command scope 的金额字段新增 6 位小数 normal form，避免 `3 * 0.10` 这类 JS 浮点数与 manual authorization 严格比对误判。
   - 动态 local/cloud SOP、API route 文档、dubbing guide、preflight snapshot 和 docs guard 已同步：`max_concurrency` 只表示同时在飞请求上限；文档禁止回退到 `runs <= max_concurrency`。
   - TEAM 三名只读代理均已完成并关闭；其指出的 armed-run 一次性全启动、route policy 误判和 docs guard 固化旧口径均已处理。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax/GCS/Fish Audio，没有触发 TTS、声线克隆、付费验证、清理或删除。
   - `[已通过]` `pnpm test:unit tests/scripts/provider-smoke-armed-run.test.ts tests/api/ingest-dubbing-readiness-smoke-route.test.ts tests/docs/dynamic-testing-safety-guard.test.ts tests/docs/api-routes-safety-guard.test.ts`（4 files / 92 tests）
   - `[已通过]` `pnpm lint`（521 files）
   - `[已通过]` `pnpm test:stress`（5 files / 10 tests）
   - `[已通过]` `pnpm test`（121 unit files / 838 tests；E2E 12 tests）
   - `[已通过]` `pnpm build`

152. `[已完成]` real provider smoke 服务端 DB-backed attempt reservation / durable lease 小闭环：
   - 按 `primitive-first-reduction` 将服务端真实 provider smoke 的并发/次数安全收敛为：`latest ready dry-run epoch -> DB-backed attempt reservation -> provider call -> audit + reservation finalize -> local armed NDJSON ledger`。
   - `/api/ingest/dubbing-readiness` 已移除进程内 active map gate；真实 provider call 前会通过 `reserveRealProviderSmokeAttempt()` 在 SQLite `job_logs` 内原子写入 `details.provider_smoke_attempt_reservation`。
   - `provider_smoke_attempt_reservation` normal form 包含 `reservation_id`、`status=started|completed|failed`、`reserved_at`、`expires_at`、`source_ref`、`runtime_fingerprint` 和 budget/concurrency policy；`reservation_id` 作为 lease token / fencing token。
   - active 并发只统计 `status=started && expires_at > now`；过期 reservation 不占 active slot，但仍计入 started run/budget，避免进程崩溃或多实例切换后重复花费。
   - 真实 provider smoke audit 现在可携带 `attempt_reservation_id`，用于把 audit 和 reservation 绑定到同一次 attempt，并兼容旧 real audit：旧 audit 计入 legacy attempt，新 reservation 不与新 audit 重复计数。
   - route 仍保留原有响应语义：concurrency 超限返回 429，ledger/budget 超限返回 400；provider gate 失败或异常仍返回 200 + `ok=false` 并写 audit，且 finalize reservation 为 `failed`。
   - 动态 local/cloud SOP、API route 文档、dubbing guide、preflight snapshot、database 文档和 docs safety guard 已同步：真实 provider call 前必须有 DB-backed attempt reservation，不得退回 file-only 或 memory-only concurrency。
   - TEAM 三名只读代理均已完成；其指出的 DB/route/docs P0/P1 风险已处理。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax/GCS/Fish Audio，没有触发 TTS、声线克隆、付费验证、清理或删除。
   - `[已通过]` `pnpm test:unit tests/docs/dynamic-testing-safety-guard.test.ts tests/docs/api-routes-safety-guard.test.ts tests/jobs/provider-smoke-audit.test.ts tests/api/ingest-dubbing-readiness-smoke-route.test.ts`（4 files / 66 tests）

153. `[已完成]` real provider smoke reservation source-bound epoch 原子绑定小闭环：
   - 按 `primitive-first-reduction` 将 provider call 前最后一道服务端安全边界收敛为：`source-bound ready dry-run epoch -> atomic DB attempt reservation -> provider call -> reservation finalize + audit`。
   - `reserveRealProviderSmokeAttempt()` 应在同一个 SQLite transaction 内重新确认 latest ready dry-run 仍匹配 `runtime_fingerprint`、`source_ref` 和 freshness；若 dry-run epoch 被更新、变成 blocked、source mismatch 或 stale，必须在 provider call 前 fail closed。
   - 同毫秒边界应保守计数：`reserved_at >= dry_run_checked_at` 计入 reservation ledger，避免预算/并发账本漏算。
   - API route 文档应清楚拆分 CLI receipt 要求和 API route/server-side gate 要求：API route 不读取 receipt 文件，CLI armed-run 才校验 receipt。
   - 本轮不得执行真实 provider smoke，不得调用 YouTube/Gemini/MiniMax/GCS/Fish Audio，不得触发 TTS、声线克隆、付费验证、清理或删除。
   - TEAM 两名只读代理均已完成并关闭；监察员指出的 P1 source-blind reservation、P2 同毫秒漏计和 receipt 文档边界已处理。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax/GCS/Fish Audio，没有触发 TTS、声线克隆、付费验证、清理或删除。
   - `[已通过]` `pnpm test:unit tests/jobs/provider-smoke-audit.test.ts tests/api/ingest-dubbing-readiness-smoke-route.test.ts tests/docs/api-routes-safety-guard.test.ts tests/docs/dynamic-testing-safety-guard.test.ts`（4 files / 69 tests）
   - `[已通过]` `pnpm lint`（521 files）
   - `[已通过]` `pnpm test:stress`（5 files / 10 tests）
   - `[已通过]` `pnpm test`（121 unit files / 845 tests；E2E 12 tests）
   - `[已通过]` `pnpm build`

154. `[已完成]` provider smoke evidence probe source-bound operator signal 小闭环：
   - 按 `primitive-first-reduction` 将真实 provider smoke 前的只读证据 probe 收敛为：`job_id + expected source URL + max age -> latest ProviderSmokeAudit source_ref/freshness verdict`。
   - `pnpm provider-smoke:evidence:check` 已支持 `--source-url`，只输出 `expected_source_ref.host + url_sha256`，不打印原始 source URL；当 `--require-ready-dry-run` 与 `--source-url` 同时使用时，latest dry-run evidence 必须 fresh、ready、no-call、no-cost、no-artifact，且 `source_ref` 与 expected source fingerprint 匹配。
   - latest audit 缺 `source_ref`、source mismatch、invalid source URL 或 stale 时，probe 会 fail closed；该失败只阻止 operator 继续准备真实 provider smoke，不触发 API、provider、TTS、声线克隆或付费验证。
   - 动态 local/cloud SOP、API route 文档和 dubbing guide 已在 manual authorization 前明确运行 source-bound evidence check，避免旧的无来源 ready dry-run 被人工误读为可压测材料。
   - TEAM 两名只读代理均已完成并关闭；监察员指出的 P2 operator probe 误读风险已处理。剩余建议是后续可再加 `readiness:bundle` / `handoff:verify` 对 stale / missing-source evidence 的显示型测试，不影响当前 provider call 前硬挡板。
   - 本轮不得执行真实 provider smoke，不得调用 YouTube/Gemini/MiniMax/GCS/Fish Audio，不得触发 TTS、声线克隆、付费验证、清理或删除。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax/GCS/Fish Audio，没有触发 TTS、声线克隆、付费验证、清理或删除。
   - `[已通过]` `pnpm test:unit tests/scripts/check-provider-smoke-audit.test.ts tests/docs/dynamic-testing-safety-guard.test.ts tests/docs/api-routes-safety-guard.test.ts tests/docs/mainline-positioning-guard.test.ts`（4 files / 27 tests）
   - `[已通过]` `pnpm lint`（521 files）
   - `[已通过]` `pnpm test:stress`（5 files / 10 tests）
   - `[已通过]` `pnpm test`（121 unit files / 849 tests；E2E 12 tests）
   - `[已通过]` `pnpm build`

155. `[已完成]` provider smoke readiness / handoff bad-evidence Markdown display guard 小闭环：
   - 按 `primitive-first-reduction` 将真实 provider smoke 前的人工查看面收敛为：`source-bound local dry-run evidence -> readiness bundle -> no-paid handoff verifier -> human review`。
   - `readiness:bundle` 已把 dry-run evidence 的 `record_count`、`blocked_count_total`、`latest_checked_at`、`ready`、`error` 写入 Markdown 归档；缺 `source_ref`、source mismatch 或 stale evidence 时，Markdown 与 JSON 都显示 `status=blocked`、`ready_for_paid_armed_preflight=false`、`ready_to_arm=false`、`ready=false` 和具体 error。
   - `handoff:verify` 的 Markdown 归档已补显示型测试，确认 bad evidence 不会被人工归档误读成可确认材料，且下一步仍指回 `pnpm provider-smoke:readiness:bundle`。
   - `validateDryRunEvidence()` 对缺 `source_ref` 增加明确 fail-closed 错误：`dry-run evidence source_ref is required and must match real provider smoke source`。
   - TEAM 两名只读代理均已完成并关闭；P0/P1 无新增阻断，监察员指出的 P2 Markdown archive blocked 形态已处理。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax/GCS/Fish Audio，没有触发 TTS、声线克隆、付费验证、清理或删除。
   - `[已通过]` `pnpm test:unit tests/scripts/provider-smoke-readiness-bundle.test.ts tests/scripts/provider-smoke-armed-run.test.ts`（2 files / 60 tests）
   - `[已通过]` `pnpm lint`（521 files）
   - `[已通过]` `pnpm test:stress`（5 files / 10 tests）
   - `[已通过]` `pnpm test`（121 unit files / 857 tests；E2E 12 tests）
   - `[已通过]` `pnpm build`

156. `[已完成]` provider smoke pressure-plan manual confirmation / output safety 小闭环：
   - 按 `primitive-first-reduction` 将已保存 MiniMax credential 后、真实 provider smoke 前的 operator 材料收敛为：`ready no-paid materials -> manual_confirmation_inputs -> human review -> paid/stress gates remain unset -> preflight only after explicit confirmation`。
   - `provider-smoke:pressure-plan` 现在显式调用 `--handoff-verify --pressure-plan`，并在 handoff JSON / Markdown 输出 `alias_boundary.no_paid_alias=true`、`invoked_as`、`operator_warning`；`ok=true` 只表示可交给人工确认，不授权 provider call，也不得直接运行 armed-run。
   - `manual_confirmation_inputs.source_reference` 已补 `raw_source_url_must_be_checked_outside_report=true` 和核对说明：原始 `REAL_PROVIDER_SMOKE_SOURCE_URL` 必须由 operator 在本机 shell / 安全记录中核对，报告只记录 host / `url_sha256`。
   - `manual-auth:prepare` 写入前已增加输出路径保护：授权 JSON 不得覆盖 dry-run evidence、preflight receipt、readiness/handoff archive 或 armed-run log；输出文件使用 atomic write，路径不安全时 fail closed 且不写文件。
   - `provider-smoke:receipt:verify` 已补 `receipt_authorization_boundary`，明确 receipt 只保护 operator 本机 CLI command path；API route 不读取、不保存、也不接受 receipt request 字段，且 `provider_calls_authorized=false` 直到 operator 显式执行 armed-run。
   - 动态 local/cloud SOP、provider smoke snapshot 文档、dubbing guide、package script surface 和 docs safety guard 已同步 pressure-plan alias、raw URL 人工核对、receipt/API 边界和 manual auth 文件保护。
   - TEAM 两名只读代理均已完成并关闭；Zeno 指出的 pressure-plan alias / raw URL P2 已处理，Galileo 指出的 API receipt SOP 歧义按现有设计收敛为机器可测边界，manual-auth 文件覆盖 P2 已处理；未引入新大模块。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax/GCS/Fish Audio，没有触发 TTS、声线克隆、付费验证、清理或删除。
   - `[已通过]` `pnpm test:unit tests/scripts/provider-smoke-armed-run.test.ts tests/docs/dynamic-testing-safety-guard.test.ts tests/docs/api-routes-safety-guard.test.ts`（3 files / 57 tests）
   - `[已通过]` `pnpm lint`（521 files）
   - `[已通过]` `pnpm test:stress`（5 files / 10 tests）
   - `[已通过]` `pnpm test`（121 unit files / 859 tests；E2E 12 tests）
   - `[已通过]` `pnpm build`

157. `[已完成]` provider smoke server-side permit / required real gates SOP 文档小闭环：
   - 按 `primitive-first-reduction` 将真实 provider smoke 前置条件收敛为：`source-bound dry-run evidence -> required_real_provider_gates all real -> CLI receipt handoff -> armed-run server-side real_provider_smoke_preflight -> provider_smoke_run_permit -> real_provider_smoke`。
   - no-paid dry-run evidence 必须证明 `required_real_provider_gates.youtube_download`、`translation_provider`、`minimax_tts` 全部 `run_mode=real`；这不代表 dry-run 触发 provider，只证明真实 provider 能力已配置。任一 gate 缺失、fallback、placeholder、blocked 或 `run_mode=dry_run` 时，readiness/handoff/preflight/API route 都必须 fail closed。
   - `real_provider_smoke` 前必须先调用 `real_provider_smoke_preflight`，由服务端签发同 scope 的 `provider_smoke_run_permit`；permit 响应只暴露 `{ permit_id, command_hash }` 等 redacted reference，服务端保存的 `auth_principal + command_binding` 绑定 job/source/runtime/manual authorization/budget/runs/concurrency/required gates/command hash。缺失、过期、hash mismatch 或 scope mismatch 时必须在 provider call 前 fail closed。
   - CLI 本地 `provider_smoke_preflight_receipt` 仍保留为 operator handoff 和本机 command path 保护；API route 不读取、不保存、不接受 receipt，也不再被描述成只靠本地 receipt。API route 的服务端边界是 `provider_smoke_run_permit`、source-bound dry-run evidence、DB-backed attempt reservation、ledger/concurrency/budget gates 和 job 权限。
   - 动态 local/cloud SOP、API route 文档、dubbing guide 和 provider smoke snapshot 文档已同步该正常形。
   - API route 已把 `real_provider_smoke_preflight` 纳入同一套 armed policy、command binding、dry-run evidence 和 manual authorization 检查；preflight 只签发 server-side permit，不调用 provider、不 reservation。
   - `provider-smoke:manual-auth:prepare` 读取的本地 dry-run evidence 也必须包含 `required_real_provider_gates`，并且 `failed=0`、`blocked=0`、`requires_confirmation=0`，避免本地 handoff 把弱 evidence 误判为可人工确认。
   - MiniMax 本地加密保存脚本只写 `verification_voice_id`；`voice_id` 继续作为 runtime legacy alias 读取，但不再由保存脚本写入，避免把“凭证验证声线”误当正式配音默认声线。
   - 本轮没有执行真实 provider smoke，没有调用 YouTube/Gemini/MiniMax/GCS/Fish Audio，没有触发 TTS、声线克隆、付费验证、清理或删除。
   - `[已通过]` `pnpm test:unit tests/scripts/provider-smoke-manual-authorization.test.ts tests/scripts/save-minimax-credential.test.ts tests/scripts/provider-smoke-dry-run-rehearsal.test.ts tests/scripts/provider-smoke-readiness-bundle.test.ts tests/scripts/provider-smoke-armed-run.test.ts tests/scripts/check-provider-smoke-audit.test.ts tests/api/ingest-dubbing-readiness-smoke-route.test.ts`（7 files / 140 tests）
   - `[已通过]` `pnpm lint`（521 files）
   - `[已通过]` `pnpm test`（121 unit files / 864 tests；E2E 12 tests）
   - `[已通过]` `pnpm build`

158. `[已完成]` 旧剪辑 step-definitions 布尔触发收敛小闭环：
   - 按 `primitive-first-reduction` 将步骤展示 normal form 收敛为：当前主线只由显式 `workflowId/jobType` 选择 `content_ingest` 或 `translation_dubbing`；旧剪辑历史展示只由显式 `legacy_editing`、`single_video` 或 `multi_video` 触发。
   - `isSingleVideo/isMultiVideo` 不再单独激活旧剪辑阶段，避免被视频数量或残留 step context 误读成旧剪辑可执行/可创建路径。
   - 历史 `single_video/multi_video` 报告仍可读取旧步骤，`multi_video` 仍保留 `group_by_source` 展示兼容。
   - `[已通过]` `pnpm test:unit tests/workflow/step-definitions.test.ts tests/workflow/workflows.test.ts tests/components/report-basic-summary-sections.test.tsx`（3 files / 17 tests）

159. `[已完成]` 旧剪辑 workbench 重跑入口和 provider-smoke 文档监察小闭环：
   - Workbench 的只读 `isDubbingJob` 兼容判断继续保留用于历史/稀疏任务展示；但会创建新 `/dubbing` 任务的「同设定重跑」「跑全片」「做另一语言版」入口，只允许真实 `job_type === translation_dubbing`。
   - 历史 `single_video/multi_video` 即使残留 `voice_id`、`translation_style` 或 `sample_mode`，也只显示历史交付资料，不生成 dubbing rerun href，不主动读取配音口播稿 artifact。
   - 动态测试 local/cloud SOP 已把 readiness bundle token 边界改为“只读取 `TEST_API_TOKEN` 是否存在，不读取或打印 token 值”；`dubbing-guide` 与 API routes 文档的 `provider-smoke:evidence:check` 示例已显式绑定 `--job "${DRY_RUN_PROVIDER_SMOKE_AUDIT_JOB_ID}"`。
   - `[已通过]` `pnpm test:unit tests/components/workbench-client.test.tsx tests/workflow/step-definitions.test.ts`（2 files / 21 tests）
   - `[已通过]` `pnpm test:unit tests/docs/dynamic-testing-safety-guard.test.ts tests/docs/api-routes-safety-guard.test.ts tests/docs/mainline-positioning-guard.test.ts tests/components/workbench-client.test.tsx tests/workflow/step-definitions.test.ts`（5 files / 42 tests）
   - `[已通过]` `pnpm lint`（522 files）
   - `[已通过]` `pnpm test`（122 unit files / 868 tests；E2E 12 tests）
   - `[已通过]` `pnpm build`

下一步建议：

1. 进入真实 provider smoke 压力测试前，先明确测试视频 URL、总 runs、并发上限、预算上限、声线使用边界和人工确认人。
2. 真实 provider smoke 只能在人工确认后设置 `ALLOW_PAID_DYNAMIC_TESTS=true` 与 `ALLOW_STRESS_DYNAMIC_TESTS=true`，并继续使用 job-bound dry-run evidence、`required_real_provider_gates` 全 real、manual authorization、server-side run permit、preflight receipt、receipt verify 和 DB-backed attempt reservation 作为前置条件。
