# Changelog

本文档记录项目所有重要变更历史。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [语义化版本 2.0.0](https://semver.org/lang/zh-CN/)。

## [Unreleased] - 当前主线

### Changed
- 产品主线已收敛为 `/ingest -> /dubbing -> /jobs -> QA -> sample-to-full -> compare/report -> long-term assets`。
- 当前主线以 `content_ingest`、`translation_dubbing`、`WorkflowArtifactManifest`、MiniMax 声线与声线使用确认作为正常形。
- 旧 AI 剪辑、风格库、分镜复刻、Fish Audio/Edge TTS 主动入口只作为历史兼容或负向验证保留，不再作为成功路径。

> 以下已发布版本记录包含旧剪辑时代的历史设计和迁移背景；阅读时以当前主线文档和 `docs/agent/legacy-editing-removal-plan.md` 为准。

## [16.0.0] - 2025-12-13

### 版本号重大调整

从 12.2.0 直接升级到 16.0.0，标志项目第 16 次重大架构优化。

### 架构优化

#### 隐式缓存模式
- **移除显式 Context Cache**：不再手动创建/管理 Context Cache
- **多轮对话架构**：使用 `[user(视频+分析), model(分析结果), user(旁白请求)]` 格式
- **成本节省**：实测缓存命中率 ~74%（相比 v11.2.0 声称的 ~92%，基于实际生产数据）
- **简化维护**：无需处理缓存过期、清理等复杂逻辑

#### 废弃步骤清理
- **删除 `prepare-video.ts`**：废弃的视频准备步骤（200 行）
- **删除 `upload-gemini.ts`**：废弃的 Gemini 上传步骤（122 行）
- **删除 `state-machine.ts`**：废弃的状态机模块
- **简化 `step-registry.ts`**：移除未使用的 `getAllSteps`/`getAllStages` 函数

#### 代码质量改进
- **Gemini API Rate Limiter**：新增 API 速率限制器
- **存储清理优化**：新增 `getLogsToClean` 函数，预览只显示即将清理的日志
- **数据库连接优化**：改进场景查询性能
- **BGM 混音优化**：优化背景音乐混音处理逻辑

### Removed
- `lib/workflow/steps/analysis/prepare-video.ts`
- `lib/workflow/steps/analysis/upload-gemini.ts`
- `lib/workflow/steps/analysis/create-video-cache.ts`（随隐式缓存模式废弃）
- `lib/workflow/state-machine.ts`
- `step-registry.ts` 中的 `getAllSteps()`、`getAllStages()` 函数

### Changed
- 工作流引擎优化
- 任务 API 路由优化
- Fish Audio 客户端代码优化
- 错误处理改进（保留原始错误信息）

### Docs
- 更新故障排查文档
- 更新视频处理链路文档
- 更新工具函数文档

---

## [12.2.0] - 2025-12-11

### 跳切检测与自动修剪

#### 问题背景
AI 生成的时间戳可能落在转场过程中，导致拆条后的分镜开头/结尾存在跳切帧（约 0.6-0.7 秒），影响最终成片质量。

#### 解决方案
在分镜处理流程中新增跳切修剪步骤：
- 使用 FFmpeg `scdet` 滤镜检测场景切换点
- 自动裁剪开头/结尾的跳切帧
- 基于修剪后的视频时长计算音画同步参数

### Added
- `lib/media/operations/trim-jumpcuts.ts`：跳切检测与修剪核心模块
  - `detectSceneChanges()`：场景切换点检测
  - `analyzeTrimPoints()`：裁剪点分析
  - `trimJumpCuts()`：主入口函数
- `TempFileManager.getTrimmedPath()`：修剪后视频路径
- 数据库新增字段：`trimmed_video_url`、`trimmed_start`、`trimmed_end`、`trimmed_duration`
- `jobScenesDb.updateTrimResult()`：跳切修剪结果存储

### Changed
- **配音分镜处理** (`dubbed-audio-handler.ts`)：
  - 流程调整：TTS → 跳切修剪 → 音频选择 → 调速 → 合成 → 字幕
  - 音频选择基于修剪后的视频时长计算 speedFactor
- **原声分镜处理** (`original-audio-handler.ts`)：
  - 流程调整：跳切修剪 → 重编码
- **风格系统** (`styles/style-1015.yaml`)：
  - 时间戳安全边距改为「画面稳定帧原则」

### Technical
- scdet 阈值：8%（默认）
- 扫描范围：开头/结尾各 1.0 秒
- 最小保留时长：2.0 秒
- 新增 `trim_jumpcuts` 子步骤日志

---

## [12.1.0] - 2025-12-02

### 架构重大变更

#### 本地 FFmpeg 替代 NCA Toolkit
- **性能提升 3x**：消除网络延迟和轮询开销
- **零 API 费用**：所有视频处理本地完成
- **FFmpeg 8.0.1**：最新稳定版静态二进制

### Added
- `lib/media/`：新增本地媒体处理模块
  - `ffmpeg-service.ts`：FFmpeg 服务封装
  - `operations/`：拆条、调速、合成、拼接、元数据
  - `utils/temp-manager.ts`：临时文件管理
- Dockerfile：集成 FFmpeg 8.0.1 静态二进制

### Changed
- **工作流步骤**：所有 NCA 调用替换为本地 FFmpeg
  - `nca-batch-split.ts` → 本地拆条
  - `dubbed-audio-handler.ts` → 本地调速+合成
  - `original-audio-handler.ts` → 本地重编码
  - `concatenate-scenes.ts` → 本地拼接
- **Fish Audio**：音频保存到本地临时目录（`/tmp/fish-audio/`）
- **Services 接口**：`services.nca` → `services.ffmpeg`

### Removed
- `lib/ai/nca/`：整个 NCA Toolkit 客户端目录
- NCA 相关环境变量配置（`NCA_*`）
- 设置页面 NCA 配置部分

### Technical
- 统一音频参数：44100Hz、双声道、AAC 128kbps
- 视频编码：libx264、medium preset、CRF 23
- 支持远程 URL 直接处理（http/https/gs://）

---

## [12.0.0] - 2025-12-02

### 架构重大变更

#### 依赖版本全面升级
- **所有依赖升级**：运行 `pnpm update` 将所有依赖升级到最新兼容版本
- **版本号体系**：项目版本号从 11.x 升级到 12.x，标志第 12 次重大架构变更

### Changed
- 所有 npm 依赖升级到最新兼容版本

---

## [11.2.0] - 2025-12-02

### 架构重大变更

#### Context Cache 批量旁白生成
- **新增旁白生成阶段**：工作流从 4 阶段扩展为 5 阶段
- **工作流顺序**：分析 → 旁白生成 → 分镜提取 → 音画同步 → 合成
- **成本优化**：使用 Gemini Context Cache 批量生成旁白，降低 ~92% Token 成本
- **配置项**：新增「旁白批量生成数量」配置（1-40 个/批，默认 10）

### Added
- `lib/workflow/steps/analysis/create-video-cache.ts`：创建 Context Cache 步骤
- `lib/workflow/steps/narration/batch-generate-narrations.ts`：批量旁白生成步骤
- `styles/_templates/batch_audio_sync_params.yaml`：批量旁白提示词模板
- `lib/ai/gemini/index.ts`：新增 `batchOptimizeNarration` 方法
- `lib/workflow/style-loader.ts`：新增 `buildBatchAudioSyncPrompt` 方法
- `lib/db/managers/state-manager.ts`：新增 `updateCacheInfo`/`getCacheInfo`/`clearCacheInfo`
- `lib/db/tables/job-scenes.ts`：新增 `updateNarrations`/`getNarrations` 方法
- 系统配置 UI：新增旁白批量生成数量下拉选单

### Changed
- **工作流定义重构**：5 阶段架构（`generate_narrations` 为新增阶段）
- **类型定义更新**：`JobStep` 新增 `generate_narrations`
- **dubbed-audio-handler.ts**：移除旁白生成逻辑，改为读取预生成旁白
- **engine.ts**：任务完成后自动清理 Context Cache

### Removed
- `GeminiClient.optimizeNarration`：单分镜旁白生成方法（已被批量方法替代）
- `GeminiNarrationOptions`/`GeminiNarrationResult`：相关类型定义

### Database
- `job_current_state`：新增 `video_cache_name`、`video_cache_expires_at`、`video_cache_token_count` 字段
- `job_scenes`：新增 `narration_v1`、`narration_v2`、`narration_v3` 字段
- `configs`：新增 `narration_batch_size` 配置项

---

## [11.1.0] - 2025-11-27

### Added
- 成本追踪功能：支持查看任务的 API 调用成本明细

### Changed
- 重构统一认证与限流系统
- 优化配置管理与 Gemini 凭据提供器
- TypeScript 类型安全审核，消除 any 类型
- 类型系统重构与代码质量改进

### Fixed
- 导出报告优化（6 项问题修复）
- 重构 API 密钥验证，解决 Server Component 自调用问题
- 修正默认 Gemini 模型配置

### Security
- 将授权码示例格式从 CCUT-X 改为 XXXX-X 以提高安全性

### Docs
- 添加 Zeabur CLI 部署指南
- 修复文档与代码的一致性问题（30+ 项）
- 添加 Docker 多平台构建注意事项

---

## [11.0.1] - 2025-01-23

### Fixed
- 修复任务列表页面连续删除失效问题（删除第一个任务后无法删除下一个）
- 优化状态管理：统一使用 Zustand Store 作为数据源
- 使用 `useTransition` 替代手动延迟，提升删除操作稳定性
- 移除不必要的 `router.refresh()` 调用，避免状态不同步

---

## [11.0.0] - 2025-01-20

### 架构重大变更

#### 前端架构
- 完全禁用 Server Actions，统一采用 API Routes 架构
- 使用原生 `fetch` + `router.refresh()` 进行数据获取
- 使用 React 19 的 `useTransition` 替代自定义 loading 状态管理

#### 鉴权系统
- 新增单用户鉴权系统（users 表、api_access_tokens 表）
- 支持 bcryptjs 密码加密（12 轮）
- 支持 API Token 管理（格式：`cca_<32字符>`）
- 新增分布式锁机制（distributed_locks 表）

#### 数据库优化
- 启用 WAL 模式（30-50% 并发性能提升）
- 简化任务状态机（4 个核心状态：pending, processing, completed, failed）
- 删除 `paused`、`cancelled`、`stopped` 状态（现仅保留 pending / processing / completed / failed）

### Added
- 新增 `/api/auth/login`、`/api/auth/logout` 等 7 个鉴权 API
- 新增 `lib/middleware/auth-check.ts` 鉴权中间件
- 新增 `lib/utils/distributed-lock.ts` 分布式锁工具
- 新增 `scripts/migrations/009_add_auth_system.sql` 迁移脚本
- 新增 `scripts/migrations/012_add_distributed_locks.js` 迁移脚本

### Changed
- 重构 `lib/services/job-control-service.ts`（v11.1.0 异步启动，v12.1.0 已删除）
- 重构 `lib/hooks/use-job-control.ts`（使用 useTransition，v12.1.0 已删除）

### Security
- 所有敏感操作添加分布式锁保护
- API Token 使用 SHA-256 哈希存储

---

## [10.0.0] - 2025-01-18

### 架构重大变更

#### 数据库 Schema
- 简化任务状态机（从 9 个状态减少到 5 个）
- 状态流转：`pending` → `processing` → `completed` / `failed`
- 注：任务控制（停止/重启）已下线，不再支持中断后恢复

### Changed
- 更新 `lib/db/schema.sql`（v10.0.0 标记）
- 更新所有状态判断逻辑
- 迁移脚本：`scripts/migrations/010_simplify_job_status.sql`

---

## [9.3.0] - 2025-01-15

### Changed
- 废弃 `scenes` 表，统一使用 `job_scenes` 表
- 优化分镜数据查询性能

---

## [9.0.0] - 2025-01-10

### 架构重大变更

#### 错误处理增强
- 新增 `error_metadata` 字段（JSON 格式）
- 支持记录错误堆栈、上下文信息
- 改进错误追踪和调试能力

### Added
- `lib/db/tables/job-step-history.ts` 新增 `error_metadata` 字段
- `scripts/migrations/007_add_error_metadata.sql` 迁移脚本

### Changed
- 重构错误处理逻辑（统一错误格式）

---

## [6.0.0] - 2024-12-20

### 架构重大变更

#### 步骤历史表字段语义重构
- `started_at`、`completed_at` 字段语义优化
- 改进时间戳记录逻辑

### Changed
- 更新 `job_step_history` 表结构

---

## [5.0.0] - 2024-12-15

### 架构重大变更

#### 工作流引擎安全加固
- 使用 `expr-eval` 替代 `new Function()`（移除动态代码执行）
- 加强表达式求值安全性

### Security
- 移除 `new Function()` 动态执行风险
- 使用白名单机制限制表达式求值

---

## [4.0.0] - 2024-12-10

### 架构重大变更

#### 日志系统重构
- 日志从文件存储迁移到数据库存储
- 新增 `job_logs` 表（7 种日志类型）
- 支持按步骤自动分组

#### 工作流引擎日志优化
- 修复日志输入数据源问题
- 统一日志记录格式

### Added
- `lib/utils/logger.ts`（数据库日志系统）
- `job_logs` 表（`step_input`, `step_output`, `api_call`, `api_response`, `error`, `warning`, `info`）

### Removed
- 文件日志系统（logs/ 目录）

---

## [3.0.0] - 2024-12-05

### 架构重大变更

#### 工作流引擎日志系统重构
- 统一步骤标识（majorStep + subStep）
- 改进日志分组和查询性能

### Changed
- 重构 `lib/workflow/engine.ts`（日志系统统一）

---

## [2.0.0] - 2024-11-25

### 架构重大变更

#### 工作流引擎架构优化
- 状态管理模块化拆分（5 个子模块）
- 改进代码可维护性

### Changed
- 拆分 `lib/workflow/state/` 目录：
  - `context-manager.ts`
  - `data-persistence.ts`
  - `lifecycle-manager.ts`
  - `step-manager.ts`
  - `index.ts`

---

## [1.0.0] - 2024-11-20

### 架构重大变更

#### 工作流引擎极简架构重构
- 从 1992 行重构为 214 行（89% 代码减少）
- 分离步骤定义和执行逻辑
- 引入状态管理层

#### 风格系统统一架构
- 双层提示词架构：创意层 + 参数层
- 统一模板引擎（Mustache 风格占位符）
- 类型安全的风格定义

#### 系统密钥管理
- 自动生成和持久化 `ENCRYPTION_KEY` 和 `SESSION_SECRET`
- 策略：环境变量 > 数据库 configs 表 > 自动生成

### Added
- `lib/workflow/step-definitions.ts`（步骤定义）
- `lib/workflow/state/`（状态管理模块）
- `lib/utils/template-engine.ts`（统一模板引擎）
- `lib/db/core/system-keys.ts`（系统密钥管理）
- `lib/db/core/configs.ts`（配置持久化）
- `styles/_templates/`（系统模板目录）
- `docs/user-guides/风格模板开发指南.md`

### Changed
- 重构 `lib/workflow/engine.ts`（从 1992 行到 214 行）
- 重构 `lib/workflow/style-loader.ts`（双层提示词架构）

---

## [0.9.0] - 2024-11-10

### 架构重大变更

#### 数据流架构优化
- 引入三层数据流设计
- 新增 `RuntimeDataLoader`（运行时数据加载器）
- 新增 `CheckpointAdapter`（工作流引擎内部使用）
- 支持 NCA Job 追踪信息

### Added
- `lib/db/managers/runtime-data-loader.ts`
- `lib/db/managers/state-manager.ts`
- `lib/db/checkpoint-adapter.ts`（废弃提示：v1.0.0 移除）

### Changed
- API 返回格式新增 `job.state` 和 `job.stepHistory` 字段
- 前端优先使用结构化字段，回退到 `checkpoint_data`（向后兼容）

---

## [0.8.0] - 2024-11-05

### 架构重大变更

#### 完全移除 checkpoint_data
- 废弃 `jobs.checkpoint_data` 字段
- 所有数据迁移到结构化表
- 新增 NCA 任务追踪表

### Added
- `nca_jobs` 表（NCA 任务追踪）
- `scene_audio_candidates` 表（音频候选记录）
- `scripts/migrations/004_add_nca_tracking_fields.sql`

### Deprecated
- `jobs.checkpoint_data` 字段（计划在 v1.0.0 移除）

---

## [0.7.0] - 2024-10-28

### 架构重大变更

#### 多视频混剪支持
- 支持多个视频输入
- 新增混剪工作流

### Added
- `lib/workflow/workflows/multi-video.ts`
- `scripts/migrations/003_add_multi_video_support.sql`

### Changed
- `jobs` 表新增 `input_videos` 字段（JSON 数组）

---

## [0.6.0] - 2024-10-20

### 架构重大变更

#### 结构化数据表引入
- 从 `checkpoint_data` BLOB 迁移到结构化表
- 新增 6 个业务表

### Added
- `job_videos` 表（视频分析结果）
- `job_scenes` 表（分镜详情）
- `job_current_state` 表（任务当前状态）
- `job_step_history` 表（步骤执行历史）
- `scripts/migrations/001_structured_data.sql`
- `scripts/migrations/002_remove_checkpoint.sql`

---

## [0.5.0] - 2024-10-15

### Added

#### 层次化步骤系统
- 两层步骤架构：4 个大步骤 + 15 个子步骤
- 可折叠的进度展示
- 支持从任意步骤重新开始

### Changed
- 重构 `components/jobs/job-stepper.tsx`（层次化展示）
- 新增 `/api/jobs/:id/restart-from` 接口

---

## [0.4.0] - 2024-10-10

### Added

#### 音画同步策略优化
- 为每个分镜生成 3 个不同长度的旁白候选
- 通过 Fish Audio 批量合成音频
- 自动选择速度因子最接近 1.0 的方案

---

## [0.3.5] - 2024-10-05

### Added

#### 双平台架构支持
- 支持 Gemini Vertex AI（企业级，无大小限制）
- 支持 Gemini AI Studio（个人用户，2GB 限制）
- 自动平台检测

#### NCA S3 存储
- 音频文件存储从 GCS 迁移到 NCA S3
- 支持 MinIO、Cloudflare R2、AWS S3

### Changed
- 重构 `lib/ai/gemini-client.ts`（双平台支持）
- 新增 `lib/ai/nca/operations/s3-upload.ts`

---

## [0.3.0] - 2024-09-28

### Added

#### API 密钥管理
- 使用 AES-256-GCM 加密存储
- 支持 5 种外部服务配置

### Changed
- 新增 `api_keys` 表
- 新增 `/api/api-keys` 管理接口

---

## [0.2.0] - 2024-09-20

### Added

#### 断点续传机制
- 每个任务记录 `current_step` 字段
- 失败后可从上次断点继续
- 支持分镜级别恢复

---

## [0.1.0] - 2024-09-15

### Added

#### 初始版本发布
- 从 n8n 工作流迁移完成
- 四阶段工作流流水线
- Next.js 应用架构
- SQLite 数据库
- Docker 部署支持

---

## 版本号说明

从 v11.0.0 开始，项目采用**单一版本号体系**：

- **主版本号**：重大架构变更（不向后兼容）
- **次版本号**：功能增强（向后兼容）
- **修订号**：Bug 修复（向后兼容）

**历史版本说明**：
- v0.x.x：开发阶段（2024年9月-11月）
- v1.0.0-v10.0.0：架构演进阶段（2024年11月-2025年1月）
- v11.0.0-v11.2.0：稳定版本（2025年1月-12月）
- v12.0.0-v12.2.0：依赖全面升级、本地 FFmpeg、跳切修剪（2025年12月）
- v16.0.0+：代码优化与架构清理（2025年12月至今）

**授权系统版本**：
- 授权系统独立版本号（V1/V2/V3）保持不变
- 运行时根据授权码格式自动检测版本
