/**
 * @vitest-environment jsdom
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DeliveryPackageSection } from '@/components/report/sections/DeliveryPackageSection'
import type { DeliveryPackage } from '@/lib/jobs/delivery-package'

function deliveryPackage(overrides: Partial<DeliveryPackage> = {}): DeliveryPackage {
  return {
    title: '成片交付包',
    subtitle: '整理本次任務的成片、口播稿、文本和質檢入口。',
    deliveryAuditReadiness: {
      ready: true,
      status: 'ready',
      label: '交付审计就绪',
      guidance: '成片、README、QA JSON 和声线披露已形成完整交付包。',
      blockers: [],
      warnings: [],
      checks: [
        {
          id: 'final_video',
          label: '成片文件',
          status: 'ready',
          summary: '最終可播放影片。',
        },
        {
          id: 'delivery_readme',
          label: '交付 README',
          status: 'ready',
          summary: '给人工剪辑和发布人员的下载说明。',
        },
        {
          id: 'qa_json',
          label: 'QA JSON',
          status: 'ready',
          summary: '自动质检原始数据。',
        },
        {
          id: 'voice_disclosure',
          label: '声线披露',
          status: 'ready',
          summary: '声线披露已记录。',
        },
        {
          id: 'manual_final_listen',
          label: '人工终听',
          status: 'ready',
          summary: '已记录人工终听通过。',
        },
      ],
    },
    items: [
      {
        id: 'final_video',
        label: '成片 MP4',
        description: '最終可播放影片。',
        href: '/api/jobs/job123/download',
        action: 'download',
        download: 'job123-final.mp4',
        primary: true,
        available: true,
      },
      {
        id: 'delivery_readme',
        label: '交付 README',
        description: '给人工剪辑和发布人员的下载说明，含声线用途与披露要求。',
        href: '/api/jobs/job123/artifact?file=delivery-readme.md',
        action: 'download',
        download: 'job123-delivery-readme.md',
      },
      {
        id: 'qa',
        label: '質檢報告',
        description: '數字、專名、節奏、講者與交付狀態。',
        href: '/jobs/job123/qa',
        action: 'open',
      },
    ],
    ...overrides,
  }
}

function expectTextContent(text: string): void {
  expect(screen.getAllByText((_, element) => element?.textContent === text).length).toBeGreaterThan(
    0,
  )
}

describe('DeliveryPackageSection', () => {
  it('renders downloadable and openable package links', () => {
    render(<DeliveryPackageSection deliveryPackage={deliveryPackage()} />)

    expect(screen.getByText('成片交付包')).toBeTruthy()
    expect(screen.getByText('交付审计就绪')).toBeTruthy()
    expect(screen.getByText('交付审计检查')).toBeTruthy()
    expectTextContent('人工终听：已记录人工终听通过。')

    const links = screen.getAllByRole('link')
    const finalVideoLink = links.find(
      (link) => link.getAttribute('href') === '/api/jobs/job123/download',
    )
    const qaLink = links.find((link) => link.getAttribute('href') === '/jobs/job123/qa')
    const readmeLink = links.find(
      (link) => link.getAttribute('href') === '/api/jobs/job123/artifact?file=delivery-readme.md',
    )

    expect(finalVideoLink?.getAttribute('download')).toBe('job123-final.mp4')
    expect(readmeLink?.getAttribute('download')).toBe('job123-delivery-readme.md')
    expect(qaLink).toBeTruthy()
  })

  it('renders delivery audit blockers without making unavailable items clickable', () => {
    render(
      <DeliveryPackageSection
        deliveryPackage={deliveryPackage({
          deliveryAuditReadiness: {
            ready: false,
            status: 'blocked',
            label: '交付审计阻断',
            guidance: '交付包缺少关键产物或入口，先补齐阻断项再交付。',
            blockers: ['成片文件：下載入口需要本機 final_video_local_path。'],
            warnings: ['声线披露：未记录声线披露要求。'],
            checks: [
              {
                id: 'final_video',
                label: '成片文件',
                status: 'blocked',
                summary: '下載入口需要本機 final_video_local_path。',
              },
              {
                id: 'manual_final_listen',
                label: '人工终听',
                status: 'warning',
                summary: '未记录人工终听确认。',
              },
            ],
          },
          items: [
            {
              id: 'final_video',
              label: '成片 MP4',
              description: '成片已生成，但目前不是本機可串流檔案。',
              href: '/api/jobs/job123/download',
              action: 'download',
              download: 'job123-final.mp4',
              primary: true,
              available: false,
              unavailableReason: '下載入口需要本機 final_video_local_path。',
            },
          ],
        })}
      />,
    )

    expect(screen.getByText('交付审计阻断')).toBeTruthy()
    expect(screen.getByText('交付包缺少关键产物或入口，先补齐阻断项再交付。')).toBeTruthy()
    expect(screen.getByText('成片文件：下載入口需要本機 final_video_local_path。')).toBeTruthy()
    expectTextContent('人工终听：未记录人工终听确认。')
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('renders the voice disclosure delivery item as a report anchor', () => {
    render(
      <DeliveryPackageSection
        deliveryPackage={deliveryPackage({
          voiceUsage: {
            voiceId: 'voice-public',
            usageLabel: '公众人物评论转译声线（非本人原声）',
            sourceLabel: '讲者声线库',
            categoryLabel: '公众人物评论/转译声线',
            publicFigureLabel: '公众人物相关声线',
            disclosureLabel: '需要标注 AI 翻译配音',
            confirmationLabel: '已确认本次声线使用边界',
            disclosureStatus: 'required',
            disclosureRequired: true,
            detail:
              '公众人物评论转译声线（非本人原声）；讲者声线库；公众人物评论/转译声线；公众人物相关声线；需要标注 AI 翻译配音',
            tone: 'warning',
          },
          items: [
            {
              id: 'voice_disclosure',
              label: '声线披露',
              description: '公众人物评论转译声线（非本人原声）；讲者声线库；需要标注 AI 翻译配音。',
              href: '/jobs/job123/report#dubbing-context',
              action: 'open',
            },
          ],
        })}
      />,
    )

    const disclosureLink = screen.getByRole('link', { name: /声线披露/ })

    expect(disclosureLink.getAttribute('href')).toBe('/jobs/job123/report#dubbing-context')
    expect(screen.getByText(/公众人物评论转译声线/)).toBeTruthy()
    expect(screen.getByText(/讲者声线库/)).toBeTruthy()
    expect(screen.getByText(/需要标注 AI 翻译配音/)).toBeTruthy()
  })

  it('renders delivery evidence rows without changing package links', () => {
    render(
      <DeliveryPackageSection
        deliveryPackage={deliveryPackage({
          deliveryAuditReadiness: {
            ready: false,
            status: 'warning',
            label: '交付审计待补',
            guidance: '运行产物可交接，但发布前需要补齐终听记录或豁免确认。',
            blockers: [],
            warnings: ['人工终听：未记录人工终听确认。'],
            checks: [
              {
                id: 'manual_final_listen',
                label: '人工终听',
                status: 'warning',
                summary: '未记录人工终听确认。',
              },
            ],
          },
          deliveryEvidence: [
            {
              id: 'qa_freshness',
              label: 'QA 新鲜度',
              status: 'unknown',
              summary: 'QA 91/100 · 需修 0 · 留意 1。',
              detail: '当前页未重新计算 fingerprint，交付前可打开 QA 重新校验。',
              href: '/jobs/job123/qa',
            },
            {
              id: 'manual_final_listen',
              label: '人工终听',
              status: 'not_recorded',
              summary: '未记录人工终听确认。',
              detail: '自动 QA 不能替代最终听感检查。',
              href: '/jobs/job123/qa',
            },
            {
              id: 'provider_smoke',
              label: 'Provider Smoke',
              status: 'ready',
              summary: '真实 provider smoke · 可用 · 通过 3 · 阻断 0 · 跳过 0。',
              detail:
                '检查时间：2026/4/29 12:00:00；已调用外部 provider；latest dry-run epoch：2026/4/29 11:00:00；之后真实 smoke 1 次，外呼 1 次；运行指纹：laputa-media-center@0.1.0 · build test-build。',
              href: '/jobs/job123/report#provider-smoke',
            },
          ],
        })}
      />,
    )

    expect(screen.getByText('交付证据')).toBeTruthy()
    expect(screen.getByText(/QA 新鲜度：QA 91\/100/)).toBeTruthy()
    expectTextContent('人工终听：未记录人工终听确认。')
    expect(screen.getByText(/Provider Smoke：真实 provider smoke/)).toBeTruthy()
    expect(screen.getByText(/latest dry-run epoch：2026\/4\/29 11:00:00/)).toBeTruthy()
    expect(screen.getByText(/运行指纹：laputa-media-center@0\.1\.0/)).toBeTruthy()
    expect(screen.getByText('交付审计待补')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /记录通过|记录阻断/ })).toBeNull()
    expect(screen.getByRole('link', { name: /成片 MP4/ }).getAttribute('href')).toBe(
      '/api/jobs/job123/download',
    )
    expect(screen.getByRole('link', { name: /人工终听/ }).getAttribute('href')).toBe(
      '/jobs/job123/qa',
    )
  })

  it('does not render unavailable final videos as clickable links', () => {
    render(
      <DeliveryPackageSection
        deliveryPackage={deliveryPackage({
          items: [
            {
              id: 'final_video',
              label: '成片 MP4',
              description: '成片已生成，但目前不是本機可串流檔案。',
              href: '/api/jobs/job123/download',
              action: 'download',
              download: 'job123-final.mp4',
              primary: true,
              available: false,
              unavailableReason: '下載入口需要本機 final_video_local_path。',
            },
          ],
        })}
      />,
    )

    expect(screen.getByText('下載入口需要本機 final_video_local_path。')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })
})
