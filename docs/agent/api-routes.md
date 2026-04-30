# API 路由参考

本项目使用 Next.js API Routes。禁止新增 Server Actions。

## 主线任务创建

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/ingest` | 创建素材吸收任务 |
| POST | `/api/dubbing` | 创建翻译配音任务 |

### 创建素材吸收任务

```bash
curl -X POST http://localhost:8899/api/ingest \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -d '{
    "source": "https://www.youtube.com/watch?v=VIDEO_ID",
    "ingest_goal": "transcript"
  }'
```

支持来源：

- YouTube URL。
- 本地视频路径。
- 本地音频路径。

运行前按环境配置 `INGEST_FFMPEG_EXE`、`INGEST_YTDLP_EXE`、`INGEST_PYTHON_EXE`、`INGEST_WHISPER_CLI`、`INGEST_WHISPER_MODEL`。

### 闭环 readiness 与 provider smoke

```bash
curl -s -H "Authorization: Bearer YOUR_API_TOKEN" \
  http://localhost:8899/api/ingest/dubbing-readiness
```

readiness 响应会区分运行和环境级交付审计前置：`production_ready` 是真实链路可跑；`runtime_readiness_level` 是 `blocked` / `dry_run` / `live`；`delivery_audit_ready` 和 `delivery_audit` 只表示声线用途、披露元数据等环境前置是否足够进入正式交付检查。它们不代表任何具体 job 的交付包 artifact audit，也不检查 `final_video`、`delivery_readme`、`qa_json` 或 `voice_disclosure` 产物。声线元数据缺失不会阻断 smoke 或真实运行，但会让环境审计保持 warning。

Provider 调用边界正常形：

| 场景 | Endpoint / mode | 外部调用 | 可能费用 | 创建配音 job / 产物 | 必填确认 |
| --- | --- | --- | --- | --- | --- |
| `dry_run_provider_smoke`（dry-run provider smoke） | `POST /api/ingest/dubbing-readiness` + `mode: "dry_run"` | 否 | 否 | 否；带 `job_id` 时只写 smoke audit 证据；带 `source_url` 时只保存 source hash | 无 |
| `real_provider_smoke_preflight`（真实 smoke 服务端预检） | 内部 API endpoint: `POST /api/ingest/dubbing-readiness` + `mode: "real_provider_smoke_preflight"`；由 `pnpm provider-smoke:armed-run` 在真实请求前调用 | 否 | 否 | 否；只签发 server-side `provider_smoke_run_permit` | 确认 ID 不是执行授权；必须有 source-bound passed dry-run evidence，且 `required_real_provider_gates.youtube_download/translation_provider/minimax_tts` 全部 `run_mode=real`；还要绑定 `manual_authorization`、预算、runs/concurrency、`job_id`、`source_url` 和 command hash |
| `real_provider_smoke`（真实 provider smoke） | 内部 API endpoint: `POST /api/ingest/dubbing-readiness` + `mode: "real_provider_smoke"`；CLI 执行入口: `pnpm provider-smoke:armed-run` | 是 | 是 | 否 | 确认 ID 不是执行授权；CLI armed-run 必须保留 `provider_smoke_preflight_receipt` / `PROVIDER_SMOKE_PREFLIGHT_RECEIPT_FILE` 作为 operator handoff；API route 本身不读取 receipt，只强制 `ALLOW_PAID_DYNAMIC_TESTS=true`、`job_id`、source-bound passed dry-run evidence、server-side `provider_smoke_run_permit`、`manual_authorization`、`source_url`、服务端 DB-backed attempt reservation 和 `confirmed_gate_ids: ["youtube_download", "translation_provider", "minimax_tts"]` |
| `dubbing_job`（正式 /api/dubbing job） | `POST /api/dubbing` | 是 | 是 | 是 | `config.usage_boundary_acknowledged` + `config.confirmed_gate_ids: ["translation_provider", "minimax_tts"]`；可复制动态测试命令还必须先设置 `ALLOW_PAID_DYNAMIC_TESTS=true`；不混入 `youtube_download` |

默认 provider smoke 只做 dry-run，不触发 YouTube、Gemini 或 MiniMax 外部调用：

```bash
curl -s -X POST http://localhost:8899/api/ingest/dubbing-readiness \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -d '{ "mode": "dry_run", "job_id": "OPTIONAL_JOB_ID" }'
```

普通 readiness dry-run 不传 `source_url`、不传 `confirmed_gate_ids`，也不需要 `ALLOW_PAID_DYNAMIC_TESTS`。用于真实 provider smoke 前置证据的 dry-run rehearsal 必须传同一 `source_url`，但服务端只保存脱敏 `source_ref.host + url_sha256`，不访问 YouTube、Gemini 或 MiniMax。响应会返回 `audit` normal form，包含 `schema_version`、`checked_at`、`mode`、`verdict`、`external_calls_executed`、`runtime_fingerprint.package_name/package_version/next_build_id`、`source_ref`、`required_real_provider_gates`、`result_counts` 和 `top_blockers`。作为真实 smoke 前置证据时，`required_real_provider_gates` 必须证明 `youtube_download`、`translation_provider`、`minimax_tts` 三个 gate 都存在且 `run_mode=real`；任一 gate 是 dry-run fallback、placeholder、blocked 或缺失，都不能进入 server-side preflight。如果请求带 `job_id`，服务端只允许绑定 `content_ingest` 或 `translation_dubbing` 主线任务，并把同一份 audit 写入该任务的 `job_logs`；API token 只能写入自己创建的任务。`GET /api/jobs/:id` 会在 `providerSmokeAudit` 返回该任务最新一次 provider smoke audit，并在 `providerSmokeDryRunLedger` 返回同一 runtime 下 latest ready dry-run epoch 摘要。

真实 provider smoke 不提供裸 JSON 快捷入口；必须先完成 job-bound、source-bound dry-run rehearsal，并拿到 source-bound dry-run evidence，再使用动态测试文档中的 armed-run SOP 执行；不要从 API 文档复制单次快捷 curl。进入 manual authorization 前应先运行 `pnpm provider-smoke:evidence:check -- --job "${DRY_RUN_PROVIDER_SMOKE_AUDIT_JOB_ID}" --require-ready-dry-run --source-url "${DRY_RUN_PROVIDER_SMOKE_SOURCE_URL}" --max-age-ms "${DRY_RUN_PROVIDER_SMOKE_EVIDENCE_MAX_AGE_MS}"`，确认 latest server evidence 的 `source_ref_match=true`、`fresh_enough=true`，且 `required_real_provider_gates` 中 `youtube_download`、`translation_provider`、`minimax_tts` 全部 `run_mode=real`；该 probe 只读数据库，不触发 provider，也不打印原始 source URL。服务端会强制要求 `ALLOW_PAID_DYNAMIC_TESTS=true`，否则不会进入 YouTube、Gemini 或 MiniMax live gate。armed run 的 command object 必须包含 `mode: "real_provider_smoke"`、`source_url`、`job_id`、完整 `confirmed_gate_ids`、`manual_authorization`、dry-run evidence、server-side `provider_smoke_run_permit` reference、预算上限、总 runs 上限和并发上限、`PROVIDER_SMOKE_PREFLIGHT_RECEIPT_FILE` 和 NDJSON 证据日志；`runs <= max_runs`，`concurrency <= max_concurrency`，`runs` 可以大于 `max_concurrency` 并由 armed-run 按批次执行。本地 dry-run evidence、run permit reference 和每轮真实响应都必须校验 `runtime_fingerprint` / `audit.runtime_fingerprint`。`real_provider_smoke` 前必须先调用 `real_provider_smoke_preflight`，由服务端签发 `provider_smoke_run_permit`；响应只暴露 `type=provider_smoke_run_permit`、`permit_id`、`command_hash`、`issued_at`、`expires_at`、`source_ref`、`provider_calls_authorized=false`，真实请求只提交 `{ permit_id, command_hash }`。服务端保存的 permit 通过 `auth_principal` 与 `command_binding` 绑定 `job_id`、`source_ref`、`runtime_fingerprint`、`required_real_provider_gates`、`manual_authorization`、预算、runs/concurrency 和 confirmed gates。permit 缺失、过期、hash mismatch、source/runtime/manual authorization/budget/gates mismatch 时，route 必须在任何 provider call 前 fail closed。服务端在任何 provider call 前必须先验证同 scope run permit，再原子写入 DB-backed attempt reservation：`job_logs.details.provider_smoke_attempt_reservation`，字段包含 `reservation_id`、`status=started|completed|failed`、`reserved_at`、`expires_at`（即 `lease_expires_at`）、`source_ref`、`runtime_fingerprint` 和 budget/concurrency policy；`reservation_id` 是本 SQLite-backed flow 的 lease token / fencing token。reservation must be acquired before provider call，且不得退回 file-only or memory-only concurrency。reservation 事务会重新读取 latest ready dry-run epoch，并在同一事务内确认 `runtime_fingerprint`、`source_ref`、freshness、required real gates 和 run permit 仍匹配；若 dry-run epoch 被更新、变成 blocked、source mismatch、stale 或 required real gate mismatch，返回 `PROVIDER_SMOKE_ARMED_DRY_RUN_EVIDENCE_REQUIRED`，且不调用 provider。reservation 绑定 latest dry-run epoch：只统计最新 ready dry-run 之后的 reservation；`reserved_at >= dry_run_checked_at` 会被保守计入，`status=started && expires_at > now` 计入 active lease，过期 lease 不占并发但仍计入 started run/budget，避免崩溃后重复花费。真实 audit 会写 `attempt_reservation_id`，避免 reservation 与 audit 重复计数。真实 provider 调用一旦开始，provider 抛错、HTTP 非 2xx、超时、响应 JSON 损坏、runtime/source mismatch 也必须写入 durable failed/partial attempt ledger，并以 `partial_ledger_record=true`、`ok=false`、`verdict=failed` 进入 `PROVIDER_SMOKE_ARMED_RUN_LOG`；这些记录不计为成功 summary，且不得包含 token、原始 source URL、完整 provider response 或完整 NDJSON。`PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE` 应由本地 no-network 命令 `pnpm provider-smoke:manual-auth:prepare -- --confirmed-by "<operator>"` 生成，不从 API 文档手写裸 JSON；该命令只读本地 dry-run evidence、校验 source/runtime/budget 并写入授权文件，不读 `TEST_API_TOKEN`、不设置 `ALLOW_PAID_DYNAMIC_TESTS`、不访问 API 或 provider；若 token、paid gate 或 stress gate 已存在，会 fail closed 且不写授权文件。随后可运行 `pnpm provider-smoke:readiness:bundle` 生成 redacted readiness 报告，再运行 no-paid / no-network `pnpm provider-smoke:handoff:verify`（同义别名：`pnpm provider-smoke:pressure-plan`）审查 `provider_smoke_paid_handoff_verifier` / `no_paid_handoff_pressure_plan`；可选 `PROVIDER_SMOKE_HANDOFF_VERIFY_FILE` / `PROVIDER_SMOKE_HANDOFF_VERIFY_MARKDOWN_FILE` 只是 `no_paid_handoff_pressure_plan_archive`，stdout 仍是 canonical contract。`handoff:verify` 的 `ok=true` 只表示可交给人工确认，不授权 provider call，也不得直接运行 `provider-smoke:armed-run`；人工确认后才可设置 paid/stress gates 并运行 `provider-smoke:armed-run:preflight`。本机 preflight 写出 machine-bound `provider_smoke_preflight_receipt`，receipt 绑定 `command_hash`、`machine_binding`、source/runtime/manual authorization/dry-run evidence/budget/log path 和 required real gate proof；该 receipt 只由 `PROVIDER_SMOKE_PREFLIGHT_RECEIPT_FILE` 指向本地 JSON，API 不保存 receipt。可选本地 no-network 命令 `pnpm provider-smoke:receipt:verify` 会输出 `provider_smoke_preflight_receipt_verification`，只复核同机 receipt 与当前 command object 是否一致，不读取 `TEST_API_TOKEN`、不连接 provider、不写 armed NDJSON、不授权 provider call。armed-run 仍必须读取同机 receipt；通过后先调用 server-side `real_provider_smoke_preflight` 取得 `provider_smoke_run_permit`，再把 `{ permit_id, command_hash }` 提交给 `real_provider_smoke`。receipt 缺失、过期、mismatch、搬到另一台机器，或 permit 缺失、过期、hash/scope mismatch，都会在任何 provider 请求前 fail closed。receipt 不得复制原始机器名、用户名、home 路径、token 或原始 source URL。生成的 `manual_authorization` 必须绑定确认人、确认时间、`job_id`、`source_ref`、runs/concurrency/budget 和固定确认项；占位符、过期确认或 scope mismatch 会在外部调用前 fail closed。`job_id` 不是可省略字段；它用于把真实 provider smoke audit、run permit 和 attempt reservation 绑定到同一个主线 ingest/dubbing job。

执行面边界正常形：API route 不读取 receipt 文件、不校验 `PROVIDER_SMOKE_PREFLIGHT_RECEIPT_FILE`、不保存 receipt，也不接受 receipt 作为 request 字段；route 直调必须依赖服务端 env gate、服务端 command binding、`manual_authorization`、source-bound dry-run evidence、server-side `provider_smoke_run_permit`、DB-backed attempt reservation、ledger/concurrency/budget gates 和 job 权限。CLI receipt 只保护 operator 本机 `provider-smoke:armed-run` command path，是 operator handoff 证据，不是 API route 的唯一授权来源；armed-run 在本机校验 receipt 后，必须先调用 server-side `real_provider_smoke_preflight` 取得 permit，才可调用真实 `real_provider_smoke` mode。

### 创建翻译配音任务

```bash
: "${ALLOW_PAID_DYNAMIC_TESTS:?确认正式配音会调用外部翻译/MiniMax provider、可能产生费用后再执行}"

