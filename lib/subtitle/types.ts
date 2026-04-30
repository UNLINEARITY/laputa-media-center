/**
 * 字幕模块类型定义
 */

// ============================================================================
// 视频信息
// ============================================================================

/** 视频尺寸信息 */
export interface VideoSize {
  width: number
  height: number
}

// ============================================================================
// 字幕样式
// ============================================================================

/** 字幕样式配置 */
export interface SubtitleStyle {
  /** 字体文件绝对路径 */
  fontPath: string
  /** 字体名称（ASS 中使用，不含路径和扩展名） */
  fontName: string
  /** 字号（像素，基于 1080p 缩放） */
  fontSize: number
  /** 文字颜色（ASS 格式 &HAABBGGRR） */
  primaryColor: string
  /** 描边颜色 */
  outlineColor: string
  /** 描边宽度（像素） */
  outlineWidth: number
  /** 阴影颜色 */
  shadowColor: string
  /** 阴影深度（像素） */
  shadowDepth: number
  /** 底部边距（像素） */
  marginV: number
  /** 左右边距（像素） */
  marginH: number
  /** 每行最大字符数（用于换行计算） */
  maxCharsPerLine: number
}

// ============================================================================
// 字幕生成配置
// ============================================================================

/** 字幕生成配置 */
export interface SubtitleConfig {
  /** 原始文本 */
  text: string
  /** 视频时长（秒） */
  duration: number
  /** 视频分辨率 */
  videoSize: VideoSize
  /** 可选样式覆盖（与 presetId 互斥；都传时 style 覆盖优先） */
  style?: Partial<SubtitleStyle>
  /** Phase 3.C-D：字幕样式预设 ID，缺省走 DEFAULT_SUBTITLE_STYLE */
  presetId?: SubtitlePresetId
}

// ============================================================================
// Phase 3.C-D：字幕样式预设
// ============================================================================

/**
 * 字幕预设 ID 列表（source of truth）
 * Phase 3.C-A 收尾：API route + zod schema 全部派生自这里
 */
export const SUBTITLE_PRESET_IDS = [
  'default',
  'cantonese_trendy',
  'serious_political',
  'variety_explainer',
  'xhs_fresh',
] as const

/** 字幕预设 ID */
export type SubtitlePresetId = (typeof SUBTITLE_PRESET_IDS)[number]

/** 预设元数据（UI 列出 + 描述） */
export interface SubtitlePresetMeta {
  id: SubtitlePresetId
  displayName: string
  description: string
  tags: string[]
  scenarios: string[]
  /** UI 预览：色块演示 */
  preview: {
    primaryColor: string
    outlineColor: string
    backgroundHint: string
  }
}

/** 字体文件名（NotoSansSC-Bold.ttf / NotoSansSC-Regular.ttf） */
export type SubtitleFontFile = 'NotoSansSC-Bold.ttf' | 'NotoSansSC-Regular.ttf'

// ============================================================================
// 默认配置
// ============================================================================

/** 基准分辨率（1080p） */
export const BASE_HEIGHT = 1080

/** 默认字体文件名（Bold 字重，中英文视觉更统一） */
export const DEFAULT_FONT_FILE = 'NotoSansSC-Bold.ttf'

/** 默认字幕样式（基于 1080p） */
export const DEFAULT_SUBTITLE_STYLE: Omit<SubtitleStyle, 'fontPath' | 'fontName' | 'marginH'> = {
  fontSize: 48, // 1080p 基准字号（更小巧精致）
  primaryColor: '&H00FFFFFF', // 白色（AABBGGRR 格式，00=不透明）
  outlineColor: '&H00000000', // 黑色描边
  outlineWidth: 2, // 描边宽度
  shadowColor: '&H80000000', // 50% 透明黑色阴影
  shadowDepth: 2, // 阴影深度
  marginV: 54, // 底部边距（5% of 1080p，实际按比例计算）
  maxCharsPerLine: 18, // 每行约 18 个中文字符
}
