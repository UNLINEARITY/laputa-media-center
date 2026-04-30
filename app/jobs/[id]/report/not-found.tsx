import { FileX } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui'

export default function ReportNotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-linear-to-br from-claude-cream-50/30 via-white to-claude-cream-100/50">
      <div className="text-center">
        <FileX className="mx-auto h-16 w-16 text-claude-dark-400" />
        <h1 className="mt-4 text-2xl font-semibold text-claude-dark-800">任务报告不存在</h1>
        <p className="mt-2 text-claude-dark-500">该任务可能已被删除或从未创建</p>
        <Link href="/jobs" className="mt-6 inline-block">
          <Button variant="outline">返回任务列表</Button>
        </Link>
      </div>
    </div>
  )
}
