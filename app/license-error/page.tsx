'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function LicenseErrorContent() {
  const searchParams = useSearchParams()
  const error = searchParams.get('error') || '授权验证失败'

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-red-50 to-orange-50">
      <div className="max-w-md w-full mx-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
          {/* 图标 */}
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-red-100 flex items-center justify-center">
            <svg
              className="w-10 h-10 text-red-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m0 0v2m0-2h2m-2 0H10m4-6V5a2 2 0 00-2-2H8a2 2 0 00-2 2v4m8 0H6m8 0h2a2 2 0 012 2v8a2 2 0 01-2 2H6a2 2 0 01-2-2v-8a2 2 0 012-2h2"
              />
            </svg>
          </div>

          {/* 标题 */}
          <h1 className="text-2xl font-bold text-gray-900 mb-2">授权验证失败</h1>

          {/* 错误信息 */}
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <p className="text-red-700 font-medium">{error}</p>
          </div>

          {/* 说明 */}
          <div className="text-left space-y-4 mb-6">
            <div className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-sm font-bold">
                1
              </span>
              <div>
                <p className="text-gray-700 font-medium">获取授权码</p>
                <p className="text-gray-500 text-sm">联系LaputaMediaCenter获取有效的授权码</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-sm font-bold">
                2
              </span>
              <div>
                <p className="text-gray-700 font-medium">配置环境变量</p>
                <p className="text-gray-500 text-sm">
                  在 .env.local 中设置 <code className="bg-gray-100 px-1 rounded">LICENSE_KEY</code>
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-sm font-bold">
                3
              </span>
              <div>
                <p className="text-gray-700 font-medium">重启服务</p>
                <p className="text-gray-500 text-sm">配置完成后重启应用即可正常使用</p>
              </div>
            </div>
          </div>

          {/* 授权码格式 */}
          <div className="bg-gray-50 rounded-lg p-4 mb-6">
            <p className="text-gray-600 text-sm mb-2">授权码格式示例：</p>
            <code className="text-gray-800 font-mono bg-white px-3 py-1 rounded border">
              XXXX-XXXXXXXX-XXXX
            </code>
          </div>

          {/* 联系方式 */}
          <div className="text-gray-500 text-sm">
            <p>
              如需帮助，请联系 <span className="text-blue-600 font-medium">LaputaMediaCenter</span>
            </p>
          </div>
        </div>

        {/* 版权信息 */}
        <p className="text-center text-gray-400 text-sm mt-6">
          Laputa 内容引擎 — LaputaMediaCenter
        </p>
      </div>
    </div>
  )
}

export default function LicenseErrorPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
        </div>
      }
    >
      <LicenseErrorContent />
    </Suspense>
  )
}
