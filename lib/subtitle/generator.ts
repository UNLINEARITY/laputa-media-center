/**
 * ASS 字幕生成器
 *
 * 生成 ASS (Advanced SubStation Alpha) 格式字幕文件
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

import { mergeStyles } from './adaptive-size'
import { resolvePresetStyle } from './presets'
import type { SubtitleSegment } from './segment-splitter'
import { escapeASS, processSubtitleText, removePunctuation, wrapText } from './text-wrapper'
import type { SubtitleConfig, SubtitleStyle, VideoSize } from './types'

/**
 * 解析最终 SubtitleStyle 来源
 * 优先级：style 覆盖 > presetId > 默认 mergeStyles
 */
function resolveStyle(config: SubtitleConfig): SubtitleStyle {
  if (config.presetId && config.presetId !== 'default' && !config.style) {
    return resolvePresetStyle(config.presetId, config.videoSize)
  }
  // 兼容历史调用：style 覆盖优先（同时显式 default 走默认）
  return mergeStyles(config.videoSize, config.style)
}

// ============================================================================
// 时间格式化
// ============================================================================

/**
 * 格式化 ASS 时间戳
 *
 * ASS 时间格式: H:MM:SS.cc（centiseconds，百分之一秒）
 *
 * @param seconds 秒数
 * @returns ASS 格式时间字符串
 */
export function formatASSTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60

  // 格式: H:MM:SS.cc
  const secStr = s.toFixed(2).padStart(5, '0')
  return `${h}:${m.toString().padStart(2, '0')}:${secStr}`
}

// ============================================================================
// ASS 模板
// ============================================================================

/**
 * 生成 ASS 字幕文件内容
 *
 * @param config 字幕配置
 * @returns ASS 格式字幕内容
 */
export function generateASS(config: SubtitleConfig): string {
  // 合并样式（preset 优先，其次 style 覆盖，最后默认）
  const style = resolveStyle(config)

  // 处理文本（转义 + 换行）
  const processedText = processSubtitleText(config.text, style.maxCharsPerLine)

  // 格式化时间
  const endTime = formatASSTime(config.duration)

  // 生成 ASS 内容
  return buildASSContent(config, style, processedText, endTime)
}

/**
 * 构建 ASS 文件内容
 */
function buildASSContent(
  config: SubtitleConfig,
  style: SubtitleStyle,
  text: string,
  endTime: string,
): string {
  // [Script Info] 部分
  // WrapStyle: 2 = 禁止自动换行，确保居中对齐生效
  const scriptInfo = `[Script Info]
; 由 LaputaMediaCenter 自动生成
ScriptType: v4.00+
PlayResX: ${config.videoSize.width}
PlayResY: ${config.videoSize.height}
ScaledBorderAndShadow: yes
WrapStyle: 2`

  // [V4+ Styles] 部分
  // ASS 样式格式说明:
  // Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour,
  // Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle,
  // BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
  const styles = `[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${style.fontName},${style.fontSize},${style.primaryColor},${style.primaryColor},${style.outlineColor},${style.shadowColor},0,0,0,0,100,100,0,0,1,${style.outlineWidth},${style.shadowDepth},2,${style.marginH},${style.marginH},${style.marginV},1`

  // [Events] 部分
  // Alignment=2 表示底部居中
  const events = `[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,${endTime},Default,,0,0,0,,${text}`

  return `${scriptInfo}

${styles}

${events}
`
}

// ============================================================================
// 文件操作
// ============================================================================

/**
 * 保存字幕文件
 *
 * @param content ASS 字幕内容
 * @param outputPath 输出路径
 * @returns 保存的文件路径
 */
export async function saveSubtitleFile(content: string, outputPath: string): Promise<string> {
  // 确保目录存在
  const dir = path.dirname(outputPath)
  await fs.promises.mkdir(dir, { recursive: true })

  // 写入文件（UTF-8 编码）
  await fs.promises.writeFile(outputPath, content, 'utf-8')

  return outputPath
}

/**
 * 生成并保存字幕文件
 *
 * 便捷方法，合并生成和保存两个步骤
 *
 * @param config 字幕配置
 * @param outputPath 输出路径
 * @returns 保存的文件路径
 */
export async function generateAndSaveSubtitle(
  config: SubtitleConfig,
  outputPath: string,
): Promise<string> {
  const content = generateASS(config)
  return saveSubtitleFile(content, outputPath)
}

// ============================================================================
// 分段字幕生成（逐句切换）
// ============================================================================

/** 分段字幕配置 */
export interface SegmentedSubtitleConfig {
  /** 分段数据（含时间戳） */
  segments: SubtitleSegment[]
  /** 视频尺寸 */
  videoSize: VideoSize
  /** 可选样式覆盖（与 presetId 互斥；都传时 style 覆盖优先） */
  style?: Partial<SubtitleStyle>
  /** Phase 3.C-D：字幕样式预设 ID */
  presetId?: import('./types').SubtitlePresetId
}

/**
 * 生成分段字幕（多条 Dialogue）
 *
 * 与 generateASS 不同，此函数生成多条时间轴字幕，
 * 实现字幕随语音逐句切换的效果
 *
 * @param config 分段字幕配置
 * @returns ASS 格式字幕内容
 */
export function generateSegmentedASS(config: SegmentedSubtitleConfig): string {
  // 合并样式（preset 优先，其次 style 覆盖，最后默认）
  const style =
    config.presetId && config.presetId !== 'default' && !config.style
      ? resolvePresetStyle(config.presetId, config.videoSize)
      : mergeStyles(config.videoSize, config.style)

  // 生成多条 Dialogue
  const dialogues = config.segments
    .map((seg) => {
      const startTime = formatASSTime(seg.startTime)
      const endTime = formatASSTime(seg.endTime)
      // 先移除标点，再转义 ASS 特殊字符，最后换行处理
      const cleanText = removePunctuation(seg.text)
      const escapedText = escapeASS(cleanText)
      const text = wrapText(escapedText, style.maxCharsPerLine)
      return `Dialogue: 0,${startTime},${endTime},Default,,0,0,0,,${text}`
    })
    .join('\n')

  // 构建完整 ASS 内容
  return `${buildASSHeader(config.videoSize, style)}${dialogues}\n`
}

/**
 * 构建 ASS 文件头部（Script Info + Styles + Events Format）
 *
 * 提取为公共函数，供 generateASS 和 generateSegmentedASS 共用
 */
function buildASSHeader(videoSize: VideoSize, style: SubtitleStyle): string {
  // WrapStyle: 2 = 禁止自动换行，确保居中对齐生效
  return `[Script Info]
; 由 LaputaMediaCenter 自动生成
ScriptType: v4.00+
PlayResX: ${videoSize.width}
PlayResY: ${videoSize.height}
ScaledBorderAndShadow: yes
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${style.fontName},${style.fontSize},${style.primaryColor},${style.primaryColor},${style.outlineColor},${style.shadowColor},0,0,0,0,100,100,0,0,1,${style.outlineWidth},${style.shadowDepth},2,${style.marginH},${style.marginH},${style.marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`
}
