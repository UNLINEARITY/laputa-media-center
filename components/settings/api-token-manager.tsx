'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useConfirmDialog } from '@/components/dialogs'
import { Button, Card, Input, Label } from '@/components/ui'
import type { ApiTokenDisplay } from '@/types/api/config'

interface ApiTokenManagerProps {
  onTokenChange?: () => void
}

export function ApiTokenManager({ onTokenChange }: ApiTokenManagerProps) {
  const { confirm } = useConfirmDialog()
  const [tokens, setTokens] = useState<ApiTokenDisplay[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newTokenName, setNewTokenName] = useState('')
  const [newTokenExpireDays, setNewTokenExpireDays] = useState<string>('')
  const [generatedToken, setGeneratedToken] = useState<string | null>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: 初始化加载
  useEffect(() => {
    loadTokens()
  }, [])

  const loadTokens = async () => {
    try {
      const response = await fetch('/api/auth/tokens')
      if (!response.ok) {
        // 401/其他错误静默处理（测试环境或未登录）
        setTokens([])
        return
      }
      const data = await response.json()
      setTokens(data.tokens || [])
    } catch {
      // 网络异常静默处理
      setTokens([])
    } finally {
      setLoading(false)
    }
  }

  const handleCreateToken = async () => {
    if (!newTokenName.trim()) {
      toast.error('请输入 Token 名称')
      return
    }

    setCreating(true)

    try {
      const payload: { name: string; expires_in_days?: number } = {
        name: newTokenName.trim(),
      }

      if (newTokenExpireDays && Number(newTokenExpireDays) > 0) {
        payload.expires_in_days = Number(newTokenExpireDays)
      }

      const response = await fetch('/api/auth/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (response.ok) {
        const data = await response.json()
        setGeneratedToken(data.token)
        setNewTokenName('')
        setNewTokenExpireDays('')
        await loadTokens()
        toast.success('Token 生成成功')
        onTokenChange?.()
      } else {
        const error = await response.json()
        toast.error(error.error || '生成 Token 失败')
      }
    } catch (error: unknown) {
      console.error('Failed to create token:', error)
      toast.error('生成 Token 失败')
    } finally {
      setCreating(false)
    }
  }

  const handleDeleteToken = async (id: string) => {
    const confirmed = await confirm({
      title: '确定要删除这个 API Token 吗？',
      description: '删除后无法恢复，使用该 Token 的外部系统将无法访问 API。',
      variant: 'danger',
      confirmText: '删除 Token',
      cancelText: '取消',
    })

    if (!confirmed) {
      return
    }

    try {
      const response = await fetch(`/api/auth/tokens/${id}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        await loadTokens()
        toast.success('Token 已删除')
        onTokenChange?.()
      } else {
        const error = await response.json()
        toast.error(error.error || '删除 Token 失败')
      }
    } catch (error: unknown) {
      console.error('Failed to delete token:', error)
      toast.error('删除 Token 失败')
    }
  }

  const copyToClipboard = async (text: string) => {
    try {
      // 优先使用 Clipboard API
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        // 降级方案：使用传统的 textarea 方式
        const textarea = document.createElement('textarea')
        textarea.value = text
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      }

      toast.success('Token 已复制到剪贴板')
    } catch (error: unknown) {
      console.error('Failed to copy to clipboard:', error)
      toast.error('复制失败，请手动复制 Token')
    }
  }

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('zh-CN')
  }

  if (loading) {
    return (
      <Card className="border-claude-dark-300/20 bg-white/60 p-6">
        <p className="text-sm text-claude-dark-400">加载中...</p>
      </Card>
    )
  }

  return (
    <Card className="border-claude-dark-300/20 bg-white/60 p-6">
      <h3 className="mb-4 text-lg font-semibold text-claude-dark-900">API Token 管理</h3>

      {/* 生成成功提示 */}
      {generatedToken && (
        <div className="mb-6 rounded-lg border border-emerald-300 bg-emerald-50 p-4">
          <h4 className="mb-2 text-sm font-semibold text-emerald-900">Token 生成成功！</h4>
          <p className="mb-3 text-xs text-emerald-800">
            请立即复制保存，此 Token 仅显示一次，关闭后将无法再次查看。
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-white px-3 py-2 text-sm text-emerald-900 font-mono break-all">
              {generatedToken}
            </code>
            <Button
              onClick={() => copyToClipboard(generatedToken)}
              className="shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              复制
            </Button>
          </div>
          <Button
            onClick={() => setGeneratedToken(null)}
            className="mt-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
          >
            我已保存，关闭提示
          </Button>
        </div>
      )}

      {/* 创建新 Token */}
      <div className="mb-6 space-y-4 rounded-lg border border-claude-dark-300/30 bg-claude-cream-50/50 p-4">
        <h4 className="text-sm font-semibold text-claude-dark-900">生成新 Token</h4>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="token_name" className="text-sm font-medium text-claude-dark-900">
              Token 名称
            </Label>
            <Input
              id="token_name"
              type="text"
              value={newTokenName}
              onChange={(e) => setNewTokenName(e.target.value)}
              placeholder="如：生产环境 Token"
              className="border-claude-dark-300/30 focus:border-claude-orange-500 focus:ring-claude-orange-500/20"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="token_expire" className="text-sm font-medium text-claude-dark-900">
              过期天数（可选）
            </Label>
            <Input
              id="token_expire"
              type="number"
              min="1"
              max="365"
              value={newTokenExpireDays}
              onChange={(e) => setNewTokenExpireDays(e.target.value)}
              placeholder="留空 = 永不过期"
              className="border-claude-dark-300/30 focus:border-claude-orange-500 focus:ring-claude-orange-500/20"
            />
          </div>
        </div>

        <Button
          onClick={handleCreateToken}
          disabled={creating || !newTokenName.trim()}
          className="bg-claude-orange-500 hover:bg-claude-orange-600 text-white"
        >
          {creating ? '生成中...' : '生成 Token'}
        </Button>
      </div>

      {/* Token 列表 */}
      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-claude-dark-900">已有 Token ({tokens.length})</h4>

        {tokens.length === 0 ? (
          <p className="text-sm text-claude-dark-400">暂无 API Token，请先生成一个。</p>
        ) : (
          <div className="space-y-2">
            {tokens.map((token) => (
              <div
                key={token.id}
                className="flex items-center justify-between rounded-lg border border-claude-dark-300/20 bg-white p-3"
              >
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-claude-dark-900">{token.name}</span>
                    <code className="rounded bg-claude-cream-100 px-2 py-0.5 text-xs text-claude-dark-600 font-mono">
                      {token.display_token}
                    </code>
                  </div>

                  <div className="flex gap-4 text-xs text-claude-dark-400">
                    <span>创建：{formatTimestamp(token.created_at)}</span>
                    {token.last_used_at && (
                      <span>最后使用：{formatTimestamp(token.last_used_at)}</span>
                    )}
                    {token.expires_at && (
                      <span className="text-orange-600">
                        过期：{formatTimestamp(token.expires_at)}
                      </span>
                    )}
                  </div>
                </div>

                <Button
                  onClick={() => handleDeleteToken(token.id)}
                  variant="outline"
                  className="shrink-0 text-red-600 border-red-300 hover:bg-red-50"
                >
                  删除
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 使用说明 */}
      <div className="mt-6 rounded-lg border border-claude-cream-200 bg-claude-cream-50 p-4">
        <h4 className="mb-2 text-sm font-semibold text-claude-dark-900">使用说明</h4>
        <ul className="space-y-1 text-xs text-claude-dark-700">
          <li>• API Token 用于外部系统调用本系统的 API 接口</li>
          <li>
            • 请求时在 HTTP Header 中添加：
            <code className="bg-white px-1 rounded">
              Authorization: Bearer {'{'}your_token{'}'}
            </code>
          </li>
          <li>• 建议为不同的应用环境创建不同的 Token，方便管理和撤销</li>
          <li>• Token 一旦生成仅显示一次，请务必妥善保存</li>
        </ul>
      </div>
    </Card>
  )
}
