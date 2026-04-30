import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * Vitest 配置文件
 *
 * 用途：
 * - 单元测试和集成测试配置
 * - 路径别名映射（@/* → ./）
 * - 代码覆盖率收集
 * - 测试环境配置（Node.js 和 JSDOM）
 *
 * 测试命令：
 * - pnpm test:unit        # 运行所有单元测试和集成测试
 * - pnpm test:watch       # 监听模式
 * - pnpm test:coverage    # 生成覆盖率报告
 * - pnpm test:ui          # 启动 Vitest UI 界面
 */
export default defineConfig({
  plugins: [react()],

  test: {
    // 全局测试配置
    globals: true,

    // 默认测试环境（Node.js）
    // React 组件测试文件应在文件顶部添加 @vitest-environment jsdom 注释
    environment: 'node',

    // 测试文件匹配规则
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],

    // 排除 E2E 测试（由 Playwright 执行）
    exclude: ['node_modules', 'dist', '.next', 'tests/e2e/**/*', '**/*.spec.ts'],

    // 测试启动前执行的配置文件
    setupFiles: ['./tests/setup/vitest-setup.ts'],

    // 代码覆盖率配置
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './docs/test-reports/coverage',

      // 包含的文件（仅统计业务代码，包含 TypeScript 和 React 组件）
      include: ['lib/**/*.{ts,tsx}', 'app/**/*.{ts,tsx}'],

      // 排除的文件
      exclude: [
        'lib/**/*.d.ts',
        'lib/**/*.test.ts',
        'lib/**/index.ts',
        'app/**/layout.tsx',
        'app/**/page.tsx',
        'types/**/*',
        'scripts/**/*',
        '**/*.config.ts',
      ],

      // 覆盖率阈值（低于阈值会失败）
      thresholds: {
        lines: 70, // 行覆盖率 ≥ 70%
        functions: 70, // 函数覆盖率 ≥ 70%
        branches: 60, // 分支覆盖率 ≥ 60%
        statements: 70, // 语句覆盖率 ≥ 70%
      },
    },

    // 测试超时设置（毫秒）
    testTimeout: 10000, // 单个测试超时 10 秒
    hookTimeout: 10000, // Hook 超时 10 秒

    // 测试隔离配置
    isolate: true, // 每个测试文件独立进程运行

    // 失败时输出更多信息
    reporters: ['verbose'],
  },

  // 路径别名（与 tsconfig.json 保持一致）
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
})
