/**
 * JSON 提取和清理工具
 */

/**
 * 提取潜在 JSON 片段
 *
 * 增强处理能力：
 * 1. 优先提取 Markdown 代码块中的 JSON
 * 2. 处理 JSON 前面有大量 Markdown 文本的情况（如 AI 分析过程）
 * 3. 回退到正则匹配 JSON 对象/数组
 */
export function extractJsonBlock(text: string): string {
  // 1. 优先匹配 Markdown 代码块
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (codeBlockMatch) {
    return codeBlockMatch[1]
  }

  // 2. 处理 Markdown 前缀：找到第一个 { 或 [ 开始的行
  // 这解决了 Gemini 返回 "**分析过程：**...\n{json}" 的情况
  const lines = text.split('\n')
  const jsonStartIndex = lines.findIndex((line) => {
    const trimmed = line.trim()
    return trimmed.startsWith('{') || trimmed.startsWith('[')
  })

  let processedText = text
  if (jsonStartIndex > 0) {
    // 找到了 JSON 开始位置，跳过前面的 Markdown 内容
    processedText = lines.slice(jsonStartIndex).join('\n')
  }

  // 3. 对于可能被截断的 JSON，直接返回从第一个 { 或 [ 开始的全部内容
  // 让 repairTruncatedJson 来处理不完整的情况
  const firstBrace = processedText.indexOf('{')
  const firstBracket = processedText.indexOf('[')

  if (firstBrace >= 0 || firstBracket >= 0) {
    // 选择最先出现的括号作为起点
    const startPos =
      firstBrace >= 0 && firstBracket >= 0
        ? Math.min(firstBrace, firstBracket)
        : firstBrace >= 0
          ? firstBrace
          : firstBracket
    return processedText.substring(startPos)
  }

  return processedText
}

/**
 * 修复被截断的 JSON（AI 响应可能因 token 限制而不完整）
 *
 * 核心策略：找到最后一个完整的数组元素，截断后面的不完整内容，然后补全括号
 */
function repairTruncatedJson(text: string): string {
  let repaired = text.trim()

  // 统计括号
  const countBrackets = (str: string) => ({
    openBraces: (str.match(/\{/g) || []).length,
    closeBraces: (str.match(/\}/g) || []).length,
    openBrackets: (str.match(/\[/g) || []).length,
    closeBrackets: (str.match(/\]/g) || []).length,
  })

  const initial = countBrackets(repaired)

  // 如果括号平衡，无需修复
  if (
    initial.openBraces === initial.closeBraces &&
    initial.openBrackets === initial.closeBrackets
  ) {
    return repaired
  }

  // 找到最后一个完整对象的结束位置（} 后跟逗号或数组结尾的位置）
  const lastCompletePos = findLastCompleteElement(repaired)
  if (lastCompletePos > 0) {
    repaired = repaired.substring(0, lastCompletePos + 1)
  }

  // 重新统计并按正确嵌套顺序补全闭合括号
  // JSON 结构通常是 { "key": [...] }，所以需要先 ] 后 }
  const current = countBrackets(repaired)
  const missingBraces = Math.max(0, current.openBraces - current.closeBraces)
  const missingBrackets = Math.max(0, current.openBrackets - current.closeBrackets)

  // 按正确顺序补全（先 ] 后 }，因为数组在对象内部）
  repaired += ']'.repeat(missingBrackets)
  repaired += '}'.repeat(missingBraces)

  return repaired
}

/**
 * 找到最后一个完整元素的结束位置
 *
 * 遍历 JSON 字符串，跟踪括号层级，找到最后一个完整的数组元素
 * 支持两种结构：
 * 1. { "key": [...] } - 对象包裹数组
 * 2. [...] - 裸数组
 */
function findLastCompleteElement(text: string): number {
  let braceDepth = 0
  let bracketDepth = 0
  let inString = false
  let escapeNext = false
  let lastCompleteObjectEnd = -1

  // 检测是裸数组还是对象包裹
  const trimmedStart = text.trimStart()
  const isRawArray = trimmedStart.startsWith('[')

  for (let i = 0; i < text.length; i++) {
    const char = text[i]

    // 处理转义字符
    if (escapeNext) {
      escapeNext = false
      continue
    }
    if (char === '\\' && inString) {
      escapeNext = true
      continue
    }

    // 处理字符串
    if (char === '"') {
      inString = !inString
      continue
    }

    // 字符串内不处理括号
    if (inString) continue

    // 跟踪括号层级
    if (char === '{') braceDepth++
    else if (char === '}') {
      braceDepth--
      // 判断是否是一个完整的数组元素
      // 对于 { "key": [...] }：braceDepth === 1 && bracketDepth === 1
      // 对于 [...]：braceDepth === 0 && bracketDepth === 1
      const targetBraceDepth = isRawArray ? 0 : 1
      if (braceDepth === targetBraceDepth && bracketDepth === 1) {
        const remaining = text.substring(i + 1).trimStart()
        if (remaining.startsWith(',') || remaining.startsWith(']')) {
          lastCompleteObjectEnd = i
        }
      }
    } else if (char === '[') bracketDepth++
    else if (char === ']') bracketDepth--
  }

  return lastCompleteObjectEnd
}

