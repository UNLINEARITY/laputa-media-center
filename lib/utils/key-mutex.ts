/**
 * Per-key async mutex（按 key 序列化執行）
 *
 * 用途：
 * 對同一 key 的並發 `withKeyLock(key, fn)` 會自動排隊，逐個執行 fn。
 * 不同 key 之間互不阻塞。
 *
 * 典型場景：
 * - 同一 job 的並發 recut 請求 → cuts.json 讀-改-寫序列化
 * - 同一資源的多個 mutation 不能交錯
 *
 * 設計：
 * - In-process（同一 Node 進程內），不跨進程
 * - 每個 key 維護一個 promise chain；新 caller 接到尾端
 * - 引用計數：當 key 沒有 active waiter 時清除 entry，防止記憶體洩漏
 *
 * 注意：
 * - fn 拋錯不會阻塞後續排隊（用 try/finally 釋放）
 * - 不防止跨 process race（多個 Node worker / Docker container 不適用，需 file lock）
 */

interface LockEntry {
  tail: Promise<void>
  refCount: number
}

const locks = new Map<string, LockEntry>()

/**
 * 以 key 為單位序列化執行 fn。
 * 同 key 的 caller 會排隊（FIFO）；不同 key 並行。
 *
 * @example
 * await withKeyLock(`job:${jobId}`, async () => {
 *   const data = JSON.parse(await readFile(file, 'utf-8'))
 *   data.field = newValue
 *   await writeFile(file, JSON.stringify(data))
 * })
 */
export async function withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  let entry = locks.get(key)
  if (!entry) {
    entry = { tail: Promise.resolve(), refCount: 0 }
    locks.set(key, entry)
  }
  entry.refCount++

  const myWait = entry.tail
  let release: () => void = () => {}
  const myDone = new Promise<void>((r) => {
    release = r
  })
  entry.tail = myDone

  try {
    await myWait
    return await fn()
  } finally {
    release()
    entry.refCount--
    // 若沒人在等且 entry 未被替換，清除以免 Map 無限增長
    if (entry.refCount === 0 && locks.get(key) === entry) {
      locks.delete(key)
    }
  }
}

/**
 * 內部 helper：用於測試 / 診斷 — 拿目前活躍 key 數
 */
export function activeLockCount(): number {
  return locks.size
}
