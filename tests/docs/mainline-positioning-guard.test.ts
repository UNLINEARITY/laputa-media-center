import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { convertChineseScript } from '@/lib/i18n/chinese-script'

interface GuardedDoc {
  file: string
  requiredSignals: RegExp[]
  forbiddenMainlineClaims: RegExp[]
}

const ROOT = process.cwd()
const PRODUCTION_CONFIG_FILES = ['package.json', 'scripts/obfuscate-config.json']

const GUARDED_DOCS: GuardedDoc[] = [
  {
    file: 'README.md',
    requiredSignals: [/\/ingest -> \/dubbing -> \/jobs -> QA -> sample-to-full -> compare\/report/],
    forbiddenMainlineClaims: [
      /全自动视频剪辑工具/,
      /智能视频分析/,
      /视频智能分析/,
      /分镜脚本/,
      /批量旁白/,
      /创建剪辑任务/,
      /选择剪辑风格/,
      /单视频剪辑/,
      /多视频混剪/,
      /Fish Audio/,
      /Edge TTS/,
      /styles\/_templates/,
      /\/styles/,
      /dub_pipeline\.py/,
      /特朗普/,
    ],
  },
  {
    file: 'CLAUDE.md',
    requiredSignals: [/\/ingest -> \/dubbing -> \/jobs -> QA -> sample-to-full -> compare\/report/],
    forbiddenMainlineClaims: [
      /全自动视频剪辑工具/,
      /视频智能分析/,
      /分镜脚本/,
      /Fish Audio/,
      /Edge TTS/,
      /风格系统/,
      /dub_pipeline\.py/,
      /特朗普/,
    ],
  },
  {
    file: 'WARP.md',
    requiredSignals: [/\/ingest -> \/dubbing -> \/jobs -> QA -> sample-to-full -> compare\/report/],
    forbiddenMainlineClaims: [
      /全自动视频剪辑工具/,
      /视频智能分析/,
      /分镜脚本/,
      /Fish Audio/,
      /Edge TTS/,
      /风格系统/,
      /dub_pipeline\.py/,
      /特朗普/,
    ],
  },
  {
    file: 'docs/dubbing-guide.md',
    requiredSignals: [/\/ingest -> \/dubbing -> \/jobs -> QA -> sample-to-full -> compare\/report/],
    forbiddenMainlineClaims: [
      /首页三种任务模式/,
      /单视频剪辑/,
      /多视频混剪/,
      /dub_pipeline\.py/,
      /laputa-video-chuangcut-editing/,
      /特朗普/,
      /Edge TTS/,
      /Fish Audio/,
    ],
  },
]
const STATIC_AGENT_DOCS_WITH_CURRENT_STRUCTURE = [
  'docs/agent/testing/static/frontend-components.md',
  'docs/agent/testing/static/config-style.md',
  'docs/agent/database.md',
  'docs/agent/testing/credentials/shared.md',
]
const FORBIDDEN_STATIC_CURRENT_STRUCTURE = [
  /styles\//,
  /task-creation/,
  /style-default/,
  /job_type TEXT DEFAULT 'single_video'/,
  /major_step TEXT NOT NULL,\s*-- 'analysis'/,
  /service_name TEXT,\s*-- 'Gemini' \| 'FishAudio'/,
  /service TEXT NOT NULL,\s*-- 'gemini' \| 'ffmpeg' \| 'fish_audio'/,
  /成本数据通过 `api_calls` 表的 `token_usage` 字段记录，由 `/,
]
const FORBIDDEN_ACTIVE_TEST_RECIPE_SNIPPETS = [
  {
    file: 'docs/agent/testing/static/type-system.md',
    pattern: /interface CreateJobRequest[\s\S]*?styleId/,
  },
  {
    file: 'docs/agent/testing/static/type-system.md',
    pattern: /type WorkflowStep[\s\S]*?prepare_gemini/,
  },
  {
    file: 'docs/agent/testing/static/api-routes.md',
    pattern: /const CreateJobSchema[\s\S]*?styleId/,
  },
  {
    file: 'docs/agent/testing/static/api-routes.md',
    pattern: /\|\s*TTS 管理\s*\|\s*3\s*\|/,
  },
  {
    file: 'docs/agent/testing/static/code-quality.md',
    pattern: /├── styles\/\s+# 风格预设/,
  },
  {
    file: 'docs/agent/testing/dynamic/local-api.md',
    pattern: /请求示例.*与 Guide 完全一致/,
  },
  {
    file: 'docs/agent/testing/dynamic/local-api.md',
    pattern: /检查 styles 表或使用预置风格/,
  },
]
const ACTIVE_MAINLINE_SOURCE_COPY_NORMAL_FORM_FILES = [
  'app/layout.tsx',
  'app/guide/page.tsx',
  'components/guide/tabs/api-config-tab.tsx',
  'components/guide/tabs/create-job-tab.tsx',
  'components/guide/tabs/quick-start-tab.tsx',
  'components/guide/tabs/troubleshooting-tab.tsx',
  'app/license-error/page.tsx',
  'app/settings/page.tsx',
  'components/settings/api-token-manager.tsx',
  'components/settings/creator-assets-config.tsx',
  'components/settings/fish-audio-config.tsx',
  'components/settings/gcs-config.tsx',
  'components/settings/gemini-ai-studio-config.tsx',
  'components/settings/gemini-vertex-config.tsx',
  'components/settings/minimax-config.tsx',
  'components/settings/minimax-voice-registry-editor.tsx',
  'components/settings/status-badge.tsx',
  'components/settings/storage-cleanup.tsx',
  'components/settings/system-config.tsx',
  'components/settings/tts-config.tsx',
  'components/i18n/chinese-script-toggle.tsx',
  'components/layout/header.tsx',
  'components/layout/footer.tsx',
  'components/layout/site-logo.tsx',
  'components/dashboard/engine-dashboard.tsx',
  'components/ingest/ingest-workbench.tsx',
  'components/dubbing/dubbing-form.tsx',
  'components/dubbing/dubbing-progress.tsx',
  'components/dubbing/dubbing-workbench.tsx',
  'app/jobs/page.tsx',
  'components/jobs/job-list-client.tsx',
  'components/jobs/job-status-badge.tsx',
  'app/jobs/[id]/page.tsx',
  'components/workbench/workbench-client.tsx',
  'components/workbench/LogsPanel.tsx',
  'components/workbench/CostSummaryCard.tsx',
  'components/jobs/delivery-package-panel.tsx',
  'components/jobs/manual-final-listen-panel.tsx',
  'app/jobs/[id]/qa/page.tsx',
  'components/jobs/job-compare-client.tsx',
  'components/jobs/job-qa-report.tsx',
  'components/jobs/provider-smoke-audit-panel.tsx',
  'components/jobs/qa-asset-save-button.tsx',
  'components/jobs/qa-backfill-button.tsx',
  'app/jobs/[id]/compare/page.tsx',
  'app/jobs/[id]/report/page.tsx',
  'components/report/ReportLayout.tsx',
  'components/report/ReportNavigation.tsx',
  'components/report/sections/BasicInfoSection.tsx',
  'components/report/sections/DeliveryPackageSection.tsx',
  'components/report/sections/DubbingContextSection.tsx',
  'components/report/sections/ErrorSummarySection.tsx',
  'components/report/sections/IntegritySection.tsx',
  'components/report/sections/StepHistorySection.tsx',
  'components/report/sections/ApiCallsSection.tsx',
  'components/report/sections/LogsSection.tsx',
  'components/report/sections/ConfigSection.tsx',
  'components/report/sections/SummarySection.tsx',
  'components/report/sections/VideoInfoSection.tsx',
  'types/api/job-report.ts',
  'lib/dubbing/applied-asset-summary.ts',
  'lib/ingest/dubbing-content-brief.ts',
  'lib/jobs/job-display.ts',
  'lib/jobs/dubbing-rerun.ts',
  'lib/jobs/delivery-package.ts',
  'lib/jobs/dubbing-qa.ts',
  'lib/workflow/engine.ts',
]

const LEGACY_LICENSE_FEATURE_SURFACES = [
  {
    file: 'lib/license/constants.ts',
    patterns: [/SINGLE_VIDEO/, /MULTI_VIDEO/, /ALL_STYLES/],
  },
  {
    file: 'lib/license/validator-v3.ts',
    patterns: [
      /features\.push\('single_video'\)/,
      /features\.push\('multi_video'\)/,
      /features\.push\('all_styles'\)/,
    ],
  },
  {
    file: 'scripts/license-generate-v3.ts',
    patterns: [/单视频剪辑/, /多视频混剪/, /全部风格/],
  },
]

const LEGACY_TTS_GATE_SURFACES = [
  {
    file: 'lib/ai/tts/legacy-policy.ts',
    required: [/LEGACY_TTS_ENABLED/, /LEGACY_TTS_DISABLED_ERROR/, /assertLegacyTtsEnabled/],
  },
  {
    file: 'app/api/tts/status/route.ts',
    required: [/isLegacyTtsEnabled/, /LEGACY_TTS_DISABLED_STATUS/],
  },
  {
    file: 'app/api/tts/voices/route.ts',
    required: [/isLegacyTtsEnabled/, /LEGACY_TTS_DISABLED_ERROR/],
  },
  {
    file: 'app/api/tts/verify-voice/route.ts',
    required: [/isLegacyTtsEnabled/, /LEGACY_TTS_DISABLED_ERROR/],
  },
  {
    file: 'app/api/api-keys/route.ts',
    required: [/isLegacyTtsProviderService/, /LEGACY_TTS_DISABLED_ERROR/],
  },
  {
    file: 'app/api/api-keys/verify/route.ts',
    required: [/isLegacyTtsProviderService/, /LEGACY_TTS_DISABLED_ERROR/],
  },
  {
    file: 'app/api/api-keys/[service]/route.ts',
    required: [/authenticateOrReject/, /isLegacyTtsProviderService/, /LEGACY_TTS_DISABLED_ERROR/],
  },
  {
    file: 'lib/ai/tts/index.ts',
    required: [/isLegacyTtsEnabled/, /assertLegacyTtsEnabled/, /LEGACY_TTS_DISABLED_ERROR/],
  },
  {
    file: 'lib/ai/tts/edge-tts-provider.ts',
    required: [/assertLegacyTtsEnabled/, /isLegacyTtsEnabled/],
  },
  {
    file: 'lib/ai/tts/fish-audio-provider.ts',
    required: [/assertLegacyTtsEnabled/, /isLegacyTtsEnabled/],
  },
  {
    file: 'app/settings/page.tsx',
    required: [/legacyTtsEnabled/, /LEGACY_TTS_ENABLED=true|旧语音兼容默认关闭/],
  },
  {
    file: 'components/settings/tts-config.tsx',
    required: [/legacy_tts_enabled/, /旧 TTS 兼容已关闭/],
  },
  {
    file: 'docs/agent/api-routes.md',
    required: [/LEGACY_TTS_ENABLED=false/, /410 LEGACY_TTS_DISABLED/, /LEGACY_TTS_ENABLED=true/],
  },
]

function readDoc(file: string): string {
  return readFileSync(path.join(ROOT, file), 'utf-8')
}

function lineFor(text: string, index: number): number {
  return text.slice(0, Math.max(0, index)).split('\n').length
}

function findForbiddenMatches(doc: GuardedDoc): string[] {
  const text = readDoc(doc.file)
  const failures: string[] = []

  for (const pattern of doc.forbiddenMainlineClaims) {
    const match = pattern.exec(text)
    if (match?.index !== undefined) {
      failures.push(`${doc.file}:${lineFor(text, match.index)} matched ${pattern}`)
    }
  }

  return failures
}

describe('public docs mainline positioning guard', () => {
  it('keeps public docs anchored to the current ingest-to-dubbing mainline', () => {
    for (const doc of GUARDED_DOCS) {
      const text = readDoc(doc.file)
      for (const signal of doc.requiredSignals) {
        expect(text, `${doc.file} should include ${signal}`).toMatch(signal)
      }
    }
  })

  it('does not present the removed editing system as a current mainline', () => {
    const failures = GUARDED_DOCS.flatMap(findForbiddenMatches)

    expect(failures).toEqual([])
  })

  it('keeps current static agent docs off the removed editing structure', () => {
    const failures = STATIC_AGENT_DOCS_WITH_CURRENT_STRUCTURE.flatMap((file) => {
      const text = readDoc(file)
      return FORBIDDEN_STATIC_CURRENT_STRUCTURE.flatMap((pattern) => {
        const match = pattern.exec(text)
        return match?.index === undefined
          ? []
          : [`${file}:${lineFor(text, match.index)} matched ${pattern}`]
      })
    })

    expect(failures).toEqual([])
  })

  it('keeps AGENTS product direction from re-exposing old editing as a product path', () => {
    const text = readDoc('AGENTS.md')

    expect(text).toContain('historical record reading')
    expect(text).not.toMatch(/secondary functionality/)
    expect(text).not.toMatch(/first-screen experience/)
  })

  it('keeps old editing examples out of active static test recipes', () => {
    const failures = FORBIDDEN_ACTIVE_TEST_RECIPE_SNIPPETS.flatMap(({ file, pattern }) => {
      const text = readDoc(file)
      const match = pattern.exec(text)

      return match?.index === undefined
        ? []
        : [`${file}:${lineFor(text, match.index)} matched ${pattern}`]
    })

    expect(failures).toEqual([])
  })

  it('keeps active mainline source copy in Simplified Chinese normal form', () => {
    const failures = ACTIVE_MAINLINE_SOURCE_COPY_NORMAL_FORM_FILES.flatMap((file) => {
      const text = readDoc(file)
      const simplified = convertChineseScript(text, 'simplified')

      if (text === simplified) return []

      const originalLines = text.split(/\r?\n/)
      const simplifiedLines = simplified.split(/\r?\n/)

      return originalLines.flatMap((line, index) =>
        line === simplifiedLines[index] ? [] : [`${file}:${index + 1}`],
      )
    })

    expect(failures).toEqual([])
  })

  it('keeps production build config off removed editing workflow ids', () => {
    const forbiddenProductionConfigPatterns = [
      /UploadGeminiStep/,
      /GeminiAnalysisStep/,
      /ProcessSceneLoopStep/,
      /ConcatenateScenesStep/,
      /"single-video"/,
      /"multi-video"/,
    ]
    const failures = PRODUCTION_CONFIG_FILES.flatMap((file) => {
      const text = readDoc(file)
      return forbiddenProductionConfigPatterns.flatMap((pattern) => {
        const match = pattern.exec(text)
        return match?.index === undefined
          ? []
          : [`${file}:${lineFor(text, match.index)} matched ${pattern}`]
      })
    })

    const obfuscateConfig = JSON.parse(readDoc('scripts/obfuscate-config.json')) as {
      reserved?: { workflowIds?: string[] }
    }

    expect(failures).toEqual([])
    expect(obfuscateConfig.reserved?.workflowIds).toEqual(['content-ingest', 'translation-dubbing'])
  })

  it('keeps license feature surfaces on current product capability names', () => {
    const failures = LEGACY_LICENSE_FEATURE_SURFACES.flatMap(({ file, patterns }) => {
      const text = readDoc(file)
      return patterns.flatMap((pattern) => {
        const match = pattern.exec(text)
        return match?.index === undefined
          ? []
          : [`${file}:${lineFor(text, match.index)} matched ${pattern}`]
      })
    })

    expect(failures).toEqual([])
  })

  it('keeps legacy Fish/Edge TTS behind an explicit environment gate', () => {
    const failures = LEGACY_TTS_GATE_SURFACES.flatMap(({ file, required }) => {
      const text = readDoc(file)
      return required.flatMap((pattern) =>
        pattern.test(text) ? [] : [`${file} missing required ${pattern}`],
      )
    })

    expect(failures).toEqual([])
  })

  it('keeps the legacy editing removal plan execution log in numeric order', () => {
    const file = 'docs/agent/legacy-editing-removal-plan.md'
    const text = readDoc(file)
    const lines = text.split(/\r?\n/)
    const logStartIndex = lines.findIndex((line) => /^64\. `\[已完成\]`/.test(line))

    expect(
      logStartIndex,
      `${file} should keep the numbered execution log anchor`,
    ).toBeGreaterThanOrEqual(0)

    const nextSuggestionIndex = lines.findIndex(
      (line, index) => index > logStartIndex && line.trim() === '下一步建议：',
    )
    const logLines = lines.slice(
      logStartIndex,
      nextSuggestionIndex === -1 ? undefined : nextSuggestionIndex,
    )
    const completedItemNumbers = logLines.flatMap((line) => {
      const match = /^(\d+)\. `\[已完成\]`/.exec(line)
      return match ? [Number(match[1])] : []
    })

    expect(completedItemNumbers.length, `${file} should have execution log items`).toBeGreaterThan(
      0,
    )
    expect(completedItemNumbers).toEqual(
      Array.from({ length: completedItemNumbers.length }, (_, index) => 64 + index),
    )
  })
})
