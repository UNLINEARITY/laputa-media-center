import { configsRepo } from '@/lib/db/core/configs'
import { parseCreatorProfileConfig } from '@/lib/dubbing/creator-profile'
import {
  getMiniMaxCredential,
  getMiniMaxCredentialStatus,
  type MiniMaxCredentialStatus,
} from '@/lib/dubbing/minimax-credentials'
import { readMiniMaxVoiceRegistryEntries } from '@/lib/dubbing/minimax-voice-registry-store'
import type { DubbingRuntimeStatus } from '@/lib/dubbing/runtime-status'
import { getDubbingRuntimeStatus } from '@/lib/dubbing/runtime-status'
import {
  type DubbingTranslationCredentialStatus,
  type DubbingTranslationRuntimeSummary,
  getDubbingTranslationCredentialStatus,
} from '@/lib/dubbing/translation-credentials'
import type { MiniMaxVoiceRegistryEntry } from '@/lib/dubbing/voice-registry'
import type { IngestRuntimeStatus } from '@/lib/ingest/runtime-status'
import { getIngestRuntimeStatus } from '@/lib/ingest/runtime-status'
import {
  getRequiredProviderConfirmationsFromGates,
  type ProviderGateConfirmationValidation,
  validateProviderGateConfirmations,
} from './provider-gate-confirmation'

// ============================================================
// 类型定义（保持向后兼容；8 个外部 consumer 序列化依赖）
// ============================================================

export type ReadinessTone = 'ready' | 'warning' | 'blocked'
export type ClosedLoopRuntimeReadinessLevel = 'blocked' | 'dry_run' | 'live'
export type ClosedLoopProviderRuntime = 'ingest' | 'dubbing'
export type ClosedLoopProviderName = 'yt_dlp' | 'whisper' | 'gemini' | 'minimax' | 'wav2lip'
export type ClosedLoopProviderCapability =
  | 'download'
  | 'transcribe'
  | 'translate'
  | 'tts'
  | 'lipsync'

export interface ClosedLoopReadinessStage {
  id: string
  label: string
  status: ReadinessTone
  detail: string
  missing: string[]
}

export type ClosedLoopProviderRunMode = 'real' | 'dry_run' | 'blocked' | 'optional_skip'

export interface ClosedLoopProviderGate {
  id: string
  label: string
  runtime: ClosedLoopProviderRuntime
  provider: ClosedLoopProviderName
  capability: ClosedLoopProviderCapability
  status: ReadinessTone
  run_mode: ClosedLoopProviderRunMode
  detail: string
  blockers: string[]
  risk: { external_call: boolean; may_spend_money: boolean; writes_artifacts: boolean }
  confirmation: { required: boolean; id?: string; label?: string }
  dry_run_available: boolean
  live_run_available: boolean
  external_call: boolean
  may_spend_money: boolean
  requires_confirmation: boolean
  confirmation_label?: string
}

export interface ClosedLoopDeliveryAuditReadiness {
  ready: boolean
  status: ReadinessTone
  label: string
  guidance: string
  missing: string[]
}

export interface ClosedLoopReadiness {
  production_ready: boolean
  smoke_ready: boolean
  dry_run_ready: boolean
  runtime_ready: boolean
  runtime_readiness_level: ClosedLoopRuntimeReadinessLevel
  delivery_audit_ready: boolean
  delivery_audit: ClosedLoopDeliveryAuditReadiness
  provider_smoke_ready: boolean
  provider_smoke_requires_confirmation: boolean
  youtube_ready: boolean
  lipsync_ready: boolean
  voice_metadata_ready: boolean
  translation_configured: boolean
  translation_credential_status: ClosedLoopTranslationCredentialStatus
  passthrough_translation_allowed: boolean
  tts_configured: boolean
  tts_credential_status: ClosedLoopTtsCredentialStatus
  placeholder_tts_allowed: boolean
  summary_label: string
  guidance: string
  missing_required: string[]
  required_confirmations: string[]
  stages: ClosedLoopReadinessStage[]
  provider_gates: ClosedLoopProviderGate[]
}

