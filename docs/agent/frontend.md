# 前端开发指南

## 架构原则

本项目统一使用 API Routes 处理后端操作，不使用 Server Actions。

| 规则 | 说明 |
| --- | --- |
| 推荐 | 通过 `/api/*` 调用后端能力 |
| 推荐 | 客户端用 `fetch` + `router.refresh()` 获取或刷新数据 |
| 禁止 | 新增 `'use server'` Server Actions |
| 禁止 | 在 `app/actions/` 新增业务动作 |

## 当前主线页面

| 页面 | 说明 |
| --- | --- |
| `/ingest` | YouTube、本地视频、本地音频素材吸收 |
| `/dubbing` | 翻译配音任务提交，提交前展示会套用的长期资产 |
| `/jobs` | 任务列表、状态、下载、QA、compare/report 入口 |
| `/settings` | API 密钥、创作者资产、存储清理 |
| `/guide` | 当前主线使用说明 |

旧 `/styles` 风格库页面和旧 task creation wizard 已删除。

## 组件族

| 组件族 | 目录 | 说明 |
| --- | --- | --- |
| UI 基础 | `components/ui/` | 基础、复合、反馈组件 |
| 布局 | `components/layout/` | Header、Footer、PageHeader、SiteLogo |
| 素材吸收 | `components/ingest/` | 素材吸收页面组件 |
| 配音 | `components/dubbing/` | 配音表单、工作台、长期资产预览 |
| 任务 | `components/jobs/` | 任务列表、QA、compare |
| 报告 | `components/report/` | report 页面和各 section |
| 工作台 | `components/workbench/` | 日志、成本、运行状态 |
| 设置 | `components/settings/` | API、创作者资产、系统配置、存储清理 |
| 指南 | `components/guide/` | 指南和报告复用展示组件 |

## 数据获取

任务详情优先读取结构化字段：

```typescript
const response = await fetch(`/api/jobs/${jobId}`, { cache: 'no-store' })
const data = await response.json()
const job = data.job
const state = job.state
const stepHistory = job.stepHistory || []
```

字段优先级：

1. `job.state`
2. `job.stepHistory`
3. 历史兼容字段，例如 `checkpoint_data`

## UI 文案

- 产品 UI 和项目文档使用简体中文。
- 新流程围绕素材吸收、翻译配音、QA、sample-to-full、compare/report、长期资产沉淀。
- 不再出现“选择剪辑风格”“分镜数量”“开始剪辑”等旧主线文案，除非明确标注为历史兼容。

## 关键组件

| 组件 | 路径 | 用途 |
| --- | --- | --- |
| `DubbingForm` | `components/dubbing/dubbing-form.tsx` | 配音任务创建和长期资产预览 |
| `DubbingWorkbench` | `components/dubbing/dubbing-workbench.tsx` | 配音任务工作台 |
| `JobListClient` | `components/jobs/job-list-client.tsx` | 任务列表 |
| `JobQaReport` | `components/jobs/job-qa-report.tsx` | 配音 QA 展示 |
| `JobCompareClient` | `components/jobs/job-compare-client.tsx` | sample/full 对比和资产沉淀 |
| `ReportLayout` | `components/report/ReportLayout.tsx` | 报告布局 |
| `CreatorAssetsConfig` | `components/settings/creator-assets-config.tsx` | 创作者长期资产配置 |

## 兼容约束

- 旧 DB 任务可能仍含 `style_id`、`style_name`、旧 step 名称；展示层要能读取，但不能重新开放旧创建入口。
- `/api/jobs GET` 和 `/api/jobs/[id]/*` 是通用任务读取能力，前端不要假设任务一定是新建配音任务。
- 生成视频、音频、转写等 runtime 文件应放在输出目录，避免写入项目源码根目录触发 Next.js 重编译。
