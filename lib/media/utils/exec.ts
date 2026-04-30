/**
 * FFmpeg/FFprobe 命令执行工具
 *
 * 使用原生 child_process 封装，替代 deprecated fluent-ffmpeg
 */

import { spawn } from 'node:child_process'
import type { FFmpegExecOptions, FFmpegProgress, FFprobeOutput } from '../types'

// ============================================================================
// 常量
// ============================================================================

const DEFAULT_TIMEOUT = 10 * 60 * 1000 // 10 分钟

// ============================================================================
// FFprobe 执行
// ============================================================================

/**
 * 执行 ffprobe 获取媒体信息
 */
export async function execFFprobe(
  input: string,
  ffprobePath = 'ffprobe',
  timeout = 30000,
): Promise<FFprobeOutput> {
  const args = [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    convertGcsUrl(input),
  ]

  return new Promise((resolve, reject) => {
    const process = spawn(ffprobePath, args, {
      timeout,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    process.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    process.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    process.on('close', (code) => {
      if (code === 0) {
        try {
          resolve(JSON.parse(stdout))
        } catch {
          reject(new Error(`FFprobe 输出解析失败: ${stdout}`))
        }
      } else {
        reject(new Error(`FFprobe 执行失败 (code ${code}): ${stderr}`))
      }
    })

    process.on('error', reject)
  })
}

// ============================================================================
// FFmpeg 执行
// ============================================================================

/**
 * 执行 ffmpeg 命令
 */
export async function execFFmpeg(
  args: string[],
  options: FFmpegExecOptions & { ffmpegPath?: string } = {},
): Promise<{ success: boolean; stderr: string }> {
  const { ffmpegPath = 'ffmpeg', timeout = DEFAULT_TIMEOUT, onProgress, signal, cwd } = options

  return new Promise((resolve, reject) => {
    // 添加 -y 覆盖输出文件
    const fullArgs = ['-y', ...args]

    const process = spawn(ffmpegPath, fullArgs, {
      timeout,
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    // 限制 stderr 大小，防止大视频处理时内存爆炸
    const MAX_STDERR_SIZE = 100 * 1024 // 100KB
    let stderr = ''

    process.stderr.on('data', (data) => {
      const chunk = data.toString()

      // 限制 stderr 累积，保留前 100KB
      if (stderr.length < MAX_STDERR_SIZE) {
        const remaining = MAX_STDERR_SIZE - stderr.length
        stderr += chunk.slice(0, remaining)
      }

      // 解析进度信息
      if (onProgress) {
        const progress = parseProgress(chunk)
        if (progress) {
          onProgress(progress)
        }
      }
    })

    // 处理取消信号（带 SIGKILL 兜底）
    if (signal) {
      signal.addEventListener('abort', () => {
        // 先发 SIGTERM 优雅终止
        process.kill('SIGTERM')

        // 5 秒后若仍未退出，强制 SIGKILL
        const killTimeout = setTimeout(() => {
          try {
            process.kill('SIGKILL')
          } catch {
            // 进程可能已退出，忽略错误
          }
        }, 5000)

        // 进程退出后清理定时器
        process.once('close', () => clearTimeout(killTimeout))

        reject(new Error('FFmpeg 执行被取消'))
      })
    }

    process.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, stderr })
      } else {
        resolve({ success: false, stderr })
      }
    })

    process.on('error', reject)
  })
}

// ============================================================================
// 进度解析
// ============================================================================

/**
 * 解析 FFmpeg 进度输出
 */
function parseProgress(output: string): FFmpegProgress | null {
  // FFmpeg 进度格式示例:
  // frame=  100 fps= 25 q=28.0 size=    1024kB time=00:00:04.00 bitrate= 256.0kbits/s speed=0.5x

  const frameMatch = output.match(/frame=\s*(\d+)/)
  const fpsMatch = output.match(/fps=\s*([\d.]+)/)
  const timeMatch = output.match(/time=(\d{2}:\d{2}:\d{2}\.\d{2})/)
  const bitrateMatch = output.match(/bitrate=\s*([\d.]+\w+)/)
  const speedMatch = output.match(/speed=\s*([\d.]+)x/)

  if (!frameMatch && !timeMatch) {
    return null
  }

  return {
    frame: frameMatch ? Number.parseInt(frameMatch[1], 10) : undefined,
    fps: fpsMatch ? Number.parseFloat(fpsMatch[1]) : undefined,
    time: timeMatch ? timeMatch[1] : undefined,
    bitrate: bitrateMatch ? bitrateMatch[1] : undefined,
    speed: speedMatch ? speedMatch[1] : undefined,
  }
}

// ============================================================================
// URL 处理
// ============================================================================

/**
 * 转换 URL 为 FFmpeg/FFprobe 可处理的格式
 *
 * 转换规则：
 * - file:///path/to/file → /path/to/file（本地文件路径）
 * - gs://bucket/path → https://storage.googleapis.com/bucket/path
 * - storage.cloud.google.com/bucket/path → storage.googleapis.com/bucket/path（兜底）
 *
 * 注意：storage.cloud.google.com 格式会返回 302 重定向到 Google 登录页，
 * FFprobe 无法处理，必须转换为 storage.googleapis.com 格式
 */
export function convertGcsUrl(url: string): string {
  // file:// → 本地路径（AI Studio 模式上传的视频）
  if (url.startsWith('file://')) {
    return url.slice(7) // 移除 'file://' 前缀
  }

  // gs:// → HTTPS
  if (url.startsWith('gs://')) {
    const path = url.slice(5)
    return `https://storage.googleapis.com/${path}`
  }

  // storage.cloud.google.com → storage.googleapis.com（兜底处理）
  const cloudConsoleMatch = url.match(/https:\/\/storage\.cloud\.google\.com\/([^/?]+)\/(.+)/)
  if (cloudConsoleMatch) {
    const [, bucket, path] = cloudConsoleMatch
    // 移除 URL 参数（如 ?authuser=0）
    const cleanPath = path.split('?')[0]
    return `https://storage.googleapis.com/${bucket}/${cleanPath}`
  }

  return url
}

/**
 * 检查是否为远程 URL
 * 注意：file:// 是本地文件协议，不是远程 URL
 */
export function isRemoteUrl(path: string): boolean {
  // file:// 是本地文件，不是远程
  if (path.startsWith('file://')) return false
  return path.startsWith('http://') || path.startsWith('https://') || path.startsWith('gs://')
}

// ============================================================================
// 时间格式化
// ============================================================================

/**
 * 秒数转时间戳
 * 5.5 → "00:00:05.500"
 */
export function secondsToTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60

  const h = hours.toString().padStart(2, '0')
  const m = minutes.toString().padStart(2, '0')
  const s = secs.toFixed(3).padStart(6, '0')

  return `${h}:${m}:${s}`
}

/**
 * 时间戳转秒数
 * "00:00:05.500" → 5.5
 */
export function timestampToSeconds(timestamp: string): number {
  // 如果已经是数字字符串，直接返回
  if (/^[\d.]+$/.test(timestamp)) {
    return Number.parseFloat(timestamp)
  }

  const parts = timestamp.split(':')
  if (parts.length === 3) {
    const [h, m, s] = parts
    return Number.parseInt(h, 10) * 3600 + Number.parseInt(m, 10) * 60 + Number.parseFloat(s)
  }
  if (parts.length === 2) {
    const [m, s] = parts
    return Number.parseInt(m, 10) * 60 + Number.parseFloat(s)
  }

  return Number.parseFloat(timestamp) || 0
}

/**
 * 格式化时长显示
 * 65.5 → "1:05"
 */
export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}
