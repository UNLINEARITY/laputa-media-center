/**
 * API 响应工具函数
 * 用于统一处理 no-cache headers，确保数据实时性
 */

import { NextResponse } from 'next/server'

/**
 * 创建禁用缓存的 JSON 响应
 * Next.js 15 + React 19 动态数据最佳实践
 */
export function noCacheResponse<T>(data: T, init?: ResponseInit): NextResponse<T> {
  return NextResponse.json(data, {
    ...init,
    headers: {
      ...init?.headers,
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    },
  })
}
