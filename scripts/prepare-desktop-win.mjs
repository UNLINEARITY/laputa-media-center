import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const liteBundleDir = path.join(repoRoot, 'dist', 'laputa-lite-win')
const tauriDir = path.join(repoRoot, 'src-tauri')
const tauriResourceDir = path.join(tauriDir, 'r', 'l')
const tauriIconDir = path.join(tauriDir, 'icons')
const placeholderDir = path.join(repoRoot, 'dist', 'tauri-placeholder')
const cacheDir = path.join(repoRoot, 'dist', 'desktop-cache')
const downloadsDir = path.join(cacheDir, 'downloads')
const extractDir = path.join(cacheDir, 'extract')

const PYTHON_VERSION = process.env.LMC_DESKTOP_PYTHON_VERSION || '3.12.10'
const FFMPEG_URL =
  process.env.LMC_DESKTOP_FFMPEG_URL ||
  'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip'
const YT_DLP_URL =
  process.env.LMC_DESKTOP_YTDLP_URL ||
  'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
const WHISPER_URL =
  process.env.LMC_DESKTOP_WHISPER_URL ||
  'https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.4/whisper-bin-x64.zip'
const WHISPER_MODEL_URL =
  process.env.LMC_DESKTOP_WHISPER_MODEL_URL ||
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin'
const PYTHON_URL =
  process.env.LMC_DESKTOP_PYTHON_URL ||
  `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip`

const resourceManifest = {
  name: 'LaputaMediaCenter Desktop Windows resources',
  generatedAt: new Date().toISOString(),
  resources: {
    ffmpeg: FFMPEG_URL,
    ytDlp: YT_DLP_URL,
    whisperCpp: WHISPER_URL,
    whisperModel: WHISPER_MODEL_URL,
    python: PYTHON_URL,
  },
}

