/**
 * 多语言智能换行模块
 *
 * 核心特性：
 * - Token 化处理：拉丁单词不断开、CJK/假名可断开
 * - 多语言支持：中/英/日/韩/法/德/西等
 * - 禁则处理：行首/行尾禁止字符
 */

// ============================================================================
// Unicode 范围定义
// ============================================================================

/** CJK 汉字（中文/日语汉字） */
const CJK_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf]/

/** 日语平假名 */
const HIRAGANA_REGEX = /[\u3040-\u309f]/

/** 日语片假名 */
const KATAKANA_REGEX = /[\u30a0-\u30ff]/

/** 韩文 */
const HANGUL_REGEX = /[\uac00-\ud7af]/

/** 拉丁字母（含扩展：法/德/西等） */
const LATIN_REGEX = /[a-zA-Z\u00C0-\u024F\u1E00-\u1EFF]/

/** 数字 */
const DIGIT_REGEX = /[0-9]/

/** 全角字符 */
const FULLWIDTH_REGEX = /[\uff00-\uffef]/

/** CJK 标点符号 */
const CJK_PUNCTUATION_REGEX = /[\u3000-\u303f]/

// ============================================================================
// 禁则字符定义（日语/中文排版规范）
// ============================================================================

/** 行首禁止字符（不能出现在行首） */
const LINE_START_FORBIDDEN = new Set([
  // 日语
  '、',
  '。',
  '，',
  '．',
  '・',
  '：',
  '；',
  '？',
  '！',
  '゛',
  '゜',
  'ー',
  '）',
  '］',
  '｝',
  '〕',
  '〉',
  '》',
  '」',
  '』',
  '】',
  // 英文
  ')',
  ']',
  '}',
  ',',
  '.',
  ';',
  ':',
  '?',
  '!',
  // 其他
  '…',
  '"',
  "'",
])

/** 行尾禁止字符（不能出现在行尾） */
const LINE_END_FORBIDDEN = new Set([
  // 日语
  '（',
  '［',
  '｛',
  '〔',
  '〈',
  '《',
  '「',
  '『',
  '【',
  // 英文
  '(',
  '[',
  '{',
  // 其他
  '"',
  "'",
])

/** 标点符号集（用于换行优先级判断） */
const PUNCTUATIONS = new Set([
  // 英文标点
  '?',
  ',',
  '.',
  ';',
  ':',
  '!',
  '…',
  // 中文标点
  '？',
  '，',
  '。',
  '；',
  '：',
  '！',
  '、',
  '》',
  '）',
  '"',
  "'",
])

/**
 * 需要删除的点号正则（替换为空格）
 *
 * 业界规范：删除表示停顿的点号，保留有语义的标号
 * - 删除：句号、问号、叹号、逗号、顿号、分号、冒号
 * - 保留：书名号、引号、省略号、破折号、间隔号、连接号
 */
const PUNCTUATION_TO_REMOVE = /[，。！？、；：,.!?;:]+/g

// ============================================================================
// Token 类型定义
// ============================================================================

type TokenType =
  | 'latin-word' // 拉丁字母单词（英/法/德/西等），不可断开
  | 'cjk' // CJK 表意字符（中/日汉字），可断开
  | 'kana' // 日语假名（平假名/片假名），可断开
  | 'hangul' // 韩文，可断开
  | 'number' // 数字序列，不可断开
  | 'space' // 空格，理想换行点
  | 'punctuation' // 标点符号
  | 'other' // 其他字符

interface Token {
  text: string
  type: TokenType
  width: number
}

// ============================================================================
// 字符分类函数
// ============================================================================

/**
 * 判断字符类型
 */
function getCharType(char: string): TokenType {
  if (/\s/.test(char)) return 'space'
  if (LATIN_REGEX.test(char)) return 'latin-word'
  if (DIGIT_REGEX.test(char)) return 'number'
  if (CJK_REGEX.test(char)) return 'cjk'
  if (HIRAGANA_REGEX.test(char) || KATAKANA_REGEX.test(char)) return 'kana'
  if (HANGUL_REGEX.test(char)) return 'hangul'
  if (PUNCTUATIONS.has(char) || CJK_PUNCTUATION_REGEX.test(char)) return 'punctuation'
  return 'other'
}

/**
 * 计算单个字符的显示宽度
 *
 * 中文/日语/韩文/全角字符宽度 = 1.0
 * 英文、数字等半角字符宽度 = 0.5
 */
