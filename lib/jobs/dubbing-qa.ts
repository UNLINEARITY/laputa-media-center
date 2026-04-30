import { isVoiceUsageBoundaryAcknowledged } from '@/lib/dubbing/voice-usage-boundary'
import type { Job } from '@/types'
import {
  createSecondaryVoiceUsageDisplayFromJob,
  createVoiceUsageDisplayFromJob,
  type VoiceUsageDisplay,
} from '../dubbing/applied-asset-summary'
import { isJobFinalVideoDownloadable } from './job-artifacts'

export type DubbingQaStatus = 'pass' | 'watch' | 'issue'
export type DubbingQaCategory =
  | 'artifacts'
  | 'glossary'
  | 'numbers'
  | 'rhythm'
  | 'language'
  | 'speakers'
  | 'assets'
  | 'delivery'

export interface DubbingQaCheck {
  id: string
  category: DubbingQaCategory
  status: DubbingQaStatus
  title: string
  summary: string
  evidence: string[]
  recommendation?: string
}

export interface DubbingQaSegment {
  id: string
  start: number
  end: number
  originalText: string
  translatedText: string
  speaker?: string
}

export interface DubbingQaReport {
  score: number
  verdict: 'ready' | 'review' | 'fix'
  checks: DubbingQaCheck[]
  recommendedActions: string[]
  voiceUsage?: VoiceUsageDisplay
  secondaryVoiceUsage?: VoiceUsageDisplay
  stats: {
    translatedSegments: number
    sourceSegments: number
    totalDurationSeconds: number
    averageCharsPerSecond: number
    glossaryEntries: number
    targetLanguage: string
    translationStyle: string
  }
}

export interface DubbingQaArtifacts {
  translationsJson?: string | null
  segmentsJson?: string | null
}

