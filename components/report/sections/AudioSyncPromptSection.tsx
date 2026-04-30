import { SectionCard } from '@/components/guide/section-card'
import type { AudioSyncPromptInfo } from '@/types/api/job-report'

interface AudioSyncPromptSectionProps {
  audioSyncPrompt: AudioSyncPromptInfo
}

/**
 * 音画同步提示词章节
 * 展示任务实际使用的音画同步 Prompt
 */
export function AudioSyncPromptSection({ audioSyncPrompt }: AudioSyncPromptSectionProps) {
  const { creativeLayer, paramsTemplate, isDefaultCreativeLayer, styleName } = audioSyncPrompt

  return (
    <section id="audio-sync-prompt">
      <SectionCard title="🎙️ 音画同步提示词">
        <div className="space-y-6">
          {/* 说明 */}
          <div className="text-sm text-claude-dark-500 bg-claude-cream-50 p-3 rounded-lg">
            <p>
              音画同步提示词由两部分组成：<strong>创意层</strong>（定义风格和方法论）和{' '}
              <strong>参数层</strong>（动态填充分镜信息）。
            </p>
            <p className="mt-1">
              当前使用的风格：<strong>{styleName}</strong>
              {isDefaultCreativeLayer && (
                <span className="ml-2 text-xs text-claude-orange-600">（使用系统默认创意层）</span>
              )}
            </p>
          </div>

          {/* 创意层 */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <h4 className="text-sm font-medium text-claude-dark-700">创意层</h4>
              {isDefaultCreativeLayer ? (
                <span className="text-xs px-2 py-0.5 bg-claude-cream-200 text-claude-dark-600 rounded">
                  系统默认
                </span>
              ) : (
                <span className="text-xs px-2 py-0.5 bg-claude-orange-100 text-claude-orange-700 rounded">
                  风格自定义
                </span>
              )}
            </div>
            <pre className="text-xs bg-claude-dark-800 text-claude-cream-100 p-4 rounded-lg overflow-x-auto whitespace-pre-wrap max-h-80 overflow-y-auto">
              {creativeLayer}
            </pre>
          </div>

          {/* 参数层 */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <h4 className="text-sm font-medium text-claude-dark-700">参数层模板</h4>
              <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded">
                系统级模板
              </span>
            </div>
            <p className="text-xs text-claude-dark-400 mb-2">
              运行时会将占位符替换为实际分镜数据（如 scene_id、video_duration、narration_script 等）
            </p>
            <pre className="text-xs bg-claude-dark-800 text-claude-cream-100 p-4 rounded-lg overflow-x-auto whitespace-pre-wrap max-h-60 overflow-y-auto">
              {paramsTemplate}
            </pre>
          </div>

          {/* 占位符说明 */}
          <div className="border-t border-claude-cream-200 pt-4">
            <h4 className="text-sm font-medium text-claude-dark-700 mb-2">参数层占位符说明</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <PlaceholderItem name="scene_id" desc="分镜 ID（如 scene-1）" />
              <PlaceholderItem name="video_duration" desc="视频时长（秒）" />
              <PlaceholderItem name="narration_script" desc="原始旁白脚本" />
              <PlaceholderItem name="narration_language" desc="旁白语言（如 zh-CN）" />
              <PlaceholderItem name="target_word_counts" desc="目标字数 JSON" />
            </div>
          </div>
        </div>
      </SectionCard>
    </section>
  )
}

function PlaceholderItem({ name, desc }: { name: string; desc: string }) {
  return (
    <div className="flex items-start gap-2 bg-claude-cream-50 p-2 rounded">
      <code className="text-claude-orange-600 font-mono shrink-0">{`{{${name}}}`}</code>
      <span className="text-claude-dark-500">{desc}</span>
    </div>
  )
}
