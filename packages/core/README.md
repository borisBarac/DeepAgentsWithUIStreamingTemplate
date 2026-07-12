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

Required for live agent calls (OpenAI-compatible endpoint such as DeepSeek, OpenAI, Ollama, or vLLM):

```sh
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=...
LLM_MODEL=deepseek-v4-flash
```

`LLM_MODEL` is the **normal** tier. Two optional tiers let you route cheap or
heavy-reasoning roles to different models on the same endpoint. Each falls back
to `LLM_MODEL` when unset, so leaving them blank runs every role on one model:

```sh
FAST_MODEL=deepseek-v4-flash   # clarifier, guardrail classifier
PRO_MODEL=deepseek-v4-flash    # supervisor, analyst, reviewer, finalizer
```

Core does not load `.env` files; applications pass keys and endpoints from their
own configuration or rely on the provider SDK's environment-variable conventions.

The safety guardrail reuses the same model runtime (`LLM_*`), so no additional
credentials are required.

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

The smoke script uses an intentionally invalid model key/endpoint, catches the expected model error,
and prints a unique marker that can be searched in the configured LangSmith project. It sets
`LANGCHAIN_CALLBACKS_BACKGROUND=false` so trace submission completes before the process exits.

## Model configuration

Models are organized around three **categories** — `fast`, `normal`, and `pro` —
and every agent role resolves to exactly one category. A category maps to one
concrete model (a connection plus a model id); roles map to categories.

```
role ──(assignments)──▶ category ──(categories)──▶ concrete model
```

### From environment variables

The simplest path: `createModelRuntimeFromEnv()` reads `LLM_BASE_URL`,
`LLM_API_KEY`, `LLM_MODEL` (normal), and the optional `FAST_MODEL` / `PRO_MODEL`
from `process.env`, and applies the default role→category table below. With no
optional vars set, every role runs on `LLM_MODEL`.

```ts
import {
  createModelRuntimeFromEnv,
  createScaffoldedAgent,
} from "@deep-agent-template/core";

const modelRuntime = createModelRuntimeFromEnv();
const agent = createScaffoldedAgent({ modelRuntime });
```

The CLI and web app both use this factory. The CLI's `--model` flag (and a
`normalModel` option) override the normal tier; pass `profiles` to set
per-category options like `temperature` or `providerOptions`, and `assignments`
to override the default role→category mapping.

### Default role → category table

| Category | Roles |
|----------|-------|
| `fast`   | `clarifier`, *(task-scope guardrail classifier)* |
| `normal` | `baseline`, `researcher`, `image-designer`, `product-generator`, `coder` |
| `pro`    | `supervisor`, `analyst`, `reviewer`, `finalizer` |

`assignments.default` resolves to `normal`. The guardrail task-scope classifier
always uses the `fast` category (cheap structured-output classification).

Explicit `subagentOverrides.<role>.model` values still win over the runtime's
category resolution for a single specialist instance.

### `createModelRuntime(config)`

For full control — multiple connections, per-category tuning, or a custom
role→category mapping — build the runtime directly with `createModelRuntime`.
The config has three parts:

- `connections`: named provider endpoints. The supported provider is `openai-compatible`.
- `categories`: one `ModelProfileConfig` per category (`fast`, `normal`, `pro`). Each points at one connection and sets the concrete model id plus optional runtime settings like `temperature`, `maxTokens`, `maxRetries`, `timeout`, and `providerOptions`. All three categories are required; point several at the same model when no differentiation is desired.
- `assignments`: maps roles (and `default`) to categories. `assignments.default` falls back to `normal`.

```ts
import { createModelRuntime, createScaffoldedAgent } from "@deep-agent-template/core";

const modelRuntime = createModelRuntime({
  connections: {
    primary: {
      provider: "openai-compatible",
      apiKey: process.env.LLM_API_KEY,
      baseURL: "https://api.deepseek.com",
    },
  },
  categories: {
    fast: { connection: "primary", model: "deepseek-v4-flash", temperature: 0 },
    normal: { connection: "primary", model: "deepseek-v4-flash" },
    pro: { connection: "primary", model: "deepseek-v4-flash", maxTokens: 8192 },
  },
  assignments: {
    default: "normal",
    clarifier: "fast",
    reviewer: "pro",
  },
});

const agent = createScaffoldedAgent({ modelRuntime });

modelRuntime.getModelForCategory("fast");
modelRuntime.getCategoryForRole("reviewer"); // "pro"
modelRuntime.getModelForRole("researcher");
```

The returned runtime exposes:

- `getModelForCategory(category)`: returns the chat model for a category.
- `getCategoryForRole(role)`: resolves the role assignment (or `default`, then `normal`) to a category.
- `getModelForRole(role)`: `getModelForCategory(getCategoryForRole(role))`.
- `hasModelForRole(role)`: reports whether a role has an explicit assignment or a `default`.

Models are lazy and cached by category. The first lookup constructs the
underlying LangChain chat model; later lookups for the same category return the
same instance.

