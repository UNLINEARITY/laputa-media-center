'use client'

import { ClipboardCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui'

interface QaBackfillButtonProps {
  limit?: number
}

interface BackfillResponse {
  success?: boolean
  result?: {
    scanned: number
    eligible: number
    created: number
    skipped: number
    failed: number
  }
  error?: string
}

export function QaBackfillButton({ limit = 50 }: QaBackfillButtonProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function handleClick() {
    startTransition(async () => {
      try {
        const response = await fetch('/api/jobs/qa/backfill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ limit }),
        })
        const data = (await response.json().catch(() => ({}))) as BackfillResponse

        if (!response.ok || !data.success || !data.result) {
          throw new Error(data.error || '补齐质检摘要失败')
        }

        toast.success(`已补齐 ${data.result.created} 条质检摘要，跳过 ${data.result.skipped} 条。`)
        router.refresh()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '补齐质检摘要失败')
      }
    })
  }

  return (
    <Button type="button" variant="outline" onClick={handleClick} disabled={isPending}>
      <ClipboardCheck className="mr-2 h-4 w-4" />
      {isPending ? '补齐中' : '补齐质检'}
    </Button>
  )
}
