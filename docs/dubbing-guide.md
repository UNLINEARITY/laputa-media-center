# Laputa 翻译配音指南

本指南描述当前 Web/API 主线，不绕过 `/api/dubbing` 的任务创建、声线使用边界确认、registry 元数据、QA 和交付披露。

当前配音主线：

```text
/ingest -> /dubbing -> /jobs -> QA -> sample-to-full -> compare/report -> long-term assets
```

## 适用范围

- 外语视频转普通话、粤语或其他主流语言。
- 本地视频、本地音频或已由 `/ingest` 保留的 YouTube source artifact。
- 创作者自有声线、有本地授权记录的克隆声线、MiniMax 通用旁白声线或需要披露的公众人物评论/转译声线。
- 样片验证后，用同一套资产快照提升到全片任务。

不建议直接绕过 Web/API 主线运行外部脚本。外部增强 runtime 只能作为 `/api/dubbing` 工作流内部 bridge 或受控 fallback 使用。

## 系统需求

| 项目 | 最低要求 | 建议 |
| --- | --- | --- |
| 操作系统 | Windows 10/11 | Windows 11 |
| Node.js | 20+ | 24+ |
| Python | 3.10+ | 使用 `DUBBING_PYTHON_EXE` 指定 |
| FFmpeg | 可执行文件 | 使用 `INGEST_FFMPEG_EXE` 或 `DUBBING_FFMPEG_EXE` 指定 |
| Whisper | CLI 或 bridge | 用于 ASR 与时间码 |
| MiniMax | API Key | 用于正式 TTS |
| Wav2Lip | 可选 | 仅在需要口型同步时配置 |

## 环境变量

```env
# ingest
INGEST_FFMPEG_EXE=ffmpeg
INGEST_YTDLP_EXE=yt-dlp
INGEST_PYTHON_EXE=python
INGEST_WHISPER_CLI=whisper
INGEST_WHISPER_MODEL=base

# dubbing
DUBBING_PYTHON_EXE=python
DUBBING_RVC_PYTHON_EXE=python
DUBBING_SKILL_DIR=C:/path/to/enhanced/dubbing/runtime
DUBBING_SCRIPT_ARG_MODE=detect

# smoke only
DUBBING_ALLOW_PASSTHROUGH_TRANSLATION=false
DUBBING_ALLOW_PLACEHOLDER_TTS=false
```

正式本地化应配置翻译 provider 和 MiniMax TTS。`DUBBING_ALLOW_PASSTHROUGH_TRANSLATION` 与 `DUBBING_ALLOW_PLACEHOLDER_TTS` 只用于 smoke，不代表可交付成片。

## 快速开始

### 1. 启动 Web

```powershell
pnpm install
pnpm db:init
pnpm dev
```

访问：

```text
http://localhost:8899
```

### 2. 检查闭环准备度

打开 `/ingest` 或请求：

```http
GET /api/ingest/dubbing-readiness
```

readiness 会检查：

- YouTube / 本地来源读取。
- ASR 与时间码。
- 翻译凭证。
- MiniMax TTS 凭证。
- 声线元数据与披露是否可审计。
- 可选口型同步组件。

`production_ready` 表示真实运行链路可跑，不等于交付审计已完整。响应会额外返回 `runtime_ready`、`runtime_readiness_level`、`delivery_audit_ready` 和 `delivery_audit`。其中 `voice_metadata` warning 不阻断 smoke 或真实运行，但会让 `delivery_audit_ready=false`；正式交付前应补齐声线注册表、用途和披露元数据。

同一响应会返回 `provider_gates[]` normal form：每个 gate 都包含 `runtime`、`provider`、`capability`、`run_mode`、`risk` 和 `confirmation`。`run_mode=dry_run` 只代表可验证流程结构；`run_mode=real` 且 `confirmation.required=true` 时，真实 provider smoke 前必须明确确认外部访问或可能费用。

确认 ID 的正常形集中在 `provider-gate-confirmation`：

