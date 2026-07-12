# Web App Advanced Default PRD

Tracking issue: `DeepAgentTemplate-026`

## Problem Statement

The web app still exposes a dual provider-mode setup even though the default runtime should be the scaffolded advanced agent. The current surface includes a `simple` mode path, an `advanced` mode path, and a default that does not clearly reflect the intended product behavior. This creates an unnecessary toggle, adds test and docs overhead, and makes the default launch behavior harder to reason about.

## Solution

Remove the simple provider-mode path and make the advanced web-app agent the only supported runtime path. The default `web-app` run should launch the advanced scaffolded agent directly. Any provider-mode env var, parsing logic, and mode-selection tests should be removed with the web-app default simplified to a single path.

## User Stories

1. As an application developer, I want `bun run web-app` to start the advanced agent by default, so that the common path matches the intended scaffold.
2. As an application developer, I want the simple provider mode removed, so that I do not maintain two equivalent launch paths.
3. As a maintainer, I want the agent-provider code to expose one clear runtime path, so that the web-app behavior is easier to understand and test.
4. As a maintainer, I want the docs and scripts to stop advertising a mode toggle, so that the default workflow is unambiguous.

## Implementation Decisions

- Remove `WEB_APP_AGENT_PROVIDER_MODE` from the web-app runtime.
- Delete the `simple` agent-provider branch and all mode parsing.
- Make the web-app agent factory always create the advanced scaffolded agent.
- Update the root `package.json` scripts so `web-app` launches the advanced agent directly.
- Remove mode-focused tests that only validate parsing/default selection.
- Remove the provider-mode block from `.env.example`.
- Keep the CLI scaffold commands unchanged; they are separate from the web-app runtime path.

## Testing Decisions

- Run `bun test` after the change.
- Run `bun run typecheck` after the change.
- Run `bun run check` or `biome check .` to catch script and doc fallout.

## Out of Scope

- Reworking the CLI scaffold commands.
- Changing the advanced agent implementation itself.
- Adding a new replacement mode or future toggle.

## Further Notes

- The PRD follows the existing repo pattern of linking a tracker issue from the document.
- This change is a simplification, not a behavior expansion.
