/**
 * 数据库迁移脚本：修复多视频任务类型错误
 * v2.0.0 - 2025-11-19
 *
 * 问题：历史任务中，多视频任务被错误标记为 single_video
 * 解决：删除所有 job_type = 'single_video' 但 input_videos 长度 > 1 的任务
 */

const Database = require('better-sqlite3')
const path = require('node:path')

const dbPath = path.join(__dirname, '../../data/db.sqlite')

console.log('📦 数据库迁移：修复多视频任务类型错误')
console.log(`📁 数据库路径: ${dbPath}`)
console.log('')

try {
  const db = new Database(dbPath)

  // 1. 查找错误任务
  console.log('🔍 查找类型错误的任务...')
  const wrongJobs = db
    .prepare(`
    SELECT
      id,
      job_type,
      json_array_length(input_videos) as video_count,
      status,
      created_at
    FROM jobs
    WHERE job_type = 'single_video'
    AND json_array_length(input_videos) > 1
  `)
    .all()

  if (wrongJobs.length === 0) {
    console.log('✅ 未发现类型错误的任务')
    db.close()
    process.exit(0)
  }

  console.log(`\n⚠️  发现 ${wrongJobs.length} 个类型错误的任务:\n`)

  wrongJobs.forEach((job, index) => {
    const createdDate = new Date(job.created_at).toLocaleString('zh-CN')
    console.log(`${index + 1}. 任务 ID: ${job.id}`)
    console.log(`   - 视频数量: ${job.video_count}`)
    console.log(`   - 错误类型: ${job.job_type} (应该是 multi_video)`)
    console.log(`   - 状态: ${job.status}`)
    console.log(`   - 创建时间: ${createdDate}`)
    console.log('')
  })

  // 2. 询问用户确认（在脚本环境中自动执行）
  console.log('🗑️  准备删除这些任务及其相关数据...')
  console.log('')

  // 3. 开始删除（使用事务确保原子性）
  db.exec('BEGIN TRANSACTION')

  try {
    const deleteJobStmt = db.prepare('DELETE FROM jobs WHERE id = ?')
    const deleteVideosStmt = db.prepare('DELETE FROM job_videos WHERE job_id = ?')
    const deleteScenesStmt = db.prepare('DELETE FROM job_scenes WHERE job_id = ?')
    const deleteStateStmt = db.prepare('DELETE FROM job_current_state WHERE job_id = ?')
    const deleteHistoryStmt = db.prepare('DELETE FROM job_step_history WHERE job_id = ?')
    const deleteLogsStmt = db.prepare('DELETE FROM job_logs WHERE job_id = ?')
    const deleteNcaJobsStmt = db.prepare('DELETE FROM nca_jobs WHERE job_id = ?')
    const deleteApiCallsStmt = db.prepare('DELETE FROM api_calls WHERE job_id = ?')

    // scene_audio_candidates 表通过 FOREIGN KEY 级联删除（ON DELETE CASCADE）
    // 当删除 job_scenes 时会自动删除相关的 audio_candidates

    wrongJobs.forEach((job) => {
      // 删除所有相关表的数据
      deleteVideosStmt.run(job.id)
      deleteStateStmt.run(job.id)
      deleteHistoryStmt.run(job.id)
      deleteLogsStmt.run(job.id)
      deleteNcaJobsStmt.run(job.id)
      deleteApiCallsStmt.run(job.id)

      // 删除 job_scenes（会级联删除 scene_audio_candidates）
      deleteScenesStmt.run(job.id)

      // 最后删除任务本身
      deleteJobStmt.run(job.id)

      console.log(`✅ 已删除任务: ${job.id}`)
    })

    db.exec('COMMIT')
    console.log('')
    console.log('✅ 数据库清理完成')
    console.log(`📊 总计删除 ${wrongJobs.length} 个任务及其关联数据`)
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  } finally {
    db.close()
  }
} catch (error) {
  console.error('❌ 迁移失败:', error)
  process.exit(1)
}
