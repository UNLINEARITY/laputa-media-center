/**
 * whisper.cpp runtime 健康检查（供 settings UI 显示）。
 */

import { isWhisperBinaryReady } from './binary-installer'
import { isWhisperModelReady } from './model-installer'
import type { WhisperModelSize } from './types'

export interface WhisperCppRuntimeStatus {
  ready: boolean
  binary: {
    ready: boolean
    path: string | null
    source: string
  }
  model: {
    ready: boolean
    path: string | null
    size: WhisperModelSize
  }
  guidance?: string
}

function resolveModelSize(): WhisperModelSize {
  const env = process.env.WHISPER_CPP_MODEL?.trim()
  if (env === 'tiny' || env === 'base' || env === 'small' || env === 'medium') return env
  return 'base'
}

export function getWhisperCppRuntimeStatus(): WhisperCppRuntimeStatus {
  const binary = isWhisperBinaryReady()
  const modelSize = resolveModelSize()
  const model = isWhisperModelReady(modelSize)

  const ready = binary.ready && model.ready
  let guidance: string | undefined
  if (!ready) {
    if (!binary.ready && !model.ready) {
      guidance =
        '首次使用：在设置页点击「安装 whisper.cpp」按钮，或调用 POST /api/runtime/whisper-cpp/install'
    } else if (!binary.ready) {
      guidance = 'whisper.cpp 二进制未就绪，请触发安装或设置 WHISPER_CPP_PATH 环境变数'
    } else {
      guidance = `ggml-${modelSize}.bin 模型未就绪，请触发安装下载到 ~/.laputa/whisper/models/`
    }
  }

  return { ready, binary, model, guidance }
}
