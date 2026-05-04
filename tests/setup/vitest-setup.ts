import path from 'node:path'
import { afterEach, beforeEach, vi } from 'vitest'

const vitestRunRoot = path.resolve(process.cwd(), 'tmp', 'vitest', String(process.pid))

process.env.DATABASE_URL =
  process.env.DATABASE_URL || `file:${path.join(vitestRunRoot, 'db.sqlite')}`
process.env.NEXT_TELEMETRY_DISABLED = process.env.NEXT_TELEMETRY_DISABLED || '1'

const originalEnv = { ...process.env }

beforeEach(() => {
  vi.restoreAllMocks()
  process.env = { ...originalEnv }
})

afterEach(() => {
  vi.restoreAllMocks()
  process.env = { ...originalEnv }
})
