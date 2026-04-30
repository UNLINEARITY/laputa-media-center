'use client'

import { User } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ChineseScriptToggle } from '@/components/i18n/chinese-script-toggle'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui'
import { cn } from '@/lib/utils/cn'
import { SiteLogo } from './site-logo'

/**
 * 鉴权状态类型
 */
interface AuthStatus {
  isAuthenticated: boolean
  username: string | null
}

export function Header() {
  const pathname = usePathname()
  const router = useRouter()

  const [authStatus, setAuthStatus] = useState<AuthStatus>({
    isAuthenticated: false,
    username: null,
  })

  const navItems = [
    { href: '/', label: '总控台', active: ['/'] },
    { href: '/ingest', label: '素材', active: ['/ingest'] },
    { href: '/dubbing', label: '转译', active: ['/dubbing'] },
    { href: '/jobs', label: '任务', active: ['/jobs'] },
    { href: '/settings', label: '设置', active: ['/settings'] },
    { href: '/guide', label: '指南', active: ['/guide'] },
  ]

  // 获取登录状态（路由变化时重新检查，确保多标签页场景下状态同步）
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname 用于路由变化时重新获取状态
  useEffect(() => {
    const fetchAuthStatus = async () => {
      try {
        const res = await fetch('/api/auth/status')
        if (res.ok) {
          const data = await res.json()
          setAuthStatus({
            isAuthenticated: data.isAuthenticated,
            username: data.username,
          })
        }
      } catch {
        // 静默处理
      }
    }

    fetchAuthStatus()
  }, [pathname])

  // 退出登录
  const handleLogout = async () => {
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' })
      if (res.ok) {
        router.push('/login')
        router.refresh()
      }
    } catch {
      // 静默处理
    }
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b border-claude-cream-200 bg-white/95 backdrop-blur-xl shadow-xs shadow-claude-cream-200/50 supports-backdrop-filter:bg-white/90">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-3 sm:px-6 lg:px-8">
        <SiteLogo />

        <div className="flex items-center gap-2 sm:gap-4">
          {/* 导航菜单 */}
          <nav className="hidden items-center gap-1 text-sm font-medium sm:flex">
            {navItems.map((item) => {
              const isActive = item.active.some(
                (activePath) =>
                  pathname === activePath ||
                  (activePath !== '/' && pathname.startsWith(`${activePath}/`)),
              )
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center justify-center rounded-full px-3 py-2 transition-colors',
                    isActive
                      ? 'bg-claude-dark-900 text-white shadow-xs dark:bg-claude-cream-100 dark:text-claude-dark-900'
                      : 'text-claude-dark-400 hover:bg-claude-cream-100 hover:text-claude-dark-900 dark:text-claude-dark-300 dark:hover:bg-claude-dark-800 dark:hover:text-white',
                  )}
                >
                  {item.label}
                </Link>
              )
            })}
          </nav>

          <ChineseScriptToggle />

          {/* 用户菜单 / 登录按钮（始终显示） */}
          {authStatus.isAuthenticated ? (
            // 已登录：显示用户菜单
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <User className="h-4 w-4" />
                  {authStatus.username || '用户'}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleLogout}>退出登录</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            // 未登录：显示登录按钮
            <div className="flex items-center gap-1.5 sm:gap-2">
              <Link href="/login">
                <Button variant="outline" size="sm">
                  登录
                </Button>
              </Link>
              <Link href="/register">
                <Button variant="primary" size="sm">
                  注册
                </Button>
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
