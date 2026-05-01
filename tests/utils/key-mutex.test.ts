import { describe, expect, it } from 'vitest'
import { activeLockCount, withKeyLock } from '@/lib/utils/key-mutex'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('withKeyLock', () => {
  it('serializes same-key calls FIFO', async () => {
    const order: number[] = []
    const tasks = [1, 2, 3, 4, 5].map((i) =>
      withKeyLock('k1', async () => {
        order.push(i)
        await sleep(5)
        order.push(-i)
        return i
      }),
    )
    const results = await Promise.all(tasks)
    expect(results).toEqual([1, 2, 3, 4, 5])
    // 每個 task 必須完成（push -i）才允許下一個開始（push i+1）
    expect(order).toEqual([1, -1, 2, -2, 3, -3, 4, -4, 5, -5])
  })

  it('does not block different keys', async () => {
    const order: string[] = []
    const a = withKeyLock('a', async () => {
      order.push('a-start')
      await sleep(20)
      order.push('a-end')
    })
    // 在 a 還在跑（會 sleep 20ms），啟動 b — b 應該立即開始，不等 a
    await sleep(2)
    const b = withKeyLock('b', async () => {
      order.push('b-start')
      await sleep(2)
      order.push('b-end')
    })
    await Promise.all([a, b])
    // b-start 應在 a-end 之前
    const idxAEnd = order.indexOf('a-end')
    const idxBStart = order.indexOf('b-start')
    expect(idxBStart).toBeLessThan(idxAEnd)
  })

  it('releases lock even when fn throws', async () => {
    let secondRan = false
    const first = withKeyLock('k2', async () => {
      throw new Error('boom')
    })
    await expect(first).rejects.toThrow('boom')
    // 後續 caller 應該照常拿到 lock
    await withKeyLock('k2', async () => {
      secondRan = true
    })
    expect(secondRan).toBe(true)
  })

  it('cleans up entry after all waiters finish', async () => {
    expect(activeLockCount()).toBe(0)
    const t1 = withKeyLock('cleanup-key', async () => {
      expect(activeLockCount()).toBe(1)
      await sleep(2)
    })
    const t2 = withKeyLock('cleanup-key', async () => {
      expect(activeLockCount()).toBe(1)
      await sleep(2)
    })
    await Promise.all([t1, t2])
    // 兩個 task 完成後，entry 應該被清除
    expect(activeLockCount()).toBe(0)
  })

  it('returns fn result', async () => {
    const r = await withKeyLock('return-test', async () => 42)
    expect(r).toBe(42)
  })

  it('multiple concurrent calls on same key resolve in order', async () => {
    const calls = await Promise.all([
      withKeyLock('seq', async () => {
        await sleep(15)
        return 'a'
      }),
      withKeyLock('seq', async () => {
        await sleep(5)
        return 'b'
      }),
      withKeyLock('seq', async () => 'c'),
    ])
    expect(calls).toEqual(['a', 'b', 'c'])
  })
})
