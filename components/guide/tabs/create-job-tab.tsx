import { Callout, SectionCard, StepList } from '@/components/guide'
import { Badge } from '@/components/ui'

export function CreateJobTab() {
  return (
    <div className="space-y-6">
      <SectionCard title="任务入口">
        <p className="mb-4">当前只保留两条创建主线：</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-lg border-2 border-dashed border-claude-cream-300 bg-claude-cream-50/50 p-4">
            <div className="mb-2 flex items-center gap-2">
              <Badge variant="success">素材</Badge>
              <span className="font-semibold text-claude-dark-700">素材吸收</span>
            </div>
            <p className="text-sm text-claude-dark-500">
              接收 YouTube URL、本地视频或本地音频，输出转写、SRT、Markdown 和内容处理计划。
            </p>
          </div>
          <div className="rounded-lg border-2 border-dashed border-claude-cream-300 bg-claude-cream-50/50 p-4">
            <div className="mb-2 flex items-center gap-2">
              <Badge variant="warning">配音</Badge>
              <span className="font-semibold text-claude-dark-700">翻译配音</span>
            </div>
            <p className="text-sm text-claude-dark-500">
              将外语或本地视频转写、翻译并配成普通话、粤语或其他主流语言。
            </p>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="素材吸收">
        <StepList
          steps={[
            {
              title: '提交来源',
              description: '粘贴 YouTube URL，或填写本地视频/音频绝对路径。',
            },
            {
              title: '选择处理意图',
              description:
                '根据素材用途选择 transcript、highlights、podcast、short video 或 localization 方向。',
            },
            {
              title: '读取产物',
              description: '任务完成后在工作台读取 Markdown、JSON、SRT 和标准化 WAV。',
            },
          ]}
        />
      </SectionCard>

      <SectionCard title="翻译配音">
        <StepList
          steps={[
            {
              title: '选择视频源',
              description: '使用已准备好的本地视频路径；远程或 YouTube 素材建议先走素材吸收。',
            },
            {
              title: '设置语言和声线',
              description: '选择源语言、目标语言、MiniMax voice_id、单/双讲者模式和口型同步模式。',
            },
            {
              title: '确认长期资产',
              description:
                '提交前检查本次会套用的语言风格、固定读法、术语表和修稿备注，避免花费 TTS 成本后才发现规则错误。',
            },
            {
              title: '先跑样片',
              description: '高风险素材优先使用 sample mode，QA 通过后再 sample-to-full 重跑。',
            },
          ]}
        />
      </SectionCard>

      <Callout type="warning" title="旧入口已下架">
        `/api/jobs
        POST`、`/styles`、旧剪辑风格和分镜数量创建链路已下架。请使用「素材吸收」和「翻译配音」两条主线。
      </Callout>
    </div>
  )
}