function parseJson(value?: string | null): unknown {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function rowText(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function rowNumber(row: Record<string, unknown>, key: string): number {
  const value = row[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function normalizeRows(value: unknown): DubbingQaSegment[] {
  const rows = Array.isArray(value)
    ? value
    : value &&
        typeof value === 'object' &&
        Array.isArray((value as { segments?: unknown }).segments)
      ? (value as { segments: unknown[] }).segments
      : []

  return rows
    .filter((row): row is Record<string, unknown> => Boolean(row && typeof row === 'object'))
    .map((row, index) => ({
      id: String(row.id ?? index),
      start: rowNumber(row, 'start'),
      end: rowNumber(row, 'end'),
      originalText: rowText(row, ['original_text', 'text']),
      translatedText: rowText(row, ['translated_text', 'text']),
      speaker: rowText(row, ['speaker']) || undefined,
    }))
}

function isChineseTarget(targetLanguage: string): boolean {
  const target = targetLanguage.toLowerCase()
  return (
    target.includes('cantonese') ||
    target.includes('yue') ||
    target.includes('mandarin') ||
    target === 'zh' ||
    target.includes('chinese')
  )
}

function isCantoneseTarget(targetLanguage: string): boolean {
  const target = targetLanguage.toLowerCase()
  return target.includes('cantonese') || target.includes('yue')
}

function hasDownloadableFinalVideo(job: Job): boolean {
  return isJobFinalVideoDownloadable(job.id, job.state)
}

function containsText(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase())
}

function countCjkChars(text: string): number {
  return [...text].filter((char) => /[\u3400-\u9fff]/u.test(char)).length
}

function formatSeconds(value: number): string {
  return `${Math.round(value * 10) / 10}s`
}

function evidenceFromRows(rows: DubbingQaSegment[], formatter: (row: DubbingQaSegment) => string) {
  return rows.slice(0, 3).map(formatter)
}

function buildVoiceDisclosureCheck(
  job: Job,
  voiceUsage: VoiceUsageDisplay,
  secondaryVoiceUsage?: VoiceUsageDisplay | null,
): DubbingQaCheck {
  const voiceId = job.config?.voice_id?.trim()
  const secondaryVoiceId = job.config?.secondary_voice_id?.trim()
  const hasVoice = Boolean(voiceId)
  const disclosureKnown = voiceUsage.disclosureStatus !== 'unknown'
  const secondaryDisclosureKnown =
    !secondaryVoiceId || secondaryVoiceUsage?.disclosureStatus !== 'unknown'
  const usageConfirmed = isVoiceUsageBoundaryAcknowledged(job.config)
  const issues = [
    hasVoice ? '' : '未指定 voice_id',
    disclosureKnown ? '' : '声线披露要求未知',
    secondaryDisclosureKnown ? '' : '第二声线披露要求未知',
    usageConfirmed ? '' : '未确认声线使用边界',
  ].filter(Boolean)

  return {
    id: 'voice-disclosure',
    category: 'assets',
    status: issues.length === 0 ? 'pass' : 'issue',
    title: '声线披露与使用边界',
    summary:
      issues.length === 0
        ? '声线、披露要求和使用边界确认都已记录。'
        : `声线披露 gate 未通过：${issues.join('；')}。`,
    evidence: [
      `voice_id：${voiceId || '未指定'}`,
      `披露状态：${voiceUsage.disclosureStatus}`,
      secondaryVoiceId
        ? `第二声线：${secondaryVoiceId}；披露状态：${
            secondaryVoiceUsage?.disclosureStatus || 'unknown'
          }`
        : '第二声线：未设置',
      `使用边界确认：${usageConfirmed ? '已确认' : '未确认'}`,
    ],
    recommendation:
      issues.length === 0
        ? undefined
        : '补齐声线 ID、披露要求和声线使用边界确认后，再生成或交付配音成片。',
  }
}

export function evaluateDubbingQa(job: Job, artifacts: DubbingQaArtifacts): DubbingQaReport {
  const translationsValue = parseJson(artifacts.translationsJson)
  const sourceValue = parseJson(artifacts.segmentsJson)
  const translatedRows = normalizeRows(translationsValue)
  const sourceRows = normalizeRows(sourceValue)
  const targetLanguage = job.config?.target_language || ''
  const translationStyle = job.config?.translation_style || ''
  const glossary = job.config?.localization_glossary || []
  const voiceUsage = createVoiceUsageDisplayFromJob(job)
  const secondaryVoiceUsage = createSecondaryVoiceUsageDisplayFromJob(job)
  const checks: DubbingQaCheck[] = []

  function addCheck(check: DubbingQaCheck) {
    checks.push(check)
  }

  addCheck(buildVoiceDisclosureCheck(job, voiceUsage, secondaryVoiceUsage))

  addCheck({
    id: 'artifacts-present',
    category: 'artifacts',
    status: translatedRows.length > 0 ? 'pass' : 'issue',
    title: '口播稿产物',
    summary:
      translatedRows.length > 0
        ? `已读取 ${translatedRows.length} 段翻译口播。`
        : '暂时读不到 translations.json，无法做口播质检。',
    evidence:
      translatedRows.length > 0
        ? evidenceFromRows(translatedRows, (row) => `#${row.id} ${row.translatedText}`)
        : ['请先确认任务已完成，或查看任务日志中的翻译步骤。'],
    recommendation:
      translatedRows.length > 0 ? undefined : '先重跑翻译配音任务，或检查输出目录是否被清理。',
  })

  if (sourceRows.length > 0 && translatedRows.length > 0) {
    const delta = Math.abs(sourceRows.length - translatedRows.length)
    addCheck({
      id: 'segment-count',
      category: 'artifacts',
      status: delta === 0 ? 'pass' : delta <= 1 ? 'watch' : 'issue',
      title: '原文 / 口播段落对齐',
      summary:
        delta === 0
          ? '原文分段与翻译口播段数一致。'
          : `原文 ${sourceRows.length} 段，口播 ${translatedRows.length} 段，需要确认是否漏段或合并过度。`,
      evidence: [`原文段数：${sourceRows.length}`, `口播段数：${translatedRows.length}`],
      recommendation: delta === 0 ? undefined : '打开口播稿差异页，确认是否有漏译、重复或错位。',
    })
  }

  const triggeredGlossary = glossary
    .map((entry) => {
      const source = entry.source.trim()
      const target = entry.target.trim()
      if (!source || !target) return null

      const relatedRows = translatedRows.filter((row) =>
        containsText(`${row.originalText}\n${row.translatedText}`, source),
      )
      const missedRows = relatedRows.filter((row) => !containsText(row.translatedText, target))
      return { source, target, relatedRows, missedRows }
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .filter((entry) => entry.relatedRows.length > 0)

  const missedGlossary = triggeredGlossary.filter((entry) => entry.missedRows.length > 0)
  if (glossary.length === 0) {
    addCheck({
      id: 'glossary',
      category: 'glossary',
      status: 'watch',
      title: '专名与固定读法',
      summary: '本次任务未套用长期词库，专名、产品名和数字读法要靠模型自行判断。',
      evidence: ['建议把已确认读法写成：原词 -> 固定读法 # 备注。'],
      recommendation: '把已听出的错名、错读法存入长期词库后再修一版。',
    })
  } else {
    addCheck({
      id: 'glossary',
      category: 'glossary',
      status: missedGlossary.length > 0 ? 'issue' : 'pass',
      title: '专名与固定读法',
      summary:
        missedGlossary.length > 0
          ? `${missedGlossary.length} 条词库规则疑似未命中。`
          : `已套用 ${glossary.length} 条词库；未看到明显违反固定读法。`,
      evidence:
        missedGlossary.length > 0
          ? missedGlossary.slice(0, 4).map((entry) => `${entry.source} 应读 ${entry.target}`)
          : [`词库条数：${glossary.length}`, `本片触发：${triggeredGlossary.length}`],
      recommendation:
        missedGlossary.length > 0
          ? '把漏命中的原词也加入同一条词库，例如 ASR 错字、大小写或近音版本。'
          : undefined,
    })
  }

  if (isChineseTarget(targetLanguage)) {
    const rawYearRows = translatedRows.filter((row) => /\d{2,4}年/.test(row.translatedText))
    const rawNumberRows = translatedRows.filter((row) =>
      /(^|[^\dA-Za-z.])\d{2,}($|[^\dA-Za-z.%])/u.test(row.translatedText),
    )
    addCheck({
      id: 'spoken-numbers',
      category: 'numbers',
      status: rawYearRows.length > 0 ? 'issue' : rawNumberRows.length > 0 ? 'watch' : 'pass',
      title: '数字与年份口播',
      summary:
        rawYearRows.length > 0
          ? '口播稿仍有原始数字年份，TTS 很容易读错。'
          : rawNumberRows.length > 0
            ? '口播稿仍有部分原始数字，需要人工确认是否属于版本号、价格或固定名。'
            : '未看到明显的原始数字年份穿帮。',
      evidence:
        rawYearRows.length > 0
          ? evidenceFromRows(rawYearRows, (row) => `#${row.id} ${row.translatedText}`)
          : rawNumberRows.length > 0
            ? evidenceFromRows(rawNumberRows, (row) => `#${row.id} ${row.translatedText}`)
            : ['年份规则：1999年应写一九九九年；99年应写九九年。'],
      recommendation:
        rawYearRows.length > 0 || rawNumberRows.length > 0
          ? '把确定读法存入词库，或在 compare 页追加一条数字读法规则。'
          : undefined,
    })
  }

  const timedRows = translatedRows.filter((row) => row.end > row.start)
  const denseRows = timedRows.filter((row) => {
    const duration = row.end - row.start
    const cjkChars = countCjkChars(row.translatedText)
    const length = cjkChars > 0 ? cjkChars : row.translatedText.length
    return duration > 0 && length / duration > (isChineseTarget(targetLanguage) ? 8.5 : 18)
  })
  const totalDurationSeconds = timedRows.reduce(
    (sum, row) => sum + Math.max(0, row.end - row.start),
    0,
  )
  const totalChars = timedRows.reduce((sum, row) => {
    const cjkChars = countCjkChars(row.translatedText)
    return sum + (cjkChars > 0 ? cjkChars : row.translatedText.length)
  }, 0)
  const averageCharsPerSecond =
    totalDurationSeconds > 0 ? Math.round((totalChars / totalDurationSeconds) * 10) / 10 : 0

  addCheck({
    id: 'rhythm-density',
    category: 'rhythm',
    status:
      denseRows.length === 0
        ? 'pass'
        : denseRows.length / Math.max(1, timedRows.length) > 0.25
          ? 'issue'
          : 'watch',
    title: '口播节奏密度',
    summary:
      denseRows.length === 0
        ? `平均语速约 ${averageCharsPerSecond} 字/秒，未看到明显过密段落。`
        : `${denseRows.length} 段口播可能过密，听感容易像赶稿或逐句硬塞。`,
    evidence:
      denseRows.length > 0
        ? evidenceFromRows(
            denseRows,
            (row) => `#${row.id} ${formatSeconds(row.end - row.start)}：${row.translatedText}`,
          )
        : [
            `总时长：${formatSeconds(totalDurationSeconds)}`,
            `平均密度：${averageCharsPerSecond} 字/秒`,
          ],
    recommendation:
      denseRows.length > 0
        ? '修稿时把长句拆开或删掉冗余连接词；必要时把语速调低到 0.9x 左右。'
        : undefined,
  })

  if (isCantoneseTarget(targetLanguage)) {
    const cantonesePattern = /(我哋|你哋|佢|嘅|喺|嚟|系|咗|唔|呢|啲|𠮶|咁|啦|喇)/u
    const naturalRows = translatedRows.filter((row) => cantonesePattern.test(row.translatedText))
    const ratio = translatedRows.length > 0 ? naturalRows.length / translatedRows.length : 0
    addCheck({
      id: 'cantonese-naturalness',
      category: 'language',
      status: ratio >= 0.25 ? 'pass' : ratio >= 0.1 ? 'watch' : 'issue',
      title: '广东话自然度',
      summary:
        ratio >= 0.25
          ? '口播稿有明显香港粤语语感。'
          : '粤语口播语感偏弱，可能仍像普通话直译成繁体字。',
      evidence:
        naturalRows.length > 0
          ? evidenceFromRows(naturalRows, (row) => `#${row.id} ${row.translatedText}`)
          : ['未明显看到我哋、嘅、喺、唔、咗、啲等粤语口播标记。'],
      recommendation:
        ratio >= 0.25
          ? undefined
          : '在创作者资产的广东话口播偏好加入更具体的语气和用词规则后再修一版。',
    })
  }

  const speakerLabels = new Set(translatedRows.map((row) => row.speaker).filter(Boolean))
  const originalText = translatedRows.map((row) => row.originalText).join('\n')
  const likelyDialogue =
    speakerLabels.size > 1 ||
    /\b(thanks|thank you),?\s+[A-Z][A-Za-z'-]+/u.test(originalText) ||
    /\b(okay|yes|no),?\s+[A-Z][A-Za-z'-]+/u.test(originalText)
  const secondaryVoiceId = job.config?.secondary_voice_id?.trim()
  const speakerMode = job.config?.speaker_mode || 'single'
  addCheck({
    id: 'speaker-separation',
    category: 'speakers',
    status:
      likelyDialogue && !secondaryVoiceId
        ? 'issue'
        : secondaryVoiceId && speakerMode !== 'single'
          ? 'pass'
          : secondaryVoiceId
            ? 'watch'
            : 'pass',
    title: '双人对话声线',
    summary:
      likelyDialogue && !secondaryVoiceId
        ? '这条片疑似有多位讲者，但只配置了一条声线。'
        : secondaryVoiceId && speakerMode !== 'single'
          ? `已配置第二声线，讲者模式：${speakerMode}。`
          : secondaryVoiceId
            ? '已填第二声线，但讲者模式仍是单一讲者。'
            : '暂未看到必须分声线的明显讯号。',
    evidence: [
      `第二声线：${secondaryVoiceId || '未设定'}`,
      `讲者模式：${speakerMode}`,
      `侦测讲者标签：${speakerLabels.size || 0}`,
    ],
    recommendation:
      likelyDialogue && !secondaryVoiceId
        ? '为第二位讲者填 voice_id，并用自动识别或双人交替模式再跑。'
        : secondaryVoiceId && speakerMode === 'single'
          ? '把讲者模式改成自动识别或双人交替。'
          : undefined,
  })

  const creatorContext = job.config?.creator_context
  const assetSignals = [
    creatorContext?.content_brief,
    creatorContext?.speaker_identity,
    creatorContext?.target_audience,
    creatorContext?.creator_profile,
    creatorContext?.language_style,
    glossary.length > 0 ? 'glossary' : '',
  ].filter(Boolean)
  addCheck({
    id: 'creator-assets',
    category: 'assets',
    status: assetSignals.length >= 3 ? 'pass' : assetSignals.length > 0 ? 'watch' : 'issue',
    title: '内容背景与长期资产',
    summary:
      assetSignals.length >= 3
        ? '本次任务已套用内容背景、受众或语言风格等资产。'
        : '本次任务的背景资产偏少，模型更容易逐句翻译或误判专业语境。',
    evidence: [
      `内容简报：${creatorContext?.content_brief ? '有' : '无'}`,
      `讲者身份：${creatorContext?.speaker_identity ? '有' : '无'}`,
      `语言风格：${creatorContext?.language_style ? '有' : '无'}`,
      `词库：${glossary.length} 条`,
    ],
    recommendation:
      assetSignals.length >= 3
        ? undefined
        : '补上影片主题、讲者身份、受众深浅和语言风格，再重跑说话稿改写。',
  })

  addCheck({
    id: 'delivery',
    category: 'delivery',
    status:
      job.status === 'completed' && hasDownloadableFinalVideo(job)
        ? 'pass'
        : job.status === 'completed'
          ? 'issue'
          : 'watch',
    title: '成片交付',
    summary:
      job.status === 'completed' && hasDownloadableFinalVideo(job)
        ? '任务已完成并有安全的 final video 可下载/预览。'
        : job.status === 'completed'
          ? '任务已完成，但没有找到可交付的 final video。'
          : `任务目前是 ${job.status}，完成后再做最终听感质检。`,
    evidence: [
      `任务状态：${job.status}`,
      `口型模式：${job.config?.lipsync_mode || '未指定'}`,
      `语速：${job.config?.speech_speed || 1}x`,
    ],
    recommendation:
      job.status === 'completed' && hasDownloadableFinalVideo(job)
        ? undefined
        : '先回工作台查看日志，确认 publish final video 已输出 final.mp4 或 final_with_bgm.mp4。',
  })

  const issueCount = checks.filter((check) => check.status === 'issue').length
  const watchCount = checks.filter((check) => check.status === 'watch').length
  const score = Math.max(0, Math.min(100, 100 - issueCount * 18 - watchCount * 7))
  const verdict = issueCount > 0 ? 'fix' : score >= 85 ? 'ready' : 'review'
  const recommendedActions = checks
    .filter((check) => check.recommendation)
    .map((check) => check.recommendation as string)
    .slice(0, 5)

  return {
    score,
    verdict,
    checks,
    recommendedActions,
    voiceUsage,
    secondaryVoiceUsage: secondaryVoiceUsage || undefined,
    stats: {
      translatedSegments: translatedRows.length,
      sourceSegments: sourceRows.length,
      totalDurationSeconds: Math.round(totalDurationSeconds * 10) / 10,
      averageCharsPerSecond,
      glossaryEntries: glossary.length,
      targetLanguage,
      translationStyle,
    },
  }
}
