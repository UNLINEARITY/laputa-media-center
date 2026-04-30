'use client'

import { useState } from 'react'
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@/components/ui'
import { CONFIG_DEFAULTS } from '@/lib/config'
import type { GeminiAIStudioCredentials } from '@/types'
import type { ServiceMessage } from './types'

interface GeminiAIStudioConfigProps {
  credentials: GeminiAIStudioCredentials
  setCredentials: (creds: GeminiAIStudioCredentials) => void
  onSave: () => Promise<void>
  message: ServiceMessage | null
  isSaving: boolean
}

export function GeminiAIStudioConfig({
  credentials,
  setCredentials,
  onSave,
  message,
  isSaving,
}: GeminiAIStudioConfigProps) {
  const [showKey, setShowKey] = useState(false)
  const [validationOutput, setValidationOutput] = useState<string | null>(null)
  const [validationStep, setValidationStep] = useState<string | null>(null)

  const _stripModelPrefix = (value: string) => value.replace(/^models\//, '')

  const handleSaveOnly = async () => {
    const apiKey = credentials.api_key.trim()
    const apiBaseUrl = credentials.api_base_url?.trim() || ''
    let modelId = credentials.model_id.trim()
    modelId = _stripModelPrefix(modelId || CONFIG_DEFAULTS.DEFAULT_GEMINI_MODEL)

    setValidationOutput(null)
    setValidationStep(null)

    if (!apiKey) {
      setValidationStep('基础校验失败：请填写完整的配置信息')
      return
    }

    try {
      setValidationStep('基础校验通过，正在保存配置...')
      setValidationOutput(
        `模型：${modelId}\nAPI Base URL：${apiBaseUrl || 'Google 官方'}\n本次只加密保存配置，不调用 Gemini provider。`,
      )
      await onSave()
    } catch (error: unknown) {
      setValidationStep('保存过程出错')
      setValidationOutput(error instanceof Error ? error.message : '未知错误')
    }
  }

  return (
    <Card className="claude-card lg:col-span-2">
      <CardHeader className="space-y-1">
        <CardTitle className="text-xl font-semibold text-claude-dark-900">
          Gemini AI Studio
        </CardTitle>
        <CardDescription className="text-sm text-claude-dark-300">
          使用 API Key 调用 Google AI Studio Gemini 模型；保存配置不会调用外部 provider。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="ai-studio-api-key">API Key</Label>
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowKey(!showKey)}>
                {showKey ? '隐藏' : '显示'}
              </Button>
            </div>
            <Input
              id="ai-studio-api-key"
              type={showKey ? 'text' : 'password'}
              placeholder="AIza..."
              value={credentials.api_key}
              onChange={(e) => setCredentials({ ...credentials, api_key: e.target.value })}
              className="h-11"
            />
            <p className="text-xs text-claude-dark-300">
              可使用 Google AI Studio 或 Gemini-compatible 公益站；不要把 API Key 发到聊天里。
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ai-studio-model-id">模型 ID</Label>
            <Input
              id="ai-studio-model-id"
              type="text"
              placeholder="gemini-3-flash-preview"
              value={credentials.model_id}
              onChange={(e) => setCredentials({ ...credentials, model_id: e.target.value })}
              className="h-11"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ai-studio-api-base-url">API Base URL（可选）</Label>
            <Input
              id="ai-studio-api-base-url"
              type="url"
              placeholder="https://example.com/v1beta"
              value={credentials.api_base_url || ''}
              onChange={(e) => setCredentials({ ...credentials, api_base_url: e.target.value })}
              className="h-11"
            />
            <p className="text-xs text-claude-dark-300">
              留空则使用 Google 官方；x666.me 可直接填 https://x666.me 或
              https://x666.me/v1，系统会自动使用 /v1/chat/completions。
            </p>
          </div>
        </div>

        {/* 保存过程反馈 */}
        {validationStep && (
          <div className="rounded-lg border border-claude-cream-200 bg-claude-cream-50 p-3 max-w-2xl">
            <p className="text-sm font-medium text-claude-dark-900">{validationStep}</p>
            {validationOutput && (
              <p className="mt-2 text-xs text-claude-dark-600 whitespace-pre-wrap wrap-break-word">
                {validationOutput}
              </p>
            )}
          </div>
        )}

        <Button
          onClick={handleSaveOnly}
          disabled={isSaving}
          className="w-full sm:w-auto sm:min-w-[140px] bg-claude-orange-500 hover:bg-claude-orange-600 text-white"
        >
          {isSaving ? '保存中...' : '保存配置'}
        </Button>

        {/* 最终保存结果 */}
        {message && (
          <p
            className={`text-sm ${
              message.type === 'success' ? 'text-emerald-600' : 'text-red-600'
            }`}
          >
            {message.text}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
