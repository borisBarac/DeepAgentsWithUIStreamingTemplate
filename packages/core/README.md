# Core

Minimal Deep Agents scaffolding for the template.

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
import { createBasicAgent } from "@deep-agent-template/core";

const agent = createBasicAgent();

const result = await agent.invoke({
  messages: [{ role: "user", content: "Create a short plan for the project." }],
});
```

`createBasicAgent` uses Deep Agents defaults, including built-in planning, filesystem, and task delegation tools. Custom tools can be passed later through the `tools` option.
