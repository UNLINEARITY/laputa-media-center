'use client'

import { Loader2, RefreshCw, Save, Star, Trash2, UsersRound, Volume2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Input, Label, Textarea } from '@/components/ui'
import {
  EMPTY_CREATOR_PROFILE,
  type NormalizedCreatorProfile,
  parseCreatorProfileConfig,
} from '@/lib/dubbing/creator-profile'
import {
  formatMiniMaxVoiceAuthorizationRecordStatus,
  getMiniMaxVoiceAuthorizationRecordStatus,
  MINIMAX_VOICE_CATEGORIES,
  MINIMAX_VOICE_CLONE_ORIGINS,
  MINIMAX_VOICE_GENDERS,
  type MiniMaxVoiceCategory,
  type MiniMaxVoiceCloneOrigin,
  type MiniMaxVoiceGender,
  type MiniMaxVoiceRegistryEntry,
} from '@/lib/dubbing/voice-registry'
import { cn } from '@/lib/utils/cn'

type VoiceDraft = {
  voiceId: string
  displayName: string
  category: MiniMaxVoiceCategory
  cloneOrigin: MiniMaxVoiceCloneOrigin | ''
  cloneSource: string
  clonedAt: string
  cloneCostUsd: string
  authorizationProof: string
  applicablePeopleText: string
  gender: MiniMaxVoiceGender | ''
  languagesText: string
  speakerAliasesText: string
  publicFigure: boolean
  authorized: boolean
  requiresDisclosure: boolean
  usageLabel: string
  notes: string
  priority: string
}

type EditorStatus = {
  type: 'success' | 'error'
  text: string
} | null

type CreatorVoiceRole = 'primary' | 'secondary'

const CREATOR_PROFILE_CONFIG_KEY = 'laputa_creator_profile'

const VOICE_CATEGORY_LABELS: Record<MiniMaxVoiceCategory, string> = {
  creator_owned: '创作者自有声线',
  authorized_clone: '授权克隆声线',
  public_figure_commentary: '名人翻译/评论声线',
  synthetic_narration: 'AI 合成旁白声线',
  generic: 'MiniMax 通用旁白声线',
}

const VOICE_GENDER_LABELS: Record<MiniMaxVoiceGender, string> = {
  male: '男声',
  female: '女声',
  neutral: '中性声线',
}

const CATEGORY_DEFAULTS: Record<
  MiniMaxVoiceCategory,
  Pick<
    VoiceDraft,
    'authorized' | 'publicFigure' | 'requiresDisclosure' | 'usageLabel' | 'cloneOrigin'
  >
> = {
  creator_owned: {
    authorized: true,
    publicFigure: false,
    requiresDisclosure: false,
    usageLabel: '创作者本人或自有声线',
    cloneOrigin: 'minimax_clone',
  },
  authorized_clone: {
    authorized: true,
    publicFigure: false,
    requiresDisclosure: false,
    usageLabel: '授权克隆声线（本地记录）',
    cloneOrigin: 'minimax_clone',
  },
  public_figure_commentary: {
    authorized: false,
    publicFigure: true,
    requiresDisclosure: true,
    usageLabel: '名人素材翻译/评论配音，需明确标注非本人原声',
    cloneOrigin: 'minimax_clone',
  },
  synthetic_narration: {
    authorized: false,
    publicFigure: false,
    requiresDisclosure: true,
    usageLabel: 'MiniMax 合成旁白声线',
    cloneOrigin: 'manual_voice_id',
  },
  generic: {
    authorized: true,
    publicFigure: false,
    requiresDisclosure: false,
    usageLabel: 'MiniMax 通用旁白声线',
    cloneOrigin: 'minimax_builtin',
  },
}

const CLONE_ORIGIN_LABELS: Record<MiniMaxVoiceCloneOrigin, string> = {
  minimax_clone: 'MiniMax 克隆声线',
  minimax_builtin: 'MiniMax 内置声线',
  manual_voice_id: '手动录入 voice_id',
  system_default: '凭证验证声线',
}

