import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { buildDubbingQaInputFingerprint } from '../../lib/jobs/dubbing-qa-input-fingerprint'
import { getJobArtifactsFingerprint } from '../../lib/jobs/job-artifacts'
import type { DubbingQaInputFingerprint, Job, JobConfig } from '../../types'

export const MAINLINE_FIXTURE_IDS = {
  ingest: 'e2e-ingest-source',
  sample: 'e2e-dub-sample',
  full: 'e2e-dub-full',
  failed: 'e2e-dub-failed',
  qaIssues: 'e2e-dub-qa-issues',
} as const

type SqlValue = string | number | null
type SqlRow = Record<string, SqlValue>
type JsonRecord = Record<string, unknown>

interface TranslationRow {
  id: string
  start: number
  end: number
  speaker: string
  original_text: string
  translated_text: string
}

type ManualFinalListenFixtureRecord = {
  status: 'pending' | 'passed' | 'failed' | 'waived'
  note?: string
  checked_at: number
}

const repoRoot = process.cwd()
const schemaPath = path.join(repoRoot, 'lib', 'db', 'schema.sql')
const now = 1_771_250_400_000

const glossary = [
  { source: 'Wave59', target: 'Wave 五九', note: '产品名固定读法' },
  { source: '1999', target: '一九九九', note: '年份口播' },
  { source: 'Lars', target: '拉尔斯', note: '人名读法' },
]

const baseCreatorContext = {
  content_brief: 'E2E no-paid 主线 fixture：外语产品访谈转译为中文口播，不调用真实 provider。',
  speaker_identity: 'E2E 访谈讲者',
  target_audience: '中文自媒体观众',
  wording_style: 'plain',
  language_style: '短句优先，避免逐字硬翻。\n专名和年份按固定读法写成可直接口播的中文。',
  language_style_source: 'merged',
  revision_notes: '1. Wave59 必须读作 Wave 五九。\n2. 年份写成中文口播形式，避免 TTS 直读数字。',
}

function json(value: unknown): string {
  return JSON.stringify(value)
}

function readOptionalText(filePath: string): string | null {
  try {
    const value = readFileSync(filePath, 'utf-8').trim()
    return value || null
  } catch {
    return null
  }
}

function readFixtureRuntimeFingerprint() {
  const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf-8')) as {
    name?: unknown
    version?: unknown
  }

  return {
    package_name: typeof packageJson.name === 'string' ? packageJson.name : '',
    package_version: typeof packageJson.version === 'string' ? packageJson.version : '',
    next_build_id: readOptionalText(path.join(repoRoot, '.next', 'BUILD_ID')),
  }
}

function resolveDatabasePath(): string {
  const configured = process.env.DATABASE_URL?.replace(/^file:/, '').trim()
  if (configured) return path.resolve(configured)
  return path.resolve(repoRoot, 'tmp', 'playwright-e2e', 'fallback.sqlite')
}

function resolveRuntimeRoot(): string {
  return path.resolve(process.env.RUNTIME_DIR || path.join(repoRoot, 'tmp', 'playwright-runtime'))
}

function resolveTempRoot(): string {
  return path.resolve(process.env.TEMP_DIR || path.join(resolveRuntimeRoot(), 'temp'))
}

function resolveOutputRoot(): string {
  return path.resolve(process.env.OUTPUT_DIR || path.join(resolveRuntimeRoot(), 'output'))
}

function jobTempDir(jobId: string): string {
  return path.join(resolveTempRoot(), 'jobs', jobId)
}

function ingestOutputDir(jobId: string): string {
  return path.join(resolveOutputRoot(), 'ingest', jobId)
}

function jobOutputDir(jobId: string): string {
  return path.join(resolveOutputRoot(), `20260429-${jobId}`)
}

function writeJsonFile(filePath: string, value: unknown): string {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8')
  return filePath
}

function writeTextFile(filePath: string, value: string): string {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, value, 'utf-8')
  return filePath
}

function writeFinalVideoFile(jobId: string): string {
  const filePath = path.join(jobOutputDir(jobId), 'final.mp4')
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, 'E2E_FINAL_VIDEO_PLACEHOLDER\n', 'utf-8')
  return filePath
}

function initFixtureDb(dbPath: string): Database.Database {
  mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  db.pragma('foreign_keys = ON')
  db.exec(readFileSync(schemaPath, 'utf-8'))
  return db
}

