/**
 * 任务列表客户端组件
 * 处理交互、轮询和分页
 */

'use client'

import { AlertCircle, ClipboardCheck, Film, MoreVertical, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { useConfirmDialog } from '@/components/dialogs'
import { JobStatusBadge } from '@/components/jobs/job-status-badge'
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Pagination,
} from '@/components/ui'
import { getDubbingLanguageCapability, getLanguageLabel } from '@/lib/config/languages'
import {
  DUBBING_QA_VERDICT_LABELS,
  getDubbingQaSummaryFromJob,
} from '@/lib/jobs/dubbing-qa-summary'
import {
  getJobKindWithScopeLabel,
  getJobRunScopeLabel,
  getJobSourceLabel,
} from '@/lib/jobs/job-display'
import { useJobStore } from '@/store/job-store'
import type { Job } from '@/types'

interface JobListClientProps {
  initialJobs: Job[]
  totalJobs: number
  currentPage: number
  pageSize: number
}

const CAPABILITY_STYLES = {
  core: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  standard: 'border-sky-200 bg-sky-50 text-sky-700',
  experimental: 'border-amber-200 bg-amber-50 text-amber-700',
} as const

const QA_SUMMARY_STYLES = {
  ready: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  review: 'border-amber-200 bg-amber-50 text-amber-700',
  fix: 'border-red-200 bg-red-50 text-red-700',
} as const

const RUN_SCOPE_STYLES = {
  sample: 'border-violet-200 bg-violet-50 text-violet-700',
  full: 'border-emerald-200 bg-emerald-50 text-emerald-700',
} as const

function getJobLanguageSummary(job: Job) {
  const sourceLanguage = job.config?.source_language
  const targetLanguage = job.config?.target_language
  if (!sourceLanguage && !targetLanguage) return null

  const capability =
    job.config?.language_capability ||
    (targetLanguage ? getDubbingLanguageCapability(targetLanguage) : null)

  return {
    pair: `${getLanguageLabel(sourceLanguage || 'auto')} → ${
      targetLanguage ? getLanguageLabel(targetLanguage) : '未指定'
    }`,
    capability,
  }
}

