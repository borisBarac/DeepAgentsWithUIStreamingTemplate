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
 * Two specific, deterministic products. The supervisor is told the exact
 * titles/descriptions to use so the final ProductCard comparison can assert
 * exact equality with the accepted product batch.
 */
const PRODUCT_TITLES = ["Sunrise Greeting Card", "Birthday Celebration Card"] as const;
const PRODUCT_DESCRIPTIONS = [
  "A warm sunrise scene with the message 'Good morning, friend.'",
  "A festive card with balloons and the message 'Happy Birthday!'",
] as const;

const PRODUCT_REQUEST = [
  "Create exactly two products for me: greeting cards.",
  `Card one: title "${PRODUCT_TITLES[0]}"; description "${PRODUCT_DESCRIPTIONS[0]}".`,
  `Card two: title "${PRODUCT_TITLES[1]}"; description "${PRODUCT_DESCRIPTIONS[1]}".`,
  "These are simple text cards with no images.",
].join("\n");

/**
 * Directive supervisor prompt layered on top of the production workflow
 * controller. We do NOT bypass the controller: every transition is still
 * driven by typed workflow_submit_* tools. The directive pins deterministic
 * translation choices so the model doesn't explore the filesystem or invent
 * transitions. The default production supervisor prompt stays authoritative
 * for production traffic; this prompt is test-only.
 */
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

function buildProductAgent() {
  return createScaffoldedAgent({
    modelRuntime: createDefaultModelRuntime(false),
    generativeUi: { catalogPrompt },
    guardrails: false,
    systemPrompt: PRODUCT_TEST_SUPERVISOR_PROMPT,
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
    gridRoot: String(payload.gridRoot ?? "products"),
    products: normalized as ProductItem[],
  };
}

describe.skipIf(!hasLiveLLMCredentials)("live workflow: full product creation", () => {
  it(
    "drives clarifier → execution → product-generator → reviewer → delivery with valid ProductCard UI",
    async () => {
      const result = await runLiveScenario(
        async ({ threadId }) => {
          const agent = buildProductAgent();
          const invokeResult = (await agent.invoke(
            { messages: [{ role: "user", content: PRODUCT_REQUEST }] },
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

          // Pull the accepted product batch and confirm mode/grid/count.
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
          if (batch.mode !== "create") {
            throw new Error(`Expected create mode, got ${batch.mode}.`);
          }
          if (batch.products.length !== 2) {
            throw new Error(`Expected 2 products, got ${batch.products.length}.`);
          }
          // IDs must be unique and stable strings.
          const ids = new Set(batch.products.map((product) => product.id));
          if (ids.size !== 2) {
            throw new Error(`Expected 2 unique product ids, got ${[...ids].join(", ")}.`);
          }

          // Deterministic UI drain: the workflow controller populates
          // structuredResponse from the accepted batch via
          // productBatchToUiUpdate; there is no second LLM call.
          const structuredResponse = invokeResult.structuredResponse;
          if (!structuredResponse) {
            throw new Error(
              "Product workflow did not produce a deterministic UI response for the accepted batch.",
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

          // Production product invariant: one ProductGrid, exactly two ProductCards,
          // exact equality with the accepted batch.
          const comparison = compareProductCards(ui, batch);
          if (!comparison.matched) {
            const error = new Error(
              `Product presentation did not match accepted batch:\n${comparison.issues.join("\n")}`,
            );
            throw Object.assign(error, {
              diagnostics: {
                ...diagnostics,
                presentationError: comparison.issues.join(" | "),
              },
            });
          }
          if (!comparison.grid || comparison.cards.length !== 2) {
            throw new Error(
              `Expected one ProductGrid and two ProductCards (grid=${comparison.grid?.id ?? "<none>"} cards=${comparison.cards.length}).`,
            );
          }

          // Capture task delegation history for diagnostics on later failures.
          const taskCalls = collectTaskDelegations(messages).map((call) => ({
            subagent: call.subagent,
            preview: call.preview,
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
            },
          };
        },
        { scenarioName: "full product creation", threadPrefix: "product-create" },
      );

      // Final sanity assertions (outside the per-attempt retry loop).
      expect(validateModelUiOutput(result.output).ok).toBe(true);
      expect(result.batch.products).toHaveLength(2);
      expect(result.cards).toHaveLength(2);
    },
    LIVE_TEST_TIMEOUT_MS,
  );
});