export function getCharWidth(char: string): number {
  if (CJK_REGEX.test(char)) return 1.0
  if (HIRAGANA_REGEX.test(char)) return 1.0
  if (KATAKANA_REGEX.test(char)) return 1.0
  if (HANGUL_REGEX.test(char)) return 1.0
  if (FULLWIDTH_REGEX.test(char)) return 1.0
  if (CJK_PUNCTUATION_REGEX.test(char)) return 1.0
  return 0.5
}

/**
 * 计算文本的总显示宽度
 */
export function getTextWidth(text: string): number {
  return [...text].reduce((sum, char) => sum + getCharWidth(char), 0)
}

/**
 * 判断字符是否为标点符号
 */
export function isPunctuation(char: string): boolean {
  return PUNCTUATIONS.has(char)
}

/**
 * 清理字幕文本中的点号
 *
 * 处理逻辑：
 * 1. 点号（句号、逗号等）替换为空格
 * 2. 连续空格合并为单个
 * 3. 首尾空格移除
 *
 * 保留标号：书名号、引号、省略号、破折号、间隔号、连接号
 */
export function removePunctuation(text: string): string {
  return text
    .replace(PUNCTUATION_TO_REMOVE, ' ') // 点号替换为空格
    .replace(/\s+/g, ' ') // 合并连续空格
    .trim() // 去除首尾空格
}

// ============================================================================
// Token 化处理
// ============================================================================

/**
 * 将文本分割为 Token 数组
 *
 * 核心规则：
 * - 连续的拉丁字母合并为一个 Token（单词）
 * - 连续的数字合并为一个 Token
 * - CJK/假名/韩文每个字符单独为一个 Token
 * - 空格和标点单独为一个 Token
 */
function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  const chars = [...text]
  let i = 0

  while (i < chars.length) {
    const char = chars[i]
    const type = getCharType(char)

    // 拉丁字母：合并连续字母为单词
    if (type === 'latin-word') {
      let word = char
      let j = i + 1
      while (j < chars.length && getCharType(chars[j]) === 'latin-word') {
        word += chars[j]
        j++
      }
      tokens.push({ text: word, type: 'latin-word', width: getTextWidth(word) })
      i = j
      continue
    }

    // 数字：合并连续数字
    if (type === 'number') {
      let num = char
      let j = i + 1
      while (j < chars.length && getCharType(chars[j]) === 'number') {
        num += chars[j]
        j++
      }
      tokens.push({ text: num, type: 'number', width: getTextWidth(num) })
      i = j
      continue
    }

    // 其他类型：单字符 Token
    tokens.push({ text: char, type, width: getCharWidth(char) })
    i++
  }

  return tokens
}

/**
 * 强制断开超长单词
 *
 * 当单词宽度超过行宽时，强制在行尾断开
 */
function forceBreakWord(
  word: string,
  remainingWidth: number,
  maxWidth: number,
): { fitted: string; rest: string } {
  const chars = [...word]
  let fitted = ''
  let fittedWidth = 0

  for (const char of chars) {
    const charWidth = getCharWidth(char)
    if (fittedWidth + charWidth > remainingWidth && fitted.length > 0) {
      break
    }
    fitted += char
    fittedWidth += charWidth
  }

  // 如果第一行放不下任何字符，至少放一个
  if (fitted.length === 0 && chars.length > 0) {
    fitted = chars[0]
  }

  const rest = word.slice(fitted.length)

  // 如果剩余部分仍然超长，递归处理
  if (rest.length > 0 && getTextWidth(rest) > maxWidth) {
    // 返回当前 fitted，rest 会在后续循环中继续处理
    return { fitted, rest }
  }

  return { fitted, rest }
}

// ============================================================================
// ASS 特殊字符转义
// ============================================================================

/**
 * 转义 ASS 格式中的特殊字符
 */
export function escapeASS(text: string): string {
  return text
    .replace(/\\/g, '\\\\') // 反斜杠（必须最先处理）
    .replace(/\{/g, '\\{') // 大括号
    .replace(/\}/g, '\\}')
    .replace(/\n/g, '\\N') // 原生换行转换为 ASS 换行
}

// ============================================================================
// 智能换行（多语言版）
// ============================================================================

