/**
 * 错误分类器
 * 将错误分类为可重试、配置错误、输入错误、系统错误等
 * 删除 failureStatus 字段，统一使用 'failed' 状态
 */

/**
 * 错误分类类型
 */
export type ErrorCategory =
  | 'retryable' // 可重试错误 (网络、限流、临时故障)
  | 'config' // 配置错误 (API密钥、权限、配置参数)
  | 'input' // 输入错误 (视频格式、文件损坏、URL无效)
  | 'system' // 系统错误 (内部错误、数据库故障)
  | 'unknown' // 未知错误

/**
 * 错误分类结果
 * 删除 failureStatus 字段，统一使用 'failed' 状态
 */
export interface ErrorClassification {
  category: ErrorCategory
  isRetryable: boolean // 是否可以重试
  userGuidance: string // 用户指引
  metadata?: Record<string, unknown> // 额外元数据
}

/**
 * 错误分类器
 */
// biome-ignore lint/complexity/noStaticOnlyClass: 用于组织相关的静态方法
export class ErrorClassifier {
  /**
   * 对错误进行分类
   */
  static classify(error: Error | string): ErrorClassification {
    const errorMessage = typeof error === 'string' ? error : error.message
    const errorStack = typeof error === 'string' ? undefined : error.stack

    // 1. 可重试错误 (网络、限流、超时)
    if (ErrorClassifier.isRetryableError(errorMessage)) {
      return {
        category: 'retryable',
        isRetryable: true,
        userGuidance: '网络或服务暂时不可用，请稍后重试',
        metadata: {
          autoRetryRecommended: true,
          retryDelay: 30000, // 建议30秒后重试
        },
      }
    }

    // 2. 配置错误 (API密钥、权限、认证)
    if (ErrorClassifier.isConfigError(errorMessage)) {
      return {
        category: 'config',
        isRetryable: false,
        userGuidance: '配置错误，请检查设置页面的 API 密钥和权限配置',
        metadata: {
          requiresUserAction: true,
          settingsPage: '/settings',
        },
      }
    }

    // 3. 输入错误 (视频格式、URL无效、文件损坏)
    if (ErrorClassifier.isInputError(errorMessage)) {
      return {
        category: 'input',
        isRetryable: false,
        userGuidance: '输入数据有误，请检查视频 URL 是否有效，格式是否支持',
        metadata: {
          requiresUserAction: true,
          checkInputData: true,
        },
      }
    }

    // 4. 系统错误 (内部错误、数据库故障)
    if (ErrorClassifier.isSystemError(errorMessage)) {
      return {
        category: 'system',
        isRetryable: true,
        userGuidance: '系统内部错误，请稍后重试或联系技术支持',
        metadata: {
          autoRetryRecommended: false,
          contactSupport: true,
          errorStack,
        },
      }
    }

    // 5. 未知错误
    return {
      category: 'unknown',
      isRetryable: true,
      userGuidance: '发生未知错误，可以尝试重试',
      metadata: {
        errorMessage,
        errorStack,
      },
    }
  }

  /**
   * 判断是否为可重试错误
   * P1-10 修复：增加 Gemini 特定的可重试错误模式
   */
  private static isRetryableError(message: string): boolean {
    const retryablePatterns = [
      // 网络相关
      /network|timeout|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i,
      // API限流
      /rate limit|too many requests|429/i,
      // 服务暂时不可用
      /service unavailable|503|502|504/i,
      // 临时故障
      /temporary|transient/i,
      // P1-10: Gemini 特定的可重试错误
      /RESOURCE_EXHAUSTED|quota|capacity|overloaded/i,
      /500 Internal Server Error/i,
      /deadline exceeded|context deadline/i,
      /connection reset|ECONNRESET/i,
    ]

    return retryablePatterns.some((pattern) => pattern.test(message))
  }

  /**
   * 判断是否为配置错误
   * P1-10 修复：增加 Gemini 特定的配置错误模式
   */
  private static isConfigError(message: string): boolean {
    const configPatterns = [
      // API密钥相关
      /api key|invalid key|unauthorized|401|403/i,
      // 认证相关
      /authentication|credentials|permission denied/i,
      // 配置相关
      /not configured|missing.*config|invalid.*config/i,
      // GCP/Gemini特定
      /service account|project.*not found/i,
      // P1-10: Gemini 特定的配置错误
      /PERMISSION_DENIED|ACCESS_TOKEN_EXPIRED/i,
      /API_KEY_INVALID|billing.*not enabled/i,
      /model.*not found|model.*deprecated/i,
      /location.*not supported|region.*not available/i,
    ]

    return configPatterns.some((pattern) => pattern.test(message))
  }

  /**
   * 判断是否为输入错误
   * P1-10 修复：增加 Gemini 特定的输入错误模式
   */
  private static isInputError(message: string): boolean {
    const inputPatterns = [
      // 视频相关
      /invalid.*video|unsupported.*format|video.*corrupt/i,
      // URL相关
      /invalid.*url|url.*not found|404/i,
      // 文件相关
      /file.*not found|file.*corrupt|invalid.*file/i,
      // 元数据相关
      /duration.*invalid|metadata.*missing/i,
      // P1-10: Gemini 特定的输入错误
      /INVALID_ARGUMENT|FAILED_PRECONDITION/i,
      /video.*too long|file.*too large|exceeds.*limit/i,
      /unsupported.*media|invalid.*mime|content.*type/i,
      /video.*processing.*failed|unable.*to.*process/i,
    ]

    return inputPatterns.some((pattern) => pattern.test(message))
  }

  /**
   * 判断是否为系统错误
   */
  private static isSystemError(message: string): boolean {
    const systemPatterns = [
      // 数据库相关
      /database|sqlite|sql error/i,
      // 内部错误
      /internal error|unexpected error/i,
      // 文件系统相关
      /ENOENT|EACCES|disk.*full/i,
    ]

    return systemPatterns.some((pattern) => pattern.test(message))
  }

  /**
   * 获取用户友好的错误消息
   */
  static getUserFriendlyMessage(error: Error | string): string {
    const classification = ErrorClassifier.classify(error)
    return classification.userGuidance
  }
}
