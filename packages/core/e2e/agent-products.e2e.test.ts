import { describe, expect, it } from "bun:test";
import {
  type ComponentInstance,
  catalogComponentNames,
  catalogPrompt,
  createScaffoldedAgent,
  type ModelUiOutput,
} from "../src/index.ts";
import {
  type AgentInvokeResult,
  createDefaultModelRuntime,
  extractUiUpdates,
  hasLiveLLMCredentials,
  LIVE_ATTEMPT_TIMEOUT_MS,
  LIVE_MAX_ATTEMPTS,
  LIVE_TEST_TIMEOUT_MS,
  runWithRetry,
  validatePresentationOutput,
} from "./helpers.ts";

/**
 * Exercises the full generative-UI agent: createScaffoldedAgent with
 * `generativeUi` enabled, which turns on the product-generation phase and the
 * deterministic `structuredResponse` drain. A short behavioral directive keeps
 * the supervisor off the filesystem and on the controller's phase machine; it
 * does NOT pin product content, so the test proves the agent produces a valid
 * product presentation, not that it echoes specific strings.
 */
const PRODUCT_DIRECTIVE = [
  "You are a product-creation supervisor for a live e2e test.",
  "Do NOT read, write, or list files. Do NOT use the filesystem — verify the UI catalogue only.",
  "Drive through every workflow phase the controller requests, delegating to the required subagent each time.",
  "Deliver when the reviewer approves.",
].join("\n");

const CREATE_REQUEST = [
  "Create exactly two greeting card products for me.",
  "Card one: a warm sunrise scene greeting a friend.",
  "Card two: a festive birthday card with balloons.",
  "These are simple text cards with no images.",
].join("\n");

const PRIOR_GRID_ROOT = "catalog";
const PRIOR_CARD_A_ID = "prior-card-1";
const PRIOR_CARD_B_ID = "prior-card-2";
const PRIOR_PRODUCT_IDS = [PRIOR_CARD_A_ID, PRIOR_CARD_B_ID];
const REPLACE_REQUEST = [
  "Replace my existing catalogue with two new greeting card products.",
  "Card one: a crisp autumn forest scene.",
  "Card two: a bright summer beach scene.",
  "These are simple text cards with no images. Fully replace the existing set.",
].join("\n");

type InvokeResult = AgentInvokeResult & { structuredResponse?: ModelUiOutput };

function buildProductAgent() {
  return createScaffoldedAgent({
    modelRuntime: createDefaultModelRuntime(false),
    generativeUi: { catalogPrompt },
    guardrails: false,
    systemPrompt: PRODUCT_DIRECTIVE,
  });
}

function threadId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

/** Seeds a prior catalogue as an assistant UI message the controller can read. */
function buildPriorHistory() {
  const priorOutput: ModelUiOutput = {
    version: 1,
    updates: [
      {
        type: "ui",
        rootId: PRIOR_GRID_ROOT,
        components: [
          {
            id: PRIOR_GRID_ROOT,
            component: "ProductGrid",
            heading: "Featured products",
            children: PRIOR_PRODUCT_IDS,
          },
          {
            id: PRIOR_CARD_A_ID,
            component: "ProductCard",
            title: "Spring Bloom Card",
            description: "A pastel spring bouquet.",
          },
          {
            id: PRIOR_CARD_B_ID,
            component: "ProductCard",
            title: "Winter Cabin Card",
            description: "A cozy winter scene.",
          },
        ],
      },
    ],
  };
  return [
    { role: "assistant" as const, content: JSON.stringify(priorOutput) },
    { role: "user" as const, content: REPLACE_REQUEST },
  ];
}

function cardsOf(ui: ReturnType<typeof extractUiUpdates>[number]): ComponentInstance[] {
  return ui.components.filter((component) => component.component === "ProductCard");
}

describe.skipIf(!hasLiveLLMCredentials)("agent product generation live e2e", () => {
  it(
    "creates a valid product presentation with one ProductGrid and two ProductCards",
    async () => {
      await runWithRetry(
        async () => {
          const agent = buildProductAgent();
          const result = (await agent.invoke(
            { messages: [{ role: "user", content: CREATE_REQUEST }] },
            { configurable: { thread_id: threadId("product-create") } },
          )) as InvokeResult;

          expect(result.structuredResponse).toBeDefined();
          const validation = validatePresentationOutput(result.structuredResponse);
          expect(validation.ok).toBe(true);
          if (!validation.output) throw new Error("Presentation validation produced no output.");

          const ui = extractUiUpdates(validation.output)[0];
          if (!ui) throw new Error("No UI update was produced.");

          const grids = ui.components.filter((c) => c.component === "ProductGrid");
          const cards = cardsOf(ui);
          expect(grids).toHaveLength(1);
          expect(cards).toHaveLength(2);
          expect(ui.components.every((c) => catalogComponentNames.includes(c.component))).toBe(
            true,
          );
        },
        {
          name: "product create",
          attempts: LIVE_MAX_ATTEMPTS,
          timeoutMs: LIVE_ATTEMPT_TIMEOUT_MS,
        },
      );
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  it(
    "replaces an existing catalogue with new products that do not reuse prior ids",
    async () => {
      await runWithRetry(
        async () => {
          const agent = buildProductAgent();
          const result = (await agent.invoke(
            { messages: buildPriorHistory() },
            { configurable: { thread_id: threadId("product-replace") } },
          )) as InvokeResult;

          expect(result.structuredResponse).toBeDefined();
          const validation = validatePresentationOutput(result.structuredResponse);
          expect(validation.ok).toBe(true);
          if (!validation.output) throw new Error("Presentation validation produced no output.");

          const ui = extractUiUpdates(validation.output)[0];
          if (!ui) throw new Error("No UI update was produced.");

          const grids = ui.components.filter((c) => c.component === "ProductGrid");
          const cards = cardsOf(ui);
          expect(grids).toHaveLength(1);
          expect(cards).toHaveLength(2);
          expect(ui.components.every((c) => catalogComponentNames.includes(c.component))).toBe(
            true,
          );

          const newIds = new Set(cards.map((card) => card.id));
          for (const priorId of PRIOR_PRODUCT_IDS) {
            expect(newIds.has(priorId)).toBe(false);
          }
        },
        {
          name: "product replace",
          attempts: LIVE_MAX_ATTEMPTS,
          timeoutMs: LIVE_ATTEMPT_TIMEOUT_MS,
        },
      );
    },
    LIVE_TEST_TIMEOUT_MS,
  );
});
