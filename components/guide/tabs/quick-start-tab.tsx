import { SectionCard, StepList } from '@/components/guide'
import { Badge } from '@/components/ui'

export function QuickStartTab() {
  return (
    <div className="space-y-6">
      <SectionCard title="系统简介">
        <p className="text-base">
          <strong>Laputa 内容引擎</strong>
          面向中文自媒体生产，当前主线覆盖素材吸收、翻译配音、任务
          QA、样片升级、成片对比和长期规则沉淀。
        </p>
      </SectionCard>

      <SectionCard title="前置条件">
        <p className="mb-4">开始前请先确认这些能力是否就绪：</p>
        <ul className="space-y-2">
          <li className="flex items-start gap-2">
            <Badge variant="warning" className="mt-0.5 shrink-0">
              必需
            </Badge>
            <span>FFmpeg、Python、Whisper CLI 或对应环境变量配置</span>
          </li>
          <li className="flex items-start gap-2">
            <Badge variant="warning" className="mt-0.5 shrink-0">
              必需
            </Badge>
            <span>正式配音需要 MiniMax API Key 和可用 voice_id</span>
          </li>
          <li className="flex items-start gap-2">
            <Badge variant="outline" className="mt-0.5 shrink-0">
              可选
            </Badge>
            <span>YouTube 素材吸收需要 yt-dlp 可执行文件</span>
          </li>
          <li className="flex items-start gap-2">
            <Badge variant="outline" className="mt-0.5 shrink-0">
              可选
            </Badge>
            <span>口型同步需要配置 Wav2Lip 或外部 dubbing skill runtime</span>
          </li>
        </ul>
      </SectionCard>

      <SectionCard title="5 分钟快速上手">
        <StepList
          steps={[
            {
              title: '配置运行环境',
              description:
                '进入「密钥设置」配置 MiniMax，并确认 FFmpeg、Whisper、yt-dlp 等本地工具可用。',
            },
            {
              title: '吸收素材',
              description:
                '进入「素材吸收」，提交 YouTube URL、本地视频或本地音频，生成转写和内容处理计划。',
            },
            {
              title: '创建配音任务',
              description:
                '进入「翻译配音」，选择目标语言、MiniMax voice_id、口型同步模式，并在提交前检查会套用的长期资产。',
            },
            {
              title: '检查结果',
              description:
                '在「任务管理」查看日志、下载成片、运行 QA，并使用 compare/report 沉淀固定读法和语言风格规则。',
            },
          ]}
        />
      </SectionCard>

      <SectionCard title="主线流程">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          {[
            { stage: '1', name: '素材吸收', desc: '识别来源并转写' },
            { stage: '2', name: '理解内容', desc: '整理摘要和处理计划' },
            { stage: '3', name: '翻译配音', desc: '目标语言、声线、口型同步' },
            { stage: '4', name: 'QA 对比', desc: '样片升级、检查成片' },
            { stage: '5', name: '规则沉淀', desc: '固定读法、风格、修稿备注' },
          ].map((item) => (
            <div
              key={item.stage}
              className="rounded-lg border border-claude-cream-200 bg-claude-cream-50/50 p-4"
            >
              <div className="mb-2 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-claude-orange-500 text-xs font-semibold text-white">
                  {item.stage}
                </span>
                <span className="font-semibold text-claude-dark-700">{item.name}</span>
              </div>
              <p className="text-xs text-claude-dark-500">{item.desc}</p>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  )
}
