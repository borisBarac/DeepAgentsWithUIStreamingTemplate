# PRD: Connect A2UI to the Main DeepAgent Only

## Summary

This PRD defines how to add A2UI support to this repository so the **top-level DeepAgent** can generate and drive structured UI in a React client.

The design is intentionally **single-agent**:

- A2UI is produced by the **main DeepAgent only**
- subagents do **not** emit A2UI
- the client does **not** connect to specialist subagents
- all A2UI actions route back to the **same main agent session**

This is based on the A2UI `restaurant_finder` integration pattern documented in [raw/a2ui-react-integration.md](/Users/boris/Documents/dev/DeepAgentTemplate/raw/a2ui-react-integration.md), adapted to the current DeepAgent template architecture in this repo.

## Problem

The current repo has DeepAgent scaffolding, but no UI protocol layer that lets the agent return safe, interactive UI surfaces to a React client.

Today:

- the repo exposes agent factories in `packages/core`
- the default path is supervisor-oriented via `createScaffoldedAgent` / `createBasicAgent`
- there is no React shell for A2UI rendering
- there is no transport layer for streaming A2UI messages between a browser and the agent

We need a productized path where:

1. a React app sends user messages to the main DeepAgent
2. the main DeepAgent can return A2UI v0.9 messages
3. the React app renders those messages safely
4. user actions on rendered UI are sent back to the same main DeepAgent

## Why Main-Agent-Only

The repo currently recommends a supervisor plus specialist subagents architecture, but that is the wrong initial boundary for A2UI here.

Reasons:

1. A2UI is a user-facing contract, so ownership should stay with the main agent.
2. Allowing subagents to emit user-visible surfaces adds orchestration, routing, and trust complexity too early.
3. A single-agent A2UI boundary is easier to test, easier to reason about, and matches the `restaurant_finder` flow.
4. The repo already exposes a thinner single-agent path via `createBaselineAgent`, which is the right starting point for this feature.

## Goal

Enable a React client to talk to the main DeepAgent over a streaming transport and render A2UI v0.9 surfaces returned by that agent.

## Non-Goals

The following are explicitly out of scope for v1:

- subagents generating A2UI directly
- rendering subagent-specific surfaces in the client
- multi-agent UI orchestration
- AG-UI / CopilotKit integration
- custom A2UI catalog components beyond the basic catalog
- mobile or Flutter client support
- long-term A2A interoperability as a hard requirement for v1

## Users

Primary users:

- developers integrating a UI-capable DeepAgent into a React application
- end users interacting with a single top-level agent that can present forms, cards, lists, and action buttons

Secondary users:

- maintainers of the DeepAgent template who need a clear extension path from text-only responses to structured UI responses

## Product Requirements

### Functional Requirements

1. The system must support plain text user input from a React client.
2. The main DeepAgent must be able to return A2UI v0.9 message sequences.
3. The client must process `createSurface`, `updateComponents`, `updateDataModel`, and `deleteSurface`.
4. The client must render A2UI surfaces using trusted local components only.
5. User interactions on rendered surfaces must be converted into A2UI client action messages and sent back to the main DeepAgent.
6. The same session must handle both plain text requests and structured A2UI follow-up actions.
7. Streaming responses must be supported so surfaces can be built incrementally.
8. The integration must keep A2UI ownership at the main agent layer only.

### Non-Functional Requirements

1. The frontend must never execute arbitrary agent-generated code.
2. The transport layer must be browser-safe.
3. The design must support clear logging and debugging of message flow.
4. The implementation must preserve a clean path for later expansion to custom catalogs.
5. The single-agent A2UI path must remain usable even if the scaffolded supervisor path still exists elsewhere in the repo.

## Current-State Constraints

Relevant repo facts:

- `packages/core/src/agent.ts` exposes `createBaselineAgent`, `createScaffoldedAgent`, and `createBasicAgent`.
- `createBasicAgent` is currently an alias of the scaffolded supervisor-oriented agent.
- `packages/core/README.md` explicitly says `createBaselineAgent` is the thinner single-agent control variant.
- `packages/core/src/prompts.ts` makes the scaffolded default explicitly subagent-oriented.

