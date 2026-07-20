import { describe, expect, it } from "bun:test";
import {
  catalogComponentNames,
  catalogPrompt,
  createScaffoldedAgent,
  type ModelUiOutput,
  type ModelUiUpdate,
  type ProductBatch,
  type ProductItem,
  validateModelUiOutput,
} from "../src/index.ts";
import {
  type AgentInvokeResult,
  assertSubmissionsAcceptedInOrder,
  assertTaskDelegationsInOrder,
  collectTaskDelegations,
  collectWorkflowDiagnostics,
  collectWorkflowSubmissions,
  compareProductCards,
  createDefaultModelRuntime,
  hasLiveLLMCredentials,
  LIVE_TEST_TIMEOUT_MS,
  runLiveScenario,
  type StructuredPayload,
  validatePresentationOutput,
  WORKFLOW_CLARIFICATION_TOOL,
  WORKFLOW_EXECUTION_TOOL,
  WORKFLOW_PRODUCTS_TOOL,
  WORKFLOW_REVIEW_TOOL,
} from "./helpers.ts";

/**
 * Deterministic prior product set. Two cards with stable IDs that the new
 * batch must NOT reuse. The grid root must be preserved by the replacement.
 */
const PRIOR_GRID_ROOT = "catalog";
const PRIOR_PRODUCT_IDS = ["prior-card-1", "prior-card-2"] as const;
const PRIOR_PRODUCTS: ProductItem[] = [
  {
    id: PRIOR_PRODUCT_IDS[0] ?? "prior-card-1",
    title: "Spring Bloom Card",
    description: "A pastel spring bouquet with the message 'Thinking of you.'",
  },
  {
    id: PRIOR_PRODUCT_IDS[1] ?? "prior-card-2",
    title: "Winter Cabin Card",
    description: "A cozy winter scene with the message 'Stay warm.'",
  },
];

const REPLACEMENT_TITLES = ["Autumn Leaves Card", "Summer Beach Card"] as const;
const REPLACEMENT_DESCRIPTIONS = [
  "A crisp autumn forest with the message 'Fall greetings.'",
  "A bright summer beach with the message 'Sunshine ahead!'",
] as const;

const UPDATE_REQUEST = [
  "Replace my existing catalogue with two products: greeting cards.",
  `Card one: title "${REPLACEMENT_TITLES[0]}"; description "${REPLACEMENT_DESCRIPTIONS[0]}".`,
  `Card two: title "${REPLACEMENT_TITLES[1]}"; description "${REPLACEMENT_DESCRIPTIONS[1]}".`,
  "These are simple text cards with no images.",
  "Use the existing grid root and replace the full set.",
].join("\n");

/**
 * Directive supervisor prompt for the replacement scenario. Same shape as the
 * product-create directive but with mode=update and explicit "do not reuse
 * prior IDs" guidance.
 */
const REPLACE_TEST_SUPERVISOR_PROMPT = [
  "You are a deterministic product-replacement supervisor for a live e2e test.",
  "Do NOT read, write, or list files. Do NOT use the filesystem. The test verifies the UI catalogue only.",
  "The existing catalogue is supplied in the conversation; you must fully replace it.",
  "",
  "Phase behavior:",
  '- Clarification phase: call `task` once with `subagent_type: clarifier`. Translate its result into `workflow_submit_clarification` with `requestKind: "products"`, `status: "ready_to_proceed"`, empty questions, and the answered information it supplied.',
  "- Execution phase: call `workflow_complete_execution` with a brief candidateFinalResponse naming the two replacement products, one deliverable per product, empty validation evidence, and empty assumptions.",
  "- Product generation phase: call `task` once with `subagent_type: product-generator`. Translate its prose into `workflow_submit_products` with mode `update`, the existing gridRoot, and exactly two products with NEW unique ids (never reused from the prior set).",
  "- Review phase: call `task` once with `subagent_type: review-agent`. Translate its prose into `workflow_submit_review`.",
  "- Delivery phase: stop. The host renders the final presentation. Do not emit product UI yourself.",
  "",
  "Do not narrate. Do not skip phases. Do not call any tool the controller has not asked for.",
].join("\n");

