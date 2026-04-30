import { expect, type Page, type TestInfo, test } from '@playwright/test'
import { convertChineseScript } from '../../lib/i18n/chinese-script'
import {
  MAINLINE_FIXTURE_IDS,
  readMainlineFixtureConfig,
  readMainlineFixtureStepContext,
  seedMainlineVisualSmokeFixture,
} from './mainline-fixtures'

const CHINESE_SCRIPT_STORAGE_KEY = 'laputa:chinese-script'

const MAINLINE_ROUTES = [
  { path: '/', anchor: '总控台' },
  { path: '/ingest', anchor: '导入素材' },
  { path: '/dubbing', anchor: '转译配音工作台' },
  { path: '/jobs', anchor: '任务控制台' },
] as const

const DOWNSTREAM_ROUTES = [
  {
    path: `/jobs/${MAINLINE_FIXTURE_IDS.full}`,
    anchor: '任务运行日志',
    anchors: ['转译配音交付', '自动质检', '本次套用资产', '口播稿预览'],
  },
  {
    path: `/jobs/${MAINLINE_FIXTURE_IDS.sample}/qa`,
    anchor: '质检报告',
    anchors: ['修稿前扫描', '自动质检分', '建议下一步', '重跑前确认', 'QA JSON'],
  },
  {
    path: `/jobs/${MAINLINE_FIXTURE_IDS.full}/compare`,
    anchor: '版本比较',
    anchors: ['修稿版本链', '本次差异', 'QA 结果差异', '沉淀到长期资产', '固定读法'],
  },
  {
    path: `/jobs/${MAINLINE_FIXTURE_IDS.full}/report`,
    anchor: '任务报告',
    anchors: ['交付包', '配音上下文', '执行步骤历史', 'API 调用记录', '任务总结'],
  },
  {
    path: '/settings',
    anchor: '密钥与服务设置',
    anchors: ['系统设置', 'MiniMax 配音', 'API Token 管理'],
  },
] as const

const LEGACY_MAINLINE_PATTERNS = [
  /\/styles/,
  /style_id/,
  /storyboard_count/,
  /全自动视频剪辑工具/,
  /创建剪辑任务/,
  /选择剪辑风格/,
  /单视频剪辑/,
  /多视频混剪/,
  /批量旁白/,
  /完整分镜数据/,
  /分镜脚本详情/,
  /分镜处理统计/,
  /Fish Audio 调用/,
  /旧剪辑 TTS 配置/,
  /执行清理/,
  /深度清理/,
  /确认删除/,
]

const VIEWPORTS = [
  { name: 'desktop', width: 1365, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const

type VisualIssue = {
  tagName: string
  text: string
  detail: string
}

type RootOverflowIssue = VisualIssue & {
  left: number
  right: number
  width: number
}

type DeliveryEvidencePayload = {
  id: string
  status: string
  summary: string
  detail?: string
}

type JobDetailPayload = {
  deliveryPackage?: {
    deliveryAuditReadiness?: {
      ready: boolean
      status: string
      label: string
    }
    deliveryEvidence?: DeliveryEvidencePayload[]
  } | null
}

async function setScriptMode(page: Page, mode: 'simplified' | 'traditional') {
  await page.evaluate(
    ([storageKey, nextMode]) => {
      window.localStorage.setItem(storageKey, nextMode)
    },
    [CHINESE_SCRIPT_STORAGE_KEY, mode] as const,
  )
}

async function waitForQuietPage(page: Page) {
  await page.waitForLoadState('domcontentloaded')
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined)
}

async function expectScriptMode(page: Page, mode: 'simplified' | 'traditional') {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.chineseScript))
    .toBe(mode)
  await expect(page.locator('html')).toHaveAttribute(
    'lang',
    mode === 'simplified' ? 'zh-CN' : 'zh-TW',
  )
}

async function assertVisibleShell(page: Page, anchor: string) {
  await expect(page.locator('main').first()).toBeVisible()
  await expect(page.locator('body')).toContainText(anchor)

  const textLength = await page
    .locator('body')
    .innerText()
    .then((text) => text.trim().length)
  expect(textLength).toBeGreaterThan(80)
}

async function assertRouteAnchors(
  page: Page,
  anchors: readonly string[],
  mode: 'simplified' | 'traditional',
) {
  const body = page.locator('body')
  for (const anchor of anchors) {
    await expect(body).toContainText(
      mode === 'traditional' ? convertChineseScript(anchor, 'traditional') : anchor,
    )
  }
}

async function assertNoLegacyMainlineCopy(page: Page, label: string) {
  const bodyText = await page.locator('body').innerText()

  for (const pattern of LEGACY_MAINLINE_PATTERNS) {
    expect(
      bodyText,
      `${label} should not expose old editing mainline copy: ${pattern}`,
    ).not.toMatch(pattern)
  }
}

