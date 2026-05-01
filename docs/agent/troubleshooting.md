# 故障排查

## 常见问题

### 授权相关

#### 授权码验证失败

**症状**：启动时报 403 错误

**排查**：
1. v1.0.0 默认 `LICENSE_KEY` 可留空（health check 标记 `mode=local_dev`），如出现 403 先确认是不是真的需要付费授权
2. 如有付费授权码：检查格式 `CCUT-{8-14字符}-{4字符}`（CCUT 前缀是历史 artifact，validator 仍用此 prefix 校验）
3. 检查授权码是否过期

#### Session 失效

**症状**：登录后很快需要重新登录

**排查**：
1. 检查 `SESSION_SECRET` 是否正确配置
2. Session 有效期固定为 7 天（代码内置，不可配置）

### 数据库相关

#### 数据库初始化失败

**排查**：
```bash
# 手动初始化
pnpm db:init

# 检查数据库文件权限
ls -la data/db.sqlite
```

#### 数据库锁定

**症状**：`SQLITE_BUSY` 错误

**排查**：
1. 确认没有多个进程同时写入
2. 检查 WAL 模式是否启用

### 翻译 Provider 相关

#### 翻译凭证或模型不可用

**症状**：`translate_text` 失败、提示 Gemini 翻译凭证缺失，或指定模型不可用

**排查**：
1. 在 `/settings` 确认 Google AI Studio 或 Vertex 凭证已保存；保存不等于真实 provider 验证
2. 在 `/api/dubbing/status` 或 `/api/ingest/dubbing-readiness` 查看 `translation_credential_status.verification_state`
3. 检查模型 ID 是否为当前运行时支持的文本模型，例如 `gemini-2.5-flash-lite`
4. 只在明确允许真实 provider 调用时执行 Gemini 连通性测试，并设置 `ALLOW_PAID_DYNAMIC_TESTS=true`

#### 历史 Gemini File API 排障

旧剪辑系统的“上传视频到 Gemini / File API / 分镜分析”已下架，不作为当前素材吸收或翻译配音主线排障入口。历史任务只做读取兼容；当前视频来源问题应优先检查 `yt-dlp`、`ffmpeg`、Whisper 和 manifest artifact。

### FFmpeg 相关

#### FFmpeg 处理失败

**症状**：音频抽取、转码、字幕封装或配音成片合成失败

**排查**：
1. 检查 `OUTPUT_DIR`、`temp/jobs/{jobId}` 或 ingest 输出目录权限
2. 确认 FFmpeg 可执行：`ffmpeg -version`
3. 查看详细日志：`LOG_LEVEL=debug`
4. 检查磁盘空间：`df -h /tmp` 或对应 Windows 输出盘
5. 对 ingest 任务确认 `ingest.source_audio`、`ingest.source_video` manifest 是否存在；对 dubbing 任务确认 `dubbing.tts_audio` 和 `final_video` manifest 是否存在

## 调试技巧

### 启用详细日志

```bash
LOG_LEVEL=debug
ENABLE_DEBUG_LOGS=true
```

### 查看任务日志

```bash
# API 方式
curl http://localhost:8899/api/jobs/{job_id}/logs

# 数据库查询
sqlite3 data/db.sqlite "SELECT * FROM job_logs WHERE job_id = 'xxx' ORDER BY created_at DESC LIMIT 100"
```

### 检查任务状态

```sql
-- 当前状态
SELECT * FROM job_current_state WHERE job_id = 'xxx';

-- 步骤历史
SELECT * FROM job_step_history WHERE job_id = 'xxx' ORDER BY created_at;
```

### 查看 API 调用记录

```sql
SELECT * FROM api_calls WHERE job_id = 'xxx' ORDER BY created_at DESC;
```

## 任务控制

### 任务状态说明

| 状态 | 说明 | 是否终态 |
|-----|------|---------|
| `pending` | 待处理 | 否 |
| `processing` | 执行中 | 否 |
| `completed` | 已完成 | **是** |
| `failed` | 已失败 | **是** |

### 停止任务

> **注意**：v12.1.0 起已移除停止任务功能。任务启动后会持续执行直到完成或失败。
>
> 如需中止任务，可以删除任务（见下方），系统会自动清理相关资源。

### 删除任务

```bash
curl -X DELETE http://localhost:8899/api/jobs/{job_id}
```

### 手动清理（仅用于开发调试）

```sql
-- 清理步骤历史
DELETE FROM job_step_history WHERE job_id = 'xxx';

-- 重置任务状态（不推荐在生产环境使用）
UPDATE jobs SET status = 'pending', error_message = NULL WHERE id = 'xxx';
```