export type ClosedLoopProviderConfirmationValidation = ProviderGateConfirmationValidation
export type ClosedLoopTtsCredentialStatus = Omit<MiniMaxCredentialStatus, 'path'>
export type ClosedLoopTranslationCredentialStatus = DubbingTranslationCredentialStatus

export interface BuildClosedLoopReadinessInput {
  ingest: IngestRuntimeStatus
  dubbing: DubbingRuntimeStatus
  translationConfigured: boolean
  passthroughTranslationAllowed?: boolean
  ttsConfigured: boolean
  creatorDefaultVoiceId?: string
  voiceRegistryEntries?: readonly Pick<
    MiniMaxVoiceRegistryEntry,
    'voice_id' | 'category' | 'requires_disclosure' | 'usage_label'
  >[]
  placeholderTtsAllowed?: boolean
  translationCredentialStatus?: ClosedLoopTranslationCredentialStatus
  ttsCredentialStatus?: ClosedLoopTtsCredentialStatus
}

export interface GetClosedLoopReadinessOptions {
  voiceRegistryEntries?: BuildClosedLoopReadinessInput['voiceRegistryEntries']
}

// ============================================================
// 公开 API
// ============================================================

export function validateClosedLoopProviderConfirmations(
  readiness: Pick<ClosedLoopReadiness, 'required_confirmations'>,
  confirmedGateIds: readonly string[] | undefined,
  requiredConfirmations = readiness.required_confirmations,
  knownConfirmations = readiness.required_confirmations,
): ClosedLoopProviderConfirmationValidation {
  return validateProviderGateConfirmations({
    requiredConfirmations,
    knownConfirmations,
    confirmedGateIds,
  })
}

// ============================================================
// 辅助函数（精简后）
// ============================================================

const findCheck = (checks: { name: string; exists: boolean }[], name: string) =>
  checks.find((c) => c.name === name)

const statusFromMissing = (required: string[], warning: boolean): ReadinessTone =>
  required.length > 0 ? 'blocked' : warning ? 'warning' : 'ready'

interface ProviderGateInput {
  id: string
  label: string
  runtime: ClosedLoopProviderRuntime
  provider: ClosedLoopProviderName
  capability: ClosedLoopProviderCapability
  liveReady: boolean
  dryRunReady?: boolean
  optionalSkip?: boolean
  liveDetail: string
  dryRunDetail?: string
  blockedDetail: string
  blockers: string[]
  externalCall?: boolean
  maySpendMoney?: boolean
  writesArtifacts?: boolean
  confirmationId?: string
  confirmationLabel?: string
}

function buildProviderGate(opt: ProviderGateInput): ClosedLoopProviderGate {
  const dryRunReady = opt.dryRunReady === true
  const optionalSkip = opt.optionalSkip === true
  const runMode: ClosedLoopProviderRunMode = opt.liveReady
    ? 'real'
    : dryRunReady
      ? 'dry_run'
      : optionalSkip
        ? 'optional_skip'
        : 'blocked'
  const externalCall = opt.externalCall === true && opt.liveReady
  const maySpendMoney = opt.maySpendMoney === true && opt.liveReady
  const writesArtifacts =
    opt.writesArtifacts === true && (opt.liveReady || dryRunReady || optionalSkip)
  const requiresConfirmation = externalCall || maySpendMoney
  const detail = opt.liveReady
    ? opt.liveDetail
    : dryRunReady
      ? opt.dryRunDetail || opt.liveDetail
      : opt.blockedDetail

  return {
    id: opt.id,
    label: opt.label,
    runtime: opt.runtime,
    provider: opt.provider,
    capability: opt.capability,
    status: opt.liveReady ? 'ready' : dryRunReady || optionalSkip ? 'warning' : 'blocked',
    run_mode: runMode,
    detail,
    blockers: opt.liveReady ? [] : opt.blockers,
    risk: {
      external_call: externalCall,
      may_spend_money: maySpendMoney,
      writes_artifacts: writesArtifacts,
    },
    confirmation: {
      required: requiresConfirmation,
      id: requiresConfirmation ? opt.confirmationId || opt.id : undefined,
      label: requiresConfirmation ? opt.confirmationLabel : undefined,
    },
    dry_run_available: dryRunReady,
    live_run_available: opt.liveReady,
    external_call: externalCall,
    may_spend_money: maySpendMoney,
    requires_confirmation: requiresConfirmation,
    confirmation_label: requiresConfirmation ? opt.confirmationLabel : undefined,
  }
}

