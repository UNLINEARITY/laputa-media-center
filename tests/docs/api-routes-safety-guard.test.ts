import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

function readApiRoutesDoc(): string {
  return readFileSync(path.join(ROOT, 'docs', 'agent', 'api-routes.md'), 'utf-8')
}

function readDoc(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), 'utf-8')
}

function extractDubbingPostExamples(text: string): string[] {
  const blockPattern = /```(?:bash|sh|shell|powershell)?\n([\s\S]*?)```/g
  return [...text.matchAll(blockPattern)]
    .map((match) => match[1] || '')
    .filter((block) => /curl[\s\S]*?-X\s+POST[\s\S]*?\/api\/dubbing\b/.test(block))
}

function extractReadinessPostExamples(text: string): string[] {
  const marker = 'curl -s -X POST http://localhost:8899/api/ingest/dubbing-readiness'
  const examples: string[] = []
  let start = text.indexOf(marker)

  while (start >= 0) {
    const end = text.indexOf('```', start)
    examples.push(end < 0 ? text.slice(start) : text.slice(start, end))
    start = text.indexOf(marker, start + marker.length)
  }

  return examples
}

function hasJsonFieldValue(block: string, field: string, value: string): boolean {
  return new RegExp(`\\\\?"${field}\\\\?"\\s*:\\s*\\\\?"${value}\\\\?"`).test(block)
}