async function collectVisualIssues(page: Page) {
  return page.evaluate(() => {
    const rootOverflow =
      Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth
    const issues: VisualIssue[] = []
    const rootIssues: RootOverflowIssue[] = []
    const visibleElements = Array.from(document.body.querySelectorAll<HTMLElement>('*')).filter(
      (element) => {
        const style = window.getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number.parseFloat(style.opacity || '1') > 0 &&
          rect.width > 0 &&
          rect.height > 0
        )
      },
    )
    const isInsideContainedHorizontalScroller = (element: HTMLElement) => {
      let parent = element.parentElement
      while (parent && parent !== document.body) {
        const style = window.getComputedStyle(parent)
        const rect = parent.getBoundingClientRect()
        const containsHorizontalOverflow = ['auto', 'scroll', 'hidden', 'clip'].includes(
          style.overflowX,
        )
        const containerStaysInsideViewport = rect.left >= -8 && rect.right <= window.innerWidth + 8
        if (containsHorizontalOverflow && containerStaysInsideViewport) return true
        parent = parent.parentElement
      }
      return false
    }

    for (const element of visibleElements) {
      const rect = element.getBoundingClientRect()
      const overflowsViewport = rect.right > window.innerWidth + 8 || rect.left < -8
      if (!overflowsViewport) continue
      if (isInsideContainedHorizontalScroller(element)) continue

      const text = (element.innerText || element.textContent || '').trim().replace(/\s+/g, ' ')
      rootIssues.push({
        tagName: element.tagName.toLowerCase(),
        text: text.slice(0, 100),
        detail: String(element.getAttribute('class') || ''),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
      })

      if (rootIssues.length >= 8) break
    }

    for (const element of visibleElements) {
      const tagName = element.tagName.toLowerCase()
      const checksOwnText =
        ['a', 'button', 'label', 'p', 'span', 'strong', 'small', 'h1', 'h2', 'h3', 'h4'].includes(
          tagName,
        ) || ['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName)
      if (!checksOwnText) continue

      const text = (element.innerText || element.textContent || '').trim().replace(/\s+/g, ' ')
      if (!text) continue

      const className = String(element.getAttribute('class') || '')
      const style = window.getComputedStyle(element)
      const ignoresClipping =
        className.includes('truncate') ||
        className.includes('sr-only') ||
        style.overflowX === 'hidden' ||
        style.textOverflow === 'ellipsis'

      if (!ignoresClipping && element.scrollWidth > element.clientWidth + 2) {
        issues.push({
          tagName,
          text: text.slice(0, 100),
          detail: `scrollWidth ${element.scrollWidth} > clientWidth ${element.clientWidth}`,
        })
      }

      if (issues.length >= 8) break
    }

    return {
      rootOverflow,
      rootIssues,
      issues,
    }
  })
}

async function assertNoVisualBreakage(page: Page, label: string) {
  const { rootOverflow, rootIssues, issues } = await collectVisualIssues(page)

  expect(rootIssues, `${label} viewport overflow elements`).toEqual([])
  expect(rootOverflow, `${label} should not create horizontal page overflow`).toBeLessThanOrEqual(8)
  expect(issues, `${label} should not visibly clip text in normal containers`).toEqual([])
}

async function captureSmokeScreenshot(page: Page, testInfo: TestInfo, label: string) {
  await page.screenshot({
    path: testInfo.outputPath(`${label}.png`),
    fullPage: false,
  })
}

function watchUnexpectedMutations(page: Page) {
  const mutations: string[] = []

  page.on('request', (request) => {
    const method = request.method()
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return
    mutations.push(`${method} ${request.url()}`)
  })

  return mutations
}

function watchAllowedLocalMutations(page: Page, rules: Array<{ method: string; path: RegExp }>) {
  const seen: string[] = []
  const unexpected: string[] = []

  page.on('request', (request) => {
    const method = request.method()
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return

    const url = new URL(request.url())
    const signature = `${method} ${url.pathname}`
    seen.push(signature)

    const allowed = rules.some((rule) => rule.method === method && rule.path.test(url.pathname))
    if (!allowed) unexpected.push(`${method} ${request.url()}`)
  })

  return { seen, unexpected }
}

async function fetchLocalArtifact(
  page: Page,
  path: string,
): Promise<{
  status: number
  contentType: string
  contentDisposition: string
  contentLength: string
  acceptRanges: string
  text: string
}> {
  return page.evaluate(async (relativePath) => {
    const response = await fetch(relativePath, { method: 'GET' })
    return {
      status: response.status,
      contentType: response.headers.get('content-type') || '',
      contentDisposition: response.headers.get('content-disposition') || '',
      contentLength: response.headers.get('content-length') || '',
      acceptRanges: response.headers.get('accept-ranges') || '',
      text: await response.text(),
    }
  }, path)
}

