import { afterEach, beforeEach, vi } from 'vitest'

const originalEnv = { ...process.env }

beforeEach(() => {
  vi.restoreAllMocks()
  process.env = { ...originalEnv }
})

afterEach(() => {
  vi.restoreAllMocks()
  process.env = { ...originalEnv }
})
