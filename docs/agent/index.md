# Agent 文档索引

本目录包含 Claude Code 的渐进式披露文档。

## 使用方式

**开始任务前，请先阅读相关文档**。这些文档按任务类型组织，避免一次性加载所有信息。

## 文档列表

| 文档 | 适用场景 |
|-----|---------|
| [architecture.md](architecture.md) | 理解项目结构、目录组织、模块划分 |
| [database.md](database.md) | 修改数据库表、添加字段、理解数据关系 |
| [workflow.md](workflow.md) | 工作流引擎相关、步骤处理、状态管理 |
| [api-routes.md](api-routes.md) | 添加/修改 API 端点、理解接口设计 |
| [ai-integration.md](ai-integration.md) | ASR、翻译、MiniMax TTS、Wav2Lip、provider gate |
| [retry.md](retry.md) | 错误重试策略、429 限流处理、格式修复机制 |
| [utils.md](utils.md) | logger、retry、lock、template 等核心工具 |
| [video-processing.md](video-processing.md) | 视频处理链路、URL 类型、FFmpeg 操作 |
| [deployment.md](deployment.md) | Docker 构建、Zeabur 部署、发布流程 |
| [credentials.md](credentials.md) | 测试账号、项目 ID、控制台访问 |
| [frontend.md](frontend.md) | 前端开发、组件编写、Hook 使用 |
| [env-vars.md](env-vars.md) | 环境变量配置、系统密钥 |
| [troubleshooting.md](troubleshooting.md) | 问题排查、常见错误、调试技巧 |
| [testing/](testing/index.md) | 功能测试、代码分析、测试用例执行 |
| [changelog.md](changelog.md) | 版本历史、功能更新、变更记录 |

## 设计原则

基于 HumanLayer 的 CLAUDE.md 最佳实践：

1. **Less is More**：核心 CLAUDE.md 控制在 60-80 行
2. **渐进式披露**：详细内容按需加载，避免上下文膨胀
3. **指针优于副本**：引用源代码路径而非复制代码片段
