# 重试机制与错误处理

## 当前主线

本文档描述当前 `content_ingest` 与 `translation_dubbing` 主线的重试语义。旧 Gemini 视频分析、storyboard/File API 上传、`BatchFormatError` 已随旧剪辑 runtime 下架，不再作为当前排障路径；历史任务日志里若出现这些名称，只按归档兼容信息读取。

当前失败处理按四层 normal form 排查：

```text
API 入口限流
  -> 工作流步骤重试
  -> 外部工具/服务自身恢复能力
  -> manifest 与任务级重跑/续跑
```

---

## 重试策略汇总

| 层级 | 机制 | 默认策略 | 适用场景 | 失败后状态 |
| --- | --- | --- | --- | --- |
| API 入口 | route rate limit | 返回 `429` 与 `Retry-After` | `/api/ingest`、`/api/dubbing`、`/api/jobs/*`、设置页验证接口 | 请求未入队，用户稍后重试 |
| 工作流步骤 | `WorkflowEngine.executeStep()` | `DEFAULT_RETRY`：3 次，1s 起步，按 `2 ** (attempt - 1)` 退避 | ASR、翻译、TTS、合成、发布等 step 抛出可重试错误 | step 标记失败，job 标记 failed |
| 通用短重试 | `withRetry()` | 3 次，1s 起步，2x 指数退避 | 仍在用 helper 包裹的网络/超时/5xx 调用 | 抛出最后一次错误 |
| 大文件下载 | `downloadWithResume()` | HEAD 最多 5 次；下载最多 20 次，60s 固定间隔 | 远端媒体下载、可 Range 的大文件 | 下载失败并保留错误信息 |
| 数据库事务 | `withTransaction()` | 3 次，100ms 起步，指数退避 | SQLite 短暂锁竞争 | 抛出事务错误 |
| 任务级重跑 | `/dubbing?fromJob=...` 预填 | 创建新 `translation_dubbing` job | QA 修版、样片转全片、声线/语言/唇同步配置调整 | 新任务独立追踪 |
| 断点续跑 | `WorkflowEngine.resume()` | 从已记录的 current stage 继续 | 进程中断或运维手动恢复 | 继续失败点之后的 stage |

注意：`RetryPolicy.backoffMultiplier` 类型字段仍存在，但当前 engine 实际使用固定 `2 ** (attempt - 1)` 计算步骤级延迟。

---

## 可重试错误判断

`lib/utils/retry.ts` 提供两个通用原语：

- `withRetry(fn, options)`：包裹单次异步调用，按 `maxAttempts`、`delayMs`、`backoff` 和 `shouldRetry` 决定是否重试。
- `isRetryableError(error)`：识别短等待可恢复错误。

`isRetryableError()` 覆盖的主要模式：

| 类别 | 示例 |
| --- | --- |
| 网络错误 | `network`、`fetch failed`、`ECONNRESET`、`ECONNREFUSED`、`ETIMEDOUT`、`ENOTFOUND` |
| 超时 | `timeout`、`timed out`、`request timeout` |
| 服务器临时失败 | `500`、`502`、`503`、`504`、`internal server error`、`service unavailable` |
| 上游临时不可用 | `deadline exceeded`、`unavailable`、`service temporarily unavailable` |
| 解析类临时失败 | `json parse`、`unexpected token`、`invalid json` |

`429` 不属于短等待错误。API route 会直接返回 `Retry-After`；仍保留的 Gemini 配置测试 helper 有自己的 429 rate limiter，但它只服务配置连通性检查，不代表旧视频分析主线恢复。

---

## Content Ingest 排障

`content_ingest` 的目标是把 YouTube URL、本地视频或本地音频变成可复用素材与 transcript artifacts。

| 步骤 | 主要依赖 | 可重试问题 | 不应自动重试的问题 | 排查重点 |
| --- | --- | --- | --- | --- |
| source classification | route 入参、SourceClassifier | 无明显外部依赖 | URL/本地路径格式不合法、目标不支持 | 检查 `source`、`ingest_goal`、本地路径是否存在 |
| local/source validation | 文件系统、URL 探测 | 临时网络失败、远端 5xx | 本地文件不存在、扩展名/协议不支持 | 看 step input 与错误日志 |
| extract audio/video | `ffmpeg`、`yt-dlp` | YouTube 临时失败、下载中断、网络超时 | `ffmpeg`/`yt-dlp` 不存在、媒体损坏、无权限读取 | 检查 `INGEST_FFMPEG_EXE`、`INGEST_YTDLP_EXE`、PATH |
| transcribe media | Whisper CLI/Python | 子进程临时失败、输出暂不可读 | Whisper 未安装、模型不存在、音频为空 | 检查 `INGEST_PYTHON_EXE`、`INGEST_WHISPER_CLI`、`INGEST_WHISPER_MODEL` |
| write artifacts | `WorkflowArtifactManifest`、`OUTPUT_DIR` | 短暂文件锁 | manifest 路径不安全、输出目录不可写 | artifact API 以 manifest 为权威来源 |

