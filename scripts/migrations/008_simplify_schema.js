/**
 * 数据库迁移：简化 Schema（方案B）
 * v8.0.0 - 删除冗余表和字段，实施业务表+日志表双轨制架构
 */

const Database = require('better-sqlite3')
const path = require('node:path')
const fs = require('node:fs')

function migrate() {
  const dbPath = path.join(__dirname, '../../data/db.sqlite')

  // 检查数据库文件是否存在
  if (!fs.existsSync(dbPath)) {
    console.error(`❌ 数据库文件不存在: ${dbPath}`)
    process.exit(1)
  }

  console.log(`📦 开始数据库迁移: ${dbPath}`)
  console.log('────────────────────────────────────────')

  const db = new Database(dbPath)

  try {
    // 开启事务
    db.exec('BEGIN TRANSACTION')

    // ============================================================
    // 步骤1：删除冗余表
    // ============================================================
    console.log('\n🗑️  步骤1: 删除冗余表...')

    const tablesToDrop = [
      'scenes', // 旧版分镜表
      'api_calls', // 与 job_logs 功能重复
      'workflow_instances', // 未使用
      'configs', // 未使用
      'scene_audio_candidates', // 数据迁移到 job_logs.details
    ]

    for (const table of tablesToDrop) {
      try {
        db.exec(`DROP TABLE IF EXISTS ${table}`)
        console.log(`  ✅ 已删除表: ${table}`)
      } catch (error) {
        console.log(`  ⚠️  跳过表（不存在）: ${table}`)
      }
    }

    // ============================================================
    // 步骤2：简化 jobs 表
    // ============================================================
    console.log('\n📝 步骤2: 简化 jobs 表...')

    // 检查 jobs 表是否存在
    const jobsTableExists = db
      .prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='jobs'
    `)
      .get()

    if (jobsTableExists) {
      // 获取当前表结构
      const jobsColumns = db.prepare('PRAGMA table_info(jobs)').all()
      const columnNames = jobsColumns.map((c) => c.name)

      // 创建新表（只保留需要的字段）
      db.exec(`
        CREATE TABLE jobs_new (
          id TEXT PRIMARY KEY,
          job_type TEXT DEFAULT 'single_video' CHECK(job_type IN ('single_video', 'multi_video')),
          status TEXT NOT NULL CHECK(status IN ('pending', 'queued', 'processing', 'paused', 'completed', 'failed')),

          input_videos TEXT NOT NULL,
          style_id TEXT,
          config TEXT NOT NULL,

          error_message TEXT,
          retry_count INTEGER DEFAULT 0,

          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          started_at INTEGER,
          completed_at INTEGER
        )
      `)

      // 迁移数据（只复制存在的字段）
      const selectFields = [
        'id',
        'job_type',
        'status',
        'input_videos',
        'style_id',
        'config',
        'error_message',
        'retry_count',
        'created_at',
        'updated_at',
        'started_at',
        'completed_at',
      ].filter((field) => columnNames.includes(field))

      db.exec(`
        INSERT INTO jobs_new (${selectFields.join(', ')})
        SELECT ${selectFields.join(', ')}
        FROM jobs
      `)

      // 删除旧表，重命名新表
      db.exec('DROP TABLE jobs')
      db.exec('ALTER TABLE jobs_new RENAME TO jobs')

      // 重建索引
      db.exec('CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)')
      db.exec('CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC)')
      db.exec('CREATE INDEX IF NOT EXISTS idx_jobs_job_type ON jobs(job_type)')

      console.log(
        '  ✅ jobs 表简化完成（删除了 input_url, current_step, remix_mode, remix_config 等字段）',
      )
    } else {
      console.log('  ⚠️  jobs 表不存在，跳过')
    }

    // ============================================================
    // 步骤3：简化 job_scenes 表
    // ============================================================
    console.log('\n📝 步骤3: 简化 job_scenes 表...')

    const jobScenesTableExists = db
      .prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='job_scenes'
    `)
      .get()

    if (jobScenesTableExists) {
      const scenesColumns = db.prepare('PRAGMA table_info(job_scenes)').all()
      const scenesColumnNames = scenesColumns.map((c) => c.name)

      // 创建新表
      db.exec(`
        CREATE TABLE job_scenes_new (
          id TEXT PRIMARY KEY,
          job_id TEXT NOT NULL,
          scene_index INTEGER NOT NULL,
          scene_id TEXT NOT NULL,

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
          final_video_url TEXT,

          selected_audio_url TEXT,
          audio_duration REAL,
          speed_factor REAL,

          split_nca_job_id TEXT,
          speed_nca_job_id TEXT,
          merge_nca_job_id TEXT,

          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          started_at INTEGER,
          completed_at INTEGER,

          FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
        )
      `)

      // 迁移数据
      const sceneFields = [
        'id',
        'job_id',
        'scene_index',
        'scene_id',
        'source_video_index',
        'source_video_label',
        'source_start_time',
        'source_end_time',
        'duration_seconds',
        'narration_script',
        'use_original_audio',
        'status',
        'split_video_url',
        'gcs_video_url',
        'final_video_url',
        'selected_audio_url',
        'audio_duration',
        'speed_factor',
        'split_nca_job_id',
        'speed_nca_job_id',
        'merge_nca_job_id',
        'created_at',
        'updated_at',
        'started_at',
        'completed_at',
      ].filter((field) => scenesColumnNames.includes(field))

      db.exec(`
        INSERT INTO job_scenes_new (${sceneFields.join(', ')})
        SELECT ${sceneFields.join(', ')}
        FROM job_scenes
      `)

      db.exec('DROP TABLE job_scenes')
      db.exec('ALTER TABLE job_scenes_new RENAME TO job_scenes')

      // 重建索引
      db.exec('CREATE INDEX IF NOT EXISTS idx_job_scenes_job_id ON job_scenes(job_id)')
      db.exec('CREATE INDEX IF NOT EXISTS idx_job_scenes_index ON job_scenes(job_id, scene_index)')
      db.exec('CREATE INDEX IF NOT EXISTS idx_job_scenes_scene_id ON job_scenes(scene_id)')
      db.exec('CREATE INDEX IF NOT EXISTS idx_job_scenes_status ON job_scenes(job_id, status)')

      console.log(
        '  ✅ job_scenes 表简化完成（删除了 metadata, adjusted_video_url, is_paused, is_skipped 等字段）',
      )
    } else {
      console.log('  ⚠️  job_scenes 表不存在，跳过')
    }

    // ============================================================
    // 步骤4：简化 job_current_state 表
    // ============================================================
    console.log('\n📝 步骤4: 简化 job_current_state 表...')

    const stateTableExists = db
      .prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='job_current_state'
    `)
      .get()

    if (stateTableExists) {
      const stateColumns = db.prepare('PRAGMA table_info(job_current_state)').all()
      const stateColumnNames = stateColumns.map((c) => c.name)

      // 检查是否需要删除字段
      const fieldsToRemove = ['is_paused', 'pause_requested_at']
      const hasFieldsToRemove = fieldsToRemove.some((field) => stateColumnNames.includes(field))

      if (hasFieldsToRemove) {
        // 创建新表
        db.exec(`
          CREATE TABLE job_current_state_new (
            job_id TEXT PRIMARY KEY,
            current_major_step TEXT,
            current_sub_step TEXT,
            step_context TEXT,
            total_scenes INTEGER DEFAULT 0,
            processed_scenes INTEGER DEFAULT 0,
            user_stopped INTEGER DEFAULT 0,
            stopped_reason TEXT,
            final_video_url TEXT,
            final_video_public_url TEXT,
            final_video_gs_uri TEXT,
            final_video_local_path TEXT,
            final_video_metadata TEXT,
            concatenate_nca_job_id TEXT,
            updated_at INTEGER NOT NULL,

            FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
          )
        `)

        // 迁移数据
        const stateFields = [
          'job_id',
          'current_major_step',
          'current_sub_step',
          'step_context',
          'total_scenes',
          'processed_scenes',
          'user_stopped',
          'stopped_reason',
          'final_video_url',
          'final_video_public_url',
          'final_video_gs_uri',
          'final_video_local_path',
          'final_video_metadata',
          'concatenate_nca_job_id',
          'updated_at',
        ].filter((field) => stateColumnNames.includes(field))

        db.exec(`
          INSERT INTO job_current_state_new (${stateFields.join(', ')})
          SELECT ${stateFields.join(', ')}
          FROM job_current_state
        `)

        db.exec('DROP TABLE job_current_state')
        db.exec('ALTER TABLE job_current_state_new RENAME TO job_current_state')

        // 重建索引
        db.exec(
          'CREATE INDEX IF NOT EXISTS idx_job_current_state_job_id ON job_current_state(job_id)',
        )

        console.log(
          '  ✅ job_current_state 表简化完成（删除了 is_paused, pause_requested_at 字段）',
        )
      } else {
        console.log('  ℹ️  job_current_state 表无需修改')
      }
    } else {
      console.log('  ⚠️  job_current_state 表不存在，跳过')
    }

    // ============================================================
    // 步骤5：验证必要表存在
    // ============================================================
    console.log('\n✅ 步骤5: 验证必要表存在...')

    const requiredTables = [
      'jobs',
      'job_videos',
      'job_scenes',
      'job_current_state',
      'job_step_history',
      'job_logs',
      'nca_jobs',
      'api_keys',
    ]

    for (const table of requiredTables) {
      const exists = db
        .prepare(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name=?
      `)
        .get(table)

      if (exists) {
        console.log(`  ✅ 表存在: ${table}`)
      } else {
        console.log(`  ❌ 表缺失: ${table}（需要运行完整的 schema.sql）`)
      }
    }

    // 提交事务
    db.exec('COMMIT')

    console.log('\n────────────────────────────────────────')
    console.log('✅ 数据库迁移成功完成！')
    console.log('\n📊 迁移统计:')
    console.log(`  • 删除冗余表: ${tablesToDrop.length} 个`)
    console.log('  • 简化业务表: 3 个 (jobs, job_scenes, job_current_state)')
    console.log(`  • 保留核心表: ${requiredTables.length} 个`)
    console.log('\n💡 后续步骤:')
    console.log('  1. 开发 Logger 模块 (lib/utils/execution-logger.ts)')
    console.log('  2. 集成 Logger 到工作流引擎和 API 客户端')
    console.log('  3. 测试完整任务并验证数据完整性')
  } catch (error) {
    // 回滚事务
    db.exec('ROLLBACK')

    console.error('\n❌ 数据库迁移失败:')
    console.error(error.message)
    console.error('\n💡 错误堆栈:')
    console.error(error.stack)

    process.exit(1)
  } finally {
    db.close()
  }
}

// 执行迁移
migrate()