async function getVisibleLinkHref(page: Page, name: RegExp | string): Promise<string> {
  const link = page.getByRole('link', { name }).first()
  await expect(link).toBeVisible()
  const href = await link.getAttribute('href')
  expect(href, `visible link ${String(name)} should have href`).toBeTruthy()
  return href || ''
}

async function fetchJobDetailPayload(page: Page, jobId: string): Promise<JobDetailPayload> {
  const response = await page.request.get(`/api/jobs/${encodeURIComponent(jobId)}`)
  if (!response.ok()) {
    throw new Error(`Job detail ${jobId} failed: ${response.status()}`)
  }
  return (await response.json()) as JobDetailPayload
}

function findEvidence(
  payload: JobDetailPayload,
  id: 'qa_freshness' | 'manual_final_listen' | 'provider_smoke',
): DeliveryEvidencePayload | undefined {
  return payload.deliveryPackage?.deliveryEvidence?.find((row) => row.id === id)
}

test.describe('mainline product visual smoke', () => {
  test.beforeAll(async () => {
    await seedMainlineVisualSmokeFixture()
  })

  test.describe.configure({ mode: 'serial' })

  for (const viewport of VIEWPORTS) {
    test(`${viewport.name} renders mainline routes in simplified and traditional`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })

      for (const route of MAINLINE_ROUTES) {
        if (page.url() !== 'about:blank') {
          await setScriptMode(page, 'simplified')
        }

        await page.goto(route.path)
        await waitForQuietPage(page)
        await expectScriptMode(page, 'simplified')
        await assertVisibleShell(page, route.anchor)
        await assertNoLegacyMainlineCopy(page, `${viewport.name} ${route.path} simplified`)
        await assertNoVisualBreakage(page, `${viewport.name} ${route.path} simplified`)
        await captureSmokeScreenshot(
          page,
          testInfo,
          `${viewport.name}-${route.path.replaceAll('/', 'root')}-simplified`,
        )

        await page.getByRole('button', { name: '切换为繁体中文' }).click()
        await expectScriptMode(page, 'traditional')
        await assertVisibleShell(page, convertChineseScript(route.anchor, 'traditional'))
        await assertNoLegacyMainlineCopy(page, `${viewport.name} ${route.path} traditional`)
        await assertNoVisualBreakage(page, `${viewport.name} ${route.path} traditional`)
        await captureSmokeScreenshot(
          page,
          testInfo,
          `${viewport.name}-${route.path.replaceAll('/', 'root')}-traditional`,
        )

        await page.reload()
        await waitForQuietPage(page)
        await expectScriptMode(page, 'traditional')
        await assertVisibleShell(page, convertChineseScript(route.anchor, 'traditional'))
      }
    })
  }

  for (const viewport of VIEWPORTS) {
    test(`${viewport.name} renders no-paid downstream fixture pages`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      const unexpectedMutations = watchUnexpectedMutations(page)

      for (const route of DOWNSTREAM_ROUTES) {
        if (page.url() !== 'about:blank') {
          await setScriptMode(page, 'simplified')
        }

        await page.goto(route.path)
        await waitForQuietPage(page)
        await expectScriptMode(page, 'simplified')
        await assertVisibleShell(page, route.anchor)
        await assertRouteAnchors(page, route.anchors, 'simplified')
        await assertNoLegacyMainlineCopy(page, `${viewport.name} ${route.path} simplified`)
        await assertNoVisualBreakage(page, `${viewport.name} ${route.path} simplified`)
        await captureSmokeScreenshot(
          page,
          testInfo,
          `${viewport.name}-${route.path.replaceAll('/', 'root')}-fixture-simplified`,
        )

        await page.getByRole('button', { name: '切换为繁体中文' }).click()
        await expectScriptMode(page, 'traditional')
        await assertVisibleShell(page, convertChineseScript(route.anchor, 'traditional'))
        await assertRouteAnchors(page, route.anchors, 'traditional')
        await assertNoLegacyMainlineCopy(page, `${viewport.name} ${route.path} traditional`)
        await assertNoVisualBreakage(page, `${viewport.name} ${route.path} traditional`)
        await captureSmokeScreenshot(
          page,
          testInfo,
          `${viewport.name}-${route.path.replaceAll('/', 'root')}-fixture-traditional`,
        )
      }

      expect(unexpectedMutations, `${viewport.name} downstream smoke should stay GET-only`).toEqual(
        [],
      )
    })
  }

  test('settings keeps compatibility tools out of the default mainline tab', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const unexpectedMutations = watchUnexpectedMutations(page)

    await page.goto('/settings')
    await waitForQuietPage(page)
    await expect(page.locator('body')).toContainText('系统设置')
    await expect(page.locator('body')).not.toContainText('Fish Audio')
    await expect(page.locator('body')).not.toContainText('兼容 TTS 引擎')
    await assertNoLegacyMainlineCopy(page, 'settings default tab')
    await assertNoVisualBreakage(page, 'settings default tab')

    await page.getByRole('tab', { name: '维护兼容' }).click()
    await expect(page.locator('body')).toContainText('旧剪辑兼容')
    await expect(page.locator('body')).toContainText('旧 TTS 兼容已关闭')
    await expect(page.locator('body')).not.toContainText('兼容 TTS 引擎')
    await expect(page.locator('body')).not.toContainText('Fish Audio 兼容音色 ID')
    await assertNoVisualBreakage(page, 'settings maintenance tab')
    expect(unexpectedMutations, 'settings tab switching should stay GET-only').toEqual([])
  })

  test('settings no-paid local commands save credentials and create tokens without provider calls', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    const mutations = watchAllowedLocalMutations(page, [
      { method: 'POST', path: /^\/api\/api-keys$/ },
      { method: 'POST', path: /^\/api\/auth\/tokens$/ },
    ])

    await page.goto('/settings')
    await waitForQuietPage(page)
    await assertVisibleShell(page, '密钥与服务设置')

    await page.locator('#minimax-api-key').fill('sk-api-e2e-no-paid-save-only')
    const saveMiniMaxResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith('/api/api-keys') &&
        response.status() === 200,
    )
    await page.locator('#minimax_tts').getByRole('button', { name: '保存配置' }).click()
    const saveMiniMaxPayload = (await (await saveMiniMaxResponse).json()) as {
      verification?: { paid_verification_called?: boolean; message?: string }
      message?: string
    }
    expect(saveMiniMaxPayload.verification?.paid_verification_called).toBe(false)
    expect(saveMiniMaxPayload.verification?.message || '').toContain('未调用 MiniMax')
    await expect(page.locator('body')).toContainText('尚未执行付费 TTS 验证')

    await page.getByLabel('Token 名称').fill('E2E no-paid token')
    await page.getByLabel('过期天数（可选）').fill('7')
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().endsWith('/api/auth/tokens') &&
          response.status() === 200,
      ),
      page.getByRole('button', { name: '生成 Token' }).click(),
    ])
    await expect(page.locator('body')).toContainText('Token 生成成功')
    await expect(page.locator('body')).toContainText('E2E no-paid token')

    expect(mutations.unexpected, 'settings no-paid commands should stay local').toEqual([])
    expect(mutations.seen).toEqual(
      expect.arrayContaining(['POST /api/api-keys', 'POST /api/auth/tokens']),
    )
  })

  test('no-paid downstream interactions only write local audit and asset state', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    const mutations = watchAllowedLocalMutations(page, [
      {
        method: 'PATCH',
        path: new RegExp(`^/api/jobs/${MAINLINE_FIXTURE_IDS.qaIssues}/manual-final-listen$`),
      },
      { method: 'PUT', path: /^\/api\/configs\/dubbing_project_glossary$/ },
      { method: 'PUT', path: /^\/api\/configs\/laputa_creator_profile$/ },
    ])

    await page.goto(`/jobs/${MAINLINE_FIXTURE_IDS.qaIssues}/qa`)
    await waitForQuietPage(page)
    await assertVisibleShell(page, '质检报告')
    await expect(page.locator('body')).toContainText('保存前预览')

    await page.getByRole('button', { name: /^通过/ }).click()
    await page.getByLabel('终听备注').fill('E2E 已完整终听通过')
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' &&
          response
            .url()
            .includes(`/api/jobs/${MAINLINE_FIXTURE_IDS.qaIssues}/manual-final-listen`) &&
          response.status() === 200,
      ),
      page.getByRole('button', { name: '保存终听记录' }).click(),
    ])
    await expect(page.locator('body')).toContainText('最新备注：E2E 已完整终听通过')

    const manualListenContext = readMainlineFixtureStepContext(MAINLINE_FIXTURE_IDS.qaIssues)
    const manualListenRecord = manualListenContext?.manual_final_listen as
      | { status?: unknown; note?: unknown }
      | undefined
    expect(manualListenRecord?.status).toBe('passed')
    expect(manualListenRecord?.note).toBe('E2E 已完整终听通过')

    const qaIssuesDetail = await fetchJobDetailPayload(page, MAINLINE_FIXTURE_IDS.qaIssues)
    expect(findEvidence(qaIssuesDetail, 'manual_final_listen')).toMatchObject({
      status: 'ready',
      summary: expect.stringContaining('已记录人工终听通过'),
      detail: 'E2E 已完整终听通过',
    })

    await page.goto(`/jobs/${MAINLINE_FIXTURE_IDS.qaIssues}`)
    await waitForQuietPage(page)
    await expect(page.locator('body')).toContainText('人工终听：已记录人工终听通过。')
    await expect(page.locator('body')).toContainText('E2E 已完整终听通过')

    await page.goto(`/jobs/${MAINLINE_FIXTURE_IDS.qaIssues}/qa`)
    await waitForQuietPage(page)

    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === 'PUT' &&
          response.url().endsWith('/api/configs/dubbing_project_glossary') &&
          response.status() === 200,
      ),
      page.getByRole('button', { name: /存入词库与规则|存入词库|存入长期规则/ }).click(),
    ])
    await expect(page.locator('body')).toContainText('下次重跑会自动')
    expect(readMainlineFixtureConfig('dubbing_project_glossary') || '').toContain(
      'Beta 7 -> 贝塔七',
    )
    expect(readMainlineFixtureConfig('laputa_creator_profile') || '').toContain(
      `QA #${MAINLINE_FIXTURE_IDS.qaIssues}`,
    )

    await page.goto(
      `/jobs/${MAINLINE_FIXTURE_IDS.full}/compare?with=${MAINLINE_FIXTURE_IDS.sample}`,
    )
    await waitForQuietPage(page)
    await assertVisibleShell(page, '版本比较')

    await page.getByLabel('固定读法 / 专名修正').fill('Alpha 12 -> 阿尔法十二 # E2E compare')
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === 'PUT' &&
          response.url().endsWith('/api/configs/dubbing_project_glossary') &&
          response.status() === 200,
      ),
      page.getByRole('button', { name: '存词库' }).click(),
    ])
    await expect(page.locator('body')).toContainText('已保存到长期词库')

    await page
      .getByLabel('语气 / 节奏 / 翻译偏好')
      .fill('E2E compare：数字年份先写成中文口播，再处理语气节奏。')
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === 'PUT' &&
          response.url().endsWith('/api/configs/laputa_creator_profile') &&
          response.status() === 200,
      ),
      page.getByRole('button', { name: '存为风格规则' }).click(),
    ])
    await expect(page.locator('body')).toContainText('已追加到创作者资产')

    expect(readMainlineFixtureConfig('dubbing_project_glossary') || '').toContain(
      'Alpha 12 -> 阿尔法十二 # E2E compare',
    )
    expect(readMainlineFixtureConfig('laputa_creator_profile') || '').toContain(
      'E2E compare：数字年份先写成中文口播',
    )
    expect(
      mutations.unexpected,
      'no-paid interaction smoke should not call provider routes',
    ).toEqual([])
    expect(mutations.seen).toEqual(
      expect.arrayContaining([
        `PATCH /api/jobs/${MAINLINE_FIXTURE_IDS.qaIssues}/manual-final-listen`,
        'PUT /api/configs/dubbing_project_glossary',
        'PUT /api/configs/laputa_creator_profile',
      ]),
    )
  })

  test('no-paid artifact downloads only use local GET routes', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    const unexpectedMutations = watchUnexpectedMutations(page)

    await page.goto(`/jobs/${MAINLINE_FIXTURE_IDS.full}`)
    await waitForQuietPage(page)

    const artifactChecks = [
      {
        path: `/api/jobs/${MAINLINE_FIXTURE_IDS.full}/artifact?file=delivery-readme.md`,
        contentType: 'text/markdown',
        disposition: `${MAINLINE_FIXTURE_IDS.full}-delivery-readme.md`,
        body: '## 声线使用与披露',
      },
      {
        path: `/api/jobs/${MAINLINE_FIXTURE_IDS.full}/artifact?file=script.txt`,
        contentType: 'text/plain',
        disposition: `${MAINLINE_FIXTURE_IDS.full}-script.txt`,
        body: '口播：',
      },
      {
        path: `/api/jobs/${MAINLINE_FIXTURE_IDS.full}/artifact?file=translations.json`,
        contentType: 'application/json',
        disposition: `${MAINLINE_FIXTURE_IDS.full}-translations.json`,
        body: '全片版保留固定读法',
      },
      {
        path: `/api/jobs/${MAINLINE_FIXTURE_IDS.full}/artifact?file=segments.json`,
        contentType: 'application/json',
        disposition: `${MAINLINE_FIXTURE_IDS.full}-segments.json`,
        body: 'Wave59 was launched in 1999',
      },
      {
        path: `/api/ingest/${MAINLINE_FIXTURE_IDS.ingest}/artifact?file=transcript.md`,
        contentType: 'text/markdown',
        disposition: 'transcript.md',
        body: 'E2E transcript',
      },
      {
        path: `/api/ingest/${MAINLINE_FIXTURE_IDS.ingest}/artifact?file=transcript.json`,
        contentType: 'application/json',
        disposition: 'transcript.json',
        body: 'Wave59 was launched in 1999',
      },
    ] as const

    for (const check of artifactChecks) {
      const response = await fetchLocalArtifact(page, check.path)

      expect(response.status, check.path).toBe(200)
      expect(response.contentType, check.path).toContain(check.contentType)
      expect(response.contentDisposition, check.path).toContain(check.disposition)
      expect(response.text, check.path).toContain(check.body)
    }

    const qaJson = await fetchLocalArtifact(page, `/api/jobs/${MAINLINE_FIXTURE_IDS.full}/qa`)
    expect(qaJson.status).toBe(200)
    expect(qaJson.contentType).toContain('application/json')
    expect(qaJson.contentDisposition).toContain(`${MAINLINE_FIXTURE_IDS.full}-qa.json`)
    expect(qaJson.text).toContain('"job_id":"e2e-dub-full"')
    expect(qaJson.text).toContain('"handoffs"')
    expect(qaJson.text).toContain('delivery-readme.md')

    const finalVideo = await fetchLocalArtifact(
      page,
      `/api/jobs/${MAINLINE_FIXTURE_IDS.full}/download`,
    )
    expect(finalVideo.status).toBe(200)
    expect(finalVideo.contentType).toContain('video/mp4')
    expect(finalVideo.contentDisposition).toContain(`${MAINLINE_FIXTURE_IDS.full}-final.mp4`)
    expect(finalVideo.contentLength).toBe('28')
    expect(finalVideo.acceptRanges).toBe('bytes')
    expect(finalVideo.text).toContain('E2E_FINAL_VIDEO_PLACEHOLDER')

    expect(
      unexpectedMutations,
      'artifact download smoke should stay GET-only and no-provider',
    ).toEqual([])
  })

  test('no-paid delivery evidence matrix exposes warning and ready states', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    const unexpectedMutations = watchUnexpectedMutations(page)

    const sampleDetail = await fetchJobDetailPayload(page, MAINLINE_FIXTURE_IDS.sample)
    expect(findEvidence(sampleDetail, 'qa_freshness')).toMatchObject({
      status: 'warning',
      summary: expect.stringContaining('QA 82/100'),
    })
    expect(findEvidence(sampleDetail, 'manual_final_listen')).toMatchObject({
      status: 'not_recorded',
      summary: '未记录人工终听确认。',
    })
    expect(findEvidence(sampleDetail, 'provider_smoke')).toMatchObject({
      status: 'warning',
      summary: '未关联 provider smoke 记录。',
    })

    await page.goto(`/jobs/${MAINLINE_FIXTURE_IDS.sample}`)
    await waitForQuietPage(page)
    await assertVisibleShell(page, '转译配音交付')
    await expect(page.locator('body')).toContainText('交付审计阻断')
    await expect(page.locator('body')).toContainText('交付证据')
    await expect(page.locator('body')).toContainText('QA 新鲜度：QA 82/100')
    await expect(page.locator('body')).toContainText('人工终听：未记录人工终听确认。')
    await expect(page.locator('body')).toContainText('Provider Smoke：未关联 provider smoke 记录。')

    const fullDetail = await fetchJobDetailPayload(page, MAINLINE_FIXTURE_IDS.full)
    expect(fullDetail.deliveryPackage?.deliveryAuditReadiness).toMatchObject({
      ready: true,
      status: 'ready',
      label: '交付审计就绪',
    })
    expect(findEvidence(fullDetail, 'qa_freshness')).toMatchObject({
      status: 'ready',
      summary: expect.stringContaining('QA 94/100'),
      detail: expect.stringContaining('当前输入指纹匹配'),
    })
    expect(findEvidence(fullDetail, 'manual_final_listen')).toMatchObject({
      status: 'ready',
      summary: expect.stringContaining('已记录人工终听通过'),
      detail: 'E2E 已完整终听通过',
    })
    expect(findEvidence(fullDetail, 'provider_smoke')).toMatchObject({
      status: 'ready',
      summary: expect.stringContaining('dry-run'),
      detail: expect.stringContaining('未调用外部 provider'),
    })
    expect(findEvidence(fullDetail, 'provider_smoke')?.detail).toContain('latest dry-run epoch')
    expect(findEvidence(fullDetail, 'provider_smoke')?.detail).toContain('运行指纹')

    await page.goto(`/jobs/${MAINLINE_FIXTURE_IDS.full}/report`)
    await waitForQuietPage(page)
    await assertVisibleShell(page, '任务报告')
    const reportDelivery = page.locator('#delivery-package')
    await expect(reportDelivery).toContainText('交付审计就绪')
    await expect(reportDelivery).toContainText('交付证据')
    await expect(reportDelivery).toContainText('QA 新鲜度：QA 94/100')
    await expect(reportDelivery).toContainText('人工终听：已记录人工终听通过。')
    await expect(reportDelivery).toContainText('Provider Smoke：dry-run')
    await expect(reportDelivery).toContainText('未调用外部 provider')
    await expect(reportDelivery).toContainText('当前输入指纹匹配')
    await expect(page.locator('#provider-smoke')).toContainText('最近 provider smoke')
    await expect(page.locator('#provider-smoke')).toContainText('dry-run')
    await expect(page.locator('#provider-smoke')).toContainText('未调用外部 provider')

    expect(unexpectedMutations, 'delivery evidence matrix smoke should stay GET-only').toEqual([])
  })

  test('no-paid rerun handoff links prefill dubbing without creating jobs', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    const unexpectedMutations = watchUnexpectedMutations(page)

    await page.goto(`/jobs/${MAINLINE_FIXTURE_IDS.qaIssues}/qa`)
    await waitForQuietPage(page)
    await assertVisibleShell(page, '质检报告')
    await expect(page.locator('body')).toContainText('重跑前确认')
    await expect(page.locator('body')).toContainText('本次资产')

    const fullRunHref = await getVisibleLinkHref(page, /带 QA 跑全片/)
    const fullRunUrl = new URL(fullRunHref, 'http://localhost')
    expect(fullRunUrl.pathname).toBe('/dubbing')
    expect(fullRunUrl.searchParams.get('fromJob')).toBe(MAINLINE_FIXTURE_IDS.qaIssues)
    expect(fullRunUrl.searchParams.get('sampleToFull')).toBe('true')
    expect(fullRunUrl.searchParams.get('sampleAssetSnapshot')).toBe('true')
    expect(fullRunUrl.searchParams.has('sampleMode')).toBe(false)
    expect(fullRunUrl.searchParams.get('revisionNotes')).toContain('本次根据QA 报告修版')
    expect(fullRunUrl.searchParams.get('revisionNotes')).toContain('重跑时请优先修正以下问题')

    await page.goto(fullRunHref)
    await waitForQuietPage(page)
    await assertVisibleShell(page, '转译配音工作台')
    await expect(page.locator('body')).toContainText('已带入样片需修，带 QA 跑全片到配音台')
    await expect(page.locator('#video-url')).toHaveValue(
      'https://example.test/wave59-interview.mp4',
    )
    await expect(page.locator('#voice-id')).toHaveValue('e2e_synthetic_voice_male')
    await expect(page.locator('#revision-notes')).toHaveValue(/本次根据QA 报告修版/)
    await expect(page.locator('body')).toContainText('全片正式转译')
    await expect(page.getByRole('button', { name: '开始转译' })).toBeVisible()

    expect(unexpectedMutations, 'rerun handoff smoke should stay GET-only').toEqual([])
  })

  test('no-paid delivery package visible links stay local GET', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    const unexpectedMutations = watchUnexpectedMutations(page)

    await page.goto(`/jobs/${MAINLINE_FIXTURE_IDS.full}`)
    await waitForQuietPage(page)
    await assertVisibleShell(page, '转译配音交付')
    await expect(
      page.locator(`video[src="/api/jobs/${MAINLINE_FIXTURE_IDS.full}/download"]`),
    ).toBeVisible()

    const artifactLinks = [
      {
        name: /MP4/,
        path: `/api/jobs/${MAINLINE_FIXTURE_IDS.full}/download`,
        body: 'E2E_FINAL_VIDEO_PLACEHOLDER',
      },
      {
        name: '交付 README',
        path: `/api/jobs/${MAINLINE_FIXTURE_IDS.full}/artifact?file=delivery-readme.md`,
        body: '## 声线使用与披露',
      },
      {
        name: '口播稿',
        path: `/api/jobs/${MAINLINE_FIXTURE_IDS.full}/artifact?file=script.txt`,
        body: '口播：',
      },
      {
        name: '翻译 JSON',
        path: `/api/jobs/${MAINLINE_FIXTURE_IDS.full}/artifact?file=translations.json`,
        body: '全片版保留固定读法',
      },
      {
        name: '原始分段',
        path: `/api/jobs/${MAINLINE_FIXTURE_IDS.full}/artifact?file=segments.json`,
        body: 'Wave59 was launched in 1999',
      },
      {
        name: 'QA JSON',
        path: `/api/jobs/${MAINLINE_FIXTURE_IDS.full}/qa`,
        body: '"job_id":"e2e-dub-full"',
      },
    ] as const

    for (const link of artifactLinks) {
      const href = await getVisibleLinkHref(page, link.name)
      expect(new URL(href, 'http://localhost').pathname).toBe(
        new URL(link.path, 'http://localhost').pathname,
      )
      const expectedSearch = new URL(link.path, 'http://localhost').search
      if (expectedSearch) expect(href).toContain(expectedSearch)

      const response = await fetchLocalArtifact(page, href)
      expect(response.status, String(link.name)).toBe(200)
      expect(response.text, String(link.name)).toContain(link.body)
    }

    const routeLinks = [
      {
        name: '声线披露',
        path: `/jobs/${MAINLINE_FIXTURE_IDS.full}/report#dubbing-context`,
      },
      {
        name: '质检报告',
        path: `/jobs/${MAINLINE_FIXTURE_IDS.full}/qa`,
      },
      {
        name: '任务报告',
        path: `/jobs/${MAINLINE_FIXTURE_IDS.full}/report`,
      },
      {
        name: '版本比较',
        path: `/jobs/${MAINLINE_FIXTURE_IDS.full}/compare`,
      },
    ] as const

    for (const link of routeLinks) {
      const href = await getVisibleLinkHref(page, link.name)
      expect(href).toBe(link.path)
    }

    expect(unexpectedMutations, 'delivery package visible links should stay GET-only').toEqual([])
  })

  test('no-paid report qa compare links keep delivery handoff surfaces local GET', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    const unexpectedMutations = watchUnexpectedMutations(page)

    await page.goto(`/jobs/${MAINLINE_FIXTURE_IDS.full}/report`)
    await waitForQuietPage(page)
    await assertVisibleShell(page, '任务报告')

    const reportDelivery = page.locator('#delivery-package')
    await expect(reportDelivery).toContainText('交付包')
    await expect(reportDelivery.getByRole('link', { name: /MP4/ })).toHaveAttribute(
      'href',
      `/api/jobs/${MAINLINE_FIXTURE_IDS.full}/download`,
    )
    await expect(reportDelivery.getByRole('link', { name: '交付 README' })).toHaveAttribute(
      'href',
      `/api/jobs/${MAINLINE_FIXTURE_IDS.full}/artifact?file=delivery-readme.md`,
    )
    await expect(reportDelivery.getByRole('link', { name: 'QA JSON' })).toHaveAttribute(
      'href',
      `/api/jobs/${MAINLINE_FIXTURE_IDS.full}/qa`,
    )
    await expect(reportDelivery.getByRole('link', { name: '声线披露' })).toHaveAttribute(
      'href',
      `/jobs/${MAINLINE_FIXTURE_IDS.full}/report#dubbing-context`,
    )

    await page.goto(`/jobs/${MAINLINE_FIXTURE_IDS.full}/qa`)
    await waitForQuietPage(page)
    await assertVisibleShell(page, '质检报告')

    await expect(page.getByRole('link', { name: '比较版本' })).toHaveAttribute(
      'href',
      `/jobs/${MAINLINE_FIXTURE_IDS.full}/compare`,
    )
    await expect(page.getByRole('link', { name: 'QA JSON' })).toHaveAttribute(
      'href',
      `/api/jobs/${MAINLINE_FIXTURE_IDS.full}/qa`,
    )
    await expect(page.getByRole('link', { name: '交付 README' })).toHaveAttribute(
      'href',
      `/api/jobs/${MAINLINE_FIXTURE_IDS.full}/artifact?file=delivery-readme.md`,
    )
    await expect(page.getByRole('link', { name: '下载 README' })).toHaveAttribute(
      'href',
      `/api/jobs/${MAINLINE_FIXTURE_IDS.full}/artifact?file=delivery-readme.md`,
    )
    await expect(page.getByRole('link', { name: '查看报告锚点' })).toHaveAttribute(
      'href',
      `/jobs/${MAINLINE_FIXTURE_IDS.full}/report#dubbing-context`,
    )

    const qaReadme = await fetchLocalArtifact(
      page,
      `/api/jobs/${MAINLINE_FIXTURE_IDS.full}/artifact?file=delivery-readme.md`,
    )
    expect(qaReadme.status).toBe(200)
    expect(qaReadme.text).toContain('## 交付项')

    await page.goto(
      `/jobs/${MAINLINE_FIXTURE_IDS.full}/compare?with=${MAINLINE_FIXTURE_IDS.sample}`,
    )
    await waitForQuietPage(page)
    await assertVisibleShell(page, '版本比较')

    await expect(page.getByRole('link', { name: '回到任务' })).toHaveAttribute(
      'href',
      `/jobs/${MAINLINE_FIXTURE_IDS.full}`,
    )
    await expect(
      page.locator(`a[href="/jobs/${MAINLINE_FIXTURE_IDS.sample}"]`).first(),
    ).toBeVisible()
    await expect(
      page.locator(`a[href="/api/jobs/${MAINLINE_FIXTURE_IDS.full}/artifact?file=script.txt"]`),
    ).toBeVisible()
    await expect(
      page.locator(`a[href="/api/jobs/${MAINLINE_FIXTURE_IDS.sample}/artifact?file=script.txt"]`),
    ).toBeVisible()

    expect(
      unexpectedMutations,
      'report qa compare visible link smoke should stay GET-only',
    ).toEqual([])
  })
})
