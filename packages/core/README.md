# Core

Implementation-ready Deep Agents scaffolding for the template.

The default export path is intentionally a scaffold, not a finished product. It gives you the recommended supervisor-oriented shape from the architecture report without hard-coding your real tools, stores, or task-specific logic.

## What is scaffolded

- A supervisor-first agent factory: `createScaffoldedAgent` and `createBasicAgent`
- Three default specialist subagents: `researcher`, `analyst`, `critic`
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

## Recommended next implementation steps

1. Replace placeholder specialist toolsets with your real research, browser, code, or retrieval tools.
2. Provide a real `store` and keep `/memory` namespaced per user or thread family.
3. Add project skills under `/skills` and point subagents at narrower skill directories where appropriate.
4. Introduce task-specific response formats and evaluation fixtures once the main implementation starts.
