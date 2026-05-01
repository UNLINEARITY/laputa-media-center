export function Footer() {
  const currentYear = new Date().getFullYear()

  return (
    <footer className="w-full border-t border-claude-cream-200/60 bg-linear-to-b from-white to-claude-cream-100/50">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        {/* 主要内容区 */}
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
          {/* 品牌介绍 */}
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-claude-dark-900">Laputa 内容引擎</h3>
            <p className="text-xs uppercase tracking-wider text-claude-dark-400 font-medium">
              LaputaMediaCenter
            </p>
            <p className="max-w-xl text-sm text-claude-dark-400">
              面向自媒体内容生产：文本播客、短视频、外语素材本地化、配音、口型同步和交付追踪在同一个工作台完成。
            </p>
          </div>

          {/* 版权 */}
          <div className="space-y-4 sm:text-right sm:items-end flex flex-col">
            <p className="text-sm text-claude-dark-400 sm:self-end">
              © {currentYear} LaputaMediaCenter · All rights reserved
            </p>
          </div>
        </div>
      </div>
    </footer>
  )
}
