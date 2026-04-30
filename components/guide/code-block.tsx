import { cn } from '@/lib/utils/cn'

interface CodeBlockProps {
  code: string
  language?: 'bash' | 'json'
  filename?: string
  className?: string
}

export function CodeBlock({ code, language = 'bash', filename, className }: CodeBlockProps) {
  return (
    <div
      className={cn(
        'relative rounded-xl overflow-hidden border border-claude-cream-200 my-4',
        className,
      )}
    >
      {filename && (
        <div className="px-4 py-2 bg-claude-cream-100 text-sm text-claude-dark-500 border-b border-claude-cream-200 font-mono flex items-center justify-between">
          <span>{filename}</span>
          <span className="text-xs text-claude-dark-400 uppercase">{language}</span>
        </div>
      )}
      <pre className="p-4 overflow-x-auto text-sm bg-claude-cream-50/50">
        <code
          className={cn(
            'font-mono text-claude-dark-700 leading-relaxed whitespace-pre-wrap break-all',
            language === 'json' && 'text-claude-dark-600',
          )}
        >
          {code}
        </code>
      </pre>
    </div>
  )
}
