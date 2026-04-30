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
import type { Platform, ServiceMessage } from './types'

interface FishAudioConfigProps {
  apiKey: string
  setApiKey: (key: string) => void
  confirmLegacyVerification: boolean
  setConfirmLegacyVerification: (confirmed: boolean) => void
  onSave: () => Promise<void>
  message: ServiceMessage | null
  isSaving: boolean
  platform: Platform
}

export function FishAudioConfig({
  apiKey,
  setApiKey,
  confirmLegacyVerification,
  setConfirmLegacyVerification,
  onSave,
  message,
  isSaving,
  platform,
}: FishAudioConfigProps) {
  const [showKey, setShowKey] = useState(false)

  const platformLabel = platform === 'vertex' ? 'Vertex AI' : 'AI Studio'

  return (
    <Card className="claude-card">
      <CardHeader className="space-y-1">
        <CardTitle className="text-xl font-semibold text-claude-dark-900">
          Fish Audio（{platformLabel} · 历史兼容）
        </CardTitle>
        <CardDescription className="text-sm text-claude-dark-300">
          仅保留给旧剪辑或历史项目验证 API Key；当前翻译配音主线使用 MiniMax 和已登记用途/授权记录的
          voice_id。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor={`fish-${platform}-key`}>API Key</Label>
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowKey(!showKey)}>
              {showKey ? '隐藏' : '显示'}
            </Button>
          </div>
          <Input
            id={`fish-${platform}-key`}
            type={showKey ? 'text' : 'password'}
            placeholder="sk_live_xxxxxxxxxxxxx"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="h-11"
          />
          <p className="text-xs text-claude-dark-300">
            从 Fish Audio 控制台获取旧项目 API Key，验证时使用默认测试音色。
          </p>
        </div>
        <label className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-xs leading-5 text-amber-800">
          <input
            type="checkbox"
            checked={confirmLegacyVerification}
            onChange={(event) => setConfirmLegacyVerification(event.target.checked)}
            className="mt-1 h-4 w-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
          />
          <span>
            我确认验证 Fish Audio 旧兼容 API Key 会调用一次测试
            TTS，可能产生费用；服务端还必须显式设置 ALLOW_PAID_DYNAMIC_TESTS=true。
          </span>
        </label>

        <Button
          onClick={onSave}
          disabled={isSaving || !confirmLegacyVerification}
          className="w-full sm:w-auto sm:min-w-[140px] sm:ml-auto bg-claude-orange-500 hover:bg-claude-orange-600 text-white"
        >
          {isSaving ? '验证中...' : '验证并保存'}
        </Button>

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
