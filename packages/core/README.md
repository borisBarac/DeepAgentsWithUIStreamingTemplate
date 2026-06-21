# Core

Implementation-ready Deep Agents scaffolding for the template.

The default export path is intentionally a scaffold, not a finished product. It gives you the recommended supervisor-oriented shape from the architecture report without hard-coding your real tools, stores, or task-specific logic.

## What is scaffolded

- A supervisor-first agent factory: `createScaffoldedAgent`
- Four default specialist subagents: `clarifier`, `researcher`, `analyst`, `review-agent`
- A mandatory clarification-first intake gate for new supervisor-path requests
- Two default preflight guardrails: `safety` and `taskScope`
- A specialized tool store for building explicit role-based tool bundles
- Safe-by-default interrupt rules for `write_file`, `edit_file`, and `execute`
- A fixed persistent memory store mounted at `/memory`
- A constrained virtual filesystem layout for `/scratch`, `/plans`, `/reports`, `/artifacts`, `/memory`, and `/skills`
- An inspectable runtime scaffold so the next implementation pass can extend the defaults instead of replacing them blindly
- Markdown-backed default prompts with a typed `PromptLoader` extension point

## Environment

Required for live agent calls:

```sh
OPENROUTER_API_KEY=...
```

Required when the default safety guardrail is enabled:

```sh
OPENAI_API_KEY=...
```

Optional LangSmith tracing:

```sh
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=...
LANGSMITH_PROJECT=deep-agent-template
```

Set `LANGSMITH_ENDPOINT` when the LangSmith account is outside the default US region, for example
`https://eu.api.smith.langchain.com` for GCP EU. Set `LANGSMITH_WORKSPACE_ID` when an API key can
access multiple workspaces.

LangChain sends traces in the background by default. Use `LANGCHAIN_CALLBACKS_BACKGROUND=true` for
persistent application processes to minimize request latency. Use `false` for serverless runtimes
so the process waits for trace submission before exiting.

Applications may provide the same configuration programmatically. Omitted fields continue to use
the process environment, while `enabled: false` explicitly disables tracing:

```ts
const langSmith = {
  enabled: true,
  apiKey: process.env.LANGSMITH_API_KEY,
  projectName: "deep-agent-template",
  endpoint: process.env.LANGSMITH_ENDPOINT,
  workspaceId: process.env.LANGSMITH_WORKSPACE_ID,
};

const agent = createScaffoldedAgent({ langSmith });
```

Configure tracing before invoking agents. LangChain and LangGraph then capture model, tool, agent,
and graph runs without additional callbacks.

To verify error tracing without valid LLM credentials or incurring model cost, run:

```sh
bun run smoke:langsmith
```

The smoke script uses an intentionally invalid OpenRouter key, catches the expected model error,
and prints a unique marker that can be searched in the configured LangSmith project. It sets
`LANGCHAIN_CALLBACKS_BACKGROUND=false` so trace submission completes before the process exits.

## Centralized model configuration

Use `createModelRuntime(...)` when an application needs named provider connections, reusable model
profiles, or different models by agent role. Core does not load `.env` files; pass keys from the
application or leave them undefined to use the provider SDK's environment-variable conventions.

```ts
import { createModelRuntime, createScaffoldedAgent } from "@deep-agent-template/core";

const modelRuntime = createModelRuntime({
  connections: {
    openrouter: {
      provider: "openrouter",
      apiKey: process.env.OPENROUTER_API_KEY,
    },
  },
  models: {
    primary: {
      connection: "openrouter",
      model: "anthropic/claude-sonnet-4",
    },
    fast: {
      connection: "openrouter",
      model: "google/gemini-2.5-flash",
      temperature: 0,
    },
  },
  assignments: {
    default: "primary",
    clarifier: "fast",
    researcher: "fast",
    reviewer: "primary",
  },
});

const agent = createScaffoldedAgent({ modelRuntime });

modelRuntime.getModel("primary");
modelRuntime.getModelForRole("researcher");
```

Supported roles are `baseline`, `supervisor`, `gatekeeper`, `clarifier`, `researcher`, `analyst`,
`reviewer`, `coder`, and `finalizer`. A role-specific assignment wins over `assignments.default`.
Models are constructed on first lookup and cached by profile.

