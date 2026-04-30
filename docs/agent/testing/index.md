# 测试文档

## 测试凭据

> **安全提示**：凭据文件夹包含敏感信息，不要提交到公开仓库。删除此文件夹后，测试文档不含任何敏感信息。

| 文件 | 用途 |
|------|------|
| [credentials/cloud.md](credentials/cloud.md) | 云端测试环境凭据（Zeabur） |
| [credentials/local.md](credentials/local.md) | 本地开发环境凭据 |
| [credentials/shared.md](credentials/shared.md) | 共用资源（测试视频、API 配置模板） |

---

## 动态测试（功能测试）

运行时功能验证，包括云端和本地两套测试。

### 测试文档 normal form

动态测试文档按四类维护，避免旧剪辑路径重新混入当前主线：

| 类别 | 范围 | 约束 |
|------|------|------|
| 当前主线 | `/api/ingest -> /api/dubbing -> /api/jobs -> QA -> sample-to-full -> compare/report -> long-term assets` | 可以作为成功路径执行 |
| 负向测试 | 旧 `/api/jobs POST`、旧 `/api/styles`、旧 Gemini/Fish/Edge 兼容入口 | 只能验证 410、已归档或兼容边界；写入口必须带 `ALLOW_LEGACY_WRITE_NEGATIVE_TESTS` |
| 破坏性测试 | 删除任务、撤销 token、存储清理 | 必须带 `ALLOW_DESTRUCTIVE_DYNAMIC_TESTS`，清理执行还必须有显式确认字段 |
| 凭证测试 | API key 保存、付费验证、provider smoke | `save_only` 不调用 provider；真实验证必须带 `ALLOW_PAID_DYNAMIC_TESTS` 和确认字段 |

### 云端测试
| 文档 | 测试范围 |
|------|---------|
| [cloud-ui.md](dynamic/cloud-ui.md) | 界面渲染、登录流程、表单验证 |
| [cloud-workflow.md](dynamic/cloud-workflow.md) | 素材吸收与翻译配音主线执行 |
| [cloud-task-control.md](dynamic/cloud-task-control.md) | 任务控制（v12.1.0 已移除 stop 功能） |
| [cloud-api.md](dynamic/cloud-api.md) | API 端点功能验证 |
| [cloud-edge-cases.md](dynamic/cloud-edge-cases.md) | 错误处理、边界条件 |

### 本地测试
| 文档 | 测试范围 |
|------|---------|
| [local-ui.md](dynamic/local-ui.md) | 界面渲染、登录流程、表单验证 |
| [local-workflow.md](dynamic/local-workflow.md) | 素材吸收与翻译配音主线执行 |
| [local-task-control.md](dynamic/local-task-control.md) | 任务控制（v12.1.0 已移除 stop 功能） |
| [local-api.md](dynamic/local-api.md) | API 端点功能验证 |
| [local-edge-cases.md](dynamic/local-edge-cases.md) | 错误处理、边界条件 |

## 静态测试（代码分析）

代码质量和架构分析。

| 文档 | 分析范围 |
|------|---------|
| [workflow-engine.md](static/workflow-engine.md) | lib/workflow/ 模块 |
| [database-layer.md](static/database-layer.md) | lib/db/ 模块 |
| [ai-integration.md](static/ai-integration.md) | lib/ai/ 模块 |
| [auth-security.md](static/auth-security.md) | lib/auth/ 模块 |
| [api-routes.md](static/api-routes.md) | app/api/ 路由 |
| [frontend-components.md](static/frontend-components.md) | components/ 目录 |
| [utils.md](static/utils.md) | lib/utils/ 模块 |
| [type-system.md](static/type-system.md) | types/ 目录 |
| [config-style.md](static/config-style.md) | 配置、长期资产与旧 styles 归档检查 |
| [code-quality.md](static/code-quality.md) | 整体代码质量评估 |
