/**
 * FFmpeg 通用工具（Phase 3.C-A 收尾抽出）
 *
 * 之前在 lib/media/operations/subtitle.ts + lib/workflow/steps/{podcast,highlights}/
 * 三處重複实现 escape + spawn 包装，這裡統一。
 */

import { spawn } from 'node:child_process'

/**
 * 转义 FFmpeg 滤镜路径中的特殊字符
 *
 * FFmpeg 滤镜语法中的特殊字符：
 * - : 冒号（参数分隔符）
 * - \ 反斜杠（转义字符）
 * - ' 单引号
 * - [ ] 方括号（流选择器）
 *
 * 注意：先把 Windows `\` 換成 `/`，再轉義冒號，避免「`C:\foo\bar`」二次轉義。
 */
export function escapeFFmpegPath(filePath: string): string {
  return filePath
    .replace(/\\/g, '/')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
}

/**
 * 同步执行 ffmpeg / ffprobe，集中 stderr/stdout，超时丢错。
 *
 * 用 `spawn(cmd, args, ...)` 数组式参数，原生防 shell injection（不要用 shell:true）。
 */
export async function execFfmpeg(
  ffmpeg: string,
  args: string[],
  timeoutMs: number = 30 * 60 * 1000,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, args, {
      timeout: timeoutMs,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d) => (stdout += d.toString()))
    proc.stderr.on('data', (d) => (stderr += d.toString()))
    proc.on('error', (err) => reject(new Error(`spawn ffmpeg failed: ${err.message}`)))
    proc.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-500)}`))
    })
  })
}