成功后 transcript artifacts 写入 `OUTPUT_DIR/ingest/{jobId}/`，并在 manifest 中记录：

- `ingest.transcript_markdown`
- `ingest.transcript_json`
- `ingest.transcript_srt`
- `ingest.source_audio`
- `ingest.source_video`（只有 canonical source video 成功产出时写入）

manifest 条目存在但不安全时，不应静默回退到旧路径。

---

## Translation Dubbing 排障

`translation_dubbing` 的目标是把外语视频转成普通话或粤语配音成片。主线依赖 ASR、翻译、MiniMax TTS、可选 lip sync、FFmpeg 合成和最终发布。

| 步骤 | 主要依赖 | 可重试问题 | 不应自动重试的问题 | 排查重点 |
| --- | --- | --- | --- | --- |
| resolve source | 本地路径、URL、ingest handoff | 临时网络/读取失败 | `fromJob` 不是已完成 ingest localize 任务、manifest 缺少 `ingest.source_video` | 优先看 manifest，不把旧 artifact URL 当权威 |
| ASR | dubbing Python/Whisper bridge | 子进程临时失败、输出文件短暂不可读 | Python/Whisper 缺失、视频无音轨 | 检查 `DUBBING_PYTHON_EXE`、脚本输出 |
| translate text | translator bridge/provider | 网络/5xx/临时 JSON 解析失败 | 语言参数不被脚本支持且处于 strict 模式 | 检查 `DUBBING_SCRIPT_ARG_MODE` 与 `translations.json` |
| generate voice | MiniMax voice / fallback bridge | MiniMax 网络/5xx、TTS 临时失败 | API Key 无效、voice_id 不可用、未确认声线使用边界 | 检查 MiniMax 设置、`usage_boundary_acknowledged` |
| lip sync | Wav2Lip 或外部 dubbing skill | GPU/子进程临时失败 | 脚本不存在、模型文件缺失、输入视频不可读 | 可关闭 lip sync 先产出配音版 |
| compose final | `ffmpeg` | 文件锁、临时编码失败 | `ffmpeg` 缺失、输入音视频路径不存在 | 检查 step artifact 路径与中间文件 |
| publish final video | final path + manifest | 文件锁、复制失败 | canonical final path 不可写 | 只把 `final.mp4`/`final_with_bgm.mp4` 作为交付成片 |

关键 manifest normal form：

- `dubbing.segments`
- `dubbing.translations`
- `dubbing.tts_audio`
- `final_video`

`compose_final` 的 `${jobId}_dubbed.mp4` 是中间产物；最终交付由 `publish_final_video` 发布到 canonical final path 后再写入 `final_video`。

---

## 任务重跑语义

重跑不是原地覆盖旧 job，而是创建新 job，保留旧任务供 QA、compare、report 使用。

| 入口 | 语义 | 适用场景 |
| --- | --- | --- |
| QA 修版重跑 | 从旧 dubbing job 读取源、语言、声线、唇同步等参数，并附带 QA revision notes | 翻译不自然、声线不合适、字幕/节奏需要微调 |
| 样片转全片 | 样片完成后创建 full run，并带上样片资产快照 | 先低成本验证，再跑完整视频 |
| 目标语言切换 | Mandarin/Cantonese 互切并保留来源 | 同一原片做不同中文版本 |
| 手动续跑 | `WorkflowEngine.resume()` 从中断 stage 继续 | 运维处理进程中断、机器重启、短暂故障 |

重跑必须继续遵守声音安全边界：使用创作者自有、有本地授权记录或清晰标注的合成声线；创建配音 job 的 API/UI 路径应保留声线使用边界确认。

---

## 快速排查清单

1. 先看 job status、当前 stage、失败 step 和 step output。
2. 再看 manifest：ingest/dubbing/final video 是否存在 canonical artifact。
3. 如果是源文件问题，确认本地路径、URL、`yt-dlp`、`ffmpeg`。
4. 如果是 ASR/翻译/TTS，确认 Python bridge、脚本参数模式、MiniMax 凭证与 voice_id。
5. 如果是 429，遵循 route 返回的 `Retry-After`，不要把它当作 step 内短重试。
6. 如果是 QA 后修版，使用重跑入口创建新任务，不直接改旧任务 artifacts。
7. 如果旧日志里出现 Gemini storyboard、File API 或 `BatchFormatError`，只按历史任务兼容信息阅读；当前主线不再排查这些 runtime。

---

## 相关文件索引

```text
lib/utils/retry.ts                         # 通用 withRetry / isRetryableError
lib/workflow/engine.ts                     # step 级重试、resume、任务状态流转
lib/workflow/types.ts                      # DEFAULT_RETRY / RetryPolicy
lib/media/utils/download.ts                # 大文件断点续传下载
lib/db/core/transaction.ts                 # SQLite 事务重试
lib/workflow/workflows/content-ingest.ts   # content_ingest 主线定义
lib/workflow/workflows/translation-dubbing.ts # translation_dubbing 主线定义
lib/jobs/dubbing-rerun.ts                  # QA 重跑、样片转全片 URL contract
lib/exporters/error-analyzer.ts            # report/export 错误建议
```