/**
 * 智能换行处理（多语言版）
 *
 * 核心特性：
 * 1. 拉丁单词/数字作为整体，永不在内部断开
 * 2. CJK/假名/韩文可在任意字符后换行
 * 3. 空格是理想的换行点
 * 4. 遵循禁则处理（行首/行尾禁止字符）
 * 5. 超长单词强制断开
 *
 * @param text 原始文本（已转义）
 * @param maxWidth 每行最大宽度（以中文字符为单位）
 * @returns 带 ASS 换行符 (\N) 的文本
 */
export function wrapText(text: string, maxWidth: number): string {
  // 文本未超过限制，直接返回
  if (getTextWidth(text) <= maxWidth) return text

  const tokens = tokenize(text)
  const lines: string[] = []
  let currentLine = ''
  let currentWidth = 0

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]

    // 空格处理：理想的换行点
    if (token.type === 'space') {
      // 如果加上空格后超宽，在空格前换行（丢弃空格）
      if (currentWidth + token.width > maxWidth && currentLine.length > 0) {
        lines.push(currentLine.trimEnd())
        currentLine = ''
        currentWidth = 0
      } else {
        currentLine += token.text
        currentWidth += token.width
      }
      continue
    }

    // 拉丁单词/数字：作为整体处理
    if (token.type === 'latin-word' || token.type === 'number') {
      // 检查是否需要换行
      if (currentWidth + token.width > maxWidth) {
        // 超长单词：强制断开
        if (token.width > maxWidth) {
          // 如果当前行有内容，先提交
          if (currentLine.length > 0) {
            const { fitted, rest } = forceBreakWord(token.text, maxWidth - currentWidth, maxWidth)
            currentLine += fitted
            lines.push(currentLine)

            // 处理剩余部分
            if (rest.length > 0) {
              // 继续强制断开剩余部分
              let remaining = rest
              while (getTextWidth(remaining) > maxWidth) {
                const result = forceBreakWord(remaining, maxWidth, maxWidth)
                lines.push(result.fitted)
                remaining = result.rest
              }
              currentLine = remaining
              currentWidth = getTextWidth(remaining)
            } else {
              currentLine = ''
              currentWidth = 0
            }
          } else {
            // 当前行为空，直接强制断开
            let remaining = token.text
            while (getTextWidth(remaining) > maxWidth) {
              const result = forceBreakWord(remaining, maxWidth, maxWidth)
              lines.push(result.fitted)
              remaining = result.rest
            }
            currentLine = remaining
            currentWidth = getTextWidth(remaining)
          }
        } else {
          // 普通单词：换行后添加
          if (currentLine.length > 0) {
            lines.push(currentLine.trimEnd())
          }
          currentLine = token.text
          currentWidth = token.width
        }
      } else {
        currentLine += token.text
        currentWidth += token.width
      }
      continue
    }

    // CJK/假名/韩文/标点/其他：可在任意位置换行
    if (currentWidth + token.width > maxWidth && currentLine.length > 0) {
      // 禁则处理：检查当前 token 是否是行首禁止字符
      const isStartForbidden = LINE_START_FORBIDDEN.has(token.text[0])

      if (isStartForbidden) {
        // 行首禁止字符：留在当前行，允许更大超出（50%）避免禁则字符出现在行首
        currentLine += token.text
        currentWidth += token.width

        // 只有严重超出时才强制换行，且保留禁则字符在当前行
        if (currentWidth > maxWidth * 1.5) {
          lines.push(currentLine)
          currentLine = ''
          currentWidth = 0
        }
      } else {
        // 检查行尾禁止字符
        const lastChar = currentLine[currentLine.length - 1]
        if (LINE_END_FORBIDDEN.has(lastChar)) {
          // 行尾禁止字符：当前行留着，token 放下一行会导致行尾问题
          // 这种情况少见，允许超出
          currentLine += token.text
          currentWidth += token.width
        } else {
          // 正常换行
          lines.push(currentLine)
          currentLine = token.text
          currentWidth = token.width
        }
      }
    } else {
      currentLine += token.text
      currentWidth += token.width
    }
  }

  // 添加最后一行
  if (currentLine.length > 0) {
    lines.push(currentLine.trimEnd())
  }

  // 使用 ASS 换行符连接
  return lines.join('\\N')
}

/**
 * 处理字幕文本（转义 + 换行）
 *
 * @param text 原始文本
 * @param maxCharsPerLine 每行最大字符数
 * @returns 处理后的文本（已转义，已换行）
 */
export function processSubtitleText(text: string, maxCharsPerLine: number): string {
  const escaped = escapeASS(text)
  return wrapText(escaped, maxCharsPerLine)
}