curl -X POST http://localhost:8899/api/dubbing \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -d '{
    "video_url": "C:/videos/source.mp4",
    "source_language": "en",
    "target_language": "cantonese",
    "voice_id": "minimax_voice_id",
    "lipsync_mode": "none",
    "config": {
      "sample_mode": true,
      "translation_style": "localized_script",
      "usage_boundary_acknowledged": true,
      "confirmed_gate_ids": ["translation_provider", "minimax_tts"]
    }
  }'
```

配音任务要求在 UI/API 路径中保留本次声线使用边界确认。优先使用创作者自有声音、有本地授权记录的声音或清楚标注的 AI 旁白声音。`config.usage_boundary_acknowledged=true` 是当前 normal form；历史 `voice_usage_confirmed` 仅作为兼容字段读取。真实翻译或 MiniMax TTS provider 已配置时，还必须先读取 `/api/ingest/dubbing-readiness`，但正式 job 只提交 dubbing job scope 的 `config.confirmed_gate_ids`：`translation_provider` 与 `minimax_tts`；未确认时不会触发外部 provider 调用。

Provider confirmation 使用 `lib/workflow/provider-gate-confirmation.ts` 作为 normal form。`provider_smoke` scope 会要求 `youtube_download`、`translation_provider`、`minimax_tts`；普通 `/api/dubbing` 创建只接受 dubbing job scope，也就是 `translation_provider` 和 `minimax_tts`。不要把真实 provider smoke 的 YouTube gate 混入单次配音 job 创建。

`source_url` 只属于 `real_provider_smoke`；正式 `/api/dubbing` 使用 `video_url` 或 `source_job_id + source_artifact_id` 指定配音源。

从素材吸收任务交给配音时，先让 `/api/ingest` 以 `ingest_goal: "localize"` 完成，再用 `/api/dubbing` 的 `source_job_id` 和 `source_artifact_id` 指向该任务的原片 artifact。样片转全片和重跑不会调用独立的 jobs rerun API，而是通过 `/dubbing` 预填后创建新的 `/api/dubbing` 任务，并在 `config` 中写入 `sample_to_full`、`sample_asset_snapshot` 等字段。

## 任务查询与产物

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/jobs` | 任务列表，支持分页和状态筛选 |
| GET | `/api/jobs/:id` | 任务详情，包含 `state` 和 `stepHistory` |
| GET | `/api/jobs/:id/logs` | 任务日志 |
| GET | `/api/jobs/:id/cost` | 成本统计 |
| GET | `/api/jobs/:id/download` | 下载最终成片 |
| GET | `/api/jobs/:id/artifact` | 读取任务 artifact |
| GET | `/api/jobs/:id/qa` | 只读下载配音 QA JSON |
| POST | `/api/jobs/:id/qa` | 显式生成并持久化配音 QA 摘要 |

