'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Button,
  Card,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui'
import { CONFIG_DEFAULTS } from '@/lib/config'
import type { SystemConfig as SystemConfigType } from '@/types/api/config'

/** 预设区域选项 */
const LOCATION_PRESETS = [
  { value: 'global', label: 'Global（推荐，支持 Gemini 3）' },
  { value: 'us-central1', label: 'US Central 1' },
  { value: 'us-east4', label: 'US East 4' },
  { value: 'europe-west1', label: 'Europe West 1' },
  { value: 'asia-northeast1', label: 'Asia Northeast 1（东京）' },
  { value: 'custom', label: '自定义区域...' },
]

/** 预设模型选项 */
const MODEL_PRESETS = [
  { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview（公益站/预览）' },
  { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite（免费层推荐）' },
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash（免费层/平衡）' },
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro（付费层）' },
  { value: 'gemini-3-pro-preview', label: 'Gemini 3 Pro（付费层）' },
  { value: 'custom', label: '自定义模型...' },
]

/** 未启用视觉理解预留媒体分辨率选项 */
const MEDIA_RESOLUTION_OPTIONS = [
  {
    value: 'MEDIA_RESOLUTION_LOW',
    label: '低分辨率（省钱模式）',
    description: '70 tokens/帧，适合低成本画面上下文',
  },
  {
    value: 'MEDIA_RESOLUTION_MEDIUM',
    label: '中分辨率（平衡模式）',
    description: '70 tokens/帧，画面细节与成本平衡',
  },
  {
    value: 'MEDIA_RESOLUTION_HIGH',
    label: '高分辨率（精细模式）',
    description: '280 tokens/帧，仅建议用于文字或小细节画面',
  },
]

/** 未启用视觉理解预留采样帧率（FPS）预设选项 */
const VIDEO_FPS_PRESETS = [
  // 低采样（节省 token）
  { value: '0.1', label: '0.1 帧/秒', description: '每 10 秒 1 帧，超长素材（90+ 分钟）' },
  { value: '0.2', label: '0.2 帧/秒', description: '每 5 秒 1 帧，超长素材（60+ 分钟）' },
  { value: '0.5', label: '0.5 帧/秒', description: '每 2 秒 1 帧，长素材（30-60 分钟）' },
  // 标准
  { value: '1.0', label: '1 帧/秒（默认）', description: '标准采样，平衡成本与上下文' },
  // 高采样（更高精度）
  { value: '2.0', label: '2 帧/秒', description: '较高采样，适合动作密集素材' },
  { value: '5.0', label: '5 帧/秒', description: '高频采样，适合短素材理解' },
  { value: '10.0', label: '10 帧/秒', description: '精细采样，高 token 消耗' },
  { value: '24.0', label: '24 帧/秒', description: '帧级采样，极高 token 消耗' },
  { value: 'custom', label: '自定义...' },
]

/** 系统并发数选项（1-5） */
const CONCURRENCY_OPTIONS = [
  { value: '1', label: '1 并发', description: '最低资源占用' },
  { value: '2', label: '2 并发', description: '低资源模式' },
  { value: '3', label: '3 并发（默认）', description: '平衡模式' },
  { value: '4', label: '4 并发', description: '中等性能' },
  { value: '5', label: '5 并发', description: '最高性能' },
]

/** 配音文本批量处理数量选项（5-10） */
const NARRATION_BATCH_SIZE_OPTIONS = [
  { value: '5', label: '5 个/批（默认）', description: '质量与效率平衡' },
  { value: '8', label: '8 个/批', description: '高效处理' },
  { value: '10', label: '10 个/批', description: '最高效率' },
]

interface SystemConfigProps {
  onConfigChange?: () => void
}

export function SystemConfig({ onConfigChange }: SystemConfigProps) {
  const [config, setConfig] = useState<SystemConfigType>({
    max_concurrent_scenes: CONFIG_DEFAULTS.MAX_CONCURRENT_SCENES,
    default_gemini_model: CONFIG_DEFAULTS.DEFAULT_GEMINI_MODEL,
    gemini_location: CONFIG_DEFAULTS.DEFAULT_GEMINI_LOCATION,
    gemini_media_resolution: CONFIG_DEFAULTS.DEFAULT_MEDIA_RESOLUTION,
    gemini_video_fps: CONFIG_DEFAULTS.DEFAULT_VIDEO_FPS,
    narration_batch_size: CONFIG_DEFAULTS.NARRATION_BATCH_SIZE,
    subtitle_enabled: CONFIG_DEFAULTS.SUBTITLE_ENABLED,
  })
  /** 是否显示自定义区域输入框 */
  const [showCustomLocation, setShowCustomLocation] = useState(false)
  /** 自定义区域输入值 */
  const [customLocation, setCustomLocation] = useState('')
  /** 是否显示自定义模型输入框 */
  const [showCustomModel, setShowCustomModel] = useState(false)
  /** 自定义模型输入值 */
  const [customModel, setCustomModel] = useState('')
  /** 是否显示自定义 FPS 输入框 */
  const [showCustomFps, setShowCustomFps] = useState(false)
  /** 自定义 FPS 输入值 */
  const [customFps, setCustomFps] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // biome-ignore lint/correctness/useExhaustiveDependencies: 初始化加载
  useEffect(() => {
    loadConfig()
  }, [])

  const loadConfig = async () => {
    try {
      const response = await fetch('/api/configs')
      const data = await response.json()

      if (data.configs) {
        // 处理区域配置
        const location = data.configs.gemini_location || 'global'
        const isLocationPreset = LOCATION_PRESETS.some(
          (p) => p.value === location && p.value !== 'custom',
        )

        // 处理模型配置
        const modelValue = data.configs.default_gemini_model || CONFIG_DEFAULTS.DEFAULT_GEMINI_MODEL
        const isModelPreset = MODEL_PRESETS.some(
          (p) => p.value === modelValue && p.value !== 'custom',
        )

        // 处理 FPS 配置
        const fpsValue = data.configs.gemini_video_fps || CONFIG_DEFAULTS.DEFAULT_VIDEO_FPS
        const isFpsPreset = VIDEO_FPS_PRESETS.some(
          (p) => p.value === fpsValue && p.value !== 'custom',
        )

        // 处理配音文本批量数量配置（5-10 范围，超出范围则使用默认值）
        const rawBatchSize =
          Number(data.configs.narration_batch_size) || CONFIG_DEFAULTS.NARRATION_BATCH_SIZE
        const batchSizeValue =
          rawBatchSize >= 5 && rawBatchSize <= 10
            ? rawBatchSize
            : CONFIG_DEFAULTS.NARRATION_BATCH_SIZE

        setConfig({
          max_concurrent_scenes:
            Number(data.configs.max_concurrent_scenes) || CONFIG_DEFAULTS.MAX_CONCURRENT_SCENES,
          default_gemini_model: isModelPreset ? modelValue : 'custom',
          gemini_location: isLocationPreset ? location : 'custom',
          gemini_media_resolution:
            data.configs.gemini_media_resolution || CONFIG_DEFAULTS.DEFAULT_MEDIA_RESOLUTION,
          gemini_video_fps: isFpsPreset ? fpsValue : 'custom',
          narration_batch_size: batchSizeValue,
          subtitle_enabled: data.configs.subtitle_enabled ?? CONFIG_DEFAULTS.SUBTITLE_ENABLED,
        })

        // 如果是自定义区域，设置自定义输入值
        if (!isLocationPreset) {
          setShowCustomLocation(true)
          setCustomLocation(location)
        }

        // 如果是自定义模型，设置自定义输入值
        if (!isModelPreset) {
          setShowCustomModel(true)
          setCustomModel(modelValue)
        }

        // 如果是自定义 FPS，设置自定义输入值
        if (!isFpsPreset) {
          setShowCustomFps(true)
          setCustomFps(fpsValue)
        }

        // 处理字幕开关配置（字符串 'true'/'false' 转布尔值）
        const subtitleEnabled = data.configs.subtitle_enabled !== 'false'

        setConfig((prev) => ({
          ...prev,
          subtitle_enabled: subtitleEnabled,
        }))
      }
    } catch {
      // 静默处理加载错误
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)

    try {
      // 验证自定义 FPS 范围
      let fpsToSave = config.gemini_video_fps
      if (config.gemini_video_fps === 'custom') {
        const fpsNum = Number.parseFloat(customFps.trim())
        if (Number.isNaN(fpsNum) || fpsNum < 0.1 || fpsNum > 24.0) {
          toast.error('FPS 必须在 0.1 到 24.0 之间')
          setSaving(false)
          return
        }
        fpsToSave = customFps.trim()
      }

      const response = await fetch('/api/configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          configs: {
            max_concurrent_scenes: String(config.max_concurrent_scenes),
            default_gemini_model:
              config.default_gemini_model === 'custom'
                ? customModel.trim()
                : config.default_gemini_model,
            gemini_location:
              config.gemini_location === 'custom' ? customLocation.trim() : config.gemini_location,
            gemini_media_resolution: config.gemini_media_resolution,
            gemini_video_fps: fpsToSave,
            narration_batch_size: String(config.narration_batch_size),
            subtitle_enabled: String(config.subtitle_enabled),
          },
        }),
      })

      if (response.ok) {
        toast.success('系统配置保存成功')
        onConfigChange?.()
      } else {
        const error = await response.json()
        toast.error(error.error || '保存系统配置失败')
      }
    } catch {
      toast.error('保存系统配置失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Card className="border-claude-dark-300/20 bg-white/60 p-6">
        <p className="text-sm text-claude-dark-400">加载中...</p>
      </Card>
    )
  }

  return (
    <Card className="border-claude-dark-300/20 bg-white/60 p-6">
      <h3 className="mb-4 text-lg font-semibold text-claude-dark-900">系统配置</h3>

      <div className="space-y-4">
        {/* 系统并发数 */}
        <div className="space-y-2">
          <Label
            htmlFor="max_concurrent_scenes"
            className="text-sm font-medium text-claude-dark-900"
          >
            系统并发数
          </Label>
          <Select
            value={String(config.max_concurrent_scenes)}
            onValueChange={(value) =>
              setConfig({ ...config, max_concurrent_scenes: Number(value) })
            }
          >
            <SelectTrigger className="w-full max-w-md border-claude-dark-300/30 focus:border-claude-orange-500 focus:ring-claude-orange-500/20">
              <SelectValue placeholder="选择并发数" />
            </SelectTrigger>
            <SelectContent>
              {CONCURRENCY_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <span className="flex items-center gap-2">
                    <span>{option.label}</span>
                    {option.description && (
                      <span className="text-xs text-claude-dark-400">- {option.description}</span>
                    )}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-claude-dark-400">
            控制素材吸收、转录/翻译、MiniMax
            配音、字幕合成与产物整理等队列并发。数值越大速度越快，但资源占用越高。
          </p>
        </div>

        {/* Gemini 区域配置 */}
        <div className="space-y-2">
          <Label htmlFor="gemini_location" className="text-sm font-medium text-claude-dark-900">
            Gemini API 区域
          </Label>
          <Select
            value={config.gemini_location}
            onValueChange={(value) => {
              setConfig({ ...config, gemini_location: value })
              setShowCustomLocation(value === 'custom')
              if (value !== 'custom') {
                setCustomLocation('')
              }
            }}
          >
            <SelectTrigger className="w-full max-w-md border-claude-dark-300/30 focus:border-claude-orange-500 focus:ring-claude-orange-500/20">
              <SelectValue placeholder="选择区域" />
            </SelectTrigger>
            <SelectContent>
              {LOCATION_PRESETS.map((preset) => (
                <SelectItem key={preset.value} value={preset.value}>
                  {preset.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {showCustomLocation && (
            <Input
              type="text"
              value={customLocation}
              onChange={(e) => setCustomLocation(e.target.value)}
              placeholder="输入自定义区域（如 asia-southeast1）"
              className="max-w-md border-claude-dark-300/30 focus:border-claude-orange-500 focus:ring-claude-orange-500/20"
            />
          )}
          <p className="text-xs text-claude-dark-400">
            Gemini 3 模型仅支持 global 端点。如需使用 Gemini 2.x
            模型，可选择其他区域；此配置用于翻译、素材理解或兼容任务，当前主线不依赖旧剪辑分析链路。
          </p>
        </div>

        {/* 默认 Gemini 模型 */}
        <div className="space-y-2">
          <Label htmlFor="gemini_model" className="text-sm font-medium text-claude-dark-900">
            默认 Gemini 模型
          </Label>
          <Select
            value={config.default_gemini_model}
            onValueChange={(value) => {
              setConfig({ ...config, default_gemini_model: value })
              setShowCustomModel(value === 'custom')
              if (value !== 'custom') {
                setCustomModel('')
              }
            }}
          >
            <SelectTrigger className="w-full max-w-md border-claude-dark-300/30 focus:border-claude-orange-500 focus:ring-claude-orange-500/20">
              <SelectValue placeholder="选择模型" />
            </SelectTrigger>
            <SelectContent>
              {MODEL_PRESETS.map((preset) => (
                <SelectItem key={preset.value} value={preset.value}>
                  {preset.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {showCustomModel && (
            <Input
              type="text"
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
              placeholder="输入自定义模型 ID（如 gemini-2.0-flash-exp）"
              className="max-w-md border-claude-dark-300/30 focus:border-claude-orange-500 focus:ring-claude-orange-500/20"
            />
          )}
          <p className="text-xs text-claude-dark-400">
            公益站优先使用 Gemini 3 Flash Preview；官方 Google AI Studio 可切换 Flash-Lite 或
            Flash。Vertex AI 和 AI Studio 共用此模型配置，仅服务翻译、摘要或兼容能力。
          </p>
        </div>

        {/* 未启用视觉理解预留媒体分辨率 */}
        <div className="space-y-2">
          <Label
            htmlFor="gemini_media_resolution"
            className="text-sm font-medium text-claude-dark-900"
          >
            未启用视觉理解预留分辨率
          </Label>
          <Select
            value={config.gemini_media_resolution}
            onValueChange={(value) =>
              setConfig({
                ...config,
                gemini_media_resolution: value as SystemConfigType['gemini_media_resolution'],
              })
            }
          >
            <SelectTrigger className="w-full max-w-md border-claude-dark-300/30 focus:border-claude-orange-500 focus:ring-claude-orange-500/20">
              <SelectValue placeholder="选择分辨率" />
            </SelectTrigger>
            <SelectContent>
              {MEDIA_RESOLUTION_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-claude-dark-400">
            仅作为兼容配置保留给后续视觉理解步骤；当前主线先用素材吸收、转录、翻译与 MiniMax
            配音、字幕产物，不恢复旧 Gemini 分镜分析入口。
          </p>
        </div>

        {/* 未启用视觉理解预留采样帧率 (FPS) */}
        <div className="space-y-2">
          <Label htmlFor="gemini_video_fps" className="text-sm font-medium text-claude-dark-900">
            未启用视觉理解预留采样帧率 (FPS)
          </Label>
          <Select
            value={config.gemini_video_fps}
            onValueChange={(value) => {
              setConfig({ ...config, gemini_video_fps: value })
              setShowCustomFps(value === 'custom')
              if (value !== 'custom') {
                setCustomFps('')
              }
            }}
          >
            <SelectTrigger className="w-full max-w-md border-claude-dark-300/30 focus:border-claude-orange-500 focus:ring-claude-orange-500/20">
              <SelectValue placeholder="选择采样帧率" />
            </SelectTrigger>
            <SelectContent>
              {VIDEO_FPS_PRESETS.map((preset) => (
                <SelectItem key={preset.value} value={preset.value}>
                  <span className="flex items-center gap-2">
                    <span>{preset.label}</span>
                    {preset.description && (
                      <span className="text-xs text-claude-dark-400">- {preset.description}</span>
                    )}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {showCustomFps && (
            <Input
              type="number"
              min="0.1"
              max="24.0"
              step="0.1"
              value={customFps}
              onChange={(e) => setCustomFps(e.target.value)}
              placeholder="输入 0.1 ~ 24.0"
              className="max-w-md border-claude-dark-300/30 focus:border-claude-orange-500 focus:ring-claude-orange-500/20"
            />
          )}
          <p className="text-xs text-claude-dark-400">
            FPS 越低，Token 消耗越少。长素材（60+ 分钟）建议使用
            0.2~0.5；高频采样仅用于后续明确启用的画面上下文步骤。
          </p>
        </div>

        {/* 配音文本批量处理数量 */}
        <div className="space-y-2">
          <Label
            htmlFor="narration_batch_size"
            className="text-sm font-medium text-claude-dark-900"
          >
            配音文本批量处理数量
          </Label>
          <Select
            value={String(config.narration_batch_size)}
            onValueChange={(value) => setConfig({ ...config, narration_batch_size: Number(value) })}
          >
            <SelectTrigger className="w-full max-w-md border-claude-dark-300/30 focus:border-claude-orange-500 focus:ring-claude-orange-500/20">
              <SelectValue placeholder="选择每批生成数量" />
            </SelectTrigger>
            <SelectContent>
              {NARRATION_BATCH_SIZE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <span className="flex items-center gap-2">
                    <span>{option.label}</span>
                    {option.description && (
                      <span className="text-xs text-claude-dark-400">- {option.description}</span>
                    )}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-claude-dark-400">
            控制翻译稿、配音文本或兼容脚本的批量处理上限。数量越大效率越高，但单批审核与重试成本也更高。
          </p>
        </div>

        {/* 字幕开关 */}
        <div className="space-y-2">
          <Label htmlFor="subtitle_enabled" className="text-sm font-medium text-claude-dark-900">
            字幕功能
          </Label>
          <Select
            value={config.subtitle_enabled ? 'true' : 'false'}
            onValueChange={(value) => setConfig({ ...config, subtitle_enabled: value === 'true' })}
          >
            <SelectTrigger className="w-full max-w-md border-claude-dark-300/30 focus:border-claude-orange-500 focus:ring-claude-orange-500/20">
              <SelectValue placeholder="选择是否启用字幕" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="true">
                <span className="flex items-center gap-2">
                  <span>启用字幕</span>
                  <span className="text-xs text-claude-dark-400">- 为本地化配音添加字幕</span>
                </span>
              </SelectItem>
              <SelectItem value="false">
                <span className="flex items-center gap-2">
                  <span>关闭字幕</span>
                  <span className="text-xs text-claude-dark-400">- 不添加字幕</span>
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-claude-dark-400">
            为最终配音视频生成字幕产物（白字黑边，自适应分辨率）
          </p>
        </div>
      </div>

      {/* 保存按钮 */}
      <div className="mt-6 flex justify-end">
        <Button
          onClick={handleSave}
          disabled={saving}
          className="bg-claude-orange-500 hover:bg-claude-orange-600 text-white px-6"
        >
          {saving ? '保存中...' : '保存系统配置'}
        </Button>
      </div>
    </Card>
  )
}
