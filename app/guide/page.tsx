'use client'

import {
  ApiConfigTab,
  CreateJobTab,
  QuickStartTab,
  TroubleshootingTab,
} from '@/components/guide/tabs'
import { PageHeader } from '@/components/layout/page-header'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui'

const TAB_ITEMS = [
  { value: 'quick-start', label: '快速入门', component: QuickStartTab },
  { value: 'api-config', label: 'API 配置', component: ApiConfigTab },
  { value: 'create-job', label: '主线任务', component: CreateJobTab },
  { value: 'troubleshooting', label: '故障排查', component: TroubleshootingTab },
]

export default function GuidePage() {
  return (
    <div className="flex flex-col bg-linear-to-br from-claude-cream-50/30 via-white to-claude-cream-100/50 min-h-screen">
      <PageHeader
        title="使用教程"
        description="从零开始掌握 Laputa 内容引擎，把素材、文本、配音和成片输出接成一条内容生产链"
      />

      <section className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        <Tabs defaultValue="quick-start" className="w-full">
          {/* Tab 列表 - 响应式设计 */}
          <TabsList className="mb-6 h-auto flex flex-wrap gap-1 bg-claude-cream-100/50 p-1 rounded-xl">
            {TAB_ITEMS.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="flex-1 min-w-[100px] text-sm px-3 py-2.5 data-[state=active]:bg-claude-orange-500 data-[state=active]:text-white data-[state=active]:shadow-sm rounded-lg transition-all"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* Tab 内容 */}
          {TAB_ITEMS.map((tab) => {
            const TabComponent = tab.component
            return (
              <TabsContent key={tab.value} value={tab.value} className="mt-0">
                <TabComponent />
              </TabsContent>
            )
          })}
        </Tabs>
      </section>
    </div>
  )
}
