import { createScaffoldedAgent } from "@deep-agent-template/core/agent";
import { catalogPrompt } from "@deep-agent-template/core/generative-ui";
import type { StreamableAgent } from "@deep-agent-template/core/interaction-stream";
import { createDefaultModelRuntime } from "../../core/e2e/json-helpers.ts";
import type { AgentSource } from "../src/server/agent-runtime/turn-runner.ts";

// Two specific, deterministic products. The supervisor is told the exact
// titles/descriptions so the final ProductCard assertion can check exact text
// without depending on model-generated product IDs.
export const PRODUCT_TITLES = ["Sunrise Greeting Card", "Birthday Celebration Card"] as const;
export const PRODUCT_DESCRIPTIONS = [
  "A warm sunrise scene with the message 'Good morning, friend.'",
  "A festive card with balloons and the message 'Happy Birthday!'",
] as const;

export const PRODUCT_REQUEST = [
  "Create exactly two products for me: greeting cards.",
  `Card one: title "${PRODUCT_TITLES[0]}"; description "${PRODUCT_DESCRIPTIONS[0]}".`,
  `Card two: title "${PRODUCT_TITLES[1]}"; description "${PRODUCT_DESCRIPTIONS[1]}".`,
  "These are simple text cards with no images.",
].join("\n");

// Directive supervisor prompt layered on top of the production workflow
// controller. It does NOT bypass the controller: every transition is still
// driven by typed workflow_submit_* tools. The directive pins deterministic
// translation choices so the model does not explore the filesystem or invent
// transitions. The production supervisor prompt stays authoritative for real
// traffic; this prompt is test-only.
const PRODUCT_TEST_SUPERVISOR_PROMPT = [
  "You are a deterministic product-creation supervisor for a live e2e test.",
  "Do NOT read, write, or list files. Do NOT use the filesystem. The test verifies the UI catalogue only.",
  "",
  "Phase behavior:",
  '- Clarification phase: call `task` once with `subagent_type: clarifier`. Translate its result into `workflow_submit_clarification` with `requestKind: "products"`, `status: "ready_to_proceed"`, empty questions, and the answered information it supplied.',
  "- Execution phase: call `workflow_complete_execution` with a brief candidateFinalResponse naming the two products, one deliverable per product, empty validation evidence, and empty assumptions.",
  "- Product generation phase: call `task` once with `subagent_type: product-generator`. Translate its prose into `workflow_submit_products` with mode `create`, gridRoot `products`, and exactly two products carrying the requested titles and descriptions.",
  "- Review phase: call `task` once with `subagent_type: review-agent`. Translate its prose into `workflow_submit_review`.",
  "- Delivery phase: stop. The host renders the final presentation. Do not emit product UI yourself.",
  "",
  "Do not narrate. Do not skip phases. Do not call any tool the controller has not asked for.",
].join("\n");

// Builds the same scaffolded product agent the in-process core e2e suite used,
// wrapped as an AgentSource the worker consumes. guardrails are disabled and
// thinking is off for speed; the directive system prompt keeps the run
// deterministic. No Docker sandbox or Linkloom tools — the test verifies the UI
// catalogue only, same scope as the original product-create scenario.
export function buildProductAgentSource(): AgentSource {
  const agent = createScaffoldedAgent({
    modelRuntime: createDefaultModelRuntime(false),
    generativeUi: { catalogPrompt },
    guardrails: false,
    systemPrompt: PRODUCT_TEST_SUPERVISOR_PROMPT,
  }) as StreamableAgent;
  return () => agent;
}
