import { logger } from '@/lib/utils/logger'
import type { GeminiPlatform } from '@/types/ai/gemini'

type GeminiRuntimeCacheClearer = (platform: GeminiPlatform) => void

const runtimeCacheClearers = new Set<GeminiRuntimeCacheClearer>()

export function registerGeminiRuntimeCacheClearer(clearer: GeminiRuntimeCacheClearer): () => void {
  runtimeCacheClearers.add(clearer)

  return () => {
    runtimeCacheClearers.delete(clearer)
  }
}

export function clearGeminiRuntimeCache(platform: GeminiPlatform): void {
  if (runtimeCacheClearers.size === 0) {
    logger.info('[Gemini] 运行时缓存清理跳过：当前没有已注册缓存', { platform })
    return
  }

  for (const clearer of runtimeCacheClearers) {
    clearer(platform)
  }

  logger.info('[Gemini] 运行时缓存已清理', { platform })
}
