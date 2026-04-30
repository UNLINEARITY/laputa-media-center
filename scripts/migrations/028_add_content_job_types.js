/**
 * Migration 028: allow dubbing and content ingest job types.
 *
 * SQLite CHECK constraints require table rebuilds.
 */

const Database = require('better-sqlite3')
const path = require('node:path')
require('dotenv/config')

const DB_PATH = (process.env.DATABASE_URL || `file:${path.join(__dirname, '../../data/db.sqlite')}`).replace(
  'file:',
  '',
)

function tableSql(db, name) {
  return db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`).get(name)?.sql || ''
}

function migrateJobs(db) {
  const sql = tableSql(db, 'jobs')
  if (sql.includes('content_ingest') && sql.includes('translation_dubbing')) {
    console.log('[Migration 028] jobs.job_type constraint already updated')
    return
  }

  console.log('[Migration 028] rebuilding jobs table')
  db.prepare(`
    CREATE TABLE jobs_new (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
      current_step TEXT CHECK(current_step IN ('analysis', 'generate_narrations', 'extract_scenes', 'process_scenes', 'compose', 'ingest', 'transcribe', 'package')),

      input_url TEXT,
      style_id TEXT,
      style_name TEXT,
      config TEXT NOT NULL,

      job_type TEXT DEFAULT 'content_ingest' CHECK(job_type IN ('single_video', 'multi_video', 'translation_dubbing', 'content_ingest')),
      input_videos TEXT,
      remix_mode TEXT CHECK(remix_mode IN ('story_driven', 'theme_driven', 'visual_optimized')),
      remix_config TEXT,

      error_message TEXT,
      error_metadata TEXT,

      source TEXT DEFAULT 'web',
      api_token_id TEXT,
      webhook_url TEXT,
      webhook_secret TEXT,

      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER
    )
  `).run()

  db.prepare(`
    INSERT INTO jobs_new (
      id, status, current_step, input_url, style_id, style_name, config,
      job_type, input_videos, remix_mode, remix_config,
      error_message, error_metadata, source, api_token_id, webhook_url, webhook_secret,
      created_at, updated_at, started_at, completed_at
    )
    SELECT
      id, status, current_step, input_url, style_id, style_name, config,
      job_type, input_videos, remix_mode, remix_config,
      error_message, error_metadata, source, api_token_id, webhook_url, webhook_secret,
      created_at, updated_at, started_at, completed_at
    FROM jobs
  `).run()

  db.prepare('DROP TABLE jobs').run()
  db.prepare('ALTER TABLE jobs_new RENAME TO jobs').run()
  db.prepare('CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)').run()
  db.prepare('CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC)').run()
  db.prepare('CREATE INDEX IF NOT EXISTS idx_jobs_job_type ON jobs(job_type)').run()
}

function migrateStepHistory(db) {
  const sql = tableSql(db, 'job_step_history')
  if (sql.includes("'ingest'") && sql.includes("'transcribe'") && sql.includes("'package'")) {
    console.log('[Migration 028] job_step_history.major_step constraint already updated')
    return
  }

  console.log('[Migration 028] rebuilding job_step_history table')
  db.prepare(`
    CREATE TABLE job_step_history_new (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      scene_id TEXT,

      major_step TEXT NOT NULL CHECK(major_step IN ('analysis', 'generate_narrations', 'extract_scenes', 'process_scenes', 'compose', 'ingest', 'transcribe', 'package')),
      sub_step TEXT NOT NULL,
      step_type TEXT,

      status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'completed', 'failed', 'skipped')),

      attempt INTEGER DEFAULT 1,
      retry_delay_ms INTEGER,

      started_at INTEGER,
      completed_at INTEGER,
      duration_ms INTEGER,

      error_message TEXT,

      input_data TEXT,
      step_metadata TEXT,
      output_data TEXT,

      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
      FOREIGN KEY (scene_id) REFERENCES job_scenes(id) ON DELETE CASCADE
    )
  `).run()

  db.prepare('INSERT INTO job_step_history_new SELECT * FROM job_step_history').run()
  db.prepare('DROP TABLE job_step_history').run()
  db.prepare('ALTER TABLE job_step_history_new RENAME TO job_step_history').run()
  db.prepare(
    'CREATE INDEX IF NOT EXISTS idx_job_step_history_job_id ON job_step_history(job_id, started_at)',
  ).run()
  db.prepare(
    'CREATE INDEX IF NOT EXISTS idx_job_step_history_major_step ON job_step_history(major_step)',
  ).run()
  db.prepare('CREATE INDEX IF NOT EXISTS idx_job_step_history_status ON job_step_history(status)').run()
  db.prepare(
    'CREATE INDEX IF NOT EXISTS idx_job_step_history_step_type ON job_step_history(job_id, step_type)',
  ).run()
  db.prepare(
    'CREATE INDEX IF NOT EXISTS idx_job_step_history_attempt ON job_step_history(job_id, sub_step, attempt)',
  ).run()
  db.prepare(
    'CREATE INDEX IF NOT EXISTS idx_job_step_history_stats ON job_step_history(job_id, major_step, status)',
  ).run()
}

function migrate() {
  console.log('[Migration 028] start')
  const db = new Database(DB_PATH)

  try {
    db.pragma('foreign_keys = OFF')
    db.prepare('BEGIN TRANSACTION').run()
    migrateJobs(db)
    migrateStepHistory(db)
    db.prepare('COMMIT').run()
    db.pragma('foreign_keys = ON')
    console.log('[Migration 028] done')
  } catch (error) {
    db.prepare('ROLLBACK').run()
    console.error('[Migration 028] failed:', error.message)
    throw error
  } finally {
    db.close()
  }
}

if (require.main === module) {
  migrate()
}

module.exports = { migrate }
