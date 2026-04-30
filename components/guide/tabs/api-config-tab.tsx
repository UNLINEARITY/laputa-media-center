import { Callout, SectionCard, StepList } from '@/components/guide'
import { Badge } from '@/components/ui'

export function ApiConfigTab() {
  return (
    <div className="space-y-6">
      <SectionCard title="配置说明">
        <p className="mb-4">
          当前主线优先保证素材吸收和翻译配音闭环。正式配音必须配置 MiniMax；素材吸收依赖本地工具链。
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-lg border-2 border-dashed border-claude-cream-300 bg-claude-cream-50/50 p-4">
            <div className="mb-2 flex items-center gap-2">
              <Badge variant="warning">必需</Badge>
              <span className="font-semibold text-claude-dark-700">MiniMax TTS</span>
            </div>
            <p className="text-sm text-claude-dark-500">用于生成普通话、粤语和主流语言配音。</p>
          </div>
          <div className="rounded-lg border-2 border-dashed border-claude-cream-300 bg-claude-cream-50/50 p-4">
            <div className="mb-2 flex items-center gap-2">
              <Badge variant="outline">本地</Badge>
              <span className="font-semibold text-claude-dark-700">FFmpeg / Whisper</span>
            </div>
            <p className="text-sm text-claude-dark-500">用于抽音频、转写、合成和产物检查。</p>
          </div>
          <div className="rounded-lg border-2 border-dashed border-claude-cream-300 bg-claude-cream-50/50 p-4">
            <div className="mb-2 flex items-center gap-2">
              <Badge variant="outline">可选</Badge>
              <span className="font-semibold text-claude-dark-700">Gemini / Wav2Lip</span>
            </div>
            <p className="text-sm text-claude-dark-500">用于翻译增强、内容理解或口型同步增强。</p>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="MiniMax 配音配置">
        <StepList
          steps={[
            {
              title: '保存 API Key',
              description: '进入「密钥设置」中的 MiniMax TTS 区块，填写并保存 API Key。',
            },
            {
              title: '填写验证用 voice_id',
              description:
                '可选保存一个 MiniMax voice_id 作为付费验证测试声线；正式默认声线在声线元数据里绑定。',
            },
            {
              title: '验证声线',
              description: '在配音表单中选择目标语言后，检查 voice_id 是否能通过 MiniMax 验证。',
            },
          ]}
        />
        <Callout type="warning" title="声音使用边界" className="mt-4">
          优先使用创作者自有声音、明确授权声音或清楚标注的 AI 旁白声音。不要把 AI
          生成的公众人物配音设计成对方真实说过。
        </Callout>
      </SectionCard>

      <SectionCard title="素材吸收本地工具">
        <p className="mb-4 text-sm text-claude-dark-600">
          本地工具可以放在 PATH，也可以通过环境变量指定。
        </p>
        <CodeList
          items={[
            'INGEST_FFMPEG_EXE',
            'INGEST_YTDLP_EXE',
            'INGEST_PYTHON_EXE',
            'INGEST_WHISPER_CLI',
            'INGEST_WHISPER_MODEL',
          ]}
        />
      </SectionCard>

      <SectionCard title="外部配音增强">
        <p className="mb-4 text-sm text-claude-dark-600">
          如果使用增强版 dubbing skill 或 RVC/Wav2Lip runtime，请配置以下变量：
        </p>
        <CodeList items={['DUBBING_SKILL_DIR', 'DUBBING_PYTHON_EXE', 'DUBBING_RVC_PYTHON_EXE']} />
      </SectionCard>

      <Callout type="tip" title="配置完成后">
        先跑一个短素材 sample mode，确认 ASR、翻译、MiniMax TTS、合成和下载都能完成，再处理长片。
      </Callout>
    </div>
  )
}

function CodeList({ items }: { items: string[] }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {items.map((item) => (
        <code
          key={item}
          className="rounded-md border border-claude-cream-200 bg-claude-cream-50 px-3 py-2 text-sm text-claude-dark-700"
        >
          {item}
        </code>
      ))}
    </div>
  )
}
