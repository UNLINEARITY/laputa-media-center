#!/usr/bin/env node

/**
 * JavaScript 代码混淆脚本
 *
 * 功能：
 * 1. 读取 .next/standalone 目录下的所有 .js 文件
 * 2. 根据配置文件选择性混淆
 * 3. 保留关键标识符（步骤类名、API 键名等）
 * 4. 生成 Source Maps 到独立目录
 * 5. 分层混淆策略（核心业务逻辑 vs 普通代码）
 *
 * 使用方式：
 * pnpm build && node scripts/obfuscate-build.mjs
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import JavaScriptObfuscator from 'javascript-obfuscator'
import { minimatch } from 'minimatch'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ROOT = join(__dirname, '..')

// 加载配置文件
const configPath = join(__dirname, 'obfuscate-config.json')
const config = JSON.parse(readFileSync(configPath, 'utf-8'))

// 构建输出目录
const BUILD_DIR = join(PROJECT_ROOT, '.next', 'standalone')
const SOURCE_MAP_DIR = join(PROJECT_ROOT, '.next', 'source-maps')

// 统计信息
const stats = {
  total: 0,
  obfuscated: 0,
  skipped: 0,
  errors: 0,
  startTime: Date.now(),
}

/**
 * 检查文件是否应该被排除
 */
function shouldExclude(filePath) {
  const relativePath = relative(BUILD_DIR, filePath)

  for (const pattern of config.exclude.paths) {
    if (minimatch(relativePath, pattern, { dot: true })) {
      return true
    }
  }

  return false
}

/**
 * 获取文件的混淆策略
 */
function getObfuscationStrategy(filePath) {
  const relativePath = relative(BUILD_DIR, filePath)

  // 检查是否属于核心业务逻辑
  for (const pattern of config.directories.coreLogic) {
    if (minimatch(relativePath, pattern, { dot: true })) {
      return 'coreLogic'
    }
  }

  // 检查是否属于保守混淆范围
  for (const pattern of config.directories.conservative) {
    if (minimatch(relativePath, pattern, { dot: true })) {
      return 'conservative'
    }
  }

  return null
}

/**
 * 构建混淆选项
 */
function buildObfuscationOptions(strategy, filePath) {
  const baseOptions = config.obfuscation[strategy]

  // 合并保留的标识符（使用 Set 去重）
  const reservedNames = [
    ...new Set([
      ...config.reserved.stepClasses,
      ...config.reserved.stepProperties,
      ...config.reserved.apiResponseKeys,
      ...config.reserved.databaseFields,
      ...config.reserved.workflowIds,
      ...config.reserved.logTypes,
      ...config.reserved.commonExports,
    ]),
  ]

  // 配置 Source Map
  const sourceMapFileName = `${basename(filePath)}.map`
  const _sourceMapOutputPath = join(SOURCE_MAP_DIR, relative(BUILD_DIR, dirname(filePath)))

  return {
    ...baseOptions,
    reservedNames,
    sourceMap: config.sourceMapConfig.enabled,
    sourceMapMode: 'separate',
    sourceMapFileName,
    sourceMapBaseUrl: config.sourceMapConfig.baseUrl,
    sourceMapSourcesMode: 'sources-content',
  }
}

/**
 * 混淆单个文件
 */
