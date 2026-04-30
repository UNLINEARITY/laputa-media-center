/**
 * Migration 007: Add error_metadata column to jobs table
 * v9.0.0 方案3: 细化失败状态
 */

const Database = require('better-sqlite3')
const path = require('node:path')

const dbPath = process.env.DATABASE_URL?.replace('file:', '') || './data/db.sqlite'
const db = new Database(dbPath)

try {
  console.log('🔄 Migration 007: Adding error_metadata column...')

  // Check if column already exists
  const tableInfo = db.prepare('PRAGMA table_info(jobs)').all()
  const hasErrorMetadata = tableInfo.some((col) => col.name === 'error_metadata')

  if (hasErrorMetadata) {
    console.log('✅ error_metadata column already exists, skipping...')
  } else {
    // Add error_metadata column (JSON text field)
    db.prepare(`
      ALTER TABLE jobs
      ADD COLUMN error_metadata TEXT
    `).run()

    console.log('✅ Successfully added error_metadata column')
  }

  // Update status CHECK constraint to include new failure states
  // Note: SQLite doesn't support ALTER TABLE ... MODIFY COLUMN
  // We need to create a new table and migrate data

  console.log('🔄 Updating status column CHECK constraint...')

  // Check if we need to update the constraint
  const createStatement = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='jobs'")
    .get()

  if (createStatement.sql.includes('failed_retryable')) {
    console.log('✅ Status CHECK constraint already updated, skipping...')
  } else {
    // Begin transaction
    db.prepare('BEGIN TRANSACTION').run()

    try {
      // Create new table with updated constraints
      db.prepare(`
        CREATE TABLE jobs_new (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL CHECK(status IN (
            'pending', 'queued', 'processing', 'paused', 'stopped', 'completed', 'failed',
            'pausing', 'stopping', 'resuming', 'restarting', 'retrying', 'cancelling',
            'failed_retryable', 'failed_config', 'failed_input', 'failed_system', 'failed_cancelled'
          )),
          current_step TEXT CHECK(current_step IN ('analysis', 'extract_scenes', 'process_scenes', 'compose')),

          -- Single video fields
          input_url TEXT,

          -- Multi-video fields (v0.4.0 统一架构)
          job_type TEXT NOT NULL DEFAULT 'single_video' CHECK(job_type IN ('single_video', 'multi_video')),
          input_videos TEXT,

          style_id TEXT,
          config TEXT NOT NULL,
          error_message TEXT,
          error_metadata TEXT,
          retry_count INTEGER NOT NULL DEFAULT 0,

          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          started_at INTEGER,
          completed_at INTEGER,

          -- 混剪字段（v0.3.0-v0.3.4，已废弃）
          remix_mode TEXT,
          remix_config TEXT
        )
      `).run()

      // Copy data from old table to new table (explicitly specify columns)
      db.prepare(`
        INSERT INTO jobs_new (
          id, status, current_step, input_url, job_type, input_videos,
          style_id, config, error_message, error_metadata, retry_count,
          created_at, updated_at, started_at, completed_at,
          remix_mode, remix_config
        )
        SELECT
          id, status, current_step, input_url, job_type, input_videos,
          style_id, config, error_message, error_metadata, retry_count,
          created_at, updated_at, started_at, completed_at,
          remix_mode, remix_config
        FROM jobs
      `).run()

      // Drop old table
      db.prepare('DROP TABLE jobs').run()

      // Rename new table to jobs
      db.prepare('ALTER TABLE jobs_new RENAME TO jobs').run()

      // Commit transaction
      db.prepare('COMMIT').run()

      console.log('✅ Successfully updated status CHECK constraint')
    } catch (error) {
      // Rollback on error
      db.prepare('ROLLBACK').run()
      throw error
    }
  }

  console.log('✅ Migration 007 completed successfully!')
} catch (error) {
  console.error('❌ Migration 007 failed:', error.message)
  process.exit(1)
} finally {
  db.close()
}