Implication:

For A2UI, the product should target a **new single-agent entrypoint or composition path** based on `createBaselineAgent`, not `createBasicAgent`.

## Proposed Product Design

## 1. High-Level Architecture

```text
React client
  -> A2UI session/controller
  -> HTTP/SSE transport endpoint
  -> main DeepAgent runtime
  -> A2UI message stream back to client
```

The system has three product layers:

1. **React client layer**
   - renders A2UI surfaces
   - sends text prompts
   - sends A2UI action events

2. **Application transport layer**
   - accepts browser requests
   - streams agent responses
   - normalizes agent output into A2UI message chunks

3. **Main DeepAgent layer**
   - owns conversation state
   - decides whether to respond in text, A2UI, or both
   - processes UI action events

## 2. Agent Product Boundary

The agent boundary for v1 is:

- one conversation thread
- one top-level DeepAgent
- one A2UI surface namespace owned by that agent

Subagents may still exist elsewhere in the codebase, but they are **internal implementation detail only** and cannot directly:

- create surfaces
- mutate client-visible surface state
- receive client A2UI actions

## 3. Recommended Agent Factory Strategy

Use one of these approaches:

### Preferred

Create a dedicated A2UI-oriented agent factory built on `createBaselineAgent`.

Example product direction:

```ts
createA2uiMainAgent(...)
  -> wraps createBaselineAgent(...)
  -> adds A2UI-capable prompting
  -> adds A2UI message formatting / response mode handling
```

### Acceptable fallback

Use `createDeepAgent(...)` directly for the A2UI runtime and keep it separate from the scaffolded supervisor default.

### Not recommended for v1

Using `createBasicAgent()` as-is, because that pulls in supervisor instructions that explicitly encourage delegation to subagents.

## 4. Frontend Product Shape

The client should use the direct renderer approach from the A2UI React sample:

- `@a2ui/react/v0_9`
- `@a2ui/web_core/v0_9`
- `@a2ui/markdown-it`

Core frontend responsibilities:

1. Create a `MessageProcessor` with the basic catalog.
2. Render active surfaces with `A2uiSurface`.
3. Send both plain text and structured action messages through one session client.
4. Subscribe to surface create/delete lifecycle events.
5. Clear or preserve surfaces according to app UX rules.

## 5. Transport Product Shape

The frontend should talk to a server-owned endpoint, not directly to the agent runtime internals.

Recommended v1 transport:

- `POST /agent`
- streaming response via SSE or chunked HTTP

Accepted input forms:

1. plain text prompt
2. A2UI client action message

Accepted output form:

1. ordered stream of A2UI v0.9 messages

The transport endpoint is responsible for:

- session lookup / creation
- invoking the main agent
- streaming chunks back to the browser
- normalizing errors into a predictable response shape

## 6. Product Interaction Model

### User text request

1. User submits text in React.
2. Client sends a text request to `/agent`.
3. Main DeepAgent processes the request.
4. Agent returns A2UI messages.
5. Client renders surfaces.

### User action on surface

1. User clicks a button or submits a form.
2. Renderer emits an A2UI client action payload.
3. Client sends that payload to `/agent`.
4. Main DeepAgent processes it in the same session.
5. Agent returns updated or new A2UI surfaces.

## 7. Surface Ownership Rules

The product needs strict ownership rules:

1. Every surface belongs to the active main-agent session.
2. Surface IDs must be unique within that session.
3. The main agent is the only authority allowed to create or delete surfaces.
4. Client-side code may clear old surfaces for UX reasons before a new top-level request, but may not fabricate agent-owned surfaces.

## 8. Prompting and Agent Behavior

The main DeepAgent must be explicitly instructed that it can return A2UI v0.9 messages.

The prompt layer must define:

1. when the agent should use plain text only
2. when the agent should use A2UI
3. the supported catalog
4. the allowed action patterns
5. how follow-up action payloads should be interpreted

For v1, the supported catalog should be only the **basic catalog**. That keeps the agent contract narrow and avoids a custom component design problem before the transport works.

