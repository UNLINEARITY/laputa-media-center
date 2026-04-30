import { ArrowLeft, FileQuestion, Home } from 'lucide-react'
import Link from 'next/link'
import { Button, Card } from '@/components/ui'

/**
 * 任务不存在 404 页面
 * 当访问不存在的任务 ID 时显示
 */
export default function NotFound() {
  return (
    <div className="min-h-screen bg-linear-to-br from-claude-cream-50/30 via-white to-claude-cream-100/50 flex items-center justify-center px-4 py-12">
      <Card className="max-w-lg w-full p-12 text-center shadow-xl border-claude-cream-200/60">
        {/* 图标 */}
        <div className="mb-8 flex justify-center">
          <div className="relative">
            <div className="absolute inset-0 bg-claude-orange-400/20 blur-2xl rounded-full" />
            <div className="relative h-28 w-28 rounded-full bg-linear-to-br from-claude-orange-100 to-claude-orange-50 flex items-center justify-center border-2 border-claude-orange-200/50 shadow-lg">
              <FileQuestion className="h-14 w-14 text-claude-orange-600" strokeWidth={1.5} />
            </div>
          </div>
        </div>

        {/* 标题 */}
        <h1 className="text-4xl font-bold text-claude-dark-900 mb-3 tracking-tight">任务不存在</h1>

        {/* 404 数字 */}
        <div className="text-7xl font-black text-claude-orange-200/40 mb-6 tracking-wider">404</div>

        {/* 描述 */}
        <p className="text-base text-claude-dark-400 mb-10 leading-relaxed max-w-sm mx-auto">
          抱歉,您访问的任务不存在或已被删除。
          <br />
          请检查任务 ID 是否正确。
        </p>

        {/* 操作按钮 */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/jobs">
            <Button
              size="lg"
              className="w-full sm:w-auto shadow-md hover:shadow-lg transition-shadow"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              返回任务列表
            </Button>
          </Link>
          <Link href="/">
            <Button
              variant="outline"
              size="lg"
              className="w-full sm:w-auto border-claude-cream-300 hover:bg-claude-cream-50"
            >
              <Home className="mr-2 h-4 w-4" />
              返回首页
            </Button>
          </Link>
        </div>
      </Card>
    </div>
  )
}
