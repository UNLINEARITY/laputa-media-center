/** 音画合成：将视频和音频文件合并为一个文件 */

import type {
  AudioEncodingOptions,
  FFmpegExecOptions,
  FFmpegServiceConfig,
  MergeOptions,
} from '../types'
import { convertGcsUrl, execFFmpeg } from '../utils/exec'

const AUDIO_DEFAULTS: Required<AudioEncodingOptions> = {
  codec: 'aac',
  bitrate: '128k',
  sampleRate: 44100,
  channels: 2,
}

export interface MergeAudioVideoOptions extends Partial<MergeOptions>, FFmpegExecOptions {
  /** 输出文件路径 */
  outputPath: string
  /** 是否复制视频流（不重编码），默认 true */
  copyVideo?: boolean
  /** 是否复制音频流（用于重编码原声视频） */
  copyAudio?: boolean
  /** 音频时长（秒），用于精确控制输出时长，优先于 -shortest */
  audioDuration?: number
  /** 配音音量（0.0-2.0，默认 1.0，0 静音，2.0 最大增益） */
  dubVolume?: number
}

/** 合并视频和音频（audioInput 为空时重编码原声视频） */
export async function mergeAudioVideo(
  videoInput: string,
  audioInput: string,
  options: MergeAudioVideoOptions,
  config: FFmpegServiceConfig,
): Promise<string> {
  const {
    outputPath,
    copyVideo = true,
    copyAudio = false,
    audioDuration,
    dubVolume,
    signal,
    onProgress,
    timeout,
  } = options

  const audioEncoding = {
    codec: options.codec ?? AUDIO_DEFAULTS.codec,
    bitrate: options.bitrate ?? AUDIO_DEFAULTS.bitrate,
    sampleRate: options.sampleRate ?? AUDIO_DEFAULTS.sampleRate,
    channels: options.channels ?? AUDIO_DEFAULTS.channels,
  }

  const videoUrl = convertGcsUrl(videoInput)
  const audioUrl = audioInput ? convertGcsUrl(audioInput) : ''

  const args = audioUrl
    ? buildMergeArgs(
        videoUrl,
        audioUrl,
        outputPath,
        audioEncoding,
        copyVideo,
        audioDuration,
        dubVolume,
      )
    : buildReencodeArgs(videoUrl, outputPath, audioEncoding, copyAudio)

  const result = await execFFmpeg(args, {
    ffmpegPath: config.ffmpegPath,
    timeout: timeout || config.defaultTimeout,
    signal,
    onProgress,
  })

  if (!result.success) {
    throw new Error(`音画合成失败: ${result.stderr}`)
  }

  return outputPath
}

/** 时长以音频为准（-t 精确指定），避免 -shortest 截断音频 */
function buildMergeArgs(
  videoInput: string,
  audioInput: string,
  output: string,
  audioEncoding: {
    codec: string
    bitrate: string
    sampleRate: number
    channels: number
  },
  copyVideo: boolean,
  audioDuration?: number,
  dubVolume?: number,
): string[] {
  const args: string[] = []

  args.push('-i', videoInput)
  args.push('-i', audioInput)
  args.push('-map', '0:v:0')
  args.push('-map', '1:a:0')

  if (copyVideo) {
    args.push('-c:v', 'copy')
  } else {
    args.push('-c:v', 'libx264')
    args.push('-preset', 'medium')
    args.push('-crf', '23')
  }

  const audioFilters: string[] = []

  // Fish Audio 单声道 → 立体声
  if (audioEncoding.channels === 2) {
    audioFilters.push('pan=stereo|c0=c0|c1=c0')
  }

  if (dubVolume !== undefined && dubVolume !== 1.0) {
    audioFilters.push(`volume=${dubVolume.toFixed(2)}`)
  }

  if (audioFilters.length > 0) {
    args.push('-af', audioFilters.join(','))
  }

  args.push('-c:a', audioEncoding.codec)
  args.push('-b:a', audioEncoding.bitrate)
  args.push('-ar', audioEncoding.sampleRate.toString())
  args.push('-ac', audioEncoding.channels.toString())

  if (audioDuration && audioDuration > 0) {
    args.push('-t', audioDuration.toFixed(3))
  } else {
    args.push('-shortest')
  }

  args.push(output)

  return args
}

function buildReencodeArgs(
  videoInput: string,
  output: string,
  audioEncoding: {
    codec: string
    bitrate: string
    sampleRate: number
    channels: number
  },
  copyAudio: boolean,
): string[] {
  const args: string[] = []

  args.push('-i', videoInput)
  args.push('-c:v', 'libx264')
  args.push('-preset', 'medium')
  args.push('-crf', '23')
  args.push('-r', '30') // 强制 30fps，确保与配音分镜格式一致

  if (copyAudio) {
    args.push('-c:a', 'copy')
  } else {
    args.push('-c:a', audioEncoding.codec)
    args.push('-b:a', audioEncoding.bitrate)
    args.push('-ar', audioEncoding.sampleRate.toString())
    args.push('-ac', audioEncoding.channels.toString())
  }

  args.push(output)

  return args
}