## Product Deliverables

## 1. Backend / Core

Required deliverables:

1. A main-agent-only A2UI entrypoint in `packages/core`
2. A2UI-aware prompt / response contract for the main agent
3. A transport handler that supports streaming and session continuity
4. A parser / adapter that turns agent output into A2UI message chunks if needed

## 2. Frontend

Required deliverables:

1. React shell for A2UI surfaces
2. shared session client for text + action messages
3. loading, error, and empty-state UX
4. basic surface lifecycle management

## 3. Documentation

Required deliverables:

1. implementation note for engineers
2. example message flow
3. supported A2UI version and catalog statement
4. explicit note that subagent UI is out of scope

## Success Metrics

The feature is successful when:

1. a user can submit a text prompt and receive an A2UI-rendered response
2. a user can trigger an action on that UI and receive the next surface from the same main agent
3. the integration works without any subagent owning UI state
4. the browser never executes agent-generated code
5. the message flow is debuggable from client request through final rendered surface

## Acceptance Criteria

### End-to-End

1. A sample React page can send a user message and render at least one A2UI surface.
2. A button action from that surface reaches the same main DeepAgent session.
3. The main DeepAgent can return a second surface in response to that action.
4. Streaming updates do not crash the client if a surface is created incrementally.

### Boundary Enforcement

1. No subagent-facing API is exposed to the client.
2. No client path routes A2UI actions to a specialist subagent.
3. No prompt path instructs a subagent to generate user-visible A2UI.

### Safety

1. Only registered catalog components are rendered.
2. Invalid or unknown component types fail safely.
3. Transport errors are surfaced as controlled UI errors, not silent failures.

## Phased Rollout

## Phase 1: Single-Agent A2UI Foundation

Build:

- main-agent-only A2UI entrypoint
- transport endpoint
- React shell with basic catalog
- static or mock demo flow

Exit criteria:

- one full A2UI round trip works locally

## Phase 2: Real Main-Agent Integration

Build:

- actual DeepAgent invocation path
- prompting for A2UI responses
- action handling inside the main agent
- session continuity

Exit criteria:

- live prompt -> UI -> action -> updated UI flow works

## Phase 3: Hardening

Build:

- logging
- schema validation
- retry behavior
- surface reset policy
- developer docs

Exit criteria:

- stable local developer workflow and predictable failures

## Risks

1. The default scaffold path may accidentally pull the implementation back toward subagent orchestration.
2. If the agent output format is underspecified, the client and backend will drift.
3. Streaming can duplicate surface creation events unless the client de-duplicates safely.
4. Mixing text responses and A2UI responses without a clear contract can make transport parsing fragile.
5. If future custom catalogs are introduced too early, the prompt and renderer complexity will jump sharply.

## Key Decisions

1. **A2UI owner:** main DeepAgent only
2. **Agent entrypoint:** single-agent path based on `createBaselineAgent`
3. **Frontend renderer:** direct A2UI React renderer
4. **Catalog for v1:** basic catalog only
5. **Transport:** server-owned browser-safe endpoint with streaming
6. **Session model:** one conversation session maps to one main-agent A2UI context

## Open Questions

1. Should the main agent return pure A2UI, text plus A2UI, or a normalized envelope that can carry both?
2. Should surface state reset on every top-level prompt, or should multiple surfaces remain active across a session?
3. What is the exact transport contract between the app server and the DeepAgent runtime in this repo?
4. Do we want the first implementation to be framework-agnostic on the backend, or tailored to a specific web server in this project?
5. Should A2UI message validation happen before streaming to the client, or only in development mode at first?

## Recommendation

Proceed with a **single-agent A2UI implementation** that:

- introduces a dedicated main-agent A2UI entrypoint
- avoids the supervisor/subagent scaffold for this feature
- uses the A2UI React renderer directly
- ships first with the basic catalog only

That is the shortest path from the current repo state to a working DeepAgent UI protocol, while keeping the architecture aligned with the requirement that **the main DeepAgent is the only UI-speaking agent**.