function obfuscateFile(filePath) {
  try {
    stats.total++

    // 检查是否排除
    if (shouldExclude(filePath)) {
      console.log(`  ⏭️  跳过: ${relative(PROJECT_ROOT, filePath)}`)
      stats.skipped++
      return
    }

    // 获取混淆策略
    const strategy = getObfuscationStrategy(filePath)
    if (!strategy) {
      console.log(`  ⏭️  无策略: ${relative(PROJECT_ROOT, filePath)}`)
      stats.skipped++
      return
    }

    // 读取文件内容
    const code = readFileSync(filePath, 'utf-8')

    // 跳过空文件或过小的文件
    if (code.trim().length < 50) {
      console.log(`  ⏭️  文件过小: ${relative(PROJECT_ROOT, filePath)}`)
      stats.skipped++
      return
    }

    // 构建混淆选项
    const options = buildObfuscationOptions(strategy, filePath)

    // 执行混淆
    console.log(`  🔒 混淆 [${strategy}]: ${relative(PROJECT_ROOT, filePath)}`)
    const obfuscationResult = JavaScriptObfuscator.obfuscate(code, options)

    // 写入混淆后的代码
    writeFileSync(filePath, obfuscationResult.getObfuscatedCode(), 'utf-8')

    // 保存 Source Map（如果启用）
    if (config.sourceMapConfig.enabled && obfuscationResult.getSourceMap()) {
      const sourceMapPath = join(
        SOURCE_MAP_DIR,
        relative(BUILD_DIR, dirname(filePath)),
        `${basename(filePath)}.map`,
      )

      // 确保目录存在
      mkdirSync(dirname(sourceMapPath), { recursive: true })

      // 写入 Source Map
      writeFileSync(sourceMapPath, obfuscationResult.getSourceMap(), 'utf-8')
      console.log(`    📍 Source Map: ${relative(PROJECT_ROOT, sourceMapPath)}`)
    }

    stats.obfuscated++
  } catch (error) {
    console.error(`  ❌ 错误: ${relative(PROJECT_ROOT, filePath)}`)
    console.error(`     ${error.message}`)
    stats.errors++
  }
}

/**
 * 递归扫描目录
 */
function scanDirectory(dirPath) {
  const entries = readdirSync(dirPath)

  for (const entry of entries) {
    const fullPath = join(dirPath, entry)

    let stat
    try {
      stat = statSync(fullPath)
    } catch (_error) {
      // 跳过无法访问的文件（如损坏的符号链接）
      console.log(`  ⚠️  跳过无法访问: ${relative(PROJECT_ROOT, fullPath)}`)
      continue
    }

    if (stat.isDirectory()) {
      scanDirectory(fullPath)
    } else if (stat.isFile() && extname(entry) === '.js') {
      obfuscateFile(fullPath)
    }
  }
}

/**
 * 主函数
 */
async function main() {
  console.log('\n🔐 JavaScript 代码混淆工具')
  console.log('━'.repeat(60))
  console.log(`📁 构建目录: ${BUILD_DIR}`)
  console.log(`📍 Source Maps: ${SOURCE_MAP_DIR}`)
  console.log(`⚙️  混淆策略: ${Object.keys(config.obfuscation).join(', ')}`)
  console.log('━'.repeat(60))
  console.log('')

  // 检查构建目录是否存在
  if (!existsSync(BUILD_DIR)) {
    console.error('❌ 错误: .next/standalone 目录不存在')
    console.error('   请先运行: pnpm build')
    process.exit(1)
  }

  // 创建 Source Map 输出目录
  if (config.sourceMapConfig.enabled) {
    mkdirSync(SOURCE_MAP_DIR, { recursive: true })
  }

  // 开始扫描和混淆
  console.log('🔍 扫描文件...\n')
  scanDirectory(BUILD_DIR)

  // 输出统计信息
  const duration = ((Date.now() - stats.startTime) / 1000).toFixed(2)
  console.log('')
  console.log('━'.repeat(60))
  console.log('📊 混淆统计')
  console.log('━'.repeat(60))
  console.log(`✅ 总文件数:   ${stats.total}`)
  console.log(`🔒 已混淆:     ${stats.obfuscated}`)
  console.log(`⏭️  已跳过:     ${stats.skipped}`)
  console.log(`❌ 错误:       ${stats.errors}`)
  console.log(`⏱️  耗时:       ${duration}s`)
  console.log('━'.repeat(60))

  if (stats.errors > 0) {
    console.error('\n⚠️  混淆过程中出现错误，请检查日志')
    process.exit(1)
  }

  console.log('\n✅ 混淆完成！')

  // 提示 Source Map 位置
  if (config.sourceMapConfig.enabled) {
    console.log('')
    console.log('📍 Source Maps 已保存到:', SOURCE_MAP_DIR)
    console.log('   ⚠️  请勿将 Source Maps 包含在生产环境的 Docker 镜像中')
    console.log('   ⚠️  建议将 Source Maps 上传到内部错误追踪服务（如 Sentry）')
  }

  console.log('')
}

// 执行主函数
main().catch((error) => {
  console.error('❌ 致命错误:', error)
  process.exit(1)
})
