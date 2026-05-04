import type { ToolEntry, ToolId, ToolStatus } from './tool-catalog'

export type SetupRequirementId =
  | 'llm'
  | 'minimax-tts'
  | 'asr'
  | 'ffmpeg'
  | 'yt-dlp'
  | 'voice-registry'
  | 'wav2lip'

export type SetupRequirementCategory = 'provider' | 'runtime' | 'asset'

export type SetupRequirementReadinessState = 'ready' | 'missing' | 'unknown'

export type ToolSetupReadinessState = 'ready' | 'blocked' | 'degraded'

export interface SetupRequirementDefinition {
  readonly id: SetupRequirementId
  readonly label: string
  readonly category: SetupRequirementCategory
  readonly description: string
  readonly setupHref: string
  readonly missingHint: string
}

export interface SetupRequirementStatus extends SetupRequirementDefinition {
  readonly state: SetupRequirementReadinessState
  readonly ready: boolean
  readonly detail: string
}

export interface SetupRequirementStatusInput {
  readonly state: SetupRequirementReadinessState
  readonly detail?: string
}

export interface ToolSetupReadiness {
  readonly id: ToolId
  readonly label: string
  readonly href: string
  readonly status: ToolStatus
  readonly shortDescription: string
  readonly readiness: ToolSetupReadinessState
  readonly required: readonly SetupRequirementStatus[]
  readonly optional: readonly SetupRequirementStatus[]
  readonly missingRequired: readonly SetupRequirementStatus[]
  readonly missingOptional: readonly SetupRequirementStatus[]
  readonly summary: string
}

export const SETUP_REQUIREMENTS = {
  llm: {
    id: 'llm',
    label: 'LLM 引擎',
    category: 'provider',
    description: '两阶段翻译、脚本改写、标题钩子和高亮判断使用的文本理解后端。',
    setupHref: '/settings#llm-provider',
    missingHint: '配置并切换到一个可用的 Gemini / OpenAI-compatible / Claude provider。',
  },
  'minimax-tts': {
    id: 'minimax-tts',
    label: 'MiniMax TTS',
    category: 'provider',
    description: '正式中文配音与播客音频输出的主力声线服务。',
    setupHref: '/settings#minimax_tts',
    missingHint: '保存 MiniMax API Key，并填入默认 voice_id。',
  },
  asr: {
    id: 'asr',
    label: 'ASR 转录',
    category: 'provider',
    description: '把音视频转成转录稿的本地或云端语音识别引擎。',
    setupHref: '/settings#asr-provider',
    missingHint: '安装 whisper.cpp，或切换到已配置的 Gemini Audio provider。',
  },
  ffmpeg: {
    id: 'ffmpeg',
    label: 'ffmpeg',
    category: 'runtime',
    description: '本地音视频抽取、剪切、拼接和字幕烧录运行时。',
    setupHref: '/settings#maintenance',
    missingHint: '安装 ffmpeg，或设置 INGEST_FFMPEG_EXE / DUBBING_FFMPEG_EXE。',
  },
  'yt-dlp': {
    id: 'yt-dlp',
    label: 'yt-dlp',
    category: 'runtime',
    description: '读取 YouTube 链接时使用的本地下载器。',
    setupHref: '/settings#maintenance',
    missingHint: '安装 yt-dlp，或设置 INGEST_YTDLP_EXE。',
  },
  'voice-registry': {
    id: 'voice-registry',
    label: '声线库',
    category: 'asset',
    description: '保存常用 voice_id、授权边界和公示标签的本地声线资产。',
    setupHref: '/settings#creator_assets',
    missingHint: '在创作者资产中登记至少一条常用声线。',
  },
  wav2lip: {
    id: 'wav2lip',
    label: 'Wav2Lip',
    category: 'runtime',
    description: '可选的人物口型同步运行时。',
    setupHref: '/settings#maintenance',
    missingHint: '配置 Wav2Lip inference.py 和 wav2lip_gan.pth checkpoint。',
  },
} as const satisfies Record<SetupRequirementId, SetupRequirementDefinition>

export const SETUP_REQUIREMENT_IDS = Object.keys(
  SETUP_REQUIREMENTS,
) as readonly SetupRequirementId[]

export function getSetupRequirementDefinition(id: SetupRequirementId): SetupRequirementDefinition {
  return SETUP_REQUIREMENTS[id]
}

export function buildRequirementStatuses(
  readinessByRequirement: Record<SetupRequirementId, SetupRequirementStatusInput>,
): Record<SetupRequirementId, SetupRequirementStatus> {
  return Object.fromEntries(
    SETUP_REQUIREMENT_IDS.map((id) => {
      const definition = getSetupRequirementDefinition(id)
      const readiness = readinessByRequirement[id]
      const status: SetupRequirementStatus = {
        ...definition,
        state: readiness.state,
        ready: readiness.state === 'ready',
        detail: readiness.detail || definition.missingHint,
      }
      return [id, status]
    }),
  ) as Record<SetupRequirementId, SetupRequirementStatus>
}

export function buildToolSetupReadiness(
  tools: readonly ToolEntry[],
  requirements: Record<SetupRequirementId, SetupRequirementStatus>,
): readonly ToolSetupReadiness[] {
  return tools.map((tool) => {
    const required = tool.requiredSetup.map((id) => requirements[id])
    const optional = tool.optionalSetup.map((id) => requirements[id])
    const missingRequired = required.filter((requirement) => !requirement.ready)
    const missingOptional = optional.filter((requirement) => !requirement.ready)
    const readiness: ToolSetupReadinessState =
      missingRequired.length > 0 ? 'blocked' : missingOptional.length > 0 ? 'degraded' : 'ready'

    return {
      id: tool.id,
      label: tool.label,
      href: tool.href,
      status: tool.status,
      shortDescription: tool.shortDescription,
      readiness,
      required,
      optional,
      missingRequired,
      missingOptional,
      summary: summarizeToolReadiness(readiness, missingRequired, missingOptional),
    }
  })
}

function summarizeToolReadiness(
  readiness: ToolSetupReadinessState,
  missingRequired: readonly SetupRequirementStatus[],
  missingOptional: readonly SetupRequirementStatus[],
): string {
  if (readiness === 'blocked') {
    return `缺 ${missingRequired.length} 项必需设置`
  }
  if (readiness === 'degraded') {
    return `可运行，缺 ${missingOptional.length} 项可选增强`
  }
  return '可直接运行'
}