| 边界 | 入口 | source 字段 | 确认 gate |
| --- | --- | --- | --- |
| `dry_run_provider_smoke` | `POST /api/ingest/dubbing-readiness`, `mode="dry_run"` | 普通探测不需要；作为真实 provider smoke 前置证据时必须传同一 `source_url`，服务端只保存 `source_ref` | 不传 `confirmed_gate_ids` |
| `real_provider_smoke` | 内部 API endpoint: `POST /api/ingest/dubbing-readiness`, 先 `mode="real_provider_smoke_preflight"` 取得 server-side `provider_smoke_run_permit`，再 `mode="real_provider_smoke"`；CLI 执行入口: `pnpm provider-smoke:armed-run` | 确认 ID 不是执行授权；CLI armed-run 必须保留 `provider_smoke_preflight_receipt` / `PROVIDER_SMOKE_PREFLIGHT_RECEIPT_FILE` 作为 operator handoff；API route 本身不读取 receipt，必须校验同 scope 的 server-side `provider_smoke_run_permit`、`job_id`、`source_url`、同一 `job_id` 已有通过且 `required_real_provider_gates` 全 real 的 source-bound dry-run evidence，并且服务端先写入 DB-backed attempt reservation | `youtube_download`, `translation_provider`, `minimax_tts` |
| `dubbing_job` | `POST /api/dubbing` | `video_url` 或 `source_job_id + source_artifact_id` | 只允许 `translation_provider`, `minimax_tts` |

真实 provider smoke 的 `youtube_download` gate 不能迁移到普通配音任务；`source_url` 也只属于 provider smoke，不是 `/api/dubbing` 的配音源字段。

直调 POST 仅限 `mode="dry_run"`；`real_provider_smoke` 只能由 `provider-smoke:armed-run` 在 receipt 校验后发起。普通结构探测只使用 dry-run：

```http
POST /api/ingest/dubbing-readiness
Content-Type: application/json

{ "mode": "dry_run" }
```

默认 `dry_run` 只验证 gate normal form 和本地 readiness，不调用 YouTube、Gemini 或 MiniMax。响应会带 `audit`，记录本次模式、总体 verdict、外部调用状态、gate 计数和主要阻断项。请求带 `job_id` 时，同一份 audit 会写入该任务日志，后续 `GET /api/jobs/:id` 可通过 `providerSmokeAudit` 读取最新记录。若 dry-run rehearsal 用于真实 provider smoke 前置证据，必须同时提交同一 `source_url`，服务端只保存 `source_ref.host + url_sha256`。

用于真实 provider smoke 的 no-paid dry-run evidence 还必须证明 `required_real_provider_gates`：`youtube_download`、`translation_provider`、`minimax_tts` 三个 gate 全部存在且 `run_mode=real`。这只是能力/配置证明，不代表 dry-run 调用了 provider；若任一 gate 仍是 `run_mode=dry_run`、fallback、placeholder、blocked 或缺失，后续 readiness bundle、handoff verifier、preflight 和 API route 都必须 fail closed。

