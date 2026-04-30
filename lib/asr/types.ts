/**
 * ASR (Automatic Speech Recognition) 共用类型。
 *
 * Phase 2：whisper.cpp 后端的 segment 格式必须与下游 translator.py
 * 的 segments_file 契约对齐：JSON 数组 [{id, start, end, text}]，
 * 时间为秒（float）。下游 schema 不可变（受保护资产 translator.py）。
 */

export type WhisperModelSize = 'tiny' | 'base' | 'small' | 'medium'

export interface AsrSegment {
  /** segment 序号（0-based） */
  id: number
  /** 起始时间（秒） */
  start: number
  /** 结束时间（秒） */
  end: number
  /** 段落文本（已去首尾空白） */
  text: string
}

export interface WhisperCppOptions {
  /** 模型大小，默认 'base' */
  modelSize?: WhisperModelSize
  /** 语言代码（ISO 639-1，如 'zh' / 'en' / 'yue'）；不设或 'auto' 让 whisper.cpp 自动检测 */
  language?: string
  /** 工作线程数，默认 max(cpus - 2, 1) */
  threads?: number
  /** segments.json 落盘目录（必填） */
  outputDir: string
  /** 输出 segments JSON 文件名，默认 'segments.json'；dubbing 流程会传 'dubbing.segments.json' 等 */
  segmentsFilename?: string
  /** 进度回调 */
  onProgress?: (phase: 'binary' | 'model' | 'transcribe', pct: number) => void
}

export interface WhisperCppResult {
  /** 标准化后的分段（与 translator.py schema 兼容） */
  segments: AsrSegment[]
  /** 检测到（或指定）的语言 */
  language: string
  /** 完整转录文本（segments.text 拼接） */
  text: string
  /** segments.json 落盘绝对路径 */
  segmentsJsonPath: string
}

/**
 * GitHub release tag（手动升级；避免 release URL schema 漂移）
 * 注意：v1.7.4 之后官方 repo 由 ggerganov/whisper.cpp 改名为 ggml-org/whisper.cpp，
 * v1.7.4 的 release assets 没有迁移（404），所以最低支持 v1.8.4。
 */
export const WHISPER_CPP_RELEASE_TAG = 'v1.8.4'

/** GitHub repo owner/name（2025 改名后） */
export const WHISPER_CPP_GITHUB_REPO = 'ggml-org/whisper.cpp'

/** HuggingFace ggml model repo（HF 仍保留旧 owner，未改名） */
export const WHISPER_CPP_MODEL_REPO = 'ggerganov/whisper.cpp'
