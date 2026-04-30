/**
 * 自适应尺寸计算模块
 *
 * 根据视频分辨率动态计算字幕样式参数
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

import {
  BASE_HEIGHT,
  DEFAULT_FONT_FILE,
  DEFAULT_SUBTITLE_STYLE,
  type SubtitleStyle,
  type VideoSize,
} from './types'

// ============================================================================
// 布局常量
// ============================================================================

/** 字幕最大宽度占视频宽度的比例（85%，两侧各留 7.5%） */
const MAX_WIDTH_RATIO = 0.85

/** 边距占比（左右、底部各 5%） */
const MARGIN_RATIO = 0.05

/** 中文字符宽度系数（相对于字号，Noto Sans SC 约 0.9） */
const CHAR_WIDTH_FACTOR = 0.9

// ============================================================================
// 字体文件管理
// ============================================================================

/** 字体文件缓存 */
let cachedFontPath: string | null = null

/**
 * 获取字体文件路径
 *
 * 优先使用项目内置字体，确保跨平台一致性
 */
export function getFontPath(): string {
  // 使用缓存避免重复检查
  if (cachedFontPath) return cachedFontPath

  // 项目内置字体路径
  const localFont = path.join(process.cwd(), 'resource/fonts', DEFAULT_FONT_FILE)

  if (fs.existsSync(localFont)) {
    cachedFontPath = localFont
    return cachedFontPath
  }

  // 字体文件不存在，抛出明确错误
  throw new Error(
    `字体文件不存在: ${localFont}\n` +
      `请下载 Noto Sans SC 字体并放置到 resource/fonts/ 目录\n` +
      `下载地址: https://fonts.google.com/noto/specimen/Noto+Sans+SC`,
  )
}

/**
 * 获取字体 family 名称（用于 ASS 字幕）
 *
 * 注意：FFmpeg ass filter 通过 fontconfig 匹配字体
 * 必须使用字体的 family 名称，而不是文件名
 *
 * NotoSansSC-Bold.ttf 的 family 名称是 "Noto Sans SC"（带空格）
 */
export function getFontName(): string {
  return 'Noto Sans SC'
}

// ============================================================================
// 自适应计算
// ============================================================================

/**
 * 根据视频宽度计算每行最大字符数
 *
 * @param width 视频宽度
 * @param fontSize 字号
 * @returns 每行最大字符数
 */
function calculateMaxChars(width: number, fontSize: number): number {
  // 字幕宽度不超过视频宽度的 75%（两侧各留 12.5% 安全边距）
  const maxWidth = width * MAX_WIDTH_RATIO
  // 中文字符宽度约为字号的 90%（更精确的 Noto Sans SC 字体宽度）
  const charWidth = fontSize * CHAR_WIDTH_FACTOR
  return Math.floor(maxWidth / charWidth)
}

/**
 * 计算自适应字幕样式
 *
 * 根据视频分辨率缩放所有尺寸参数
 *
 * @param videoSize 视频尺寸
 * @returns 完整的字幕样式配置
 */
export function calculateAdaptiveStyle(videoSize: VideoSize): SubtitleStyle {
  // 计算缩放比例（基于高度）
  const scale = videoSize.height / BASE_HEIGHT

  // 计算缩放后的字号
  const fontSize = Math.round(DEFAULT_SUBTITLE_STYLE.fontSize * scale)

  // 按比例计算边距（5% of 视频高度/宽度）
  const marginV = Math.round(videoSize.height * MARGIN_RATIO)
  const marginH = Math.round(videoSize.width * MARGIN_RATIO)

  // 计算每行最大字符数
  const maxCharsPerLine = calculateMaxChars(videoSize.width, fontSize)

  return {
    fontPath: getFontPath(),
    fontName: getFontName(),
    fontSize,
    primaryColor: DEFAULT_SUBTITLE_STYLE.primaryColor,
    outlineColor: DEFAULT_SUBTITLE_STYLE.outlineColor,
    outlineWidth: Math.max(1, Math.round(DEFAULT_SUBTITLE_STYLE.outlineWidth * scale)),
    shadowColor: DEFAULT_SUBTITLE_STYLE.shadowColor,
    shadowDepth: Math.max(1, Math.round(DEFAULT_SUBTITLE_STYLE.shadowDepth * scale)),
    marginV,
    marginH,
    maxCharsPerLine,
  }
}

/**
 * 合并自定义样式与自适应样式
 *
 * @param videoSize 视频尺寸
 * @param customStyle 自定义样式（可选）
 * @returns 合并后的完整样式
 */
export function mergeStyles(
  videoSize: VideoSize,
  customStyle?: Partial<SubtitleStyle>,
): SubtitleStyle {
  const adaptiveStyle = calculateAdaptiveStyle(videoSize)

  if (!customStyle) return adaptiveStyle

  return {
    ...adaptiveStyle,
    ...customStyle,
    // 确保字体路径始终使用系统检测的路径
    fontPath: adaptiveStyle.fontPath,
    fontName: adaptiveStyle.fontName,
  }
}