const hasVoiceDisclosureMetadata = (
  e: Pick<MiniMaxVoiceRegistryEntry, 'voice_id' | 'category' | 'requires_disclosure' | 'usage_label'>,
) =>
  Boolean(
    e.voice_id.trim() &&
      e.category &&
      typeof e.requires_disclosure === 'boolean' &&
      e.usage_label.trim(),
  )

function buildVoiceMetadataStage(input: {
  ttsConfigured: boolean
  creatorDefaultVoiceId?: string
  registryEntries?: readonly Pick<
    MiniMaxVoiceRegistryEntry,
    'voice_id' | 'category' | 'requires_disclosure' | 'usage_label'
  >[]
}): ClosedLoopReadinessStage & { ready: boolean } {
  const entries = input.registryEntries || []
  const defaultVoiceId = input.creatorDefaultVoiceId?.trim()
  const hasDefaultOrRegistry = Boolean(defaultVoiceId) || entries.length > 0
  const hasDisclosure = entries.some(hasVoiceDisclosureMetadata)
  const missing = [
    ...(input.ttsConfigured ? [] : ['MiniMax TTS 凭证']),
    ...(hasDefaultOrRegistry ? [] : ['创作者默认声线或本地声线注册表']),
    ...(hasDisclosure ? [] : ['声线用途/披露元数据']),
  ]
  const ready = input.ttsConfigured && hasDefaultOrRegistry && hasDisclosure

  return {
    id: 'voice_metadata',
    label: '声线元数据与披露',
    status: ready ? 'ready' : 'warning',
    detail: ready
      ? `已登记 ${entries.length} 条声线元数据，可在交付 README、QA 和报告中追踪用途与披露。`
      : input.ttsConfigured
        ? 'MiniMax 可用于配音，但声线用途或披露元数据不完整；正式交付前建议补齐本地声线注册表。'
        : 'MiniMax 尚未配置；声线用途和披露元数据暂不能用于正式交付审计。',
    missing,
    ready,
  }
}

function buildDeliveryAuditReadiness(p: {
  productionReady: boolean
  voiceMetadataReady: boolean
  voiceMetadataMissing: string[]
}): ClosedLoopDeliveryAuditReadiness {
  if (!p.productionReady) {
    return {
      ready: false,
      status: 'blocked',
      label: '交付审计未就绪',
      guidance: '运行链路还未达到正式成片条件，先补齐阻断项再做交付审计。',
      missing: [],
    }
  }
  if (!p.voiceMetadataReady) {
    return {
      ready: false,
      status: 'warning',
      label: '可跑，待审计',
      guidance:
        '运行链路已可跑正式成片，但声线用途或披露元数据不完整；交付前应补齐本地声线注册表。',
      missing: p.voiceMetadataMissing,
    }
  }
  return {
    ready: true,
    status: 'ready',
    label: '交付审计就绪',
    guidance: '运行链路和声线披露元数据都已就绪，可进入正式交付检查。',
    missing: [],
  }
}

// fallback credential 状态（合并 TTS / Translation 的对称实现）
const emptyTranslationRuntime = (): DubbingTranslationRuntimeSummary => ({
  provider: 'gemini',
  api_key_source: null,
  model_id: null,
  model_source: null,
  api_base_url_configured: false,
  api_base_url_source: null,
})

