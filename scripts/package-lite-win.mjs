import { constants } from 'node:fs'
import fs from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const nextDir = path.join(repoRoot, '.next')
const standaloneDir = path.join(nextDir, 'standalone')
const staticDir = path.join(nextDir, 'static')
const publicDir = path.join(repoRoot, 'public')
const startScript = path.join(repoRoot, 'scripts', 'start-lite-win.ps1')
const distRoot = path.join(repoRoot, 'dist')
const packageDir = path.join(distRoot, 'laputa-lite-win')
const resourcesDir = path.join(packageDir, 'resources')

const PYTHON_SCRIPTS = ['whisper_asr.py', 'translator.py', 'voice_cloner.py', 'compose_dub.py']
const PRUNED_STANDALONE_PATHS = [
  '.cache',
  '.coverage',
  '.turbo',
  'coverage',
  'data',
  'dist',
  'docs',
  'logs',
  'playwright-report',
  'test-results',
  'tests',
  'tmp',
]

const resourcesReadme = `# LaputaMediaCenter Lite Windows resources

This directory is bundled with the Lite Windows package.

- bin/ffmpeg/ffmpeg.exe and bin/ffmpeg/ffprobe.exe: optional bundled FFmpeg tools.
- bin/yt-dlp/yt-dlp.exe: optional bundled YouTube/web video downloader.
- bin/whisper/whisper-cli.exe: optional bundled whisper.cpp binary.
- models/whisper/ggml-base.bin: optional bundled whisper.cpp model.
- node/node.exe: bundled Node.js runtime used by start-lite-win.ps1.
- scripts/*.py: Python helper scripts used by dubbing workflows.

User data is stored outside this resources folder under:
%LOCALAPPDATA%\\LaputaMediaCenter
`

async function exists(target) {
  try {
    await fs.access(target, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function copyDir(source, target, label, { optional = false } = {}) {
  if (!(await exists(source))) {
    const message = `${label} not found: ${path.relative(repoRoot, source)}`
    if (optional) {
      console.warn(`[package-lite-win] skip: ${message}`)
      return false
    }
    throw new Error(message)
  }

  await fs.cp(source, target, { recursive: true, force: true })
  console.log(`[package-lite-win] copied ${label}`)
  return true
}

async function findStandaloneAppDir() {
  if (await exists(path.join(standaloneDir, 'server.js'))) return standaloneDir

  const queue = [standaloneDir]
  while (queue.length > 0) {
    const current = queue.shift()
    let entries
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      continue
    }

    if (entries.some((entry) => entry.isFile() && entry.name === 'server.js')) {
      return current
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name === 'node_modules') continue
      queue.push(path.join(current, entry.name))
    }
  }

  return null
}

async function copyStandaloneServer() {
  if (!(await exists(standaloneDir))) {
    console.warn(
      `[package-lite-win] skip: standalone server not found: ${path.relative(repoRoot, standaloneDir)}`,
    )
    return false
  }

  const appDir = await findStandaloneAppDir()
  if (!appDir) {
    console.warn('[package-lite-win] skip: standalone server.js not found')
    return false
  }

  await fs.cp(appDir, packageDir, { recursive: true, force: true })
  if (appDir !== standaloneDir) {
    await copyDir(
      path.join(standaloneDir, 'node_modules'),
      path.join(packageDir, 'node_modules'),
      'standalone shared node_modules',
      {
        optional: true,
      },
    )
  }
  console.log('[package-lite-win] copied standalone server')
  return true
}

async function pruneStandaloneNoise() {
  for (const relativePath of PRUNED_STANDALONE_PATHS) {
    await fs.rm(path.join(packageDir, relativePath), { recursive: true, force: true })
  }
  console.log('[package-lite-win] pruned dev/runtime noise from standalone output')
}

async function writeFileIfMissing(target, content) {
  if (await exists(target)) return
  await fs.writeFile(target, content, 'utf8')
}

async function ensurePlaceholderDir(...segments) {
  const directory = path.join(resourcesDir, ...segments)
  await fs.mkdir(directory, { recursive: true })
  await writeFileIfMissing(path.join(directory, '.gitkeep'), '')
  return directory
}

async function findExecutableOnPath(command) {
  const pathEnv = process.env.PATH || ''
  const extensions =
    process.platform === 'win32'
      ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
      : ['']

  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue
    const base = path.join(dir, command)
    const candidates =
      process.platform === 'win32' && !path.extname(command)
        ? extensions.flatMap((ext) => [base + ext.toLowerCase(), base + ext])
        : [base]
    for (const candidate of candidates) {
      if (await exists(candidate)) return candidate
    }
  }
  return null
}

