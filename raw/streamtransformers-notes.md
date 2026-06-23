# Stream Transformers: Findings & Usage Notes

Technical notes from the `streamTransformers` prototype at
`packages/core/prototype/a2ui-transformer/`. Captures what the mechanism is,
how the prototype uses it, what the smoke test revealed, and the type-seam bug
that affects any real integration through `createBaselineAgent`.

---

## What `streamTransformers` is

`streamTransformers` is an optional field on `createDeepAgent(params)` that
registers custom **stream projections** with the underlying LangGraph run. It
is the extension point that lets a caller observe the agent's internal event
stream and derive secondary, typed outputs — exposed on
`run.extensions.<key>` when consuming the agent via
`agent.streamEvents(state, { version: "v3" })`.

- Declared at `node_modules/deepagents/dist/index.d.ts:3159-3166`.
- Threaded through this repo's `DeepAgentScaffoldOptions` Pick at
  `packages/core/src/agent/types.ts:20` (so `createBaselineAgent` accepts and
  forwards it at runtime).
- Consumes the v3 `DeepAgentRunStream` whose `run.extensions` getter is the
  merged intersection of every registered transformer's projection
  (`InferDeepAgentStreamExtensions`, `@langchain/langgraph/dist/stream/types.d.ts:56`).

The deepagents docstring at `index.d.ts:222-235` literally spells out the A2UI
use case: extension transformers emit on application-chosen method names
(e.g. `emit("a2a", data)`) and are accessible to remote clients via
`session.subscribe("custom:<name>")`.

---

## The `StreamTransformer` contract

From `@langchain/langgraph/dist/stream/types.d.ts:83-137`. Two required
methods, three optional:

```ts
interface StreamTransformer<TProjection = unknown> {
  // Called once before the run. Returns the projection merged into
  // run.extensions. Any StreamChannel instances in the return are auto-wired
  // by the mux.
  init(): TProjection;

  // Called for every ProtocolEvent before it is appended to the main log.
  // Return false to drop the original event (use sparingly).
  process(event: ProtocolEvent): boolean;

  // Optional hooks:
  onRegister?(emitter: StreamEmitter): void;  // synthetic event injection
  finalize?(): void | PromiseLike<void>;       // non-channel teardown
  fail?(err: unknown): void;                   // non-channel teardown
}
```

The `ProtocolEvent` shape (`types.d.ts:26-49`):

```ts
{
  type: "event",
  seq: number,              // monotonic within a channel, NOT globally unique
  method: string,           // "messages" | "values" | "updates" | "lifecycle" | "tasks" | "checkpoints" | "custom:<name>" | ...
  params: {
    namespace: string[],
    timestamp: number,
    node?: string,          // graph node id when attributable
    data: unknown,          // channel-specific payload
  }
}
```

---

## The `StreamChannel` primitive

From `@langchain/langgraph/dist/stream/stream-channel.d.ts`. This is what
`init()` returns and what `run.extensions.<key>` exposes.

```ts
class StreamChannel<T> implements AsyncIterable<T> {
  static local<T>(): StreamChannel<T>;          // in-process only
  static remote<T>(name: string): StreamChannel<T>; // also forwarded as custom:<name> SSE events
  push(item: T): void;                           // append
  iterate(startAt?): AsyncIterator<T>;           // independent cursor per consumer
  toEventStream(options?): ReadableStream<Uint8Array>; // literal SSE byte stream
  close(): void;
  fail(err): void;
  get size(): number;
  get done(): boolean;
}
```

Key behaviors learned:
- `StreamChannel.remote(name)` is the right choice for anything a future
  SSE/WebSocket consumer needs — the mux auto-forwards each `push()` as a
  `custom:<name>` protocol event. `local()` stays in-process.
- Lifecycle (`close`/`fail`) is managed by the mux automatically when the run
  completes or errors. Transformers do not need to call them.
- The channel is created **once** (in the transformer factory closure) and
  shared between `init()` (which returns it) and `process()` (which pushes to
  it). See the prototype pattern below.

---

## How the prototype uses it (the tick pattern)

The portable module: `packages/core/prototype/a2ui-transformer/tick-transformer.ts`.

The clean pattern is a **factory closure** that creates the channel once so
`init()` can return it and `process()` can push to the same instance:

```ts
export function createTickTransformer(): TickTransformer {
  const channel = StreamChannel.remote<Tick>("a2ui");
  const counts: TickCounts = { observed: 0, byMethod: {} };

  return {
    counts,                              // exposed for the runner to read
    init() { return { a2ui: channel }; },
    process(event: ProtocolEvent): boolean {
      counts.observed += 1;
      counts.byMethod[event.method] =
        (counts.byMethod[event.method] ?? 0) + 1;
      channel.push({ seq: event.seq, method: event.method, ... });
      return true;                        // keep the original event visible
    },
  };
}
```

The runner (`run.ts`) wires it through the existing option seam:

```ts
const agent = createBaselineAgent({
  modelRuntime,
  guardrails: false,
  streamTransformers: [() => transformer],  // factory array
});

const run = await agent.streamEvents(
  { messages: [{ role: "user", content: prompt }] },
  { version: "v3" },                        // ONLY shape that returns .extensions
);

// Concurrently drain two views of the same underlying stream:
for await (const msg of run.messages) { ... }          // high-level reassembled
for await (const tick of run.extensions.a2ui) { ... }  // our projection
```

The transformer is registered as `[() => transformer]` — a factory array. The
mux calls each factory **once per run** to produce a fresh transformer
instance, so the channel lifecycle is naturally scoped to one run.

---

## What the smoke test revealed