export function JobListClient({
  initialJobs,
  totalJobs,
  currentPage,
  pageSize,
}: JobListClientProps) {
  const router = useRouter()
  const { confirm } = useConfirmDialog()
  const { jobs, setJobs, deleteJob } = useJobStore()
  const [mounted, setMounted] = useState(false)
  const [_isPending, startTransition] = useTransition()

  // 同步 initialJobs 到 store，确保状态统一
  useEffect(() => {
    setJobs(initialJobs)
  }, [initialJobs, setJobs])

  // 优先使用 store 的 jobs，如果 store 还没初始化则回退到 initialJobs
  const displayJobs = jobs.length > 0 ? jobs : initialJobs

  const totalPages = Math.ceil(totalJobs / pageSize)

  // 只在客户端渲染时间相关内容，避免 hydration 错误
  useEffect(() => {
    setMounted(true)
  }, [])

  const handlePageChange = (newPage: number) => {
    router.push(`/jobs?page=${newPage}&pageSize=${pageSize}`)
  }

  const handleDelete = async (jobId: string) => {
    const confirmed = await confirm({
      title: '确定要删除此任务吗？',
      description:
        '此操作不可恢复，将永久删除任务的所有数据，包括任务产物、转录/配音资产和运行日志。',
      variant: 'danger',
      confirmText: '删除任务',
      cancelText: '取消',
    })

    if (!confirmed) return

    startTransition(async () => {
      try {
        await deleteJob(jobId)
      } catch (error: unknown) {
        toast.error(error instanceof Error ? error.message : '删除任务失败，请重试')
      }
    })
  }

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('zh-CN')
  }

  const formatDuration = (startTime: number | null, endTime: number | null) => {
    if (!startTime) return '-'

    // 服务器端渲染时，如果没有结束时间，返回占位符避免 hydration 错误
    if (!mounted && !endTime) return '计算中...'

    const end = endTime || Date.now()
    const seconds = Math.floor((end - startTime) / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)

    if (hours > 0) return `${hours}小时${minutes % 60}分钟`
    if (minutes > 0) return `${minutes}分钟${seconds % 60}秒`
    return `${seconds}秒`
  }

  return (
    <section className="mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8">
      {/* 空状态 */}
      {totalJobs === 0 ? (
        <Card className="claude-card border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <Film className="h-12 w-12 text-claude-dark-400" />
            <p className="text-lg font-semibold text-claude-dark-400">还没有创建任务</p>
            <p className="max-w-sm text-sm text-claude-dark-300">
              从素材导入入口加入第一条内容，后续可以进入转文本、短视频、播客或翻译配音流程。
            </p>
            <Link
              href="/ingest"
              className="mt-2 text-sm text-claude-orange-500 hover:text-claude-orange-600 underline"
            >
              前往素材导入
            </Link>
          </CardContent>
        </Card>
      ) : (
        /* 任务列表 */
        <div className="space-y-6 min-h-[800px]">
          {displayJobs.map((job) => {
            const languageSummary = getJobLanguageSummary(job)
            const qaSummary = getDubbingQaSummaryFromJob(job)
            const runScope = getJobRunScopeLabel(job)

            return (
              <Card key={job.id} className="claude-card">
                <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex-1 min-w-0 space-y-1">
                    <CardTitle className="flex items-center gap-3 text-xl">
                      <span className="font-semibold text-claude-dark-900">任务 #{job.id}</span>
                      <JobStatusBadge status={job.status} />
                      {runScope && (
                        <span
                          className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
                            RUN_SCOPE_STYLES[runScope.mode]
                          }`}
                          title={runScope.description}
                        >
                          {runScope.label}
                        </span>
                      )}
                    </CardTitle>
                    <CardDescription className="truncate text-xs text-claude-dark-300">
                      {getJobSourceLabel(job)}
                    </CardDescription>
                    {languageSummary && (
                      <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                        <span className="font-medium text-claude-dark-500">
                          {languageSummary.pair}
                        </span>
                        {languageSummary.capability && (
                          <span
                            className={`rounded-full border px-2 py-0.5 font-medium ${
                              CAPABILITY_STYLES[languageSummary.capability.status]
                            }`}
                          >
                            {languageSummary.capability.label}
                          </span>
                        )}
                      </div>
                    )}
                    {qaSummary && (
                      <Link
                        href={`/jobs/${job.id}/qa`}
                        className={`mt-2 inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${
                          QA_SUMMARY_STYLES[qaSummary.verdict]
                        }`}
                      >
                        <ClipboardCheck className="h-3.5 w-3.5" />
                        QA {qaSummary.score}/100 · {DUBBING_QA_VERDICT_LABELS[qaSummary.verdict]}
                      </Link>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Link href={`/jobs/${job.id}`}>
                      <Button variant="outline" size="sm">
                        运行日志
                      </Button>
                    </Link>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => handleDelete(job.id)}
                          className="text-red-600 focus:text-red-600"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          删除任务
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardHeader>

                <CardContent className="space-y-5">
                  {/* Scheme 3: 增强错误信息显示
                      Codex 後續審查 P1 修復：長 yt-dlp / ffmpeg 命令錯誤訊息會撐爆 mobile viewport（390px → 477px）。
                      用 min-w-0 讓 flex child 可以縮小 + break-words / overflow-wrap-anywhere 強制長字串斷行。 */}
                  {job.error_message && (
                    <div className="flex min-w-0 items-start gap-2 rounded-lg border border-rose-200 bg-rose-50/80 p-3 text-sm text-rose-600 space-y-1">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      <div className="flex-1 min-w-0 space-y-1 [overflow-wrap:anywhere]">
                        <p className="break-words">
                          <span className="font-medium">错误：</span> {job.error_message}
                        </p>

                        {/* 显示用户指导 */}
                        {job.error_metadata?.userGuidance && (
                          <p className="text-xs text-rose-700 flex items-start gap-1 break-words">
                            <span className="font-semibold shrink-0">💡</span>
                            <span className="min-w-0">{job.error_metadata.userGuidance}</span>
                          </p>
                        )}

                        {/* 配置错误时提供设置链接 */}
                        {job.error_metadata?.category === 'config' && (
                          <a
                            href="/settings"
                            className="text-xs text-blue-600 hover:text-blue-800 underline block"
                          >
                            → 前往设置页面检查 API 密钥
                          </a>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="grid gap-3 text-sm text-claude-dark-400 md:grid-cols-3">
                    <div className="flex flex-col gap-1">
                      <span className="text-xs uppercase tracking-wide text-claude-dark-400">
                        创建时间
                      </span>
                      <span className="font-medium text-claude-dark-900">
                        {formatDate(job.created_at)}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-xs uppercase tracking-wide text-claude-dark-400">
                        任务类型
                      </span>
                      <span className="font-medium text-claude-dark-900">
                        {getJobKindWithScopeLabel(job)}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-xs uppercase tracking-wide text-claude-dark-400">
                        处理时长
                      </span>
                      <span className="font-medium text-claude-dark-900">
                        {formatDuration(job.started_at, job.completed_at)}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* 分页器 */}
      {totalJobs > 0 && (
        <div className="mt-6">
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={handlePageChange}
            totalItems={totalJobs}
            pageSize={pageSize}
            showQuickJumper={totalPages > 5}
          />
        </div>
      )}
    </section>
  )
}
