import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findDubbingScript, getDubbingPythonExe, getDubbingSkillDir } from '@/lib/dubbing/runtime'

const ENV_KEYS = [
  'DUBBING_PYTHON_EXE',
  'DUBBING_RVC_PYTHON_EXE',
  'DUBBING_SKILL_DIR',
  'LMC_LITE_RESOURCES_DIR',
]
const originalEnv = new Map<string, string | undefined>()
let tempRoot: string

function pythonExeName(): string {
  return process.platform === 'win32' ? 'python.exe' : 'python'
}

async function touch(filePath: string) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, '')
}

beforeEach(async () => {
  for (const key of ENV_KEYS) {
    originalEnv.set(key, process.env[key])
    delete process.env[key]
  }
  tempRoot = await mkdtemp(path.join(tmpdir(), 'lmc-dubbing-runtime-'))
})

afterEach(async () => {
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await rm(tempRoot, { recursive: true, force: true })
})

describe('dubbing runtime Lite resolution', () => {
  it('uses packaged resources for skill dir, Python, and helper scripts', async () => {
    const resourcesDir = path.join(tempRoot, 'resources')
    const pythonPath = path.join(resourcesDir, 'python', pythonExeName())
    const scriptPath = path.join(resourcesDir, 'scripts', 'translator.py')
    await touch(pythonPath)
    await touch(scriptPath)
    process.env.LMC_LITE_RESOURCES_DIR = resourcesDir

    expect(getDubbingSkillDir()).toBe(resourcesDir)
    expect(getDubbingPythonExe('dub')).toBe(pythonPath)
    expect(findDubbingScript('translator.py')).toBe(scriptPath)
  })
})
