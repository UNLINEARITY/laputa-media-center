-- Migration 003: 添加多视频混剪支持
-- 创建时间：2025-10-18
-- 版本：v0.3.7

-- ========== jobs 表新增字段 ==========

-- job_type: 任务类型（single_video | multi_video）
ALTER TABLE jobs ADD COLUMN job_type TEXT DEFAULT 'single_video'
  CHECK(job_type IN ('single_video', 'multi_video'));

-- input_videos: JSON 数组，存储多个视频的 URL、标签、元数据
-- 格式示例：[{"file_url": "...", "label": "橘猫厨师", "description": "...", "metadata": {...}}]
ALTER TABLE jobs ADD COLUMN input_videos TEXT;

-- remix_mode: 混剪方案类型
ALTER TABLE jobs ADD COLUMN remix_mode TEXT
  CHECK(remix_mode IN ('story_driven', 'theme_driven', 'visual_optimized'));

-- remix_config: JSON 格式的混剪配置（剧情大纲、分镜数量等）
-- 格式示例：{"story_structure": "开场 → 介绍 → 使用", "storyboard_count": 6}
ALTER TABLE jobs ADD COLUMN remix_config TEXT;

-- ========== scenes 表新增字段 ==========

-- source_video_index: 来源视频在 input_videos 数组中的索引（多视频任务使用）
ALTER TABLE scenes ADD COLUMN source_video_index INTEGER;

-- source_video_label: 来源视频的用户自定义标签（多视频任务使用）
ALTER TABLE scenes ADD COLUMN source_video_label TEXT;

-- ========== 索引优化 ==========

-- 为多视频任务添加索引
CREATE INDEX IF NOT EXISTS idx_jobs_job_type ON jobs(job_type);
CREATE INDEX IF NOT EXISTS idx_scenes_source_video ON scenes(job_id, source_video_index);