async function exists(target) {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

async function ensureDir(target) {
  await fs.mkdir(target, { recursive: true })
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: 'inherit',
      windowsHide: true,
      ...options,
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`))
      }
    })
  })
}

async function downloadWithFetch(url, target) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) {
    throw new Error(`Download failed: ${url} returned ${response.status} ${response.statusText}`)
  }
  await ensureDir(path.dirname(target))
  await pipeline(response.body, createWriteStream(target))
}

async function downloadWithCurl(url, target) {
  await ensureDir(path.dirname(target))
  await run('curl.exe', [
    '-L',
    '--fail',
    '--retry',
    '3',
    '--connect-timeout',
    '30',
    '--max-time',
    '1800',
    '-o',
    target,
    url,
  ])
}

async function download(url, target, minBytes) {
  if (await exists(target)) {
    const stat = await fs.stat(target)
    if (stat.size >= minBytes) {
      console.log(`[prepare-desktop-win] cached ${path.relative(repoRoot, target)}`)
      return
    }
  }

  console.log(`[prepare-desktop-win] downloading ${url}`)
  try {
    await downloadWithCurl(url, target)
  } catch (error) {
    console.warn(`[prepare-desktop-win] curl failed, retrying with fetch: ${error.message}`)
    await downloadWithFetch(url, target)
  }

  const stat = await fs.stat(target)
  if (stat.size < minBytes) {
    throw new Error(`Downloaded file is too small: ${target} (${stat.size} bytes)`)
  }
}

async function expandZip(zipPath, targetDir) {
  await fs.rm(targetDir, { recursive: true, force: true })
  await ensureDir(targetDir)
  await run('tar.exe', ['-xf', zipPath, '-C', targetDir])
}

async function findFile(root, fileName) {
  const queue = [root]
  const lowerFileName = fileName.toLowerCase()
  while (queue.length > 0) {
    const current = queue.shift()
    let entries
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        queue.push(fullPath)
      } else if (entry.name.toLowerCase() === lowerFileName) {
        return fullPath
      }
    }
  }
  return null
}

async function copyFile(source, target) {
  await ensureDir(path.dirname(target))
  await fs.copyFile(source, target)
}

async function copyDir(source, target) {
  await fs.rm(target, { recursive: true, force: true })
  await fs.cp(source, target, { recursive: true, force: true })
}

async function copySiblingBinaries(exePath, targetDir) {
  await ensureDir(targetDir)
  const sourceDir = path.dirname(exePath)
  const entries = await fs.readdir(sourceDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!/\.(exe|dll)$/i.test(entry.name)) continue
    await copyFile(path.join(sourceDir, entry.name), path.join(targetDir, entry.name))
  }
}

async function prepareFfmpeg(resourcesDir) {
  const zipPath = path.join(downloadsDir, 'ffmpeg-win64.zip')
  const unzipDir = path.join(extractDir, 'ffmpeg')
  await download(FFMPEG_URL, zipPath, 30 * 1024 * 1024)
  await expandZip(zipPath, unzipDir)

  const ffmpegExe = await findFile(unzipDir, 'ffmpeg.exe')
  const ffprobeExe = await findFile(unzipDir, 'ffprobe.exe')
  if (!ffmpegExe || !ffprobeExe) {
    throw new Error('Could not find ffmpeg.exe and ffprobe.exe after extracting FFmpeg')
  }

  const targetDir = path.join(resourcesDir, 'bin', 'ffmpeg')
  await copyFile(ffmpegExe, path.join(targetDir, 'ffmpeg.exe'))
  await copyFile(ffprobeExe, path.join(targetDir, 'ffprobe.exe'))
  console.log('[prepare-desktop-win] bundled FFmpeg')
}

async function prepareYtDlp(resourcesDir) {
  const exePath = path.join(downloadsDir, 'yt-dlp.exe')
  await download(YT_DLP_URL, exePath, 5 * 1024 * 1024)
  await copyFile(exePath, path.join(resourcesDir, 'bin', 'yt-dlp', 'yt-dlp.exe'))
  console.log('[prepare-desktop-win] bundled yt-dlp')
}

async function prepareWhisper(resourcesDir) {
  const zipPath = path.join(downloadsDir, 'whisper-bin-x64.zip')
  const unzipDir = path.join(extractDir, 'whisper')
  await download(WHISPER_URL, zipPath, 1024 * 1024)
  await expandZip(zipPath, unzipDir)

  const whisperExe =
    (await findFile(unzipDir, 'whisper-cli.exe')) || (await findFile(unzipDir, 'main.exe'))
  if (!whisperExe) {
    throw new Error('Could not find whisper-cli.exe or main.exe after extracting whisper.cpp')
  }
  const targetDir = path.join(resourcesDir, 'bin', 'whisper')
  await copySiblingBinaries(whisperExe, targetDir)
  await copyFile(whisperExe, path.join(targetDir, 'whisper-cli.exe'))

  const modelPath = path.join(downloadsDir, 'ggml-base.bin')
  await download(WHISPER_MODEL_URL, modelPath, 140 * 1024 * 1024)
  await copyFile(modelPath, path.join(resourcesDir, 'models', 'whisper', 'ggml-base.bin'))
  console.log('[prepare-desktop-win] bundled whisper.cpp and ggml-base model')
}

async function preparePython(resourcesDir) {
  const zipPath = path.join(downloadsDir, `python-${PYTHON_VERSION}-embed-amd64.zip`)
  const unzipDir = path.join(extractDir, 'python')
  await download(PYTHON_URL, zipPath, 8 * 1024 * 1024)
  await expandZip(zipPath, unzipDir)
  await copyDir(unzipDir, path.join(resourcesDir, 'python'))
  console.log('[prepare-desktop-win] bundled embeddable Python')
}

async function prepareIcons() {
  const iconPng = path.join(repoRoot, 'public', 'icon.png')
  if (!(await exists(iconPng))) return

  await ensureDir(tauriIconDir)
  await copyFile(iconPng, path.join(tauriIconDir, 'icon.png'))

  const png = await fs.readFile(iconPng)
  const icoHeader = Buffer.alloc(22)
  icoHeader.writeUInt16LE(0, 0)
  icoHeader.writeUInt16LE(1, 2)
  icoHeader.writeUInt16LE(1, 4)
  icoHeader.writeUInt8(0, 6)
  icoHeader.writeUInt8(0, 7)
  icoHeader.writeUInt8(0, 8)
  icoHeader.writeUInt8(0, 9)
  icoHeader.writeUInt16LE(1, 10)
  icoHeader.writeUInt16LE(32, 12)
  icoHeader.writeUInt32LE(png.length, 14)
  icoHeader.writeUInt32LE(22, 18)
  await fs.writeFile(path.join(tauriIconDir, 'icon.ico'), Buffer.concat([icoHeader, png]))
  console.log('[prepare-desktop-win] generated Tauri icons')
}

async function preparePlaceholderFrontend() {
  await ensureDir(placeholderDir)
  await fs.writeFile(
    path.join(placeholderDir, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><title>LaputaMediaCenter</title></head><body></body></html>\n',
    'utf8',
  )
}

async function main() {
  if (process.platform !== 'win32') {
    throw new Error('desktop Windows packaging must run on Windows')
  }
  if (!(await exists(path.join(liteBundleDir, 'server.js')))) {
    throw new Error(
      'Lite bundle is missing. Run NEXT_OUTPUT_STANDALONE=true pnpm build and pnpm package:lite:win first.',
    )
  }

  await ensureDir(downloadsDir)
  await preparePlaceholderFrontend()
  await prepareIcons()
  await copyDir(liteBundleDir, tauriResourceDir)

  const resourcesDir = path.join(tauriResourceDir, 'resources')
  await prepareFfmpeg(resourcesDir)
  await prepareYtDlp(resourcesDir)
  await prepareWhisper(resourcesDir)
  await preparePython(resourcesDir)

  await fs.writeFile(
    path.join(resourcesDir, 'desktop-manifest.json'),
    JSON.stringify(resourceManifest, null, 2),
    'utf8',
  )

  console.log(`[prepare-desktop-win] ready: ${path.relative(repoRoot, tauriResourceDir)}`)
}

main().catch((error) => {
  console.error(`[prepare-desktop-win] failed: ${error.message}`)
  process.exitCode = 1
})
