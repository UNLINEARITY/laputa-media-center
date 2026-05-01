# LaputaMediaCenter

**Version**: 1.0.0 (Self-media production toolkit v1, 2026-05-01) | **License**: MIT

> ⚠️ **Local-first tool, not a SaaS**. The project database, API keys, generated scripts, audio, and video files stay on your machine. If you configure external providers such as Gemini, OpenAI, or MiniMax, the relevant text or audio is sent to the provider you chose for the feature you run. Without configured providers, this project does not upload your content by itself. Requires local `ffmpeg` and `yt-dlp`; `whisper.cpp` is auto-downloaded on first ASR run.
>
> 中文版說明請看 [README.md](./README.md)。

A content production toolkit for Chinese-speaking self-media creators. Six tool lines, all working with Mandarin and Cantonese output.

## Features (6 tools)

| Tool | What it does |
|---|---|
| **Video localization** (`/dubbing`) | Foreign video → Mandarin / Cantonese voice-over with optional lip sync |
| **Podcast** (`/podcast`) | Long article / transcript → two-host podcast script (free, default) → optional MiniMax TTS |
| **Highlights** (`/highlights`) | Long video → 30-60s clips with burned-in subtitles, supports 9:16 |
| **Multi-platform script** (`/script-rewrite`) | One source → YouTube long / Douyin 60s / Xiaohongshu / WeChat versions |
| **Title & opening** (`/title-hooks`) | 5 candidate titles + first-30s rewrite for hook strength |
| **Dubbing QA** (built into `/dubbing`) | 8-dimension automated quality check |

## Quick start

```bash
# 1. Prerequisites: Node.js 24+, pnpm 10+, ffmpeg, yt-dlp on PATH
node --version  # should be >= 24
pnpm --version  # should be >= 10

# 2. Install
pnpm install
pnpm db:init

# 3. Run dev server (http://localhost:8899)
pnpm dev
```

Or use the convenience script:

```bash
# Windows
./install.ps1

# macOS / Linux
./install.sh
```

## Local-first design

- **Local storage by default**. Jobs, artifacts, credentials, and generated media stay in local SQLite / local folders.
- **External providers are opt-in**. LLM-backed script generation requires a configured Gemini / OpenAI / Mistral provider. TTS is optional; the podcast tool defaults to `script_only` mode so you can generate a script without MiniMax TTS.
- **Free tier paths**:
  - LLM: bring your own Gemini / OpenAI / Mistral key (free tiers exist for Gemini)
  - ASR: `whisper.cpp` (auto-downloaded, ~150MB, runs on CPU)
  - TTS: optional. Podcast tool defaults to `script_only` mode (no TTS). MiniMax is optional paid TTS.
- **Pay only when you need it**. No subscriptions, no metering on our side. You pay providers directly when you opt in.

## API key configuration

Configured via `/settings` UI (encrypted at rest in local SQLite). See [docs/agent/env-vars.md](./docs/agent/env-vars.md) for full env var list.

| Provider | Required for | Where to get |
|---|---|---|
| Gemini AI Studio | LLM (default) | https://aistudio.google.com/apikey (free tier) |
| OpenAI | LLM (paid alternative) | https://platform.openai.com |
| MiniMax | TTS (optional, paid) | https://platform.minimax.chat |

`LICENSE_KEY` env var is **optional**: leave unset for local-dev mode (`/api/health` reports `mode=local_dev`).

## Architecture

- **Stack**: Next.js 16 (App Router) + React 19 + TypeScript 5 + Tailwind CSS v4 + SQLite (better-sqlite3) + Vitest + Playwright
- **Workflow engine**: Per-job state machine in `lib/workflow/`. Each tool is a workflow (e.g., `podcast-production`, `highlights-extraction`).
- **Provider registry**: ASR (`whisper-cpp` / `gemini-audio`) and LLM (`gemini` / `openai` / `mistral`) providers in `lib/providers/`.
- See [README.md](./README.md) `## 项目结构` for full Chinese tree breakdown.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE) — Copyright (c) 2026 LaputaMediaCenter contributors.
