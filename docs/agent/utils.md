# 工具函数

## 核心工具速查表

| 模块 | 文件 | 功能 | 关键导出 |
|------|------|------|---------|
| logger | `lib/utils/logger.ts` | 三通道日志系统 | `logStep`, `logStepInput`, `logApiCall` |
| retry | `lib/utils/retry.ts` | 重试机制 | `withRetry()`, `isRetryableError()` |
| template-engine | `lib/utils/template-engine.ts` | 模板引擎 | `TemplateEngine` |
| error-classifier | `lib/utils/error-classifier.ts` | 错误分类 | `ErrorClassifier.classify()` |
| time | `lib/utils/time.ts` | 时间戳处理 | `formatDuration()`, `parseTimestamp()` |
| json-helpers | `lib/utils/json-helpers.ts` | JSON 安全处理 | `safeJsonParse()`, `parseJsonWithSchema()` |

## 日志系统

### 三通道架构

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  控制台日志      │    │  数据库日志      │    │  文件日志        │
│  (开发调试)      │    │  (job_logs 表)   │    │  (logs/ 目录)    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         ↑                     ↑                     ↑
         └─────────────────────┼─────────────────────┘
                               │
                        ┌──────────────┐
                        │   Logger     │
                        │  (统一入口)   │
                        └──────────────┘
```

### 使用方式

```typescript
import { logStep, logStepInput, logStepOutput, logApiCall, logApiResponse } from '@/lib/utils/logger'

// 步骤日志
logStep(jobId, 'asr', 'asr_transcribe', 'started', '开始语音转文本')
logStepInput(jobId, 'asr', 'asr_transcribe', { source: 'local-video.mp4' })
logStepOutput(jobId, 'asr', 'asr_transcribe', { segmentCount: 12 })

// API 调用日志
logApiCall(jobId, 'MiniMax', 'generateSpeech', { voiceId: 'voice-id' })
logApiResponse(jobId, 'MiniMax', 'generateSpeech', 'success', { duration: 12.4 })
```

### 自动脱敏

Logger 自动脱敏敏感信息：
- API Key → `****`
- 密码 → `****`
- Token → `****`
- 服务账号 JSON → `[REDACTED]`

## 重试机制

### withRetry()

```typescript
import { withRetry } from '@/lib/utils/retry'

const result = await withRetry(
  async () => {
    // 可能失败的操作
    return await fetchData()
  },
  {
    maxAttempts: 3,           // 最大重试次数
    delayMs: 1000,            // 基础延迟（ms）
    backoff: 2,               // 退避倍数
    shouldRetry: (error) => isRetryableError(error),
    onRetry: (attempt, error) => {
      console.log(`重试 ${attempt}/${3}`)
    }
  }
)
```

### isRetryableError()

```typescript
import { isRetryableError } from '@/lib/utils/retry'

if (isRetryableError(error)) {
  // 可以重试：网络超时、速率限制、临时服务不可用等
}
```

内置 30+ 种可重试错误模式：
- 网络错误：`ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`, `fetch failed`
- HTTP 状态码：`408`, `429`, `500`, `502`, `503`, `504`
- Gemini 特定：`RESOURCE_EXHAUSTED`, `DEADLINE_EXCEEDED`
- JSON 解析错误：`unexpected token`, `invalid json`

## 模板引擎

### TemplateEngine

```typescript
import { TemplateEngine } from '@/lib/utils/template-engine'

// 创建实例
const engine = new TemplateEngine({ debug: true, onMissing: 'empty' })

// 基础渲染
const result = engine.render('你好 {{name}}', { name: 'Laputa' })
// → '你好 Laputa'

// 嵌套对象访问
engine.render('项目：{{config.name}}', { config: { name: 'LaputaMediaCenter' } })
// → '项目：LaputaMediaCenter'
```

## 错误分类

### ErrorClassifier.classify()

```typescript
import { ErrorClassifier } from '@/lib/utils/error-classifier'

const { category, isRetryable, userGuidance, metadata } = ErrorClassifier.classify(error)
```

### 错误类型（category）

| 类型 | 含义 | 处理建议 |
|------|------|---------|
| `retryable` | 可重试错误 | 自动重试或稍后再试 |
| `config` | 配置错误 | 检查 API Key、环境变量 |
| `input` | 输入错误 | 检查视频格式、URL 有效性 |
| `system` | 系统错误 | 联系管理员 |
| `unknown` | 未知错误 | 查看详细日志 |

### 辅助方法

```typescript
// 获取用户友好的错误消息
ErrorClassifier.getUserFriendlyMessage(error)  // → string
```

### Gemini 特定错误

```typescript
// 自动识别 Gemini 错误模式
// - SAFETY：内容被安全过滤阻止
// - RECITATION：版权内容检测
// - BLOCKLIST：黑名单词汇
// - QUOTA_EXCEEDED：配额用尽
```

## 时间戳处理

### formatDuration()

```typescript
import { formatDuration, parseTimestamp, calculateDuration } from '@/lib/utils/time'

// 格式化时长
formatDuration(3661.5)  // → '01:01:01.500'

