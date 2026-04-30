-- ============================================================
-- 数据库 Schema（项目版本 16.0.0）
-- 完整的工作流引擎数据库结构
-- ============================================================

-- ============================================================
-- 数据库版本表（Schema Version）
-- 用于追踪数据库 Schema 版本，支持自动迁移检测
-- ============================================================
CREATE TABLE IF NOT EXISTS schema_version (
    version TEXT PRIMARY KEY,      -- 当前版本号（如 "10.0.0"）
    applied_at INTEGER NOT NULL    -- 应用时间戳
);

-- 插入初始版本记录
INSERT OR IGNORE INTO schema_version (version, applied_at)
VALUES ('16.0.0', strftime('%s', 'now') * 1000);

-- ============================================================
-- 任务表（Jobs）
-- ============================================================
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
    current_step TEXT CHECK(current_step IN ('analysis', 'generate_narrations', 'extract_scenes', 'process_scenes', 'compose', 'asr', 'translate', 'voiceclone', 'lipsync', 'ingest', 'transcribe', 'package')),

    -- 单视频字段
    input_url TEXT,
    style_id TEXT,
    style_name TEXT,  -- 风格名称（创建时快照，避免风格删除后显示"未知风格"）
    config TEXT NOT NULL,

    -- 任务类型。single_video / multi_video 仅保留历史读取兼容；新任务由 jobsRepo.create 显式写入主线类型。
    job_type TEXT DEFAULT 'content_ingest' CHECK(job_type IN ('single_video', 'multi_video', 'translation_dubbing', 'content_ingest')),
    input_videos TEXT,  -- JSON 数组
    remix_mode TEXT CHECK(remix_mode IN ('story_driven', 'theme_driven', 'visual_optimized')),
    remix_config TEXT,  -- JSON

    -- 状态信息
    error_message TEXT,
    error_metadata TEXT,  -- JSON 格式的错误元数据（category, userGuidance）

    -- 外部 API 相关字段
    source TEXT DEFAULT 'web',  -- 任务来源 ('web' | 'api')
    api_token_id TEXT,          -- 创建任务的 API Token ID
    webhook_url TEXT,           -- Webhook 回调地址
    webhook_secret TEXT,        -- Webhook 签名密钥

    -- 时间戳
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    started_at INTEGER,
    completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_job_type ON jobs(job_type);

-- ============================================================
-- 旧的分镜表（Scenes）- 向后兼容
-- 注意：scenes 表已废弃，使用 job_scenes 替代

-- ============================================================
-- API密钥表
-- ============================================================
CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service TEXT UNIQUE NOT NULL,
    key_data TEXT NOT NULL,
    is_verified INTEGER DEFAULT 0,
    verified_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- ============================================================