function createEmptyDraft(voiceId = ''): VoiceDraft {
  const defaults = CATEGORY_DEFAULTS.synthetic_narration
  return {
    voiceId,
    displayName: '',
    category: 'synthetic_narration',
    cloneOrigin: defaults.cloneOrigin,
    cloneSource: '',
    clonedAt: '',
    cloneCostUsd: '',
    authorizationProof: '',
    applicablePeopleText: '',
    gender: '',
    languagesText: '',
    speakerAliasesText: '',
    publicFigure: defaults.publicFigure,
    authorized: defaults.authorized,
    requiresDisclosure: defaults.requiresDisclosure,
    usageLabel: defaults.usageLabel,
    notes: '',
    priority: '0',
  }
}

function formatList(values: readonly string[] | undefined): string {
  return (values || []).join('\n')
}

function parseList(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\n,，;；]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  )
}

function sortVoices(voices: readonly MiniMaxVoiceRegistryEntry[]): MiniMaxVoiceRegistryEntry[] {
  return [...voices].sort((left, right) => {
    const priorityDelta = right.priority - left.priority
    if (priorityDelta !== 0) return priorityDelta
    return left.voice_id.localeCompare(right.voice_id)
  })
}

function draftFromVoice(voice: MiniMaxVoiceRegistryEntry): VoiceDraft {
  return {
    voiceId: voice.voice_id,
    displayName: voice.display_name === voice.voice_id ? '' : voice.display_name,
    category: voice.category,
    cloneOrigin: voice.clone_origin || '',
    cloneSource: voice.clone_source || '',
    clonedAt: voice.cloned_at || '',
    cloneCostUsd: typeof voice.clone_cost_usd === 'number' ? String(voice.clone_cost_usd) : '',
    authorizationProof: voice.authorization_proof || '',
    applicablePeopleText: formatList(voice.applicable_people),
    gender: voice.gender || '',
    languagesText: formatList(voice.languages),
    speakerAliasesText: formatList(voice.speaker_aliases),
    publicFigure: voice.public_figure,
    authorized: voice.authorized,
    requiresDisclosure: voice.requires_disclosure,
    usageLabel: voice.usage_label,
    notes: voice.notes || '',
    priority: String(voice.priority || 0),
  }
}

function isSystemDefaultVoice(voice: MiniMaxVoiceRegistryEntry | undefined): boolean {
  return voice?.clone_origin === 'system_default' || voice?.created_at === '默认声线'
}

function getVoiceRoleLabels(voiceId: string, profile: NormalizedCreatorProfile): string[] {
  const labels: string[] = []
  if (profile.default_voice_id === voiceId) labels.push('默认主声线')
  if (profile.secondary_voice_id === voiceId) labels.push('默认第二声线')
  return labels
}

