# Contributing to LaputaMediaCenter

Thanks for your interest! This is a local-first self-media production toolkit. The maintainer team is small, so please read this short guide before opening issues or PRs.

## Setup

```bash
# Prerequisites are pinned in package.json (engines.node + packageManager)
node --version  # >= 24.0.0
pnpm --version  # use the version in package.json's packageManager field

pnpm install
pnpm db:init
pnpm dev          # http://localhost:8899
```

For E2E testing setup, you'll need a separate dev server with isolated env:

```bash
pnpm dev:e2e &        # in one terminal (uses tmp/playwright-e2e/*.sqlite)
pnpm test:e2e:reuse   # in another
```

See [README.md](./README.md) → 「E2E 測試兩種模式」for full details.

## Test gate (required before opening PR)

| Tier | Command | When to run |
|---|---|---|
| **MUST PASS** | `pnpm typecheck:app` | Every PR. Production code type-check. CI gate. |
| **Recommended before PR** | `pnpm typecheck:all && pnpm lint && pnpm test:unit` | Catch test fixture drift, lint regressions, unit failures locally. |
| **Run if you touched workflow / e2e** | `pnpm test:e2e` (default mode) or `pnpm test:e2e:reuse` (with `dev:e2e`) | Full E2E suite, ~1-2 min. |

**Why two typecheck commands?** `typecheck:app` excludes `tests/` (Codex P1 #6 split). `typecheck:all` includes tests; both are currently 0 errors and we want to keep it that way.

## Commit message style

Conventional commits with scope:

```
<type>(<scope>): <subject>

<body explaining why, not what>

Co-Authored-By: <agent or human alias>
```

Common types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`. Common scopes: `phase5`, `podcast`, `highlights`, `script-rewrite`, `dubbing`, `tests`, `ui`, `e2e`.

Examples (from history):
- `feat(podcast): Codex P1 #2 — 加 script_only 模式（默認，免費）+ minimax 模式（付費）`
- `fix(e2e): reuse mode env mismatch — add dev:e2e + test:e2e:reuse scripts`
- `chore(P2): Codex P2 5 項收尾 — wording / docs / 殘留`

## Protected assets — DO NOT modify without maintainer approval

The following files are core IP that took significant tuning to get right. **Do not modify them in a PR** without prior discussion (file an issue first):

- `scripts/translator.py` (Phase 1 two-stage translation prompt)
- `lib/dubbing/voice-registry.ts`
- `lib/dubbing/creator-profile.ts`
- `lib/dubbing/applied-asset-summary.ts`
- `lib/jobs/dubbing-qa.ts`
- `lib/ingest/source-classifier.ts`
- `lib/workflow/engine.ts`
- `lib/config/languages.ts`

See [AGENTS.md](./AGENTS.md) for full context on why these are protected.

## What we welcome

- 🐛 Bug reports with reproducible repro (especially for the 6 tool lines)
- 🔧 Fixes for the 4 known follow-up items in [PROJECT_PLAN.md](./PROJECT_PLAN.md) §5 Phase 5 list
- 📚 Documentation improvements (README EN/中, AGENTS.md, code comments)
- 🌍 i18n: language packs beyond Mandarin / Cantonese (the prompt structure in `lib/i18n/cantonese-prompt.ts` is designed to be extensible)
- 🎨 UI/UX improvements (especially mobile, since the maintainer's primary device is desktop)

## What we may push back on

- Adding cloud-only features that break the local-first design
- Adding paid third-party providers without a free fallback path (per Codex P1 #2 discussion)
- Re-introducing legacy TTS providers (Fish Audio, etc. — see [CHANGELOG.md](./CHANGELOG.md) `[1.0.0]` Plan B)
- Changes to protected assets without prior discussion

## Issue & PR flow

1. **Issue first** for non-trivial changes. Describe the problem you're solving, not just the solution.
2. **One concern per PR**. Easier to review and revert.
3. **Test gate must pass** (see above).
4. **Reference the issue** in PR description.
5. **Be patient**. This is a side project; reviews may take a few days.

## License

By contributing, you agree your contributions will be licensed under the [MIT License](./LICENSE).