A boot test with a deliberately-bad `LLM_BASE_URL` (no real model call)
confirmed the mechanism end-to-end before any tokens were spent:

| Question | Result |
|---|---|
| Does `streamTransformers` wire through `createBaselineAgent`? | Yes — no runtime error, transformer registered. |
| Does `process()` observe `ProtocolEvent`s? | Yes — 16 events observed before the network died. |
| Do ticks pushed in `process()` arrive at `run.extensions.a2ui`? | Yes — in order, in lockstep. |

**Event taxonomy observed pre-model-call** (in `counts.byMethod`):

```
lifecycle, checkpoints, values, tasks, updates
```

Notably absent without a real model run: `messages` (only emitted when the chat
model streams tokens) and any tool/`tasks`-with-payload events. Confirming
`reasoning-delta` arrival under `thinking: { type: "enabled" }` still requires
a live deepseek-v4-flash call — see the prototype's `NOTES.md` placeholders.

**Surprise:** `ProtocolEvent.seq` is **per-channel/per-namespace**, not a
single global counter. The prototype observed `seq` resetting to 0 across
different channels. Any consumer that relies on a globally monotonic sequence
must synthesize its own counter (the prototype does this for the raw-events
view).

---

## Type-seam finding (confirmed bug)

`DeepAgentScaffoldOptions` in `packages/core/src/agent/types.ts:9-23` Picks
`streamTransformers` from `CreateDeepAgentParams`:

```ts
type DeepAgentScaffoldOptions = Pick<
  CreateDeepAgentParams,
  | "backend" | "checkpointer" | "interruptOn" | "memory" | "middleware"
  | "permissions" | "responseFormat" | "skills" | "store"
  | "streamTransformers"   // <- here
  | "subagents" | "tools"
>;
```

The problem: `CreateDeepAgentParams` is generic over
`TStreamTransformers extends ... = readonly []`. The `Pick` captures
`TStreamTransformers` at its **default `readonly []`** (an empty tuple type).
Result: passing any non-empty `streamTransformers` array fails typecheck:

```
Type '() => TickTransformer' is not assignable to type 'undefined'.
```

even though `createBaselineAgent` forwards the option correctly at runtime
(`packages/core/src/agent/baseline.ts:35-42` spreads `...agentOptions` into
`createDeepAgent`).

The prototype works around this with a cast
(`streamTransformers: [...] as unknown as []`). A real integration has two
options:

1. **Add a generic to `CreateBaselineAgentOptions` / `createBaselineAgent`** so
   `TStreamTransformers` flows through to the return type. This also fixes the
   return type: today `createBaselineAgent` is annotated `: DeepAgent` (no
   generic params), so even with a working option type, `run.extensions` would
   be typed as `Record<string, never>`. Both the option and the return need the
   generic.
2. **Call `createDeepAgent` directly**, sidestepping the narrowed option type.
   This is the PRD's "acceptable fallback"
   (`raw/a2ui-main-deepagent-prd.md:168`). It also preserves full type
   inference for `run.extensions`.

Option 2 is lower-effort for v1; option 1 is the cleaner long-term fix if A2UI
becomes a first-class path through `createBaselineAgent`.

---

## Implications for A2UI

The prototype validates that `streamTransformers` is a **viable, low-ceremony
seam** for the A2UI projection approach (option iii in the architecture
discussion):

- `process()` sees every event the agent emits — text deltas, reasoning
  deltas, tool calls, state updates, lifecycle. Nothing is hidden.
- `StreamChannel.remote("a2ui")` gives both in-process consumption
  (`run.extensions.a2ui`) and automatic SSE forwarding (`custom:a2ui`) for
  free — the React shell could subscribe to either.
- The transformer is pure TypeScript on the server; the agent's prompt and
  tool surface stay unchanged. A2UI layout intelligence lives in the
  projection, not the model.

Trade-offs to revisit before committing (these are design questions, not
mechanism questions — the mechanism works):

- The projection must **synthesize** A2UI messages from raw events. Mapping
  `reasoning-delta` → `updateDataModel /reasoning` is trivial; mapping a tool
  call result into a `createSurface` + list component requires knowing the
  tool taxonomy. If tools drift, the projection breaks silently.
- The model cannot *decide* "now show a form, now show a confirmation" — that
  decision is encoded in fixed projection code. For multi-step UI flows
  (search → booking → confirmation), tool-call-driven emission (option i) may
  fit better because the model drives the layout.
- For v1 A2UI where the agent should *drive* the UI, the `restaurant_finder`-
  style tool-call approach remains the better default. Keep
  `streamTransformers` as the projection path for cases where the server
  should own the mapping (e.g. mirroring agent behavior into a dashboard
  without re-prompting).

---

## References

- Contract: `packages/core/node_modules/@langchain/langgraph/dist/stream/types.d.ts:83-137`
- Channel: `packages/core/node_modules/@langchain/langgraph/dist/stream/stream-channel.d.ts:58-126`
- deepagents param: `packages/core/node_modules/deepagents/dist/index.d.ts:3159-3166`
- deepagents v3 stream: `packages/core/node_modules/deepagents/dist/index.d.ts:2920-2981`
- This repo's option Pick: `packages/core/src/agent/types.ts:9-23`
- Forwarding (runtime-works, type-narrowed): `packages/core/src/agent/baseline.ts:35-42`
- Prototype (portable logic): `packages/core/prototype/a2ui-transformer/tick-transformer.ts`
- Prototype (runner): `packages/core/prototype/a2ui-transformer/run.ts`
- Prototype verdict: `packages/core/prototype/a2ui-transformer/NOTES.md`
- Tracker issue: `DeepAgentTemplate-njp`