export function MiniMaxVoiceRegistryEditor() {
  const [voices, setVoices] = useState<MiniMaxVoiceRegistryEntry[]>([])
  const [draft, setDraft] = useState<VoiceDraft>(() => createEmptyDraft())
  const [creatorProfile, setCreatorProfile] =
    useState<NormalizedCreatorProfile>(EMPTY_CREATOR_PROFILE)
  const [loading, setLoading] = useState(true)
  const [profileLoading, setProfileLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [profileSavingRole, setProfileSavingRole] = useState<CreatorVoiceRole | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [status, setStatus] = useState<EditorStatus>(null)

  const selectedVoice = useMemo(
    () => voices.find((voice) => voice.voice_id === draft.voiceId.trim()),
    [draft.voiceId, voices],
  )
  const readOnlySystemDefault = isSystemDefaultVoice(selectedVoice)
  const canSave = draft.voiceId.trim().length > 0 && !loading && !saving && !readOnlySystemDefault
  const canDelete = Boolean(selectedVoice && !readOnlySystemDefault && !deleting)
  const selectedVoiceRoleLabels = useMemo(
    () =>
      selectedVoice
        ? getVoiceRoleLabels(selectedVoice.voice_id, creatorProfile)
        : getVoiceRoleLabels(draft.voiceId.trim(), creatorProfile),
    [creatorProfile, draft.voiceId, selectedVoice],
  )
  const selectedVoiceIsRegistered = Boolean(selectedVoice && !readOnlySystemDefault)
  const canSetCreatorVoiceRole =
    selectedVoiceIsRegistered && !profileLoading && profileSavingRole === null

  const loadCreatorProfile = useCallback(async () => {
    setProfileLoading(true)
    try {
      const response = await fetch(`/api/configs/${CREATOR_PROFILE_CONFIG_KEY}`)
      if (response.status === 404) {
        setCreatorProfile(EMPTY_CREATOR_PROFILE)
        return
      }

      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || '读取创作者默认声线失败')
      setCreatorProfile(parseCreatorProfileConfig(data.value) || EMPTY_CREATOR_PROFILE)
    } catch (error) {
      const message = error instanceof Error ? error.message : '读取创作者默认声线失败'
      setStatus({ type: 'error', text: message })
    } finally {
      setProfileLoading(false)
    }
  }, [])

  const loadVoices = useCallback(async (preferredVoiceId?: string) => {
    setLoading(true)
    try {
      const response = await fetch('/api/dubbing/voices')
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || '读取声线清单失败')

      const nextVoices = sortVoices(
        Array.isArray(data.voices) ? (data.voices as MiniMaxVoiceRegistryEntry[]) : [],
      )
      setVoices(nextVoices)

      const nextSelected =
        nextVoices.find((voice) => voice.voice_id === preferredVoiceId) || nextVoices[0]
      setDraft(nextSelected ? draftFromVoice(nextSelected) : createEmptyDraft(preferredVoiceId))
      setStatus(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : '读取声线清单失败'
      setStatus({ type: 'error', text: message })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadVoices()
    loadCreatorProfile()
  }, [loadCreatorProfile, loadVoices])

  function updateDraft(patch: Partial<VoiceDraft>) {
    setDraft((current) => {
      const next = { ...current, ...patch }
      if (next.publicFigure || next.category === 'public_figure_commentary') {
        next.requiresDisclosure = true
        next.publicFigure = true
      }
      return next
    })
    setStatus(null)
  }

  function selectVoice(voice: MiniMaxVoiceRegistryEntry) {
    setDraft(draftFromVoice(voice))
    setStatus(null)
  }

  function handleVoiceIdChange(value: string) {
    const matchedVoice = voices.find((voice) => voice.voice_id === value.trim())
    setDraft(matchedVoice ? draftFromVoice(matchedVoice) : createEmptyDraft(value))
    setStatus(null)
  }

  function applyCategory(category: MiniMaxVoiceCategory) {
    updateDraft({
      category,
      ...CATEGORY_DEFAULTS[category],
    })
  }

  async function saveVoice() {
    if (!canSave) return

    setSaving(true)
    try {
      const priority = Number(draft.priority)
      const cloneCostUsd = Number(draft.cloneCostUsd)
      const response = await fetch('/api/dubbing/voices', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voiceId: draft.voiceId.trim(),
          refAudio: 'manual',
          displayName: draft.displayName.trim(),
          category: draft.category,
          cloneOrigin: draft.cloneOrigin || undefined,
          cloneSource: draft.cloneSource.trim(),
          clonedAt: draft.clonedAt.trim(),
          cloneCostUsd:
            Number.isFinite(cloneCostUsd) && cloneCostUsd >= 0 ? cloneCostUsd : undefined,
          authorizationProof: draft.authorizationProof.trim(),
          applicablePeople: parseList(draft.applicablePeopleText),
          gender: draft.gender || undefined,
          languages: parseList(draft.languagesText),
          speakerAliases: parseList(draft.speakerAliasesText),
          publicFigure: draft.publicFigure,
          authorized: draft.authorized,
          requiresDisclosure: draft.requiresDisclosure,
          usageLabel: draft.usageLabel.trim(),
          notes: draft.notes.trim(),
          priority: Number.isFinite(priority) ? priority : 0,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || '保存声线元数据失败')

      await loadVoices(draft.voiceId.trim())
      setStatus({ type: 'success', text: '声线元数据已保存，之后的配音任务会读取这份清单。' })
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存声线元数据失败'
      setStatus({ type: 'error', text: message })
    } finally {
      setSaving(false)
    }
  }

  async function setCreatorVoiceRole(role: CreatorVoiceRole) {
    if (!canSetCreatorVoiceRole || !selectedVoice) return

    setProfileSavingRole(role)
    try {
      const latestProfileResponse = await fetch(`/api/configs/${CREATOR_PROFILE_CONFIG_KEY}`)
      if (!latestProfileResponse.ok && latestProfileResponse.status !== 404) {
        const data = await latestProfileResponse.json().catch(() => ({}))
        throw new Error(data.error || '读取最新创作者默认声线失败')
      }
      const latestProfileData = latestProfileResponse.ok
        ? await latestProfileResponse.json().catch(() => ({}))
        : {}
      const latestProfile =
        parseCreatorProfileConfig(latestProfileData.value) || EMPTY_CREATOR_PROFILE
      const nextProfile: NormalizedCreatorProfile = {
        ...latestProfile,
        default_voice_id:
          role === 'primary' ? selectedVoice.voice_id : latestProfile.default_voice_id,
        secondary_voice_id:
          role === 'secondary' ? selectedVoice.voice_id : latestProfile.secondary_voice_id,
      }

      const response = await fetch(`/api/configs/${CREATOR_PROFILE_CONFIG_KEY}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: JSON.stringify(nextProfile) }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || '保存创作者默认声线失败')

      setCreatorProfile(nextProfile)
      setStatus({
        type: 'success',
        text: role === 'primary' ? '已设为创作者默认主声线。' : '已设为创作者默认第二声线。',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存创作者默认声线失败'
      setStatus({ type: 'error', text: message })
    } finally {
      setProfileSavingRole(null)
    }
  }

  async function deleteVoice() {
    if (!canDelete) return

    setDeleting(true)
    try {
      const deletingVoiceId = draft.voiceId.trim()
      const response = await fetch('/api/dubbing/voices', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceId: deletingVoiceId }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || '删除声线失败')

      await loadVoices()
      setStatus({
        type: 'success',
        text: data.removed ? '声线已从本地清单移除。' : '本地清单里没有这条声线。',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : '删除声线失败'
      setStatus({ type: 'error', text: message })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <section className="space-y-4 rounded-md border border-claude-cream-200 bg-claude-cream-50 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-claude-dark-900">声线元数据清单</h3>
          <p className="mt-1 text-sm text-claude-dark-400">
            管理长期 voice_id 的本地授权记录、用途、讲者别名和优先级；这里只写本地清单，不验证或调用
            MiniMax TTS。
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            loadVoices(draft.voiceId.trim())
            loadCreatorProfile()
          }}
        >
          {loading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          刷新
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)]">
        <div className="space-y-2">
          {voices.length > 0 ? (
            voices.map((voice) => {
              const roleLabels = getVoiceRoleLabels(voice.voice_id, creatorProfile)

              const authorizationRecordStatus = getMiniMaxVoiceAuthorizationRecordStatus(voice)

              return (
                <button
                  key={voice.voice_id}
                  type="button"
                  onClick={() => selectVoice(voice)}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-md border bg-white px-3 py-2 text-left transition-colors',
                    draft.voiceId.trim() === voice.voice_id
                      ? 'border-claude-orange-500 bg-claude-orange-50'
                      : 'border-claude-cream-200 hover:border-claude-cream-300',
                  )}
                >
                  <Volume2 className="mt-0.5 h-4 w-4 shrink-0 text-claude-orange-600" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-claude-dark-900">
                      {voice.display_name || voice.voice_id}
                    </span>
                    <span className="block truncate text-xs text-claude-dark-400">
                      {voice.usage_label || VOICE_CATEGORY_LABELS[voice.category]}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {roleLabels.map((label) => (
                        <span
                          key={label}
                          className="rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700"
                        >
                          {label}
                        </span>
                      ))}
                      <span className="rounded-md border border-claude-cream-200 bg-white px-1.5 py-0.5 text-[11px] text-claude-dark-500">
                        {VOICE_CATEGORY_LABELS[voice.category]}
                      </span>
                      {authorizationRecordStatus === 'self_attested' && (
                        <span className="rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700">
                          {formatMiniMaxVoiceAuthorizationRecordStatus(authorizationRecordStatus)}
                        </span>
                      )}
                      {voice.requires_disclosure && (
                        <span className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700">
                          需披露
                        </span>
                      )}
                      {isSystemDefaultVoice(voice) && (
                        <span className="rounded-md border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[11px] text-sky-700">
                          验证用
                        </span>
                      )}
                      {voice.applicable_people?.[0] && (
                        <span className="rounded-md border border-claude-cream-200 bg-white px-1.5 py-0.5 text-[11px] text-claude-dark-500">
                          适用 {voice.applicable_people[0]}
                        </span>
                      )}
                      {typeof voice.clone_cost_usd === 'number' && (
                        <span className="rounded-md border border-claude-cream-200 bg-white px-1.5 py-0.5 text-[11px] text-claude-dark-500">
                          克隆成本 ${voice.clone_cost_usd}
                        </span>
                      )}
                      {voice.priority !== 0 && (
                        <span className="rounded-md border border-claude-cream-200 bg-white px-1.5 py-0.5 text-[11px] text-claude-dark-500">
                          优先级 {voice.priority}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              )
            })
          ) : (
            <div className="rounded-md border border-dashed border-claude-cream-300 bg-white px-3 py-4 text-sm text-claude-dark-400">
              暂无本地声线。输入 voice_id 后可先保存为需披露的 AI 合成旁白，再补授权和用途。
            </div>
          )}
        </div>

        <div className="space-y-4 rounded-md border border-claude-cream-200 bg-white px-3 py-3">
          <div className="rounded-md border border-claude-cream-200 bg-claude-cream-50 px-3 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-claude-dark-900">创作者默认声线绑定</p>
                <p className="text-xs leading-5 text-claude-dark-400">
                  默认主声线和第二声线只保存
                  voice_id；授权、人物和披露元数据仍以左侧这条本地清单为准。
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                {selectedVoiceRoleLabels.length > 0 ? (
                  selectedVoiceRoleLabels.map((label) => (
                    <span
                      key={label}
                      className="rounded-md border border-emerald-200 bg-white px-2 py-1 text-xs text-emerald-700"
                    >
                      {label}
                    </span>
                  ))
                ) : (
                  <span className="rounded-md border border-claude-cream-200 bg-white px-2 py-1 text-xs text-claude-dark-400">
                    未设为默认
                  </span>
                )}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreatorVoiceRole('primary')}
                disabled={!canSetCreatorVoiceRole || profileSavingRole === 'secondary'}
              >
                {profileSavingRole === 'primary' ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Star className="mr-2 h-4 w-4" />
                )}
                设为默认主声线
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreatorVoiceRole('secondary')}
                disabled={!canSetCreatorVoiceRole || profileSavingRole === 'primary'}
              >
                {profileSavingRole === 'secondary' ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <UsersRound className="mr-2 h-4 w-4" />
                )}
                设为默认第二声线
              </Button>
            </div>
            {!selectedVoiceIsRegistered && draft.voiceId.trim() && (
              <p className="mt-2 text-xs leading-5 text-amber-700">
                这条 voice_id 还没有保存为本地声线元数据；请先保存后再设为创作者默认声线。
              </p>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="voice-registry-id">voice_id</Label>
              <Input
                id="voice-registry-id"
                value={draft.voiceId}
                onChange={(event) => handleVoiceIdChange(event.target.value)}
                placeholder="例如 voice_trump_commentary"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="voice-registry-display-name">显示名称</Label>
              <Input
                id="voice-registry-display-name"
                value={draft.displayName}
                onChange={(event) => updateDraft({ displayName: event.target.value })}
                placeholder="例如 Trump 评论配音"
                disabled={readOnlySystemDefault}
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="voice-registry-category">声线类型</Label>
              <select
                id="voice-registry-category"
                value={draft.category}
                onChange={(event) => applyCategory(event.target.value as MiniMaxVoiceCategory)}
                disabled={readOnlySystemDefault}
                className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                {MINIMAX_VOICE_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {VOICE_CATEGORY_LABELS[category]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="voice-registry-clone-origin">来源类型</Label>
              <select
                id="voice-registry-clone-origin"
                value={draft.cloneOrigin}
                onChange={(event) =>
                  updateDraft({ cloneOrigin: event.target.value as MiniMaxVoiceCloneOrigin | '' })
                }
                disabled={readOnlySystemDefault}
                className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">未指定</option>
                {MINIMAX_VOICE_CLONE_ORIGINS.map((origin) => (
                  <option key={origin} value={origin}>
                    {CLONE_ORIGIN_LABELS[origin]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="voice-registry-gender">声线性别</Label>
              <select
                id="voice-registry-gender"
                value={draft.gender}
                onChange={(event) =>
                  updateDraft({ gender: event.target.value as MiniMaxVoiceGender | '' })
                }
                disabled={readOnlySystemDefault}
                className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">未指定</option>
                {MINIMAX_VOICE_GENDERS.map((gender) => (
                  <option key={gender} value={gender}>
                    {VOICE_GENDER_LABELS[gender]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="voice-registry-priority">优先级</Label>
              <Input
                id="voice-registry-priority"
                type="number"
                value={draft.priority}
                onChange={(event) => updateDraft({ priority: event.target.value })}
                disabled={readOnlySystemDefault}
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="voice-registry-clone-source">克隆来源</Label>
              <Input
                id="voice-registry-clone-source"
                value={draft.cloneSource}
                onChange={(event) => updateDraft({ cloneSource: event.target.value })}
                placeholder="样本文件、人物或 MiniMax 内置名"
                disabled={readOnlySystemDefault}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="voice-registry-cloned-at">克隆日期</Label>
              <Input
                id="voice-registry-cloned-at"
                value={draft.clonedAt}
                onChange={(event) => updateDraft({ clonedAt: event.target.value })}
                placeholder="2026-04-28"
                disabled={readOnlySystemDefault}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="voice-registry-clone-cost">克隆成本 USD</Label>
              <Input
                id="voice-registry-clone-cost"
                type="number"
                min="0"
                step="0.01"
                value={draft.cloneCostUsd}
                onChange={(event) => updateDraft({ cloneCostUsd: event.target.value })}
                placeholder="9.9"
                disabled={readOnlySystemDefault}
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="voice-registry-people">适用人物</Label>
              <Textarea
                id="voice-registry-people"
                value={draft.applicablePeopleText}
                onChange={(event) => updateDraft({ applicablePeopleText: event.target.value })}
                placeholder={'特朗普\nElon Musk'}
                disabled={readOnlySystemDefault}
                className="min-h-20"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="voice-registry-languages">适用语言</Label>
              <Textarea
                id="voice-registry-languages"
                value={draft.languagesText}
                onChange={(event) => updateDraft({ languagesText: event.target.value })}
                placeholder={'mandarin\ncantonese'}
                disabled={readOnlySystemDefault}
                className="min-h-20"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="voice-registry-aliases">讲者别名</Label>
              <Textarea
                id="voice-registry-aliases"
                value={draft.speakerAliasesText}
                onChange={(event) => updateDraft({ speakerAliasesText: event.target.value })}
                placeholder={'Trump\n特朗普'}
                disabled={readOnlySystemDefault}
                className="min-h-20"
              />
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <label className="flex items-start gap-2 rounded-md border border-claude-cream-200 px-3 py-2 text-sm text-claude-dark-600">
              <input
                type="checkbox"
                checked={draft.authorized}
                onChange={(event) => updateDraft({ authorized: event.target.checked })}
                disabled={readOnlySystemDefault}
                className="mt-1 h-4 w-4 rounded border-claude-cream-300 text-claude-orange-600"
              />
              <span>
                <span className="block">已记录授权声明</span>
                <span className="block text-xs leading-5 text-claude-dark-400">
                  仅保存本地记录，不代表 MiniMax 或平台验证。
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 rounded-md border border-claude-cream-200 px-3 py-2 text-sm text-claude-dark-600">
              <input
                type="checkbox"
                checked={draft.publicFigure}
                onChange={(event) => updateDraft({ publicFigure: event.target.checked })}
                disabled={readOnlySystemDefault || draft.category === 'public_figure_commentary'}
                className="mt-1 h-4 w-4 rounded border-claude-cream-300 text-claude-orange-600"
              />
              公众人物
            </label>
            <label className="flex items-start gap-2 rounded-md border border-claude-cream-200 px-3 py-2 text-sm text-claude-dark-600">
              <input
                type="checkbox"
                checked={draft.requiresDisclosure}
                onChange={(event) => updateDraft({ requiresDisclosure: event.target.checked })}
                disabled={readOnlySystemDefault || draft.publicFigure}
                className="mt-1 h-4 w-4 rounded border-claude-cream-300 text-claude-orange-600"
              />
              需披露
            </label>
          </div>

          <div className="space-y-2">
            <Label htmlFor="voice-registry-usage-label">用途说明</Label>
            <Input
              id="voice-registry-usage-label"
              value={draft.usageLabel}
              onChange={(event) => updateDraft({ usageLabel: event.target.value })}
              disabled={readOnlySystemDefault}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="voice-registry-authorization-proof">授权证明</Label>
            <Textarea
              id="voice-registry-authorization-proof"
              value={draft.authorizationProof}
              onChange={(event) => updateDraft({ authorizationProof: event.target.value })}
              placeholder="记录授权链接、合约编号、本人确认或公开评论转译依据"
              disabled={readOnlySystemDefault}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="voice-registry-notes">备注</Label>
            <Textarea
              id="voice-registry-notes"
              value={draft.notes}
              onChange={(event) => updateDraft({ notes: event.target.value })}
              placeholder="记录授权来源、适用频道或限制"
              disabled={readOnlySystemDefault}
            />
          </div>

          {readOnlySystemDefault && (
            <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs leading-5 text-sky-700">
              这条声线来自 MiniMax 凭证的验证用 voice_id，不是正式配音默认声线。要用于正式配音，
              请保存另一条本地声线记录，并在创作者默认声线绑定中设置。
            </div>
          )}

          {status && (
            <p
              className={cn(
                'rounded-md border px-3 py-2 text-sm',
                status.type === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-red-200 bg-red-50 text-red-700',
              )}
            >
              {status.text}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={saveVoice} disabled={!canSave}>
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              保存声线元数据
            </Button>
            <Button type="button" variant="outline" onClick={deleteVoice} disabled={!canDelete}>
              {deleting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              删除本地声线
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
