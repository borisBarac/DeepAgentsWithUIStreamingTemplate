```mermaid
flowchart TD
    START([START]) --> GK[Gatekeeper]

    GK -->|Out of scope| BLOCKED([END<br/>Return blocked message])
    GK -->|In scope| INTAKE[Route Intake / Clarification Gate]

    INTAKE -->|Needs clarification| CLARIFY[Clarify]
    INTAKE -->|Research task| RESEARCH[Researcher]
    INTAKE -->|Coding task| CODE[Coder]
    INTAKE -->|No work stage| FINALIZER[Finalizer + Review]

    CLARIFY -->|Still unresolved| END_CLARIFY([END<br/>Wait for user response])
    CLARIFY -->|Ready: research| RESEARCH
    CLARIFY -->|Ready: code| CODE
    CLARIFY -->|Ready: final| FINALIZER
    CLARIFY -->|Blocked| END_CLARIFY_BLOCKED([END])

    RESEARCH --> FINALIZER
    CODE --> FINALIZER

    FINALIZER --> REVIEW{Review result}
    REVIEW -->|Approved| END_APPROVED([END<br/>Final answer])
    REVIEW -->|Changes required| REVISE[Finalizer revises]
    REVISE --> REVIEW
    REVIEW -->|Blocked or limit reached| END_CAVEATED([END<br/>Caveated answer])
```

## API / Worker / Redis data flow

A single agent turn crosses three boundaries: browser -> API -> Redis -> worker -> Redis -> browser. The API never calls an LLM; it enqueues a BullMQ job and streams events from a per-session Redis Stream.

```mermaid
sequenceDiagram
    participant B as Browser
    participant A as API (Next.js)
    participant R as Redis
    participant W as Worker

    B->>A: POST /api/agent
    A->>R: lock.acquire (SET NX EX 90s + fencing token)
    A->>R: queue.add("agent-turns", job)
    A->>R: XREAD BLOCK dat:stream:<hash>
    W->>R: worker takes job
    W->>W: run agent turn (LLM + tools)
    W->>R: XADD events to dat:stream:<hash>
    R-->>A: stream events
    A-->>B: NDJSON (streamed)
    W->>R: commitSession (CAS) + release lock
    A-->>B: result event (close)
```

- A client disconnect does not kill the run. `POST /api/agent/reattach` resumes the stream from `afterEventId`.
- `POST /api/agent/cancel` sets a flag the worker polls (~500ms) and aborts cooperatively.
- See [`docs/worker-architecture.md`](worker-architecture.md) for isolation layers, scaling knobs, and timing constants.