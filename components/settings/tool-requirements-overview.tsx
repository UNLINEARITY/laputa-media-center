'use client'

import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Wrench } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui'

type RequirementState = 'ready' | 'missing' | 'unknown'
type ToolReadiness = 'ready' | 'blocked' | 'degraded'

interface RequirementStatus {
  id: string
  label: string
  category: 'provider' | 'runtime' | 'asset'
  description: string
  setupHref: string
  missingHint: string
  state: RequirementState
  ready: boolean
  detail: string
}

interface ToolSetupReadiness {
  id: string
  label: string
  href: string
  shortDescription: string
  readiness: ToolReadiness
  required: RequirementStatus[]
  optional: RequirementStatus[]
  missingRequired: RequirementStatus[]
  missingOptional: RequirementStatus[]
  summary: string
}

interface SetupRequirementsResponse {
  requirements: RequirementStatus[]
  tools: ToolSetupReadiness[]
}

interface ToolRequirementsOverviewProps {
  onActiveTabChange?: (tab: string) => void
}

const TAB_BY_HASH: Record<string, string> = {
  creator_assets: 'creator-assets',
  maintenance: 'maintenance',
  'asr-provider': 'system',
  'llm-provider': 'system',
  minimax_tts: 'system',
}

export function ToolRequirementsOverview({ onActiveTabChange }: ToolRequirementsOverviewProps) {
  const [snapshot, setSnapshot] = useState<SetupRequirementsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadSnapshot = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/setup-requirements', { cache: 'no-store' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        const message = data?.error?.message || data?.error || `HTTP ${response.status}`
        throw new Error(message)
      }
      setSnapshot(data)
    } catch (err) {
      setSnapshot(null)
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSnapshot()
  }, [loadSnapshot])

  const navigateToRequirement = useCallback(
    (requirement: RequirementStatus) => {
      const hash = requirement.setupHref.split('#')[1]
      if (!hash) return
      onActiveTabChange?.(TAB_BY_HASH[hash] || 'system')
      window.history.replaceState(null, '', requirement.setupHref)
      window.setTimeout(() => {
        document.getElementById(hash)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      }, 80)
    },
    [onActiveTabChange],
  )

  return (
    <Card className="border-claude-cream-200 bg-white">
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-claude-dark-700">
            <Wrench className="h-4 w-4 text-claude-orange-500" />
            按工具检查前置条件
          </CardTitle>
          <CardDescription className="text-sm text-claude-dark-400">
            每个工具的必需设置和可选增强会按当前本机状态聚合显示。
          </CardDescription>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void loadSnapshot()}
          disabled={loading}
          className="shrink-0"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          <span className="ml-1.5">刷新</span>
        </Button>
      </CardHeader>

      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-claude-dark-400">
            <Loader2 className="h-4 w-4 animate-spin" /> 正在检查本机状态...
          </div>
        ) : error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            前置条件检查失败：{error}
          </div>
        ) : snapshot ? (
          <div className="space-y-3">
            {snapshot.tools.map((tool) => (
              <ToolRequirementRow
                key={tool.id}
                tool={tool}
                onNavigateToRequirement={navigateToRequirement}
              />
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function ToolRequirementRow({
  tool,
  onNavigateToRequirement,
}: {
  tool: ToolSetupReadiness
  onNavigateToRequirement: (requirement: RequirementStatus) => void
}) {
  const requiredReady = tool.required.filter((requirement) => requirement.ready).length
  const optionalReady = tool.optional.filter((requirement) => requirement.ready).length

  return (
    <div className="rounded-md border border-claude-cream-200 bg-claude-cream-50/40 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={tool.href}
              className="text-sm font-semibold text-claude-dark-800 hover:text-claude-orange-600"
            >
              {tool.label}
            </a>
            <ToolReadinessBadge readiness={tool.readiness} summary={tool.summary} />
          </div>
          <p className="mt-1 text-xs leading-5 text-claude-dark-400">{tool.shortDescription}</p>
        </div>
        <div className="shrink-0 text-right text-[11px] leading-5 text-claude-dark-400">
          必需 {requiredReady}/{tool.required.length}
          {tool.optional.length > 0 ? ` · 可选 ${optionalReady}/${tool.optional.length}` : ''}
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <RequirementGroup
          label="必需"
          emptyLabel="无必需前置条件"
          requirements={tool.required}
          onNavigateToRequirement={onNavigateToRequirement}
        />
        {tool.optional.length > 0 && (
          <RequirementGroup
            label="可选"
            emptyLabel="无可选增强"
            requirements={tool.optional}
            onNavigateToRequirement={onNavigateToRequirement}
          />
        )}
      </div>
    </div>
  )
}

function RequirementGroup({
  label,
  emptyLabel,
  requirements,
  onNavigateToRequirement,
}: {
  label: string
  emptyLabel: string
  requirements: RequirementStatus[]
  onNavigateToRequirement: (requirement: RequirementStatus) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-9 text-[11px] font-semibold text-claude-dark-400">{label}</span>
      {requirements.length === 0 ? (
        <span className="text-xs text-claude-dark-300">{emptyLabel}</span>
      ) : (
        requirements.map((requirement) => (
          <RequirementChip
            key={requirement.id}
            requirement={requirement}
            onNavigateToRequirement={onNavigateToRequirement}
          />
        ))
      )}
    </div>
  )
}

function RequirementChip({
  requirement,
  onNavigateToRequirement,
}: {
  requirement: RequirementStatus
  onNavigateToRequirement: (requirement: RequirementStatus) => void
}) {
  const ready = requirement.ready
  return (
    <button
      type="button"
      title={ready ? requirement.detail : requirement.missingHint}
      onClick={() => onNavigateToRequirement(requirement)}
      className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-1 text-left text-[11px] font-medium transition-colors ${
        ready
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300'
          : 'border-amber-200 bg-amber-50 text-amber-800 hover:border-amber-300'
      }`}
    >
      {ready ? (
        <CheckCircle2 className="h-3 w-3 shrink-0" />
      ) : (
        <AlertTriangle className="h-3 w-3 shrink-0" />
      )}
      <span className="truncate">{requirement.label}</span>
    </button>
  )
}

function ToolReadinessBadge({ readiness, summary }: { readiness: ToolReadiness; summary: string }) {
  const style =
    readiness === 'ready'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : readiness === 'degraded'
        ? 'border-amber-200 bg-amber-50 text-amber-800'
        : 'border-red-200 bg-red-50 text-red-700'

  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${style}`}
    >
      {summary}
    </span>
  )
}
