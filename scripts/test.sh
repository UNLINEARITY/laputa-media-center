#!/bin/bash

###############################################################################
# 测试脚本
#
# 用途：统一的测试执行入口
#
# 使用方式：
#   ./scripts/test.sh              # 运行所有测试
#   ./scripts/test.sh unit         # 只运行单元测试
#   ./scripts/test.sh integration  # 只运行集成测试
#   ./scripts/test.sh e2e          # 只运行 E2E 测试
#   ./scripts/test.sh coverage     # 生成覆盖率报告
#   ./scripts/test.sh watch        # 监听模式
###############################################################################

# 设置脚本错误时退出
set -e

# 获取脚本所在目录的绝对路径
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 打印信息
info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

# 打印警告
warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# 打印错误
error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查依赖是否安装
check_dependencies() {
    info "检查测试依赖..."

    if [ ! -d "node_modules/vitest" ]; then
        error "Vitest 未安装，请运行 pnpm install"
        exit 1
    fi

    if [ ! -d "node_modules/@playwright/test" ]; then
        warn "Playwright 未安装，E2E 测试将跳过"
    fi

    info "✓ 依赖检查完成"
}

# 运行单元测试
run_unit_tests() {
    info "运行单元测试..."
    pnpm test:unit
}

# 运行集成测试
run_integration_tests() {
    info "运行集成测试..."
    pnpm test:integration
}

# 运行 E2E 测试
run_e2e_tests() {
    info "运行 E2E 测试..."

    if [ ! -d "node_modules/@playwright/test" ]; then
        error "Playwright 未安装，无法运行 E2E 测试"
        exit 1
    fi

    pnpm test:e2e
}

# 生成覆盖率报告
run_coverage() {
    info "生成覆盖率报告..."
    pnpm test:coverage

    info "✓ 覆盖率报告已生成到 docs/test-reports/coverage/ 目录"
    info "打开 docs/test-reports/coverage/index.html 查看详细报告"
}

# 监听模式
run_watch() {
    info "启动测试监听模式..."
    pnpm test:watch
}

# 运行所有测试
run_all_tests() {
    info "运行所有测试..."

    run_unit_tests
    run_integration_tests

    if [ -d "node_modules/@playwright/test" ]; then
        run_e2e_tests
    else
        warn "跳过 E2E 测试（Playwright 未安装）"
    fi

    info "✓ 所有测试完成"
}

# 清理测试输出
clean_test_output() {
    info "清理测试输出..."

    rm -rf coverage/
    rm -rf test-results/
    rm -rf playwright-report/
    rm -rf .vitest/
    rm -f *.test.sqlite

    info "✓ 清理完成"
}

# 主函数
main() {
    # 检查依赖
    check_dependencies

    # 根据参数执行对应操作
    case "${1:-all}" in
        unit)
            run_unit_tests
            ;;
        integration)
            run_integration_tests
            ;;
        e2e)
            run_e2e_tests
            ;;
        coverage)
            run_coverage
            ;;
        watch)
            run_watch
            ;;
        clean)
            clean_test_output
            ;;
        all)
            run_all_tests
            ;;
        *)
            error "未知的测试类型: $1"
            echo ""
            echo "使用方式："
            echo "  ./scripts/test.sh              # 运行所有测试"
            echo "  ./scripts/test.sh unit         # 只运行单元测试"
            echo "  ./scripts/test.sh integration  # 只运行集成测试"
            echo "  ./scripts/test.sh e2e          # 只运行 E2E 测试"
            echo "  ./scripts/test.sh coverage     # 生成覆盖率报告"
            echo "  ./scripts/test.sh watch        # 监听模式"
            echo "  ./scripts/test.sh clean        # 清理测试输出"
            exit 1
            ;;
    esac
}

# 执行主函数
main "$@"
