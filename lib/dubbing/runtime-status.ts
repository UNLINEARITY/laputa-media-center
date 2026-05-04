import { existsSync } from 'node:fs'
import {
  findDubbingCredential,
  findDubbingScript,
  findWav2LipCheckpoint,
  findWav2LipScript,
  getDubbingPythonExe,
  getDubbingSkillDir,
} from '@/lib/dubbing/runtime'
import { getScriptArgMode } from '@/lib/dubbing/script-args'
import { getMiniMaxCredentialStatus, type MiniMaxCredentialStatus } from './minimax-credentials'
import {
  type DubbingTranslationCredentialStatus,
  getDubbingTranslationCredentialStatus,
  isDubbingPassthroughTranslationAllowed,
} from './translation-credentials'

const REQUIRED_SCRIPTS = ['whisper_asr.py', 'translator.py', 'voice_cloner.py', 'compose_dub.py']

export interface DubbingRuntimeStatusItem {
  name: string
  path: string | null
  exists: boolean
  required: boolean
}

export interface DubbingRuntimeStatus {
  available: boolean
  allow_placeholder_tts: boolean
  allow_passthrough_translation: boolean
  script_arg_mode: string
  skill_dir: string
  translation_credential_status?: DubbingTranslationCredentialStatus
  minimax_credential_status?: MiniMaxCredentialStatus
  checks: DubbingRuntimeStatusItem[]
  missing_required: string[]
  guidance: string
}

function redactPath(path: string | null): string | null {
  return path ? '[redacted]' : null
}

export function redactDubbingRuntimeStatus(status: DubbingRuntimeStatus): DubbingRuntimeStatus {
  return {
    ...status,
    skill_dir: status.skill_dir ? '[redacted]' : '',
    minimax_credential_status: status.minimax_credential_status
      ? {
          ...status.minimax_credential_status,
          path: redactPath(status.minimax_credential_status.path),
        }
      : undefined,
    checks: status.checks.map((check) => ({
      ...check,
      path: redactPath(check.path),
    })),
  }
}

function item(name: string, path: string | null, required = true): DubbingRuntimeStatusItem {
  const isCommand = Boolean(path && !path.includes('/') && !path.includes('\\'))
  return {
    name,
    path,
    exists: Boolean(path && (isCommand || existsSync(path))),
    required,
  }
}

export function getPublicDubbingRuntimeStatus(): DubbingRuntimeStatus {
  return redactDubbingRuntimeStatus(getDubbingRuntimeStatus())
}

function miniMaxCredentialItem(
  credentialStatus: MiniMaxCredentialStatus,
  required: boolean,
): DubbingRuntimeStatusItem {
  return {
    name: 'MiniMax TTS 凭证',
    path: credentialStatus.path,
    exists: credentialStatus.configured,
    required,
  }
}

function buildGuidance(
  available: boolean,
  missingRequired: DubbingRuntimeStatusItem[],
  miniMaxCredentialStatus: MiniMaxCredentialStatus,
  translationCredentialStatus: DubbingTranslationCredentialStatus,
  allowPassthroughTranslation: boolean,
): string {
  if (!translationCredentialStatus.configured && !allowPassthroughTranslation) {
    return available
      ? '配音脚本和 MiniMax 已就绪；正式本地化仍需配置 LLM 翻译凭证。'
      : '请补齐配音脚本运行时，并配置 LLM 翻译凭证；无凭证时不会创建正式本地化翻译。'
  }

  if (!translationCredentialStatus.configured && allowPassthroughTranslation) {
    return available
      ? '可做原文占位 smoke；正式本地化仍需配置 LLM 翻译凭证。'
      : '请补齐配音脚本运行时；当前只允许原文占位 smoke，正式本地化仍需 LLM 翻译凭证。'
  }

  const translationPrefix =
    translationCredentialStatus.verification_state === 'verified'
      ? 'LLM 翻译凭证已验证。'
      : translationCredentialStatus.verification_state === 'saved_unverified'
        ? 'LLM 翻译凭证已保存但未真实 provider 验证。'
        : translationCredentialStatus.verification_state === 'not_tracked'
          ? 'LLM 翻译凭证来自环境变量，设置页未记录真实 provider 验证。'
          : ''

  if (available) {
    if (miniMaxCredentialStatus.verification_state === 'verified') {
      return `${translationPrefix}翻译配音运行时已就绪；MiniMax 凭证已通过设置页付费验证。`
    }
    if (miniMaxCredentialStatus.verification_state === 'saved_unverified') {
      return `${translationPrefix}翻译配音运行时已就绪；MiniMax 凭证已保存但未付费验证。真实 TTS 前仍需费用确认。`
    }
    if (miniMaxCredentialStatus.configured) {
      return `${translationPrefix}翻译配音运行时已就绪；MiniMax 凭证来自环境变量或本地文件，设置页未记录付费验证。`
    }
    return `${translationPrefix}可做静音占位 smoke；正式配音仍需在设置页保存 MiniMax API Key。`
  }

  if (missingRequired.every((check) => check.name === 'MiniMax TTS 凭证')) {
    return `${translationPrefix}Python 脚本已就绪；正式 TTS 还需在设置页保存 MiniMax，或设置 MINIMAX_API_KEY / config/minimax.json。`
  }

  return '请安装或配置翻译配音 Python 脚本，并在需要时设置 DUBBING_SKILL_DIR / DUBBING_PYTHON_EXE。'
}

export function getDubbingRuntimeStatus(): DubbingRuntimeStatus {
  const allowPlaceholderTts = process.env.DUBBING_ALLOW_PLACEHOLDER_TTS === 'true'
  const allowPassthroughTranslation = isDubbingPassthroughTranslationAllowed()
  const skillDir = getDubbingSkillDir()
  const python = item('DUBBING_PYTHON_EXE', getDubbingPythonExe('dub'))
  const rvcPython = item('DUBBING_RVC_PYTHON_EXE', getDubbingPythonExe('rvc'), false)
  const scripts = REQUIRED_SCRIPTS.map((scriptName) =>
    item(scriptName, findDubbingScript(scriptName)),
  )
  const wav2lip = item('Wav2Lip inference.py', findWav2LipScript(), false)
  const wav2lipCheckpoint = item('Wav2Lip checkpoint', findWav2LipCheckpoint(), false)
  const miniMaxCredentialStatus = getMiniMaxCredentialStatus()
  const translationCredentialStatus = getDubbingTranslationCredentialStatus()
  const minimaxCredential = miniMaxCredentialItem(miniMaxCredentialStatus, !allowPlaceholderTts)
  const clonedVoices = item(
    'minimax_cloned_voices.json',
    findDubbingCredential('minimax_cloned_voices.json'),
    false,
  )

  const checks = [
    python,
    ...scripts,
    minimaxCredential,
    rvcPython,
    wav2lip,
    wav2lipCheckpoint,
    clonedVoices,
  ]
  const missingRequired = checks.filter((check) => check.required && !check.exists)
  const available = missingRequired.length === 0

  return {
    available,
    allow_placeholder_tts: allowPlaceholderTts,
    allow_passthrough_translation: allowPassthroughTranslation,
    script_arg_mode: getScriptArgMode(),
    skill_dir: skillDir,
    translation_credential_status: translationCredentialStatus,
    minimax_credential_status: miniMaxCredentialStatus,
    checks,
    missing_required: missingRequired.map((check) => check.name),
    guidance: buildGuidance(
      available,
      missingRequired,
      miniMaxCredentialStatus,
      translationCredentialStatus,
      allowPassthroughTranslation,
    ),
  }
}