describe('API routes safety guard', () => {
  it('keeps the static /api/dubbing example aligned with provider confirmation gates', () => {
    const examples = extractDubbingPostExamples(readApiRoutesDoc())

    expect(examples.length).toBeGreaterThan(0)
    for (const example of examples) {
      expect(example).toContain('ALLOW_PAID_DYNAMIC_TESTS')
      expect(example).toContain('usage_boundary_acknowledged')
      expect(example).toMatch(/"config"\s*:\s*\{[\s\S]*"confirmed_gate_ids"/)
      expect(example).toContain('translation_provider')
      expect(example).toContain('minimax_tts')
      expect(example).not.toContain('youtube_download')
      expect(example).not.toContain('real_provider_smoke')
      expect(example).not.toContain('source_url')
    }
    expect(readApiRoutesDoc()).toContain('/api/ingest/dubbing-readiness')
    expect(readApiRoutesDoc()).toContain('历史 `voice_usage_confirmed` 仅作为兼容字段读取')
  })

  it('documents provider smoke as dry-run by default and gates real provider calls', () => {
    const text = readApiRoutesDoc()
    const examples = extractReadinessPostExamples(text)
    const dryRunExamples = examples.filter((example) =>
      hasJsonFieldValue(example, 'mode', 'dry_run'),
    )

    expect(examples.length).toBeGreaterThanOrEqual(1)
    expect(dryRunExamples.length).toBeGreaterThan(0)
    for (const example of dryRunExamples) {
      expect(example).not.toContain('source_url')
      expect(example).not.toContain('confirmed_gate_ids')
      expect(example).not.toContain('ALLOW_PAID_DYNAMIC_TESTS')
      expect(example).not.toContain('/api/dubbing')
    }
    expect(text).toContain('默认 provider smoke 只做 dry-run')
    expect(text).toContain('普通 readiness dry-run 不传 `source_url`、不传 `confirmed_gate_ids`')
    expect(text).toContain('dry-run rehearsal 必须传同一 `source_url`')
    expect(text).toContain('source-bound dry-run evidence')
    expect(text).toContain('PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE')
    expect(text).toContain('PROVIDER_SMOKE_PREFLIGHT_RECEIPT_FILE')
    expect(text).toContain('provider_smoke_preflight_receipt')
    expect(text).toContain('provider_smoke_preflight_receipt_verification')
    expect(text).toContain('provider-smoke:receipt:verify')
    expect(text).toContain('不读取 `TEST_API_TOKEN`')
    expect(text).toContain('machine-bound')
    expect(text).toContain('command_hash')
    expect(text).toContain('durable failed/partial attempt ledger')
    expect(text).toContain('partial_ledger_record=true')
    expect(text).toContain('不计为成功 summary')
    expect(text).toContain('API 不保存 receipt')
    expect(text).toContain('API route 不读取 receipt 文件')
    expect(text).toContain('不校验 `PROVIDER_SMOKE_PREFLIGHT_RECEIPT_FILE`')
    expect(text).toContain('也不接受 receipt 作为 request 字段')
    expect(text).toContain(
      'CLI receipt 只保护 operator 本机 `provider-smoke:armed-run` command path',
    )
    expect(text).toContain('服务端 env gate')
    expect(text).toContain('服务端 command binding')
    expect(text).toContain('ledger/concurrency/budget gates')
    expect(text).toContain('DB-backed attempt reservation')
    expect(text).toContain('provider_smoke_attempt_reservation')
    expect(text).toContain('lease_expires_at')
    expect(text).toContain('lease token / fencing token')
    expect(text).toContain('reservation must be acquired before provider call')
    expect(text).toContain('file-only or memory-only concurrency')
    expect(text).toContain('attempt_reservation_id')
    expect(text).toContain('audit.runtime_fingerprint')
    expect(text).toContain('`content_ingest` 或 `translation_dubbing`')
    expect(text).toContain('Provider 调用边界正常形')
    expect(text).toContain('dubbing_job')
    expect(text).toContain('ALLOW_PAID_DYNAMIC_TESTS')
    expect(text).toContain('服务端会强制要求 `ALLOW_PAID_DYNAMIC_TESTS=true`')
    expect(text).toContain('armed-run SOP')
    expect(text).toContain('dry-run evidence')
    expect(text).toContain('预算上限')
    expect(text).toContain('总 runs 上限和并发上限')
    expect(text).toContain('runs <= max_runs')
    expect(text).toContain('concurrency <= max_concurrency')
    expect(text).toContain('按批次执行')
    expect(text).toContain('`job_id` 不是可省略字段')
    expect(text).not.toContain(
      '按 `required_confirmations` 明确提交对应的 `config.confirmed_gate_ids`',
    )
    expect(examples.some((example) => example.includes('"mode": "real_provider_smoke"'))).toBe(
      false,
    )
    expect(text).toContain('不混入 `youtube_download`')
  })

  it('keeps provider boundary references aligned in adjacent docs', () => {
    const docs = ['docs/dubbing-guide.md', 'docs/agent/video-processing.md']

    for (const relativePath of docs) {
      const text = readDoc(relativePath)

      expect(text).toContain('dry_run_provider_smoke')
      expect(text).toContain('real_provider_smoke')
      expect(text).toContain('dubbing_job')
      expect(text).toContain('youtube_download')
      expect(text).toContain('translation_provider')
      expect(text).toContain('minimax_tts')
      expect(text).toContain('/api/dubbing')
      expect(text).toContain('source-bound dry-run evidence')
      expect(text).toContain('manual_authorization')
      expect(text).toContain('runtime_fingerprint')
      expect(text).toContain('audit.runtime_fingerprint')
      expect(text).toMatch(/不(?:要求|混入|是).*YouTube gate|不能迁移到普通配音任务/)
    }

    expect(readDoc('docs/dubbing-guide.md')).toContain('provider_smoke_preflight_receipt')
    expect(readDoc('docs/dubbing-guide.md')).toContain(
      'provider_smoke_preflight_receipt_verification',
    )
    expect(readDoc('docs/dubbing-guide.md')).toContain('durable attempt / partial ledger')
    expect(readDoc('docs/dubbing-guide.md')).toContain('partial_ledger_record=true')
    expect(readDoc('docs/dubbing-guide.md')).toContain('API route 不读取 receipt 文件')
    expect(readDoc('docs/dubbing-guide.md')).toContain('CLI receipt 只保护 operator 本机')

    const staticConfigText = readDoc('docs/agent/testing/static/config-style.md')

    expect(staticConfigText).toContain('普通 `dry_run_provider_smoke`')
    expect(staticConfigText).toContain('source-bound dry-run evidence')
    expect(staticConfigText).toContain('manual_authorization')
    expect(staticConfigText).toContain('runtime_fingerprint')
    expect(staticConfigText).toContain('audit.runtime_fingerprint')
  })

  it('keeps the dubbing guide API examples framed as paid provider command bodies', () => {
    const text = readDoc('docs/dubbing-guide.md')

    expect(text).toContain('请求 body normal form')
    expect(text).toContain('ALLOW_PAID_DYNAMIC_TESTS=true')
    expect(text).toContain('不得混入 provider smoke 专用的 `source_url` 或 `youtube_download` gate')
    expect(text).not.toContain('"source_url"')
    expect(text).not.toContain('"youtube_download"')
  })

  it('documents manual final listen as a delivery audit check normal form', () => {
    const text = readApiRoutesDoc()

    expect(text).toContain('PATCH /api/jobs/:id/manual-final-listen')
    expect(text).toContain('manual_final_listen')
    expect(text).toContain('不改变自动 QA 分数')
    expect(text).toContain('`not_recorded`')
    expect(text).toContain('`pending`')
    expect(text).toContain('`passed`')
    expect(text).toContain('`failed`')
    expect(text).toContain('`waived`')
    expect(text).toContain('交付审计阻断')
  })

  it('documents credential status as a source-aware normal form', () => {
    const text = readApiRoutesDoc()

    expect(text).toContain('凭证状态 normal form')
    expect(text).toContain('`missing`')
    expect(text).toContain('`saved_unverified`')
    expect(text).toContain('`verified`')
    expect(text).toContain('`not_tracked`')
    expect(text).toContain('保存不等于验证')
    expect(text).toContain('`fish_audio_vertex` / `fish_audio_ai_studio`')
    expect(text).toContain('`LEGACY_TTS_ENABLED=false`')
    expect(text).toContain('`410 LEGACY_TTS_DISABLED`')
    expect(text).toContain('`LEGACY_TTS_ENABLED=true`')
    expect(text).toContain('不支持 `save_only`')
    expect(text).toContain('若触发真实 Fish Audio API Key 写入验证或旧兼容音色验证')
    expect(text).toContain('`confirmLegacyTts` / `confirmLegacyFishAudio`')
    expect(text).toContain('`GEMINI_API_KEY` / `GOOGLE_AI_STUDIO_API_KEY`')
    expect(text).toContain('`translation_credential_status.runtime`')
    expect(text).toContain('`api_key_source`')
    expect(text).toContain('`model_id`')
    expect(text).toContain('`model_source`')
    expect(text).toContain('`api_base_url_source`')
    expect(text).toContain('不返回 API key')
    expect(text).toContain(
      '`google_vertex` 与 `google_storage` adapter 目前只读取设置页加密保存的凭证',
    )
    expect(text).toContain('`GOOGLE_APPLICATION_CREDENTIALS`')
    expect(text).toContain('`GCS_BUCKET`')
    expect(text).toContain('不能显示成 `not_tracked`')
  })

  it('keeps AI integration docs aligned with translation runtime summaries', () => {
    const text = readDoc('docs/agent/ai-integration.md')

    expect(text).toContain('`translation_credential_status.runtime`')
    expect(text).toContain('`api_key_source`')
    expect(text).toContain('`model_id`')
    expect(text).toContain('`model_source`')
    expect(text).toContain('`api_base_url_source`')
    expect(text).toContain('/dubbing')
    expect(text).toContain('真实 provider 确认区')
    expect(text).toContain('不会返回 API key')
  })
})
