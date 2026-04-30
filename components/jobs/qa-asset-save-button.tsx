'use client'

import { Loader2, Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getLanguageLabel } from '@/lib/config/languages'
import {
  appendCreatorStyleNote,
  EMPTY_CREATOR_PROFILE,
  parseCreatorProfileConfig,
} from '@/lib/dubbing/creator-profile'
import { parseGlossaryText } from '@/lib/dubbing/glossary'
import {
  formatProjectGlossaryValue,
  mergeProjectGlossary,
  mergeProjectGlossaryConfigValues,
  PROJECT_GLOSSARY_CONFIG_KEYS,
  PROJECT_GLOSSARY_CONFIG_READ_ORDER,
} from '@/lib/dubbing/project-glossary'
import type { DubbingQaCheck } from '@/lib/jobs/dubbing-qa'

const CREATOR_PROFILE_CONFIG_KEY = 'laputa_creator_profile'
const PROJECT_GLOSSARY_CONFIG_KEY = PROJECT_GLOSSARY_CONFIG_KEYS[0]

type SaveStatus = {
  type: 'success' | 'error'
  text: string
  glossaryLabel?: string
  glossaryEntries?: string[]
  glossaryHiddenCount?: number
  styleNote?: string
  styleTarget?: string
} | null

interface GlossaryCandidate {
  source: string
  target: string
}

const LONG_TERM_STYLE_CATEGORIES = new Set<DubbingQaCheck['category']>(['language', 'rhythm'])

function normalizeUnknownJson(value: unknown): {
  value?: unknown
  error?: string
  message?: string
} {
  return value && typeof value === 'object'
    ? (value as { value?: unknown; error?: string; message?: string })
    : {}
}

function normalizeAction(value: string): string {
  return value.trim()
}

function formatGlossaryCandidate(candidate: GlossaryCandidate): string {
  return `${candidate.source} -> ${candidate.target}`
}

function getGlossaryPreview(candidates: GlossaryCandidate[], limit = 4) {
  return {
    entries: candidates.slice(0, limit).map(formatGlossaryCandidate),
    hiddenCount: Math.max(candidates.length - limit, 0),
  }
}

function getTextPreview(entries: string[], limit = 4) {
  return {
    entries: entries.slice(0, limit),
    hiddenCount: Math.max(entries.length - limit, 0),
  }
}

export function getQaAssetStyleActions(
  recommendedActions: string[],
  checks?: DubbingQaCheck[],
): string[] {
  const cleanRecommendedActions = recommendedActions.map(normalizeAction).filter(Boolean)

  if (!checks || checks.length === 0) {
    return cleanRecommendedActions.filter((action) => !isMetaGlossaryAction(action)).slice(0, 5)
  }

  const allowedActions = new Set(
    checks
      .filter((check) => LONG_TERM_STYLE_CATEGORIES.has(check.category))
      .map((check) => normalizeAction(check.recommendation || ''))
      .filter(Boolean),
  )

  return cleanRecommendedActions
    .filter((action) => allowedActions.has(action))
    .filter((action) => !isMetaGlossaryAction(action))
    .slice(0, 5)
}

export function buildQaAssetStyleNote(options: {
  jobId: string
  recommendedActions: string[]
  checks?: DubbingQaCheck[]
}): string {
  const actions = getQaAssetStyleActions(options.recommendedActions, options.checks)

  if (actions.length === 0) return ''

  return `QA #${options.jobId}: ${actions.join('；')}`.slice(0, 1200)
}

