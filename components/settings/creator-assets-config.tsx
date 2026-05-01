'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Textarea,
} from '@/components/ui'
import {
  EMPTY_CREATOR_PROFILE,
  formatOtherLanguageStyleGuides,
  mergeCreatorProfileDraftWithLatest,
  type NormalizedCreatorProfile,
  parseCreatorProfileConfig,
  parseOtherLanguageStyleGuidesText,
  type WordingStyle,
} from '@/lib/dubbing/creator-profile'
import {
  countGlossaryEntries,
  type LocalizationGlossaryEntry,
  parseGlossaryText,
} from '@/lib/dubbing/glossary'
import {
  formatProjectGlossaryValue,
  mergeProjectGlossary,
  mergeProjectGlossaryConfigValues,
  PROJECT_GLOSSARY_CONFIG_KEYS,
  PROJECT_GLOSSARY_CONFIG_READ_ORDER,
} from '@/lib/dubbing/project-glossary'

const CREATOR_PROFILE_CONFIG_KEY = 'laputa_creator_profile'
const PROJECT_GLOSSARY_CONFIG_KEY = PROJECT_GLOSSARY_CONFIG_KEYS[0]
const WORDING_STYLE_LABELS: Record<WordingStyle, string> = {
  auto: '自动判断',
  plain: '简单易懂',
  professional: '专业严谨',
}

interface SaveMessage {
  type: 'success' | 'error'
  text: string
  details?: string[]
}

