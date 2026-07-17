# Codex Cloud

Codex Cloud environments are configured in [Codex environment settings](https://chatgpt.com/codex/settings/environments), not `.codex/config.toml`.

## Prerequisites

1. Create a GitHub repository and push this repository. The current checkout has no Git remote.
2. Connect GitHub to Codex and grant access to the repository.
3. Create a Codex Cloud environment for the repository.

## Environment configuration

Setup script:

```bash
npm install --global bun@1.3.14
HUSKY=0 bun install --frozen-lockfile
```

Maintenance script:

```bash
HUSKY=0 bun install --frozen-lockfile
```

Add `CI=true` as a non-secret environment variable. Leave provider keys unset: the acceptance gates below are offline. Keep agent internet access disabled unless a task requires it.

Reset the environment cache after dependency or tooling changes that make cached state incompatible.

## First-task verification

```bash
bun test
bun run typecheck
bun run check
bun run --filter @deep-agent-template/web-app build
```

Live LLM, LangSmith, and Replicate tests are outside Codex Cloud acceptance gates.

Setup scripts have internet access. Agent internet access is disabled by default. Environment variables persist throughout a task; encrypted secrets are removed before agent commands run. See the [Codex Cloud environment documentation](https://developers.openai.com/codex/cloud/environments).