function buildPriorHistory() {
  const priorOutput = {
    version: 1 as const,
    updates: [
      {
        type: "ui" as const,
        rootId: PRIOR_GRID_ROOT,
        components: [
          {
            id: PRIOR_GRID_ROOT,
            component: "ProductGrid",
            heading: "Featured products",
            children: PRIOR_PRODUCT_IDS,
          },
          ...PRIOR_PRODUCTS.map((product) => ({
            id: product.id,
            component: "ProductCard",
            title: product.title,
            description: product.description,
          })),
        ],
      },
    ],
  };
  return [
    { role: "assistant" as const, content: JSON.stringify(priorOutput) },
    { role: "user" as const, content: UPDATE_REQUEST },
  ];
}

function buildProductAgent() {
  return createScaffoldedAgent({
    modelRuntime: createDefaultModelRuntime(false),
    generativeUi: { catalogPrompt },
    guardrails: false,
    systemPrompt: REPLACE_TEST_SUPERVISOR_PROMPT,
  });
}

function expectedBatchFromSubmission(payload: StructuredPayload): ProductBatch | null {
  const products = Array.isArray(payload.products) ? (payload.products as ProductItem[]) : [];
  if (products.length !== 2) return null;
  const normalized = products.map((product) => ({
    id: String(product.id ?? ""),
    title: String(product.title ?? ""),
    description: String(product.description ?? ""),
    ...(typeof product.imagePrompt === "string" ? { imagePrompt: product.imagePrompt } : {}),
  }));
  return {
    mode: payload.mode === "update" ? "update" : "create",
    gridRoot: String(payload.gridRoot ?? PRIOR_GRID_ROOT),
    products: normalized as ProductItem[],
  };
}

