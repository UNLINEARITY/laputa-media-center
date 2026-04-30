#!/bin/bash
# Docker 镜像手动发布脚本
# 授权系统 V3 使用内置密钥，无需外部配置

set -e

# 配置
DOCKER_IMAGE="laputamediacenter/chuangcut-video-workflow"
PLATFORMS="linux/amd64,linux/arm64"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}创剪视频工作流 - Docker 镜像发布${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# 获取版本号（从 git tag 或使用 latest）
if git describe --tags --exact-match 2>/dev/null; then
  VERSION=$(git describe --tags --exact-match)
  TAGS="$DOCKER_IMAGE:$VERSION,$DOCKER_IMAGE:latest"
  echo -e "${GREEN}📦 检测到版本标签: $VERSION${NC}"
else
  TAGS="$DOCKER_IMAGE:latest"
  echo -e "${YELLOW}⚠️  未检测到版本标签，使用 latest${NC}"
fi

echo ""
echo "构建配置:"
echo "  - 镜像: $DOCKER_IMAGE"
echo "  - 标签: $TAGS"
echo "  - 平台: $PLATFORMS"
echo ""

# 确认继续
read -p "是否继续构建并推送镜像？(y/N): " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo -e "${YELLOW}已取消${NC}"
  exit 0
fi

echo ""
echo -e "${GREEN}🚀 开始构建...${NC}"
echo ""

# 检查 Docker Buildx
if ! docker buildx version >/dev/null 2>&1; then
  echo -e "${RED}❌ 错误: Docker Buildx 不可用${NC}"
  echo "请安装 Docker Buildx 或更新 Docker 到最新版本"
  exit 1
fi

# 创建或使用 buildx builder
if ! docker buildx inspect multiplatform-builder >/dev/null 2>&1; then
  echo "创建 multiplatform builder..."
  docker buildx create --name multiplatform-builder --use
else
  echo "使用现有 multiplatform builder..."
  docker buildx use multiplatform-builder
fi

# 构建并推送（V3 授权系统无需任何构建参数）
docker buildx build \
  --platform "$PLATFORMS" \
  --tag "$TAGS" \
  --push \
  .

echo ""
echo -e "${GREEN}✅ 镜像构建并推送成功！${NC}"
echo ""
echo "🔗 Docker Hub: https://hub.docker.com/r/$DOCKER_IMAGE"
echo ""

# 显示标签列表
echo "📦 已推送的标签:"
IFS=',' read -ra TAG_ARRAY <<< "$TAGS"
for tag in "${TAG_ARRAY[@]}"; do
  echo "  - $tag"
done

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}发布完成！${NC}"
echo -e "${GREEN}========================================${NC}"
