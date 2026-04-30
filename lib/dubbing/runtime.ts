import { existsSync } from 'node:fs'
import * as path from 'node:path'

export function resolveProjectPath(...segments: string[]): string {
  return path.resolve(path.join(/* turbopackIgnore: true */ process.cwd(), ...segments))
}

export function getDubbingSkillDir(): string {
  if (process.env.DUBBING_SKILL_DIR) {
    return path.resolve(process.env.DUBBING_SKILL_DIR)
  }
  return resolveProjectPath('..', 'laputa-video-chuangcut-editing')
}

export function getDubbingPythonExe(kind: 'dub' | 'rvc' = 'dub'): string {
  const envValue =
    kind === 'rvc' ? process.env.DUBBING_RVC_PYTHON_EXE : process.env.DUBBING_PYTHON_EXE
  if (envValue) return path.resolve(envValue)

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
    path.join(skillDir, 'credentials', fileName),
  ]

  return candidates.find((candidate) => existsSync(candidate)) || null
}

export function findWav2LipScript(): string {
  const skillDir = getDubbingSkillDir()
  const candidates = [
    resolveProjectPath('skills', 'Wav2Lip', 'inference.py'),
    resolveProjectPath('Wav2Lip', 'inference.py'),
    resolveProjectPath('scripts', 'Wav2Lip', 'inference.py'),
    path.join(skillDir, 'scripts', 'python', 'wav2lip-HD', 'Wav2Lip-master', 'inference.py'),
  ]

  return candidates.find((candidate) => existsSync(candidate)) || candidates[3]
}

export function findWav2LipCheckpoint(): string {
  const skillDir = getDubbingSkillDir()
  const candidates = [
    resolveProjectPath('skills', 'Wav2Lip', 'checkpoints', 'wav2lip_gan.pth'),
    path.join(
      skillDir,
      'scripts',
      'python',
      'wav2lip-HD',
      'Wav2Lip-master',
      'checkpoints',
      'wav2lip_gan.pth',
    ),
  ]

  return candidates.find((candidate) => existsSync(candidate)) || candidates[1]
}
