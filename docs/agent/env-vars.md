# 环境变量

## 必需变量

```bash
DATABASE_URL=file:./data/db.sqlite
LICENSE_KEY=CCUT-XXXXXXXX-XXXX           # 联系Laputa工作流获取
```

授权码格式：`CCUT-{8-14字符}-{4字符}`

## 系统密钥（自动管理）

```bash
ENCRYPTION_KEY=<自动生成>  # API 密钥加密（64 字符十六进制）
SESSION_SECRET=<自动生成>  # Session 签名（64 字符十六进制）
```

**优先级**：环境变量 > 数据库 configs 表 > 首次启动自动生成

**密钥处理**：
- 64 位十六进制字符串 → 直接使用
- 其他格式 → SHA-256 哈希转换为 32 字节

## 可选变量

### 鉴权配置

```bash
AUTH_ENABLED=true           # 生产环境设为 true
```

> **AUTH_ENABLED 默认行为**：未设置或空值时默认为 `true`（安全优先）
>
> **支持值**：`true`/`1`/`yes`/`on`/`enabled` 或 `false`/`0`/`no`/`off`/`disabled`
>
> **Session 有效期**：代码硬编码为 7 天（`lib/auth/config.ts:70`）

### 文件目录

```bash
RUNTIME_DIR=/tmp/chuangcut   # 运行时数据根目录（默认）
TEMP_DIR=/tmp/chuangcut/temp  # 临时文件目录
OUTPUT_DIR=/tmp/chuangcut/output  # 输出文件目录
```

> **重要**：本地开发时，运行时目录默认使用 `/tmp/chuangcut`（系统临时目录）
>
> **原因**：Next.js 16 Turbopack 无法排除监听目录，如果 output/temp 在项目内，
> 工作流产生的大量文件会触发重编译导致 CPU 飙升。详见 `lib/utils/paths.ts`
>
> **日志目录**：硬编码为 `./logs`（`lib/utils/logger.ts:87`），环境变量不生效

### 日志配置

```bash
LOG_LEVEL=info              # debug | info | warn | error
ENABLE_DEBUG_LOGS=false     # 启用详细中间状态日志
LOG_FILE_ENABLED=true       # 启用文件日志（默认启用）
```

### 运行时配置

```bash
NODE_OPTIONS=--max-old-space-size=4096  # Node.js 内存限制（开发/生产环境自动设置）
```

### 翻译配音配置

```bash
GEMINI_API_KEY=                 # 当前主线翻译凭证，也可使用 GOOGLE_AI_STUDIO_API_KEY
GOOGLE_AI_STUDIO_API_KEY=       # Gemini AI Studio 翻译凭证
GEMINI_MODEL_ID=                # 可选，翻译模型
GEMINI_API_BASE_URL=            # 可选，自定义 Gemini-compatible API Base URL，优先于 GOOGLE_AI_STUDIO_API_BASE_URL
GOOGLE_AI_STUDIO_API_BASE_URL=  # 可选，自定义 Gemini-compatible API Base URL
MINIMAX_API_KEY=                # MiniMax TTS 凭证
MINIMAX_VERIFICATION_VOICE_ID=  # 可选，凭证付费验证用测试声线
# MINIMAX_DEFAULT_VOICE_ID=     # 旧兼容别名，不作为正式配音默认声线
DUBBING_ALLOW_PASSTHROUGH_TRANSLATION=false  # 仅 smoke：允许无 Gemini 时原文占位
DUBBING_ALLOW_PLACEHOLDER_TTS=false           # 仅 smoke：允许无 MiniMax 时静音占位
LEGACY_TTS_ENABLED=false       # 默认关闭旧 Fish/Edge TTS 兼容运行时
```

正式本地化需要 Gemini 翻译凭证、MiniMax TTS 凭证和已确认用途/披露要求的正式 `voice_id`。
正式声线来自 `/dubbing` 请求、MiniMax 声线注册表或创作者资产默认声线；MiniMax 凭证里的验证用 voice_id 不参与正式声线选择。
`DUBBING_ALLOW_PASSTHROUGH_TRANSLATION` 与 `DUBBING_ALLOW_PLACEHOLDER_TTS` 只用于无付费 smoke，不应作为生产交付配置。
旧 Fish/Edge TTS 只保留历史兼容读取和排查；默认 `LEGACY_TTS_ENABLED=false` 时 `/api/tts/voices`、`/api/tts/verify-voice` 以及 Fish Audio 凭证写入/验证都会返回 `410 LEGACY_TTS_DISABLED`，不会加载或调用旧 provider。只有显式设置 `LEGACY_TTS_ENABLED=true` 后，旧兼容验证才会继续要求 legacy confirmation、paid confirmation 和 `ALLOW_PAID_DYNAMIC_TESTS=true`。

`/api/ingest/dubbing-readiness` 会在 `translation_credential_status.runtime` 中展示实际会使用的 Gemini key 来源、模型来源和 API Base URL 来源；该字段只显示来源和模型 ID，不返回 API key。环境变量优先级是 `GEMINI_API_KEY` > `GOOGLE_AI_STUDIO_API_KEY`，`GEMINI_API_BASE_URL` > `GOOGLE_AI_STUDIO_API_BASE_URL`。

Google Vertex 与 Google Cloud Storage 凭证当前由设置页加密保存，runtime adapter 不读取
`GOOGLE_APPLICATION_CREDENTIALS`、`GOOGLE_CLOUD_PROJECT` 或 `GCS_BUCKET`。这些旧环境变量即使存在，也不会让设置页或 readiness 显示 `not_tracked`。

### 跨域配置

```bash
CORS_ALLOWED_ORIGINS=https://example.com,https://app.example.com
```

**说明**：
- 多个域名用逗号分隔，不要有空格
- 不设置时默认允许同源请求
- 生产环境建议明确设置允许的域名列表

### 客户端变量

```bash
NEXT_PUBLIC_BASE_URL=       # API 基础 URL（Client Component 使用）
NEXT_PUBLIC_APP_LOGO=       # 自定义 Logo URL（可选）
```

> **NEXT_PUBLIC_BASE_URL**：本地开发留空或设为 `http://localhost:8899`，Zeabur 部署时自动设置为 `${ZEABUR_WEB_URL}`

## Zeabur 部署环境

### 用户配置

| 变量 | 说明 |
|------|------|
| `LICENSE_KEY` | 软件授权码（必填） |

### 自动生成

| 变量 | 类型 |
|------|------|
| `ENCRYPTION_KEY` | PASSWORD（自动生成） |
| `SESSION_SECRET` | PASSWORD（自动生成） |

### 系统默认

| 变量 | 默认值 | 备注 |
|------|--------|------|
| `DATABASE_URL` | `file:/data/db.sqlite` | 必需 |
| `AUTH_ENABLED` | `true` | 安全优先 |
| `TEMP_DIR` | `/data/temp` | Docker 路径 |
| `OUTPUT_DIR` | `/data/output` | Docker 路径 |

> **硬编码值**（环境变量不生效）：
> - Session 有效期：7 天
> - 日志目录：`./logs`

## 本地开发 .env.local 示例

```bash
# 授权系统
LICENSE_KEY=CCUT-XXXXXXXX-XXXX

# 数据库
DATABASE_URL=file:./data/db.sqlite

# 加密密钥（可选，会自动生成）
ENCRYPTION_KEY=your-encryption-key

# 鉴权（开发环境可关闭）
AUTH_ENABLED=false

# 文件目录
TEMP_DIR=./temp
OUTPUT_DIR=./output

# 日志级别
LOG_LEVEL=debug
ENABLE_DEBUG_LOGS=true
```