function upsert(db: Database.Database, table: string, row: SqlRow, conflictKey = 'id') {
  const columns = Object.keys(row)
  const values = columns.map((column) => `@${column}`).join(', ')
  const updates = columns
    .filter((column) => column !== conflictKey)
    .map((column) => `${column}=excluded.${column}`)
    .join(', ')

  db.prepare(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values})
     ON CONFLICT(${conflictKey}) DO UPDATE SET ${updates}`,
  ).run(row)
}

function upsertConfig(db: Database.Database, key: string, value: string) {
  upsert(
    db,
    'configs',
    {
      key,
      value,
      updated_at: now,
    },
    'key',
  )
}

function upsertJob(
  db: Database.Database,
  input: {
    id: string
    jobType: 'content_ingest' | 'translation_dubbing'
    status: 'completed' | 'failed'
    createdAt: number
    config: JsonRecord
    inputVideos: unknown[]
    styleName: string
    errorMessage?: string | null
    errorMetadata?: JsonRecord | null
  },
) {
  upsert(db, 'jobs', {
    id: input.id,
    status: input.status,
    current_step: null,
    input_url:
      typeof (input.inputVideos[0] as { url?: unknown } | undefined)?.url === 'string'
        ? ((input.inputVideos[0] as { url: string }).url as string)
        : null,
    style_id: null,
    style_name: input.styleName,
    config: json(input.config),
    job_type: input.jobType,
    input_videos: json(input.inputVideos),
    remix_mode: null,
    remix_config: null,
    error_message: input.errorMessage || null,
    error_metadata: input.errorMetadata ? json(input.errorMetadata) : null,
    source: 'web',
    api_token_id: null,
    webhook_url: null,
    webhook_secret: null,
    created_at: input.createdAt,
    updated_at: input.createdAt + 1200,
    started_at: input.createdAt + 100,
    completed_at: input.status === 'completed' ? input.createdAt + 9000 : null,
  })
}

function upsertState(
  db: Database.Database,
  input: {
    jobId: string
    context: JsonRecord
    currentMajorStep?: string | null
    currentSubStep?: string | null
    finalVideoLocalPath?: string | null
  },
) {
  upsert(
    db,
    'job_current_state',
    {
      job_id: input.jobId,
      current_major_step: input.currentMajorStep || null,
      current_sub_step: input.currentSubStep || null,
      step_context: json(input.context),
      total_scenes: 0,
      processed_scenes: 0,
      final_video_url: null,
      final_video_public_url: null,
      final_video_gs_uri: null,
      final_video_local_path: input.finalVideoLocalPath || null,
      final_video_metadata: null,
      updated_at: now,
    },
    'job_id',
  )
}

function upsertStep(
  db: Database.Database,
  input: {
    jobId: string
    index: number
    majorStep: string
    subStep: string
    output: JsonRecord
    offset: number
  },
) {
  const startedAt = now + input.offset
  upsert(db, 'job_step_history', {
    id: `${input.jobId}-step-${input.index}`,
    job_id: input.jobId,
    scene_id: null,
    major_step: input.majorStep,
    sub_step: input.subStep,
    step_type: null,
    status: 'completed',
    attempt: 1,
    retry_delay_ms: null,
    started_at: startedAt,
    completed_at: startedAt + 1000,
    duration_ms: 1000,
    error_message: null,
    input_data: json({ e2e_fixture: true, no_paid: true }),
    step_metadata: json({ stepNumber: input.index, stageNumber: input.index }),
    output_data: json(input.output),
  })
}

function upsertLog(
  db: Database.Database,
  input: {
    jobId: string
    index: number
    majorStep: string
    subStep: string
    message: string
    level?: 'info' | 'warn' | 'error'
  },
) {
  upsert(db, 'job_logs', {
    id: `${input.jobId}-log-${input.index}`,
    job_id: input.jobId,
    log_type: input.level === 'error' ? 'error' : input.level === 'warn' ? 'warning' : 'info',
    log_level: input.level || 'info',
    major_step: input.majorStep,
    sub_step: input.subStep,
    scene_id: null,
    step_number: input.index,
    stage_number: input.index,
    message: input.message,
    details: json({ e2e_fixture: true, no_paid: true }),
    service_name: null,
    operation: null,
    api_duration_ms: null,
    created_at: now + input.index * 1000,
  })
}

function makeReadyProviderSmokeAudit(checkedAt: number) {
  const results = [
    {
      id: 'runtime',
      label: '运行环境',
      provider: 'local',
      capability: 'runtime',
      mode: 'dry_run',
      status: 'dry_run_passed',
      run_mode: 'dry_run',
      external_call: false,
      may_spend_money: false,
      writes_artifacts: false,
      message: 'E2E no-paid fixture：本地运行环境检查通过。',
      blockers: [],
    },
    {
      id: 'translation',
      label: '翻译 provider',
      provider: 'gemini',
      capability: 'translate',
      mode: 'dry_run',
      status: 'dry_run_passed',
      run_mode: 'dry_run',
      external_call: false,
      may_spend_money: false,
      writes_artifacts: false,
      message: 'E2E no-paid fixture：只记录 dry-run gate，不调用真实翻译。',
      blockers: [],
    },
    {
      id: 'minimax_tts',
      label: 'MiniMax TTS',
      provider: 'minimax',
      capability: 'tts',
      mode: 'dry_run',
      status: 'dry_run_passed',
      run_mode: 'dry_run',
      external_call: false,
      may_spend_money: false,
      writes_artifacts: false,
      message: 'E2E no-paid fixture：只记录 dry-run gate，不调用 MiniMax。',
      blockers: [],
    },
  ] as const

  return {
    schema_version: 1,
    checked_at: checkedAt,
    mode: 'dry_run',
    dry_run: true,
    ok: true,
    verdict: 'ready',
    external_calls_executed: false,
    runtime_fingerprint: readFixtureRuntimeFingerprint(),
    result_counts: {
      passed: results.length,
      failed: 0,
      blocked: 0,
      skipped: 0,
      requires_confirmation: 0,
    },
    top_blockers: [],
    required_confirmations: [],
    confirmed_gate_ids: [],
    missing_confirmations: [],
    unknown_confirmations: [],
    results,
  }
}

function upsertProviderSmokeDryRunLog(db: Database.Database, jobId: string) {
  const audit = makeReadyProviderSmokeAudit(now + 60_000)
  upsert(db, 'job_logs', {
    id: `${jobId}-provider-smoke-dry-run`,
    job_id: jobId,
    log_type: 'info',
    log_level: 'info',
    major_step: 'ingest',
    sub_step: 'provider_smoke',
    scene_id: null,
    step_number: 99,
    stage_number: 99,
    message: 'Provider smoke dry_run passed: 3/3 gates',
    details: json({ provider_smoke_audit: audit }),
    service_name: 'provider_smoke',
    operation: 'dry_run',
    api_duration_ms: null,
    created_at: now + 60_000,
  })
}

function upsertApiCall(
  db: Database.Database,
  input: {
    jobId: string
    index: number
    service: string
    operation: string
    durationMs: number
  },
) {
  upsert(db, 'api_calls', {
    id: `${input.jobId}-api-${input.index}`,
    job_id: input.jobId,
    scene_id: null,
    service: input.service,
    operation: input.operation,
    platform: 'e2e-no-paid-fixture',
    request_params: json({ e2e_fixture: true, no_paid: true }),
    request_timestamp: now + input.index * 2000,
    response_data: json({ ok: true, mocked: true }),
    response_timestamp: now + input.index * 2000 + input.durationMs,
    duration_ms: input.durationMs,
    status: 'success',
    error_message: null,
    retry_count: 0,
    token_usage: null,
    file_size: null,
    raw_response: null,
  })
}

function upsertVideo(db: Database.Database, jobId: string) {
  upsert(db, 'job_videos', {
    id: `${jobId}-video-1`,
    job_id: jobId,
    video_index: 0,
    label: 'E2E no-paid source',
    title: 'Wave59 interview fixture',
    description: '视觉 smoke 的本地 fixture，不触发真实下载或 provider 调用。',
    original_url: 'https://example.test/wave59-interview.mp4',
    local_path: null,
    gcs_https_url: null,
    gcs_gs_uri: null,
    gemini_uri: null,
    metadata: json({ e2e_fixture: true, duration_seconds: 42 }),
    analysis_prompt: null,
    analysis_response: null,
    storyboards: null,
    total_duration: 42,
    created_at: now,
    updated_at: now,
  })
}

function makeRows(revision: 'sample' | 'full'): TranslationRow[] {
  const suffix = revision === 'sample' ? '样片' : '全片'
  return [
    {
      id: 'seg-1',
      start: 0,
      end: 4.2,
      speaker: 'Speaker A',
      original_text: 'Wave59 was launched in 1999 for creators.',
      translated_text: `Wave 五九在一九九九年推出，主要服务创作者。${suffix}版保留固定读法。`,
    },
    {
      id: 'seg-2',
      start: 4.2,
      end: 8.6,
      speaker: 'Speaker A',
      original_text: 'Lars says the cadence should stay calm.',
      translated_text: '拉尔斯强调节奏要稳，句子要短，听起来像自然口播。',
    },
    {
      id: 'seg-3',
      start: 8.6,
      end: 12.4,
      speaker: 'Speaker A',
      original_text: 'Do not over-localize the technical term.',
      translated_text: '技术词不要过度本地化，先保持清楚，再处理语气。',
    },
  ]
}

function makeQaIssueRows(): TranslationRow[] {
  return [
    {
      id: 'seg-1',
      start: 0,
      end: 2.2,
      speaker: 'Speaker A',
      original_text: 'Beta 7 shipped in 1999 for launch demos.',
      translated_text: 'Beta 7 在1999年推出，用来给创作者演示发布节奏。',
    },
    {
      id: 'seg-2',
      start: 2.2,
      end: 4,
      speaker: 'Speaker A',
      original_text: 'The cadence should be slower and easier to listen to.',
      translated_text:
        '这里需要用非常非常长的一整句把所有背景、转折、解释和结论都塞进去，听起来就会像赶稿一样难以跟上。',
    },
    {
      id: 'seg-3',
      start: 4,
      end: 7.2,
      speaker: 'Speaker A',
      original_text: 'Keep technical words clear before making the line casual.',
      translated_text: '技术词先讲清楚，再处理成自然口播，不要只做字面替换。',
    },
  ]
}

function writeDubbingArtifacts(jobId: string, rows: TranslationRow[]) {
  const dir = jobTempDir(jobId)
  const segmentsPath = writeJsonFile(path.join(dir, 'segments.json'), {
    segments: rows.map((row) => ({
      id: row.id,
      start: row.start,
      end: row.end,
      speaker: row.speaker,
      text: row.original_text,
      original_text: row.original_text,
    })),
  })
  const translationsPath = writeJsonFile(path.join(dir, 'translations.json'), { segments: rows })

  return {
    schema_version: 1,
    artifacts: {
      'dubbing.segments': {
        path: segmentsPath,
        filename: 'segments.json',
        contentType: 'application/json; charset=utf-8',
        sourceStep: 'asr',
        updatedAt: now,
      },
      'dubbing.translations': {
        path: translationsPath,
        filename: 'translations.json',
        contentType: 'application/json; charset=utf-8',
        sourceStep: 'translate',
        updatedAt: now,
      },
    },
  }
}

function writeIngestArtifacts(jobId: string) {
  const dir = ingestOutputDir(jobId)
  const markdownPath = writeTextFile(
    path.join(dir, 'transcript.md'),
    '# E2E transcript\n\nWave59 was launched in 1999 for creators.\n',
  )
  const jsonPath = writeJsonFile(path.join(dir, 'transcript.json'), {
    segments: makeRows('sample').map((row) => ({
      id: row.id,
      start: row.start,
      end: row.end,
      text: row.original_text,
    })),
  })

  return {
    schema_version: 1,
    artifacts: {
      'ingest.transcript_markdown': {
        path: markdownPath,
        filename: 'transcript.md',
        contentType: 'text/markdown; charset=utf-8',
        sourceStep: 'transcribe',
        updatedAt: now,
      },
      'ingest.transcript_json': {
        path: jsonPath,
        filename: 'transcript.json',
        contentType: 'application/json; charset=utf-8',
        sourceStep: 'transcribe',
        updatedAt: now,
      },
    },
  }
}

function makeQaSummary(
  score: number,
  verdict: 'ready' | 'review' | 'fix',
  qaInputFingerprint?: DubbingQaInputFingerprint,
) {
  return {
    schema_version: 1,
    qa_engine_version: 'dubbing-qa-summary:v2',
    score,
    verdict,
    issue_count: verdict === 'fix' ? 1 : 0,
    watch_count: verdict === 'ready' ? 0 : 1,
    checked_at: now,
    translated_segments: 3,
    target_language: 'mandarin',
    ...(qaInputFingerprint ? { qa_input_fingerprint: qaInputFingerprint } : {}),
    top_recommendations:
      verdict === 'ready' ? [] : ['把 Wave59 固定读法写入长期词库后，再执行样片到全片。'],
  }
}

function makeDubbingConfig(overrides: JsonRecord = {}): JsonRecord {
  return {
    source_type: 'web_video',
    source_language: 'en',
    target_language: 'mandarin',
    translation_style: 'localized_script',
    lipsync_mode: 'none',
    speech_speed: 1,
    speaker_mode: 'single',
    voice_id: 'e2e_synthetic_voice_male',
    voice_selection_source: 'generic_registry',
    voice_usage_label: 'E2E 合成男声旁白',
    voice_category: 'synthetic_narration',
    voice_public_figure: false,
    voice_disclosure_required: true,
    usage_boundary_acknowledged: true,
    usage_boundary_acknowledgement_version: 'voice_usage_boundary_v1',
    usage_boundary_acknowledgement_text:
      '我确认本次声线使用边界：使用本人或已取得授权的声线，或在成片中明确标注 AI 翻译配音，不将结果包装成当事人亲口表达。',
    creator_context: baseCreatorContext,
    localization_glossary: glossary,
    ...overrides,
  }
}

async function buildFixtureQaInputFingerprint(input: {
  jobId: string
  createdAt: number
  config: JsonRecord
  artifactManifest: JsonRecord
  finalVideoLocalPath?: string | null
}): Promise<DubbingQaInputFingerprint> {
  const stepContext = {
    artifact_manifest: input.artifactManifest,
    e2e_no_paid_fixture: true,
  } as unknown as NonNullable<Job['state']>['step_context']
  const state: NonNullable<Job['state']> = {
    step_context: stepContext,
    total_scenes: 0,
    processed_scenes: 0,
    ...(input.finalVideoLocalPath ? { final_video_local_path: input.finalVideoLocalPath } : {}),
    updated_at: now,
  }
  const jobForFingerprint: Job = {
    id: input.jobId,
    job_type: 'translation_dubbing',
    status: 'completed',
    current_step: null,
    input_videos: [{ url: 'https://example.test/wave59-interview.mp4', label: 'Wave59 访谈' }],
    style_id: null,
    style_name: '转译配音',
    config: input.config as JobConfig,
    metadata: null,
    error_message: null,
    created_at: input.createdAt,
    updated_at: input.createdAt + 1200,
    started_at: input.createdAt + 100,
    completed_at: input.createdAt + 9000,
    state,
  }
  const artifactFingerprint = await getJobArtifactsFingerprint(input.jobId, state)

  return buildDubbingQaInputFingerprint(jobForFingerprint, artifactFingerprint)
}

async function seedDubbingJob(
  db: Database.Database,
  input: {
    id: string
    createdAt: number
    config: JsonRecord
    rows: TranslationRow[]
    qaSummary: JsonRecord
    finalVideoLocalPath?: string | null
    manualFinalListen?: ManualFinalListenFixtureRecord | null
    currentQaFingerprint?: boolean
    providerSmokeDryRunReady?: boolean
  },
) {
  const artifactManifest = writeDubbingArtifacts(input.id, input.rows)
  const qaSummary = input.currentQaFingerprint
    ? makeQaSummary(
        typeof input.qaSummary.score === 'number' ? input.qaSummary.score : 0,
        input.qaSummary.verdict === 'ready' ||
          input.qaSummary.verdict === 'review' ||
          input.qaSummary.verdict === 'fix'
          ? input.qaSummary.verdict
          : 'review',
        await buildFixtureQaInputFingerprint({
          jobId: input.id,
          createdAt: input.createdAt,
          config: input.config,
          artifactManifest,
          finalVideoLocalPath: input.finalVideoLocalPath,
        }),
      )
    : input.qaSummary
  upsertJob(db, {
    id: input.id,
    jobType: 'translation_dubbing',
    status: 'completed',
    createdAt: input.createdAt,
    styleName: '转译配音',
    inputVideos: [{ url: 'https://example.test/wave59-interview.mp4', label: 'Wave59 访谈' }],
    config: input.config,
  })
  upsertState(db, {
    jobId: input.id,
    context: {
      artifact_manifest: artifactManifest,
      qa_summary: qaSummary,
      ...(input.manualFinalListen ? { manual_final_listen: input.manualFinalListen } : {}),
      e2e_no_paid_fixture: true,
    },
    finalVideoLocalPath: input.finalVideoLocalPath,
  })
  upsertVideo(db, input.id)

  const steps = [
    ['asr', 'whisper_asr', { segments: 3 }],
    ['translate', 'gemini_translate', { translated_segments: 3 }],
    ['voiceclone', 'minimax_tts', { audio_segments: 3 }],
    ['package', 'build_delivery_package', { artifacts: 2 }],
  ] as const

  steps.forEach(([majorStep, subStep, output], index) => {
    upsertStep(db, {
      jobId: input.id,
      index: index + 1,
      majorStep,
      subStep,
      output,
      offset: (index + 1) * 1000,
    })
    upsertLog(db, {
      jobId: input.id,
      index: index + 1,
      majorStep,
      subStep,
      message: `E2E no-paid fixture：${subStep} 已完成。`,
    })
  })

  upsertApiCall(db, {
    jobId: input.id,
    index: 1,
    service: 'Gemini',
    operation: 'translateText',
    durationMs: 320,
  })
  upsertApiCall(db, {
    jobId: input.id,
    index: 2,
    service: 'MiniMax',
    operation: 'textToSpeech',
    durationMs: 410,
  })

  if (input.providerSmokeDryRunReady) {
    upsertProviderSmokeDryRunLog(db, input.id)
  }
}

function seedIngestJob(db: Database.Database) {
  const artifactManifest = writeIngestArtifacts(MAINLINE_FIXTURE_IDS.ingest)
  upsertJob(db, {
    id: MAINLINE_FIXTURE_IDS.ingest,
    jobType: 'content_ingest',
    status: 'completed',
    createdAt: now - 30_000,
    styleName: '素材吸收',
    inputVideos: [{ url: 'https://example.test/wave59-interview.mp4', label: 'Wave59 访谈' }],
    config: {
      source_type: 'web_video',
      source_url: 'https://example.test/wave59-interview.mp4',
      ingest_goal: 'localization',
      target_language: 'mandarin',
    },
  })
  upsertState(db, {
    jobId: MAINLINE_FIXTURE_IDS.ingest,
    context: {
      artifact_manifest: artifactManifest,
      e2e_no_paid_fixture: true,
    },
  })
  upsertVideo(db, MAINLINE_FIXTURE_IDS.ingest)
  upsertStep(db, {
    jobId: MAINLINE_FIXTURE_IDS.ingest,
    index: 1,
    majorStep: 'ingest',
    subStep: 'classify_source',
    output: { source_type: 'web_video' },
    offset: 100,
  })
  upsertStep(db, {
    jobId: MAINLINE_FIXTURE_IDS.ingest,
    index: 2,
    majorStep: 'transcribe',
    subStep: 'whisper_transcribe',
    output: { transcript: 'available' },
    offset: 200,
  })
}

function seedFailedDubbingJob(db: Database.Database) {
  const jobId = MAINLINE_FIXTURE_IDS.failed
  upsertJob(db, {
    id: jobId,
    jobType: 'translation_dubbing',
    status: 'failed',
    createdAt: now - 5_000,
    styleName: '转译配音',
    inputVideos: [{ url: 'https://example.test/failing-source.mp4', label: 'E2E 失败样本' }],
    config: makeDubbingConfig({
      source_label: 'E2E 失败任务',
      sample_mode: true,
      sample_duration_seconds: 30,
    }),
    errorMessage: 'E2E no-paid fixture：模拟翻译失败，用于任务列表状态展示。',
    errorMetadata: {
      category: 'fixture',
      userGuidance: '这是视觉 smoke 的隔离数据，不代表真实 provider 调用。',
    },
  })
  upsertState(db, {
    jobId,
    currentMajorStep: 'translate',
    currentSubStep: 'gemini_translate',
    context: { e2e_no_paid_fixture: true },
  })
  upsertLog(db, {
    jobId,
    index: 1,
    majorStep: 'translate',
    subStep: 'gemini_translate',
    message: 'E2E no-paid fixture：模拟失败日志。',
    level: 'error',
  })
}

async function seedQaIssueDubbingJob(db: Database.Database) {
  await seedDubbingJob(db, {
    id: MAINLINE_FIXTURE_IDS.qaIssues,
    createdAt: now - 15_000,
    rows: makeQaIssueRows(),
    qaSummary: makeQaSummary(58, 'fix'),
    config: makeDubbingConfig({
      source_job_id: MAINLINE_FIXTURE_IDS.ingest,
      source_label: 'Beta 7 QA issue fixture',
      sample_mode: true,
      sample_duration_seconds: 30,
      localization_glossary: [
        {
          source: 'Beta 7',
          target: '贝塔七',
          note: 'E2E 新增固定读法候选',
        },
      ],
      creator_context: {
        ...baseCreatorContext,
        content_brief:
          'E2E no-paid QA issue fixture：刻意制造固定读法和节奏问题，用于本地交互 smoke。',
      },
    }),
  })
}

function seedSettings(db: Database.Database) {
  upsertConfig(db, 'default_gemini_model', 'gemini-2.5-flash')
  upsertConfig(db, 'max_concurrent_scenes', '2')
  upsertConfig(db, 'gemini_video_fps', '1')
  upsertConfig(
    db,
    'laputa_creator_profile',
    json({
      creator_name: 'Laputa E2E',
      creator_positioning: '中文自媒体内容引擎',
      default_audience: '中文自媒体观众',
      default_wording_style: 'plain',
      mandarin_style_guide: '短句优先，数字写成口播中文。\n避免把英文采访直译成生硬书面语。',
      cantonese_style_guide: '保留香港口语节奏，但不强行繁体化数字。',
      default_voice_id: 'e2e_synthetic_voice_male',
    }),
  )
  upsertConfig(db, 'dubbing_project_glossary', json(glossary))
}

export async function seedMainlineVisualSmokeFixture() {
  const db = initFixtureDb(resolveDatabasePath())

  try {
    seedSettings(db)
    seedIngestJob(db)
    await seedDubbingJob(db, {
      id: MAINLINE_FIXTURE_IDS.sample,
      createdAt: now - 20_000,
      rows: makeRows('sample'),
      qaSummary: makeQaSummary(82, 'review'),
      config: makeDubbingConfig({
        source_job_id: MAINLINE_FIXTURE_IDS.ingest,
        source_label: 'Wave59 访谈样片',
        sample_mode: true,
        sample_duration_seconds: 30,
        sample_asset_snapshot: false,
      }),
    })
    await seedDubbingJob(db, {
      id: MAINLINE_FIXTURE_IDS.full,
      createdAt: now - 10_000,
      rows: makeRows('full'),
      qaSummary: makeQaSummary(94, 'ready'),
      finalVideoLocalPath: writeFinalVideoFile(MAINLINE_FIXTURE_IDS.full),
      currentQaFingerprint: true,
      manualFinalListen: {
        status: 'passed',
        note: 'E2E 已完整终听通过',
        checked_at: now + 10_000,
      },
      providerSmokeDryRunReady: true,
      config: makeDubbingConfig({
        source_job_id: MAINLINE_FIXTURE_IDS.sample,
        source_label: 'Wave59 样片升级全片',
        sample_mode: false,
        sample_to_full: true,
        sample_asset_snapshot: true,
        creator_context: {
          ...baseCreatorContext,
          revision_notes: '1. 已按 QA 修正 Wave59 固定读法。\n2. 已把一九九九年写成口播中文。',
        },
      }),
    })
    seedFailedDubbingJob(db)
    await seedQaIssueDubbingJob(db)
  } finally {
    db.close()
  }
}

function openFixtureReadonlyDb(): Database.Database {
  return new Database(resolveDatabasePath(), {
    readonly: true,
    fileMustExist: true,
  })
}

export function readMainlineFixtureConfig(key: string): string | null {
  const db = openFixtureReadonlyDb()

  try {
    const row = db.prepare('SELECT value FROM configs WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row?.value ?? null
  } finally {
    db.close()
  }
}

export function readMainlineFixtureStepContext(jobId: string): Record<string, unknown> | null {
  const db = openFixtureReadonlyDb()

  try {
    const row = db
      .prepare('SELECT step_context FROM job_current_state WHERE job_id = ?')
      .get(jobId) as { step_context: string | null } | undefined
    if (!row?.step_context) return null
    const value = JSON.parse(row.step_context) as unknown
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } finally {
    db.close()
  }
}