真实 provider smoke 不提供裸 JSON 快捷入口；必须使用 `docs/agent/testing/dynamic/local-api.md` 或 `docs/agent/testing/dynamic/cloud-api.md` 的 armed-run SOP：同一个 `job_id` 先有通过的 source-bound dry-run evidence，并用 `pnpm provider-smoke:evidence:check -- --job "${DRY_RUN_PROVIDER_SMOKE_AUDIT_JOB_ID}" --require-ready-dry-run --source-url "${DRY_RUN_PROVIDER_SMOKE_SOURCE_URL}" --max-age-ms "${DRY_RUN_PROVIDER_SMOKE_EVIDENCE_MAX_AGE_MS}"` 只读复核 latest server evidence 的 `source_ref_match=true`、`fresh_enough=true` 和 `required_real_provider_gates` 全部 `run_mode=real`，再设置 `ALLOW_PAID_DYNAMIC_TESTS=true`、预算上限、总 runs 上限和并发上限、`source_url`、完整 `confirmed_gate_ids`、`PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE`、`PROVIDER_SMOKE_PREFLIGHT_RECEIPT_FILE` 和 NDJSON 证据日志。`runs <= max_runs`，`concurrency <= max_concurrency`；`runs` 可以大于 `max_concurrency` 并由 armed-run 按批次执行。服务端在任何 provider call 前必须先通过 `real_provider_smoke_preflight` 签发同 scope 的 `provider_smoke_run_permit`，再原子写入 DB-backed attempt reservation：`job_logs.details.provider_smoke_attempt_reservation`，包含 `reservation_id`、`status=started|completed|failed`、`reserved_at`、`expires_at`（即 `lease_expires_at`）、`source_ref`、`runtime_fingerprint` 和 policy；`reservation_id` 是 lease token / fencing token。`provider_smoke_run_permit` 响应只暴露 `type=provider_smoke_run_permit`、`permit_id`、`command_hash`、`issued_at`、`expires_at`、`source_ref`、`provider_calls_authorized=false`，真实请求只提交 `{ permit_id, command_hash }`；服务端保存的 permit 通过 `auth_principal` 与 `command_binding` 绑定 `job_id`、`source_ref`、`runtime_fingerprint`、`required_real_provider_gates`、`manual_authorization`、预算、runs/concurrency 和 confirmed gates。缺失、过期、hash mismatch 或 scope mismatch 时，`real_provider_smoke` 必须在 provider call 前 fail closed。reservation must be acquired before provider call，且不得退回 file-only or memory-only concurrency；reservation 事务会重新读取 latest ready dry-run epoch，并在同一事务内确认 `runtime_fingerprint`、`source_ref`、freshness 和 run permit 仍匹配。若 dry-run epoch 被更新、变成 blocked、source mismatch、stale 或 required real gate mismatch，返回 `PROVIDER_SMOKE_ARMED_DRY_RUN_EVIDENCE_REQUIRED`，且不调用 provider。reservation 只统计 latest dry-run epoch 之后的 attempt，`reserved_at >= dry_run_checked_at` 会被保守计入，过期 lease 不占 active 并发但仍计入 started run/budget。真实 audit 会携带 `attempt_reservation_id`，避免 audit 与 reservation 重复计数。人工授权 JSON 先用本地 no-network 命令 `pnpm provider-smoke:manual-auth:prepare -- --confirmed-by "<operator>"` 生成；该命令只读 dry-run evidence、校验 source/runtime/budget 并写授权文件，不读 token、不访问 API 或 provider；若 token、paid gate 或 stress gate 已存在，或者授权文件会覆盖 dry-run evidence、preflight receipt、readiness/handoff archive 或 armed-run log，会 fail closed 且不写授权文件。随后用 `pnpm provider-smoke:readiness:bundle` 生成 redacted readiness 报告，再运行 no-paid / no-network `pnpm provider-smoke:handoff:verify`（同义别名：`pnpm provider-smoke:pressure-plan`，会输出 `alias_boundary.no_paid_alias=true`）审查 `provider_smoke_paid_handoff_verifier` / `no_paid_handoff_pressure_plan`；可选 `PROVIDER_SMOKE_HANDOFF_VERIFY_FILE` / `PROVIDER_SMOKE_HANDOFF_VERIFY_MARKDOWN_FILE` 只是 `no_paid_handoff_pressure_plan_archive`，stdout 仍是 canonical contract。报告 `ok=true` 只允许人工确认，不授权 provider call，也不得直接运行 `provider-smoke:armed-run`；报告中的 `manual_confirmation_inputs` 必须显示 source hash、runs/concurrency/budget、外部 provider 范围、声线使用边界、`raw_source_url_must_be_checked_outside_report=true` 和 `api_key_or_voice_id_presence_is_not_authorization=true`。原始 `REAL_PROVIDER_SMOKE_SOURCE_URL` 必须由 operator 在本机 shell / 安全记录中核对，报告只允许复制 host / `url_sha256`。人工确认后才可设置 paid/stress gates 并运行 `provider-smoke:armed-run:preflight`。本机 preflight 写出 machine-bound `provider_smoke_preflight_receipt`，receipt 绑定 `command_hash`、`machine_binding`、source-bound dry-run evidence、`manual_authorization`、预算、runtime 和 required real gate proof；可选 `pnpm provider-smoke:receipt:verify` 只做本机 no-network receipt 状态复核，输出 `provider_smoke_preflight_receipt_verification` 和 `receipt_authorization_boundary.provider_calls_authorized=false`，不读取 token、不访问 provider、不写 armed NDJSON。armed-run 必须读取同机 receipt；通过后先调用 server-side `real_provider_smoke_preflight` 取得 `provider_smoke_run_permit`，再把 `{ permit_id, command_hash }` 提交给 `real_provider_smoke`。receipt 缺失、过期、搬到另一台机器、command hash mismatch，或 permit 缺失、过期、hash/scope mismatch，都会在任何 provider 请求前 fail closed。生成的 `manual_authorization` 必须绑定确认人、确认时间、同一 `job_id`、同一 `source_ref`、runs/concurrency/budget 和固定确认项；dry-run evidence、run permit 与每轮真实响应都必须校验 `runtime_fingerprint` / `audit.runtime_fingerprint`。真实 provider 调用一旦开始，provider 抛错、HTTP 非 2xx、超时、响应 JSON 损坏或 runtime/source mismatch 也必须进入 durable attempt / partial ledger；失败记录只能保存 `partial_ledger_record=true`、脱敏 failure 摘要、`source_ref`、runtime 和预算信息，不得记录 token、原始 source URL、完整 provider response 或完整 NDJSON。