`/api/jobs` 的 `GET` 和 `/api/jobs/[id]/*` 必须兼容旧 DB 任务读取。

`GET /api/jobs/:id` 还会返回 `providerSmokeAudit`，用于展示最近一次与该任务绑定的 dry-run 或真实 provider smoke 证据；未绑定过 smoke 时为 `null`。同一响应的 `providerSmokeDryRunLedger` 是只读展示字段，用于让 workbench、report 和交付包显示 latest dry-run epoch、真实 smoke 次数和运行指纹；它不授权真实 provider smoke，也不会触发外部调用。DB-backed attempt reservation 只作为服务端 paid smoke gate 和 redacted audit 账本使用，不向展示层暴露原始 source URL、token、完整 provider response、机器名、用户名或本机路径。

对已完成的 `translation_dubbing` 任务，`deliveryPackage` 会包含 `deliveryAuditReadiness`。这个 job 级交付审计 normal form 会统一检查 `final_video`、`delivery_readme`、`qa_json`、`voice_disclosure` 和 `manual_final_listen`，并返回 `ready/status/label/guidance/blockers/warnings/checks`。`GET /api/jobs/:id/qa` 同样返回这份 `deliveryAuditReadiness`，QA 页面不再重新推导交付审计状态。

人工终听记录由 `PATCH /api/jobs/:id/manual-final-listen` 写入 `job_current_state.step_context.manual_final_listen`，只作为自动 QA 后的最终听感证据，不改变自动 QA 分数。未记录时 `deliveryEvidence.manual_final_listen` 为 `not_recorded`，同时 `deliveryAuditReadiness.checks[].id="manual_final_listen"` 保持 `warning`；记录后按同一张状态表进入交付审计：

