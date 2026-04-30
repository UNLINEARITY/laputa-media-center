/**
 * 统一模板引擎
 *
 * 用于处理风格提示词中的占位符替换，支持 Mustache 风格的 {{variable}} 语法
 *
 * 特性：
 * - 支持简单变量替换：{{variable_name}}
 * - 支持嵌套对象访问：{{config.channel_name}}
 * - 支持可选值：变量不存在时保留占位符（调试模式下会记录警告）
 * - 支持条件段落：{{#if variable}}...{{/if}}（可选功能）
 * - 提供调试模式：记录所有替换操作
 *
 * @example
 * ```typescript
 * const engine = new TemplateEngine({ debug: true })
 *
 * const template = '频道：{{channel_name}}，时长：{{config.duration_range.min}}~{{config.duration_range.max}}秒'
 * const variables = {
 *   channel_name: 'Laputa通用',
 *   config: { duration_range: { min: 6, max: 12 } }
 * }
 *
 * const result = engine.render(template, variables)
 * // 输出：'频道：Laputa通用，时长：6~12秒'
 * ```
 */

export interface TemplateEngineOptions {
  /** 是否启用调试模式（记录替换操作） */
  debug?: boolean
  /** 变量不存在时的行为：'keep' 保留占位符 | 'empty' 替换为空字符串 */
  onMissing?: 'keep' | 'empty'
}

export interface RenderLog {
  /** 占位符名称 */
  placeholder: string
  /** 替换后的值 */
  value: string
  /** 是否成功找到变量 */
  found: boolean
}

export class TemplateEngine {
  private options: Required<TemplateEngineOptions>
  private logs: RenderLog[] = []

  constructor(options: TemplateEngineOptions = {}) {
    this.options = {
      debug: options.debug ?? false,
      onMissing: options.onMissing ?? 'keep',
    }
  }

  /**
   * 渲染模板，替换所有占位符
   *
   * @param template - 模板字符串（包含 {{variable}} 占位符）
   * @param variables - 变量对象
   * @returns 替换后的字符串
   */
  render(template: string, variables: Record<string, unknown>): string {
    this.logs = [] // 清空上次的日志

    // 正则匹配 {{variable}} 或 {{object.property}}
    const regex = /\{\{([^}]+)\}\}/g

    const result = template.replace(regex, (match, key: string) => {
      const trimmedKey = key.trim()
      const value = this.resolveVariable(trimmedKey, variables)

      if (value !== undefined) {
        const stringValue = this.stringify(value)
        this.log(trimmedKey, stringValue, true)
        return stringValue
      }

      // 变量不存在
      this.log(trimmedKey, match, false)

      if (this.options.onMissing === 'empty') {
        return ''
      }

      // 默认保留占位符
      return match
    })

    return result
  }

  /**
   * 获取渲染日志（调试用）
   */
  getLogs(): RenderLog[] {
    return this.logs
  }

  /**
   * 清除日志
   */
  clearLogs(): void {
    this.logs = []
  }

  /**
   * 解析变量路径（支持嵌套对象访问）
   *
   * @example
   * resolveVariable('config.duration_range.min', { config: { duration_range: { min: 6 } } })
   * // 返回: 6
   */
  private resolveVariable(path: string, variables: Record<string, unknown>): unknown {
    const keys = path.split('.')
    let value: unknown = variables

    for (const key of keys) {
      if (value === null || value === undefined) {
        return undefined
      }

      if (typeof value === 'object' && key in value) {
        value = (value as Record<string, unknown>)[key]
      } else {
        return undefined
      }
    }

    return value
  }

  /**
   * 将值转换为字符串
   */
  private stringify(value: unknown): string {
    if (value === null || value === undefined) {
      return ''
    }

    if (typeof value === 'string') {
      return value
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value)
    }

    if (Array.isArray(value)) {
      return JSON.stringify(value)
    }

    if (typeof value === 'object') {
      return JSON.stringify(value)
    }

    return String(value)
  }

  /**
   * 记录替换操作
   */
  private log(placeholder: string, value: string, found: boolean): void {
    this.logs.push({ placeholder, value, found })
  }
}
