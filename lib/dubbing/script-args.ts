import { existsSync, readFileSync } from 'node:fs'

const scriptOptionCache = new Map<string, string>()

export type ScriptArgMode = 'detect' | 'legacy' | 'strict' | 'force'

export interface AppendScriptOptionResult {
  mode: ScriptArgMode
  option: string | null
  supported: boolean
  skipped: boolean
}

export function getScriptArgMode(): ScriptArgMode {
  const mode = process.env.DUBBING_SCRIPT_ARG_MODE?.trim()
  if (mode === 'legacy' || mode === 'strict' || mode === 'force') return mode
  return 'detect'
}

function readScript(scriptPath: string): string {
  const cached = scriptOptionCache.get(scriptPath)
  if (cached !== undefined) return cached

  if (!existsSync(scriptPath)) {
    scriptOptionCache.set(scriptPath, '')
    return ''
  }

  const content = readFileSync(scriptPath, 'utf-8')
  scriptOptionCache.set(scriptPath, content)
  return content
}

export function scriptSupportsOption(scriptPath: string, option: string): boolean {
  return readScript(scriptPath).includes(option)
}

export function appendFirstSupportedOption(
  args: string[],
  scriptPath: string,
  options: string[],
  value?: string,
): string | null {
  if (!value) return null

  const supportedOption = options.find((option) => scriptSupportsOption(scriptPath, option))
  if (!supportedOption) return null

  args.push(supportedOption, value)
  return supportedOption
}

export function appendScriptOption(
  args: string[],
  scriptPath: string,
  options: string[],
  value: string | undefined,
  label: string,
): AppendScriptOptionResult {
  const mode = getScriptArgMode()
  if (!value || mode === 'legacy') {
    return { mode, option: null, supported: false, skipped: true }
  }

  if (mode === 'force') {
    const option = options[0]
    args.push(option, value)
    return { mode, option, supported: true, skipped: false }
  }

  const supportedOption = options.find((option) => scriptSupportsOption(scriptPath, option))
  if (supportedOption) {
    args.push(supportedOption, value)
    return { mode, option: supportedOption, supported: true, skipped: false }
  }

  if (mode === 'strict') {
    throw new Error(
      `Dubbing script does not support ${label}. Script: ${scriptPath}. Expected one of: ${options.join(
        ', ',
      )}`,
    )
  }

  return { mode, option: null, supported: false, skipped: true }
}