| status | 交付证据状态 | 交付审计影响 |
| --- | --- | --- |
| 未记录 | `not_recorded` | 交付审计待补 |
| `pending` | `warning` | 交付审计待补 |
| `passed` | `ready` | 交付审计就绪 |
| `failed` | `blocked` | 交付审计阻断 |
| `waived` | `warning` | 交付审计待补 |

## 设置与运行支撑

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST | `/api/api-keys` | 密钥读取和保存 |
| GET/PUT/DELETE | `/api/api-keys/:service` | 指定服务密钥管理 |
| POST | `/api/api-keys/verify` | 只验证密钥、不保存；Google/Gemini/GCS/MiniMax 等真实 provider 验证必须显式确认 |
| GET/POST | `/api/configs` | 系统配置 |
| GET/PUT/DELETE | `/api/configs/:key` | 指定配置 |
| GET | `/api/storage/stats` | 存储使用统计 |
| POST | `/api/storage/cleanup` | 清理临时文件 |
| GET | `/api/health` | 健康检查 |
| GET | `/api/runtime/fingerprint` | 受认证 runtime fingerprint；provider smoke 脚本用它确认目标 runtime 的 `package_name/package_version/next_build_id` 与当前 repo 一致，`runtime_booted_at` 只用于人工判断进程是否重启 |
| GET/POST | `/api/init` | 初始化检查 |
| POST | `/api/dev/clear-cache` | 开发调试兼容端点 |