Validation happens when the runtime is created. It rejects empty connection
names, unknown providers, invalid OpenAI-compatible `baseURL` values, categories
that reference unknown connections, missing categories, assignments that
reference unknown categories, and assignments for unsupported roles.
`getModelForRole(role)` throws if the role is unsupported.

## Linkloom MCP research tools

Linkloom runs as a local stdio MCP server. Connect it before creating the scaffolded agent, pass the
loaded LangChain tools through `additionalResearcherTools`, and dispose of the connection when the
agent is no longer needed. The connection is an `AsyncDisposable`, so `await using` closes it
deterministically at the end of the enclosing scope:

```ts
import {
  connectLinkloomResearchTools,
  createModelRuntimeFromEnv,
  createScaffoldedAgent,
} from "@deep-agent-template/core";

const modelRuntime = createModelRuntimeFromEnv();
await using linkloom = await connectLinkloomResearchTools();
const agent = createScaffoldedAgent({
  modelRuntime,
  additionalResearcherTools: linkloom.tools,
});

const response = await agent.invoke({
  messages: [
    {
      role: "user",
      content: "Research the linked sources and return source-backed findings.",
    },
  ],
});
console.log(response);
// linkloom.close() runs automatically here when the scope exits.
```

You can also call `await linkloom.close()` explicitly (it is idempotent, so repeated calls are safe),
or keep the `try { ... } finally { await linkloom.close(); }` form. As a safety net, the connection
also registers a `FinalizationRegistry` that closes the underlying MCP client if the connection is
garbage-collected without an explicit disposal; finalizer delivery is best-effort per the JavaScript
spec, so prefer explicit disposal (`await using` or `close()`) whenever the connection has a clear
owner scope.

The helper resolves the installed `@boris.barac/linkloom` package and launches its MCP entry point
with Bun. It exposes `scrape`, `html_to_markdown`, `pdf_to_markdown`, `render_page`,
`extract_links`, and `extract_tables` only to the researcher. The existing `execute_python` tool
remains available.

The child process inherits the application's environment by default; any `env` passed to
`connectLinkloomResearchTools(...)` is merged on top of `process.env` rather than replacing it, so
inherited variables such as `HOME` and the LangSmith tracing variables still reach the server.
Linkloom supports `PAGE_LOAD_TIMEOUT`, `FRAME_TIMEOUT`, `PDF_DOWNLOAD_TIMEOUT`, and `PROXY_URL`; its
scraping tools do not require an API key. Pass `command`, `args`, `cwd`, `env`, restart settings, or
a tool timeout to `connectLinkloomResearchTools(...)` when the default process configuration is
unsuitable.

The Linkloom `scrape` and `render_page` tools drive a Camoufox browser engine, whose install location
`createAppConfig()` publishes to `process.env.CAMOUFOX_INSTALL_DIR` (default `~/.cache/camoufox`;
install it with `bun run setup`). `connectLinkloomResearchTools(...)` propagates that location to the
child: pass `camoufoxInstallDir` explicitly, or set `CAMOUFOX_INSTALL_DIR` in the environment, and the
value reaches the spawned server.

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

The scaffold loads `/memory/project-facts.md` and `/memory/user-preferences.md` by default. The default specialist subagents are intentionally isolated: they start with their own empty `tools` lists. Supplying `imageGenerationService` adds the default `image-designer` specialist with its image-generation tool; without that service, the specialist is omitted. Wire any additional specialist capabilities through `subagentOverrides` or fully custom `subagents`.

The default `clarifier` subagent is wired with the bundled `clarify-deeply` skill via `skills: ["/skills/clarify-deeply/"]`. Because the scaffold uses `StateBackend` by default, include `files: createDefaultSkillFiles()` in each `agent.invoke(...)` call so the skill file is present in the per-run state.

## Memory

`/memory` is the durable long-term memory root, backed by `StoreBackend` through `CompositeBackend`. Short-term state (`/scratch`, `/plans`, `/reports`, `/artifacts`) stays on `StateBackend` and is not durable. The memory module (`packages/core/src/memory`) makes the memory product contract explicit and testable.

V1 assumes a **single-user runtime**: each local agent or isolated server sandbox serves exactly one user and uses one stable single-user namespace.

Default durable memory files:

- `/memory/project-facts.md` — stable project and environment facts.
- `/memory/user-preferences.md` — explicit preferences the user asked to remember.

The allowed durable content is **explicit user preferences and stable project facts only**. The agent must not automatically persist inferred preferences, credentials, arbitrary observations, or transient task details. `reviewMemoryContent(...)` flags those categories, and the seed helpers ship wording that defines what belongs in each file.

Durable writes continue to use Deep Agents filesystem tools (`write_file` / `edit_file`) — there is no hidden side channel. In v1, writes to the writable single-user memory files are auto-approved (see `createSingleUserMemoryPolicy`), and the caller can opt into additional `interruptOn` rules explicitly when needed. `resolveMemoryInterrupts(...)` is an explicit passthrough so memory auto-approval never silently changes interrupt policy.

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

