'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useState, useTransition } from 'react'
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@/components/ui'

/**
 * 登录表单组件（内部使用 useSearchParams）
 */
function LoginForm() {
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const [formData, setFormData] = useState({
    username: '',
    password: '',
  })
  const [error, setError] = useState('')

  // 获取重定向地址（登录前访问的页面）
  const redirectUrl = searchParams.get('redirect') || '/'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // 客户端验证
    if (!formData.username.trim()) {
      setError('请输入用户名')
      return
    }

    if (!formData.password) {
      setError('请输入密码')
      return
    }

    // 提交登录请求
    startTransition(async () => {
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        })

        const data = await res.json()

        if (!res.ok) {
          setError(data.error || '登录失败，请检查用户名和密码')
          return
        }

        // 登录成功，使用硬跳转确保 cookie 生效
        // 注意：不能用 router.push()，因为软导航可能在 cookie 写入前就发出请求
        window.location.href = redirectUrl
      } catch {
        setError('网络错误，请稍后重试')
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>登录</CardTitle>
        <CardDescription>进入内容生产工作台</CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 错误提示 */}
          {error && (
            <div className="p-3 text-sm bg-red-50 border border-red-200 text-red-700 rounded-md">
              {error}
            </div>
          )}

          {/* 用户名 */}
          <div className="space-y-2">
            <Label htmlFor="username">用户名</Label>
            <Input
              id="username"
              type="text"
              placeholder="请输入用户名"
              value={formData.username}
              onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              disabled={isPending}
              autoComplete="username"
              autoFocus
            />
          </div>

          {/* 密码 */}
          <div className="space-y-2">
            <Label htmlFor="password">密码</Label>
            <Input
              id="password"
              type="password"
              placeholder="请输入密码"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              disabled={isPending}
              autoComplete="current-password"
            />
          </div>

          {/* 提交按钮 */}
          <Button type="submit" variant="primary" className="w-full" disabled={isPending}>
            {isPending ? '登录中...' : '登录'}
          </Button>
        </form>
      </CardContent>

      <CardFooter className="flex flex-col space-y-2">
        <p className="text-sm text-center text-claude-dark-500">
          首次使用？
          <Link
            href="/register"
            className="ml-1 text-claude-orange-600 hover:text-claude-orange-700 font-medium"
          >
            立即注册
          </Link>
        </p>
      </CardFooter>
    </Card>
  )
}

/**
 * 登录页面（包裹 Suspense）
 *
 * 功能：
 * - 用户名和密码登录
 * - 表单验证
 * - 错误提示
 * - 登录成功后重定向
 */
export default function LoginPage() {
  return (
    <Suspense fallback={<div className="text-center">加载中...</div>}>
      <LoginForm />
    </Suspense>
  )
}
