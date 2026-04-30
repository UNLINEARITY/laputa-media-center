-- Migration 001: 创建结构化数据表
-- 用于保存工作流每个步骤的详细输出数据
-- 向后兼容：不修改现有表，仅新增表

-- ============================================================
-- 表 1: job_videos（任务视频表）
-- 用途：存储每个输入视频的元数据和 URL
-- ============================================================
CREATE TABLE IF NOT EXISTS job_videos (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    video_index INTEGER NOT NULL,

    -- 基本信息
    label TEXT NOT NULL,  -- "video-1", "video-2", ...
    title TEXT,
    description TEXT,

    -- URL（多个阶段）
    original_url TEXT NOT NULL,
    gcs_https_url TEXT,  -- Vertex AI 模式
    gcs_gs_uri TEXT,     -- Vertex AI 模式
    gemini_uri TEXT,     -- 用于 Gemini API 的 URI

    -- 元数据（JSON）
    metadata TEXT,  -- VideoMetadata 结构（时长、分辨率、fps 等）

    -- 时间戳
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,

    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_job_videos_job_id ON job_videos(job_id);
CREATE INDEX IF NOT EXISTS idx_job_videos_index ON job_videos(job_id, video_index);

-- ============================================================
-- 表 2: job_scenes（分镜表 - 增强版）
-- 用途：存储每个分镜从 Step 1 到 Step 3 的所有产物
-- ============================================================
CREATE TABLE IF NOT EXISTS job_scenes (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    scene_index INTEGER NOT NULL,
    scene_id TEXT NOT NULL,

    -- 来源信息
    source_video_index INTEGER NOT NULL,
    source_video_label TEXT NOT NULL,
    source_start_time TEXT NOT NULL,
    source_end_time TEXT NOT NULL,

    -- 分镜属性
    duration_seconds REAL NOT NULL,
    narration_script TEXT NOT NULL,
    use_original_audio INTEGER DEFAULT 0,  -- 0=配音, 1=原声

    -- 处理状态
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed')),

    -- URL（多个阶段）
    split_video_url TEXT,      -- Step 2: NCA 拆条后
    gcs_video_url TEXT,        -- Step 2: GCS 迁移后（Vertex）
    adjusted_video_url TEXT,   -- Step 3: 调速后（配音分镜）
    final_video_url TEXT,      -- Step 3: 最终合成

    -- 音频（配音分镜）
    selected_audio_url TEXT,
    audio_duration REAL,
    speed_factor REAL,

    -- 元数据（JSON）
    metadata TEXT,

    -- 时间戳
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    started_at INTEGER,
    completed_at INTEGER,

    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_job_scenes_job_id ON job_scenes(job_id);
CREATE INDEX IF NOT EXISTS idx_job_scenes_index ON job_scenes(job_id, scene_index);
CREATE INDEX IF NOT EXISTS idx_job_scenes_scene_id ON job_scenes(scene_id);
CREATE INDEX IF NOT EXISTS idx_job_scenes_status ON job_scenes(job_id, status);

-- ============================================================
-- 表 3: scene_audio_candidates（音频候选表）
-- 用途：保存每个分镜的 3 个旁白和音频候选
-- ============================================================
CREATE TABLE IF NOT EXISTS scene_audio_candidates (
    id TEXT PRIMARY KEY,
    scene_id TEXT NOT NULL,  -- 关联 job_scenes.id
    candidate_index INTEGER NOT NULL,  -- 0=v1, 1=v2, 2=v3

    -- 旁白文本
    narration_text TEXT NOT NULL,
    narration_length INTEGER NOT NULL,

    -- 音频信息
    audio_url TEXT NOT NULL,
    audio_duration REAL,

    -- 匹配分析
    speed_factor REAL,  -- 需要的调速因子
    in_speed_range INTEGER,  -- 0=超出范围, 1=在范围内
    diff_from_1_0 REAL,  -- 与 1.0 的差值
    is_selected INTEGER DEFAULT 0,  -- 0=未选中, 1=选中

    -- 元数据（JSON）
    metadata TEXT,  -- Fish Audio 原始响应

    created_at INTEGER NOT NULL,

    FOREIGN KEY (scene_id) REFERENCES job_scenes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_scene_audio_candidates_scene ON scene_audio_candidates(scene_id);
CREATE INDEX IF NOT EXISTS idx_scene_audio_candidates_selected ON scene_audio_candidates(scene_id, is_selected);

-- ============================================================
-- 表 4: api_calls（API 调用记录表）
-- 用途：记录所有外部 API 调用，支持成本核算和性能分析
-- ============================================================
CREATE TABLE IF NOT EXISTS api_calls (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    scene_id TEXT,  -- 可选，分镜级别的调用

    -- 服务信息
    service TEXT NOT NULL,  -- 'Gemini', 'FishAudio', 'NCA', 'GCS'
    operation TEXT NOT NULL,  -- '视频分析', '生成旁白', '批量拆条', ...
    platform TEXT,  -- 'vertex', 'ai-studio'（Gemini）

    -- 请求信息
    request_params TEXT,  -- JSON
    request_timestamp INTEGER NOT NULL,

    -- 响应信息
    response_data TEXT,  -- JSON（精简版）
    response_timestamp INTEGER,

    -- 性能
    duration_ms INTEGER,  -- 耗时（毫秒）

    -- 状态
    status TEXT CHECK(status IN ('pending', 'success', 'failed', 'retry')),
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,

    -- 额外数据
    token_usage TEXT,  -- JSON: {input: 123, output: 456}（Gemini）
    file_size INTEGER,  -- 字节（GCS 上传）

    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (scene_id) REFERENCES job_scenes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_api_calls_job_id ON api_calls(job_id);
CREATE INDEX IF NOT EXISTS idx_api_calls_service ON api_calls(service, request_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_api_calls_status ON api_calls(status);

-- ============================================================
-- 表 5: nca_jobs（NCA 任务详情表）
-- 用途：统一管理所有 NCA 任务，支持性能统计
-- ============================================================
CREATE TABLE IF NOT EXISTS nca_jobs (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    scene_id TEXT,  -- 可选

    -- NCA 任务信息
    nca_job_id TEXT NOT NULL,  -- NCA 返回的任务 ID
    operation TEXT NOT NULL,  -- 'split', 'adjust_speed', 'merge', 'concatenate'

    -- 请求参数（JSON）
    request_params TEXT NOT NULL,

    -- 响应数据（JSON）
    response_data TEXT,

    -- 状态
    status TEXT CHECK(status IN ('pending', 'processing', 'completed', 'failed')),

    -- 输出
    output_url TEXT,
    output_metadata TEXT,  -- JSON

    -- 性能
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    completed_at INTEGER,
    duration_ms INTEGER,

    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (scene_id) REFERENCES job_scenes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_nca_jobs_job_id ON nca_jobs(job_id);
CREATE INDEX IF NOT EXISTS idx_nca_jobs_nca_id ON nca_jobs(nca_job_id);
CREATE INDEX IF NOT EXISTS idx_nca_jobs_operation ON nca_jobs(operation, created_at DESC);

-- ============================================================
-- 表 6: job_step_history（步骤历史表 - 规范化版本）
-- 用途：替代 checkpoint.stepHistory，支持 SQL 查询
-- ============================================================
CREATE TABLE IF NOT EXISTS job_step_history (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    scene_id TEXT,  -- 可选，分镜循环步骤需要

    -- 步骤信息
    major_step TEXT NOT NULL CHECK(major_step IN ('analysis', 'extract_scenes', 'process_scenes', 'compose')),
    sub_step TEXT NOT NULL,

    -- 状态
    status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'completed', 'failed', 'skipped')),

    -- 时间戳
    started_at INTEGER,
    completed_at INTEGER,
    duration_ms INTEGER,

    -- 错误信息
    error_message TEXT,

    -- 元数据（JSON）
    metadata TEXT,

    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (scene_id) REFERENCES job_scenes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_job_step_history_job_id ON job_step_history(job_id, started_at);
CREATE INDEX IF NOT EXISTS idx_job_step_history_major_step ON job_step_history(major_step);
CREATE INDEX IF NOT EXISTS idx_job_step_history_status ON job_step_history(status);
