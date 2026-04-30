/**
 * 迁移脚本：添加 raw_response 字段
 *
 * 目的：保存 Gemini 等 AI 服务的原始响应，方便排查 JSON 解析失败等问题
 */

export const version = '11.2.1'

export function up(db) {
  // 检查字段是否已存在
  const tableInfo = db.prepare("PRAGMA table_info('api_calls')").all()
  const hasRawResponse = tableInfo.some((col) => col.name === 'raw_response')

  if (!hasRawResponse) {
    db.prepare('ALTER TABLE api_calls ADD COLUMN raw_response TEXT').run()
    console.log('  ✓ 添加 raw_response 字段')
  } else {
    console.log('  - raw_response 字段已存在，跳过')
  }
}

export function down(db) {
  // SQLite 不支持 DROP COLUMN（3.35.0 之前版本）
  // 这里仅作记录，实际回滚需要重建表
  console.log('  ! SQLite 不支持直接删除列，需要手动重建表')
}
