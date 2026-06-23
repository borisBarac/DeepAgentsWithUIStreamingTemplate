# responseFormat + Structured Output: Findings & Usage Notes

Technical notes from the response-format prototype at
`packages/core/prototype/response-format/`. Captures how structured output
works (and doesn't work) in this deepagents/langchain stack, the three
strategies available, why none of them is `json_object`, and the only path
that satisfies `json_object` + Zod + reasoning on DeepSeek.

---

## The question

Can we use `response_format: { type: "json_object" }` with a Zod schema and
`thinking: { type: "enabled" }` on `deepseek-v4-flash`?

### Must-haves

- `type: "json_object"` — JSON mode (not `json_schema`, not function calling)
- Zod schema for parsing and validation
- Reasoning enabled

---

## How `responseFormat` actually works in this stack

`responseFormat` is a field on both `CreateDeepAgentParams` (deepagents) and
`CreateBaselineAgentOptions` (this repo's Pick at
`packages/core/src/agent/types.ts:17`). It flows through:

```
createBaselineAgent({ responseFormat })
  → createDeepAgent({ responseFormat })
    → langchain AgentNode.#getResponseFormat()
      → transformResponseFormat(responseFormat, model)
```

`transformResponseFormat` (`langchain/dist/agents/responses.js:155-188`)
converts the `responseFormat` value into one of two strategy objects:

```js
const useProviderStrategy = hasSupportForJsonSchemaOutput(model);
//                                                         ↑
// Checks model.profile.structuredOutput === true
// ChatOpenAI with unknown model (deepseek-v4-flash) → false

if (isInteropZodObject(responseFormat))
  return useProviderStrategy
    ? [ProviderStrategy.fromSchema(responseFormat)]   // ← native json_schema
    : [ToolStrategy.fromSchema(responseFormat)];       // ← function calling
```

### The two strategies

| Strategy | How it works | API parameter | Selected when |
|---|---|---|---|
| **ProviderStrategy** | Native provider JSON output | `response_format: { type: "json_schema", json_schema: {...} }` | `model.profile.structuredOutput === true` OR explicitly via `providerStrategy(schema)` |
| **ToolStrategy** | Function calling (model calls a tool with structured args) | `tools: [...]`, `tool_choice: "any"` | Default for unknown models |

**Neither strategy uses `response_format: { type: "json_object" }`.**

The `json_object` mode is only accessible via
`model.withStructuredOutput(schema, { method: "jsonMode" })` — but the
AgentNode path doesn't call `withStructuredOutput`. It binds strategies
directly via `#bindTools` (`AgentNode.js:450-513`).

### The `{ schema, method }` wrapper is rejected

langgraph's older `createAgent` accepts
`responseFormat: { schema, method: "jsonMode" }` via
`StructuredResponseSchemaOptions`. But deepagents uses langchain's newer
`AgentNode`, which calls `transformResponseFormat` — and that function only
accepts:

- Bare Zod schema (InteropZodObject)
- Bare JSON schema object (must have `properties` key at top level)
- `ToolStrategy` or `ProviderStrategy` instance
- Arrays of any of the above

An object with `{ schema, method }` hits the fallthrough:
```
throw new Error(`Invalid response format: ${String(responseFormat)}`);
```

---

## The three attempts (iteration log)

### Attempt 1: `{ schema, method: "jsonMode" }` via `responseFormat` → FAIL

```
error: Invalid response format: [object Object]
  at transformResponseFormat (langchain/dist/agents/responses.js:188)
```

The `{ schema, method }` shape is langgraph's `StructuredResponseSchemaOptions`
type (with an index signature `[key: string]: unknown` that lets `method`
through at compile time). But at runtime, langchain's
`transformResponseFormat` doesn't recognize the wrapper — it checks for
`isInteropZodObject` (no), then `"properties" in responseFormat` (no), then
throws.

### Attempt 2: Bare Zod schema via `responseFormat` → FAIL

```
error: 400 Thinking mode does not support this tool_choice
```

A bare Zod schema auto-selects `ToolStrategy` because
`hasSupportForJsonSchemaOutput(model)` returns `false` for ChatOpenAI with an
unknown model name. `ToolStrategy` creates a function-calling tool from the
schema and `#bindTools` sets `tool_choice: "any"` (`AgentNode.js:461`):

```js
const toolChoice = structuredTools.length > 0 ? "any" : void 0;
```

DeepSeek's thinking mode rejects `tool_choice` entirely — **function calling
and thinking are mutually exclusive on DeepSeek**.

### Attempt 3: `response_format` on the model directly → PASS

Set `responseFormat: { type: "json_object" }` in the ChatOpenAI constructor
via `providerOptions`, inject the Zod schema into the prompt, and parse the
JSON output manually.

```
{"type":"result","status":"done","sawReasoning":false,"sawText":true,
 "finalText":"{\"reasoning\":\"15% means 15 per 100...\",\"answer\":\"36\",\"confidence\":1.0}",
 "parsed":{"reasoning":"...","answer":"36","confidence":1},
 "schemaValidation":{"ok":true}}
```

- ✅ DeepSeek accepted `json_object` alongside `thinking: enabled` (no 400)
- ✅ Model returned valid JSON
- ✅ Zod schema validation passed
- ⚠️ No `reasoning-delta` events (pre-existing gap — see below)

---

## The working pattern

```ts
const modelRuntime = createModelRuntime({
  connections: {
    default: { provider: "openai-compatible", apiKey, baseURL },
  },
  models: {
    default: {
      connection: "default",
      model: MODEL_ID,
      providerOptions: {
        modelKwargs: { thinking: { type: "enabled" } },
        responseFormat: { type: "json_object" },  // ← on the MODEL, not the agent
      },
    },
  },
  assignments: { default: "default" },
});

const agent = createBaselineAgent({
  modelRuntime,
  guardrails: false,
  tools: [],
  // NO responseFormat here — it would trigger ToolStrategy/ProviderStrategy
});

// Inject schema into the prompt
const fullPrompt = `${prompt}\n\n${SCHEMA_INSTRUCTIONS}`;

// ... run the agent ...

// Parse and validate manually
const parsed = answerSchema.safeParse(JSON.parse(finalText));
```

### How `providerOptions` flows to the API

`createRuntimeModel` at `packages/core/src/models/runtime.ts:23-30`:

```ts
const commonOptions = {
  ...profile.providerOptions,   // ← responseFormat spreads here
  model: profile.model,
};
return new ChatOpenAI({
  ...connection.options,
  ...commonOptions,              // ← lands in ChatOpenAI constructor
  apiKey: connection.apiKey,
  useResponsesApi: false,
  configuration: { baseURL },
});
```

`responseFormat` is a standard `ChatOpenAI` constructor field. It maps to the
`response_format` parameter in every API request body. `modelKwargs` is also a
standard `ChatOpenAI` field that spreads its contents into the request body
(how `thinking` reaches the API).

### Trade-offs

- `response_format: { type: "json_object" }` applies to **every** model call,
  not just a final structured-output step. Every API call must return JSON.
- The schema is enforced by the prompt, not the API. The model could return
  valid JSON that doesn't match the schema. Always validate with Zod.
- There is no `structuredResponse` on the final state (that's only populated
  by `ProviderStrategy`/`ToolStrategy` via the AgentNode). Parse `finalState.messages`
  text manually.

---

## The reasoning-delta gap

No `reasoning-delta` events appear in the stream — confirmed by a control test
without `response_format`:

```
Without json_object:  sawReasoning: false
With json_object:     sawReasoning: false
```

The gap is **pre-existing and unrelated to `json_object`**. This was flagged
as pending in the a2ui-transformer prototype NOTES.md and is now confirmed by
a live run.

### Likely causes (not yet isolated)

1. **DeepSeek streaming format**: `deepseek-reasoner` puts reasoning in a
   separate `reasoning_content` field on the streaming delta. langchain's
   `ChatOpenAI` may not map `reasoning_content` → `reasoning-delta` events.
   The `content-block-delta` / `reasoning-delta` event taxonomy may be
   Anthropic-specific.

2. **Model identity**: `deepseek-v4-flash` may not be a reasoning model. The
   `thinking: { type: "enabled" }` parameter might be silently ignored. DeepSeek's
   native reasoning model is `deepseek-reasoner` — it produces reasoning without
   a `thinking` parameter.

3. **`thinking` parameter not recognized**: DeepSeek's API docs don't list a
   `thinking` parameter. It may be a convention from OpenRouter or another proxy
   that this endpoint doesn't implement.

### What would resolve this

- Try `model: "deepseek-reasoner"` instead of `deepseek-v4-flash` and observe
  whether `reasoning_content` arrives in the stream
- Intercept the raw HTTP response to check if `reasoning_content` exists in
  the SSE delta but isn't surfaced by langchain
- Check if langchain's `ChatOpenAI` has a mapping for DeepSeek's
  `reasoning_content` field

---

## `json_object` vs `json_schema` vs function calling

| | `json_object` (this approach) | `json_schema` (ProviderStrategy) | Function calling (ToolStrategy) |
|---|---|---|---|
| API parameter | `response_format: { type: "json_object" }` | `response_format: { type: "json_schema", json_schema: {...} }` | `tools: [...]`, `tool_choice: "any"` |
| Schema enforcement | Prompt-injected (best-effort) | API-level (grammar constraint) | API-level (function args validated) |
| Works with thinking? | ✅ DeepSeek accepts | Unknown (untested) | ❌ 400 error |
| `structuredResponse` on state? | ❌ Manual parse | ✅ Auto | ✅ Auto |
| Schema in every call? | ✅ Every call is JSON | Only final structured call | Only final structured call |
| Available via `responseFormat`? | ❌ Set on model | ✅ `providerStrategy(schema)` | ✅ bare Zod schema (default) |

---

## Comparison with `streamTransformers`

These are **orthogonal** — see `PRD/streamtransformers-notes.md`:

- `streamTransformers` observes and projects events (read-only, no model constraint)
- `responseFormat` / `response_format` constrains the model's output shape

They compose: set `response_format: { type: "json_object" }` on the model for
guaranteed JSON output, AND use `streamTransformers` to project the streaming
events into a secondary channel. The json_object constraint doesn't interfere
with the stream transformer's `process()` — it just means the text deltas will
be JSON fragments instead of free text.

---

## Streaming incremental JSON objects

The prototype at `packages/core/prototype/response-format/run.ts` was extended
to generate an array of 3 JSON objects and emit each one **the moment it
completes** in the model's streaming text output — before the model has
finished generating the rest.

### The problem

`response_format: { type: "json_object" }` guarantees the model's full output
is valid JSON. But during streaming, the text arrives token-by-token via
`text-delta` events. The accumulated buffer is always **partial JSON** — you
can't `JSON.parse()` it until the model is done. If you wait for the end,
you lose the latency benefit of streaming.

### The solution: bracket-depth scanning

A ~40-line scanner (`extractCompleteArrayObjects`) finds complete `{...}`
objects inside the first `[...]` array in the buffer, after each text delta:

```ts
function extractCompleteArrayObjects(buffer: string): unknown[] {
  const result: unknown[] = [];
  const arrStart = buffer.indexOf("[");
  if (arrStart === -1) return result;

  let i = arrStart + 1;
  while (i < buffer.length) {
    // Skip whitespace/commas between elements
    if (/[\s,]/.test(buffer[i])) { i++; continue; }
    if (buffer[i] !== "{") { i++; continue; }

    // Track brace depth + string/escape state
    let depth = 0, inStr = false, escaped = false, end = -1;
    for (let j = i; j < buffer.length; j++) {
      const c = buffer[j];
      if (escaped) { escaped = false; continue; }
      if (c === "\\" && inStr) { escaped = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === "{") depth++;
      else if (c === "}" && --depth === 0) { end = j; break; }
    }
    if (end === -1) break; // Object not yet complete

    try { result.push(JSON.parse(buffer.slice(i, end + 1))); } catch {}
    i = end + 1;
  }
  return result;
}
```

Key properties:
- **String-aware**: Brackets inside JSON string values don't affect depth
  counting (the `inStr` flag toggles on unescaped `"`, and `escaped` handles
  `\"`)
- **Nested-brace-aware**: Objects inside objects (e.g., `{"meta": {...}}`)
  don't false-complete at the inner `}`
- **Incomplete-safe**: If the buffer ends mid-object, the scanner stops and
  returns only completed objects
- **No dependencies**: Pure string scanning, no streaming JSON parser library

### The streaming loop

```ts
let textBuffer = "";
let emittedCount = 0;

for await (const msg of run.messages) {
  for await (const ev of msg) {
    if (ev.event !== "content-block-delta") continue;
    if (ev.delta.type === "text-delta") {
      textBuffer += ev.delta.text;

      const currentObjects = extractCompleteArrayObjects(textBuffer);
      while (emittedCount < currentObjects.length) {
        const obj = currentObjects[emittedCount];
        const validation = itemSchema.safeParse(obj);
        emit({ type: "object", index: emittedCount, data: obj, validation });
        emittedCount++;
      }
    }
  }
}
```

After each `text-delta`, the scanner re-runs on the full buffer. If it finds
more complete objects than last time, the new ones are emitted immediately.

### Why a wrapper object, not a bare array

`json_object` mode requires the top-level to be a JSON object (OpenAI/DeepSeek
convention). The model returns:

```json
{
  "answers": [
    { "approach": "...", "reasoning": "...", "answer": "...", "confidence": 0.9 },
    { ... },
    { ... }
  ]
}
```

The scanner finds the first `[` (the `answers` array) and then tracks objects
inside it. The outer `{"answers": ...}` wrapper is invisible to the scanner
because it only looks inside arrays.

### Live result

Prompt: *"Give me 3 different ways to calculate 15% of 240"*

```
{"type":"object","index":0,"data":{"approach":"Direct decimal multiplication","reasoning":"Convert 15% to 0.15...","answer":"36","confidence":1},"validation":{"ok":true}}
{"type":"object","index":1,"data":{"approach":"10% + 5% breakdown","reasoning":"10% of 240 = 24...","answer":"36","confidence":1},"validation":{"ok":true}}
{"type":"object","index":2,"data":{"approach":"Fraction simplification","reasoning":"15/100 = 3/20...","answer":"36","confidence":1},"validation":{"ok":true}}
```

Each `{"type":"object"}` line is emitted the moment that object's closing `}`
arrives in the stream — before the model finishes the rest of the response.

### Performance note

The scanner re-scans the full buffer after each delta. For 3 small objects
this is negligible. For large arrays (hundreds of objects), consider:
- Caching the scan position (resume from where the last complete object ended)
- Using a proper streaming JSON parser (`clarinet`, `stream-json`)

The naive approach is fine for typical agent UI use cases (3–20 objects).

### Composition with `streamTransformers`

This incremental-object technique is complementary to `streamTransformers`
(see `PRD/streamtransformers-notes.md`). Two possible integration patterns:

1. **Scanner in the transformer's `process()`**: Each `text-delta` event
   passes through `process()`. The transformer accumulates text, runs the
   scanner, and pushes completed objects to a `StreamChannel.remote("objects")`.
   Clients subscribe via `custom:objects` SSE events.

2. **Scanner in the client**: The transformer just forwards raw `text-delta`
   events to a channel, and each client runs the scanner locally. This keeps
   the server stateless but duplicates parsing work per client.

Pattern 1 is better for SSE/remote clients (one parse on the server, many
subscribers). Pattern 2 is better for in-process consumers (no channel overhead).

---

## References

- Prototype: `packages/core/prototype/response-format/run.ts` (working version)
- Prototype findings: `packages/core/prototype/response-format/NOTES.md`
- transformResponseFormat: `node_modules/.bun/langchain@1.4.5+.../langchain/dist/agents/responses.js:155-188`
- AgentNode.#bindTools (strategy → API params): `node_modules/.bun/langchain@1.4.5+.../langchain/dist/agents/nodes/AgentNode.js:450-513`
- hasSupportForJsonSchemaOutput: `responses.js:264-267`
- ProviderStrategy.parse (thinking-model aware JSON parsing): `responses.js:110-133`
- ToolStrategy (function calling): `responses.js:27-80`
- Model runtime (providerOptions spread): `packages/core/src/models/runtime.ts:23-30`
- DeepAgentScaffoldOptions Pick: `packages/core/src/agent/types.ts:9-23`
- Existing Zod schema pattern (clarifier): `packages/core/src/clarification/types.ts:112-121`
- Existing subagent responseFormat usage: `packages/core/src/scaffold/subagents.ts:51,89,103`
- streamTransformers notes: `PRD/streamtransformers-notes.md`