凭证命令 normal form：

| 表面入口 | 命令 | 外部 provider 调用 | 写入 | 已验证标记 | gate |
| --- | --- | --- | --- | --- | --- |
| `POST /api/api-keys` | `operation: "save_only"` | 否 | 加密保存凭证 | 否 | 本地形状校验 |
| `POST /api/api-keys` | `operation: "verify_and_save"` | 是 | 验证成功后保存 | 是 | `confirmPaidVerification: true` + `ALLOW_PAID_DYNAMIC_TESTS=true` |
| `POST /api/api-keys/verify` | verify only | 是 | 否 | 否 | `confirmPaidVerification: true` + `ALLOW_PAID_DYNAMIC_TESTS=true` |

- `google_ai_studio`、`google_vertex`、`google_storage` 默认按 `save_only` 处理；只检查必要字段和 JSON 形状，不调用 Gemini/Vertex/GCS，不获取 Google token，不上传或删除测试对象。
- `minimax_tts + operation: "save_only"` 只加密保存 `api_key` 与默认 `voice_id`，不调用 MiniMax，不标记为已验证。
- `minimax_tts + operation: "verify_and_save"` 会调用一次 MiniMax 测试 TTS；旧客户端若不传 `operation` 但传了 `confirmPaidVerification: true`，仍按 `verify_and_save` 兼容处理；不传确认不会保存或验证。
- 旧 Fish/Edge TTS 默认关闭：`LEGACY_TTS_ENABLED=false` 时，`GET /api/tts/status` 只返回 disabled 状态；`GET /api/tts/voices`、`POST /api/tts/verify-voice`、`fish_audio_vertex` / `fish_audio_ai_studio` 的凭证写入或验证都会返回 `410 LEGACY_TTS_DISABLED`，不会加载或调用旧 provider。
- `fish_audio_vertex` / `fish_audio_ai_studio` 只属于旧 TTS 兼容，不支持 `save_only`；若触发真实 Fish Audio API Key 写入验证或旧兼容音色验证，必须同时具备服务端 `LEGACY_TTS_ENABLED=true`、请求体 `confirmLegacyTts` / `confirmLegacyFishAudio`、`confirmPaidVerification: true` 和服务端 `ALLOW_PAID_DYNAMIC_TESTS=true`。历史状态展示不需要 paid gate。