执行面边界正常形：API route 不读取 receipt 文件、不校验 `PROVIDER_SMOKE_PREFLIGHT_RECEIPT_FILE`、不保存 receipt，也不接受 receipt 作为 request 字段；route 直调必须依赖服务端 env gate、服务端 command binding、`manual_authorization`、source-bound dry-run evidence、server-side `provider_smoke_run_permit`、DB-backed attempt reservation、ledger/concurrency/budget gates 和 job 权限。CLI receipt 只保护 operator 本机 `provider-smoke:armed-run` command path，且 `receipt_authorization_boundary.provider_calls_authorized=false` 直到 operator 显式执行 armed-run；它是 operator handoff，不是 API route 的唯一授权来源。文档不得提供裸 `real_provider_smoke` curl 作为执行入口。

长期 audit 不保存完整来源 URL，只保存来源 host 与 URL SHA-256，避免把测试链接或查询参数写入任务日志。

### 3. 素材吸收

在 `/ingest` 输入 YouTube URL、本地视频路径或本地音频路径。系统会生成 transcript artifacts，并在适合本地化时保留 canonical source video。

如果来源是 YouTube 或远端视频，应先走 `/ingest`，再从工作台进入 `/dubbing`。

### 4. 创建配音任务

进入 `/dubbing`，确认：

- 来源视频或 source job。
- 目标语言。
- 翻译风格与语言风格。
- 固定读法 / 词库。
- 主声线与可选第二声线。
- 声线用途、授权状态、公众人物属性和披露要求。
- 是否启用样片模式。
- 是否启用口型同步。

提交前页面会显示本次将套用的长期资产。正式任务必须确认本次声线使用。

## API 创建任务

使用 `/api/dubbing`：

下面示例只展示请求 body normal form。真实执行会调用外部翻译/MiniMax provider 并可能产生费用；动态测试命令必须先完成人工费用确认并设置 `ALLOW_PAID_DYNAMIC_TESTS=true`。普通 dubbing job 只使用 `video_url` 或 `source_job_id + source_artifact_id`，不得混入 provider smoke 专用的 `source_url` 或 `youtube_download` gate。