const fallbackTtsCredential = (configured: boolean): ClosedLoopTtsCredentialStatus =>
  configured
    ? {
        configured: true,
        verified: false,
        source: null,
        verification_state: 'not_tracked',
        detail: 'MiniMax 凭证已配置，但当前 readiness 输入没有付费验证记录。',
      }
    : {
        configured: false,
        verified: false,
        source: null,
        verification_state: 'missing',
        detail: '未配置 MiniMax TTS 凭证。',
      }

const fallbackTranslationCredential = (
  configured: boolean,
): ClosedLoopTranslationCredentialStatus =>
  configured
    ? {
        configured: true,
        verified: false,
        source: null,
        verification_state: 'not_tracked',
        detail: 'Gemini 翻译凭证已配置，但当前 readiness 输入没有真实 provider 验证记录。',
        runtime: { ...emptyTranslationRuntime(), api_key_source: 'env:GEMINI_API_KEY' },
      }
    : {
        configured: false,
        verified: false,
        source: null,
        verification_state: 'missing',
        detail: '未配置 Gemini 翻译凭证。',
        runtime: emptyTranslationRuntime(),
      }

// 统一的 stage detail builder（按 verification_state 派生不同语境的描述）
function buildStageDetail(opt: {
  kind: 'translation' | 'tts'
  envMissing: boolean
  credentialMissing: boolean
  bypassAllowed: boolean
  state: ClosedLoopTranslationCredentialStatus['verification_state']
}): string {
  const dict = {
    translation: {
      envMissing: '翻译配音脚本环境未完整。',
      missingBypass: '未配置 Gemini 翻译凭证；已允许原文占位，可做 smoke 但不能算正式本地化。',
      missingNoBypass: '未配置 Gemini 翻译凭证；当前不会创建原文占位任务，需先配置翻译 provider。',
      verified: 'Gemini 翻译凭证已配置并已通过设置页真实 provider 验证，可做口语化翻译。',
      saved: 'Gemini 翻译凭证已保存但未真实 provider 验证；可在任务级费用确认后尝试口语化翻译。',
      notTracked:
        'Gemini 翻译凭证来自环境变量；设置页没有真实 provider 验证记录，可在任务级费用确认后尝试口语化翻译。',
      fallback: 'Gemini 翻译凭证已配置，可在任务级费用确认后尝试口语化翻译。',
    },
    tts: {
      envMissing: '配音脚本环境未完整。',
      missingBypass: '未配置 MiniMax；已允许静音占位，可做 smoke 但不能输出正式配音。',
      missingNoBypass: '未配置 MiniMax；当前不会创建静音占位任务，需先配置 TTS。',
      verified: 'MiniMax TTS 凭证已配置并已通过设置页付费验证，可在确认费用后输出正式配音。',
      saved: 'MiniMax TTS 凭证已保存但未付费验证；可在任务级费用确认后尝试正式配音。',
      notTracked:
        'MiniMax TTS 凭证来自环境变量或本地文件；设置页没有付费验证记录，可在任务级费用确认后尝试正式配音。',
      fallback: 'MiniMax TTS 凭证已配置，可在任务级费用确认后尝试正式配音。',
    },
  } as const
  const t = dict[opt.kind]
  if (opt.envMissing) return t.envMissing
  if (opt.credentialMissing) return opt.bypassAllowed ? t.missingBypass : t.missingNoBypass
  if (opt.state === 'verified') return t.verified
  if (opt.state === 'saved_unverified') return t.saved
  if (opt.state === 'not_tracked') return t.notTracked
  return t.fallback
}

