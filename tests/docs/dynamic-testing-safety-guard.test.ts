import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const DYNAMIC_DOC_DIR = path.join(ROOT, 'docs', 'agent', 'testing', 'dynamic')
const PACKAGE_JSON_PATH = path.join(ROOT, 'package.json')
const PROVIDER_DRY_RUN_SCRIPT = path.join(ROOT, 'scripts', 'provider-smoke-dry-run-rehearsal.mjs')
const PROVIDER_ARMED_RUN_SCRIPT = path.join(ROOT, 'scripts', 'provider-smoke-armed-run.mjs')
const PROVIDER_RUNTIME_FINGERPRINT_SCRIPT = path.join(
  ROOT,
  'scripts',
  'provider-smoke-runtime-fingerprint.mjs',
)
const PROVIDER_PREFLIGHT_SNAPSHOT_DOC = 'provider-smoke-preflight-handoff-snapshots.md'
const PROVIDER_BOUNDARY_API_DOCS = ['cloud-api.md', 'local-api.md']
const PROVIDER_BOUNDARY_REFERENCE_DOC_PATHS = [
  path.join(ROOT, 'docs', 'agent', 'api-routes.md'),
  path.join(ROOT, 'docs', 'agent', 'video-processing.md'),
  path.join(ROOT, 'docs', 'dubbing-guide.md'),
]
const PROVIDER_BOUNDARY_UI_DOCS = [
  'cloud-ui.md',
  'local-ui.md',
  'cloud-workflow.md',
  'local-workflow.md',
]
const PROVIDER_BOUNDARY_WORKFLOW_DOCS = ['cloud-workflow.md', 'local-workflow.md']
const PROVIDER_BOUNDARY_TASK_CONTROL_DOCS = ['cloud-task-control.md', 'local-task-control.md']

type DynamicDoc = {
  file: string
  text: string
}

type ForbiddenPattern = {
  name: string
  pattern: RegExp
}

type BashBlock = {
  file: string
  startLine: number
  body: string
}

