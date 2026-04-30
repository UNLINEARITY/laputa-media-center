# 项目架构

Laputa 当前定位是中文自媒体内容引擎，主线是：

```text
/ingest -> /dubbing -> /jobs -> QA -> sample-to-full -> compare/report -> long-term assets
```

旧 AI 剪辑、风格库、分镜复刻链路已下架，不再作为产品入口或可执行 workflow 保留。

## 目录结构

```text
app/
├── api/
│   ├── ingest/          # 素材吸收任务创建
│   ├── dubbing/         # 翻译配音任务创建
│   ├── jobs/            # 任务查询、详情、日志、下载、QA、成本
│   ├── api-keys/        # API 密钥
│   ├── auth/            # 鉴权系统
│   ├── configs/         # 系统配置
│   └── ...
├── ingest/              # 素材吸收入口
├── dubbing/             # 翻译配音入口
├── jobs/                # 任务列表和详情
├── settings/            # 系统设置
└── guide/               # 使用教程

components/
├── dubbing/             # 配音表单和工作台
├── jobs/                # 任务、QA、compare 组件
├── report/              # 报告组件
├── workbench/           # 日志、成本、任务运行状态
├── settings/            # API、创作者资产、存储配置
├── guide/               # 指南与报告共用展示组件
├── layout/              # 布局组件
└── ui/                  # UI primitives

lib/
├── workflow/
│   ├── engine.ts        # workflow 引擎
│   ├── workflows/       # content_ingest、translation_dubbing
│   ├── steps/           # ingest 和 dubbing 步骤
│   └── state/           # 状态、持久化、生命周期
├── ingest/              # 素材识别、转写产物、content brief
├── dubbing/             # 配音配置、长期资产、源文件校验
├── jobs/                # QA、报告、下载、rerun、版本策略
├── db/                  # SQLite 仓储与结构化表
├── media/               # FFmpeg、本地文件、字幕
├── ai/                  # Gemini / TTS 客户端
└── storage/             # 存储追踪与清理

types/
├── core/                # job、scene-id、workbench
├── api/                 # API 响应类型
├── db/                  # DB row 类型
├── ai/                  # AI/TTS 类型
└── workflow/            # workflow context
```

## Workflow 边界

当前只允许两个可执行 workflow：

| Workflow | 入口 | 说明 |
| --- | --- | --- |
| `content_ingest` | `/api/ingest` | 接收 YouTube URL、本地视频或本地音频，生成转写和内容处理计划 |
| `translation_dubbing` | `/api/dubbing` | 接收已准备好的视频源，完成 ASR、翻译、配音、口型同步、合成 |

`/api/jobs` 的 `POST` 是旧剪辑入口，固定返回 `410 Gone`。`/api/jobs` 的 `GET` 以及 `/api/jobs/[id]/*` 仍保留，用于查询新旧任务和历史结果。

## 数据库

核心表仍保留历史兼容字段，例如 `style_id`、`style_name`。这些字段用于读取旧任务和过渡期任务，不代表旧风格系统仍可执行。

主要结构：

- `jobs`：任务主表。
- `job_current_state`：当前 stage、sub step、最终视频路径、QA 摘要。
- `job_step_history`：步骤历史和输入输出快照。
- `job_logs`：运行日志。
- `job_videos`：输入素材、媒体元数据、转写关联。
- `job_scenes`：分段、字幕、配音、QA 相关数据。
- `api_calls`：外部服务调用统计。

## 兼容原则

- 新任务必须通过 `/api/ingest` 或 `/api/dubbing` 创建。
- 旧任务读取不能因为旧执行模块删除而崩溃。
- 旧 step 名称可留在展示映射中，但不得重新注册为可执行 step。
- 旧 style YAML 资料目录不作为运行时入口使用；当前代码不再加载 `styleLoader`。
