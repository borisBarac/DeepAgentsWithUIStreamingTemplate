## Problem Statement

The research agent attempted to write `/home/user/kanban_board_research_report.md` and received `Error: permission denied for write`. The runtime intentionally exposes a constrained virtual filesystem, but filesystem-capable agents do not consistently receive explicit guidance about valid paths. Models can therefore invent conventional host paths even though `write_file`, `edit_file`, and `read_file` enforce virtual-path permissions.

## Solution

Provide every filesystem-capable main agent and specialist with one shared virtual-filesystem contract. Agents will use absolute paths under the allowed virtual roots and avoid host paths. Keep the existing security boundary unchanged. Add deterministic permission and prompt coverage plus a live model-driven researcher E2E that proves a report is actually created.

## User Stories

1. As a user requesting research, I want the researcher to save reports successfully, so that delegated work produces the requested artifact.
2. As a user, I want every agent to understand the same virtual filesystem layout, so that behavior is consistent across roles.
3. As a user, I want agents to distinguish writable, read-only, and forbidden roots, so that tool calls do not fail unexpectedly.
4. As a maintainer, I want filesystem guidance centralized, so that path policy does not drift between prompts.
5. As a maintainer, I want caller-overridden prompts to retain the runtime filesystem contract, so that customization does not silently remove operational safety guidance.
6. As a maintainer, I want host paths to remain forbidden, so that fixing usability does not weaken isolation.
7. As a maintainer, I want deterministic tests for read, write, and edit behavior, so that permission regressions fail quickly.
8. As a maintainer, I want a live LLM E2E, so that real delegation and tool selection are validated rather than inferred from prompt text.
9. As a maintainer, I want the E2E to inspect actual agent state, so that a model cannot pass by merely claiming it wrote a file.

## Implementation Decisions

- Add one centralized Markdown filesystem contract and compose it into the final system prompt for the baseline agent, supervisor, clarifier, researcher, analyst, reviewer, image designer, and product generator.
- Apply the contract after caller prompt overrides because filesystem permissions still govern overridden agents.
- Define `/scratch`, `/plans`, `/reports`, `/artifacts`, and `/memory` as readable and writable virtual roots.
- Define `/skills` as read-only.
- Require absolute virtual paths and explicitly prohibit host-style paths such as `/home/user`, `/tmp`, and repository workspace paths.
- Preserve role-specific restrictions. In particular, the reviewer remains instructed not to call tools even though it receives the shared operational contract.
- Preserve the existing deny-all fallback and do not add `/home/user` or other host roots to permissions.
- Keep `execute_python` separate: its Docker sandbox filesystem is not the shared virtual filesystem.
- Use the existing prompt-loader and runtime scaffold composition seam; do not introduce a second permission system.

## Testing Decisions

- Prefer external behavior at the prompt-composition and filesystem-tool seams.
- Assert every default agent prompt contains the shared contract.
- Assert explicit prompt overrides also retain the contract.
- Exercise `read_file`, `write_file`, and `edit_file` against permitted roots.
- Verify `/skills` can be read but not written.
- Verify `/home/user/**` is denied for read and write operations.
- Extend the existing live researcher E2E suite. Use the configured real LLM, delegate exactly once to the researcher, require `write_file` to create `/reports/kanban_board_research_report.md` with a unique marker, and assert returned agent state contains the exact path and marker.
- Assert the live result contains no `/home/user/**` artifact and fail when the researcher only reports success without creating the file.
- Use existing `RUN_LIVE_E2E`, `LLM_BASE_URL`, and `LLM_API_KEY` gating and avoid Linkloom or unrelated network research dependencies.
- Run targeted prompt, scaffold, permission, subagent, and agent tests; full core tests and typecheck; then the existing live E2E command.

## Out of Scope

- Allowing host filesystem access.
- Weakening or replacing current permission enforcement.
- Sharing files between the Python Docker sandbox and the agent virtual filesystem.
- Adding a live E2E for every specialist; deterministic coverage verifies contract injection for all roles while one researcher E2E validates real tool selection.
- Changing role-specific tool-use policies unrelated to filesystem paths.

## Further Notes

The failure was reproduced for both `write_file` and `edit_file` with the exact `/home/user/kanban_board_research_report.md` path. Existing targeted tests passed before this change, confirming a missing model-facing path contract rather than broken permission enforcement.