```http
POST /api/dubbing
Content-Type: application/json

{
  "video_url": "C:/videos/source.mp4",
  "source_language": "en",
  "target_language": "cantonese",
  "voice_id": "voice-main",
  "lipsync_mode": "none",
  "config": {
    "usage_boundary_acknowledged": true,
    "translation_style": "localized_script",
    "confirmed_gate_ids": ["translation_provider", "minimax_tts"],
    "speaker_mode": "single",
    "creator_context": {
      "language_style": "自然香港粤语，保留原片事实，不加入原片没有的信息。"
    },
    "localization_glossary": [
      { "source": "Wave59", "target": "Wave五十九", "note": "固定产品读法" }
    ]
  }
}
```

也可以从 ingest job handoff：

```http
POST /api/dubbing
Content-Type: application/json

{
  "source_job_id": "ingest-job-id",
  "source_artifact_id": "ingest.source_video",
  "target_language": "mandarin",
  "config": {
    "usage_boundary_acknowledged": true,
    "translation_style": "conversational",
    "confirmed_gate_ids": ["translation_provider", "minimax_tts"]
  }
}
```

## 声线管理

MiniMax 声线元数据以 `MiniMaxVoiceRegistryEntry` 为 normal form。`voice_id` 是 registry map key；核心、存储和 API 响应使用 snake_case，设置页和 `/api/dubbing/voices` 的保存输入使用 camelCase command object 后再归一化。

每条声线应记录：

- `voice_id`：MiniMax voice_id。
- `display_name`、`speaker_aliases`、`applicable_people`：展示名、讲者别名、适用人物。
- `languages`、`gender`：语言与声线性别。
- `category`：`creator_owned`、`authorized_clone`、`public_figure_commentary`、`synthetic_narration`、`generic`。
- `clone_origin`：`minimax_clone`、`minimax_builtin`、`manual_voice_id`、`system_default`。
- `clone_source`、`cloned_at`、`clone_cost_usd`：克隆来源、克隆日期、一次性克隆成本记录。
- `authorization_proof`：授权证明或内部记录引用。
- `public_figure`、`authorized`、`requires_disclosure`：公众人物、本地授权声明与披露边界；`authorized` 不是 MiniMax 或平台验证。
- `usage_label`、`notes`、`priority`：用途说明、维护备注和选择优先级。

设置页的 MiniMax 声线编辑器只维护本地 registry，不会触发真实 TTS、声线克隆或付费验证。`authorization_proof` 是本地审计记录，不会替代每次任务的 `usage_boundary_acknowledged`，也不会覆盖公众人物披露要求；授权克隆若缺少 `authorization_proof`，系统会继续按需披露处理。历史 `voice_usage_confirmed` 仅作为兼容字段读取。

系统不会通过音频自动识别某位人物的身份。自动匹配只根据任务里已有的讲者提示，以及 registry 中人工维护的 `display_name`、`speaker_aliases` 和 `applicable_people`。

### 自有或有本地授权记录的声线

创作者本人、团队成员或已明确授权的声线可以登记为自有或授权克隆。MiniMax 克隆声线建议设置 `clone_origin: minimax_clone`，并补充 `clone_source`、`cloned_at`、`clone_cost_usd` 和 `authorization_proof`。这些都是本地授权记录，不代表 MiniMax 或平台验证；创建每个配音任务时仍需要确认本次声线使用边界。

### 公众人物评论/转译声线

公众人物声线只能用于翻译、评论、批评或明确标注的转化。Registry 应设置：

- `public_figure: true`
- `requires_disclosure: true`
- `category: public_figure_commentary`
- `clone_origin: minimax_clone`
- `applicable_people` 记录实际适用人物
- `usage_label` 明确说明是 AI 翻译配音 / 非本人原声

交付 README、QA 和 report 会继续提示披露要求。

### 通用旁白声线

不需要匹配具体讲者时，可登记 MiniMax 通用男声、女声或中性旁白声线。MiniMax 内置声线使用 `clone_origin: minimax_builtin`；手动粘贴但未验证来源的 voice_id 使用 `clone_origin: manual_voice_id`。建议写清语言、性别和用途，方便服务端自动选择。

## 多讲者

多讲者任务可设置：

