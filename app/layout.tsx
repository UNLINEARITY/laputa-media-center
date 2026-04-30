import type { Metadata } from 'next'
import './globals.css'
import { Toaster } from 'sonner'
import { ConfirmDialogProvider } from '@/components/dialogs/use-confirm-dialog'
import { ChineseScriptProvider } from '@/components/i18n/chinese-script-provider'
import { Footer } from '@/components/layout/footer'
import { Header } from '@/components/layout/header'

export const metadata: Metadata = {
  title: 'Laputa 内容引擎 - AI 自媒体内容生产',
  description:
    'Laputa 内容引擎 - 将文本、外语视频和人物资产转成播客、短视频、AI 配音、字幕和口型同步成片。',
  icons: {
    icon: '/icon.png',
    shortcut: '/icon.png',
    apple: '/icon.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased bg-linear-to-br from-claude-cream-50 via-white to-claude-cream-100/80 text-claude-dark-900">
        <ConfirmDialogProvider>
          <ChineseScriptProvider>
            <div className="flex min-h-screen flex-col">
              <Header />
              <main className="flex-1">{children}</main>
              <Footer />
            </div>
            <Toaster position="top-center" richColors />
          </ChineseScriptProvider>
        </ConfirmDialogProvider>
      </body>
    </html>
  )
}
