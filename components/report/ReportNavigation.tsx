'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils/cn'
import type { ReportSection } from '@/types/api/job-report'

interface ReportNavigationProps {
  sections: ReportSection[]
}

export function ReportNavigation({ sections }: ReportNavigationProps) {
  const [activeSection, setActiveSection] = useState<string>(sections[0]?.id || '')

  useEffect(() => {
    // 使用 IntersectionObserver 监听章节可见性
    const observer = new IntersectionObserver(
      (entries) => {
        // 找到最上方可见的章节
        const visibleEntries = entries.filter((entry) => entry.isIntersecting)
        if (visibleEntries.length > 0) {
          // 按 boundingClientRect.top 排序，取最上方的
          const topEntry = visibleEntries.sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
          )[0]
          setActiveSection(topEntry.target.id)
        }
      },
      {
        rootMargin: '-80px 0px -70% 0px',
        threshold: 0,
      },
    )

    // 观察所有章节元素
    for (const section of sections) {
      const element = document.getElementById(section.id)
      if (element) {
        observer.observe(element)
      }
    }

    return () => observer.disconnect()
  }, [sections])

  const handleClick = (sectionId: string) => {
    const element = document.getElementById(sectionId)
    if (element) {
      const headerOffset = 100
      const elementPosition = element.getBoundingClientRect().top
      const offsetPosition = elementPosition + window.scrollY - headerOffset

      window.scrollTo({
        top: offsetPosition,
        behavior: 'smooth',
      })
    }
  }

  return (
    <nav className="space-y-1">
      <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-claude-dark-400">
        报告目录
      </p>
      {sections.map((section) => (
        <button
          type="button"
          key={section.id}
          onClick={() => handleClick(section.id)}
          className={cn(
            'w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-colors text-left',
            activeSection === section.id
              ? 'bg-claude-orange-50 text-claude-orange-700 font-medium'
              : 'text-claude-dark-600 hover:bg-claude-cream-100 hover:text-claude-dark-800',
          )}
        >
          <span className="text-base">{section.icon}</span>
          <span className="truncate">{section.label}</span>
        </button>
      ))}
    </nav>
  )
}