-- 配置表
-- ============================================================
CREATE TABLE IF NOT EXISTS configs (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

-- ============================================================
-- 结构化数据表（Structured Data）
-- ============================================================

-- 任务视频表
CREATE TABLE IF NOT EXISTS job_videos (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    video_index INTEGER NOT NULL,

    label TEXT NOT NULL,
    title TEXT,
    description TEXT,

    original_url TEXT NOT NULL,
    local_path TEXT,              -- AI Studio 本地文件路径（FFmpeg 用）
    gcs_https_url TEXT,
    gcs_gs_uri TEXT,
    gemini_uri TEXT,

    metadata TEXT,
    analysis_prompt TEXT,
    analysis_response TEXT,  -- Gemini 分析响应（用于多轮对话）

    -- 新增字段（通过 migration 010 添加）
    storyboards TEXT,        -- 分镜脚本数组（JSON）
    total_duration REAL,     -- 视频总时长（秒）

    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,

    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_job_videos_job_id ON job_videos(job_id);
CREATE INDEX IF NOT EXISTS idx_job_videos_index ON job_videos(job_id, video_index);

-- 分镜表（增强版）
CREATE TABLE IF NOT EXISTS job_scenes (
    id TEXT PRIMARY KEY CHECK(id GLOB '*-scene-[1-9]*'),  -- 验证复合 ID 格式 "{jobId}-scene-{N}"
    job_id TEXT NOT NULL,
    scene_index INTEGER NOT NULL CHECK(scene_index >= 0),  -- 确保非负

    source_video_index INTEGER NOT NULL,
    source_video_label TEXT NOT NULL,
    source_start_time TEXT NOT NULL,
    source_end_time TEXT NOT NULL,

    duration_seconds REAL NOT NULL,
    narration_script TEXT NOT NULL,
    use_original_audio INTEGER DEFAULT 0,

    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed')),

    split_video_url TEXT,
    gcs_video_url TEXT,
    adjusted_video_url TEXT,
    final_video_url TEXT,

    selected_audio_url TEXT,
    audio_duration REAL,
    speed_factor REAL,

    metadata TEXT,

    -- 新增字段（通过 migration 010 添加）
    split_duration REAL,     -- 拆条视频时长（秒）
    final_metadata TEXT,     -- 最终视频元数据（JSON）

    -- 预生成旁白字段（v11.2 新增）
    narration_v1 TEXT,       -- 旁白版本1
    narration_v2 TEXT,       -- 旁白版本2
    narration_v3 TEXT,       -- 旁白版本3
    failure_reason TEXT,     -- 失败原因

    -- 跳切修剪字段（v12.2 新增）
    trimmed_video_url TEXT,  -- 修剪后视频路径
    trimmed_start REAL DEFAULT 0,  -- 开头裁剪秒数
    trimmed_end REAL DEFAULT 0,    -- 结尾裁剪秒数
    trimmed_duration REAL,   -- 修剪后时长

    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    started_at INTEGER,
    completed_at INTEGER,

    is_skipped INTEGER DEFAULT 0,
    control_updated_at INTEGER,

    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
    UNIQUE(job_id, scene_index)  -- 防止同一任务的场景索引重复
);

CREATE INDEX IF NOT EXISTS idx_job_scenes_job_id ON job_scenes(job_id);
-- UNIQUE(job_id, scene_index) 约束自动创建唯一索引，不需要 idx_job_scenes_index
CREATE INDEX IF NOT EXISTS idx_job_scenes_status ON job_scenes(job_id, status);
CREATE INDEX IF NOT EXISTS idx_job_scenes_control ON job_scenes(job_id, is_skipped);

-- 音频候选表
CREATE TABLE IF NOT EXISTS scene_audio_candidates (
    id TEXT PRIMARY KEY,
    scene_id TEXT NOT NULL,
    candidate_index INTEGER NOT NULL CHECK(candidate_index >= 0),  -- 确保非负

    narration_text TEXT NOT NULL,
    narration_length INTEGER NOT NULL,

    audio_url TEXT NOT NULL,
    audio_duration REAL,

    speed_factor REAL,
    diff_from_1_0 REAL,
    is_selected INTEGER DEFAULT 0,

    metadata TEXT,

    created_at INTEGER NOT NULL,

    FOREIGN KEY (scene_id) REFERENCES job_scenes(id) ON DELETE CASCADE,
    UNIQUE(scene_id, candidate_index)  -- 防止同一场景的候选索引重复
);

-- 复合索引覆盖单列索引，不需要额外创建 idx_scene_audio_candidates_scene
CREATE INDEX IF NOT EXISTS idx_scene_audio_candidates_selected ON scene_audio_candidates(scene_id, is_selected);

-- API调用记录表
CREATE TABLE IF NOT EXISTS api_calls (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    scene_id TEXT,

    service TEXT NOT NULL,
    operation TEXT NOT NULL,
    platform TEXT,

    request_params TEXT,
    request_timestamp INTEGER NOT NULL,

    response_data TEXT,
    response_timestamp INTEGER,

    duration_ms INTEGER,

    status TEXT CHECK(status IN ('pending', 'success', 'failed', 'retry')),
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,

    token_usage TEXT,
    file_size INTEGER,
    raw_response TEXT,  -- AI 服务原始响应（用于排查解析失败）

    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (scene_id) REFERENCES job_scenes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_api_calls_job_id ON api_calls(job_id);
CREATE INDEX IF NOT EXISTS idx_api_calls_service ON api_calls(service, request_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_api_calls_status ON api_calls(status);
-- 复合索引：按服务和状态查询（用于成本统计分析）
CREATE INDEX IF NOT EXISTS idx_api_calls_service_status ON api_calls(service, status, request_timestamp DESC);

-- 步骤历史表
CREATE TABLE IF NOT EXISTS job_step_history (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    scene_id TEXT,

    major_step TEXT NOT NULL CHECK(major_step IN ('analysis', 'generate_narrations', 'extract_scenes', 'process_scenes', 'compose', 'asr', 'translate', 'voiceclone', 'lipsync', 'ingest', 'transcribe', 'package')),
    sub_step TEXT NOT NULL,
    step_type TEXT,

    status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'completed', 'failed', 'skipped')),

    attempt INTEGER DEFAULT 1,
    retry_delay_ms INTEGER,

    started_at INTEGER,
    completed_at INTEGER,
    duration_ms INTEGER,

    error_message TEXT,

    -- 语义清晰的三个数据字段
    input_data TEXT,      -- 步骤输入参数 (gemini_uris, enriched_videos等)
    step_metadata TEXT,   -- 步骤元数据 (stepNumber, stageNumber等)
    output_data TEXT,     -- 步骤输出结果

    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (scene_id) REFERENCES job_scenes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_job_step_history_job_id ON job_step_history(job_id, started_at);
CREATE INDEX IF NOT EXISTS idx_job_step_history_major_step ON job_step_history(major_step);
CREATE INDEX IF NOT EXISTS idx_job_step_history_status ON job_step_history(status);
CREATE INDEX IF NOT EXISTS idx_job_step_history_step_type ON job_step_history(job_id, step_type);
CREATE INDEX IF NOT EXISTS idx_job_step_history_attempt ON job_step_history(job_id, sub_step, attempt);
-- 复合索引：按任务+大步骤+状态查询（用于步骤统计分析）
CREATE INDEX IF NOT EXISTS idx_job_step_history_stats ON job_step_history(job_id, major_step, status);

-- 任务当前状态表
CREATE TABLE IF NOT EXISTS job_current_state (
    job_id TEXT PRIMARY KEY,
    current_major_step TEXT,
    current_sub_step TEXT,
    step_context TEXT,
    total_scenes INTEGER DEFAULT 0,
    processed_scenes INTEGER DEFAULT 0,
    final_video_url TEXT,
    final_video_public_url TEXT,
    final_video_gs_uri TEXT,
    final_video_local_path TEXT,
    final_video_metadata TEXT,
    updated_at INTEGER NOT NULL,

    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_job_current_state_job_id ON job_current_state(job_id);

-- ============================================================
-- 任务日志表
-- ============================================================
CREATE TABLE IF NOT EXISTS job_logs (
    id TEXT PRIMARY KEY,
    job_id TEXT,  -- 允许为空（支持独立日志）

    -- 日志分类
    log_type TEXT NOT NULL CHECK(log_type IN (
        'step_input',      -- 步骤输入
        'step_output',     -- 步骤输出
        'api_call',        -- API 调用开始
        'api_response',    -- API 响应结束
        'error',           -- 错误日志
        'warning',         -- 警告日志
        'info'             -- 信息日志
    )),
    log_level TEXT NOT NULL CHECK(log_level IN ('debug', 'info', 'warn', 'error')),

    -- 步骤关联
    major_step TEXT,           -- 大步骤 ID（如 analysis）
    sub_step TEXT,             -- 小步骤 ID（如 fetch_metadata）
    scene_id TEXT,             -- 分镜 ID（可选，用于循环步骤）
    step_number INTEGER,       -- 步骤全局编号
    stage_number INTEGER,      -- 阶段编号

    -- 日志内容
    message TEXT NOT NULL,     -- 日志消息（如 "📥 输入: 获取视频元数据"）
    details TEXT,              -- JSON 格式的详细数据

    -- API 调用专用字段
    service_name TEXT,         -- 服务名称（Gemini、FishAudio、FFmpeg）
    operation TEXT,            -- 操作名称（generateContent、synthesize、split）
    api_duration_ms INTEGER,   -- API 调用耗时（毫秒）

    -- 时间戳
    created_at INTEGER NOT NULL,

    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_job_logs_job_id ON job_logs(job_id, created_at);
CREATE INDEX IF NOT EXISTS idx_job_logs_type ON job_logs(log_type);
CREATE INDEX IF NOT EXISTS idx_job_logs_step ON job_logs(major_step, sub_step);
CREATE INDEX IF NOT EXISTS idx_job_logs_level ON job_logs(log_level);

-- ============================================================
-- 分布式锁表
-- ============================================================
CREATE TABLE IF NOT EXISTS distributed_locks (
    lock_key TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    acquired_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_distributed_locks_expires_at ON distributed_locks(expires_at);

-- ============================================================
-- 鉴权系统表
-- ============================================================

-- 用户表（单用户模式）
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 单用户约束：只允许一条记录
CREATE UNIQUE INDEX IF NOT EXISTS idx_single_user ON users ((1));

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- API 访问令牌表
CREATE TABLE IF NOT EXISTS api_access_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  is_active INTEGER DEFAULT 1,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_access_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_access_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_api_tokens_active ON api_access_tokens(user_id, is_active);

-- ============================================================
-- API Token 表（无用户版本，用于简化的 Token 管理）
-- ============================================================
CREATE TABLE IF NOT EXISTS api_tokens (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER,
    expires_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_token_hash ON api_tokens(token_hash);
