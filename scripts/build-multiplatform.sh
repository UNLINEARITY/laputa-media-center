#!/bin/bash

set -e

echo "🔨 Building multi-platform Docker image..."

# 读取版本号
VERSION=$(node -p "require('./package.json').version")

# Docker Hub用户名
DOCKER_USER="laputamediacenter"

# 创建 buildx builder (如果不存在)
if ! docker buildx inspect multiplatform-builder &>/dev/null; then
  echo "📦 Creating buildx builder..."
  docker buildx create --name multiplatform-builder --use
fi

# 使用 builder
docker buildx use multiplatform-builder

# 启动 builder
docker buildx inspect --bootstrap

# 构建并推送多平台镜像
echo "🚀 Building for linux/amd64 and linux/arm64..."
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag ${DOCKER_USER}/chuangcut-video-workflow:${VERSION} \
  --tag ${DOCKER_USER}/chuangcut-video-workflow:latest \
  --push \
  .

echo "✅ Multi-platform build completed and pushed!"
echo "📝 Images:"
echo "   - ${DOCKER_USER}/chuangcut-video-workflow:${VERSION}"
echo "   - ${DOCKER_USER}/chuangcut-video-workflow:latest"
echo "   - Platforms: linux/amd64, linux/arm64"
