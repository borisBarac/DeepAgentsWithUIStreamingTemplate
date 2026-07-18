  # Mandatory Clarification-to-Product Flow

  ## Summary

  Implement explicit orchestration: a triage classifier gates the clarifier (skip for self-contained
  prompts, proceed for ambiguous ones); when proceeding, clarifier runs before normal work;
  product-generator runs after clarification when generative UI is enabled; reviewer validates
  delivery; reviewer failure loops back to product-generator.

  ## Key Changes

  - Add a product-flow decision helper in packages/core/src/clarification or new packages/core/src/product-
    flow.

  - Extend flow phases:
      - clarification
      - product_generation
      - review
      - execution
      - blocked

  - Gate rules:
      - New/unresolved request -> triage classifier
      - triage "skip" -> straight to execution (clarifier round elided)
      - triage "proceed" -> clarifier
      - blocked or unresolved after max rounds -> stop
      - ready_to_proceed + no generativeUi -> normal execution
      - ready_to_proceed + generativeUi + no product batch -> product-generator
      - product batch generated -> review-agent
      - reviewer passes -> execution / final delivery
      - reviewer fails -> back to product-generator with reviewer feedback

  - Extend decision output with:
      - phase
      - requiredSubagent?: "clarifier" | "product-generator" | "review-agent"
      - canPlan, canDelegate, canFinalize
      - reviewFeedback?: string

  - Keep current default: product-generator exists only when generativeUi is set.
  - Surface scaffold metadata:
      - clarification.requiredSubagent = "clarifier"
      - productGeneration.enabled = Boolean(generativeUi)
      - productGeneration.requiredSubagent = "product-generator" only when enabled
      - review.requiredSubagent = "review-agent"

  ## Prompt Updates

  - Supervisor prompt must require:
      - triage-first; delegate to clarifier only when the workflow controller routes there
      - product-generator immediately after ready_to_proceed when generative UI is enabled
      - reviewer after product generation
      - if reviewer reports required changes, route back to product-generator with the feedback
      - final delivery only after reviewer pass

  - Product-generator prompt must accept reviewer feedback as revision input and return a revised product
    batch.

  ## Tests

  - Unit tests for flow helper:
      - new request -> clarification
      - unresolved clarification -> clarification
      - blocked clarification -> blocked
      - ready + no generativeUi -> execution
      - ready + generativeUi + no product batch -> product_generation
      - product batch generated + no review -> review
      - review pass -> execution
      - review fail -> product_generation with feedback

  - Runtime scaffold tests:
      - generativeUi adds product metadata and product subagent
      - no generativeUi omits product-generation requirement
      - review metadata always points to review-agent

  - Prompt tests:
      - supervisor includes product-generator retry-on-review-failure rule
      - product-generator mentions reviewer feedback revision handling

  - Run:
      - bun test packages/core/src/clarification packages/core/src/scaffold packages/core/src/prompts
      - bun test

  ## Assumptions

  - Use beads before implementation: create/claim a bd issue.
                                                    - No breaking change for callers without generativeUi.
  - No deepagents internals modified; enforcement via exported decision helper, scaffold metadata, prompts,
    and tests.

  - Review pass/fail is based on existing review schema semantics.