// 解析时间戳（支持多种格式）
parseTimestamp('01:30:00')     // → 5400
parseTimestamp('00:01:30.500') // → 90.5
parseTimestamp('90.5')         // → 90.5

// 计算时长
calculateDuration('00:00:10', '00:01:00') // → 50
```

### 支持的格式

- `HH:MM:SS.ms` - 完整格式
- `MM:SS.ms` - 省略小时
- `SS.ms` - 纯秒数
- FFmpeg 时间戳格式

## JSON 安全处理

### safeJsonParse()

```typescript
import { safeJsonParse, safeJsonStringify, parseJsonWithSchema } from '@/lib/utils/json-helpers'

// 安全解析（失败返回默认值）
const data = safeJsonParse(jsonString, { default: [] })

// 安全序列化（处理循环引用）
const str = safeJsonStringify(obj)

// 带 Zod Schema 验证
import { z } from 'zod'
const schema = z.object({ name: z.string() })
const validated = parseJsonWithSchema(jsonString, schema)
```

## 其他工具

| 模块 | 功能 |
|------|------|
| `api-client.ts` | 统一 API 客户端，解决 Zeabur 自调用问题 |
| `file-cleaner.ts` | 清理任务临时文件和过期文件 |
| `api-response.ts` | 禁用缓存的响应工具 |
| `fetch-client.ts` | 前端 fetch 封装，带超时和取消支持 |
| `disk-check.ts` | 磁盘空间检查，前置检测防止处理中途失败 |
| `download-file.ts` | 文件下载工具，带重试机制 |
| `scene-id-utils.ts` | 历史分镜 ID 格式转换工具 |
| `timestamp-normalizer.ts` | 时间戳格式规范化；`normalizeStoryboardTimestamps` 仅用于历史分镜兼容 |
| `cn.ts` | Tailwind CSS className 合并工具 |
| `fs-utils.ts` | 文件系统工具（目录创建等） |
| `video-mime.ts` | 视频 MIME 类型检测 |
| `error-helpers.ts` | 错误处理辅助函数 |
| `log-formatter.ts` | 日志格式化工具 |

### noCacheResponse()

```typescript
import { noCacheResponse } from '@/lib/utils/api-response'

// 创建禁用缓存的 JSON 响应
export async function GET() {
  const data = await fetchRealtimeData()
  return noCacheResponse({ success: true, data })
}
```

适用场景：任务状态、日志、配置等需要实时数据的 API 端点。

## 前端工具

### fetchWithTimeout()

```typescript
import { fetchWithTimeout, createCancellableFetch } from '@/lib/utils/fetch-client'

// 带超时的 fetch（默认 30 秒）
const response = await fetchWithTimeout('/api/jobs/123', {}, 60000)

// 可取消的 fetch（用于组件卸载）
useEffect(() => {
  const { promise, cancel } = createCancellableFetch('/api/jobs/123')
  promise.then(res => res.json()).then(setData)
  return () => cancel() // 组件卸载时取消请求
}, [])
```

### cn()

```typescript
import { cn } from '@/lib/utils/cn'

// 合并 Tailwind CSS 类名（自动去重和覆盖）
cn('px-4 py-2', 'px-6')  // → 'py-2 px-6'
cn('text-red-500', isActive && 'text-blue-500')
```

## 磁盘空间检查

### ensureDiskSpace()

```typescript
import { ensureDiskSpace, getAvailableSpace, formatBytes } from '@/lib/utils/disk-check'

// 前置检查磁盘空间（空间不足时抛出错误）
await ensureDiskSpace(outputDir, videoSizeBytes)

// 获取可用空间
const available = await getAvailableSpace('/data/output')
console.log(formatBytes(available))  // → '15.2 GB'
```

## 时间戳规范化

### normalizeTimestamp()

```typescript
import { normalizeTimestamp, normalizeStoryboardTimestamps } from '@/lib/utils/timestamp-normalizer'

// 处理外部工具返回的不规范时间戳
normalizeTimestamp('01:57.500')    // → '00:01:57.500'
normalizeTimestamp('1:30:45.200')  // → '01:30:45.200'
normalizeTimestamp('00:05:30')     // → '00:05:30.000'

// 历史兼容：批量处理旧分镜时间戳
const normalized = normalizeStoryboardTimestamps(storyboard)
```

## 历史分镜 ID 工具

### scene-id-utils

`scene-id-utils` 只用于历史剪辑任务读取和旧数据兼容。新增主线逻辑应优先使用 job id、artifact id、manifest key 或 workflow step id，不要把 storyboard/scene id 作为新的正常形。

```typescript
import { buildCompositeSceneId, extractPureSceneId, extractSceneIndex } from '@/lib/utils/scene-id-utils'

// 构建复合 ID
buildCompositeSceneId('job_123', 0)  // → 'job_123-scene-1'

// 提取纯格式 ID
extractPureSceneId('job_123-scene-1')  // → 'scene-1'

// 提取场景索引
extractSceneIndex('job_123-scene-1')  // → 0
```

## 文件下载

### downloadFile()

```typescript
import { downloadFile } from '@/lib/utils/download-file'

// 下载文件到本地（带自动重试）
await downloadFile('https://example.com/video.mp4', '/tmp/video.mp4')
```
