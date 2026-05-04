import { getWhisperCppRuntimeStatus } from '@/lib/asr/runtime-status'
import { getMiniMaxCredential, getMiniMaxCredentialStatus } from '@/lib/dubbing/minimax-credentials'
import { readMiniMaxVoiceRegistryEntries } from '@/lib/dubbing/minimax-voice-registry-store'
import { getDubbingRuntimeStatus } from '@/lib/dubbing/runtime-status'
import { getIngestRuntimeStatus } from '@/lib/ingest/runtime-status'
import {
  getActiveAsrProviderId,
  getActiveLlmProviderId,
  listAsrProviders,
  listLlmProviders,
} from '@/lib/providers/registry'
import {
  buildRequirementStatuses,
  buildToolSetupReadiness,
  type SetupRequirementId,
  type SetupRequirementStatus,
  type SetupRequirementStatusInput,
  type ToolSetupReadiness,
} from './setup-requirements'
import { getDashboardTools } from './tool-catalog'

export interface SetupRequirementsSnapshot {
  readonly requirements: readonly SetupRequirementStatus[]
  readonly tools: readonly ToolSetupReadiness[]
}

interface ProviderAvailability {
  readonly id: string
  readonly label: string
  readonly available: boolean
}

export async function getSetupRequirementsSnapshot(): Promise<SetupRequirementsSnapshot> {
  const readinessByRequirement = await resolveSetupRequirementReadiness()
  const requirementsById = buildRequirementStatuses(readinessByRequirement)

  return {
    requirements: Object.values(requirementsById),
    tools: buildToolSetupReadiness(getDashboardTools(), requirementsById),
  }
}

async function resolveSetupRequirementReadiness(): Promise<
  Record<SetupRequirementId, SetupRequirementStatusInput>
> {
  const [llmProviders, asrProviders] = await Promise.all([
    listProviderAvailability(listLlmProviders()),
    listProviderAvailability(listAsrProviders()),
  ])
  const activeLlmId = getActiveLlmProviderId()
  const activeAsrId = getActiveAsrProviderId()
  const ingestStatus = getIngestRuntimeStatus()
  const dubbingStatus = getDubbingRuntimeStatus()
  const whisperCppStatus = getWhisperCppRuntimeStatus()
  const miniMaxStatus = getMiniMaxCredentialStatus()
  const miniMaxCredential = getMiniMaxCredential()
  const voiceRegistryEntries = readMiniMaxVoiceRegistryEntries()

  const ffmpeg = findCheck(ingestStatus.checks, 'INGEST_FFMPEG_EXE / DUBBING_FFMPEG_EXE')
  const ytDlp = findCheck(ingestStatus.checks, 'INGEST_YTDLP_EXE')
  const wav2lipScript = findCheck(dubbingStatus.checks, 'Wav2Lip inference.py')
  const wav2lipCheckpoint = findCheck(dubbingStatus.checks, 'Wav2Lip checkpoint')

  const miniMaxReady = miniMaxStatus.configured && Boolean(miniMaxCredential?.voiceId)
  const wav2lipReady = wav2lipScript?.exists === true && wav2lipCheckpoint?.exists === true

  return {
    llm: providerReadiness(llmProviders, activeLlmId, 'LLM provider'),
    'minimax-tts': {
      state: miniMaxReady ? 'ready' : 'missing',
      detail: miniMaxReady
        ? describeVerification('MiniMax TTS', miniMaxStatus.verification_state)
        : miniMaxStatus.configured
          ? 'MiniMax API Key 已配置，但默认 voice_id 尚未配置。'
          : miniMaxStatus.detail,
    },
    asr: {
      ...providerReadiness(asrProviders, activeAsrId, 'ASR provider'),
      detail: asrDetail(
        providerReadiness(asrProviders, activeAsrId, 'ASR provider'),
        whisperCppStatus.ready,
        whisperCppStatus.guidance,
      ),
    },
    ffmpeg: {
      state: ffmpeg?.exists ? 'ready' : 'missing',
      detail: ffmpeg?.exists ? 'ffmpeg 已在 PATH 或环境变量中找到。' : '未找到 ffmpeg。',
    },
    'yt-dlp': {
      state: ytDlp?.exists ? 'ready' : 'missing',
      detail: ytDlp?.exists ? 'yt-dlp 已在 PATH 或环境变量中找到。' : '未找到 yt-dlp。',
    },
    'voice-registry': {
      state: voiceRegistryEntries.length > 0 ? 'ready' : 'missing',
      detail:
        voiceRegistryEntries.length > 0
          ? `声线库已有 ${voiceRegistryEntries.length} 条记录。`
          : '声线库尚未登记常用声线。',
    },
    wav2lip: {
      state: wav2lipReady ? 'ready' : 'missing',
      detail: wav2lipReady
        ? 'Wav2Lip inference.py 与 checkpoint 均已找到。'
        : 'Wav2Lip inference.py 或 checkpoint 未配置。',
    },
  }
}

async function listProviderAvailability(
  providers: readonly {
    readonly id: string
    readonly displayName: string
    isAvailable(): Promise<boolean>
  }[],
): Promise<ProviderAvailability[]> {
  return Promise.all(
    providers.map(async (provider) => ({
      id: provider.id,
      label: provider.displayName,
      available: await provider.isAvailable(),
    })),
  )
}

function providerReadiness(
  providers: readonly ProviderAvailability[],
  activeId: string,
  label: string,
): SetupRequirementStatusInput {
  const active = providers.find((provider) => provider.id === activeId)
  const alternatives = providers.filter(
    (provider) => provider.available && provider.id !== activeId,
  )

  if (active?.available) {
    return { state: 'ready', detail: `当前 ${label}：${active.label} 已就绪。` }
  }

  if (alternatives.length > 0) {
    return {
      state: 'missing',
      detail: `当前 ${label} 未就绪；可切换到 ${alternatives.map((p) => p.label).join('、')}。`,
    }
  }

  return {
    state: 'missing',
    detail: `当前没有可用的 ${label}。`,
  }
}

function asrDetail(
  readiness: SetupRequirementStatusInput,
  whisperReady: boolean,
  whisperGuidance: string | undefined,
): string {
  if (readiness.state === 'ready') return readiness.detail || 'ASR provider 已就绪。'
  if (!whisperReady && whisperGuidance) return whisperGuidance
  return readiness.detail || '当前没有可用的 ASR provider。'
}

function findCheck<T extends { readonly name: string }>(
  checks: readonly T[],
  name: string,
): T | undefined {
  return checks.find((check) => check.name === name)
}

function describeVerification(label: string, state: string): string {
  if (state === 'verified') return `${label} 已配置，并已通过一次真实验证。`
  if (state === 'saved_unverified') return `${label} 已保存，尚未执行真实验证。`
  if (state === 'not_tracked') return `${label} 来自环境变量或本地文件，设置页未记录验证。`
  return `${label} 已配置。`
}
