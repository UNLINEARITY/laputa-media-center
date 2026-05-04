import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ENV_KEYS = ['LMC_APP_DATA_DIR', 'LMC_LITE_MODE', 'OUTPUT_DIR', 'RUNTIME_DIR', 'TEMP_DIR']
const originalEnv = new Map<string, string | undefined>()

beforeEach(() => {
  for (const key of ENV_KEYS) {
    originalEnv.set(key, process.env[key])
    delete process.env[key]
  }
  vi.resetModules()
})

afterEach(() => {
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('runtime path constants', () => {
  it('uses Lite app data as runtime root when Lite mode is enabled', async () => {
    const appDataDir = path.join('C:', 'Users', 'tester', 'AppData', 'Local', 'LaputaMediaCenter')
    process.env.LMC_LITE_MODE = 'true'
    process.env.LMC_APP_DATA_DIR = appDataDir

    const paths = await import('@/lib/utils/paths')

    expect(paths.TEMP_ROOT).toBe(path.normalize(path.join(appDataDir, 'runtime', 'temp')))
    expect(paths.OUTPUT_DIR).toBe(path.normalize(path.join(appDataDir, 'runtime', 'output')))
    expect(paths.getJobTempDir('job-1')).toBe(
      `${path.normalize(path.join(appDataDir, 'runtime', 'temp'))}/jobs/job-1`,
    )
  })

  it('keeps explicit runtime path env overrides ahead of Lite defaults', async () => {
    process.env.LMC_LITE_MODE = 'true'
    process.env.LMC_APP_DATA_DIR = path.join(
      'C:',
      'Users',
      'tester',
      'AppData',
      'Local',
      'LaputaMediaCenter',
    )
    process.env.RUNTIME_DIR = path.join('D:', 'laputa-runtime')

    const paths = await import('@/lib/utils/paths')

    expect(paths.TEMP_ROOT).toBe(path.normalize(path.join('D:', 'laputa-runtime', 'temp')))
    expect(paths.OUTPUT_DIR).toBe(path.normalize(path.join('D:', 'laputa-runtime', 'output')))
  })
})
