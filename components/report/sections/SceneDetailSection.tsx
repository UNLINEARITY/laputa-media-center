'use client'

import { useState } from 'react'
import { SectionCard } from '@/components/guide/section-card'
import { Badge, Button } from '@/components/ui'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/feedback/accordion'
import type { JobScene, SceneAudioCandidate } from '@/types'

interface SceneDetailSectionProps {
  scenes: JobScene[]
  audioCandidates: SceneAudioCandidate[]
}

const INITIAL_COUNT = 10

export function SceneDetailSection({ scenes, audioCandidates }: SceneDetailSectionProps) {
  const [displayCount, setDisplayCount] = useState(INITIAL_COUNT)
  const visibleScenes = scenes.slice(0, displayCount)

  return (
    <section id="scene-detail">
      <SectionCard title={`📝 分镜脚本详情 (${scenes.length}个)`}>
        <Accordion type="multiple" className="space-y-2">
          {visibleScenes.map((scene, index) => {
            const statusIcon =
              scene.status === 'completed' ? '✅' : scene.status === 'failed' ? '❌' : '⏸️'
            const sceneAudioCandidates = audioCandidates.filter((c) => c.scene_id === scene.id)

            return (
              <AccordionItem key={scene.id} value={scene.id} className="border rounded-lg">
                <AccordionTrigger className="px-4 py-3 hover:no-underline">
                  <div className="flex items-center gap-3 text-left">
                    <span>{statusIcon}</span>
                    <span className="font-medium">Scene {index + 1}</span>
                    <code className="text-xs text-claude-dark-500">{scene.id}</code>
                    <Badge variant={scene.use_original_audio ? 'secondary' : 'outline'}>
                      {scene.use_original_audio ? '原声' : '配音'}
                    </Badge>
                    {scene.is_skipped && <Badge variant="outline">已跳过</Badge>}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <div className="space-y-4 text-sm">
                    {/* 基本信息 */}
                    <div className="grid gap-2 sm:grid-cols-2">
                      <InfoRow label="来源视频" value={scene.source_video_label} />
                      <InfoRow
                        label="时间范围"
                        value={`${scene.source_start_time} - ${scene.source_end_time} (${scene.duration_seconds}秒)`}
                      />
                    </div>

                    {/* 旁白文案 */}
                    {scene.narration_script && (
                      <div>
                        <p className="text-xs text-claude-dark-500 mb-1">
                          旁白文案{scene.use_original_audio ? '（原声分镜，仅供参考）' : ''}
                        </p>
                        <p className="bg-claude-cream-100 p-3 rounded-lg">
                          {scene.narration_script}
                        </p>
                      </div>
                    )}

                    {/* 处理流程 URL */}
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-claude-dark-500">处理流程 URL</p>
                      <div className="grid gap-1 text-xs">
                        <UrlRow label="拆条视频" url={scene.split_video_url} />
                        <UrlRow label="调速视频" url={scene.adjusted_video_url} />
                        <UrlRow label="最终视频" url={scene.final_video_url} />
                      </div>
                    </div>

                    {/* 音频信息（仅配音分镜） */}
                    {!scene.use_original_audio && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-claude-dark-500">音频信息</p>
                        <div className="grid gap-1 text-xs">
                          <InfoRow
                            label="音频时长"
                            value={scene.audio_duration ? `${scene.audio_duration} 秒` : '未知'}
                          />
                          <InfoRow label="速度因子" value={scene.speed_factor || '未计算'} />
                          <UrlRow label="音频 URL" url={scene.selected_audio_url} />
                        </div>
                      </div>
                    )}

                    {/* 音频候选（仅配音分镜） */}
                    {!scene.use_original_audio && sceneAudioCandidates.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-claude-dark-500">
                          音频候选 ({sceneAudioCandidates.length}个)
                        </p>
                        <div className="space-y-2">
                          {sceneAudioCandidates.map((candidate) => (
                            <div
                              key={candidate.id}
                              className={`text-xs p-2 rounded border ${
                                candidate.is_selected
                                  ? 'border-green-300 bg-green-50'
                                  : 'border-claude-cream-200'
                              }`}
                            >
                              <div className="flex items-center gap-2 mb-1">
                                <span>候选 {candidate.candidate_index + 1}</span>
                                {candidate.is_selected && (
                                  <Badge variant="default" className="text-xs">
                                    已选择
                                  </Badge>
                                )}
                              </div>
                              <div className="text-claude-dark-500">
                                时长: {candidate.audio_duration}秒 | 速度因子:{' '}
                                {candidate.speed_factor}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )
          })}
        </Accordion>

        {/* 加载更多 */}
        {displayCount < scenes.length && (
          <div className="mt-4 text-center">
            <Button variant="outline" size="sm" onClick={() => setDisplayCount((c) => c + 10)}>
              加载更多 ({scenes.length - displayCount} 个剩余)
            </Button>
          </div>
        )}
      </SectionCard>
    </section>
  )
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-claude-dark-500 shrink-0">{label}:</span>
      <span className="text-claude-dark-700">{value}</span>
    </div>
  )
}

function UrlRow({ label, url }: { label: string; url?: string | null }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-claude-dark-500 shrink-0 w-20">{label}:</span>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-claude-orange-600 hover:underline truncate max-w-[300px]"
        >
          {url}
        </a>
      ) : (
        <span className="text-claude-dark-400">未生成</span>
      )}
    </div>
  )
}
