# Core

Implementation-ready Deep Agents scaffolding for the template.

The default export path is intentionally a scaffold, not a finished product. It gives you the recommended supervisor-oriented shape from the architecture report without hard-coding your real tools, stores, or task-specific logic.

## What is scaffolded

- A supervisor-first agent factory: `createScaffoldedAgent` and `createBasicAgent`
- Four default specialist subagents: `clarifier`, `researcher`, `analyst`, `critic`
- A mandatory clarification-first intake gate for new supervisor-path requests
- A specialized tool store for building explicit role-based tool bundles
- Safe-by-default interrupt rules for `write_file`, `edit_file`, and `execute`
- A fixed persistent memory store mounted at `/memory`
- A constrained virtual filesystem layout for `/scratch`, `/plans`, `/reports`, `/artifacts`, `/memory`, and `/skills`
- Inspectable blueprint helpers so the next implementation pass can extend the defaults instead of replacing them blindly

## Environment

Required for live agent calls:

```sh
OPENROUTER_API_KEY=...
```

Optional LangSmith tracing:

```sh
LANGSMITH_API_KEY=...
LANGSMITH_PROJECT=deep-agent-template
LANGSMITH_TRACING=true
```

The default model is OpenRouter DeepSeek V4 Pro:

```ts
openrouter:deepseek/deepseek-v4-pro
```

## Usage

```ts
import {
  createBasicAgent,
  createDefaultCompositeBackend,
  createSupervisorBlueprint,
} from "@deep-agent-template/core";

const blueprint = createSupervisorBlueprint();

const agent = createBasicAgent({
  backend: createDefaultCompositeBackend(),
  skills: [blueprint.virtualFilesystem.skills],
});

const result = await agent.invoke({
  messages: [{ role: "user", content: "Create a short plan for the project." }],
});
```

`createBasicAgent` is an alias for the scaffolded factory. For a thinner single-agent control variant, use `createBaselineAgent`.

The scaffold loads `/memory/AGENTS.md` and `/memory/user-preferences.md` by default. The default specialist subagents are intentionally isolated: they start with their own empty `tools` and `skills` lists, and you should wire specialist capabilities through `subagentOverrides` or fully custom `subagents`.

## Clarification-first supervisor flow

The scaffolded supervisor treats clarification as a required preflight phase. Every new top-level request is expected to route through the `clarifier` subagent before normal planning, tool use, or downstream delegation begins.

The clarifier returns a structured readiness payload with:

- `status`
- `readyToProceed`
- `questions`
- `missingInformation`
- `answeredInformation`
- `reasoningSummary`
- `roundCount`
- `maxRounds`

The default clarification policy is:

- `enabled: true`
- `mode: "mandatory-preflight"`
- `maxRounds: 10`
- `questionsPerRound: 3`

If the request is still unresolved at the round cap, the clarification state becomes blocked instead of silently proceeding.

Use the exported clarification helpers to manage intake state outside the prompt layer:

```ts
import {
  applyClarificationResult,
  createClarificationState,
  resolveClarificationGate,
} from "@deep-agent-template/core";

const intake = createClarificationState("Plan the launch.");

const gate = resolveClarificationGate({
  isNewRequest: true,
  request: intake.originalRequest,
  state: intake,
});
```

You can override or disable the default clarification behavior through the scaffolded factory and blueprint helpers:

```ts
const blueprint = createSupervisorBlueprint({
  clarification: {
    maxRounds: 6,
    questionsPerRound: 2,
  },
});

const agent = createBasicAgent({
  clarificationOptions: {
    enabled: false,
  },
});
```

## Specialized tool store

Use `createSpecializedToolStore` to register concrete LangChain tools or MCP/deepagents-compatible agent tools under stable ids, then resolve explicit role bundles for your specialist agents.

```ts
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  createDefaultSpecialistRoleToolsets,
  createSpecializedToolStore,
} from "@deep-agent-template/core";

const searchTool = tool(async ({ query }) => `searched:${query}`, {
  name: "search_sources",
  description: "Search external sources.",
  schema: z.object({
    query: z.string(),
  }),
});

const store = createSpecializedToolStore({
  tools: [
    {
      id: "search",
      tool: searchTool,
      specialists: ["researcher"],
      evidenceMode: "retrieval",
      riskLevel: "safe",
    },
  ],
  roles: createDefaultSpecialistRoleToolsets().map((roleToolset) =>
    roleToolset.role === "researcher"
      ? { ...roleToolset, toolIds: ["search"] }
      : roleToolset,
  ),
});

const researcherTools = store.resolveRoleTools("researcher");
const criticNeedsInterrupts = store.roleHasRestrictedTools("critic");
```

The store is static and explicit by design. It does not inherit tools across roles or auto-compose bundles from tags. Its role metadata is descriptive, so later scaffold work can align specialist prompts, safety controls, and evaluation fixtures without changing the registry API.

## Recommended next implementation steps

1. Replace placeholder specialist bundles with your real research, browser, code, or retrieval tools.
2. Provide a real `store` and keep `/memory` namespaced per user or thread family.
3. Add project skills under `/skills` and point subagents at narrower skill directories where appropriate.
4. Introduce task-specific response formats and evaluation fixtures once the main implementation starts.