凭证状态 normal form：

| `verification_state` | 含义 | UI/readiness 语义 |
| --- | --- | --- |
| `missing` | 没有保存或运行时可读凭证 | 未配置 |
| `saved_unverified` | 设置页已加密保存，但未执行真实 provider 验证 | 已保存待验证；保存不等于验证 |
| `verified` | 设置页保存后通过一次显式真实 provider 验证 | 已验证 |
| `not_tracked` | 环境变量或本地文件可读，但设置页没有验证记录 | 未记录验证 |

`GET /api/api-keys` 会保留旧字段 `is_configured`、`is_verified`、`verified_at`，并新增 `source`、`verification_state`、`verification_label`、`verification_detail`。`google_ai_studio`、`google_vertex`、`google_storage` 的 save-only 结果只能显示为 `saved_unverified`，不能显示为 `verified`。`/api/ingest/dubbing-readiness` 也会在 `translation_credential_status` 中用同一状态表展示 Gemini 翻译凭证，并在 `translation_credential_status.runtime` 返回脱敏运行时摘要：`api_key_source`、`model_id`、`model_source`、`api_base_url_configured`、`api_base_url_source`。该摘要只展示来源，不返回 API key。

当前 `not_tracked` 只用于运行时代码实际会读取、但设置页没有验证记录的来源：`google_ai_studio` 的 `GEMINI_API_KEY` / `GOOGLE_AI_STUDIO_API_KEY`，以及 `minimax_tts` 的环境变量或本地文件凭证。`google_vertex` 与 `google_storage` adapter 目前只读取设置页加密保存的凭证；即使环境里存在 `GOOGLE_APPLICATION_CREDENTIALS`、`GOOGLE_CLOUD_PROJECT` 或 `GCS_BUCKET`，也不能显示成 `not_tracked`。

## 已下架入口

以下旧剪辑入口已从产品主线移除：

- `POST /api/jobs`（旧剪辑任务创建入口，固定返回 `410 Gone`）
- `/styles`
- `/api/styles/*`
- `components/task-creation/*`
- `single-video` / `multi-video` workflow

旧 `/api/jobs POST` 会返回：

```json
{
  "error": "Legacy editing job endpoint removed",
  "code": "LEGACY_EDITING_ENDPOINT_REMOVED",
  "message": "旧剪辑任务创建入口已下架。素材吸收请使用 /api/ingest，翻译配音请使用 /api/dubbing。",
  "replacement_endpoints": {
    "content_ingest": "/api/ingest",
    "translation_dubbing": "/api/dubbing"
  }
}
```

## 响应格式

成功响应通常包含：

```json
{
  "success": true,
  "data": {}
}
```

错误响应通常包含：

```json
{
  "success": false,
  "error": "错误信息"
}
```
