import { SectionCard } from '@/components/guide/section-card'
import type { Job } from '@/types'

interface ConfigSectionProps {
  job: Job
}

export function ConfigSection({ job }: ConfigSectionProps) {
  const configStr =
    typeof job.config === 'string' ? job.config : JSON.stringify(job.config, null, 2)

  let formattedConfig: string
  try {
    const config = typeof job.config === 'string' ? JSON.parse(job.config) : job.config
    formattedConfig = JSON.stringify(config, null, 2)
  } catch {
    formattedConfig = configStr
  }

  return (
    <section id="config">
      <SectionCard title="📦 任务配置">
        <pre className="text-xs bg-claude-dark-800 text-claude-cream-100 p-4 rounded-lg overflow-x-auto">
          {formattedConfig}
        </pre>
      </SectionCard>
    </section>
  )
}
