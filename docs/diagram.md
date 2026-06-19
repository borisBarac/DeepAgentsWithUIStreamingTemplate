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