// 统一的 provider gate detail builder（仅 paid TTS / translation 用）
function buildPaidProviderGateDetail(
  kind: 'translation' | 'tts',
  state: ClosedLoopTranslationCredentialStatus['verification_state'],
): string {
  const dict = {
    translation: {
      verified:
        'Gemini 翻译凭证已配置并已通过设置页真实 provider 验证；真实 smoke 会调用外部翻译服务，可能产生费用。',
      saved:
        'Gemini 翻译凭证已保存但未真实 provider 验证；真实 smoke 仍会调用外部翻译服务，可能产生费用。',
      notTracked:
        'Gemini 翻译凭证来自环境变量；设置页没有真实 provider 验证记录，真实 smoke 会调用外部翻译服务并可能产生费用。',
      fallback: '翻译 provider 已配置；真实 smoke 会调用外部翻译服务。',
    },
    tts: {
      verified:
        'MiniMax TTS 已配置并已通过设置页付费验证；真实 smoke 会调用 MiniMax 生成语音，可能产生费用。',
      saved:
        'MiniMax TTS 凭证已保存但未付费验证；真实 smoke 仍会调用 MiniMax 生成语音，可能产生费用。',
      notTracked:
        'MiniMax TTS 凭证来自环境变量或本地文件；设置页没有付费验证记录，真实 smoke 会调用 MiniMax 并可能产生费用。',
      fallback: 'MiniMax TTS 已配置；真实 smoke 会调用 MiniMax 生成语音，可能产生费用。',
    },
  } as const
  const t = dict[kind]
  if (state === 'verified') return t.verified
  if (state === 'saved_unverified') return t.saved
  if (state === 'not_tracked') return t.notTracked
  return t.fallback
}

const getRuntimeReadinessLevel = (p: {
  productionReady: boolean
  smokeReady: boolean
}): ClosedLoopRuntimeReadinessLevel =>
  !p.smokeReady ? 'blocked' : p.productionReady ? 'live' : 'dry_run'

// ============================================================
// 主函数
// ============================================================

