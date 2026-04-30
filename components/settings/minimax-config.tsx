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
import { MiniMaxVoiceRegistryEditor } from './minimax-voice-registry-editor'
import type { ServiceMessage } from './types'

interface MiniMaxConfigProps {
  apiKey: string
  setApiKey: (key: string) => void
  voiceId: string
  setVoiceId: (voiceId: string) => void
  confirmPaidVerification: boolean
  setConfirmPaidVerification: (confirmed: boolean) => void
  onSaveOnly: () => Promise<void>
  onVerifyAndSave: () => Promise<void>
  message: ServiceMessage | null
  isSavingConfig: boolean
  isVerifying: boolean
}

export function MiniMaxConfig({
  apiKey,
  setApiKey,
  voiceId,
  setVoiceId,
  confirmPaidVerification,
  setConfirmPaidVerification,
  onSaveOnly,
  onVerifyAndSave,
  message,
  isSavingConfig,
  isVerifying,
}: MiniMaxConfigProps) {
  const [showKey, setShowKey] = useState(false)
  const busy = isSavingConfig || isVerifying

  return (
    <Card className="claude-card">
      <CardHeader className="space-y-1">
        <CardTitle className="text-xl font-semibold text-claude-dark-900">MiniMax 配音</CardTitle>
        <CardDescription className="text-sm text-claude-dark-300">
          保存 MiniMax API Key 和可选验证用声线；需要时可单独发起一次付费 TTS 验证。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="minimax-api-key">API Key</Label>
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowKey(!showKey)}>
                {showKey ? '隐藏' : '显示'}
              </Button>
            </div>
            <Input
              id="minimax-api-key"
              type={showKey ? 'text' : 'password'}
              placeholder="MiniMax API Key"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              className="h-11"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="minimax-voice-id">验证用 voice_id（可选）</Label>
            <Input
              id="minimax-voice-id"
              type="text"
              placeholder="例如用于测试 TTS 可用性的 voice_id"
              value={voiceId}
              onChange={(event) => setVoiceId(event.target.value)}
              className="h-11"
            />
            <p className="text-xs text-claude-dark-300">
              仅用于付费验证时测试 API Key 和声线可用性；正式配音默认声线请在下方声线元数据中绑定。
            </p>
          </div>
        </div>

        <div className="rounded-md border border-claude-orange-200 bg-claude-orange-50 px-3 py-3 text-xs leading-5 text-claude-dark-500">
          保存到设置页后，后端会以加密方式存储；执行配音任务时才临时注入 Python
          子进程。仅保存配置不会调用 MiniMax，也不会触发 TTS。
        </div>

        <Button
          onClick={onSaveOnly}
          disabled={busy}
          className="w-full bg-claude-orange-500 text-white hover:bg-claude-orange-600 sm:ml-auto sm:w-auto sm:min-w-[140px]"
        >
          {isSavingConfig ? '保存中...' : '保存配置'}
        </Button>

        <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-xs leading-5 text-amber-800">
          <p>付费验证会调用一次 MiniMax 测试 TTS，用于确认 API Key 和 voice_id 可用。</p>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={confirmPaidVerification}
              onChange={(event) => setConfirmPaidVerification(event.target.checked)}
              className="mt-1 h-4 w-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
            />
            <span>我确认本次验证会调用一次 MiniMax TTS，可能产生费用。</span>
          </label>
          <Button
            type="button"
            variant="outline"
            onClick={onVerifyAndSave}
            disabled={busy || !confirmPaidVerification}
            className="bg-white"
          >
            {isVerifying ? '验证中...' : '付费验证一次'}
          </Button>
        </div>

        {message && (
          <p
            className={`text-sm ${
              message.type === 'success' ? 'text-emerald-600' : 'text-red-600'
            }`}
          >
            {message.text}
          </p>
        )}

        <MiniMaxVoiceRegistryEditor />
      </CardContent>
    </Card>
  )
}
