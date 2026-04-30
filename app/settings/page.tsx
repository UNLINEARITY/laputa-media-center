'use client'

import { useEffect, useState } from 'react'
import { PageHeader } from '@/components/layout/page-header'
import { ApiTokenManager } from '@/components/settings/api-token-manager'
import { CreatorAssetsConfig } from '@/components/settings/creator-assets-config'
import { FishAudioConfig } from '@/components/settings/fish-audio-config'
import { GCSConfig } from '@/components/settings/gcs-config'
import { GeminiAIStudioConfig } from '@/components/settings/gemini-ai-studio-config'
import { GeminiVertexConfig } from '@/components/settings/gemini-vertex-config'
import { MiniMaxConfig } from '@/components/settings/minimax-config'
import { StatusBadge, StatusChip } from '@/components/settings/status-badge'
import { StorageCleanup } from '@/components/settings/storage-cleanup'
import { SystemConfig } from '@/components/settings/system-config'
import { TTSConfig } from '@/components/settings/tts-config'
import type { ApiKeyStatus, ServiceMessage } from '@/components/settings/types'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui'
import { CONFIG_DEFAULTS } from '@/lib/config'
import type {
  ApiKeyService,
  GeminiAIStudioCredentials,
  GeminiVertexCredentials,
  GoogleStorageCredentials,
} from '@/types'

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('system')
  const [statuses, setStatuses] = useState<ApiKeyStatus[]>([])
  const [savingService, setSavingService] = useState<string | null>(null)
  const [legacyTtsEnabled, setLegacyTtsEnabled] = useState(false)
  const [legacyTtsMessage, setLegacyTtsMessage] = useState('')
  const [messages, setMessages] = useState<Record<ApiKeyService, ServiceMessage | null>>({
    google_vertex: null,
    google_ai_studio: null,
    fish_audio_vertex: null,
    fish_audio_ai_studio: null,
    minimax_tts: null,
    google_storage: null,
  })

  // 系统设置状态
  const [systemConfigStatus, setSystemConfigStatus] = useState({
    gemini_model_configured: false,
    api_tokens_configured: false,
    concurrency_configured: false,
  })

  // Gemini Vertex AI
  const [geminiVertex, setGeminiVertex] = useState<GeminiVertexCredentials>({
    project_id: '',
    model_id: CONFIG_DEFAULTS.DEFAULT_GEMINI_MODEL,
    location: CONFIG_DEFAULTS.DEFAULT_GEMINI_LOCATION,
    service_account_json: '',
  })

  // Gemini AI Studio
  const [geminiAIStudio, setGeminiAIStudio] = useState<GeminiAIStudioCredentials>({
    api_key: '',
    model_id: CONFIG_DEFAULTS.DEFAULT_GEMINI_MODEL,
    api_base_url: '',
  })

  // Fish Audio Vertex AI
  const [fishAudioVertexKey, setFishAudioVertexKey] = useState('')
  const [
    fishAudioVertexLegacyVerificationConfirmed,
    setFishAudioVertexLegacyVerificationConfirmed,
  ] = useState(false)

  // Fish Audio AI Studio
  const [fishAudioAIStudioKey, setFishAudioAIStudioKey] = useState('')
  const [
    fishAudioAIStudioLegacyVerificationConfirmed,
    setFishAudioAIStudioLegacyVerificationConfirmed,
  ] = useState(false)

  // MiniMax TTS
  const [miniMaxKey, setMiniMaxKey] = useState('')
  const [miniMaxVoiceId, setMiniMaxVoiceId] = useState('')
  const [miniMaxPaidVerificationConfirmed, setMiniMaxPaidVerificationConfirmed] = useState(false)
  const [miniMaxSavingOperation, setMiniMaxSavingOperation] = useState<
    'save_only' | 'verify_and_save' | null
  >(null)

  // Google Storage
  const [googleStorage, setGoogleStorage] = useState<GoogleStorageCredentials>({
    service_account_json: '',
    bucket_name: '',
  })

  const updateMessage = (
    service: ApiKeyService | 'system_config',
    value: ServiceMessage | null,
  ) => {
    setMessages((prev) => ({ ...prev, [service]: value }))
  }

  const _normalizeVertexCredentials = (
    data: Partial<GeminiVertexCredentials>,
  ): GeminiVertexCredentials => ({
    project_id: data.project_id || '',
    model_id: (data.model_id || CONFIG_DEFAULTS.DEFAULT_GEMINI_MODEL).replace(/^models\//, ''),
    location: data.location || CONFIG_DEFAULTS.DEFAULT_GEMINI_LOCATION,
    service_account_json: data.service_account_json || '',
  })

  const _normalizeAIStudioCredentials = (
    data: Partial<GeminiAIStudioCredentials>,
  ): GeminiAIStudioCredentials => ({
    api_key: data.api_key || '',
    model_id: (data.model_id || CONFIG_DEFAULTS.DEFAULT_GEMINI_MODEL).replace(/^models\//, ''),
    api_base_url: data.api_base_url || '',
  })

  const fetchStatuses = async () => {
    try {
      const response = await fetch('/api/api-keys')
      // 401/其他错误静默处理（未登录或测试环境）
      if (!response.ok) {
        setStatuses([])
        return
      }
      const data = await response.json()
      setStatuses(data.keys || [])
    } catch {
      // 静默处理
      setStatuses([])
    }
  }

  const fetchLegacyTtsStatus = async () => {
    try {
      const response = await fetch('/api/tts/status')
      if (!response.ok) {
        setLegacyTtsEnabled(false)
        setLegacyTtsMessage('旧语音兼容状态读取失败，已按默认关闭处理。')
        return
      }

      const data = await response.json()
      setLegacyTtsEnabled(data.legacy_tts_enabled === true)
      setLegacyTtsMessage(data.message || '')
    } catch {
      setLegacyTtsEnabled(false)
      setLegacyTtsMessage('旧语音兼容状态读取失败，已按默认关闭处理。')
    }
  }

  const loadSavedCredentials = async () => {
    // 安全修复：不再从 API 获取凭证填充表单
    // 凭证现在只返回脱敏预览，用于显示配置状态
    // 用户如需修改凭证，需要重新输入完整值
    // 这符合安全最佳实践：敏感凭证不应在前端展示或传输
  }

  const loadSystemConfigStatus = async () => {
    try {
      // 检查 Gemini 模型配置
      const configsRes = await fetch('/api/configs')
      const configsData = await configsRes.json()
      const configs = configsData.configs || {}

      const geminiModel = configs.default_gemini_model || ''
      const concurrency = configs.max_concurrent_scenes || ''

      // 检查 API Token（容错处理：表可能不存在）
      let hasTokens = false
      try {
        const tokensRes = await fetch('/api/auth/tokens')
        if (tokensRes.ok) {
          const tokensData = await tokensRes.json()
          hasTokens = (tokensData.tokens || []).length > 0
        }
      } catch {
        // API Token 检查失败，默认为未配置
      }

      setSystemConfigStatus({
        gemini_model_configured: geminiModel.trim() !== '',
        api_tokens_configured: hasTokens,
        concurrency_configured: concurrency.trim() !== '',
      })
    } catch {
      // 静默处理
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: 初始化加载，只需执行一次
  useEffect(() => {
    if (window.location.hash === '#creator_assets') {
      setActiveTab('creator-assets')
    }
    fetchStatuses()
    fetchLegacyTtsStatus()
    loadSavedCredentials()
    loadSystemConfigStatus()
  }, [])

  const stripModelPrefix = (value: string) => value.replace(/^models\//, '')

  const handleSaveGeminiVertex = async () => {
    const trimmedProjectId = geminiVertex.project_id.trim()
    const trimmedModelId = stripModelPrefix(
      geminiVertex.model_id.trim() || CONFIG_DEFAULTS.DEFAULT_GEMINI_MODEL,
    )
    const normalizedLocation =
      (geminiVertex.location || '').trim() || CONFIG_DEFAULTS.DEFAULT_GEMINI_LOCATION
    const serviceAccount = geminiVertex.service_account_json.trim()

    if (!trimmedProjectId || !trimmedModelId || !serviceAccount) {
      updateMessage('google_vertex', {
        type: 'error',
        text: '请填写 Project ID、Model ID 与 Service Account JSON。',
      })
      return
    }

    try {
      JSON.parse(serviceAccount)
    } catch {
      updateMessage('google_vertex', { type: 'error', text: 'Service Account JSON 格式不正确。' })
      return
    }

    const payload: GeminiVertexCredentials = {
      project_id: trimmedProjectId,
      model_id: trimmedModelId,
      location: normalizedLocation,
      service_account_json: serviceAccount,
    }

    setGeminiVertex(payload)
    updateMessage('google_vertex', null)
    setSavingService('google_vertex')

    try {
      const response = await fetch('/api/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service: 'google_vertex',
          operation: 'save_only',
          credentials: payload,
        }),
      })

      const result = await response.json()

      if (response.ok) {
        updateMessage('google_vertex', {
          type: 'success',
          text: 'Google Vertex AI 凭据已保存，尚未执行真实 provider 验证。',
        })
        await fetchStatuses()
      } else {
        updateMessage('google_vertex', {
          type: 'error',
          text: result.message || result.error || '保存失败，请稍后再试。',
        })
      }
    } catch (error: unknown) {
      updateMessage('google_vertex', {
        type: 'error',
        text: `保存失败：${error instanceof Error ? error.message : '未知错误'}`,
      })
    } finally {
      setSavingService(null)
    }
  }

  const handleSaveGeminiAIStudio = async () => {
    const trimmedApiKey = geminiAIStudio.api_key.trim()
    const trimmedModelId = stripModelPrefix(
      geminiAIStudio.model_id.trim() || CONFIG_DEFAULTS.DEFAULT_GEMINI_MODEL,
    )
    const trimmedApiBaseUrl = geminiAIStudio.api_base_url?.trim() || ''

    if (!trimmedApiKey || !trimmedModelId) {
      updateMessage('google_ai_studio', { type: 'error', text: '请填写 API Key 和 Model ID。' })
      return
    }

    const payload: GeminiAIStudioCredentials = {
      api_key: trimmedApiKey,
      model_id: trimmedModelId,
      api_base_url: trimmedApiBaseUrl,
    }

    setGeminiAIStudio(payload)
    updateMessage('google_ai_studio', null)
    setSavingService('google_ai_studio')

    try {
      const response = await fetch('/api/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service: 'google_ai_studio',
          operation: 'save_only',
          credentials: payload,
        }),
      })

      const result = await response.json()

      if (response.ok) {
        updateMessage('google_ai_studio', {
          type: 'success',
          text: 'Google AI Studio 凭据已保存，尚未执行真实 provider 验证。',
        })
        await fetchStatuses()
      } else {
        updateMessage('google_ai_studio', {
          type: 'error',
          text: result.message || result.error || '保存失败，请稍后再试。',
        })
      }
    } catch (error: unknown) {
      updateMessage('google_ai_studio', {
        type: 'error',
        text: `保存失败：${error instanceof Error ? error.message : '未知错误'}`,
      })
    } finally {
      setSavingService(null)
    }
  }

  // Fish Audio 保存处理（只需 API Key）
  const createFishAudioSaveHandler =
    (serviceName: 'fish_audio_vertex' | 'fish_audio_ai_studio', apiKey: string) => async () => {
      const trimmedKey = apiKey.trim()
      const legacyVerificationConfirmed =
        serviceName === 'fish_audio_vertex'
          ? fishAudioVertexLegacyVerificationConfirmed
          : fishAudioAIStudioLegacyVerificationConfirmed

      if (!trimmedKey) {
        updateMessage(serviceName, { type: 'error', text: '请输入 API Key' })
        return
      }

      if (!legacyTtsEnabled) {
        updateMessage(serviceName, {
          type: 'error',
          text: legacyTtsMessage || '旧语音兼容默认关闭；请先在服务端显式启用后再维护历史凭证。',
        })
        return
      }

      if (!legacyVerificationConfirmed) {
        updateMessage(serviceName, {
          type: 'error',
          text: 'Fish Audio 旧兼容验证会调用一次测试 TTS；请先确认可能产生费用。',
        })
        return
      }

      updateMessage(serviceName, null)
      setSavingService(serviceName)

      try {
        const response = await fetch('/api/api-keys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            service: serviceName,
            credentials: { api_key: trimmedKey },
            confirmLegacyTts: true,
            confirmLegacyFishAudio: true,
            confirmPaidVerification: true,
          }),
        })

        const result = await response.json()

        if (response.ok) {
          const verificationMessage = result.verification?.message as string | undefined
          updateMessage(serviceName, {
            type: 'success',
            text: verificationMessage || 'Fish Audio 旧兼容 API Key 保存成功并已验证',
          })
          if (serviceName === 'fish_audio_vertex') {
            setFishAudioVertexLegacyVerificationConfirmed(false)
          } else {
            setFishAudioAIStudioLegacyVerificationConfirmed(false)
          }
          await fetchStatuses()
        } else {
          updateMessage(serviceName, {
            type: 'error',
            text: result.message || result.verification?.message || result.error || '验证失败',
          })
        }
      } catch (error: unknown) {
        updateMessage(serviceName, {
          type: 'error',
          text: `保存失败：${error instanceof Error ? error.message : '未知错误'}`,
        })
      } finally {
        setSavingService(null)
      }
    }

  // Google Storage 保存处理
  const createGCSSaveHandler =
    (credentials: GoogleStorageCredentials, requiredFields: string[], successMessage: string) =>
    async () => {
      const missingFields = requiredFields.filter(
        (field) => !credentials[field as keyof typeof credentials],
      )
      if (missingFields.length > 0) {
        updateMessage('google_storage', { type: 'error', text: '请填写完整的配置信息。' })
        return
      }

      try {
        JSON.parse(credentials.service_account_json)
      } catch {
        updateMessage('google_storage', {
          type: 'error',
          text: 'Service Account JSON 格式不正确。',
        })
        return
      }

      updateMessage('google_storage', null)
      setSavingService('google_storage')

      try {
        const response = await fetch('/api/api-keys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            service: 'google_storage',
            operation: 'save_only',
            credentials,
          }),
        })

        const result = await response.json()

        if (response.ok) {
          updateMessage('google_storage', {
            type: 'success',
            text: `${successMessage}已保存，尚未执行真实 GCS 上传/删除验证。`,
          })
          await fetchStatuses()
        } else {
          updateMessage('google_storage', {
            type: 'error',
            text:
              result.message ||
              result.verification?.message ||
              result.error ||
              '保存失败，请稍后再试。',
          })
        }
      } catch (error: unknown) {
        updateMessage('google_storage', {
          type: 'error',
          text: `保存失败：${error instanceof Error ? error.message : '未知错误'}`,
        })
      } finally {
        setSavingService(null)
      }
    }

  const handleSaveMiniMax = async (operation: 'save_only' | 'verify_and_save') => {
    const trimmedKey = miniMaxKey.trim()
    const trimmedVoiceId = miniMaxVoiceId.trim()

    if (!trimmedKey) {
      updateMessage('minimax_tts', { type: 'error', text: '请输入 MiniMax API Key' })
      return
    }

    if (operation === 'verify_and_save' && !miniMaxPaidVerificationConfirmed) {
      updateMessage('minimax_tts', {
        type: 'error',
        text: 'MiniMax 验证会调用一次测试 TTS；请先确认可能产生费用。',
      })
      return
    }

    updateMessage('minimax_tts', null)
    setSavingService('minimax_tts')
    setMiniMaxSavingOperation(operation)

    try {
      const response = await fetch('/api/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service: 'minimax_tts',
          operation,
          credentials: {
            api_key: trimmedKey,
            verification_voice_id: trimmedVoiceId,
            voice_id: trimmedVoiceId,
          },
          confirmPaidVerification:
            operation === 'verify_and_save' ? miniMaxPaidVerificationConfirmed : undefined,
        }),
      })

      const result = await response.json()

      if (response.ok) {
        const verificationMessage = result.verification?.message as string | undefined
        updateMessage('minimax_tts', {
          type: 'success',
          text:
            result.message ||
            verificationMessage ||
            (operation === 'save_only' ? 'MiniMax 配置已保存。' : 'MiniMax 付费验证通过。'),
        })
        setMiniMaxPaidVerificationConfirmed(false)
        await fetchStatuses()
      } else {
        updateMessage('minimax_tts', {
          type: 'error',
          text: result.message || result.verification?.message || result.error || '验证失败',
        })
      }
    } catch (error: unknown) {
      updateMessage('minimax_tts', {
        type: 'error',
        text: `保存失败：${error instanceof Error ? error.message : '未知错误'}`,
      })
    } finally {
      setSavingService(null)
      setMiniMaxSavingOperation(null)
    }
  }

  const handleSystemConfigSave = async () => {
    // 重新加载系统配置状态
    await loadSystemConfigStatus()
    await fetchLegacyTtsStatus()
  }

  return (
    <div className="flex flex-col bg-linear-to-br from-claude-cream-50/30 via-white to-claude-cream-100/50 min-h-screen">
      <PageHeader
        title="密钥与服务设置"
        description="配置 Gemini 翻译、MiniMax 配音、存储和历史兼容服务。正式本地化需要 Gemini 翻译凭证、MiniMax 与已确认用途和披露要求的 voice_id。"
      />

      <section className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="mb-6 grid h-auto w-full grid-cols-2 md:grid-cols-5">
            <TabsTrigger
              value="creator-assets"
              className="text-base data-[state=active]:bg-claude-orange-500 data-[state=active]:text-white"
            >
              创作者资产
            </TabsTrigger>
            <TabsTrigger
              value="system"
              className="text-base data-[state=active]:bg-claude-orange-500 data-[state=active]:text-white"
            >
              系统设置
            </TabsTrigger>
            <TabsTrigger
              value="ai-studio"
              className="text-base data-[state=active]:bg-claude-orange-500 data-[state=active]:text-white"
            >
              Google AI Studio 配置
            </TabsTrigger>
            <TabsTrigger
              value="vertex"
              className="text-base data-[state=active]:bg-claude-orange-500 data-[state=active]:text-white"
            >
              Google Vertex 配置
            </TabsTrigger>
            <TabsTrigger
              value="maintenance"
              className="text-base data-[state=active]:bg-claude-orange-500 data-[state=active]:text-white"
            >
              维护兼容
            </TabsTrigger>
          </TabsList>

          <TabsContent value="creator-assets" className="space-y-6">
            <CreatorAssetsConfig />
          </TabsContent>

          {/* ========== 系统设置标签页 ========== */}
          <TabsContent value="system" className="space-y-6">
            <div className="mb-6">
              <h3 className="mb-3 text-sm font-semibold text-claude-dark-400">系统配置状态</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="flex items-center justify-between rounded-lg border border-claude-dark-300/20 bg-white px-4 py-3">
                  <span className="text-sm font-medium text-claude-dark-700">Gemini 模型配置</span>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      systemConfigStatus.gemini_model_configured
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {systemConfigStatus.gemini_model_configured ? '已配置' : '未配置'}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-claude-dark-300/20 bg-white px-4 py-3">
                  <span className="text-sm font-medium text-claude-dark-700">API Token 管理</span>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      systemConfigStatus.api_tokens_configured
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {systemConfigStatus.api_tokens_configured ? '已配置' : '未配置'}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-claude-dark-300/20 bg-white px-4 py-3">
                  <span className="text-sm font-medium text-claude-dark-700">并发设置</span>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      systemConfigStatus.concurrency_configured
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {systemConfigStatus.concurrency_configured ? '已配置' : '未配置'}
                  </span>
                </div>
              </div>
            </div>

            <div className="mb-6">
              <h3 className="mb-3 text-sm font-semibold text-claude-dark-400">配音服务状态</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <StatusChip
                  label="minimax_tts"
                  badge={<StatusBadge service="minimax_tts" statuses={statuses} />}
                />
              </div>
            </div>

            <SystemConfig onConfigChange={handleSystemConfigSave} />
            <div id="minimax_tts" className="scroll-mt-24">
              <MiniMaxConfig
                apiKey={miniMaxKey}
                setApiKey={setMiniMaxKey}
                voiceId={miniMaxVoiceId}
                setVoiceId={setMiniMaxVoiceId}
                confirmPaidVerification={miniMaxPaidVerificationConfirmed}
                setConfirmPaidVerification={setMiniMaxPaidVerificationConfirmed}
                onSaveOnly={() => handleSaveMiniMax('save_only')}
                onVerifyAndSave={() => handleSaveMiniMax('verify_and_save')}
                message={messages.minimax_tts}
                isSavingConfig={
                  savingService === 'minimax_tts' && miniMaxSavingOperation === 'save_only'
                }
                isVerifying={
                  savingService === 'minimax_tts' && miniMaxSavingOperation === 'verify_and_save'
                }
              />
            </div>
            <ApiTokenManager onTokenChange={loadSystemConfigStatus} />
          </TabsContent>

          {/* ========== Vertex AI 配置标签页 ========== */}
          <TabsContent value="vertex" className="space-y-6">
            <div className="mb-6">
              <h3 className="mb-3 text-sm font-semibold text-claude-dark-400">服务配置状态</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <StatusChip
                  label="google_vertex"
                  badge={<StatusBadge service="google_vertex" statuses={statuses} />}
                />
                <StatusChip
                  label="google_storage"
                  badge={<StatusBadge service="google_storage" statuses={statuses} />}
                />
                {legacyTtsEnabled && (
                  <StatusChip
                    label="fish_audio_vertex"
                    badge={<StatusBadge service="fish_audio_vertex" statuses={statuses} />}
                  />
                )}
              </div>
              {legacyTtsEnabled ? (
                <p className="mt-2 text-xs text-claude-dark-400">
                  Fish Audio 仅用于历史项目兼容；翻译配音主线请在系统设置中配置 MiniMax。
                </p>
              ) : (
                <p className="mt-2 text-xs text-claude-dark-400">
                  旧语音兼容默认关闭；当前翻译配音主线请在系统设置中配置 MiniMax。
                </p>
              )}
            </div>

            <GeminiVertexConfig
              credentials={geminiVertex}
              setCredentials={setGeminiVertex}
              onSave={handleSaveGeminiVertex}
              message={messages.google_vertex}
              isSaving={savingService === 'google_vertex'}
            />

            <GCSConfig
              credentials={googleStorage}
              setCredentials={setGoogleStorage}
              onSave={createGCSSaveHandler(
                googleStorage,
                ['service_account_json', 'bucket_name'],
                'Google Storage 配置',
              )}
              message={messages.google_storage}
              isSaving={savingService === 'google_storage'}
            />

            {legacyTtsEnabled && (
              <FishAudioConfig
                apiKey={fishAudioVertexKey}
                setApiKey={setFishAudioVertexKey}
                confirmLegacyVerification={fishAudioVertexLegacyVerificationConfirmed}
                setConfirmLegacyVerification={setFishAudioVertexLegacyVerificationConfirmed}
                onSave={createFishAudioSaveHandler('fish_audio_vertex', fishAudioVertexKey)}
                message={messages.fish_audio_vertex}
                isSaving={savingService === 'fish_audio_vertex'}
                platform="vertex"
              />
            )}
          </TabsContent>

          {/* ========== AI Studio 配置标签页 ========== */}
          <TabsContent value="ai-studio" className="space-y-6">
            <div className="mb-6">
              <h3 className="mb-3 text-sm font-semibold text-claude-dark-400">服务配置状态</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <StatusChip
                  label="google_ai_studio"
                  badge={<StatusBadge service="google_ai_studio" statuses={statuses} />}
                />
                {legacyTtsEnabled && (
                  <StatusChip
                    label="fish_audio_ai_studio"
                    badge={<StatusBadge service="fish_audio_ai_studio" statuses={statuses} />}
                  />
                )}
              </div>
              {legacyTtsEnabled ? (
                <p className="mt-2 text-xs text-claude-dark-400">
                  Fish Audio 仅用于历史项目兼容；翻译配音主线请在系统设置中配置 MiniMax。
                </p>
              ) : (
                <p className="mt-2 text-xs text-claude-dark-400">
                  旧语音兼容默认关闭；当前翻译配音主线请在系统设置中配置 MiniMax。
                </p>
              )}
            </div>

            <GeminiAIStudioConfig
              credentials={geminiAIStudio}
              setCredentials={setGeminiAIStudio}
              onSave={handleSaveGeminiAIStudio}
              message={messages.google_ai_studio}
              isSaving={savingService === 'google_ai_studio'}
            />

            {legacyTtsEnabled && (
              <FishAudioConfig
                apiKey={fishAudioAIStudioKey}
                setApiKey={setFishAudioAIStudioKey}
                confirmLegacyVerification={fishAudioAIStudioLegacyVerificationConfirmed}
                setConfirmLegacyVerification={setFishAudioAIStudioLegacyVerificationConfirmed}
                onSave={createFishAudioSaveHandler('fish_audio_ai_studio', fishAudioAIStudioKey)}
                message={messages.fish_audio_ai_studio}
                isSaving={savingService === 'fish_audio_ai_studio'}
                platform="ai-studio"
              />
            )}
          </TabsContent>

          <TabsContent value="maintenance" className="space-y-6">
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
              这里放旧剪辑兼容和本机维护工具；当前转译配音主线请优先使用「系统设置」里的 MiniMax
              配音、Gemini 模型和创作者资产。
            </div>
            <TTSConfig onConfigChange={handleSystemConfigSave} />
            <StorageCleanup />
          </TabsContent>
        </Tabs>
      </section>
    </div>
  )
}