export function buildClosedLoopReadiness(
  input: BuildClosedLoopReadinessInput,
): ClosedLoopReadiness {
  const placeholderTtsAllowed = input.placeholderTtsAllowed === true
  const passthroughTranslationAllowed = input.passthroughTranslationAllowed === true

  const translationCredentialStatus =
    input.translationCredentialStatus ??
    fallbackTranslationCredential(input.translationConfigured)
  const translationConfigured = translationCredentialStatus.configured
  const ttsCredentialStatus =
    input.ttsCredentialStatus ?? fallbackTtsCredential(input.ttsConfigured)

  // 缺失项归集
  const ytDlp = findCheck(input.ingest.checks, 'INGEST_YTDLP_EXE')
  const youtubeMissing = [
    ...input.ingest.missing_required,
    ...(ytDlp?.exists ? [] : ['INGEST_YTDLP_EXE']),
  ]
  const youtubeCookiesMissing = !input.ingest.youtube_cookies_configured
  const ingestMissing = input.ingest.missing_required
  const dubbingMissing = input.dubbing.missing_required.filter((n) => n !== 'MiniMax TTS 凭证')
  const translationMissing = translationConfigured ? [] : ['Gemini 翻译凭证']
  const translationBlockingMissing =
    translationConfigured || passthroughTranslationAllowed ? [] : ['Gemini 翻译凭证']
  const ttsMissing = input.ttsConfigured ? [] : ['MiniMax TTS 凭证']
  const ttsBlockingMissing =
    input.ttsConfigured || placeholderTtsAllowed ? [] : ['MiniMax TTS 凭证']
  const wav2lip = findCheck(input.dubbing.checks, 'Wav2Lip inference.py')
  const wav2lipCheckpoint = findCheck(input.dubbing.checks, 'Wav2Lip checkpoint')
  const rvcPython = findCheck(input.dubbing.checks, 'DUBBING_RVC_PYTHON_EXE')
  const lipsyncMissing = [
    ...(rvcPython?.exists ? [] : ['DUBBING_RVC_PYTHON_EXE']),
    ...(wav2lip?.exists ? [] : ['Wav2Lip inference.py']),
    ...(wav2lipCheckpoint?.exists ? [] : ['Wav2Lip checkpoint']),
  ]
  const voiceMetadataStage = buildVoiceMetadataStage({
    ttsConfigured: input.ttsConfigured,
    creatorDefaultVoiceId: input.creatorDefaultVoiceId,
    registryEntries: input.voiceRegistryEntries,
  })

  // 阶段（用户 UI 可读）
  const stages: ClosedLoopReadinessStage[] = [
    {
      id: 'youtube_ingest',
      label: 'YouTube 读取与原片保留',
      status: statusFromMissing(youtubeMissing, youtubeCookiesMissing),
      detail:
        youtubeMissing.length > 0
          ? 'YouTube 任务还不能稳定读取原片。'
          : youtubeCookiesMissing
            ? 'YouTube 可读取；遇到登录、年龄限制或机器人验证时需要 cookies。'
            : 'YouTube 读取、cookies 和原片保留准备就绪。',
      missing:
        youtubeMissing.length > 0
          ? youtubeMissing
          : youtubeCookiesMissing
            ? ['YouTube cookies']
            : [],
    },
    {
      id: 'asr',
      label: 'ASR 与时间码',
      status: statusFromMissing(ingestMissing, false),
      detail:
        ingestMissing.length > 0
          ? 'Whisper/Python 或 ffmpeg 缺失，无法稳定生成转录与时间码。'
          : `Whisper ${input.ingest.whisper_model} 与 ffmpeg 已可用。`,
      missing: ingestMissing,
    },
    {
      id: 'translation',
      label: '口语化翻译',
      status: statusFromMissing(
        [...dubbingMissing, ...translationBlockingMissing],
        translationMissing.length > 0,
      ),
      detail: buildStageDetail({
        kind: 'translation',
        envMissing: dubbingMissing.length > 0,
        credentialMissing: translationMissing.length > 0,
        bypassAllowed: passthroughTranslationAllowed,
        state: translationCredentialStatus.verification_state,
      }),
      missing: [...dubbingMissing, ...translationMissing],
    },
    {
      id: 'tts',
      label: '配音与声线',
      status: statusFromMissing([...dubbingMissing, ...ttsBlockingMissing], ttsMissing.length > 0),
      detail: buildStageDetail({
        kind: 'tts',
        envMissing: dubbingMissing.length > 0,
        credentialMissing: ttsMissing.length > 0,
        bypassAllowed: placeholderTtsAllowed,
        state: ttsCredentialStatus.verification_state,
      }),
      missing: [...dubbingMissing, ...ttsMissing],
    },
    voiceMetadataStage,
    {
      id: 'lipsync',
      label: '口型同步',
      status: lipsyncMissing.length > 0 ? 'warning' : 'ready',
      detail:
        lipsyncMissing.length > 0
          ? 'Wav2Lip 是可选链路；缺失时仍可输出配音和字幕，但不会对口型。'
          : 'Wav2Lip 组件已找到，可尝试对口型输出。',
      missing: lipsyncMissing,
    },
  ]

  const hardMissing = [
    ...new Set([
      ...youtubeMissing,
      ...ingestMissing,
      ...dubbingMissing,
      ...translationBlockingMissing,
      ...ttsBlockingMissing,
    ]),
  ]
  const productionMissing = [...hardMissing, ...translationMissing, ...ttsMissing]
  const smokeReady = hardMissing.length === 0
  const productionReady =
    smokeReady && translationMissing.length === 0 && ttsMissing.length === 0
  const deliveryAudit = buildDeliveryAuditReadiness({
    productionReady,
    voiceMetadataReady: voiceMetadataStage.ready,
    voiceMetadataMissing: voiceMetadataStage.missing,
  })
  const runtimeReadinessLevel = getRuntimeReadinessLevel({ productionReady, smokeReady })
  const youtubeReady = youtubeMissing.length === 0
  const lipsyncReady = lipsyncMissing.length === 0

  // Provider gates（5 家固定 — yt_dlp/whisper/gemini/minimax/wav2lip 是受保护资产边界）
  const providerGates: ClosedLoopProviderGate[] = [
    buildProviderGate({
      id: 'youtube_download',
      label: 'YouTube/yt-dlp 原片读取',
      runtime: 'ingest',
      provider: 'yt_dlp',
      capability: 'download',
      liveReady: youtubeReady,
      liveDetail:
        'yt-dlp 与 ffmpeg 已就绪；真实 provider smoke 只做 YouTube metadata 读取检查，不下载或保留原片。',
      blockedDetail: 'YouTube 原片读取未就绪；先补齐 yt-dlp、ffmpeg 或 Whisper/Python。',
      blockers: youtubeMissing,
      externalCall: true,
      writesArtifacts: true,
      confirmationId: 'youtube_download',
      confirmationLabel: '确认访问 YouTube 并读取测试视频',
    }),
    buildProviderGate({
      id: 'asr',
      label: 'ASR/Whisper 与 ffmpeg',
      runtime: 'ingest',
      provider: 'whisper',
      capability: 'transcribe',
      liveReady: ingestMissing.length === 0,
      liveDetail: `Whisper ${input.ingest.whisper_model} 与 ffmpeg 已可本地运行，不调用付费 provider。`,
      blockedDetail: 'ASR 或 ffmpeg 未就绪；无法生成转录、SRT 和时间码。',
      blockers: ingestMissing,
      writesArtifacts: true,
    }),
    buildProviderGate({
      id: 'translation',
      label: '翻译 provider',
      runtime: 'dubbing',
      provider: 'gemini',
      capability: 'translate',
      liveReady: translationConfigured && dubbingMissing.length === 0,
      dryRunReady: passthroughTranslationAllowed && dubbingMissing.length === 0,
      liveDetail: buildPaidProviderGateDetail(
        'translation',
        translationCredentialStatus.verification_state,
      ),
      dryRunDetail: '未配置翻译 provider；可用原文占位 dry-run 验证流程结构。',
      blockedDetail: '翻译 provider 未配置，且未允许原文占位 dry-run。',
      blockers: [...dubbingMissing, ...translationMissing],
      externalCall: true,
      maySpendMoney: true,
      writesArtifacts: true,
      confirmationId: 'translation_provider',
      confirmationLabel: '确认调用翻译 provider',
    }),
    buildProviderGate({
      id: 'minimax_tts',
      label: 'MiniMax TTS',
      runtime: 'dubbing',
      provider: 'minimax',
      capability: 'tts',
      liveReady: input.ttsConfigured && dubbingMissing.length === 0,
      dryRunReady: placeholderTtsAllowed && dubbingMissing.length === 0,
      liveDetail: buildPaidProviderGateDetail('tts', ttsCredentialStatus.verification_state),
      dryRunDetail: '未配置 MiniMax；可用静音占位 dry-run 验证字幕、合成与交付结构。',
      blockedDetail: 'MiniMax 未配置，且未允许静音占位 dry-run。',
      blockers: [...dubbingMissing, ...ttsMissing],
      externalCall: true,
      maySpendMoney: true,
      writesArtifacts: true,
      confirmationId: 'minimax_tts',
      confirmationLabel: '确认调用 MiniMax TTS',
    }),
    buildProviderGate({
      id: 'wav2lip',
      label: 'Wav2Lip 口型同步',
      runtime: 'dubbing',
      provider: 'wav2lip',
      capability: 'lipsync',
      liveReady: lipsyncReady,
      optionalSkip: !lipsyncReady,
      liveDetail: 'Wav2Lip 组件已就绪；可本地尝试口型同步。',
      blockedDetail: 'Wav2Lip 是可选链路；缺失时真实 smoke 可跳过口型同步。',
      blockers: lipsyncMissing,
      writesArtifacts: true,
    }),
  ]

  const providerSmokeReady =
    smokeReady && translationConfigured && input.ttsConfigured && youtubeReady
  const providerSmokeRequiresConfirmation =
    providerSmokeReady && providerGates.some((g) => g.requires_confirmation)
  const requiredConfirmations = getRequiredProviderConfirmationsFromGates(providerGates)

  return {
    production_ready: productionReady,
    smoke_ready: smokeReady,
    dry_run_ready: smokeReady,
    runtime_ready: smokeReady,
    runtime_readiness_level: runtimeReadinessLevel,
    delivery_audit_ready: deliveryAudit.ready,
    delivery_audit: deliveryAudit,
    provider_smoke_ready: providerSmokeReady,
    provider_smoke_requires_confirmation: providerSmokeRequiresConfirmation,
    youtube_ready: youtubeReady,
    lipsync_ready: lipsyncReady,
    voice_metadata_ready: voiceMetadataStage.ready,
    translation_configured: translationConfigured,
    translation_credential_status: translationCredentialStatus,
    passthrough_translation_allowed: passthroughTranslationAllowed,
    tts_configured: input.ttsConfigured,
    tts_credential_status: ttsCredentialStatus,
    placeholder_tts_allowed: placeholderTtsAllowed,
    summary_label: deliveryAudit.ready
      ? '交付审计就绪'
      : productionReady
        ? '可跑，待审计'
        : smokeReady
          ? '可做 smoke'
          : '未就绪',
    guidance: productionReady
      ? deliveryAudit.guidance
      : smokeReady
        ? passthroughTranslationAllowed && !translationConfigured
          ? '本地链路可以 smoke test；当前会使用原文占位，正式本地化还需要补齐 Gemini 翻译凭证。'
          : placeholderTtsAllowed && !input.ttsConfigured
            ? '本地链路可以 smoke test；当前会使用静音占位，正式成片还需要补齐 MiniMax TTS。'
            : '本地链路可以 smoke test；正式成片还需要补齐翻译或 TTS provider。'
        : '先补齐 YouTube/ASR/配音脚本运行时，再开始真实闭环测试。',
    missing_required: [...new Set(productionMissing)],
    required_confirmations: requiredConfirmations,
    stages,
    provider_gates: providerGates,
  }
}