- `speaker_mode: auto`
- `secondary_voice_id`
- per-speaker registry alias / `applicable_people`

QA 会检查疑似多讲者但缺少第二声线的情况。若使用公众人物或未登记声线，仍按保守披露处理。

## 样片到全片

建议先用 60-180 秒样片检查：

- 翻译口吻。
- 专名、数字、年份读法。
- 声线匹配。
- 节奏密度。
- 口型同步是否值得开启。

QA 通过后，用样片资产快照提升到全片。这样可以避免全片 TTS 成本发生后才发现长期规则未套用。

## 产物与交付

配音任务完成后，交付包会统一提供：

- final video。
- `script.txt`。
- `translations.json`。
- `segments.json`。
- QA JSON。
- `delivery-readme.md`。
- report / compare / QA 入口。

最终视频下载只接受 canonical `final.mp4` 或 `final_with_bgm.mp4`。中间产物不会作为交付下载项。

交付包会附带 `deliveryAuditReadiness`，把成片文件、`delivery-readme.md`、QA JSON、声线披露和人工终听收敛成同一份交付审计状态。`ready` 表示这些交付入口、披露元数据和终听确认都已齐全；如果成片不可下载、声线披露未知或终听未完成，report、QA 和 job detail 会显示阻断或待补项。

人工终听是自动 QA 之后的最终听感确认，不改变自动 QA 分数。未记录人工终听会让 `deliveryAuditReadiness` 保持待补；记录后按同一张状态表进入交付审计：

| 人工终听状态 | 交付证据 | 交付审计影响 |
| --- | --- | --- |
| 未记录 | 未记录 | 交付审计待补；交付前需完成终听或明确豁免 |
| `pending` / 待终听 | 需复核 | 交付审计待补；交付前仍需完成或明确豁免 |
| `passed` / 通过 | 已确认 | 交付审计就绪 |
| `failed` / 未通过 | 阻断 | 交付审计阻断；需返修或重新确认 |
| `waived` / 豁免 | 需复核 | 交付审计待补；发布前需确认豁免原因可接受 |

## 成本边界

- MiniMax 凭证可以先 `save_only` 加密保存可选的验证用 `voice_id`，这不会调用 MiniMax，也不会标记为已验证；正式配音默认声线仍由 creator profile、本地声线注册表或单次请求决定。
- MiniMax 凭证验证和 TTS 验证必须显式确认；`verify_and_save` 需要 `confirmPaidVerification: true` 和服务端 `ALLOW_PAID_DYNAMIC_TESTS=true`。
- MiniMax 声线克隆是一次性成本，完成后可长期复用同一 `voice_id`。
- `clone_cost_usd` 只是 registry 中的一次性克隆成本记录，不进入单次配音任务成本计算。
- 样片模式用于先验证规则、声线和节奏，再决定是否跑全片。
- 不要在未确认授权、披露和用途的情况下批量创建正式 TTS 任务。

## 常见问题

### 支持哪些语言？

源语言取决于 ASR 能力。目标语言优先支持普通话、粤语和主流语言；具体效果取决于翻译 provider、语言风格和词库质量。

### 没有 GPU 能用吗？

可以做非口型同步链路。ASR、合成和 Wav2Lip 的速度会取决于本机环境。没有 Wav2Lip 时，任务仍可输出配音和字幕。

### 如何确认声线适合某位讲者？

先把讲者别名、适用人物、语言、性别、授权状态和披露要求写入 registry。创建任务时不要手动强行指定未知 `voice_id`，让服务端按讲者提示、通用声线和默认声线策略选择。当前系统不会从音频声纹自动判断“这是谁”。

### 如何处理名人视频？

先确认用途是翻译、评论、批评或明确标注的转化。使用相关声线时必须登记为公众人物相关声线，并在发布、剪辑交接或二次分发时保留 AI 翻译配音 / 非本人原声披露。

### 口型同步效果不好怎么办？

优先确认人脸清晰、正面、无遮挡。若素材不适合口型同步，可关闭 lip sync，只交付配音和字幕版本。
