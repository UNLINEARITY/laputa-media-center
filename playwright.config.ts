import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

const e2ePort = process.env.PLAYWRIGHT_PORT || '3899'
const e2eBaseUrl = `http://localhost:${e2ePort}`
const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_SERVER === 'true'
const e2eRunId = process.env.PLAYWRIGHT_RUN_ID || 'no-paid-mainline'
const e2eDatabaseUrl =
  process.env.PLAYWRIGHT_DATABASE_URL ||
  path.resolve(process.cwd(), 'tmp', 'playwright-e2e', `${e2eRunId}.sqlite`)
const e2eRuntimeDir =
  process.env.PLAYWRIGHT_RUNTIME_DIR ||
  path.resolve(process.cwd(), 'tmp', 'playwright-runtime', e2eRunId)
const e2eTempDir = process.env.PLAYWRIGHT_TEMP_DIR || path.join(e2eRuntimeDir, 'temp')
const e2eOutputDir = process.env.PLAYWRIGHT_OUTPUT_DIR || path.join(e2eRuntimeDir, 'output')

process.env.DATABASE_URL = e2eDatabaseUrl
process.env.RUNTIME_DIR = e2eRuntimeDir
process.env.TEMP_DIR = e2eTempDir
process.env.OUTPUT_DIR = e2eOutputDir

/**
 * Playwright 端到端测试配置文件
 *
 * 用途：
 * - 配置 E2E 测试环境
 * - 定义浏览器类型和设备
 * - 配置测试服务器和报告
 *
 * 测试命令：
 * - pnpm test:e2e       # 运行所有 E2E 测试
 * - pnpm test:e2e:ui    # 启动 Playwright UI 界面（可视化调试）
 *
 * 文档：https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  // 测试文件目录
  testDir: './tests/e2e',

  // 测试输出目录（截图、视频、trace 等）
  outputDir: './docs/test-reports/e2e-results',

  // 完全并行运行测试（更快但需要更多资源）
  fullyParallel: true,

  // CI 环境中禁止使用 test.only（防止意外提交）
  forbidOnly: !!process.env.CI,

  // CI 环境中自动重试失败的测试（减少 flaky test 影响）
  retries: process.env.CI ? 2 : 0,

  // 并发执行的测试数量（CI 环境中使用单线程避免资源竞争）
  workers: process.env.CI ? 1 : undefined,

  // 测试报告配置
  reporter: [
    // HTML 报告（浏览器查看）
    ['html', { outputFolder: 'docs/test-reports/playwright-html' }],
    // 列表报告（终端输出）
    ['list'],
    // JSON 报告（用于 CI/CD 集成）
    ['json', { outputFile: 'docs/test-reports/e2e-results.json' }],
  ],

  // 全局测试配置
  use: {
    // 应用基础 URL
    baseURL: e2eBaseUrl,

    // 失败时自动重试时记录 trace（用于调试）
    trace: 'on-first-retry',

    // 失败时截图
    screenshot: 'only-on-failure',

    // 失败时保留视频
    video: 'retain-on-failure',

    // 浏览器上下文配置
    contextOptions: {
      // 忽略 HTTPS 错误（开发环境）
      ignoreHTTPSErrors: true,
    },

    // 导航超时（30 秒）
    navigationTimeout: 30000,

    // 操作超时（10 秒）
    actionTimeout: 10000,
  },

  // 测试项目配置（不同浏览器）
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    // 可选：其他浏览器测试（暂时注释，需要时启用）
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] }
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] }
    // },

    // 可选：移动浏览器测试
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] }
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] }
    // }
  ],

  // 测试前启动开发服务器
  webServer: {
    command: `node --max-old-space-size=4096 node_modules/next/dist/bin/next dev -p ${e2ePort}`,
    env: {
      ALLOW_PAID_DYNAMIC_TESTS: 'false',
      ALLOW_STRESS_DYNAMIC_TESTS: 'false',
      AUTH_ENABLED: 'false',
      DATABASE_URL: e2eDatabaseUrl,
      DUBBING_REQUIRE_REAL_MINIMAX_TTS: 'false',
      GEMINI_API_KEY: '',
      GOOGLE_AI_STUDIO_API_KEY: '',
      GOOGLE_APPLICATION_CREDENTIALS: '',
      GOOGLE_CLOUD_PROJECT: '',
      GCS_BUCKET: '',
      MINIMAX_API_KEY: '',
      NEXT_TELEMETRY_DISABLED: '1',
      OUTPUT_DIR: e2eOutputDir,
      RUNTIME_DIR: e2eRuntimeDir,
      TEMP_DIR: e2eTempDir,
    },
    url: e2eBaseUrl,
    // 默认不复用任意本地服务，避免 .env.local 鉴权/付费 gate 污染视觉 smoke。
    // 手动调试已确认服务环境时，可设置 PLAYWRIGHT_REUSE_SERVER=true。
    reuseExistingServer,
    // 服务器启动超时（2 分钟）
    timeout: 120000,
    // 等待服务器返回 200 状态码
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
