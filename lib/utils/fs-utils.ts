import { promises as fs } from 'node:fs'
import path from 'node:path'

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true })
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

export async function removeDir(dirPath: string): Promise<void> {
  await fs.rm(dirPath, { recursive: true, force: true })
}

export function getFileExtensionFromUrl(url: string, fallback = '.mp4'): string {
  try {
    const parsed = new URL(url)
    const ext = path.extname(parsed.pathname)
    return ext || fallback
  } catch {
    return fallback
  }
}
