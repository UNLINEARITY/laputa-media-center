import type { NextConfig } from 'next'

const useStandaloneOutput =
  process.env.NEXT_OUTPUT_STANDALONE !== undefined
    ? process.env.NEXT_OUTPUT_STANDALONE !== 'false'
    : process.platform !== 'win32'

const nextConfig: NextConfig = {
  // Windows local builds often fail when Next.js creates standalone symlinks.
  // Docker/Linux builds keep standalone output by default.
  output: useStandaloneOutput ? 'standalone' : undefined,

  outputFileTracingExcludes: {
    '/*': ['./next.config.ts'],
  },

  // TypeScript 类型检查
  typescript: {
    ignoreBuildErrors: false,
  },

  // ✅ 移除 onDemandEntries（Next.js 16 + Turbopack 不需要）
  // Next.js 16 默认使用 Turbopack，有更智能的缓存机制
  // 旧的 onDemandEntries 配置会导致页面在 60 秒后异常刷新

  experimental: {
    // Proxy 请求体大小限制（视频上传最大 500MB）
    // Next.js 16 proxy.ts 会拦截所有请求，默认限制 10MB
    // 参考：https://nextjs.org/docs/app/api-reference/config/next-config-js/proxyClientMaxBodySize
    proxyClientMaxBodySize: '500mb',
  },

  // 开发环境跨域配置：允许内网 IP 访问（Next.js 15.2+）
  // 格式：只需域名/IP，不含协议和端口
  allowedDevOrigins: [
    '192.168.9.167',
    '192.168.*.*', // 通配符匹配整个内网段
  ],

  // 备用方案：如果上述配置无效，可以在 proxy.ts 中添加 CORS 头

  // Turbopack 配置（Next.js 16.0+ 稳定）
  turbopack: {
    root: process.cwd(),
  },

  // Webpack 开发环境优化：排除非源码目录监听，防止工作流产生的文件触发重编译
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        ignored: [
          '**/node_modules/**',
          '**/logs/**',
          '**/data/**',
          '**/temp/**',
          '**/output/**',
          '**/*.db',
          '**/*.db-journal',
        ],
      }
    }
    return config
  },
}

export default nextConfig