Generic OpenAI-compatible chat-completion endpoints use the same runtime:

```ts
const localRuntime = createModelRuntime({
  connections: {
    local: {
      provider: "openai-compatible",
      apiKey: process.env.LOCAL_API_KEY,
      baseURL: "http://localhost:11434/v1",
    },
  },
  models: {
    localQwen: {
      connection: "local",
      model: "qwen3",
      temperature: 0,
      maxTokens: 4096,
    },
  },
  assignments: {
    default: "localQwen",
  },
});
```

Explicit `subagentOverrides.<role>.model` values still win over runtime assignments.

## Usage

```ts
import {
  createScaffoldedAgent,
  createDefaultSkillFiles,
  createRuntimeScaffold,
} from "@deep-agent-template/core";

const runtime = createRuntimeScaffold();

const agent = createScaffoldedAgent({
  backend: runtime.backend,
  skills: [runtime.virtualFilesystem.skills],
});

const result = await agent.invoke({
  messages: [{ role: "user", content: "Create a short plan for the project." }],
  files: createDefaultSkillFiles(),
});
```

`createBaselineAgent` provides a thinner single-agent control variant.

`createBaselineAgent` always gets its system prompt from `PromptLoader.getBaselinePrompt()`. With
the default loader, that is `packages/core/prompts/baseline.md`; callers cannot bypass the loader
with an inline `systemPrompt`.

The scaffold loads `/memory/project-facts.md` and `/memory/user-preferences.md` by default. The default specialist subagents are intentionally isolated: they start with their own empty `tools` lists, and only the default `clarifier` ships with a bundled `clarify-deeply` skill. Wire any additional specialist capabilities through `subagentOverrides` or fully custom `subagents`.

The default `clarifier` subagent includes the bundled `clarify-deeply` skill at `/skills/clarify-deeply/`. Because the scaffold uses `StateBackend` by default, include `files: createDefaultSkillFiles()` in each `agent.invoke(...)` call so the skill file is present in the per-run state.

## Memory

`/memory` is the durable long-term memory root, backed by `StoreBackend` through `CompositeBackend`. Short-term state (`/scratch`, `/plans`, `/reports`, `/artifacts`) stays on `StateBackend` and is not durable. The memory module (`packages/core/src/memory`) makes the memory product contract explicit and testable.

V1 assumes a **single-user runtime**: each local agent or isolated server sandbox serves exactly one user and uses one stable single-user namespace.

Default durable memory files:

- `/memory/project-facts.md` — stable project and environment facts.
- `/memory/user-preferences.md` — explicit preferences the user asked to remember.

The allowed durable content is **explicit user preferences and stable project facts only**. The agent must not automatically persist inferred preferences, credentials, arbitrary observations, or transient task details. `reviewMemoryContent(...)` flags those categories, and the seed helpers ship wording that defines what belongs in each file.

Durable writes continue to use Deep Agents filesystem tools (`write_file` / `edit_file`) — there is no hidden side channel. In v1, writes to the writable single-user memory files are auto-approved (see `createSingleUserMemoryPolicy`), while other sensitive tool interrupts (`write_file`, `edit_file`, `execute`) stay enabled. `resolveMemoryInterrupts(...)` is an explicit passthrough so memory auto-approval never silently disables interrupt safety.

```ts
import {
  createMemorySeedFiles,
  createSingleUserMemoryNamespace,
  createSingleUserMemoryPolicy,
  reviewMemoryContent,
} from "@deep-agent-template/core";

const seedFiles = createMemorySeedFiles();
const namespace = createSingleUserMemoryNamespace();
const policy = createSingleUserMemoryPolicy();

reviewMemoryContent("OPENAI_API_KEY=sk-...").allowed; // false
```

Durable memory remains an explicit agent action. Skills remain procedural memory under `/skills`, separate from `/memory`.

## Prompts

Default agent and specialist prompts live in Markdown files under `packages/core/prompts/` and are loaded through the typed `PromptLoader` interface. The bundled `MarkdownPromptLoader` is used by default.

Use a custom loader when your application wants to source prompts from another package, database, CMS, or tenant-specific configuration without editing core code:

```ts
import type { PromptLoader } from "@deep-agent-template/core";

const promptLoader: PromptLoader = {
  getBaselinePrompt: () => "Baseline prompt",
  getSupervisorPrompt: (config) => `Supervisor prompt with ${config.maxRounds} rounds`,
  getClarifierPrompt: (config) => `Clarifier prompt with ${config.questionsPerRound} questions`,
  getResearcherPrompt: () => "Researcher prompt",
  getAnalystPrompt: () => "Analyst prompt",
  getReviewAgentPrompt: () => "Review prompt",
};

const agent = createScaffoldedAgent({ promptLoader });
```

For scaffolded agents, explicit `systemPrompt` values and
`subagentOverrides.<role>.systemPrompt` still take precedence over loader defaults.

## Guardrails

The scaffolded and baseline factories install two LangChain middleware guardrails by default:

- `OpenAIContentSafetyGuardrail` runs before the agent and uses OpenAI moderation (`omni-moderation-latest`) to block unsafe user requests.
- `TaskScopeGuardrailMiddleware` runs before the agent and uses structured output to classify whether the request is inside the project task scope.

Task-scope policy is controlled by markdown files under `packages/core/guardrails/`:

- `taskScope.requiredContext.md`
- `taskScope.allowedTasks.md`
- `taskScope.disallowedTasks.md`

The default runtime safety decision uses OpenAI moderation; provide `OPENAI_API_KEY` for live invocations.

Use `createGuardrailDecision` when building a custom runtime. It resolves policy overrides, enabled guardrails, and the final middleware order:

```ts
const guardrailDecision = createGuardrailDecision({
  taskScopeModel: model,
  middleware: callerMiddleware,
});

createDeepAgent({
  model,
  middleware: guardrailDecision.middleware,
});
```

Disable the default guardrails when building a custom runtime:

```ts
const agent = createScaffoldedAgent({
  guardrails: false,
});
```

Or override one rail while keeping the other:

```ts
const agent = createScaffoldedAgent({
  guardrails: {
    safety: {
      model: "omni-moderation-latest",
    },
    taskScope: {
      policies: {
        allowedTasks: "Only answer questions about the current repository.",
      },
    },
  },
});
```

## Clarification-first supervisor flow

The scaffolded supervisor treats clarification as a required preflight phase. Every new top-level request is expected to route through the `clarifier` subagent before normal planning, tool use, or downstream delegation begins.

The `clarifier` is wired with a Zod `responseFormat` (`clarificationResultSchema`), so its readiness payload is returned to the supervisor as machine-readable structured output rather than free text. The supervisor is instructed to relay the exact `questions` from that payload back to the user when `status` is `needs_clarification`.

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

The intended end-to-end intake loop is:

1. User sends a new request.
2. Supervisor delegates to the `clarifier`, which returns a structured `ClarificationResult`.
3. If `status` is `needs_clarification`, the supervisor relays `result.questions` to the user verbatim.
4. The user answers; the answers are recorded with `recordClarificationAnswers(...)` and folded into the intake with `applyClarificationResult(...)`.
5. The clarifier runs again until it returns `ready_to_proceed` (proceed to planning) or the intake becomes `blocked`.

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

You can override or disable the default clarification behavior through the scaffolded factory and runtime scaffold:

```ts
const runtime = createRuntimeScaffold({
  clarificationOptions: {
    maxRounds: 6,
    questionsPerRound: 2,
  },
});

const agent = createScaffoldedAgent({
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
const reviewerNeedsInterrupts = store.roleHasRestrictedTools("reviewer");
```

The store is static and explicit by design. It does not inherit tools across roles or auto-compose bundles from tags. Its role metadata is descriptive, so later scaffold work can align specialist prompts, safety controls, and evaluation fixtures without changing the registry API.

## Recommended next implementation steps

1. Replace placeholder specialist bundles with your real research, browser, code, or retrieval tools.
2. Provide a real `store` and keep `/memory` namespaced per user or thread family.
3. Add project skills under `/skills` and point subagents at narrower skill directories where appropriate.
4. Introduce task-specific response formats and evaluation fixtures once the main implementation starts.
