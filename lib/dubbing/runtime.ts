import { existsSync } from 'node:fs'
import * as path from 'node:path'
import {
  getLiteResourcesDir,
  resolveLiteExecutable,
  resolveLiteResourcePath,
  resolveLiteScript,
} from '@/lib/packaging/lite-runtime'

export function resolveProjectPath(...segments: string[]): string {
  return path.resolve(path.join(/* turbopackIgnore: true */ process.cwd(), ...segments))
}

export function getDubbingSkillDir(): string {
  if (process.env.DUBBING_SKILL_DIR) {
    return path.resolve(process.env.DUBBING_SKILL_DIR)
  }
  const liteResourcesDir = getLiteResourcesDir()
  if (liteResourcesDir) {
    return liteResourcesDir
  }
  return resolveProjectPath('..', 'laputa-video-chuangcut-editing')
}

export function getDubbingPythonExe(kind: 'dub' | 'rvc' = 'dub'): string {
  const envValue =
    kind === 'rvc' ? process.env.DUBBING_RVC_PYTHON_EXE : process.env.DUBBING_PYTHON_EXE
  if (envValue) return path.resolve(envValue)

  const packagedPython = resolveLiteExecutable(kind === 'rvc' ? 'python-rvc' : 'python-dub')
  if (packagedPython) return packagedPython

  const venvName = kind === 'rvc' ? 'venv-rvc' : 'venv-dub'
  const skillPythonDir = path.join(getDubbingSkillDir(), 'scripts', 'python')
  const candidates = [
    path.join(skillPythonDir, venvName, 'Scripts', 'python.exe'),
    path.join(skillPythonDir, venvName, 'bin', 'python'),
  ]

  return candidates.find((candidate) => existsSync(candidate)) || 'python'
}

export function findDubbingScript(scriptName: string): string {
  const skillDir = getDubbingSkillDir()
  const packagedScript = resolveLiteScript(scriptName)
  if (packagedScript) return packagedScript

  const candidates = [
    resolveProjectPath('skills', scriptName),
    resolveProjectPath('scripts', scriptName),
    path.join(skillDir, 'scripts', 'python', scriptName),
    path.join(skillDir, scriptName),
    resolveProjectPath(scriptName),
  ]

  return candidates.find((candidate) => existsSync(candidate)) || candidates[2]
}

export function findDubbingCredential(fileName: string): string | null {
  const skillDir = getDubbingSkillDir()
  const candidates = [
    resolveProjectPath('config', fileName),
    resolveProjectPath('data', fileName),
    resolveLiteResourcePath('config', fileName),
    resolveLiteResourcePath('data', fileName),
    path.join(skillDir, 'credentials', fileName),
  ].filter(Boolean) as string[]

  return candidates.find((candidate) => existsSync(candidate)) || null
}

export function findWav2LipScript(): string {
  const skillDir = getDubbingSkillDir()
  const candidates = [
    resolveProjectPath('skills', 'Wav2Lip', 'inference.py'),
    resolveProjectPath('Wav2Lip', 'inference.py'),
    resolveProjectPath('scripts', 'Wav2Lip', 'inference.py'),
    resolveLiteResourcePath('scripts', 'Wav2Lip', 'inference.py'),
    resolveLiteResourcePath('Wav2Lip', 'inference.py'),
    path.join(skillDir, 'scripts', 'python', 'wav2lip-HD', 'Wav2Lip-master', 'inference.py'),
  ].filter(Boolean) as string[]

  return candidates.find((candidate) => existsSync(candidate)) || candidates[candidates.length - 1]
}

export function findWav2LipCheckpoint(): string {
  const skillDir = getDubbingSkillDir()
  const candidates = [
    resolveProjectPath('skills', 'Wav2Lip', 'checkpoints', 'wav2lip_gan.pth'),
    resolveLiteResourcePath('Wav2Lip', 'checkpoints', 'wav2lip_gan.pth'),
    resolveLiteResourcePath('models', 'wav2lip', 'wav2lip_gan.pth'),
    path.join(
      skillDir,
      'scripts',
      'python',
      'wav2lip-HD',
      'Wav2Lip-master',
      'checkpoints',
      'wav2lip_gan.pth',
    ),
  ].filter(Boolean) as string[]

  return candidates.find((candidate) => existsSync(candidate)) || candidates[candidates.length - 1]
}