export function getClosedLoopReadiness(
  options: GetClosedLoopReadinessOptions = {},
): ClosedLoopReadiness {
  const miniMaxCredential = getMiniMaxCredential()
  const miniMaxCredentialStatus = getMiniMaxCredentialStatus()
  const translationCredentialStatus = getDubbingTranslationCredentialStatus()

  return buildClosedLoopReadiness({
    ingest: getIngestRuntimeStatus(),
    dubbing: getDubbingRuntimeStatus(),
    translationConfigured: translationCredentialStatus.configured,
    translationCredentialStatus,
    passthroughTranslationAllowed: process.env.DUBBING_ALLOW_PASSTHROUGH_TRANSLATION === 'true',
    ttsConfigured: Boolean(miniMaxCredential),
    ttsCredentialStatus: {
      configured: miniMaxCredentialStatus.configured,
      verified: miniMaxCredentialStatus.verified,
      source: miniMaxCredentialStatus.source,
      verification_state: miniMaxCredentialStatus.verification_state,
      detail: miniMaxCredentialStatus.detail,
    },
    creatorDefaultVoiceId: readCreatorDefaultVoiceId(),
    voiceRegistryEntries: options.voiceRegistryEntries ?? readMiniMaxVoiceRegistryEntries(),
    placeholderTtsAllowed: process.env.DUBBING_ALLOW_PLACEHOLDER_TTS === 'true',
  })
}

const CREATOR_PROFILE_CONFIG_KEY = 'laputa_creator_profile'

function readCreatorDefaultVoiceId(): string | undefined {
  const raw = configsRepo.get(CREATOR_PROFILE_CONFIG_KEY)
  return raw ? parseCreatorProfileConfig(raw)?.default_voice_id || undefined : undefined
}
