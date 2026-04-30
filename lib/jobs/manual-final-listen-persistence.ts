import { runInTransaction } from '@/lib/db/core/transaction'
import { getState, initState, parseStepContext, updateState } from '@/lib/db/managers/state-manager'
import type { StepContext } from '@/lib/workflow/step-definitions'
import type { ManualFinalListenRecord } from './manual-final-listen'

type ManualFinalListenStepContext = Partial<StepContext> & {
  manual_final_listen: ManualFinalListenRecord
}

export function persistManualFinalListenRecord(
  jobId: string,
  record: ManualFinalListenRecord,
): ManualFinalListenRecord {
  return runInTransaction(
    () => {
      if (!getState(jobId)) {
        initState(jobId)
      }

      const state = getState(jobId)
      const currentContext = state ? parseStepContext(state) : undefined
      const nextContext: ManualFinalListenStepContext = {
        ...(currentContext || {}),
        manual_final_listen: record,
      } as ManualFinalListenStepContext

      updateState(jobId, {
        step_context: nextContext as StepContext,
      })

      return record
    },
    { mode: 'IMMEDIATE' },
  )
}
