'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Button,
  Card,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui'
import { LEGACY_TTS_CONFIRMATION_HEADER } from '@/lib/ai/tts/legacy-policy'
import type { TTSProvider, TTSProviderStatus, TTSVoiceInfo } from '@/types/ai/tts'
import {
  EDGE_TTS_RATE_OPTIONS,
  RECOMMENDED_CHINESE_VOICES,
  SUPPORTED_LANGUAGES,
  TTS_CONFIG_KEYS,
  TTS_DEFAULTS,
} from '@/types/ai/tts'

/** TTS Provider 选项 */
const TTS_PROVIDER_OPTIONS = [
  {
    value: 'edge_tts',
    label: 'Microsoft Edge TTS（旧剪辑兼容）',
    description: '旧旁白后备',
  },
  {
    value: 'fish_audio',
    label: 'Fish Audio（历史兼容）',
    description: '旧项目音色',
  },
] as const

/** Fish Audio 验证状态 */
type VerifyStatus = 'idle' | 'saved_unverified' | 'verifying' | 'verified' | 'error'

interface TTSConfigProps {
  onConfigChange?: () => void
}

export function TTSConfig({ onConfigChange }: TTSConfigProps) {
  // 基础配置
  const [provider, setProvider] = useState<TTSProvider>(TTS_DEFAULTS.DEFAULT_PROVIDER)
  const [defaultLanguage, setDefaultLanguage] = useState<string>(TTS_DEFAULTS.DEFAULT_LANGUAGE)
  const [providerStatus, setProviderStatus] = useState<TTSProviderStatus[]>([])
  const [legacyTtsEnabled, setLegacyTtsEnabled] = useState(false)
  const [legacyTtsMessage, setLegacyTtsMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Edge TTS 配置
  const [edgeVoice, setEdgeVoice] = useState<string>(TTS_DEFAULTS.EDGE_TTS_DEFAULT_VOICE)
  const [edgeRate, setEdgeRate] = useState<string>(TTS_DEFAULTS.EDGE_TTS_RATE)
  const [voicesByLanguage, setVoicesByLanguage] = useState<Record<string, TTSVoiceInfo[]>>({})
  const [loadedLegacyVoiceLanguages, setLoadedLegacyVoiceLanguages] = useState<
    Record<string, boolean>
  >({})
  const [loadingVoices, setLoadingVoices] = useState(false)
  const [legacyTtsConfirmed, setLegacyTtsConfirmed] = useState(false)

  // Fish Audio 配置
  const [fishVoiceId, setFishVoiceId] = useState<string>('')
  const [fishVoiceName, setFishVoiceName] = useState<string>('')
  const [fishVerifyConfirmed, setFishVerifyConfirmed] = useState(false)
  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>('idle')
  const [verifyError, setVerifyError] = useState<string>('')

  // 音量配置
  const [dubVolume, setDubVolume] = useState<number>(TTS_DEFAULTS.DUBBED_VOLUME)
  const [bgmVolume, setBgmVolume] = useState<number>(TTS_DEFAULTS.BGM_VOLUME)

  // 按语言筛选的语音列表
  const filteredVoices = useMemo(() => {
    return voicesByLanguage[defaultLanguage] || []
  }, [voicesByLanguage, defaultLanguage])

  // 按性别分组
  const groupedVoices = useMemo(() => {
    const female = filteredVoices.filter((v) => v.gender === 'female')
    const male = filteredVoices.filter((v) => v.gender === 'male')
    const other = filteredVoices.filter((v) => v.gender !== 'female' && v.gender !== 'male')
    return { female, male, other }
  }, [filteredVoices])

  // ========== 数据加载 ==========

  const loadProviderStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/tts/status')
      if (response.ok) {
        const data = await response.json()
        setLegacyTtsEnabled(data.legacy_tts_enabled === true)
        setLegacyTtsMessage(data.message || '')
        setProviderStatus(data.providers || [])
      } else {
        setLegacyTtsEnabled(false)
        setLegacyTtsMessage('旧 TTS 兼容状态读取失败，已按默认关闭处理。')
      }
    } catch {
      setLegacyTtsEnabled(false)
      setLegacyTtsMessage('旧 TTS 兼容状态读取失败，已按默认关闭处理。')
    }
  }, [])

  const loadConfig = useCallback(async () => {
    try {
      const response = await fetch('/api/configs')
      const data = await response.json()

      if (data.configs) {
        // 加载 Provider
        setProvider(data.configs[TTS_CONFIG_KEYS.DEFAULT_PROVIDER] || TTS_DEFAULTS.DEFAULT_PROVIDER)

        // 加载默认语言
        setDefaultLanguage(
          data.configs[TTS_CONFIG_KEYS.DEFAULT_LANGUAGE] || TTS_DEFAULTS.DEFAULT_LANGUAGE,
        )

        // 加载 Edge TTS 配置
        setEdgeVoice(
          data.configs[TTS_CONFIG_KEYS.EDGE_TTS_DEFAULT_VOICE] ||
            TTS_DEFAULTS.EDGE_TTS_DEFAULT_VOICE,
        )
        setEdgeRate(data.configs[TTS_CONFIG_KEYS.EDGE_TTS_RATE] || TTS_DEFAULTS.EDGE_TTS_RATE)

        // 加载 Fish Audio 配置
        const savedFishVoiceId = data.configs[TTS_CONFIG_KEYS.FISH_AUDIO_VOICE_ID] || ''
        const savedFishVoiceName = data.configs[TTS_CONFIG_KEYS.FISH_AUDIO_VOICE_NAME] || ''
        setFishVoiceId(savedFishVoiceId)
        setFishVoiceName(savedFishVoiceName)

        // 已保存的 Fish Audio 兼容音色只代表有历史记录，不等于本次远端验证通过。
        if (savedFishVoiceId && savedFishVoiceName) {
          setVerifyStatus('saved_unverified')
        } else {
          setVerifyStatus('idle')
        }

        // 加载配音音量配置
        const savedDubVolume = parseFloat(data.configs[TTS_CONFIG_KEYS.DUBBED_VOLUME] || '')
        if (!Number.isNaN(savedDubVolume) && savedDubVolume >= 0 && savedDubVolume <= 2.0) {
          setDubVolume(savedDubVolume)
        }

        // 加载 BGM 音量配置
        const savedBgmVolume = parseFloat(data.configs[TTS_CONFIG_KEYS.BGM_VOLUME] || '')
        if (!Number.isNaN(savedBgmVolume) && savedBgmVolume >= 0 && savedBgmVolume <= 1.2) {
          setBgmVolume(savedBgmVolume)
        }
      }

      await loadProviderStatus()
    } catch {
      // 静默处理
    } finally {
      setLoading(false)
    }
  }, [loadProviderStatus])

  // 加载指定语言的语音列表
  const loadVoicesForLanguage = useCallback(
    async (languageCode: string) => {
      if (!legacyTtsConfirmed) {
        if (voicesByLanguage[languageCode]) return

        if (languageCode.startsWith('zh')) {
          setVoicesByLanguage((prev) => ({
            ...prev,
            [languageCode]: RECOMMENDED_CHINESE_VOICES.map((v) => ({
              id: v.id,
              name: v.name,
              language: languageCode,
              gender: v.gender,
              isDefault: v.id === TTS_DEFAULTS.EDGE_TTS_DEFAULT_VOICE,
            })),
          }))
        }
        return
      }

      if (loadedLegacyVoiceLanguages[languageCode]) return

      setLoadingVoices(true)
      try {
        const response = await fetch(`/api/tts/voices?language=${languageCode}&provider=edge_tts`, {
          headers: {
            [LEGACY_TTS_CONFIRMATION_HEADER]: 'true',
          },
        })
        if (response.ok) {
          const data = await response.json()
          setVoicesByLanguage((prev) => ({
            ...prev,
            [languageCode]: data.voices || [],
          }))
          setLoadedLegacyVoiceLanguages((prev) => ({ ...prev, [languageCode]: true }))
        }
      } catch {
        // 中文使用推荐列表作为后备
        if (languageCode.startsWith('zh')) {
          setVoicesByLanguage((prev) => ({
            ...prev,
            [languageCode]: RECOMMENDED_CHINESE_VOICES.map((v) => ({
              id: v.id,
              name: v.name,
              language: languageCode,
              gender: v.gender,
              isDefault: v.id === TTS_DEFAULTS.EDGE_TTS_DEFAULT_VOICE,
            })),
          }))
        }
      } finally {
        setLoadingVoices(false)
      }
    },
    [legacyTtsConfirmed, loadedLegacyVoiceLanguages, voicesByLanguage],
  )

  // 初始加载
  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  // 语言变化时加载对应语音（仅 Edge TTS）
  useEffect(() => {
    if (provider === 'edge_tts' && defaultLanguage) {
      loadVoicesForLanguage(defaultLanguage)
    }
  }, [provider, defaultLanguage, loadVoicesForLanguage])

  // 语言变化时重置 Edge TTS 语音选择
  useEffect(() => {
    // 当语言变化时，检查当前语音是否匹配新语言
    if (provider === 'edge_tts' && !edgeVoice.startsWith(defaultLanguage.split('-')[0])) {
      // 语言前缀不匹配，重置为空
      setEdgeVoice('')
    }
  }, [defaultLanguage, provider, edgeVoice])

  // ========== Fish Audio 验证 ==========

  const handleVerifyFishVoice = async () => {
    if (!fishVoiceId.trim()) {
      setVerifyError('请输入音色 ID')
      setVerifyStatus('error')
      return
    }

    if (!fishVerifyConfirmed) {
      setVerifyError('Fish Audio 旧兼容验证会访问外部服务；请先确认。')
      setVerifyStatus('error')
      return
    }

    setVerifyStatus('verifying')
    setVerifyError('')

    try {
      const response = await fetch('/api/tts/verify-voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voice_id: fishVoiceId.trim(),
          confirmLegacyFishAudio: true,
          confirmPaidVerification: true,
        }),
      })

      const data = await response.json()

      if (data.valid) {
        setFishVoiceName(data.voice_name)
        setVerifyStatus('verified')
        setVerifyError('')
        setFishVerifyConfirmed(false)
      } else {
        setVerifyStatus('error')
        setVerifyError(data.message || data.error || '验证失败')
        setFishVoiceName('')
      }
    } catch {
      setVerifyStatus('error')
      setVerifyError('网络错误，请重试')
      setFishVoiceName('')
    }
  }

  // Fish Voice ID 变化时重置验证状态
  const handleFishVoiceIdChange = (value: string) => {
    setFishVoiceId(value)
    setFishVerifyConfirmed(false)
    if (verifyStatus !== 'idle') {
      setVerifyStatus('idle')
      setVerifyError('')
      setFishVoiceName('')
    }
  }

  // ========== 保存配置 ==========

  const handleSave = async () => {
    if (provider === 'fish_audio') {
      if (!fishVoiceId.trim()) {
        toast.error('请输入 Fish Audio 兼容音色 ID')
        return
      }

      if (!fishVoiceName.trim() || verifyStatus === 'error') {
        toast.error('请先验证 Fish Audio 兼容音色 ID，或沿用已保存的兼容音色。')
        return
      }
    }

    setSaving(true)

    try {
      const configs: Record<string, string> = {
        [TTS_CONFIG_KEYS.DEFAULT_PROVIDER]: provider,
        [TTS_CONFIG_KEYS.DEFAULT_LANGUAGE]: defaultLanguage,
        [TTS_CONFIG_KEYS.EDGE_TTS_DEFAULT_VOICE]: edgeVoice,
        [TTS_CONFIG_KEYS.EDGE_TTS_RATE]: edgeRate,
        [TTS_CONFIG_KEYS.FISH_AUDIO_VOICE_ID]: fishVoiceId,
        [TTS_CONFIG_KEYS.FISH_AUDIO_VOICE_NAME]: fishVoiceName,
        [TTS_CONFIG_KEYS.DUBBED_VOLUME]: dubVolume.toString(),
        [TTS_CONFIG_KEYS.BGM_VOLUME]: bgmVolume.toString(),
      }

      const response = await fetch('/api/configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ configs }),
      })

      if (response.ok) {
        toast.success('兼容 TTS 配置保存成功')
        onConfigChange?.()
      } else {
        const error = await response.json()
        toast.error(error.error || '保存兼容 TTS 配置失败')
      }
    } catch {
      toast.error('保存兼容 TTS 配置失败')
    } finally {
      setSaving(false)
    }
  }

  // ========== UI 辅助 ==========

  const getProviderStatusBadge = (providerType: TTSProvider) => {
    const status = providerStatus.find((s) => s.provider === providerType)
    if (!status) return null

    if (status.available) {
      return (
        <span className="ml-2 text-xs text-green-600">
          ● {providerType === 'fish_audio' ? '兼容配置存在' : '内置可用'}
        </span>
      )
    }
    if (status.requiresConfig && !status.configured) {
      return <span className="ml-2 text-xs text-yellow-600">● 需配置</span>
    }
    return <span className="ml-2 text-xs text-red-600">● 不可用</span>
  }

  if (loading) {
    return (
      <Card className="border-claude-dark-300/20 bg-white/60 p-6">
        <p className="text-sm text-claude-dark-400">加载中...</p>
      </Card>
    )
  }

  if (!legacyTtsEnabled) {
    return (
      <Card className="border-claude-dark-300/20 bg-white/60 p-6">
        <h3 className="mb-2 text-lg font-semibold text-claude-dark-900">旧 TTS 兼容已关闭</h3>
        <p className="max-w-2xl text-xs leading-5 text-claude-dark-400">
          {legacyTtsMessage ||
            '旧 TTS 兼容接口默认关闭；当前翻译配音主线请使用 MiniMax 配音和已登记用途/授权记录的 voice_id。'}
        </p>
      </Card>
    )
  }

  return (
    <Card className="border-claude-dark-300/20 bg-white/60 p-6">
      <h3 className="mb-2 text-lg font-semibold text-claude-dark-900">旧剪辑 TTS 配置（兼容）</h3>
      <p className="mb-4 max-w-2xl text-xs text-claude-dark-400">
        这里仅保留旧剪辑旁白和历史项目兼容配置；当前翻译配音主线请使用下方 MiniMax 配音，
        并填写本人、自有或已有本地授权记录的 voice_id。
      </p>

      <div className="space-y-5">
        {/* TTS Provider 选择 */}
        <div className="space-y-2">
          <Label className="text-sm font-medium text-claude-dark-900">兼容 TTS 引擎</Label>
          <Select value={provider} onValueChange={(value) => setProvider(value as TTSProvider)}>
            <SelectTrigger className="w-full max-w-md border-claude-dark-300/30 focus:border-claude-orange-500 focus:ring-claude-orange-500/20">
              <SelectValue placeholder="选择 TTS Provider" />
            </SelectTrigger>
            <SelectContent>
              {TTS_PROVIDER_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <span className="flex items-center gap-2">
                    <span>{option.label}</span>
                    {getProviderStatusBadge(option.value)}
                    <span className="text-xs text-claude-dark-400">- {option.description}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-claude-dark-400">
            仅影响旧剪辑/旁白链路；正式翻译配音请在 MiniMax 配音中保存 API Key 和授权 voice_id。
          </p>
        </div>

        {/* 默认语言选择 */}
        <div className="space-y-2">
          <Label className="text-sm font-medium text-claude-dark-900">默认语言</Label>
          <Select value={defaultLanguage} onValueChange={setDefaultLanguage}>
            <SelectTrigger className="w-full max-w-md border-claude-dark-300/30 focus:border-claude-orange-500 focus:ring-claude-orange-500/20">
              <SelectValue placeholder="选择语言" />
            </SelectTrigger>
            <SelectContent>
              {SUPPORTED_LANGUAGES.map((lang) => (
                <SelectItem key={lang.code} value={lang.code}>
                  {lang.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-claude-dark-400">
            影响旧剪辑旁白的目标语言，以及 Edge TTS 语音选择。
          </p>
        </div>

        {/* Edge TTS 语音选择 */}
        {provider === 'edge_tts' && (
          <div className="space-y-2">
            <Label className="text-sm font-medium text-claude-dark-900">Edge TTS 语音</Label>
            <label className="flex max-w-md items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-xs leading-5 text-amber-800">
              <input
                type="checkbox"
                checked={legacyTtsConfirmed}
                onChange={(event) => setLegacyTtsConfirmed(event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
              />
              <span>我确认加载旧 Edge TTS 语音列表可能访问外部服务。</span>
            </label>
            <Select value={edgeVoice} onValueChange={setEdgeVoice}>
              <SelectTrigger className="w-full max-w-md border-claude-dark-300/30 focus:border-claude-orange-500 focus:ring-claude-orange-500/20">
                <SelectValue placeholder={loadingVoices ? '加载中...' : '选择语音'} />
              </SelectTrigger>
              <SelectContent>
                {loadingVoices ? (
                  <div className="px-2 py-3 text-sm text-claude-dark-400 text-center">
                    加载中...
                  </div>
                ) : filteredVoices.length === 0 ? (
                  <div className="px-2 py-3 text-sm text-claude-dark-400 text-center">暂无语音</div>
                ) : (
                  <>
                    {groupedVoices.female.length > 0 && (
                      <>
                        <div className="px-2 py-1.5 text-xs font-medium text-claude-dark-500">
                          女声
                        </div>
                        {groupedVoices.female.map((voice) => (
                          <SelectItem key={voice.id} value={voice.id}>
                            {voice.name}
                          </SelectItem>
                        ))}
                      </>
                    )}
                    {groupedVoices.male.length > 0 && (
                      <>
                        <div className="px-2 py-1.5 text-xs font-medium text-claude-dark-500 border-t mt-1">
                          男声
                        </div>
                        {groupedVoices.male.map((voice) => (
                          <SelectItem key={voice.id} value={voice.id}>
                            {voice.name}
                          </SelectItem>
                        ))}
                      </>
                    )}
                    {groupedVoices.other.length > 0 && (
                      <>
                        <div className="px-2 py-1.5 text-xs font-medium text-claude-dark-500 border-t mt-1">
                          其他
                        </div>
                        {groupedVoices.other.map((voice) => (
                          <SelectItem key={voice.id} value={voice.id}>
                            {voice.name}
                          </SelectItem>
                        ))}
                      </>
                    )}
                  </>
                )}
              </SelectContent>
            </Select>
            <p className="text-xs text-claude-dark-400">推荐：晓晓（女声）、云希（男声）</p>
          </div>
        )}

        {/* Edge TTS 语速选择 */}
        {provider === 'edge_tts' && (
          <div className="space-y-2">
            <Label className="text-sm font-medium text-claude-dark-900">语速调节</Label>
            <Select value={edgeRate} onValueChange={setEdgeRate}>
              <SelectTrigger className="w-full max-w-md border-claude-dark-300/30 focus:border-claude-orange-500 focus:ring-claude-orange-500/20">
                <SelectValue placeholder="选择语速" />
              </SelectTrigger>
              <SelectContent>
                {EDGE_TTS_RATE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-claude-dark-400">
              调整语音合成速度，范围 -50% 到 +100%，正常为 0%。
            </p>
          </div>
        )}

        {/* Fish Audio 音色配置 */}
        {provider === 'fish_audio' && (
          <div className="space-y-2">
            <Label className="text-sm font-medium text-claude-dark-900">
              Fish Audio 兼容音色 ID
            </Label>
            <div className="flex gap-2 max-w-md">
              <Input
                value={fishVoiceId}
                onChange={(e) => handleFishVoiceIdChange(e.target.value)}
                placeholder="输入旧项目 Fish Audio 音色 ID"
                className="flex-1 border-claude-dark-300/30 focus:border-claude-orange-500 focus:ring-claude-orange-500/20"
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleVerifyFishVoice}
                disabled={
                  verifyStatus === 'verifying' || !fishVoiceId.trim() || !fishVerifyConfirmed
                }
                className="border-claude-dark-300/30 hover:bg-claude-dark-50"
              >
                {verifyStatus === 'verifying' ? '验证中...' : '验证'}
              </Button>
            </div>
            <label className="flex max-w-md items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-xs leading-5 text-amber-800">
              <input
                type="checkbox"
                checked={fishVerifyConfirmed}
                onChange={(event) => setFishVerifyConfirmed(event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
              />
              <span>
                我确认验证 Fish Audio 旧兼容音色会访问外部
                provider，可能产生费用；服务端还必须显式设置 ALLOW_PAID_DYNAMIC_TESTS=true。
              </span>
            </label>

            {/* 验证状态 */}
            {verifyStatus === 'verified' && fishVoiceName && (
              <p className="text-xs text-green-600 flex items-center gap-1">
                <span>●</span> 远端验证通过：{fishVoiceName}
              </p>
            )}
            {verifyStatus === 'saved_unverified' && fishVoiceName && (
              <p className="text-xs text-amber-700 flex items-center gap-1">
                <span>●</span> 已保存兼容音色：{fishVoiceName}；未执行本次远端验证。
              </p>
            )}
            {verifyStatus === 'error' && verifyError && (
              <p className="text-xs text-red-600 flex items-center gap-1">
                <span>●</span> {verifyError}
              </p>
            )}
            {verifyStatus === 'idle' && (
              <p className="text-xs text-claude-dark-400">
                旧剪辑兼容任务会使用此音色 ID；当前主线请使用 MiniMax voice_id。
              </p>
            )}
          </div>
        )}

        {/* Provider 状态显示 */}
        {providerStatus.length > 0 && (
          <div className="mt-4 p-3 bg-claude-dark-50/50 rounded-lg">
            <p className="text-xs font-medium text-claude-dark-700 mb-2">兼容引擎状态</p>
            <div className="space-y-1">
              {providerStatus.map((status) => (
                <div key={status.provider} className="flex items-center gap-2 text-xs">
                  <span
                    className={`w-2 h-2 rounded-full ${status.available ? 'bg-green-500' : status.requiresConfig && !status.configured ? 'bg-yellow-500' : 'bg-red-500'}`}
                  />
                  <span className="text-claude-dark-600">
                    {status.provider === 'edge_tts' ? 'Edge TTS' : 'Fish Audio（兼容）'}:
                  </span>
                  <span className="text-claude-dark-500">
                    {status.available
                      ? status.provider === 'fish_audio'
                        ? '兼容配置存在，不代表本次验证通过'
                        : '内置可用'
                      : status.requiresConfig && !status.configured
                        ? '需要补齐对应兼容配置'
                        : '不可用'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 音量设置 */}
        <div className="mt-6 pt-6 border-t border-claude-dark-200/50">
          <h4 className="text-base font-medium text-claude-dark-900 mb-4">音量设置</h4>

          {/* 配音音量 */}
          <div className="space-y-2 mb-4">
            <Label className="text-sm font-medium text-claude-dark-900">配音音量</Label>
            <div className="flex items-center gap-4 max-w-md">
              <input
                type="range"
                min="0"
                max="200"
                value={Math.round(dubVolume * 100)}
                onChange={(e) => setDubVolume(parseInt(e.target.value, 10) / 100)}
                className="flex-1 h-2 bg-claude-dark-200 rounded-lg appearance-none cursor-pointer accent-claude-orange-500"
              />
              <span className="text-sm font-medium text-claude-dark-700 w-12 text-right">
                {Math.round(dubVolume * 100)}%
              </span>
            </div>
            <p className="text-xs text-claude-dark-400">
              设为 0% 可静音配音，只保留画面；200% 为最大增益。
            </p>
          </div>

          {/* 配乐音量 */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-claude-dark-900">配乐音量</Label>
            <div className="flex items-center gap-4 max-w-md">
              <input
                type="range"
                min="0"
                max="120"
                value={Math.round(bgmVolume * 100)}
                onChange={(e) => setBgmVolume(parseInt(e.target.value, 10) / 100)}
                className="flex-1 h-2 bg-claude-dark-200 rounded-lg appearance-none cursor-pointer accent-claude-orange-500"
              />
              <span className="text-sm font-medium text-claude-dark-700 w-12 text-right">
                {Math.round(bgmVolume * 100)}%
              </span>
            </div>
            <p className="text-xs text-claude-dark-400">
              建议 10-25%（背景音）；超过 100% 时配乐将盖过配音。
            </p>
          </div>
        </div>
      </div>

      {/* 保存按钮 */}
      <div className="mt-6 flex justify-end">
        <Button
          onClick={handleSave}
          disabled={saving}
          className="bg-claude-orange-500 hover:bg-claude-orange-600 text-white px-6"
        >
          {saving ? '保存中...' : '保存兼容 TTS 配置'}
        </Button>
      </div>
    </Card>
  )
}
