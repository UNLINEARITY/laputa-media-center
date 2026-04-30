'use client'

import {
  AlertCircle,
  ArrowRight,
  BookOpenText,
  Captions,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FileText,
  FileVideo,
  Languages,
  Mic2,
  Podcast,
  Settings,
  Sparkles,
  UserRound,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui'
import { getLanguageLabel } from '@/lib/config/languages'
import {
  DUBBING_QA_VERDICT_LABELS,
  getDubbingQaSummaryFromJob,
} from '@/lib/jobs/dubbing-qa-summary'
import { getJobKindLabel, getJobSourceLabel } from '@/lib/jobs/job-display'
import type { Job, JobStatus } from '@/types'

const ENGINE_PIPELINE = [
  { label: '素材', value: '影片、音讯、文本、链接', icon: BookOpenText },
  { label: '理解', value: '转录、摘要、内容简报', icon: Captions },
  { label: '改写', value: '口播稿、词库、受众语气', icon: FileText },
  { label: '声音', value: '声线、配音、节奏', icon: Mic2 },
  { label: '质检', value: '终听、修版、版本比较', icon: ClipboardCheck },
  { label: '成片', value: '字幕、口型、下载', icon: FileVideo },
]

const ENGINE_MODULES = [
  {
    title: '素材吸收',
    description: '读取 YouTube、本地影片或音讯，生成转录、时间码和后续处理计划。',
    status: '可用',
    href: '/ingest',
    cta: '开始导入',
    icon: BookOpenText,
    active: true,
  },
  {
    title: '普通话 / 广东话本地化',
    description: '把外语影片转成中文口播、字幕和可选口型同步成片。',
    status: '主线',
    href: '/dubbing',
    cta: '开配音台',
    icon: Languages,
    active: true,
  },
  {
    title: '任务控制台',
    description: '查看运行状态、步骤日志、失败原因、产物路径和最终下载结果。',
    status: '可用',
    href: '/jobs',
    cta: '查看任务',
    icon: Clock3,
    active: true,
  },
  {
    title: '播客整理',
    description: '把长谈话整理成开场、分段、重点和可口播稿。',
    status: '下一步',
    href: '/ingest',
    cta: '先导入素材',
    icon: Podcast,
    active: false,
  },
  {
    title: '短视频切片',
    description: '找出可发布片段，生成标题、口播重写和字幕节奏。',
    status: '下一步',
    href: '/ingest',
    cta: '先导入素材',
    icon: FileVideo,
    active: false,
  },
  {
    title: '品牌素材库',
    description: '管理声线、词库、讲者资料、片头片尾与固定口播规则。',
    status: '规划中',
    href: '/settings#creator_assets',
    cta: '配置声线',
    icon: UserRound,
    active: false,
  },
]

const QUICK_SETTINGS = [
  { label: '创作者资产与词库', href: '/settings#creator_assets', icon: FileText },
  { label: 'Gemini / 公益站模型', href: '/settings', icon: Sparkles },
  { label: 'MiniMax 声线与配音', href: '/settings#minimax_tts', icon: Mic2 },
]

const JOB_STATUS_META: Record<
  JobStatus,
  { label: string; className: string; icon: typeof Clock3 }
> = {
  pending: {
    label: '排队中',
    className: 'border-amber-200 bg-amber-50 text-amber-700',
    icon: Clock3,
  },
  processing: {
    label: '处理中',
    className: 'border-sky-200 bg-sky-50 text-sky-700',
    icon: Clock3,
  },
  completed: {
    label: '已完成',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    icon: CheckCircle2,
  },
  failed: {
    label: '需处理',
    className: 'border-rose-200 bg-rose-50 text-rose-700',
    icon: AlertCircle,
  },
}

const QA_SUMMARY_STYLES = {
  ready: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  review: 'border-amber-200 bg-amber-50 text-amber-700',
  fix: 'border-red-200 bg-red-50 text-red-700',
} as const

function getJobLanguagePair(job: Job): string | null {
  const sourceLanguage = job.config?.source_language
  const targetLanguage = job.config?.target_language
  if (!sourceLanguage && !targetLanguage) return null

  return `${getLanguageLabel(sourceLanguage || 'auto')} → ${getLanguageLabel(
    targetLanguage || '未指定',
  )}`
}

function formatJobTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function EngineDashboard() {
  const router = useRouter()
  const [recentJobs, setRecentJobs] = useState<Job[]>([])
  const [recentJobsLoading, setRecentJobsLoading] = useState(true)

  useEffect(() => {
    let active = true

    async function loadRecentJobs() {
      try {
        const response = await fetch('/api/jobs?limit=4', { cache: 'no-store' })
        if (!active || !response.ok) return
        const data = await response.json()
        setRecentJobs(Array.isArray(data.jobs) ? data.jobs : [])
      } finally {
        if (active) setRecentJobsLoading(false)
      }
    }

    loadRecentJobs()
    return () => {
      active = false
    }
  }, [])

  return (
    <main className="min-h-screen bg-claude-cream-50">
      <section className="border-b border-claude-cream-200 bg-white">
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:px-8">
          <div className="min-w-0">
            <div className="mb-4 flex w-fit items-center gap-2 rounded-md border border-claude-orange-200 bg-claude-orange-50 px-3 py-1 text-xs font-medium text-claude-orange-700">
              <Sparkles className="h-4 w-4" />
              Laputa 内容引擎
            </div>
            <h1 className="max-w-3xl text-3xl font-semibold tracking-normal text-claude-dark-900 sm:text-4xl">
              把素材和观点，接成可持续发布的音视频内容生产线。
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-claude-dark-500">
              当前主线是外语影片本地化：吸收素材、理解上下文、按你的受众改写口播，再输出普通话、广东话或多语配音成片。
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button type="button" variant="primary" onClick={() => router.push('/ingest')}>
                开始影片本地化
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <Button type="button" variant="outline" onClick={() => router.push('/dubbing')}>
                直接开配音台
              </Button>
              <Button type="button" variant="outline" onClick={() => router.push('/jobs')}>
                查看任务
              </Button>
            </div>
          </div>

          <div className="rounded-lg border border-claude-cream-200 bg-claude-cream-50 px-4 py-4">
            <p className="text-sm font-semibold text-claude-dark-900">当前可跑闭环</p>
            <div className="mt-3 space-y-2">
              {[
                'YouTube / 本地影片吸收',
                'ASR 转录与上下文理解',
                '普通话 / 广东话口播改写',
                'MiniMax 配音与成片输出',
              ].map((item) => (
                <div key={item} className="flex items-center gap-2 text-sm text-claude-dark-500">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {ENGINE_PIPELINE.map((step) => {
            const Icon = step.icon
            return (
              <div
                key={step.label}
                className="min-h-28 rounded-lg border border-claude-cream-200 bg-white px-4 py-4"
              >
                <Icon className="h-5 w-5 text-claude-orange-600" />
                <p className="mt-3 text-sm font-semibold text-claude-dark-900">{step.label}</p>
                <p className="mt-1 text-xs leading-5 text-claude-dark-400">{step.value}</p>
              </div>
            )
          })}
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-4 pb-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:px-8">
        <div className="min-w-0 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-claude-dark-900">工作模块</h2>
            <button
              type="button"
              onClick={() => router.push('/jobs')}
              className="shrink-0 text-sm font-medium text-claude-orange-700 underline underline-offset-2"
            >
              查看任务记录
            </button>
          </div>
          <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
            {ENGINE_MODULES.map((module) => {
              const Icon = module.icon
              return (
                <button
                  key={module.title}
                  type="button"
                  onClick={() => router.push(module.href)}
                  className="min-h-44 w-full min-w-0 rounded-lg border border-claude-cream-200 bg-white px-4 py-4 text-left transition-colors hover:border-claude-orange-300 hover:bg-claude-cream-50"
                >
                  <div className="flex items-center justify-between gap-3">
                    <Icon
                      className={`h-5 w-5 ${module.active ? 'text-claude-orange-600' : 'text-claude-dark-400'}`}
                    />
                    <span
                      className={`rounded-md px-2 py-1 text-xs font-medium ${
                        module.active
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-claude-cream-100 text-claude-dark-400'
                      }`}
                    >
                      {module.status}
                    </span>
                  </div>
                  <h3 className="mt-4 text-base font-semibold text-claude-dark-900">
                    {module.title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-claude-dark-500">
                    {module.description}
                  </p>
                  <span className="mt-4 inline-flex items-center text-sm font-medium text-claude-orange-700">
                    {module.cta}
                    <ArrowRight className="ml-1.5 h-4 w-4" />
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <aside className="min-w-0 space-y-3">
          <div className="rounded-lg border border-claude-cream-200 bg-white px-5 py-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-claude-dark-900">最近任务</h2>
              <button
                type="button"
                onClick={() => router.push('/jobs')}
                className="text-xs font-medium text-claude-orange-700 underline underline-offset-2"
              >
                全部任务
              </button>
            </div>

            <div className="mt-3 space-y-2">
              {recentJobsLoading ? (
                <div className="rounded-md border border-claude-cream-200 bg-claude-cream-50 px-3 py-3 text-sm text-claude-dark-400">
                  正在读取最近任务。
                </div>
              ) : recentJobs.length > 0 ? (
                recentJobs.map((job) => {
                  const status = JOB_STATUS_META[job.status]
                  const StatusIcon = status.icon
                  const languagePair = getJobLanguagePair(job)
                  const qaSummary = getDubbingQaSummaryFromJob(job)

                  return (
                    <button
                      key={job.id}
                      type="button"
                      onClick={() => router.push(`/jobs/${job.id}`)}
                      className="w-full rounded-md border border-claude-cream-200 px-3 py-3 text-left transition-colors hover:border-claude-orange-300 hover:bg-claude-cream-50"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-claude-dark-900">
                            {getJobSourceLabel(job)}
                          </p>
                          <p className="mt-1 text-xs text-claude-dark-300">
                            #{job.id} · {formatJobTime(job.created_at)}
                          </p>
                        </div>
                        <span
                          className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${status.className}`}
                        >
                          <StatusIcon className="h-3.5 w-3.5" />
                          {status.label}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-3 text-xs">
                        <span className="min-w-0 truncate text-claude-dark-400">
                          {languagePair || getJobKindLabel(job)}
                        </span>
                        {qaSummary ? (
                          <span
                            className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-medium ${
                              QA_SUMMARY_STYLES[qaSummary.verdict]
                            }`}
                          >
                            <ClipboardCheck className="h-3.5 w-3.5" />
                            QA {qaSummary.score} · {DUBBING_QA_VERDICT_LABELS[qaSummary.verdict]}
                          </span>
                        ) : (
                          <span className="shrink-0 font-medium text-claude-orange-700">继续</span>
                        )}
                      </div>
                    </button>
                  )
                })
              ) : (
                <div className="rounded-md border border-dashed border-claude-cream-300 bg-claude-cream-50 px-3 py-4 text-sm leading-6 text-claude-dark-400">
                  还没有任务。先导入一条素材，这里就会变成续接入口。
                </div>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-claude-cream-200 bg-white px-5 py-4 shadow-sm">
            <h2 className="text-sm font-semibold text-claude-dark-900">下一步建议</h2>
            <div className="mt-3 space-y-3 text-sm leading-6 text-claude-dark-500">
              <p>先用「素材吸收」保存来源，再进入「转译配音」填内容简报和项目词库。</p>
              <p>普通话 / 广东话是当前最稳定主线；其他语言建议先用短片段试跑。</p>
            </div>
          </div>

          <div className="rounded-lg border border-claude-cream-200 bg-white px-5 py-4 shadow-sm">
            <h2 className="text-sm font-semibold text-claude-dark-900">配置入口</h2>
            <div className="mt-3 space-y-2">
              {QUICK_SETTINGS.map((item) => {
                const Icon = item.icon
                return (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => router.push(item.href)}
                    className="flex w-full items-center gap-3 rounded-md border border-claude-cream-200 px-3 py-2 text-left text-sm text-claude-dark-500 transition-colors hover:border-claude-orange-300 hover:bg-claude-cream-50"
                  >
                    <Icon className="h-4 w-4 shrink-0 text-claude-orange-600" />
                    <span>{item.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="rounded-lg border border-claude-cream-200 bg-white px-5 py-4 shadow-sm">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-claude-dark-900">
              <Settings className="h-4 w-4 text-claude-orange-600" />
              产品边界
            </h2>
            <p className="mt-3 text-sm leading-6 text-claude-dark-500">
              这里是总控台；具体执行仍在素材吸收、转译配音和任务页完成。
            </p>
          </div>
        </aside>
      </section>
    </main>
  )
}
