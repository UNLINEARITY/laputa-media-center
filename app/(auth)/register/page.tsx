'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import {
  Badge,
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
 * 密码强度计算
 */
function calculatePasswordStrength(password: string): {
  level: 'weak' | 'medium' | 'strong'
  label: string
  color: string
} {
  if (!password) {
    return { level: 'weak', label: '弱', color: 'text-red-600' }
  }

  let score = 0

  // 长度评分
  if (password.length >= 8) score += 1
  if (password.length >= 12) score += 1

  // 复杂度评分
  if (/[a-z]/.test(password)) score += 1 // 小写字母
  if (/[A-Z]/.test(password)) score += 1 // 大写字母
  if (/[0-9]/.test(password)) score += 1 // 数字
  if (/[^a-zA-Z0-9]/.test(password)) score += 1 // 特殊符号

  if (score <= 2) {
    return { level: 'weak', label: '弱', color: 'text-red-600' }
  }
  if (score <= 4) {
    return { level: 'medium', label: '中', color: 'text-yellow-600' }
  }
  return { level: 'strong', label: '强', color: 'text-green-600' }
}

/**
 * 注册页面
 *
 * 功能：
 * - 用户名和密码注册
 * - 密码强度指示器
 * - 密码一致性验证
 * - 表单验证
 * - 单用户模式提示
 */
export default function RegisterPage() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [formData, setFormData] = useState({
    username: '',
    password: '',
    confirmPassword: '',
  })
  const [error, setError] = useState('')

  // 密码强度计算
  const passwordStrength = useMemo(
    () => calculatePasswordStrength(formData.password),
    [formData.password],
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // 客户端验证
    if (!formData.username.trim()) {
      setError('请输入用户名')
      return
    }

    if (formData.username.length < 3 || formData.username.length > 32) {
      setError('用户名长度必须在 3-32 个字符之间')
      return
    }

    if (!formData.password) {
      setError('请输入密码')
      return
    }

    if (formData.password.length < 8) {
      setError('密码长度至少 8 位')
      return
    }

    if (formData.password !== formData.confirmPassword) {
      setError('两次输入的密码不一致')
      return
    }

    // 提交注册请求
    startTransition(async () => {
      try {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: formData.username,
            password: formData.password,
          }),
        })

        const data = await res.json()

        if (!res.ok) {
          setError(data.error || '注册失败')
          return
        }

        // 注册成功，自动登录并重定向
        router.push('/')
        router.refresh()
      } catch {
        setError('网络错误，请稍后重试')
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>注册</CardTitle>
        <CardDescription>创建内容工作台管理员账号</CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 单用户模式提示 */}
          <div className="p-3 text-sm bg-claude-orange-50 border border-claude-orange-200 text-claude-orange-800 rounded-md">
            ⚠️ 单用户模式：系统仅允许注册一个管理员账号
          </div>

          {/* 错误提示 */}
          {error && (
            <div className="p-3 text-sm bg-red-50 border border-red-200 text-red-700 rounded-md">
              {error}
            </div>
          )}

          {/* 用户名 */}
          <div className="space-y-2">
            <Label htmlFor="username">
              用户名
              <span className="ml-1 text-xs text-claude-dark-400">(3-32 字符)</span>
            </Label>
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
            <Label htmlFor="password">
              密码
              <span className="ml-1 text-xs text-claude-dark-400">(最小 8 位)</span>
            </Label>
            <Input
              id="password"
              type="password"
              placeholder="请输入密码"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              disabled={isPending}
              autoComplete="new-password"
            />

            {/* 密码强度指示器 */}
            {formData.password && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-claude-dark-500">密码强度：</span>
                <Badge
                  variant={
                    passwordStrength.level === 'strong'
                      ? 'success'
                      : passwordStrength.level === 'medium'
                        ? 'warning'
                        : 'destructive'
                  }
                >
                  {passwordStrength.label}
                </Badge>
              </div>
            )}
          </div>

          {/* 确认密码 */}
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">确认密码</Label>
            <Input
              id="confirmPassword"
              type="password"
              placeholder="请再次输入密码"
              value={formData.confirmPassword}
              onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
              disabled={isPending}
              autoComplete="new-password"
            />
          </div>

          {/* 提交按钮 */}
          <Button type="submit" variant="primary" className="w-full" disabled={isPending}>
            {isPending ? '注册中...' : '注册'}
          </Button>
        </form>
      </CardContent>

      <CardFooter className="flex flex-col space-y-2">
        <p className="text-sm text-center text-claude-dark-500">
          已有账号？
          <Link
            href="/login"
            className="ml-1 text-claude-orange-600 hover:text-claude-orange-700 font-medium"
          >
            返回登录
          </Link>
        </p>
      </CardFooter>
    </Card>
  )
}
