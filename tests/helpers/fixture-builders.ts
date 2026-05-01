/**
 * Test fixture builders — normal form for tests
 *
 * Codex 第二輪 P1 #6 修：之前 tests fixture drift（Job/StepContext/StepRecord 部分 mock 對不上 prod 型別）。
 * 這裡集中放 fixture builders + 型別 helpers，避免每個 test 手寫半截 type cast。
 *
 * 設計原則：
 * - Builder 接受 DeepPartial overrides，返回完整 type
 * - 不影響 prod 代碼（純 test helper）
 * - 不在這建 mock function（mock 用 vi.fn<Sig>() 在原 test 檔聲明）
 */

/** TypeScript 用：deep-partial，允許 nested mock object 只填 subset */
export type DeepPartial<T> = T extends object
  ? T extends Array<infer U>
    ? Array<DeepPartial<U>>
    : T extends Map<infer K, infer V>
      ? Map<K, V>
      : { [P in keyof T]?: DeepPartial<T[P]> }
  : T

/** 安全 unknown cast：用於 partial mock 對 strict structural type */
export function castPartial<T>(value: DeepPartial<T>): T {
  return value as unknown as T
}
