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
              Laputa Content Engine
            </p>
            <p className="max-w-xl text-sm text-claude-dark-400">
              面向自媒体内容生产：文本播客、短视频、外语素材本地化、配音、口型同步和交付追踪在同一个工作台完成。
            </p>
          </div>

          {/* 社交媒体与版权 */}
          <div className="space-y-4 sm:text-right sm:items-end flex flex-col">
            <a
              href="https://laputamediacenter.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-center gap-2.5 text-sm text-claude-dark-400 transition-all hover:text-claude-dark-900 sm:self-end"
            >
              <svg
                className="h-4 w-4 transition-transform group-hover:scale-110"
                fill="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
              </svg>
              <span className="font-medium">官方网站</span>
            </a>
            <a
              href="https://www.youtube.com/@laputamediacenter"
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-center gap-2.5 text-sm text-claude-dark-400 transition-all hover:text-red-600 sm:self-end"
            >
              <svg
                className="h-4 w-4 transition-transform group-hover:scale-110"
                fill="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
              </svg>
              <span className="font-medium">YouTube 频道</span>
            </a>
            <p className="text-sm text-claude-dark-400 sm:self-end">
              © {currentYear} Laputa工作流 All rights reserved
            </p>
          </div>
        </div>
      </div>
    </footer>
  )
}