reviewMemoryContent("LLM_API_KEY=sk-...").allowed; // false
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

The scaffolded and baseline factories install two LangChain middleware guardrails by default. Pass
`guardrails: false` only when a caller explicitly needs to opt out:

- `ContentSafetyGuardrail` runs before the agent and classifies the latest user message with the configured model runtime, blocking requests the model flags as unsafe.
- `TaskScopeGuardrailMiddleware` runs before the agent and uses structured output to classify whether the request is inside the project task scope. The scaffolded and baseline factories default this classifier to the `fast` model category.

Task-scope policy is controlled by markdown files under `packages/core/guardrails/`. These files are
loaded by `DEFAULT_GUARDRAIL_POLICY_LOADER` and passed into `TaskScopeGuardrailMiddleware` before the
agent runs:

- `taskScope.requiredContext.md`
- `taskScope.allowedTasks.md`
- `taskScope.disallowedTasks.md`

The default runtime safety guardrail classifies user input with the fast-category model from the configured runtime, so it needs no credentials beyond `LLM_*`.

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

Or override one rail while keeping the other. The safety guardrail accepts a custom
classifier or a structured-output model; when omitted, it uses the fast-category runtime model:

```ts
const agent = createScaffoldedAgent({
  guardrails: {
    safety: {
      classifier: {
        invoke: async (input) => ({ flagged: false, categories: [], reason: "safe" }),
      },
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

Each question may optionally include 2-4 structured `options`. An option has a user-facing `label`,
a one-sentence `description`, and an optional `recommended` marker. At most one option may be
recommended. When the clarifier cannot generate useful choices, it omits `options` and asks the
question directly. Hosts should still allow free-text answers when options are present.

The default clarification policy is:

- `enabled: true`
- `mode: "mandatory-preflight"`
- `maxRounds: 2`
- `questionsPerRound: 3`

Both `maxRounds` and `questionsPerRound` are overridable through `clarificationOptions` (see the example below).

If the request is still unresolved at the round cap, the clarification state is forced to `ready_to_proceed` — the supervisor proceeds using the known context and clearly stated assumptions rather than blocking. An explicit `blocked` result before the cap still blocks.

The intended end-to-end intake loop is:

1. User sends a new request.
2. Supervisor delegates to the `clarifier`, which returns a structured `ClarificationResult`.
3. If `status` is `needs_clarification`, the supervisor relays `result.questions` to the user verbatim.
4. The user answers; the answers are recorded with `recordClarificationAnswers(...)` and folded into the intake with `applyClarificationResult(...)`.
5. The clarifier runs again until it returns `ready_to_proceed` (proceed to planning), or until the round cap forces `ready_to_proceed`. An explicit `blocked` result before the cap still blocks.

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

## Sandbox (Python execution)

The default researcher and analyst subagents receive an `execute_python` tool backed by Docker.
Pass `pythonSandboxBackend` to use another sandbox implementation:

```ts
const agent = createScaffoldedAgent({
  modelRuntime,
  pythonSandboxBackend: customSandboxBackend,
});
```

The `sandbox` module also exposes the tool definition for custom specialist stores:

```ts
import {
  createDefaultSpecialistRoleToolsets,
  createPythonSandboxToolDefinition,
  createSpecializedToolStore,
} from "@deep-agent-template/core";
import { createDockerSandboxBackend } from "@deep-agent-template/sandbox";

const definition = createPythonSandboxToolDefinition({
  backend: createDockerSandboxBackend(),
});

const store = createSpecializedToolStore({
  tools: [definition],
  roles: createDefaultSpecialistRoleToolsets(),
});
// researcher and analyst both resolve execute_python
// store.roleHasRestrictedTools("analyst") === true
```

The tool name is `execute_python` so callers can opt into an `interruptOn.execute_python` rule when they want approval prompts for Python execution. The `execute_python` name avoids colliding with the built-in `execute` (shell) tool reserved by `deepagents`'s `BUILTIN_TOOL_NAMES`. The definition carries `riskLevel: "restricted"` and `evidenceMode: "execution"`.

The backend is hidden behind the `SandboxBackend` interface from
`@deep-agent-template/sandbox` — swap Docker for a hosted sandbox (E2B,
Daytona, Vercel), Cloud Run Jobs, or any other runtime by implementing one
method. The shared `describeSandboxBackend()` test suite proves any new backend
honors the same contract. See the
[`@deep-agent-template/sandbox` README](../sandbox/README.md) for the full
design, security model, and the "Writing a new backend" checklist.

## Recommended next implementation steps

1. Replace placeholder specialist bundles with your real research, browser, code, or retrieval tools.
2. Provide a real `store` and keep `/memory` namespaced per user or thread family.
3. Add project skills under `/skills` and point subagents at narrower skill directories where appropriate.
4. Introduce task-specific response formats and evaluation fixtures once the main implementation starts.