/**
 * 清理常见 JSON 格式问题
 * 增强修复能力，处理更多边缘情况
 */
export function sanitizeJson(text: string): string {
  let cleaned = text

  // 0. 先修复截断问题（必须在其他清理之前）
  cleaned = repairTruncatedJson(cleaned)

  // 1. 移除多余尾逗号（已有）
  cleaned = cleaned.replace(/,\s*([}\]])/g, '$1')

  // 2. 移除重复逗号（已有）
  cleaned = cleaned.replace(/,\s*,/g, ',')

  // 3. 补充缺少的逗号：对象属性之间
  // 匹配模式：} 或 ] 后面直接跟 " 或 { 或 [（中间只有空白字符）
  // 例如：{"a":1}{"b":2} → {"a":1},{"b":2}
  cleaned = cleaned.replace(/([}\]])\s*\n\s*(["{[])/g, '$1,\n$2')

  // 4. 补充缺少的逗号：数组元素之间（单行）
  // 匹配模式：} 或 ] 后面直接跟空格和 { 或 [（同一行）
  // 例如：[{"a":1} {"b":2}] → [{"a":1}, {"b":2}]
  cleaned = cleaned.replace(/([}\]])(\s+)(["{[])/g, '$1,$2$3')

  // 4.1 补充缺少的逗号：字符串值后面直接跟字符串键（对象属性）
  // 匹配模式："value" "key": → "value", "key":
  // 例如：{"a": "text" "b": 1} → {"a": "text", "b": 1}
  // 注：只匹配后面跟 "key": 的情况，避免误伤数组中的字符串
  cleaned = cleaned.replace(/"(\s+)"(\w)/g, '",$1"$2')

  // 4.2 补充缺少的逗号：数值后面直接跟字符串键
  // 匹配模式：123 "key": → 123, "key":
  // 例如：{"a": 1 "b": 2} → {"a": 1, "b": 2}
  cleaned = cleaned.replace(/(\d)(\s+)"/g, '$1,$2"')

  // 5. 修复未闭合的字符串（简单情况）
  // 计数引号，如果是奇数，添加一个结束引号
  const quoteCount = (cleaned.match(/"/g) || []).length
  if (quoteCount % 2 !== 0) {
    // 在末尾添加引号前，先移除可能的尾部垃圾字符
    cleaned = `${cleaned.replace(/[^}\]]*$/, '')}"`
  }

  // 6. 移除可能的控制字符和非打印字符
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 故意清理控制字符
  cleaned = cleaned.replace(/[\x00-\x1F\x7F]/g, '')

  // 7. Trim 空白字符
  return cleaned.trim()
}

/**
 * 安全的 JSON 解析（自动清理 Markdown 代码块）
 *
 * 用于所有直接接收外部 JSON 字符串的地方，尤其是 AI 响应
 *
 * @param text - 可能包含 Markdown 格式的 JSON 字符串
 * @returns 解析后的 JSON 对象
 * @throws {SyntaxError} 如果清理后的字符串仍然不是有效 JSON
 *
 * @example
 * ```typescript
 * // 处理包含 Markdown 代码块的响应
 * const text = '```json\n{"key": "value"}\n```'
 * const result = safeParseJson(text)  // { key: "value" }
 *
 * // 处理普通 JSON 字符串
 * const json = '{"key": "value"}'
 * const result = safeParseJson(json)  // { key: "value" }
 * ```
 */
export function safeParseJson<T>(text: string): T {
  // 1. 提取 JSON 块（移除 Markdown 代码块标记）
  const extracted = extractJsonBlock(text)

  // 2. 清理常见格式问题
  const cleaned = sanitizeJson(extracted)

  // 3. 解析 JSON（添加更详细的错误信息）
  try {
    return JSON.parse(cleaned) as T
  } catch (error: unknown) {
    const preview = cleaned.length > 200 ? `${cleaned.substring(0, 200)}...` : cleaned
    throw new SyntaxError(
      `JSON 解析失败: ${error instanceof Error ? error.message : String(error)}\n原始内容预览: ${preview}`,
    )
  }
}
