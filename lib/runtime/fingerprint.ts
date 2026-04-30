import { readFileSync } from 'node:fs'
import path from 'node:path'
import packageJson from '@/package.json'

export const RUNTIME_FINGERPRINT_SCHEMA_VERSION = 1
export const RUNTIME_FINGERPRINT_CONTRACT = 'laputa-runtime-fingerprint'

export interface RuntimeFingerprint {
  package_name: string
  package_version: string
  next_build_id: string | null
}

interface PackageJsonShape {
  name?: unknown
  version?: unknown
}

function readPackageFingerprint(
  packageData: PackageJsonShape,
): Pick<RuntimeFingerprint, 'package_name' | 'package_version'> {
  const packageName = typeof packageData.name === 'string' ? packageData.name : ''
  const packageVersion = typeof packageData.version === 'string' ? packageData.version : ''

  if (!packageName || !packageVersion) {
    throw new Error('package.json must include name and version')
  }

  return {
    package_name: packageName,
    package_version: packageVersion,
  }
}

function readOptionalTextFile(filePath: string): string | null {
  try {
    const value = readFileSync(filePath, 'utf-8').trim()
    return value || null
  } catch {
    return null
  }
}

export function readRuntimeFingerprint(cwd = process.cwd()): RuntimeFingerprint {
  const diskPackageJson = JSON.parse(
    readFileSync(path.join(cwd, 'package.json'), 'utf-8'),
  ) as PackageJsonShape

  return {
    ...readPackageFingerprint(diskPackageJson),
    next_build_id: readOptionalTextFile(path.join(cwd, '.next', 'BUILD_ID')),
  }
}

const bootRuntimeFingerprint: RuntimeFingerprint = {
  ...readPackageFingerprint(packageJson),
  next_build_id: readOptionalTextFile(path.join(process.cwd(), '.next', 'BUILD_ID')),
}
const runtimeBootedAt = Date.now()

export function getBootRuntimeFingerprint(): RuntimeFingerprint {
  return bootRuntimeFingerprint
}

export function getRuntimeBootedAt(): number {
  return runtimeBootedAt
}