function cleanCandidateValue(value: string): string {
  return value
    .replace(/^#\d+\s*/, '')
    .replace(/[。.!！?？；;，,]+$/g, '')
    .trim()
}

function isPlaceholderCandidate(candidate: GlossaryCandidate): boolean {
  const source = candidate.source.toLowerCase()
  const target = candidate.target.toLowerCase()
  return (
    source === target ||
    source.includes('原词') ||
    source.includes('\u539f\u8a5e') ||
    target.includes('固定读法') ||
    target.includes('固定\u8b80法') ||
    target.includes('备注') ||
    target.includes('\u5099\u8a3b')
  )
}

function parseGlossaryCandidateLine(line: string): GlossaryCandidate[] {
  const entries = parseGlossaryText(line)
  if (entries.length > 0) {
    return entries
      .map((entry) => ({
        source: cleanCandidateValue(entry.source),
        target: cleanCandidateValue(entry.target),
      }))
      .filter((candidate) => candidate.source && candidate.target)
  }

  const match = line.match(
    /^(.+?)\s*(?:应读|\u61c9\u8b80|读作|\u8b80作|读成|\u8b80成|念作)\s*(.+?)(?:\s*[#（(].*)?$/u,
  )
  if (!match) return []

  const candidate = {
    source: cleanCandidateValue(match[1]),
    target: cleanCandidateValue(match[2]),
  }
  return candidate.source && candidate.target ? [candidate] : []
}

export function extractQaGlossaryCandidates(checks: DubbingQaCheck[]): GlossaryCandidate[] {
  const byKey = new Map<string, GlossaryCandidate>()

  for (const check of checks) {
    if (check.category !== 'glossary' && check.category !== 'numbers') continue

    const lines = [...check.evidence, check.recommendation || '']
    for (const line of lines) {
      for (const candidate of parseGlossaryCandidateLine(line)) {
        if (candidate.source.length > 80 || candidate.target.length > 120) continue
        if (isPlaceholderCandidate(candidate)) continue
        const key = `${candidate.source.toLowerCase()}=>${candidate.target}`
        byKey.set(key, candidate)
      }
    }
  }

  return [...byKey.values()]
}

function isMetaGlossaryAction(action: string): boolean {
  return /词库|\u8a5e\u5eab/u.test(action) && /存入|加入|写入|\u5beb入|追加/u.test(action)
}

async function loadProjectGlossaryEntries(): Promise<GlossaryCandidate[]> {
  const values: string[] = []

  for (const key of PROJECT_GLOSSARY_CONFIG_READ_ORDER) {
    const glossaryResponse = await fetch(`/api/configs/${key}`)
    if (!glossaryResponse.ok && glossaryResponse.status !== 404) {
      throw new Error('读取长期词库失败')
    }
    if (!glossaryResponse.ok) continue

    const glossaryData = normalizeUnknownJson(await glossaryResponse.json().catch(() => ({})))
    if (typeof glossaryData.value !== 'string') continue
    values.push(glossaryData.value)
  }

  return mergeProjectGlossaryConfigValues(values)
}

function getSaveButtonLabel(hasGlossaryCandidates: boolean, hasStyleNote: boolean): string {
  if (hasGlossaryCandidates && hasStyleNote) return '存入词库与规则'
  if (hasGlossaryCandidates) return '存入词库'
  return '存入长期规则'
}

function getStyleTargetLabel(targetLanguage?: string): string {
  return targetLanguage ? getLanguageLabel(targetLanguage) : '多语言'
}

export function QaAssetSaveButton({
  jobId,
  targetLanguage,
  recommendedActions,
  checks,
}: {
  jobId: string
  targetLanguage?: string
  recommendedActions: string[]
  checks?: DubbingQaCheck[]
}) {
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<SaveStatus>(null)
  const glossaryCandidates = extractQaGlossaryCandidates(checks || [])
  const glossaryPreview = getGlossaryPreview(glossaryCandidates)
  const suggestedNote = buildQaAssetStyleNote({ jobId, recommendedActions, checks })
  const [noteDraft, setNoteDraft] = useState(suggestedNote)
  const note = noteDraft.trim().slice(0, 1200)
  const hasStyleNote = Boolean(note)
  const canSave = Boolean(hasStyleNote || glossaryCandidates.length > 0)
  const styleTargetLabel = getStyleTargetLabel(targetLanguage)
  const saveDestinationItems = [
    glossaryCandidates.length > 0
      ? {
          label: '长期词库',
          value: `${glossaryCandidates.length} 条`,
          detail: '固定读法和专名修正',
        }
      : null,
    hasStyleNote
      ? {
          label: '语言风格',
          value: styleTargetLabel,
          detail: '语气、节奏和翻译偏好',
        }
      : null,
  ].filter((item): item is { label: string; value: string; detail: string } => Boolean(item))

  useEffect(() => {
    setNoteDraft(suggestedNote)
  }, [suggestedNote])

  async function handleSave() {
    if (!canSave || saving) return

    setSaving(true)
    setStatus(null)

    try {
      let addedGlossaryCount = 0
      let glossaryStatusLabel: string | undefined
      let glossaryStatusEntries: string[] = []

      if (glossaryCandidates.length > 0) {
        const currentEntries = await loadProjectGlossaryEntries()
        const newCandidates = glossaryCandidates.filter(
          (candidate) =>
            !currentEntries.some(
              (entry) =>
                entry.source.trim().toLowerCase() === candidate.source.toLowerCase() &&
                entry.target.trim() === candidate.target,
            ),
        )

        if (newCandidates.length > 0) {
          const nextValue = formatProjectGlossaryValue(
            mergeProjectGlossary(currentEntries, newCandidates),
          )
          const saveGlossaryResponse = await fetch(`/api/configs/${PROJECT_GLOSSARY_CONFIG_KEY}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: nextValue }),
          })
          if (!saveGlossaryResponse.ok) {
            const data = normalizeUnknownJson(await saveGlossaryResponse.json().catch(() => ({})))
            throw new Error(data.message || data.error || '保存长期词库失败')
          }
          addedGlossaryCount = newCandidates.length
          glossaryStatusLabel = '已写入长期词库'
          glossaryStatusEntries = newCandidates.map(formatGlossaryCandidate)
        } else {
          glossaryStatusLabel = '词库中已存在'
          glossaryStatusEntries = glossaryCandidates.map(formatGlossaryCandidate)
        }
      }

      if (note) {
        const currentResponse = await fetch(`/api/configs/${CREATOR_PROFILE_CONFIG_KEY}`)
        if (!currentResponse.ok && currentResponse.status !== 404) {
          throw new Error('读取创作者资产失败')
        }

        const currentData = currentResponse.ok
          ? normalizeUnknownJson(await currentResponse.json().catch(() => ({})))
          : {}
        const baseProfile = parseCreatorProfileConfig(currentData.value) || EMPTY_CREATOR_PROFILE
        const nextProfile = appendCreatorStyleNote(
          baseProfile,
          targetLanguage || 'multi-language',
          note,
        )

        const saveResponse = await fetch(`/api/configs/${CREATOR_PROFILE_CONFIG_KEY}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: JSON.stringify(nextProfile) }),
        })
        if (!saveResponse.ok) {
          const data = normalizeUnknownJson(await saveResponse.json().catch(() => ({})))
          throw new Error(data.message || data.error || '保存创作者资产失败')
        }
      }

      const glossaryStatusPreview = getTextPreview(glossaryStatusEntries)

      const statusDetails = {
        glossaryLabel: glossaryStatusLabel,
        glossaryEntries: glossaryStatusPreview.entries,
        glossaryHiddenCount: glossaryStatusPreview.hiddenCount,
        styleNote: note || undefined,
        styleTarget: note ? styleTargetLabel : undefined,
      }

      if (addedGlossaryCount > 0 && note) {
        setStatus({
          type: 'success',
          text: `已保存 ${addedGlossaryCount} 条词库和长期规则，下次重跑会自动参考。`,
          ...statusDetails,
        })
      } else if (addedGlossaryCount > 0) {
        setStatus({
          type: 'success',
          text: `已保存 ${addedGlossaryCount} 条长期词库，下次重跑会自动套用。`,
          ...statusDetails,
        })
      } else if (note) {
        setStatus({
          type: 'success',
          text: '已保存到创作者资产，下次重跑会自动参考。',
          ...statusDetails,
        })
      } else {
        setStatus({
          type: 'success',
          text: '长期词库已包含这些规则。',
          ...statusDetails,
        })
      }
    } catch (error) {
      setStatus({
        type: 'error',
        text: error instanceof Error ? error.message : '保存创作者资产失败',
      })
    } finally {
      setSaving(false)
    }
  }

  if (!canSave) return null

  return (
    <div className="w-full space-y-3 rounded-md border border-claude-cream-200 bg-claude-cream-50/60 p-3">
      <div className="space-y-1">
        <p className="text-xs font-semibold text-claude-dark-800">保存前预览</p>
        <p className="text-xs leading-5 text-claude-dark-500">
          这些内容会写入长期资产，下次 sample-to-full 或重跑时自动参考。
        </p>
      </div>

      <div className="rounded-md border border-claude-cream-200 bg-white px-3 py-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-claude-dark-500">
          保存去向
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {saveDestinationItems.map((item) => (
            <div key={item.label} className="text-xs leading-5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-claude-dark-400">{item.label}</span>
                <span className="font-semibold text-claude-dark-800">{item.value}</span>
              </div>
              <p className="mt-0.5 text-claude-dark-500">{item.detail}</p>
            </div>
          ))}
        </div>
      </div>

      {glossaryPreview.entries.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-claude-dark-500">
            将存入长期词库
          </p>
          <div className="flex flex-wrap gap-1.5">
            {glossaryPreview.entries.map((entry) => (
              <span
                key={entry}
                className="rounded-md border border-claude-cream-200 bg-white px-2 py-1 text-xs leading-4 text-claude-dark-700"
              >
                {entry}
              </span>
            ))}
            {glossaryPreview.hiddenCount > 0 && (
              <span className="rounded-md border border-claude-cream-200 bg-white px-2 py-1 text-xs leading-4 text-claude-dark-500">
                另 {glossaryPreview.hiddenCount} 条
              </span>
            )}
          </div>
        </div>
      )}

      <div className="space-y-2">
        {suggestedNote && (
          <label className="block space-y-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-claude-dark-500">
              将存入语言风格
            </span>
            <textarea
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              disabled={saving}
              rows={2}
              className="w-full resize-y rounded-md border border-claude-cream-200 bg-white px-3 py-2 text-xs leading-5 text-claude-dark-700 focus:border-claude-orange-500 focus:outline-none focus:ring-2 focus:ring-claude-orange-500/15 disabled:cursor-not-allowed disabled:opacity-60"
              aria-label="将保存的长期风格规则"
            />
          </label>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex h-9 w-fit items-center justify-center gap-2 rounded-md border border-claude-orange-200 bg-claude-orange-50 px-3 text-xs font-medium text-claude-orange-700 transition-colors hover:bg-claude-orange-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          {getSaveButtonLabel(glossaryCandidates.length > 0, hasStyleNote)}
        </button>
      </div>
      {status && (
        <output
          className={`block space-y-2 rounded-md border bg-white px-3 py-2 text-xs leading-5 ${
            status.type === 'success'
              ? 'border-emerald-100 text-emerald-700'
              : 'border-red-100 text-red-600'
          }`}
        >
          <p className="font-medium">{status.text}</p>
          {status.glossaryEntries && status.glossaryEntries.length > 0 && (
            <div className="space-y-1 text-claude-dark-600">
              {status.glossaryLabel && (
                <p className="font-medium text-claude-dark-700">{status.glossaryLabel}</p>
              )}
              <ul className="space-y-1">
                {status.glossaryEntries.map((entry) => (
                  <li key={entry}>{entry}</li>
                ))}
                {status.glossaryHiddenCount ? <li>另 {status.glossaryHiddenCount} 条</li> : null}
              </ul>
            </div>
          )}
          {status.styleNote && (
            <div className="space-y-1 text-claude-dark-600">
              <p className="font-medium text-claude-dark-700">已保存语言风格</p>
              {status.styleTarget && (
                <p className="text-claude-dark-500">保存位置：{status.styleTarget}</p>
              )}
              <p>{status.styleNote}</p>
            </div>
          )}
        </output>
      )}
    </div>
  )
}
