import type { Metadata } from 'next'

/**
 * 鉴权页面布局
 *
 * 特点：
 * - 简洁布局，无 Header 和 Footer
 * - 居中显示鉴权表单
 * - 品牌配色和背景
 */

export const metadata: Metadata = {
  title: '登录 - Laputa 内容引擎',
  description: '自媒体内容生产工作台 - 用户登录',
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-claude-cream-50 via-white to-claude-orange-50 p-4">
      <div className="w-full max-w-md">
        {/* 品牌 Logo 和标题 */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-claude-dark-700 mb-2">Laputa 内容引擎</h1>
          <p className="text-sm text-claude-dark-500">文本、播客、短视频与外语素材本地化</p>
        </div>

        {/* 表单内容 */}
        {children}

        {/* 页脚 */}
        <div className="mt-8 text-center text-xs text-claude-dark-400">
          <p>Laputa 内容工作室</p>
        </div>
      </div>
    </div>
  )
}
