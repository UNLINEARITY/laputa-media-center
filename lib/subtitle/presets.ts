/**
 * 字幕样式预设库（Phase 3.C-D）
 *
 * 4 套预设全部基于 Noto Sans SC family（resource/fonts/ 已含 Bold + Regular），
 * 通过 fontSize / 顏色 / outline / shadow / Bold-vs-Regular 差异化。
 * 不引入新字体，零 license 风险。
 */

import { calculateAdaptiveStyle, getFontName, getFontPath } from './adaptive-size'
import {
  BASE_HEIGHT,
  DEFAULT_SUBTITLE_STYLE,
  type SubtitleFontFile,
  type SubtitlePresetId,
  type SubtitlePresetMeta,
  type SubtitleStyle,
  type VideoSize,
} from './types'

interface PresetDefinition {
  meta: SubtitlePresetMeta
  fontFile: SubtitleFontFile
  baseStyle: Omit<SubtitleStyle, 'fontPath' | 'fontName' | 'marginH'>
}

const SUBTITLE_PRESETS: Record<SubtitlePresetId, PresetDefinition> = {
  default: {
    meta: {
      id: 'default',
      displayName: '默认（白字黑边）',
      description: '通用百搭，与项目历史样式对齐',
      tags: ['通用', '保守'],
      scenarios: ['翻译配音', '播客封面字幕', '高亮短片'],
      preview: {
        primaryColor: '#FFFFFF',
        outlineColor: '#000000',
        backgroundHint: 'bg-claude-dark-700',
      },
    },
    fontFile: 'NotoSansSC-Bold.ttf',
    baseStyle: { ...DEFAULT_SUBTITLE_STYLE },
  },

  cantonese_trendy: {
    meta: {
      id: 'cantonese_trendy',
      displayName: '粤语潮流',
      description: '黄字紫边，年轻潮酷，B 站 / 抖音粤语圈',
      tags: ['年轻', '潮酷', '粤语'],
      scenarios: ['粤语短视频', '搞笑剪辑', '生活向 vlog'],
      preview: {
        primaryColor: '#FFFF00',
        outlineColor: '#9D00FF',
        backgroundHint: 'bg-purple-700',
      },
    },
    fontFile: 'NotoSansSC-Bold.ttf',
    baseStyle: {
      fontSize: 56,
      primaryColor: '&H0000FFFF', // 黄
      outlineColor: '&H80FF009D', // 半透紫
      outlineWidth: 4,
      shadowColor: '&H00000000',
      shadowDepth: 0,
      marginV: 80,
      maxCharsPerLine: 16,
    },
  },

  serious_political: {
    meta: {
      id: 'serious_political',
      displayName: '严肃政论',
      description: '白字黑边 + 阴影，新闻 / 时评 / 政论稿',
      tags: ['严肃', '新闻', '正式'],
      scenarios: ['名人政客视频解读', '观点稿播报', '深度评论'],
      preview: {
        primaryColor: '#FFFFFF',
        outlineColor: '#000000',
        backgroundHint: 'bg-claude-dark-900',
      },
    },
    fontFile: 'NotoSansSC-Regular.ttf',
    baseStyle: {
      fontSize: 44,
      primaryColor: '&H00FFFFFF', // 白
      outlineColor: '&H00000000', // 黑
      outlineWidth: 2,
      shadowColor: '&H80000000', // 半透黑
      shadowDepth: 3,
      marginV: 54,
      maxCharsPerLine: 20,
    },
  },

  variety_explainer: {
    meta: {
      id: 'variety_explainer',
      displayName: '解说综艺',
      description: '大字黄底 + 绿阴影，搞笑解说 / 综艺剪辑',
      tags: ['搞笑', '综艺', '夸张'],
      scenarios: ['解说视频', '综艺剪辑', '反应视频'],
      preview: {
        primaryColor: '#FFFF00',
        outlineColor: '#000000',
        backgroundHint: 'bg-emerald-700',
      },
    },
    fontFile: 'NotoSansSC-Bold.ttf',
    baseStyle: {
      fontSize: 60,
      primaryColor: '&H0000FFFF', // 黄
      outlineColor: '&H00000000', // 黑
      outlineWidth: 5,
      shadowColor: '&H8000FF00', // 半透绿
      shadowDepth: 4,
      marginV: 100,
      maxCharsPerLine: 14,
    },
  },

  xhs_fresh: {
    meta: {
      id: 'xhs_fresh',
      displayName: '小红书清新',
      description: '白字粉紫边，柔和女性向，小红书 / 生活向',
      tags: ['清新', '女性向', '柔和'],
      scenarios: ['生活向短视频', '小红书图文', '美妆 / 穿搭'],
      preview: {
        primaryColor: '#FFFFFF',
        outlineColor: '#C49AF1',
        backgroundHint: 'bg-pink-200',
      },
    },
    fontFile: 'NotoSansSC-Regular.ttf',
    baseStyle: {
      fontSize: 50,
      primaryColor: '&H00FFFFFF', // 白
      outlineColor: '&H00F19AC4', // 淡粉紫（AABBGGRR：F1=R 9A=G C4=B）
      outlineWidth: 3,
      shadowColor: '&H40F19AC4', // 25% 透明粉紫
      shadowDepth: 2,
      marginV: 70,
      maxCharsPerLine: 18,
    },
  },
}

/**
 * 列出所有 preset（UI 用）
 */
export function listSubtitlePresets(): SubtitlePresetMeta[] {
  return Object.values(SUBTITLE_PRESETS).map((p) => p.meta)
}

/**
 * 取 preset meta（单个）
 */
export function getSubtitlePresetMeta(id: SubtitlePresetId): SubtitlePresetMeta | null {
  return SUBTITLE_PRESETS[id]?.meta ?? null
}

/**
 * 解析 preset → 完整 SubtitleStyle（按 1080p 缩放 + 注入 fontPath/fontName）
 *
 * 与 calculateAdaptiveStyle 同一缩放规则（按视频高度 / BASE_HEIGHT 缩放数值字段）。
 */
export function resolvePresetStyle(
  presetId: SubtitlePresetId,
  videoSize: VideoSize,
): SubtitleStyle {
  const preset = SUBTITLE_PRESETS[presetId]
  if (!preset) {
    // 未知 preset，退回默认（calculateAdaptiveStyle 已含 DEFAULT_SUBTITLE_STYLE）
    return calculateAdaptiveStyle(videoSize)
  }

  const scale = videoSize.height / BASE_HEIGHT
  const base = preset.baseStyle

  return {
    fontPath: getFontPath(preset.fontFile),
    fontName: getFontName(preset.fontFile),
    fontSize: Math.round(base.fontSize * scale),
    primaryColor: base.primaryColor,
    outlineColor: base.outlineColor,
    outlineWidth: Math.max(1, Math.round(base.outlineWidth * scale)),
    shadowColor: base.shadowColor,
    shadowDepth: Math.max(0, Math.round(base.shadowDepth * scale)),
    marginV: Math.round(videoSize.height * 0.05),
    marginH: Math.round(videoSize.width * 0.05),
    maxCharsPerLine: base.maxCharsPerLine,
  }
}
