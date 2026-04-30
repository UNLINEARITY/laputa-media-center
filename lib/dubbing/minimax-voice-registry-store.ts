import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import * as path from 'node:path'
import { findDubbingCredential, resolveProjectPath } from '@/lib/dubbing/runtime'
import {
  type MiniMaxVoiceRegistryEntry,
  normalizeMiniMaxVoiceRegistryMap,
  serializeMiniMaxVoiceRegistryEntry,
} from '@/lib/dubbing/voice-registry'

export function findMiniMaxVoiceRegistryFile(): string | null {
  const candidates = [
    findDubbingCredential('minimax_cloned_voices.json'),
    resolveProjectPath('data', 'minimax_cloned_voices.json'),
    resolveProjectPath('config', 'minimax_cloned_voices.json'),
  ].filter(Boolean) as string[]

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

export function getWritableMiniMaxVoiceRegistryFile(): string {
  return findMiniMaxVoiceRegistryFile() || resolveProjectPath('data', 'minimax_cloned_voices.json')
}

export function readMiniMaxVoiceRegistryMap(
  filePath: string | null = findMiniMaxVoiceRegistryFile(),
): Record<string, MiniMaxVoiceRegistryEntry> {
  if (!filePath || !existsSync(filePath)) return {}

  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8'))
    return normalizeMiniMaxVoiceRegistryMap(data)
  } catch {
    return {}
  }
}

export function readMiniMaxVoiceRegistryEntries(): MiniMaxVoiceRegistryEntry[] {
  return Object.values(readMiniMaxVoiceRegistryMap())
}

export function writeMiniMaxVoiceRegistryMap(
  filePath: string,
  voices: Record<string, MiniMaxVoiceRegistryEntry>,
): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(
    filePath,
    JSON.stringify(
      Object.fromEntries(
        Object.entries(voices).map(([voiceId, entry]) => [
          voiceId,
          serializeMiniMaxVoiceRegistryEntry(entry),
        ]),
      ),
      null,
      2,
    ),
    'utf-8',
  )
}