const FORBIDDEN_DYNAMIC_DOC_PATTERNS: ForbiddenPattern[] = [
  {
    name: 'full API token-shaped cca_ value',
    pattern: /\bcca_[A-Za-z0-9_-]{8,}\b/g,
  },
  {
    name: 'copyable production API command target',
    pattern:
      /https:\/\/chuangcut\.zeabur\.app\/api\/(?:dubbing|jobs|auth\/tokens|storage\/cleanup|storage\/stats|configs|api-keys|gemini\/(?:test|models)|google-storage\/test)\b/g,
  },
  {
    name: 'real Zeabur CLI id',
    pattern:
      /zeabur\s+service\s+(?:restart|list)[^\n]*--(?:id|env-id)\s+(?!["<]|\$\{)(?:[A-Za-z0-9_-]{12,})/g,
  },
  {
    name: 'legacy styles success list count',
    pattern: /预设风格\s*\(16\)|预设风格列表显示\s*\d+\s*个风格/g,
  },
  {
    name: 'legacy styles preview success copy',
    pattern: /风格预览：\{?风格名称\}?|视频分析提示词|音画同步提示词/g,
  },
]

function readDynamicDocs(): DynamicDoc[] {
  return readdirSync(DYNAMIC_DOC_DIR)
    .filter((file) => file.endsWith('.md'))
    .sort()
    .map((file) => ({
      file: path.join('docs', 'agent', 'testing', 'dynamic', file),
      text: readFileSync(path.join(DYNAMIC_DOC_DIR, file), 'utf-8'),
    }))
}

function readProviderBoundaryReferenceDocs(): DynamicDoc[] {
  return PROVIDER_BOUNDARY_REFERENCE_DOC_PATHS.map((filePath) => ({
    file: path.relative(ROOT, filePath),
    text: readFileSync(filePath, 'utf-8'),
  }))
}

function lineFor(text: string, index: number): number {
  return text.slice(0, Math.max(0, index)).split('\n').length
}

function findForbiddenPatternFailures(doc: DynamicDoc): string[] {
  const failures: string[] = []

  for (const forbidden of FORBIDDEN_DYNAMIC_DOC_PATTERNS) {
    for (const match of doc.text.matchAll(forbidden.pattern)) {
      failures.push(`${doc.file}:${lineFor(doc.text, match.index || 0)} ${forbidden.name}`)
    }
  }

  return failures
}

function extractBashBlocks(doc: DynamicDoc): BashBlock[] {
  const blocks: BashBlock[] = []
  const blockPattern = /```[^\n]*\n([\s\S]*?)```/g

  for (const match of doc.text.matchAll(blockPattern)) {
    const body = match[1]
    if (!body) continue

    blocks.push({
      file: doc.file,
      startLine: lineFor(doc.text, match.index || 0),
      body,
    })
  }

  return blocks
}

function extractBetween(text: string, startMarker: string, endMarker: string): string | null {
  const startIndex = text.indexOf(startMarker)
  if (startIndex < 0) return null
  const endIndex = text.indexOf(endMarker, startIndex + startMarker.length)
  if (endIndex < 0) return null
  return text.slice(startIndex, endIndex)
}

function hasDubbingPost(block: string): boolean {
  return /curl[\s\S]*?-X\s+POST[\s\S]*?\/api\/dubbing\b/.test(block)
}

function hasReadinessPost(block: string): boolean {
  return /curl[\s\S]*?-X\s+POST[\s\S]*?\/api\/ingest\/dubbing-readiness\b/.test(block)
}

function hasReadinessEndpoint(block: string): boolean {
  return /\/api\/ingest\/dubbing-readiness\b/.test(block)
}

function hasJsonFieldValue(block: string, field: string, value: string): boolean {
  return new RegExp(`\\\\?"${field}\\\\?"\\s*:\\s*\\\\?"${value}\\\\?"`).test(block)
}

function hasJsonBooleanValue(block: string, field: string, value: boolean): boolean {
  return new RegExp(`\\\\?"${field}\\\\?"\\s*:\\s*${value ? 'true' : 'false'}`).test(block)
}

function hasRealProviderSmoke(block: string): boolean {
  return hasReadinessPost(block) && hasJsonFieldValue(block, 'mode', 'real_provider_smoke')
}

function hasCopyableRealProviderSmokeCommandObject(block: string): boolean {
  return hasJsonFieldValue(block, 'mode', 'real_provider_smoke')
}

function hasDryRunProviderSmoke(block: string): boolean {
  return hasReadinessPost(block) && hasJsonFieldValue(block, 'mode', 'dry_run')
}

function hasApiKeySaveEndpoint(block: string): boolean {
  return (
    /curl[\s\S]*?-X\s+POST[\s\S]*?\/api\/api-keys\b/.test(block) &&
    !/\/api\/api-keys\/verify\b/.test(block)
  )
}

function hasApiKeyVerifyEndpoint(block: string): boolean {
  return /curl[\s\S]*?-X\s+POST[\s\S]*?\/api\/api-keys\/verify\b/.test(block)
}

function hasDirectProviderTestEndpoint(block: string): boolean {
  return /curl[\s\S]*?-X\s+POST[\s\S]*?\/api\/(?:gemini\/(?:test|models)|google-storage\/test)\b/.test(
    block,
  )
}

function hasCredentialSaveOnly(block: string): boolean {
  return hasApiKeySaveEndpoint(block) && hasJsonFieldValue(block, 'operation', 'save_only')
}

function hasApiKeyProviderVerification(block: string): boolean {
  if (hasApiKeyVerifyEndpoint(block) || hasDirectProviderTestEndpoint(block)) return true
  return hasApiKeySaveEndpoint(block) && !hasCredentialSaveOnly(block)
}

function hasLegacyTtsVerification(block: string): boolean {
  return (
    /curl[\s\S]*?-X\s+POST[\s\S]*?\/api\/api-keys(?:\/verify)?\b/.test(block) &&
    /"service":\s*"fish_audio_(?:vertex|ai_studio)"/.test(block)
  )
}

function hasDestructiveDelete(block: string): boolean {
  return /curl[\s\S]*?-X\s+DELETE\b/.test(block)
}

function hasDestructiveCleanupExecution(block: string): boolean {
  return (
    /curl[\s\S]*?-X\s+POST[\s\S]*?\/api\/storage\/cleanup\b/.test(block) &&
    hasJsonBooleanValue(block, 'preview', false)
  )
}

function hasLegacyJobsWriteNegative(block: string): boolean {
  return /curl[^\n]*?-X\s+POST[^\n]*?\/api\/jobs\b/.test(block)
}

function hasLegacyStylesWriteNegative(block: string): boolean {
  return /curl[\s\S]*?-X\s+(?:POST|PUT)[\s\S]*?\/api\/styles\b/.test(block)
}

function hasLegacyStylesDeleteNegative(block: string): boolean {
  return /curl[\s\S]*?-X\s+DELETE[\s\S]*?\/api\/styles\b/.test(block)
}

function hasConcurrencyStress(block: string): boolean {
  return /for\s+\w+\s+in\s+\{?1\.\.\d+\}?/.test(block) && /&/.test(block)
}

function hasServiceRestart(block: string): boolean {
  return /zeabur\s+service\s+restart/.test(block)
}

function findCommandGateFailures(doc: DynamicDoc): string[] {
  return extractBashBlocks(doc).flatMap((block) => {
    const failures: string[] = []
    const location = `${block.file}:${block.startLine}`

    if (hasDubbingPost(block.body) && !block.body.includes('ALLOW_PAID_DYNAMIC_TESTS')) {
      failures.push(`${location} POST /api/dubbing must include ALLOW_PAID_DYNAMIC_TESTS`)
    }

    if (hasDubbingPost(block.body) && !block.body.includes('confirmed_gate_ids')) {
      failures.push(`${location} POST /api/dubbing must include confirmed_gate_ids`)
    }

    if (hasDubbingPost(block.body) && block.body.includes('youtube_download')) {
      failures.push(`${location} POST /api/dubbing must not include youtube_download`)
    }

    if (hasCopyableRealProviderSmokeCommandObject(block.body)) {
      failures.push(
        `${location} real provider smoke must use scripts/provider-smoke-armed-run.mjs instead of copyable API command object`,
      )
    }

    if (
      hasApiKeyProviderVerification(block.body) &&
      !block.body.includes('ALLOW_PAID_DYNAMIC_TESTS')
    ) {
      failures.push(
        `${location} API key provider verification must include ALLOW_PAID_DYNAMIC_TESTS`,
      )
    }

    if (
      hasApiKeyProviderVerification(block.body) &&
      !block.body.includes('confirmPaidVerification')
    ) {
      failures.push(`${location} provider verification must include confirmPaidVerification`)
    }

    if (hasLegacyTtsVerification(block.body) && !block.body.includes('confirmLegacyTts')) {
      failures.push(`${location} legacy TTS verification must include confirmLegacyTts`)
    }

    if (hasRealProviderSmoke(block.body) && !block.body.includes('ALLOW_PAID_DYNAMIC_TESTS')) {
      failures.push(`${location} real provider smoke must include ALLOW_PAID_DYNAMIC_TESTS`)
    }

    if (hasRealProviderSmoke(block.body) && !block.body.includes('confirmed_gate_ids')) {
      failures.push(`${location} real provider smoke must include confirmed_gate_ids`)
    }

    if (hasRealProviderSmoke(block.body) && !block.body.includes('source_url')) {
      failures.push(`${location} real provider smoke must include source_url`)
    }

    if (
      hasDestructiveDelete(block.body) &&
      !block.body.includes('ALLOW_DESTRUCTIVE_DYNAMIC_TESTS')
    ) {
      failures.push(`${location} DELETE command must include ALLOW_DESTRUCTIVE_DYNAMIC_TESTS`)
    }

    if (
      hasDestructiveCleanupExecution(block.body) &&
      !block.body.includes('ALLOW_DESTRUCTIVE_DYNAMIC_TESTS')
    ) {
      failures.push(
        `${location} storage cleanup execution must include ALLOW_DESTRUCTIVE_DYNAMIC_TESTS`,
      )
    }

    if (
      hasDestructiveCleanupExecution(block.body) &&
      !block.body.includes('destructive_confirmation')
    ) {
      failures.push(`${location} storage cleanup execution must include destructive_confirmation`)
    }

    if (
      hasLegacyJobsWriteNegative(block.body) &&
      !block.body.includes('ALLOW_LEGACY_WRITE_NEGATIVE_TESTS')
    ) {
      failures.push(
        `${location} legacy /api/jobs write negative test must include ALLOW_LEGACY_WRITE_NEGATIVE_TESTS`,
      )
    }

    if (
      hasLegacyJobsWriteNegative(block.body) &&
      !/mock:\/\/(?:guide-)?legacy\//.test(block.body)
    ) {
      failures.push(`${location} legacy /api/jobs write negative test must use mock://legacy input`)
    }

    if (
      hasLegacyJobsWriteNegative(block.body) &&
      /https?:\/\/[^\s"'`]*r2\.dev\b/.test(block.body)
    ) {
      failures.push(`${location} legacy /api/jobs write negative test must not use real R2 media`)
    }

    if (
      hasLegacyStylesWriteNegative(block.body) &&
      !block.body.includes('ALLOW_LEGACY_WRITE_NEGATIVE_TESTS')
    ) {
      failures.push(
        `${location} legacy /api/styles write negative test must include ALLOW_LEGACY_WRITE_NEGATIVE_TESTS`,
      )
    }

    if (
      hasLegacyStylesDeleteNegative(block.body) &&
      !block.body.includes('ALLOW_LEGACY_WRITE_NEGATIVE_TESTS')
    ) {
      failures.push(
        `${location} legacy /api/styles delete negative test must include ALLOW_LEGACY_WRITE_NEGATIVE_TESTS`,
      )
    }

    if (
      (hasLegacyStylesWriteNegative(block.body) || hasLegacyStylesDeleteNegative(block.body)) &&
      /STYLE_ID="<风格ID>"/.test(block.body)
    ) {
      failures.push(`${location} legacy /api/styles negative test must use a fixed fake style id`)
    }

    if (
      hasLegacyStylesWriteNegative(block.body) &&
      /通过API创建的测试风格|本地测试风格/.test(block.body)
    ) {
      failures.push(`${location} legacy /api/styles negative test must not use success-path copy`)
    }

    if (hasConcurrencyStress(block.body) && !block.body.includes('ALLOW_STRESS_DYNAMIC_TESTS')) {
      failures.push(
        `${location} concurrency stress command must include ALLOW_STRESS_DYNAMIC_TESTS`,
      )
    }

    if (hasServiceRestart(block.body) && !block.body.includes('ALLOW_PROD_DYNAMIC_TESTS')) {
      failures.push(`${location} service restart must include ALLOW_PROD_DYNAMIC_TESTS`)
    }

    return failures
  })
}

function findCloudUiOperationGateFailures(doc: DynamicDoc): string[] {
  if (!doc.file.endsWith('cloud-ui.md')) return []
  const failures: string[] = []

  if (
    /验证并保存/.test(doc.text) &&
    (!doc.text.includes('ALLOW_CONFIG_DYNAMIC_TESTS') ||
      !doc.text.includes('ALLOW_PAID_DYNAMIC_TESTS'))
  ) {
    failures.push(`${doc.file}:1 cloud UI config validation must document config and paid gates`)
  }

  return failures
}

function findConfigUiSaveOnlyDocFailures(doc: DynamicDoc): string[] {
  if (!['cloud-ui.md', 'local-ui.md'].some((file) => doc.file.endsWith(file))) return []
  const failures: string[] = []
  const requiredText = [
    'Google AI Studio「保存配置」',
    'Vertex AI 与 GCS「保存配置」',
    '已保存/待验证',
    '未执行真实 Gemini provider 调用',
    '未上传或删除测试对象',
  ]

  for (const text of requiredText) {
    if (!doc.text.includes(text)) {
      failures.push(`${doc.file}:1 missing config save-only UI invariant: ${text}`)
    }
  }

  const forbiddenText = [
    'Gemini AI Studio：验证通过',
    'Gemini Vertex AI：验证通过',
    'GCS 存储：验证通过',
  ]
  for (const text of forbiddenText) {
    if (doc.text.includes(text)) {
      failures.push(
        `${doc.file}:1 Google/GCS config UI must not present save-only as verified: ${text}`,
      )
    }
  }

  return failures
}

function findPaidVerificationUiGateFailures(doc: DynamicDoc): string[] {
  if (!['cloud-ui.md', 'local-ui.md'].some((file) => doc.file.endsWith(file))) return []

  const mentionsPaidVerification =
    /付费验证一次/.test(doc.text) || /真实 provider 验证入口/.test(doc.text)
  if (!mentionsPaidVerification) return []

  return doc.text.includes('ALLOW_PAID_DYNAMIC_TESTS=true')
    ? []
    : [`${doc.file}:1 paid provider UI verification must document ALLOW_PAID_DYNAMIC_TESTS=true`]
}

function findProviderBoundaryApiDocFailures(doc: DynamicDoc): string[] {
  if (!PROVIDER_BOUNDARY_API_DOCS.some((file) => doc.file.endsWith(file))) return []
  const failures: string[] = []
  const requiredText = [
    'Provider 调用边界正常形',
    'Provider smoke 压力测试正常形',
    'dry_run_provider_smoke',
    'real_provider_smoke',
    'dubbing_job',
    'ProviderSmokeAudit',
    'job_id',
    '`dry_run_provider_smoke` rehearsal 只能使用 `ALLOW_STRESS_DYNAMIC_TESTS`',
    'no-paid provider-smoke readiness / preflight handoff snapshots 正常形',
    'provider-smoke-preflight-handoff-snapshots.md',
    '/api/runtime/fingerprint',
    'runtime fingerprint',
    'runtime_fingerprint',
    'latest dry-run epoch',
    'next_build_id',
    'runtime_booted_at',
    '/api/health` 只作为 liveness/license 检查',
    'config.confirmed_gate_ids',
    '不混入 `youtube_download`',
    '凭证状态正常形',
    '`verification_state`',
    '`missing`',
    '`saved_unverified`',
    '`verified`',
    '`not_tracked`',
    '保存不等于验证',
    'google_ai_studio',
    'google_vertex',
    'google_storage',
    'runtime adapter 实际会读取',
    'GOOGLE_APPLICATION_CREDENTIALS',
    'GOOGLE_CLOUD_PROJECT',
    'GCS_BUCKET',
    'GEMINI_API_KEY',
    'GOOGLE_AI_STUDIO_API_KEY',
    'translation_credential_status.runtime',
    'minimax_credential_status.verification_state',
    'api_key_source',
    'model_id',
    'model_source',
    'api_base_url_source',
    '不得返回 API key',
    '`google_vertex` 与 `google_storage` 当前只读设置页加密凭证',
    '不得让它们显示为 `not_tracked`',
    'Fish Audio 只属于旧 TTS 兼容检查，不支持 `save_only`',
    'LEGACY_TTS_ENABLED=true',
    '410 LEGACY_TTS_DISABLED',
    '不支持 `save_only`',
    'confirmLegacyTts',
    'confirmLegacyFishAudio',
    'CLI 执行入口: `pnpm provider-smoke:armed-run`',
    '内部 API endpoint: `POST /api/ingest/dubbing-readiness`',
    '确认 ID 不是执行授权',
    'provider_smoke_preflight_receipt',
    'PROVIDER_SMOKE_PREFLIGHT_RECEIPT_FILE',
  ]

  for (const text of requiredText) {
    if (!doc.text.includes(text)) {
      failures.push(`${doc.file}:1 missing provider boundary text: ${text}`)
    }
  }

  if (doc.text.includes('`/api/dubbing/status` 不再把 `MiniMax TTS 凭证` 列为缺失项')) {
    failures.push(
      `${doc.file}:1 MiniMax runtime status must assert verification_state, not only absence from missing list`,
    )
  }

  const bashBlocks = extractBashBlocks(doc)
  const canonicalArmedRunPreflightBlocks = bashBlocks.filter((block) =>
    block.body.includes('pnpm provider-smoke:armed-run:preflight'),
  )
  const canonicalArmedRunExecutionBlocks = bashBlocks.filter((block) =>
    /pnpm\s+provider-smoke:armed-run(?:\s|$)/.test(block.body),
  )

  if (canonicalArmedRunPreflightBlocks.length === 0) {
    failures.push(`${doc.file}:1 missing canonical provider smoke armed-run preflight command`)
  }

  if (canonicalArmedRunExecutionBlocks.length === 0) {
    failures.push(`${doc.file}:1 missing canonical provider smoke armed-run execution command`)
  }

  for (const block of bashBlocks) {
    if (
      block.body.includes('pnpm provider-smoke:armed-run:preflight') &&
      /&&\s*(?:\\\s*)?\n?\s*pnpm\s+provider-smoke:armed-run(?:\s|$)/.test(block.body)
    ) {
      failures.push(
        `${block.file}:${block.startLine} armed-run preflight and paid execution must be separated by manual review text`,
      )
    }
  }

  const copyableRealProviderSmokeBlocks = extractBashBlocks(doc).filter(
    (block) =>
      hasCopyableRealProviderSmokeCommandObject(block.body) ||
      (hasReadinessEndpoint(block.body) &&
        hasJsonFieldValue(block.body, 'mode', 'real_provider_smoke')),
  )

  for (const block of copyableRealProviderSmokeBlocks) {
    failures.push(
      `${block.file}:${block.startLine} real provider smoke must use scripts/provider-smoke-armed-run.mjs instead of copyable curl or command object`,
    )
  }

  const dryRunRehearsalBlocks = extractBashBlocks(doc).filter((block) =>
    block.body.includes('DRY_RUN_PROVIDER_SMOKE_REHEARSAL_RUNS'),
  )

  if (dryRunRehearsalBlocks.length === 0) {
    failures.push(`${doc.file}:1 missing dry-run provider smoke rehearsal command`)
  }

  for (const block of dryRunRehearsalBlocks) {
    const location = `${block.file}:${block.startLine}`

    if (!hasDryRunProviderSmoke(block.body)) {
      failures.push(`${location} dry-run provider smoke rehearsal must call dry_run mode`)
    }

    if (!block.body.includes('ALLOW_STRESS_DYNAMIC_TESTS')) {
      failures.push(`${location} dry-run provider smoke rehearsal must include stress gate`)
    }

    if (block.body.includes('ALLOW_PAID_DYNAMIC_TESTS')) {
      failures.push(`${location} dry-run provider smoke rehearsal must not require paid gate`)
    }

    if (!block.body.includes('DRY_RUN_PROVIDER_SMOKE_SOURCE_URL')) {
      failures.push(`${location} dry-run provider smoke rehearsal must declare source URL env`)
    }

    if (!block.body.includes('source_url')) {
      failures.push(`${location} dry-run provider smoke rehearsal must submit source_url`)
    }

    if (!block.body.includes('source_ref')) {
      failures.push(`${location} dry-run provider smoke rehearsal must assert source_ref`)
    }

    if (block.body.includes('confirmed_gate_ids')) {
      failures.push(`${location} dry-run provider smoke rehearsal must not include confirmed gates`)
    }

    if (block.body.includes('/api/dubbing')) {
      failures.push(`${location} dry-run provider smoke rehearsal must not create dubbing jobs`)
    }
  }

  const dryRunAuditBlocks = extractBashBlocks(doc).filter(
    (block) =>
      block.body.includes('DRY_RUN_PROVIDER_SMOKE_AUDIT_JOB_ID') ||
      block.body.includes('DRY_RUN_PROVIDER_SMOKE_EVIDENCE_LOG') ||
      block.body.includes('PROVIDER_SMOKE_AUDIT_LOG'),
  )

  if (dryRunAuditBlocks.length === 0) {
    failures.push(`${doc.file}:1 missing job-bound dry-run provider smoke audit log command`)
  }

  for (const block of dryRunAuditBlocks) {
    const location = `${block.file}:${block.startLine}`

    if (!hasDryRunProviderSmoke(block.body)) {
      failures.push(`${location} dry-run audit log command must call dry_run mode`)
    }

    if (!block.body.includes('ALLOW_STRESS_DYNAMIC_TESTS')) {
      failures.push(`${location} dry-run audit log command must include stress gate`)
    }

    if (!block.body.includes('DRY_RUN_PROVIDER_SMOKE_AUDIT_JOB_ID')) {
      failures.push(`${location} dry-run audit log command must bind an audit job id`)
    }

    if (
      !block.body.includes('DRY_RUN_PROVIDER_SMOKE_EVIDENCE_LOG') &&
      !block.body.includes('PROVIDER_SMOKE_AUDIT_LOG')
    ) {
      failures.push(`${location} dry-run audit log command must write an NDJSON audit log`)
    }

    if (!/pids="\$\{pids\} \$!"/.test(block.body) || !/wait "\$\{pid\}"/.test(block.body)) {
      failures.push(`${location} dry-run audit log command must fail on child process errors`)
    }

    if (!block.body.includes('run_limit')) {
      failures.push(`${location} dry-run audit log command must record expected run limit`)
    }

    if (!block.body.includes('external_calls_executed == false')) {
      failures.push(`${location} dry-run audit log command must assert no external calls`)
    }

    if (!block.body.includes('/api/jobs?limit=1&offset=0')) {
      failures.push(`${location} dry-run audit log command must count jobs before and after`)
    }

    if (!block.body.includes('/api/runtime/fingerprint')) {
      failures.push(`${location} dry-run audit log command must read runtime fingerprint first`)
    }

    if (
      block.body.indexOf('/api/runtime/fingerprint') >
      block.body.indexOf('/api/jobs?limit=1&offset=0')
    ) {
      failures.push(
        `${location} dry-run audit log command must read runtime fingerprint before jobs`,
      )
    }

    if (!block.body.includes("jq -e '.total'")) {
      failures.push(`${location} dry-run audit log command must read the jobs total`)
    }

    for (const field of [
      'audit_job_id',
      'runtime_fingerprint',
      'pre_job_count',
      'post_job_count',
      'job_count_delta',
    ]) {
      if (!block.body.includes(field)) {
        failures.push(`${location} dry-run audit log command must record ${field}`)
      }
    }

    if (block.body.includes('job_created: false')) {
      failures.push(`${location} dry-run audit log command must not hard-code job_created=false`)
    }

    if (!/job_created:\s*\(\$job_count_delta\s*>\s*0\)/.test(block.body)) {
      failures.push(
        `${location} dry-run audit log command must derive job_created from count delta`,
      )
    }

    if (!block.body.includes('job_count_delta_total')) {
      failures.push(`${location} dry-run audit log summary must include job_count_delta_total`)
    }

    if (!block.body.includes('expected_runs')) {
      failures.push(`${location} dry-run audit log summary must include expected_runs`)
    }

    if (!block.body.includes('run_count == .expected_runs')) {
      failures.push(`${location} dry-run audit log summary must reject partial run logs`)
    }

    if (!block.body.includes('[range(1; .expected_runs + 1)] - .run_numbers')) {
      failures.push(`${location} dry-run audit log summary must reject missing run numbers`)
    }

    if (!block.body.includes('jq -e -s')) {
      failures.push(`${location} dry-run audit log summary must fail closed with jq -e -s`)
    }

    if (!block.body.includes('job_count_delta_total == 0')) {
      failures.push(`${location} dry-run audit log summary must reject job count deltas`)
    }

    if (!block.body.includes('job_created == false')) {
      failures.push(`${location} dry-run audit log summary must reject job creation`)
    }

    if (!block.body.includes('verdict == "ready"')) {
      failures.push(`${location} dry-run audit log summary must require ready verdicts`)
    }

    if (!block.body.includes('blocked_count_total == 0')) {
      failures.push(`${location} dry-run audit log summary must reject blocked results`)
    }

    if (/\.result_counts\??\.blocked\s*\/\/\s*0/.test(block.body)) {
      failures.push(
        `${location} dry-run audit log summary must not default missing blocked counts to zero`,
      )
    }

    if (!block.body.includes('result_counts.blocked must be numeric')) {
      failures.push(`${location} dry-run audit log summary must require numeric blocked counts`)
    }

    if (!block.body.includes('type == "number"')) {
      failures.push(`${location} dry-run audit log summary must type-check blocked counts`)
    }

    if (!block.body.includes('writes_artifacts == false')) {
      failures.push(`${location} dry-run audit log command must assert no artifact writes`)
    }

    if (block.body.includes('ALLOW_PAID_DYNAMIC_TESTS')) {
      failures.push(`${location} dry-run audit log command must not require paid gate`)
    }

    if (!block.body.includes('DRY_RUN_PROVIDER_SMOKE_SOURCE_URL')) {
      failures.push(`${location} dry-run audit log command must declare source URL env`)
    }

    if (!block.body.includes('source_url')) {
      failures.push(`${location} dry-run audit log command must submit source_url`)
    }

    if (!block.body.includes('source_ref')) {
      failures.push(`${location} dry-run audit log command must persist source_ref`)
    }

    if (block.body.includes('confirmed_gate_ids')) {
      failures.push(`${location} dry-run audit log command must not include confirmed gates`)
    }

    if (block.body.includes('/api/dubbing')) {
      failures.push(`${location} dry-run audit log command must not create dubbing jobs`)
    }
  }

  const armedRunChecklistText = [
    '真实 provider smoke armed-run invariant checklist',
    '唯一付费执行入口',
    'scripts/provider-smoke-armed-run.mjs',
    'ALLOW_PAID_DYNAMIC_TESTS === "true"',
    'ALLOW_STRESS_DYNAMIC_TESTS === "true"',
    'REAL_PROVIDER_SMOKE_SOURCE_URL',
    'REAL_PROVIDER_SMOKE_AUDIT_JOB_ID',
    '服务端 command binding',
    'REAL_PROVIDER_SMOKE_AUDIT_JOB_ID == request job_id',
    'REAL_PROVIDER_SMOKE_SOURCE_URL` 生成 request `source_url',
    'DRY_RUN_PROVIDER_SMOKE_EVIDENCE_LOG',
    'DRY_RUN_PROVIDER_SMOKE_EVIDENCE_MAX_AGE_MS',
    'PROVIDER_SMOKE_MAX_BUDGET_USD',
    'PROVIDER_SMOKE_STRESS_RUNS',
    'PROVIDER_SMOKE_MAX_RUNS',
    'PROVIDER_SMOKE_MAX_CONCURRENCY',
    'PROVIDER_SMOKE_ESTIMATED_COST_PER_RUN_USD',
    'PROVIDER_SMOKE_ARMED_RUN_LOG',
    'provider-smoke:readiness:bundle',
    'provider-smoke:handoff:verify',
    'provider-smoke:pressure-plan',
    'provider-smoke:manual-auth:prepare',
    'provider-smoke:receipt:verify',
    'PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE',
    'PROVIDER_SMOKE_HANDOFF_VERIFY_ROOT',
    'PROVIDER_SMOKE_HANDOFF_VERIFY_FILE',
    'PROVIDER_SMOKE_HANDOFF_VERIFY_MARKDOWN_FILE',
    'Runtime fingerprint',
    '/api/runtime/fingerprint',
    'runtime fingerprint',
    'next_build_id',
    'runtime_booted_at',
    '/api/health` 不作为版本或 build 指纹',
    'runs <= max_runs',
    'concurrency <= max_concurrency',
    'runs` 可以大于 `max_concurrency`',
    '按批次执行',
    'source_ref.host + url_sha256',
    'source_ref.host + url_sha256 == request source_url',
    'server latest ProviderSmokeAudit',
    'server latest dry-run epoch ProviderSmokeAudit',
    'ok=true',
    'verdict=ready',
    'blocked=0',
    'missing/unknown confirmations',
    'job_count_delta=0',
    'runtime_fingerprint',
    'failed/blocked/stale/mismatched',
    'provider-smoke-real.ndjson',
    'durable attempt ledger',
    'DB-backed attempt reservation',
    'provider_smoke_attempt_reservation',
    'lease_expires_at',
    'lease token / fencing token',
    'reservation must be acquired before provider call',
    'file-only or memory-only concurrency',
    'attempt_reservation_id',
    'redacted failed/partial attempt ledger',
    'partial armed-run ledger',
    'partial_ledger_record=true',
    'provider 抛错、HTTP 非 2xx、超时或响应 JSON 损坏',
    '不计为成功、不写成功 summary',
    '不复制 real_provider_smoke curl',
  ]

  for (const text of armedRunChecklistText) {
    if (!doc.text.includes(text)) {
      failures.push(`${doc.file}:1 missing provider smoke armed-run invariant: ${text}`)
    }
  }

  if (doc.text.includes('runs <= max_concurrency')) {
    failures.push(`${doc.file}:1 must not treat max_concurrency as a total run-count limit`)
  }

  const armedRunHandoffText = [
    '真实 provider smoke redacted preflight handoff checklist',
    'Handoff primitive',
    '只允许记录的 redacted value / invariant',
    '人工授权',
    'Source reference',
    '不得记录原始 `REAL_PROVIDER_SMOKE_SOURCE_URL`',
    'Auth reference',
    '不得记录 `TEST_API_TOKEN`',
    'Audit binding',
    'REAL_PROVIDER_SMOKE_AUDIT_JOB_ID == request job_id',
    'Budget limit',
    'Evidence freshness',
    'Output reference',
    'Preflight result',
    'mode=real_provider_smoke_preflight',
    'redacted_handoff_template.copyable_checklist',
    'ready_to_arm=false',
    '非执行性记录',
    '具体格式、字段顺序和渲染方式不作为公开契约',
    '只复述上方 handoff primitives',
    '不得包含 `TEST_API_TOKEN`、cookie、header、原始 `REAL_PROVIDER_SMOKE_SOURCE_URL`、完整 NDJSON 或 provider 响应正文',
    'command_object',
    'required_env',
    'missing_required_env',
    'invalid_required_env',
    'paid_gate_valid',
    'stress_gate_valid',
    'dry_run_evidence',
    'over_run_limit',
    'over_concurrency_limit',
    'over_budget',
    'ALLOW_PAID_DYNAMIC_TESTS=true',
    'ALLOW_STRESS_DYNAMIC_TESTS',
    'PROVIDER_SMOKE_MAX_BUDGET_USD',
    'PROVIDER_SMOKE_MAX_RUNS',
    'PROVIDER_SMOKE_MAX_CONCURRENCY',
    'PROVIDER_SMOKE_ESTIMATED_COST_PER_RUN_USD',
    'PROVIDER_SMOKE_ARMED_RUN_LOG',
    'source_ref.host + url_sha256',
    'source_ref.host + url_sha256 == request source_url',
    'estimated total cost',
    'network_requests_executed=false',
    'paid_verification_called=false',
    'job_created=false',
    '人工交接时只复制 `redacted_handoff_template.copyable_checklist`',
    'No-paid handoff verifier',
    'mode=provider_smoke_paid_handoff_verifier',
    'normal_form=no_paid_handoff_pressure_plan',
    'archive_normal_form=no_paid_handoff_pressure_plan_archive',
    'no_paid_handoff_pressure_plan_archive',
    'status=ready_for_manual_confirmation',
    'provider_smoke_paid_handoff_verifier.copyable_checklist',
    'stdout 仍是 canonical contract',
    'redacted archive adapter',
    'provider_calls_authorized=false',
    '该报告只允许人工确认，不授权 provider call',
    '不复制 API token、source URL、完整 NDJSON',
    'Preflight receipt verification',
    'provider_smoke_preflight_receipt_verification',
    'real_provider_smoke_preflight_receipt_verify',
    'status=verified_ready_to_arm',
    '不替代 armed-run 内部校验，也不授权 provider call',
  ]

  for (const text of armedRunHandoffText) {
    if (!doc.text.includes(text)) {
      failures.push(`${doc.file}:1 missing provider smoke redacted handoff invariant: ${text}`)
    }
  }

  const handoffSection = extractBetween(
    doc.text,
    '真实 provider smoke redacted preflight handoff checklist',
    '真实 provider smoke armed-run invariant checklist',
  )

  if (!handoffSection) {
    failures.push(`${doc.file}:1 missing provider smoke redacted handoff section`)
  } else {
    const forbiddenHandoffPatterns: ForbiddenPattern[] = [
      {
        name: 'raw TEST_API_TOKEN assignment in provider smoke handoff',
        pattern:
          /\bTEST_API_TOKEN\s*=\s*(?!(?:"?\$\{TEST_API_TOKEN)|"?YOUR_API_TOKEN\b|"?<token>)[^\s`|]+/g,
      },
      {
        name: 'raw bearer token in provider smoke handoff',
        pattern:
          /Authorization:\s*Bearer\s+(?!\$\{TEST_API_TOKEN\}|YOUR_API_TOKEN\b|<token>)[^\s`|]+/g,
      },
      {
        name: 'raw source URL assignment in provider smoke handoff',
        pattern: /\bREAL_PROVIDER_SMOKE_SOURCE_URL\s*=\s*https?:\/\/[^\s`|]+/g,
      },
      {
        name: 'raw source URL field in provider smoke handoff',
        pattern:
          /\b(?:source_url|REAL_PROVIDER_SMOKE_SOURCE_URL)\b\s*[:=]\s*["']?https?:\/\/[^\s`|,'"}]+/g,
      },
      {
        name: 'raw YouTube URL in provider smoke handoff',
        pattern: /https:\/\/www\.youtube\.com\/watch\?v=[^\s`|]+/g,
      },
      {
        name: 'contradictory ok=false armed-run continuation in provider smoke handoff',
        pattern:
          /ok=false[\s\S]{0,80}(?:继续|运行|执行)[\s\S]{0,40}(?:armed|provider-smoke:armed-run)/g,
      },
    ]

    for (const forbidden of forbiddenHandoffPatterns) {
      for (const match of handoffSection.matchAll(forbidden.pattern)) {
        failures.push(
          `${doc.file}:${lineFor(doc.text, doc.text.indexOf(match[0]))} ${forbidden.name}`,
        )
      }
    }
  }

  if (!doc.text.includes('不创建配音 job，不生成成片')) {
    failures.push(`${doc.file}:1 provider smoke stress must document no job/artifact side effects`)
  }

  return failures
}

function findProviderSmokePreflightSnapshotFailures(docs: DynamicDoc[]): string[] {
  const doc = docs.find((dynamicDoc) => dynamicDoc.file.endsWith(PROVIDER_PREFLIGHT_SNAPSHOT_DOC))
  const failures: string[] = []

  if (!doc) {
    return [`docs/agent/testing/dynamic/${PROVIDER_PREFLIGHT_SNAPSHOT_DOC}:1 missing snapshot doc`]
  }

  const requiredText = [
    'Provider smoke redacted readiness / preflight 快照',
    'no-paid',
    'no-network',
    'missing-env',
    'invalid-url',
    'over-budget',
    'stale-evidence',
    'manual-authorization-preparation',
    'manual-authorization-forbidden-env',
    'readiness-bundle',
    'handoff-verifier-ready',
    'handoff-verifier-archive-mode',
    'handoff-verifier-gates-present',
    'preflight-receipt-ready',
    'receipt-verify-ready',
    'receipt-verify-missing',
    'receipt-verify-command-mismatch',
    'preflight-receipt-machine-mismatch',
    'provider_smoke_readiness_bundle',
    'provider_smoke_paid_handoff_verifier',
    'provider_smoke_preflight_receipt',
    'provider_smoke_preflight_receipt_verification',
    'no_paid_handoff_pressure_plan',
    'no_paid_handoff_pressure_plan_archive',
    'PROVIDER_SMOKE_PREFLIGHT_RECEIPT_ROOT',
    'PROVIDER_SMOKE_PREFLIGHT_RECEIPT_FILE',
    'preflight_receipt',
    'Execution surface boundary',
    'API route 不读取 receipt 文件',
    '不校验 `PROVIDER_SMOKE_PREFLIGHT_RECEIPT_FILE`',
    '不保存 receipt',
    '也不接受 receipt 作为 request 字段',
    'CLI receipt 只保护 operator 本机 `provider-smoke:armed-run` command path',
    'command_hash',
    'machine_binding',
    'command_binding',
    '不得复制原始机器名',
    '用户名',
    'home 路径',
    'machine_binding must match current machine',
    'command_hash must match current armed-run command object',
    'status=verified_ready_to_arm',
    'ready_for_manual_confirmation',
    'unsafe_paid_stress_gates_present',
    'provider_calls_authorized=false',
    'PROVIDER_SMOKE_READINESS_BUNDLE_FILE',
    'PROVIDER_SMOKE_READINESS_BUNDLE_MARKDOWN_FILE',
    'PROVIDER_SMOKE_HANDOFF_VERIFY_FILE',
    'PROVIDER_SMOKE_HANDOFF_VERIFY_MARKDOWN_FILE',
    'ready_for_manual_authorization',
    'ready_for_paid_armed_preflight',
    'ready_to_arm=false',
    'output_reference',
    'redacted_handoff_template.ready_to_arm=false',
    'expected_runtime_fingerprint',
    'next_build_id',
    'external_calls_executed=false',
    'network_requests_executed=false',
    'paid_verification_called=false',
    'job_created=false',
    'command_object=null',
    'source_ref.host + url_sha256',
    '不得运行 `pnpm provider-smoke:armed-run`',
    '只运行 `pnpm provider-smoke:readiness:bundle`',
    '只运行 `pnpm provider-smoke:handoff:verify`',
    '只运行 `pnpm provider-smoke:armed-run:preflight`',
    '只运行 `pnpm provider-smoke:receipt:verify`',
    'forbidden_env_present',
    '不得复制 `TEST_API_TOKEN`',
    '不得复制原始 `REAL_PROVIDER_SMOKE_SOURCE_URL`',
    '不得复制完整 NDJSON',
    '不得复制 provider 响应正文',
    'Partial attempt ledger',
    'partial_ledger_written=true',
    'failure.type=real_provider_smoke_run_failed',
  ]

  for (const text of requiredText) {
    if (!doc.text.includes(text)) {
      failures.push(`${doc.file}:1 missing provider smoke preflight snapshot invariant: ${text}`)
    }
  }

  const forbiddenPatterns: ForbiddenPattern[] = [
    {
      name: 'positive paid gate assignment in preflight snapshots',
      pattern: /^\s*(?:export\s+)?ALLOW_PAID_DYNAMIC_TESTS\s*=\s*true\b/gm,
    },
    {
      name: 'positive stress gate assignment in preflight snapshots',
      pattern: /^\s*(?:export\s+)?ALLOW_STRESS_DYNAMIC_TESTS\s*=\s*true\b/gm,
    },
    {
      name: 'raw source URL field in preflight snapshots',
      pattern:
        /\b(?:source_url|REAL_PROVIDER_SMOKE_SOURCE_URL)\b\s*[:=]\s*["']?https?:\/\/[^\s`|,'"}]+/g,
    },
    {
      name: 'raw bearer token in preflight snapshots',
      pattern:
        /Authorization:\s*Bearer\s+(?!\$\{TEST_API_TOKEN\}|YOUR_API_TOKEN\b|<token>)[^\s`|]+/g,
    },
    {
      name: 'raw local path in preflight snapshots',
      pattern:
        /\b(?:dry_run_evidence_log|PROVIDER_SMOKE_ARMED_RUN_LOG|armed_run_log)\b\s*[:=]\s*["']?(?:[A-Za-z]:\\|\/(?:Users|home|tmp|var|private)\/)[^\s`|,'"}]+/g,
    },
  ]

  for (const forbidden of forbiddenPatterns) {
    for (const match of doc.text.matchAll(forbidden.pattern)) {
      failures.push(`${doc.file}:${lineFor(doc.text, match.index || 0)} ${forbidden.name}`)
    }
  }

  for (const block of extractBashBlocks(doc)) {
    if (
      block.body.includes('pnpm provider-smoke:armed-run') &&
      !block.body.includes('pnpm provider-smoke:armed-run:preflight')
    ) {
      failures.push(`${block.file}:${block.startLine} snapshot doc must not include armed run`)
    }

    if (/node\s+scripts[\\/]+provider-smoke-armed-run\.mjs(?!\s+--preflight)/.test(block.body)) {
      failures.push(`${block.file}:${block.startLine} snapshot doc must not run armed script`)
    }
  }

  return failures
}

function findProviderBoundaryReferenceDocFailures(doc: DynamicDoc): string[] {
  const failures: string[] = []
  const requiredText = [
    '真实 provider smoke 不提供裸 JSON 快捷入口',
    'source-bound dry-run evidence',
    'manual_authorization',
    'PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE',
    'runtime_fingerprint',
    'audit.runtime_fingerprint',
    'CLI 执行入口: `pnpm provider-smoke:armed-run`',
    '内部 API endpoint: `POST /api/ingest/dubbing-readiness`',
    '确认 ID 不是执行授权',
    'provider_smoke_preflight_receipt',
    'PROVIDER_SMOKE_PREFLIGHT_RECEIPT_FILE',
  ]

  for (const text of requiredText) {
    if (!doc.text.includes(text)) {
      failures.push(`${doc.file}:1 missing provider smoke reference boundary text: ${text}`)
    }
  }

  const copyableRealProviderSmokeBlocks = extractBashBlocks(doc).filter(
    (block) =>
      hasCopyableRealProviderSmokeCommandObject(block.body) ||
      (hasReadinessEndpoint(block.body) &&
        hasJsonFieldValue(block.body, 'mode', 'real_provider_smoke')),
  )

  for (const block of copyableRealProviderSmokeBlocks) {
    failures.push(
      `${block.file}:${block.startLine} reference docs must not include copyable real_provider_smoke curl/body/command object`,
    )
  }

  return failures
}

function findProviderBoundaryUiDocFailures(doc: DynamicDoc): string[] {
  if (!PROVIDER_BOUNDARY_UI_DOCS.some((file) => doc.file.endsWith(file))) return []
  const failures: string[] = []

  if (!doc.text.includes('dry-run 只验证 readiness/gates')) {
    failures.push(`${doc.file}:1 missing dry-run provider smoke boundary`)
  }

  if (!doc.text.includes('正式 /dubbing 任务会调用外部翻译/MiniMax provider 并可能产生费用')) {
    failures.push(`${doc.file}:1 missing formal dubbing provider cost boundary`)
  }

  if (!doc.text.includes('不把 YouTube gate 混入配音任务')) {
    failures.push(`${doc.file}:1 missing YouTube gate exclusion boundary`)
  }

  return failures
}

function findProviderBoundaryTaskControlFailures(doc: DynamicDoc): string[] {
  if (!PROVIDER_BOUNDARY_TASK_CONTROL_DOCS.some((file) => doc.file.endsWith(file))) return []
  const failures: string[] = []
  const requiredText = [
    'config.confirmed_gate_ids',
    'translation_provider',
    'minimax_tts',
    'ALLOW_LEGACY_WRITE_NEGATIVE_TESTS',
    'mock://legacy/single-video',
  ]

  for (const text of requiredText) {
    if (!doc.text.includes(text)) {
      failures.push(`${doc.file}:1 missing task-control provider field: ${text}`)
    }
  }

  if (!doc.text.includes('不混入 `youtube_download`')) {
    failures.push(`${doc.file}:1 task-control dubbing scope must exclude youtube_download`)
  }

  return failures
}

function findLegacyWorkflowDocFailures(doc: DynamicDoc): string[] {
  if (!PROVIDER_BOUNDARY_WORKFLOW_DOCS.some((file) => doc.file.endsWith(file))) return []
  const failures: string[] = []
  const requiredText = ['ALLOW_LEGACY_WRITE_NEGATIVE_TESTS', 'mock://legacy/single-video']

  for (const text of requiredText) {
    if (!doc.text.includes(text)) {
      failures.push(`${doc.file}:1 missing legacy workflow negative-test normal form: ${text}`)
    }
  }

  return failures
}

function findProviderSmokeCanonicalSurfaceFailures(): string[] {
  const failures: string[] = []
  const packageJson = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf-8')) as {
    scripts?: Record<string, string>
  }
  const providerDryRunCommand = packageJson.scripts?.['provider-smoke:dry-run']
  const providerDryRunPreflightCommand = packageJson.scripts?.['provider-smoke:dry-run:preflight']
  const providerArmedRunCommand = packageJson.scripts?.['provider-smoke:armed-run']
  const providerReadinessBundleCommand = packageJson.scripts?.['provider-smoke:readiness:bundle']
  const providerHandoffVerifyCommand = packageJson.scripts?.['provider-smoke:handoff:verify']
  const providerPressurePlanCommand = packageJson.scripts?.['provider-smoke:pressure-plan']
  const providerManualAuthPrepareCommand =
    packageJson.scripts?.['provider-smoke:manual-auth:prepare']
  const providerArmedRunPreflightCommand =
    packageJson.scripts?.['provider-smoke:armed-run:preflight']
  const providerReceiptVerifyCommand = packageJson.scripts?.['provider-smoke:receipt:verify']

  if (providerDryRunCommand !== 'node scripts/provider-smoke-dry-run-rehearsal.mjs') {
    failures.push('package.json:1 missing canonical provider-smoke:dry-run command')
  }

  if (
    providerDryRunPreflightCommand !==
    'node scripts/provider-smoke-dry-run-rehearsal.mjs --preflight'
  ) {
    failures.push('package.json:1 missing canonical provider-smoke:dry-run:preflight command')
  }

  if (providerArmedRunCommand !== 'node scripts/provider-smoke-armed-run.mjs') {
    failures.push('package.json:1 missing canonical provider-smoke:armed-run command')
  }

  if (
    providerReadinessBundleCommand !==
    'node scripts/provider-smoke-armed-run.mjs --readiness-bundle'
  ) {
    failures.push('package.json:1 missing canonical provider-smoke:readiness:bundle command')
  }

  if (
    providerHandoffVerifyCommand !== 'node scripts/provider-smoke-armed-run.mjs --handoff-verify'
  ) {
    failures.push('package.json:1 missing canonical provider-smoke:handoff:verify command')
  }

  if (
    providerPressurePlanCommand !==
    'node scripts/provider-smoke-armed-run.mjs --handoff-verify --pressure-plan'
  ) {
    failures.push('package.json:1 missing canonical provider-smoke:pressure-plan command')
  }

  if (
    providerArmedRunPreflightCommand !== 'node scripts/provider-smoke-armed-run.mjs --preflight'
  ) {
    failures.push('package.json:1 missing canonical provider-smoke:armed-run:preflight command')
  }

  if (
    providerReceiptVerifyCommand !==
    'node scripts/provider-smoke-armed-run.mjs --verify-preflight-receipt'
  ) {
    failures.push('package.json:1 missing canonical provider-smoke:receipt:verify command')
  }

  if (
    providerManualAuthPrepareCommand !==
    'node scripts/provider-smoke-armed-run.mjs --prepare-manual-authorization'
  ) {
    failures.push('package.json:1 missing canonical provider-smoke:manual-auth:prepare command')
  }

  const script = readFileSync(PROVIDER_DRY_RUN_SCRIPT, 'utf-8')
  const requiredScriptText = [
    'REQUIRED_DRY_RUN_ENV',
    'provider-smoke-runtime-fingerprint.mjs',
    'fetchAndAssertRuntimeFingerprint',
    '/api/ingest/dubbing-readiness',
    '/api/jobs?limit=1&offset=0',
    "'ALLOW_STRESS_DYNAMIC_TESTS'",
    "'DRY_RUN_PROVIDER_SMOKE_AUDIT_JOB_ID'",
    "'DRY_RUN_PROVIDER_SMOKE_SOURCE_URL'",
    'DRY_RUN_PROVIDER_SMOKE_EVIDENCE_LOG',
    'PROVIDER_SMOKE_AUDIT_LOG',
    "process.argv.includes('--preflight')",
    "mode: 'dry_run_preflight'",
    'missing_required_env',
    'network_requests_executed: false',
    'paid_verification_called: false',
    'expected_runtime_fingerprint',
    'runtime_fingerprint',
    'payload.audit.runtime_fingerprint',
    'runtime_fingerprint must match current runtime fingerprint',
    'next_build_id',
    'dry-run provider smoke rehearsal must not set ALLOW_PAID_DYNAMIC_TESTS',
    "body: JSON.stringify({ mode: 'dry_run', job_id: auditJobId, source_url: sourceUrl })",
    'source_ref',
    'raw_source_url',
    'dry-run provider smoke audit source_ref must match source fingerprint',
    'result_counts.blocked must be numeric',
    'external_calls_executed !== false',
    'jobCountDeltaTotal !== 0',
    'blockedCountTotal !== 0',
    'blocked_count_total',
  ]

  for (const text of requiredScriptText) {
    if (!script.includes(text)) {
      failures.push(`scripts/provider-smoke-dry-run-rehearsal.mjs:1 missing ${text}`)
    }
  }

  for (const forbidden of ['confirmed_gate_ids', '/api/dubbing']) {
    if (script.includes(forbidden)) {
      failures.push(`scripts/provider-smoke-dry-run-rehearsal.mjs:1 must not include ${forbidden}`)
    }
  }

  const armedRunScript = readFileSync(PROVIDER_ARMED_RUN_SCRIPT, 'utf-8')
  const requiredArmedRunScriptText = [
    'real_provider_smoke_preflight',
    'provider_smoke_readiness_bundle',
    'provider_smoke_preflight_receipt_verification',
    'real_provider_smoke_preflight_receipt_verify',
    'READINESS_BUNDLE_ENV',
    'HANDOFF_VERIFY_ENV',
    'PREFLIGHT_RECEIPT_VERIFY_ENV',
    '--readiness-bundle',
    'buildReadinessBundleReport',
    'writeReadinessBundleOutputs',
    'formatReadinessBundleMarkdown',
    'PROVIDER_SMOKE_READINESS_BUNDLE_FILE',
    'PROVIDER_SMOKE_READINESS_BUNDLE_MARKDOWN_FILE',
    'PROVIDER_SMOKE_HANDOFF_VERIFY_ROOT',
    'PROVIDER_SMOKE_HANDOFF_VERIFY_FILE',
    'PROVIDER_SMOKE_HANDOFF_VERIFY_MARKDOWN_FILE',
    'output_reference',
    'ready_for_manual_authorization',
    'ready_for_paid_armed_preflight',
    'manual_authorization_preparation',
    'MANUAL_AUTHORIZATION_PREP_ENV',
    '--prepare-manual-authorization',
    '--confirmed-by',
    'provider-smoke-runtime-fingerprint.mjs',
    'fetchAndAssertRuntimeFingerprint',
    '/api/ingest/dubbing-readiness',
    '/api/jobs?limit=1&offset=0',
    'server dry-run evidence request',
    "process.env.ALLOW_PAID_DYNAMIC_TESTS !== 'true'",
    "process.env.ALLOW_STRESS_DYNAMIC_TESTS !== 'true'",
    'REAL_PROVIDER_SMOKE_SOURCE_URL',
    'REAL_PROVIDER_SMOKE_AUDIT_JOB_ID',
    'DRY_RUN_PROVIDER_SMOKE_EVIDENCE_LOG',
    'DRY_RUN_PROVIDER_SMOKE_EVIDENCE_MAX_AGE_MS',
    'PROVIDER_SMOKE_STRESS_RUNS',
    'PROVIDER_SMOKE_MAX_BUDGET_USD',
    'PROVIDER_SMOKE_MAX_RUNS',
    'PROVIDER_SMOKE_MAX_CONCURRENCY',
    'PROVIDER_SMOKE_ESTIMATED_COST_PER_RUN_USD',
    'PROVIDER_SMOKE_ARMED_RUN_LOG',
    'PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE',
    'PROVIDER_SMOKE_PREFLIGHT_RECEIPT_ROOT',
    'PROVIDER_SMOKE_PREFLIGHT_RECEIPT_FILE',
    'provider_smoke_preflight_receipt',
    '--verify-preflight-receipt',
    'buildPreflightReceiptVerificationReport',
    'verified_ready_to_arm',
    'buildPreflightCommandBinding',
    'buildPreflightReceipt',
    'readPreflightReceipt',
    'writePreflightReceiptOutput',
    'command_hash',
    'command_binding',
    'machine_binding',
    'machine_binding must match current machine',
    'command_binding must match command_hash',
    'command_hash must match current armed-run command object',
    "'youtube_download', 'translation_provider', 'minimax_tts'",
    'redacted_handoff_template',
    'provider_smoke_paid_handoff_verifier',
    'no_paid_handoff_pressure_plan',
    '--handoff-verify',
    '--pressure-plan',
    'buildHandoffVerifierReport',
    'buildHandoffVerifierOutputReference',
    'writeHandoffVerifierOutputs',
    'formatHandoffVerifierMarkdown',
    'no_paid_handoff_pressure_plan_archive',
    'archive_adapter_only',
    'paid_stress_gates_must_be_unset_for_this_verifier',
    'provider_calls_authorized: false',
    'copyable_checklist',
    'manual_authorization',
    'validateManualAuthorization',
    'buildManualAuthorizationTemplate',
    'buildManualAuthorization',
    'forbidden_env_present',
    'blocked_forbidden_env_present',
    'PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE invalid',
    'raw_source_url',
    'token_value',
    'expected_runtime_fingerprint',
    'runtime_fingerprint',
    'runtime_fingerprint must match current runtime fingerprint',
    'record.runtime_fingerprint',
    'audit.runtime_fingerprint',
    'payload.audit.source_ref',
    'payload.audit.manual_authorization',
    'next_build_id',
    'server providerSmokeAudit must be a ready no-call dry_run',
    'server providerSmokeAudit source_ref must match real provider smoke source',
    "'real provider smoke audit'",
    'real provider smoke response must be ready',
    'real provider smoke response must not include blocked gates',
    'provider-smoke-real.ndjson',
    'runAllSettledWithConcurrencyLimit',
    'buildFailedRunRecord',
    'writeArmedRunLedger',
    'redactSensitiveText',
    'partial_ledger_record',
    'partial_ledger_written',
    'real provider smoke failed after writing partial armed-run ledger',
    'external_calls_executed: true',
    'job_created: false',
  ]

  for (const text of requiredArmedRunScriptText) {
    if (!armedRunScript.includes(text)) {
      failures.push(`scripts/provider-smoke-armed-run.mjs:1 missing ${text}`)
    }
  }

  if (armedRunScript.includes('/api/dubbing')) {
    failures.push('scripts/provider-smoke-armed-run.mjs:1 must not create dubbing jobs')
  }

  const runtimeFingerprintScript = readFileSync(PROVIDER_RUNTIME_FINGERPRINT_SCRIPT, 'utf-8')
  const requiredRuntimeFingerprintScriptText = [
    '/api/runtime/fingerprint',
    'laputa-runtime-fingerprint',
    'package_name',
    'package_version',
    'next_build_id',
    '.next',
    'BUILD_ID',
    'runtime fingerprint mismatch',
  ]

  for (const text of requiredRuntimeFingerprintScriptText) {
    if (!runtimeFingerprintScript.includes(text)) {
      failures.push(`scripts/provider-smoke-runtime-fingerprint.mjs:1 missing ${text}`)
    }
  }

  return failures
}

describe('dynamic testing docs safety guard', () => {
  it('does not reintroduce secrets, production write targets, or legacy styles success paths', () => {
    const failures = readDynamicDocs().flatMap(findForbiddenPatternFailures)

    expect(failures).toEqual([])
  })

  it('keeps active job log examples on ingest and dubbing mainline stages', () => {
    const guardedDocs = readDynamicDocs().filter((doc) =>
      PROVIDER_BOUNDARY_API_DOCS.some((file) => doc.file.endsWith(file)),
    )
    const forbiddenLogExamplePatterns: ForbiddenPattern[] = [
      {
        name: 'legacy analysis majorStep filter in active logs example',
        pattern: /logs\?majorStep=analysis/g,
      },
      {
        name: 'legacy analysis majorStep JSON in active logs example',
        pattern: /"majorStep":\s*"analysis"/g,
      },
      {
        name: 'legacy fetch_metadata subStep JSON in active logs example',
        pattern: /"subStep":\s*"fetch_metadata"/g,
      },
      {
        name: 'legacy editing-only majorStep list in active logs docs',
        pattern: /大步骤筛选（analysis\/extract_scenes\/process_scenes\/compose）/g,
      },
    ]
    const failures = guardedDocs.flatMap((doc) =>
      forbiddenLogExamplePatterns.flatMap((forbidden) =>
        Array.from(
          doc.text.matchAll(forbidden.pattern),
          (match) => `${doc.file}:${lineFor(doc.text, match.index || 0)} ${forbidden.name}`,
        ),
      ),
    )

    expect(failures).toEqual([])
  })

  it('keeps paid, destructive, stress, and restart commands behind explicit gates', () => {
    const docs = readDynamicDocs()
    const providerBoundaryReferenceDocs = readProviderBoundaryReferenceDocs()
    const failures = [
      ...docs.flatMap((doc) => [
        ...findCommandGateFailures(doc),
        ...findCloudUiOperationGateFailures(doc),
        ...findConfigUiSaveOnlyDocFailures(doc),
        ...findPaidVerificationUiGateFailures(doc),
        ...findProviderBoundaryApiDocFailures(doc),
        ...findProviderBoundaryUiDocFailures(doc),
        ...findLegacyWorkflowDocFailures(doc),
        ...findProviderBoundaryTaskControlFailures(doc),
      ]),
      ...providerBoundaryReferenceDocs.flatMap(findProviderBoundaryReferenceDocFailures),
      ...findProviderSmokePreflightSnapshotFailures(docs),
    ]

    expect(failures).toEqual([])
  })

  it('keeps provider smoke commands on the canonical script surfaces', () => {
    const failures = findProviderSmokeCanonicalSurfaceFailures()

    expect(failures).toEqual([])
  })
})