describe.skipIf(!hasLiveLLMCredentials)("live workflow: existing product replacement", () => {
  it(
    "seeds prior catalogue, replaces both products, preserves grid root, uses new ids",
    async () => {
      const result = await runLiveScenario(
        async ({ threadId }) => {
          const agent = buildProductAgent();
          const invokeResult = (await agent.invoke(
            { messages: buildPriorHistory() },
            { configurable: { thread_id: threadId } },
          )) as AgentInvokeResult & {
            structuredResponse?: ModelUiOutput;
          };

          const messages = invokeResult.messages ?? [];
          const diagnostics = collectWorkflowDiagnostics(messages);

          // Workflow contract: every required delegation must happen in order.
          assertTaskDelegationsInOrder(messages, [
            "clarifier",
            "product-generator",
            "review-agent",
          ]);

          // Workflow contract: every typed submission must be accepted in order.
          const submissions = assertSubmissionsAcceptedInOrder(messages, [
            WORKFLOW_CLARIFICATION_TOOL,
            WORKFLOW_EXECUTION_TOOL,
            WORKFLOW_PRODUCTS_TOOL,
            WORKFLOW_REVIEW_TOOL,
          ]);

          const acceptedProducts = submissions.find(
            (submission) =>
              submission.name === WORKFLOW_PRODUCTS_TOOL && submission.status === "accepted",
          );
          if (!acceptedProducts?.requestArgs) {
            throw new Error(
              `No accepted ${WORKFLOW_PRODUCTS_TOOL} submission was found. All submissions: ${JSON.stringify(
                submissions.map((submission) => ({
                  name: submission.name,
                  status: submission.status,
                })),
              )}`,
            );
          }
          const batch = expectedBatchFromSubmission(acceptedProducts.requestArgs);
          if (!batch) {
            throw new Error(
              `Accepted product batch did not contain two products: ${JSON.stringify(acceptedProducts.requestArgs)}`,
            );
          }

          // Update-mode contract.
          if (batch.mode !== "update") {
            throw new Error(`Expected update mode, got ${batch.mode}.`);
          }
          if (batch.gridRoot !== PRIOR_GRID_ROOT) {
            throw new Error(
              `Expected preserved grid root ${PRIOR_GRID_ROOT}, got ${batch.gridRoot}.`,
            );
          }
          if (batch.products.length !== PRIOR_PRODUCTS.length) {
            throw new Error(
              `Expected ${PRIOR_PRODUCTS.length} products to match prior count, got ${batch.products.length}.`,
            );
          }

          const newIds = new Set(batch.products.map((product) => product.id));
          if (newIds.size !== batch.products.length) {
            throw new Error(`New product ids must be unique (got ${[...newIds].join(", ")}).`);
          }
          for (const oldId of PRIOR_PRODUCT_IDS) {
            if (newIds.has(oldId)) {
              throw new Error(`Replacement batch must not reuse prior id ${oldId}.`);
            }
          }

          // Deterministic UI drain: the workflow controller populates
          // structuredResponse from the accepted batch via
          // productBatchToUiUpdate; there is no second LLM call.
          const structuredResponse = invokeResult.structuredResponse;
          if (!structuredResponse) {
            throw new Error(
              "Replacement workflow did not produce a deterministic UI response for the accepted batch.",
            );
          }

          const validation = validatePresentationOutput(structuredResponse);
          if (!validation.ok || !validation.output) {
            const error = new Error(
              `Final presentation failed catalog validation:\n${validation.issues
                .map((issue) => `${issue.path} [${issue.code}]: ${issue.message}`)
                .join("\n")}`,
            );
            throw Object.assign(error, {
              diagnostics: {
                ...diagnostics,
                catalogueValidationIssues: validation.issues,
              },
            });
          }

          const uiUpdates = validation.output.updates.filter(
            (update): update is Extract<ModelUiUpdate, { type: "ui" }> => update.type === "ui",
          );
          if (uiUpdates.length !== 1) {
            throw new Error(
              `Expected exactly one UI update, got ${uiUpdates.length} (submissions=${submissions.length}).`,
            );
          }
          const ui = uiUpdates[0];
          if (!ui) throw new Error("UI update was undefined.");

          // Catalogue invariants from generative-ui.e2e.test.ts.
          const componentIds = new Set(ui.components.map((component) => component.id));
          const rootId = ui.rootId ?? ui.components[0]?.id;
          if (!rootId || !componentIds.has(rootId)) {
            throw new Error(`Presentation root "${rootId ?? "<missing>"}" is not in components.`);
          }
          if (
            !ui.components.every((component) => catalogComponentNames.includes(component.component))
          ) {
            throw new Error("Presentation emitted components outside the catalog.");
          }

          // Production product invariant: exact equality with accepted batch.
          const comparison = compareProductCards(ui, batch);
          if (!comparison.matched) {
            const error = new Error(
              `Replacement presentation did not match accepted batch:\n${comparison.issues.join("\n")}`,
            );
            throw Object.assign(error, {
              diagnostics: {
                ...diagnostics,
                presentationError: comparison.issues.join(" | "),
              },
            });
          }

          // Capture for diagnostics.
          const taskCalls = collectTaskDelegations(messages).map((call) => ({
            subagent: call.subagent,
            preview: call.preview,
          }));
          const allSubmissions = collectWorkflowSubmissions(messages).map((submission) => ({
            name: submission.name,
            status: submission.status,
            nextPhase: submission.nextPhase,
          }));

          return {
            value: {
              output: validation.output,
              batch,
              cards: comparison.cards,
            },
            collect: (extra) => {
              void extra;
              void taskCalls;
              void allSubmissions;
            },
          };
        },
        { scenarioName: "existing product replacement", threadPrefix: "product-replace" },
      );

      // Final sanity assertions.
      expect(validateModelUiOutput(result.output).ok).toBe(true);
      expect(result.batch.mode).toBe("update");
      expect(result.batch.gridRoot).toBe(PRIOR_GRID_ROOT);
      expect(result.batch.products).toHaveLength(PRIOR_PRODUCTS.length);
      expect(result.cards).toHaveLength(PRIOR_PRODUCTS.length);
      for (const oldId of PRIOR_PRODUCT_IDS) {
        expect(result.batch.products.map((product) => product.id)).not.toContain(oldId);
      }
    },
    LIVE_TEST_TIMEOUT_MS,
  );
});