async function copyOptionalExecutable(command, targetRelativePath) {
  const source = await findExecutableOnPath(command)
  const target = path.join(resourcesDir, targetRelativePath)
  await fs.mkdir(path.dirname(target), { recursive: true })

  if (!source) {
    await writeFileIfMissing(path.join(path.dirname(target), '.gitkeep'), '')
    console.warn(`[package-lite-win] optional tool not found on PATH: ${command}`)
    return false
  }

  await fs.copyFile(source, target)
  console.log(`[package-lite-win] copied optional tool: ${command}`)
  return true
}

async function copyOptionalFile(source, target, label) {
  await fs.mkdir(path.dirname(target), { recursive: true })
  if (!(await exists(source))) {
    await writeFileIfMissing(path.join(path.dirname(target), '.gitkeep'), '')
    console.warn(`[package-lite-win] optional file not found: ${label}`)
    return false
  }

  await fs.copyFile(source, target)
  console.log(`[package-lite-win] copied ${label}`)
  return true
}

async function copyOptionalWhisperCache() {
  const cacheDir = path.join(homedir(), '.laputa', 'whisper', 'bin', process.platform)
  const exeName = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
  if (!(await exists(path.join(cacheDir, exeName)))) {
    await ensurePlaceholderDir('bin', 'whisper')
    console.warn('[package-lite-win] optional whisper.cpp cache not ready')
    return false
  }

  return copyDir(cacheDir, path.join(resourcesDir, 'bin', 'whisper'), 'cached whisper.cpp binary', {
    optional: true,
  })
}

async function copyBundledNode() {
  const target = path.join(resourcesDir, 'node', process.platform === 'win32' ? 'node.exe' : 'node')
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.copyFile(process.execPath, target)
  console.log('[package-lite-win] copied Node.js runtime')
}

async function copyPythonScripts() {
  const targetDir = path.join(resourcesDir, 'scripts')
  await fs.mkdir(targetDir, { recursive: true })
  for (const scriptName of PYTHON_SCRIPTS) {
    await fs.copyFile(path.join(repoRoot, 'scripts', scriptName), path.join(targetDir, scriptName))
  }
  console.log('[package-lite-win] copied Python helper scripts')
}

async function main() {
  await fs.rm(packageDir, { recursive: true, force: true })
  await fs.mkdir(packageDir, { recursive: true })

  const copiedStandalone = await copyStandaloneServer()
  await pruneStandaloneNoise()
  await copyDir(staticDir, path.join(packageDir, '.next', 'static'), '.next/static')
  await copyDir(publicDir, path.join(packageDir, 'public'), 'public assets', { optional: true })
  await copyDir(
    path.join(repoRoot, 'lib', 'db'),
    path.join(packageDir, 'lib', 'db'),
    'database schema',
  )
  await fs.copyFile(startScript, path.join(packageDir, 'start-lite-win.ps1'))

  await fs.mkdir(resourcesDir, { recursive: true })
  await fs.writeFile(path.join(resourcesDir, 'README.md'), resourcesReadme, 'utf8')
  await copyBundledNode()
  await copyPythonScripts()

  await copyOptionalExecutable('ffmpeg', path.join('bin', 'ffmpeg', 'ffmpeg.exe'))
  await copyOptionalExecutable('ffprobe', path.join('bin', 'ffmpeg', 'ffprobe.exe'))
  await copyOptionalExecutable('yt-dlp', path.join('bin', 'yt-dlp', 'yt-dlp.exe'))
  await copyOptionalExecutable('whisper-cli', path.join('bin', 'whisper', 'whisper-cli.exe'))

  await copyOptionalWhisperCache()
  await copyOptionalFile(
    path.join(homedir(), '.laputa', 'whisper', 'models', 'ggml-base.bin'),
    path.join(resourcesDir, 'models', 'whisper', 'ggml-base.bin'),
    'cached ggml-base.bin',
  )

  await ensurePlaceholderDir('bin', 'whisper')
  await ensurePlaceholderDir('models', 'whisper')
  await ensurePlaceholderDir('python')

  if (!copiedStandalone) {
    console.warn(
      '[package-lite-win] warning: .next/standalone was not found. Run a standalone build first, for example: $env:NEXT_OUTPUT_STANDALONE="true"; pnpm build',
    )
  }

  console.log(`[package-lite-win] package ready: ${path.relative(repoRoot, packageDir)}`)
}

main().catch((error) => {
  console.error(`[package-lite-win] failed: ${error.message}`)
  process.exitCode = 1
})
