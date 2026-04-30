export const ALLOW_PAID_DYNAMIC_TESTS_ENV = 'ALLOW_PAID_DYNAMIC_TESTS' as const

export type PaidDynamicTestsRequiredError = {
  error: 'Paid dynamic test gate required'
  code: 'PAID_DYNAMIC_TESTS_REQUIRED'
  required_env: [typeof ALLOW_PAID_DYNAMIC_TESTS_ENV]
  paid_verification_called: false
  message: string
}

export function isPaidDynamicTestsAllowed(): boolean {
  return process.env[ALLOW_PAID_DYNAMIC_TESTS_ENV] === 'true'
}

export function buildPaidDynamicTestsRequiredError(message: string): PaidDynamicTestsRequiredError {
  return {
    error: 'Paid dynamic test gate required',
    code: 'PAID_DYNAMIC_TESTS_REQUIRED',
    required_env: [ALLOW_PAID_DYNAMIC_TESTS_ENV],
    paid_verification_called: false,
    message,
  }
}
