# 静态代码分析 - 配置与长期资产

> 当前主线：`/ingest -> /dubbing -> /jobs -> QA -> sample-to-full -> compare/report -> long-term assets`
> 旧剪辑风格文件与旧创建入口已归档，不再作为主动 QA 成功路径。

## 测试目的

通过静态代码分析确认当前配置与长期资产不会把旧剪辑路径重新带回主线，同时保护密钥、provider gate、声线授权和交付审计 normal form。

## 当前检查范围

| 范围 | 当前职责 | 重点风险 |
| --- | --- | --- |
| `app/api/configs` | 系统配置读取与更新 | 敏感值脱敏、输入 schema、错误响应 |
| `app/api/api-keys` | provider 凭证保存与验证 | 付费验证确认、密钥不回显、旧 provider 只作兼容 |
| `app/api/dubbing/voices` | MiniMax 声线 registry | 授权、公众人物、披露要求、创作者默认声线绑定 |
| `lib/dubbing` | 配音 run plan、长期资产摘要、声线选择 | `config.translation_style`、固定读法、第二声线审计 |
| `lib/workflow/provider-gate-confirmation.ts` | provider gate 正常形 | dry-run、真实 smoke、正式配音 job 三类边界 |
| `lib/jobs/delivery-package.ts` | 交付审计与 evidence rows | QA freshness、provider smoke、人工终听、声线披露 |

## Normal Form

当前配置相关静态检查按以下 primitive 拆分：

| Primitive | 输入 | 输出 | 不变量 |
| --- | --- | --- | --- |
| Config command | API body / form state | 已验证配置更新 | 不接受未知危险字段；不回显密钥 |
| Provider gate rule | readiness gates + command scope | required / confirmed / missing / unknown | dry-run 不付费；真实 smoke 才允许外呼；正式配音不混入 YouTube gate |
| Voice registry entry | voice_id + 元数据 | 可审计声线选择 | 公众人物与未知授权必须保留披露提示 |
| Applied asset summary | job config + profile assets | 提交前/报告/compare 摘要 | 长期资产在 TTS 成本发生前可见 |
| Delivery evidence row | job state + artifacts + audits | 交付证据状态 | 证据不改写自动 QA 分数；交付审计单独判定 |

## 检查清单

### 配置 API

- [ ] `POST /api/configs` 只允许可编辑配置键。
- [ ] 返回值不包含完整密钥、token 或 provider credential。
- [ ] 错误响应不泄露本地绝对敏感路径或密钥片段。

### API Key 与 Provider

- [ ] MiniMax 保存验证必须有显式付费确认。
- [ ] Gemini/MiniMax provider verification 不出现在 dry-run 路径。
- [ ] 旧 provider 只作为兼容状态展示，不作为 `/api/dubbing` 成功路径。

### 声线 Registry

- [ ] `voice_id` 只作为 registry key 或 raw fallback，不替代授权元数据。
- [ ] `creator_owned`、`authorized_clone`、`public_figure_commentary`、`synthetic_narration`、`generic` 分类保持可区分。
- [ ] 第二声线与主声线使用同一套用途、公众人物、披露 normal form。
- [ ] 用户改变声线后，本次 `usage_boundary_acknowledged` 必须失效。

### Provider Gate

- [ ] 普通 `dry_run_provider_smoke` 不接受 `source_url` 或 `confirmed_gate_ids` 作为执行条件；用于真实 smoke 前置证据的 dry-run rehearsal 必须绑定同一 `job_id + source_url`，只沉淀 `source_ref`，不触发外部 provider。
- [ ] `real_provider_smoke` 必须绑定 `job_id`、source-bound dry-run evidence、`manual_authorization`、paid/stress gates、预算、次数/并发上限和完整 `confirmed_gate_ids`；启动前与每轮响应都必须校验 `runtime_fingerprint` / `audit.runtime_fingerprint`。
- [ ] `/api/dubbing` 只接受 `translation_provider`、`minimax_tts`，不接受 YouTube gate。

### 长期资产与交付

- [ ] `/dubbing` 提交前可见语言风格、修稿备注、固定读法、声线用途。
- [ ] compare/report/QA 使用同一份 applied asset summary。
- [ ] delivery package 展示 QA freshness、provider smoke、人工终听与声线披露证据。

## 推荐命令

```bash
pnpm test:unit tests/docs/api-routes-safety-guard.test.ts tests/docs/dynamic-testing-safety-guard.test.ts tests/api/dubbing-route.test.ts tests/api/dubbing-voices-route.test.ts tests/api/ingest-dubbing-readiness-smoke-route.test.ts
pnpm lint
pnpm test
pnpm build
```

## 问题记录模板

| 编号 | 位置 | 问题描述 | Normal form 破坏点 | 修复方案 | 状态 |
| --- | --- | --- | --- | --- | --- |
| CFG-001 | | | | | |
