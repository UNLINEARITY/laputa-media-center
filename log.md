这是一份日志文件 log ，如用户有需要，你应该将最近几次的修改加入到此文件当中
- 重要：没有用户的明确指示，你不应该主动修改此文件，不得做出任何修改！！！
- 由于日志可能过长，你不用全部阅读，仅需阅读部分内容，你可以学习仿照相关的格式
- 每次将新的日志放置在开头，也就是此行说明的下面（防止上下文爆炸）

## [2026-05-04] 落地工具前置条件检查面板

### 用户提出的问题
1. 项目上游前置链路较多，不利于朋友安装后分发使用。
2. 需要先实际部署看看，并尝试用可并行 agent 的方式收敛前置链路体验。
3. 在提交前要求补齐双 log。

### 问题原因/修改思路
- 原有 `tool-catalog` 已经记录每个工具的 `requiredSetup` / `optionalSetup`，但这些依赖还只是文档级标记，没有映射到真实 provider、runtime 和本地资产状态。
- Settings 页已经分散具备 LLM、ASR、MiniMax、ffmpeg、yt-dlp、Wav2Lip、声线库等检查入口，但用户需要的是“想跑哪个工具，还缺什么”的聚合视图。
- 采用最小切片：先抽出 Requirement primitive，再新增只读聚合 API，最后在 Settings 系统页展示按工具分组的缺项。

### 实际修改记录
- **`lib/product/setup-requirements.ts`**:
  - 新增 `SetupRequirementId`、Requirement definition、readiness state 和按工具汇总函数。
  - 锁定 `llm`、`minimax-tts`、`asr`、`ffmpeg`、`yt-dlp`、`voice-registry`、`wav2lip` 七类前置条件。
- **`lib/product/setup-requirement-readiness.ts`**:
  - 新增 server-side readiness 聚合，复用现有 LLM/ASR provider、MiniMax credential、ingest runtime、dubbing runtime、whisper.cpp、声线库检查。
  - 只读取本机状态和已保存配置，不触发 Gemini / MiniMax 真实调用。
- **`app/api/setup-requirements/route.ts`**:
  - 新增 `GET /api/setup-requirements`，返回 requirements 与 tools 两层聚合结果。
- **`components/settings/tool-requirements-overview.tsx`**、**`app/settings/page.tsx`**:
  - 在 Settings 系统设置页新增“按工具检查前置条件”面板。
  - 每个工具展示必需/可选前置条件、缺项数量、可运行/阻塞/降级状态，并可跳转到对应设置位置。
- **`components/settings/asr-provider-switcher.tsx`**、**`components/settings/llm-provider-switcher.tsx`**:
  - 小幅修正移动端布局，避免 provider 徽章和按钮在窄屏互相挤压。
- **`lib/product/tool-catalog.ts`**:
  - 将 `SetupRequirementId` 抽到独立 Requirement primitive，保留工具目录作为工具元数据真相源。
- **`tests/product/setup-requirements.test.ts`**:
  - 新增 setup requirement invariant 测试，覆盖定义完整性、Settings anchor、必需/可选缺项对工具 readiness 的影响。
- **`PROJECT_PLAN.md`**:
  - 更新 v1.1 跟进清单：Requirement primitive 已完成，下一步转向分发前置链路简化与 Tauri / Windows installer 评估。

### 验证
- ✅ `corepack pnpm exec biome check ...` 通过。
- ✅ `corepack pnpm exec vitest run tests/product/tool-catalog.test.ts tests/product/setup-requirements.test.ts` 通过：2 files / 28 pass。
- ✅ `corepack pnpm test:unit` 通过：108 files / 812 pass / 17 skip。
- ✅ `corepack pnpm build` 通过，新路由 `/api/setup-requirements` 出现在 Next 路由表。
- ✅ 生产模式实机启动：`LMC_BYPASS_LICENSE=true AUTH_ENABLED=false PORT=8899 pnpm start`，`http://localhost:8899/api/setup-requirements` 返回 200，`http://localhost:8899/settings` 返回 200 且包含新面板。
- ✅ 使用系统 Edge 通过 Playwright smoke 截图验证桌面与移动端布局；截图保存在 `tmp/settings-requirements-desktop.png` 与 `tmp/settings-requirements-mobile.png`。
