'use client'

import { Languages } from 'lucide-react'
import { Button } from '@/components/ui'
import { useChineseScript } from './chinese-script-provider'

export function ChineseScriptToggle() {
  const { mode, toggleMode } = useChineseScript()
  const isSimplified = mode === 'simplified'

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="gap-1.5"
      onClick={toggleMode}
      aria-label={isSimplified ? '切换为繁体中文' : '切换为简体中文'}
      title={isSimplified ? '切换为繁体中文' : '切换为简体中文'}
    >
      <Languages className="h-4 w-4" />
      {isSimplified ? '简体' : '繁体'}
    </Button>
  )
}
