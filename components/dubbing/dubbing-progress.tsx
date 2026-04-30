'use client'

import { Check, Clapperboard, Languages, Loader2, Mic, ScanFace, Volume2 } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

export type DubbingStage = 'idle' | 'asr' | 'translate' | 'tts' | 'lipsync' | 'compose' | 'done'

/**
 * 配音工作流阶段定义
 */
const DUBBING_STAGES: {
  key: DubbingStage
  label: string
  description: string
  icon: React.ElementType
}[] = [
  {
    key: 'asr',
    label: 'ASR 语音识别',
    description: '提取视频中的原始语音并转为文本',
    icon: Mic,
  },
  {
    key: 'translate',
    label: '智能翻译',
    description: '将识别文本翻译为目标语言',
    icon: Languages,
  },
  {
    key: 'tts',
    label: 'TTS 语音合成',
    description: '使用 AI 声音合成目标语言配音',
    icon: Volume2,
  },
  {
    key: 'lipsync',
    label: '口型同步',
    description: '调整视频口型匹配新配音',
    icon: ScanFace,
  },
  {
    key: 'compose',
    label: '音画合成',
    description: '将配音与视频合成最终成片',
    icon: Clapperboard,
  },
]

interface DubbingProgressProps {
  currentStage: DubbingStage
}

/**
 * 获取阶段状态：completed / active / pending
 */
function getStageStatus(
  stageKey: DubbingStage,
  currentStage: DubbingStage,
): 'completed' | 'active' | 'pending' {
  const stageOrder: DubbingStage[] = ['asr', 'translate', 'tts', 'lipsync', 'compose']
  const currentIndex = stageOrder.indexOf(currentStage)
  const stageIndex = stageOrder.indexOf(stageKey)

  if (currentStage === 'done') return 'completed'
  if (stageIndex < currentIndex) return 'completed'
  if (stageIndex === currentIndex) return 'active'
  return 'pending'
}

export function DubbingProgress({ currentStage }: DubbingProgressProps) {
  return (
    <div className="rounded-lg border border-claude-cream-200 bg-white p-5 shadow-sm">
      {/* 标题 */}
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-claude-dark-900">转译流水线</h2>
        <p className="text-sm text-claude-dark-400">
          {currentStage === 'idle'
            ? '创建任务后会按这个顺序处理。'
            : currentStage === 'done'
              ? '配音任务已完成。'
              : '任务已提交，正在进入处理队列。'}
        </p>
      </div>

      {/* 阶段列表 */}
      <div className="mt-5 space-y-1">
        {DUBBING_STAGES.map((stage, index) => {
          const status = getStageStatus(stage.key, currentStage)
          const Icon = stage.icon
          const isLast = index === DUBBING_STAGES.length - 1

          return (
            <div key={stage.key} className="flex gap-4">
              {/* 左侧：图标 + 连线 */}
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all duration-300',
                    status === 'completed' &&
                      'bg-claude-orange-500 text-white shadow-md shadow-claude-orange-200',
                    status === 'active' &&
                      'bg-claude-orange-100 text-claude-orange-600 ring-2 ring-claude-orange-400 ring-offset-2',
                    status === 'pending' && 'bg-claude-cream-100 text-claude-dark-300',
                  )}
                >
                  {status === 'completed' ? (
                    <Check className="h-5 w-5" />
                  ) : status === 'active' ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Icon className="h-5 w-5" />
                  )}
                </div>
                {/* 连线 */}
                {!isLast && (
                  <div
                    className={cn(
                      'w-0.5 flex-1 min-h-[24px] transition-colors duration-300',
                      status === 'completed' ? 'bg-claude-orange-400' : 'bg-claude-cream-200',
                    )}
                  />
                )}
              </div>

              {/* 右侧：文字 */}
              <div className="pb-6">
                <p
                  className={cn(
                    'text-sm font-medium leading-10 transition-colors',
                    status === 'completed' && 'text-claude-dark-900',
                    status === 'active' && 'text-claude-orange-600',
                    status === 'pending' && 'text-claude-dark-300',
                  )}
                >
                  {stage.label}
                </p>
                <p
                  className={cn(
                    'text-xs transition-colors',
                    status === 'pending' ? 'text-claude-dark-200' : 'text-claude-dark-400',
                  )}
                >
                  {stage.description}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
