import { Callout, CodeBlock, SectionCard } from '@/components/guide'

export function TroubleshootingTab() {
  return (
    <div className="space-y-6">
      <Callout type="info" title="排查顺序">
        先看任务详情页的错误摘要，再看日志和 step output。主线问题通常落在本地工具、MiniMax
        配置、输入文件路径或输出目录权限。
      </Callout>

      <SectionCard
        title="1. 素材吸收失败"
        description="YouTube、本地文件、音频抽取或 Whisper 转写失败"
      >
        <div className="space-y-4">
          <CodeBlock
            language="bash"
            code={`INGEST_FFMPEG_EXE is not configured
yt-dlp not found
Whisper CLI failed
Input file does not exist`}
          />
          <ul className="list-inside list-disc space-y-2 text-sm text-claude-dark-600">
            <li>确认 FFmpeg、yt-dlp、Python、Whisper CLI 路径在环境变量或 PATH 中可用。</li>
            <li>本地路径请使用绝对路径，并确认 Next.js 进程有读取权限。</li>
            <li>YouTube 抓取失败时先用命令行单独验证 yt-dlp 是否可下载该链接。</li>
          </ul>
        </div>
      </SectionCard>

      <SectionCard title="2. 配音源不可用" description="翻译配音任务只处理已准备好的本地视频源">
        <div className="space-y-4">
          <CodeBlock
            language="bash"
            code={`配音源不可用
Only local video files are supported for dubbing workflow
Final dubbing video file not found`}
          />
          <ul className="list-inside list-disc space-y-2 text-sm text-claude-dark-600">
            <li>远程 URL 或 YouTube 页面请先走「素材吸收」，再使用本地视频路径创建配音任务。</li>
            <li>确认源视频存在，扩展名和编码能被 FFmpeg 读取。</li>
            <li>确认 `OUTPUT_DIR` 可写，避免成片发布到任务目录时失败。</li>
          </ul>
        </div>
      </SectionCard>

      <SectionCard
        title="3. MiniMax 配置缺失"
        description="正式配音需要 MiniMax API Key 和可用 voice_id"
      >
        <div className="space-y-4">
          <CodeBlock
            language="bash"
            code={`MINIMAX_TTS_NOT_CONFIGURED
MiniMax API Key not configured
voice_id 暂未验证成功`}
          />
          <ul className="list-inside list-disc space-y-2 text-sm text-claude-dark-600">
            <li>进入「密钥设置」保存 MiniMax API Key；验证用 voice_id 只用于付费测试。</li>
            <li>确认 voice_id 属于当前 MiniMax 账号，且目标语言支持对应声线。</li>
            <li>没有正式 TTS 配置时，系统不会创建静音占位成片，除非显式开启占位模式。</li>
          </ul>
        </div>
      </SectionCard>

      <SectionCard title="4. 口型同步失败" description="Wav2Lip 或外部 dubbing runtime 配置问题">
        <ul className="list-inside list-disc space-y-2 text-sm text-claude-dark-600">
          <li>不需要口型同步时，先把模式切到「只替换配音」验证 ASR、翻译、TTS 和合成是否正常。</li>
          <li>
            需要增强外部配音能力时，检查
            `DUBBING_SKILL_DIR`、`DUBBING_PYTHON_EXE`、`DUBBING_RVC_PYTHON_EXE`。
          </li>
          <li>确认 Wav2Lip 输入视频有人脸，且中间音频文件存在。</li>
        </ul>
      </SectionCard>

      <SectionCard title="5. 磁盘和临时文件问题" description="视频处理会产生较多中间产物">
        <div className="space-y-4">
          <CodeBlock
            language="bash"
            code={`ENOSPC: no space left on device
SQLITE_BUSY: database is locked
FFmpeg process timed out`}
          />
          <ul className="list-inside list-disc space-y-2 text-sm text-claude-dark-600">
            <li>确保输出目录和临时目录有足够空间。</li>
            <li>使用「系统设置」里的存储清理功能清理过期产物。</li>
            <li>并发过高时降低系统并发，先保证 sample mode 能稳定完成。</li>
          </ul>
        </div>
      </SectionCard>
    </div>
  )
}
