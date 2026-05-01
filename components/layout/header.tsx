'use client'

import { ChevronDown, Menu, User } from 'lucide-react'
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
import { getHeaderToolItems } from '@/lib/product/tool-catalog'
import { cn } from '@/lib/utils/cn'
import { SiteLogo } from './site-logo'

/**
 * 鉴权状态类型
 */
interface AuthStatus {
  authEnabled: boolean
  isAuthenticated: boolean
  username: string | null
}

type AuthStatusState = AuthStatus & {
  loaded: boolean
}

/**
 * 4 個自媒體工具（Phase 3.C 新工具，nav 二級入口）。
 * 數據來自 tool-catalog normal form — 不在這裡硬編碼，避免跟首頁 dashboard
 * 工具卡 / `/ingest` 處理目標等表面分類各寫一份。
 */
const TOOL_ITEMS = getHeaderToolItems()

export function Header() {
  const pathname = usePathname()
  const router = useRouter()

  const [authStatus, setAuthStatus] = useState<AuthStatusState>({
    authEnabled: false,
    isAuthenticated: false,
    username: null,
    loaded: false,
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
            authEnabled: data.authEnabled !== false,
            isAuthenticated: data.isAuthenticated,
            username: data.username,
            loaded: true,
          })
        }
      } catch {
        setAuthStatus((current) => ({ ...current, loaded: true }))
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

  // 工具下拉是否高亮（pathname 在 4 個工具任一）
  const toolsActive = TOOL_ITEMS.some(
    (t) => pathname === t.href || pathname.startsWith(`${t.href}/`),
  )

  return (
    <header className="sticky top-0 z-50 w-full border-b border-claude-cream-200 bg-white/95 backdrop-blur-xl shadow-xs shadow-claude-cream-200/50 supports-backdrop-filter:bg-white/90">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-3 sm:px-6 lg:px-8">
        <SiteLogo />

        <div className="flex items-center gap-2 sm:gap-4">
          {/* 手機版漢堡導航（mobile only）— Codex 後續審查 P1 修復：之前 hidden sm:flex 隱藏 nav 但無 mobile replacement
              復用同一份 navItems + TOOL_ITEMS normal form，不另寫散列 */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="打开导航菜单"
                className="flex h-9 w-9 items-center justify-center rounded-md text-claude-dark-500 hover:bg-claude-cream-100 hover:text-claude-dark-900 sm:hidden"
              >
                <Menu className="h-5 w-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {navItems.map((item) => {
                const isActive = item.active.some(
                  (activePath) =>
                    pathname === activePath ||
                    (activePath !== '/' && pathname.startsWith(`${activePath}/`)),
                )
                return (
                  <DropdownMenuItem
                    key={item.href}
                    onClick={() => router.push(item.href)}
                    className={cn(
                      'py-2 text-sm',
                      isActive ? 'font-medium text-claude-dark-900' : 'text-claude-dark-500',
                    )}
                  >
                    {item.label}
                  </DropdownMenuItem>
                )
              })}
              {/* 分隔線 + 4 工具子分組 */}
              <div className="my-1 h-px bg-claude-cream-200" />
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-claude-dark-400">
                工具
              </div>
              {TOOL_ITEMS.map((tool) => (
                <DropdownMenuItem
                  key={tool.href}
                  onClick={() => router.push(tool.href)}
                  className="flex flex-col items-start gap-0.5 py-2"
                >
                  <span className="text-sm font-medium text-claude-dark-700">{tool.label}</span>
                  <span className="text-[11px] text-claude-dark-400">{tool.shortDescription}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* 桌面導航菜單 */}
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
            {/* 工具下拉：4 個 Phase 3.C 自媒體工具 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    'flex items-center justify-center gap-1 rounded-full px-3 py-2 transition-colors',
                    toolsActive
                      ? 'bg-claude-dark-900 text-white shadow-xs'
                      : 'text-claude-dark-400 hover:bg-claude-cream-100 hover:text-claude-dark-900',
                  )}
                >
                  工具 <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                {TOOL_ITEMS.map((tool) => (
                  <DropdownMenuItem
                    key={tool.href}
                    onClick={() => router.push(tool.href)}
                    className="flex flex-col items-start gap-0.5 py-2"
                  >
                    <span className="text-sm font-medium text-claude-dark-700">{tool.label}</span>
                    <span className="text-[11px] text-claude-dark-400">
                      {tool.shortDescription}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </nav>

          <ChineseScriptToggle />

          {/* 用户菜单 / 登录按钮 — AUTH disabled 時不顯示，避免朋友以為必須註冊 */}
          {!authStatus.authEnabled ? (
            authStatus.loaded ? (
              // 本地免登錄模式：顯示 badge 而非登入按鈕
              <span className="hidden items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 sm:inline-flex">
                本地模式
              </span>
            ) : (
              <span className="hidden h-7 w-20 sm:inline-flex" aria-hidden="true" />
            )
          ) : authStatus.isAuthenticated ? (
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
            // 未登录 + AUTH 開啟：显示登录按钮
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
