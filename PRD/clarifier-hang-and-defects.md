# Clarifier Hang and Web-App Defects

Beads issue: `DeepAgentTemplate-ed6a` (closed; fix landed)
Follow-ups: `DeepAgentTemplate-yliq` (streaming timeout), `DeepAgentTemplate-ft8u` (D3 message rehydration), `DeepAgentTemplate-7ehq` (E2E test coverage)

## Summary

Fix the blocker hang that locks the UI in the "Processing" state after the
Clarifier subagent returns `needs_clarification`, plus two lower-priority
defects observed in the live exercise report (2026-07-27): reload discards
the conversation, and `instrumentation.ts` emits misleading Edge-Runtime
warnings on every compile.

## Root cause (D1, blocker)

`routeSubagentDelegation` (`packages/core/src/workflow/runtime.ts`) has no
guard against re-delegating to a subagent that already completed the current
phase. When the main agent re-delegates to the clarifier instead of calling
`workflow_submit_clarification` (a soft prompt instruction only):

- The clarifier runs again and returns the same prose.
- `subagent_completed` is idempotent in the reducer; no phase change.
- `controllerRetryCount` is never ticked — it only ticks on `wrong_subagent`
  or `subagent_returned_json` paths, neither of which fires for valid prose.
- The main agent's tool-call loop never terminates, so LangGraph's `StreamMux`
  never calls `close()`/`fail()`, `run.output` never settles, the NDJSON body
  iterator in `app/api/agent/route.ts` stays open, and the client's `loading`
  flag never clears.

No exception is thrown server-side; recovery requires a page reload. The
duplicate Clarifier activity entries (D2) are the same bug: each re-delegation
spawns a fresh subagent run with a new `subagentRunId` and identical text.

The streaming proxy in `agent/runtime.ts` and the `Promise.allSettled` plumbing
in `interaction-stream/streaming.ts` are exonerated by git history
(`ebac482` removed the only async hang vector; `152810f` introduced
`await subagent.output`, unchanged since). The bug is purely the missing guard.

## Implementation

### Fix 1 — D1 loop guard (also resolves D2)

In `packages/core/src/workflow/runtime.ts`, `routeSubagentDelegation`, add a
branch before the `subagent === expected` happy path that detects re-delegation
to the already-completed required subagent and ticks the controller budget via
the existing helper:

```ts
if (subagent === expected && state.completedSubagent === expected) {
  const feedbackText = buildControllerFeedback(
    state,
    "subagent_already_completed",
    `The ${expected} subagent has already returned its result this phase. Do not re-delegate — call the corresponding workflow_submit_* tool with its output, or finalize if the phase is terminal.`,
  );
  return deps.tickControllerBudget(state, feedbackText, request, expected);
}
```

This routes the failure into the existing bounded retry path:

- Each re-delegation increments `controllerRetryCount`.
- After `retryLimit` (default 4), the reducer sets `phase: "error"` with a
  `terminalError`.
- `runAfterModel` throws `WorkflowRuntimeError`, whose message is translated
  by `USER_FACING_WORKFLOW_ERRORS` in `runtime-helpers.ts`.
- The environment's `#execute` catch translates the throw into an `error`
  UiUpdate and closes the stream; the client `finally` clears `loading` and
  re-enables the composer.

No new tests in this pass. Existing tests `bounds repeated JSON rejections by
the controller retry limit` and `bounds repeated wrong-subagent delegations`
(`runtime.test.ts`) cover the same helper being routed into.

### Fix 2 — D3 reload persistence (sessionId only)

In `packages/web-app/src/ui/use-agent-chat.ts`:

- Replace the bare `useRef<string>(createId())` for `sessionIdRef` with one
  that reads from `localStorage` on the client and writes back on mount.
- Use a stable storage key (e.g. `"dat.session-id"`), gated by
  `typeof window !== "undefined"` for SSR safety.

Server-side, `InMemorySessionStore.loadSession` already keeps per-session
history for the lifetime of the process, so a reloaded client resumes the same
agent thread even before any client-side message replay is wired.

Out of scope: client-side replay of the visible message list and UI specs on
reload. That requires either a new `GET /api/session/:id` endpoint or full
client-state snapshotting. Will be filed as a separate beads issue.

### Fix 3 — D4 Edge-Runtime warning noise

The current `instrumentation.ts` already guards `process.on(...)` behind
`process.env.NEXT_RUNTIME !== "nodejs"` at runtime, but Turbopack statically
analyzes the whole module when bundling for Edge and emits both
`A Node.js API is used (process.on …)` and a misleading
`Ecmascript file had an error` line.

Move the `process.on` registrations into a Node-only module that is reached
only via dynamic `import()` after the runtime guard:

- `packages/web-app/instrumentation.ts`: keep the runtime check; replace the
  inline listener registration with a dynamic
  `await import("./src/server/telemetry/shutdown.ts")` and call
  `registerShutdownHandlers()`.
- `packages/web-app/src/server/telemetry/shutdown.ts` (new): owns
  `registerShutdownHandlers()` which attaches the SIGTERM/SIGINT listeners
  that flush telemetry via `shutdownTelemetry()`.

The Edge bundler sees only the dynamic `import()` inside the runtime guard and
never analyzes the `process.on` references.

## Verification

1. `bun run web-app`, click any prompt starter, click Send.
2. Happy path: a clarifying question renders as interactive UI.
3. Failure path: instead of hanging for 10+ minutes, the composer recovers
   within `retryLimit × model-round-trip` seconds with an error UiUpdate.
4. Reload the page; `localStorage.getItem("dat.session-id")` returns the same
   value and the server resumes the same thread.
5. Dev log on next compile no longer prints the `process.on` Edge warning or
   the misleading `Ecmascript file had an error` line for `instrumentation.ts`.
6. Quality gates from `AGENTS.md`:
   - `bun test`
   - `bun run typecheck`
   - `bun run check`
   - `bun run --filter @deep-agent-template/web-app build`

## Execution order

Fix 1 (D1, blocker) → Fix 3 (D4, trivial) → Fix 2 (D3, small) → quality gates.

## Out of scope

Filed as beads follow-ups rather than implemented in this pass:

- **Vector B streaming timeout.** Add an idle/overall timeout around
  `Promise.allSettled([run.output, drainMessages(), drainSubagents()])` in
  `interaction-stream/streaming.ts` so any future class of "subagent.output
  never settles" surfaces as an error UiUpdate instead of locking the UI.
- **D3 message rehydration.** Replay the visible message list and UI specs on
  reload (requires a session-fetch endpoint or client-state snapshotting).
- **End-to-end test coverage** for the clarifier-prose → `workflow_submit_
  clarification` → `drainPendingUi` → question UiUpdate path (currently
  uncovered).
- **Architectural auto-advance.** Have the controller itself parse and
  validate the clarifier prose to eliminate the "LLM forgot to advance state"
  class of bugs entirely. Substantial refactor; deferred.
