import { cn } from '@/lib/utils/cn'

interface Step {
  title: string
  description: React.ReactNode
}

interface StepListProps {
  steps: Step[]
  className?: string
}

export function StepList({ steps, className }: StepListProps) {
  return (
    <ol className={cn('space-y-4 my-6', className)}>
      {steps.map((step, index) => (
        <li key={step.title} className="flex gap-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-claude-orange-500 text-white text-sm font-semibold shadow-sm">
            {index + 1}
          </div>
          <div className="flex-1 pt-0.5">
            <p className="font-semibold text-claude-dark-800">{step.title}</p>
            <div className="text-sm text-claude-dark-500 mt-1 leading-relaxed">
              {step.description}
            </div>
          </div>
        </li>
      ))}
    </ol>
  )
}
