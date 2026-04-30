import { readFile } from 'node:fs/promises'
import path from 'node:path'

export const RUNTIME_FINGERPRINT_ENDPOINT = '/api/runtime/fingerprint'
export const RUNTIME_FINGERPRINT_SCHEMA_VERSION = 1
export const RUNTIME_FINGERPRINT_CONTRACT = 'laputa-runtime-fingerprint'

async function readOptionalTextFile(filePath) {
  try {
    const value = (await readFile(filePath, 'utf-8')).trim()
    return value || null
  } catch {
    return null
  }
}

export async function readExpectedRuntimeFingerprint(cwd = process.cwd()) {
  const packageJson = JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf-8'))
  if (typeof packageJson.name !== 'string' || typeof packageJson.version !== 'string') {
    throw new Error('package.json must include name and version')
  }

  return {
    package_name: packageJson.name,
    package_version: packageJson.version,
    next_build_id: await readOptionalTextFile(path.join(cwd, '.next', 'BUILD_ID')),
  }
}

async function readJson(response, label) {
  const text = await response.text()
  let payload
  try {
    payload = text ? JSON.parse(text) : {}
  } catch (error) {
    throw new Error(
      `${label} returned invalid JSON: ${error instanceof Error ? error.message : error}`,
    )
  }

  if (!response.ok) {
    const message = payload?.message || payload?.error || response.statusText
    throw new Error(`${label} failed with HTTP ${response.status}: ${message}`)
  }

  return payload
}

export async function fetchAndAssertRuntimeFingerprint(baseUrl, token, options = {}) {
  const expected = options.expected || (await readExpectedRuntimeFingerprint())
  const payload = await readJson(
    await fetch(`${baseUrl}${RUNTIME_FINGERPRINT_ENDPOINT}`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
    'runtime fingerprint request',
  )

  if (
    payload?.ok !== true ||
    payload?.schema_version !== RUNTIME_FINGERPRINT_SCHEMA_VERSION ||
    payload?.runtime_contract !== RUNTIME_FINGERPRINT_CONTRACT ||
    !payload?.runtime_fingerprint ||
    typeof payload?.runtime_booted_at !== 'number'
  ) {
    throw new Error('runtime fingerprint response must match the current contract')
  }

  const actual = payload.runtime_fingerprint
  const mismatchedFields = ['package_name', 'package_version', 'next_build_id'].filter(
    (field) => actual?.[field] !== expected[field],
  )
  if (mismatchedFields.length > 0) {
    throw new Error(`runtime fingerprint mismatch: ${mismatchedFields.join(', ')}`)
  }

  return {
    endpoint: RUNTIME_FINGERPRINT_ENDPOINT,
    package_name: expected.package_name,
    package_version: expected.package_version,
    next_build_id: expected.next_build_id,
    runtime_booted_at: payload.runtime_booted_at,
    matched: true,
  }
}
