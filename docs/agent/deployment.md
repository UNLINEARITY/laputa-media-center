# 部署指南

## Docker 构建

### 构建排除文件（.dockerignore）

排除与程序运行无关的开发文件，减少镜像体积、加速构建：

| 类别 | 排除项 | 原因 |
|-----|--------|------|
| AI/开发文档 | `docs/`、`CLAUDE.md`、`AGENTS.md`、`WARP.md`、`README.md`、`VERSION.md` | 开发使用，运行无关 |
| 开发配置 | `biome.json`、`vitest.config.ts`、`playwright.config.ts`、`proxy.ts` | 测试/格式化工具 |
| 开发辅助 | `scripts/`、`hooks/`、`temp/`、`*.log` | 本地开发脚本 |
| 运行时重建 | `node_modules/`、`.next/`、`logs/` | 容器内重新生成 |
| 本地数据 | `.env*`、`*.db`、`uploads/`、`output/` | 运行时生成/敏感 |
| Git/IDE | `.git/`、`.vscode/`、`.idea/` | 版本控制/编辑器 |

> 配置文件：`.dockerignore`（项目根目录）

### 多平台构建（推荐）

Zeabur 服务器是 amd64 架构，必须构建多平台镜像。

```bash
# 1. 确保 buildx builder 存在
docker buildx use multiplatform-builder 2>/dev/null || docker buildx create --name multiplatform-builder --use

# 2. 构建并推送多平台镜像
docker buildx build \
  --platform "linux/amd64,linux/arm64" \
  --tag "laputamediacenter/chuangcut-video-workflow:latest" \
  --push \
  .
```

### 验证镜像

```bash
docker buildx imagetools inspect laputamediacenter/chuangcut-video-workflow:latest
```

### 注意事项

- **不要使用** `./scripts/publish-docker.sh`（包含交互式提示）
- `build.sh` 和 `push.sh` 脚本**已弃用删除**
- 使用 `./scripts/build-multiplatform.sh` 或上述命令

## Zeabur 部署

### 项目信息

| 项目 | ID |
|------|-----|
| Project ID | `REDACTED_PROJECT_ID` |
| Service ID | `REDACTED_SERVICE_ID` |
| Environment ID | `REDACTED_ENV_ID` |
| 控制台 | https://zeabur.com/projects/REDACTED_PROJECT_ID/services/REDACTED_SERVICE_ID?envID=REDACTED_ENV_ID |

### CLI 安装位置

```bash
/Users/laputa-server/.local/bin/zeabur
```

### 设置 Context（首次使用）

```bash
zeabur context set project --id REDACTED_PROJECT_ID -y -i=false
zeabur context set env --id REDACTED_ENV_ID -y -i=false
zeabur context get -i=false
```

### 重新部署

```bash
# 方法 1：restart（推荐，自动拉取新镜像）
zeabur service restart --id REDACTED_SERVICE_ID --env-id REDACTED_ENV_ID -y -i=false

# 方法 2：redeploy（备选）
zeabur service redeploy --id REDACTED_SERVICE_ID --env-id REDACTED_ENV_ID -y -i=false
```

### 查看部署日志

```bash
zeabur deployment log --service-id REDACTED_SERVICE_ID --env-id REDACTED_ENV_ID -i=false | head -20
```

成功日志示例：
```
Successfully pulled image "docker.io/laputamediacenter/chuangcut-video-workflow:latest"
```

### 其他常用命令

```bash
# 查看服务状态
zeabur service list --env-id REDACTED_ENV_ID -i=false

# 查看当前登录用户
zeabur profile info -i=false

# 暂停服务
zeabur service suspend --id REDACTED_SERVICE_ID --env-id REDACTED_ENV_ID -y -i=false
```

## 完整发布流程

```bash
# 1. 构建并推送多平台镜像
docker buildx build --platform "linux/amd64,linux/arm64" --tag "laputamediacenter/chuangcut-video-workflow:latest" --push .

# 2. 触发 Zeabur 重新部署
zeabur service restart --id REDACTED_SERVICE_ID --env-id REDACTED_ENV_ID -y -i=false

# 3. 查看部署日志确认
zeabur deployment log --service-id REDACTED_SERVICE_ID --env-id REDACTED_ENV_ID -i=false | head -20
```

## 双仓库架构

- **主仓库**（私有）：`laputamediacenter/chuangcut-video-workflow` - 完整源代码
- **模板仓库**（公开）：`laputamediacenter/chuangcut-video-workflow-zeabur` - 静态资源

**部署流程**：主仓库 → Docker Hub 镜像 → Zeabur 模板部署