function compactText(value: string, maxLength = 56): string {
  const text = value.replace(/\s+/g, ' ').trim()
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}...`
}

function formatGlossaryEntry(entry: LocalizationGlossaryEntry): string {
  return `${entry.source} -> ${entry.target}${entry.note ? ` # ${entry.note}` : ''}`
}

function buildCreatorAssetDetails(
  profile: NormalizedCreatorProfile,
  otherLanguageStyleText: string,
  glossaryText: string,
): string[] {
  const details: string[] = []
  const otherLanguageGuides = parseOtherLanguageStyleGuidesText(otherLanguageStyleText)
  const glossaryEntries = parseGlossaryText(glossaryText)

  if (profile.creator_name.trim()) {
    details.push(`创作者/频道：${compactText(profile.creator_name)}`)
  }
  if (profile.default_audience.trim()) {
    details.push(`默认受众：${compactText(profile.default_audience)}`)
  }
  if (profile.creator_positioning.trim()) {
    details.push(`内容定位：${compactText(profile.creator_positioning)}`)
  }

  details.push(`默认用词：${WORDING_STYLE_LABELS[profile.default_wording_style]}`)

  if (profile.default_voice_id.trim()) {
    details.push(`主声线：${compactText(profile.default_voice_id, 48)}`)
  }
  if (profile.secondary_voice_id.trim()) {
    details.push(`第二声线：${compactText(profile.secondary_voice_id, 48)}`)
  }

  const styleGuideDetails = [
    profile.cantonese_style_guide.trim()
      ? `粤语 ${compactText(profile.cantonese_style_guide)}`
      : '',
    profile.mandarin_style_guide.trim()
      ? `普通话 ${compactText(profile.mandarin_style_guide)}`
      : '',
    ...Object.entries(otherLanguageGuides)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([language, guide]) => `${language} ${compactText(guide)}`),
  ].filter(Boolean)

  if (styleGuideDetails.length > 0) {
    details.push(`口播偏好：${styleGuideDetails.join('；')}`)
  }

  if (glossaryEntries.length > 0) {
    const preview = glossaryEntries.slice(0, 3).map(formatGlossaryEntry).join('；')
    const suffix = glossaryEntries.length > 3 ? `；另 ${glossaryEntries.length - 3} 条` : ''
    details.push(`固定读法：${glossaryEntries.length} 条（${preview}${suffix}）`)
  }

  return details
}

async function loadProjectGlossaryText(): Promise<string> {
  const values: string[] = []

  for (const key of PROJECT_GLOSSARY_CONFIG_READ_ORDER) {
    const response = await fetch(`/api/configs/${key}`)
    if (!response.ok) continue

    const data = await response.json().catch(() => ({}))
    if (typeof data.value !== 'string') continue
    values.push(data.value)
  }

  const entries = mergeProjectGlossaryConfigValues(values)
  return entries.length > 0 ? formatProjectGlossaryValue(entries) : ''
}

export function CreatorAssetsConfig() {
  const [profile, setProfile] = useState<NormalizedCreatorProfile>(EMPTY_CREATOR_PROFILE)
  const [otherLanguageStyleText, setOtherLanguageStyleText] = useState('')
  const [glossaryText, setGlossaryText] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<SaveMessage | null>(null)

  const glossaryCount = useMemo(() => countGlossaryEntries(glossaryText), [glossaryText])
  const assetDetails = useMemo(
    () => buildCreatorAssetDetails(profile, otherLanguageStyleText, glossaryText),
    [profile, otherLanguageStyleText, glossaryText],
  )
  const visibleAssetDetails =
    message?.type === 'success' && message.details ? message.details : assetDetails

  useEffect(() => {
    let active = true

    async function load() {
      try {
        const [profileResponse, projectGlossaryText] = await Promise.all([
          fetch(`/api/configs/${CREATOR_PROFILE_CONFIG_KEY}`),
          loadProjectGlossaryText(),
        ])

        if (!active) return

        if (profileResponse.ok) {
          const data = await profileResponse.json()
          const nextProfile = parseCreatorProfileConfig(data.value) || EMPTY_CREATOR_PROFILE
          setProfile(nextProfile)
          setOtherLanguageStyleText(
            formatOtherLanguageStyleGuides(nextProfile.other_language_style_guides),
          )
        }

        setGlossaryText(projectGlossaryText)
      } finally {
        if (active) setLoading(false)
      }
    }

    load()
    return () => {
      active = false
    }
  }, [])

  function updateProfile<K extends keyof NormalizedCreatorProfile>(
    key: K,
    value: NormalizedCreatorProfile[K],
  ) {
    setProfile((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSave() {
    setSaving(true)
    setMessage(null)

    try {
      const draftProfilePayload: NormalizedCreatorProfile = {
        ...profile,
        creator_name: profile.creator_name.trim(),
        creator_positioning: profile.creator_positioning.trim(),
        default_audience: profile.default_audience.trim(),
        cantonese_style_guide: profile.cantonese_style_guide.trim(),
        mandarin_style_guide: profile.mandarin_style_guide.trim(),
        other_language_style_guides: parseOtherLanguageStyleGuidesText(otherLanguageStyleText),
        default_voice_id: profile.default_voice_id.trim(),
        secondary_voice_id: profile.secondary_voice_id.trim(),
      }
      const [latestProfileResponse, latestProjectGlossaryText] = await Promise.all([
        fetch(`/api/configs/${CREATOR_PROFILE_CONFIG_KEY}`),
        loadProjectGlossaryText(),
      ])
      if (!latestProfileResponse.ok && latestProfileResponse.status !== 404) {
        throw new Error('读取最新创作者资产失败')
      }
      const latestProfileData = latestProfileResponse.ok
        ? await latestProfileResponse.json().catch(() => ({}))
        : {}
      const latestProfile = parseCreatorProfileConfig(latestProfileData.value)
      const profilePayload = mergeCreatorProfileDraftWithLatest(latestProfile, draftProfilePayload)
      const glossaryPayload = formatProjectGlossaryValue(
        mergeProjectGlossary(
          parseGlossaryText(latestProjectGlossaryText),
          parseGlossaryText(glossaryText),
        ),
      )

      const [profileResponse, glossaryResponse] = await Promise.all([
        fetch(`/api/configs/${CREATOR_PROFILE_CONFIG_KEY}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: JSON.stringify(profilePayload) }),
        }),
        fetch(`/api/configs/${PROJECT_GLOSSARY_CONFIG_KEY}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: glossaryPayload }),
        }),
      ])

      if (!profileResponse.ok || !glossaryResponse.ok) {
        throw new Error('保存创作者资产失败')
      }

      const formattedOtherLanguageStyleText = formatOtherLanguageStyleGuides(
        profilePayload.other_language_style_guides,
      )
      setProfile(profilePayload)
      setOtherLanguageStyleText(formattedOtherLanguageStyleText)
      setGlossaryText(glossaryPayload)
      setMessage({
        type: 'success',
        text: '创作者资产已保存，之后的翻译配音任务会自动套用。',
        details: buildCreatorAssetDetails(
          profilePayload,
          formattedOtherLanguageStyleText,
          glossaryPayload,
        ),
      })
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '保存创作者资产失败',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="claude-card" id="creator_assets">
      <CardHeader className="space-y-1">
        <CardTitle className="text-xl font-semibold text-claude-dark-900">创作者资产</CardTitle>
        <CardDescription className="text-sm text-claude-dark-300">
          保存长期受众、语气、声线和词库；单次任务的内容简报仍然可以覆盖这些默认值。
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="creator-name">创作者 / 频道名称</Label>
            <Input
              id="creator-name"
              value={profile.creator_name}
              onChange={(event) => updateProfile('creator_name', event.target.value)}
              placeholder="例如：Laputa 内容引擎"
              className="h-11"
              disabled={loading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="default-audience">默认受众</Label>
            <Input
              id="default-audience"
              value={profile.default_audience}
              onChange={(event) => updateProfile('default_audience', event.target.value)}
              placeholder="例如：粤语/华语创作者、普通观众、产品人"
              className="h-11"
              disabled={loading}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="creator-positioning">内容定位</Label>
          <Textarea
            id="creator-positioning"
            value={profile.creator_positioning}
            onChange={(event) => updateProfile('creator_positioning', event.target.value)}
            placeholder="例如：重视产品观点、商业判断和创作者实战，不做逐句硬翻。"
            className="min-h-24"
            disabled={loading}
          />
        </div>

        <div className="space-y-3">
          <Label>默认用词倾向</Label>
          <div className="grid gap-3 md:grid-cols-3">
            {[
              { value: 'auto', label: '自动判断', description: '按任务内容决定深浅。' },
              { value: 'plain', label: '简单易懂', description: '优先让普通观众听明白。' },
              { value: 'professional', label: '专业严谨', description: '保留术语与专业细节。' },
            ].map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => updateProfile('default_wording_style', item.value as WordingStyle)}
                disabled={loading}
                className={`min-h-20 rounded-md border px-4 py-3 text-left transition-colors ${
                  profile.default_wording_style === item.value
                    ? 'border-claude-orange-500 bg-claude-orange-50'
                    : 'border-claude-cream-200 bg-white hover:border-claude-cream-300 hover:bg-claude-cream-50'
                }`}
              >
                <span className="block text-sm font-semibold text-claude-dark-900">
                  {item.label}
                </span>
                <span className="mt-1 block text-xs leading-5 text-claude-dark-400">
                  {item.description}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="cantonese-style">粤语口播偏好</Label>
            <Textarea
              id="cantonese-style"
              value={profile.cantonese_style_guide}
              onChange={(event) => updateProfile('cantonese_style_guide', event.target.value)}
              placeholder="例如：自然香港粤语，避免书面腔；Wave59 读 Wave五十九。"
              className="min-h-28"
              disabled={loading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="mandarin-style">普通话口播偏好</Label>
            <Textarea
              id="mandarin-style"
              value={profile.mandarin_style_guide}
              onChange={(event) => updateProfile('mandarin_style_guide', event.target.value)}
              placeholder="例如：自然播客口吻，保留观点感，专有名词不乱翻。"
              className="min-h-28"
              disabled={loading}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="other-language-style">其他语言口播偏好</Label>
          <Textarea
            id="other-language-style"
            value={otherLanguageStyleText}
            onChange={(event) => setOtherLanguageStyleText(event.target.value)}
            placeholder={[
              '[ja]',
              '自然但不要动漫腔；专有名词保留英文。',
              '',
              'es: 口吻清楚，不要太夸张。',
            ].join('\n')}
            className="min-h-32 font-mono"
            disabled={loading}
          />
          <p className="text-xs leading-5 text-claude-dark-400">
            用 [语言代码] 分段，例如 [ja]、[es]、[fr]；compare 页保存非中文语言规则时也会写到这里。
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="default-voice-id">默认主声线 voice_id</Label>
            <Input
              id="default-voice-id"
              value={profile.default_voice_id}
              onChange={(event) => updateProfile('default_voice_id', event.target.value)}
              placeholder="例如：MiniMax voice_id（先登记用途/授权记录）"
              className="h-11"
              disabled={loading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="secondary-voice-id">默认第二声线 voice_id</Label>
            <Input
              id="secondary-voice-id"
              value={profile.secondary_voice_id}
              onChange={(event) => updateProfile('secondary_voice_id', event.target.value)}
              placeholder="用于双人对话区分声线"
              className="h-11"
              disabled={loading}
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="project-glossary">项目词库与固定读法</Label>
            <span className="text-xs text-claude-dark-300">已解析 {glossaryCount} 条</span>
          </div>
          <Textarea
            id="project-glossary"
            value={glossaryText}
            onChange={(event) => setGlossaryText(event.target.value)}
            placeholder={[
              'Lars Vontine -> Lars von Thienen # 正确讲者姓名',
              'Wave59 -> Wave五十九 # 固定口播读法',
              'Listen Only mode -> 只限收听模式',
            ].join('\n')}
            className="min-h-36 font-mono"
            disabled={loading}
          />
          <p className="text-xs leading-5 text-claude-dark-400">
            词库是硬规则；内容简报和语气偏好不能覆盖这里指定的名字、品牌和读法。
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-3">
            <div className="rounded-md border border-claude-cream-200 bg-claude-cream-50 p-4">
              <p className="text-sm font-semibold text-claude-dark-900">
                {message?.type === 'success' ? '已保存的长期资产' : '本次将保存为长期资产'}
              </p>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-claude-dark-500">
                {visibleAssetDetails.length > 0 ? (
                  visibleAssetDetails.map((detail) => <li key={detail}>{detail}</li>)
                ) : (
                  <li>暂无可保存的长期资产内容。</li>
                )}
              </ul>
            </div>

            {message ? (
              <output
                className={
                  message.type === 'success' ? 'text-sm text-emerald-600' : 'text-sm text-red-600'
                }
              >
                {message.text}
              </output>
            ) : (
              <p className="text-sm text-claude-dark-400">
                保存后会作为之后任务的默认资产；单次任务内仍可调整。
              </p>
            )}
          </div>
          <Button
            type="button"
            onClick={handleSave}
            disabled={loading || saving}
            className="bg-claude-orange-500 text-white hover:bg-claude-orange-600 sm:min-w-[140px]"
          >
            {saving ? '保存中...' : '保存创作者资产'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
