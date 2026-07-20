import { describe, expect, it } from "bun:test";
import {
  catalogComponentNames,
  catalogPrompt,
  createScaffoldedAgent,
  validateModelUiOutput,
} from "../src/index.ts";
import {
  createInteractionStream,
  type ModelUiOutput,
  type UiUpdate,
} from "../src/interaction-stream/index.ts";
import {
  assertActivityLifecycle,
  bucketActivity,
  createDefaultModelRuntime,
  hasLiveLLMCredentials,
  LIVE_TEST_TIMEOUT_MS,
  runLiveScenario,
  validatePresentationOutput,
} from "./helpers.ts";

/**
 * Activity streaming scenario. A live product request runs through the
 * production scaffold with activity enabled. We require:
 *  - main_agent_activity: started, delta, completed
 *  - subagent_activity for clarifier, product-generator, review-agent
 *    (matched by subagentRunId, each with started/delta/completed)
 *  - typed workflow_submit_* submissions
 *  - final valid structured UI (NOT satisfied by intermediate activity or prose)
 */

const ACTIVITY_PRODUCT_REQUEST = [
  "Create two products for me: greeting cards.",
  'Card one: title "Tea Mug"; description "A ceramic mug with a hand-painted tea motif."',
  'Card two: title "Coffee Tumbler"; description "An insulated tumbler for hot coffee on the go."',
  "Simple text cards, no images.",
].join("\n");

/**
 * Directive supervisor prompt for the activity streaming scenario. Same
 * deterministic phase behavior as the product-create scenario; the streaming
 * test does not modify the workflow contract.
 */
const ACTIVITY_TEST_SUPERVISOR_PROMPT = [
  "You are a deterministic product-creation supervisor for a live activity-streaming test.",
  "Do NOT read, write, or list files. Do NOT use the filesystem. The test verifies the streamed activity events and the final UI catalogue only.",
  "",
  "Phase behavior:",
  '- Clarification phase: call `task` once with `subagent_type: clarifier`. Translate its result into `workflow_submit_clarification` with `requestKind: "products"`, `status: "ready_to_proceed"`, empty questions, and the answered information it supplied.',
  "- Execution phase: call `workflow_complete_execution` with a brief candidateFinalResponse naming the two products, one deliverable per product, empty validation evidence, and empty assumptions.",
  "- Product generation phase: call `task` once with `subagent_type: product-generator`. Translate its prose into `workflow_submit_products` with mode `create`, gridRoot `products`, and exactly two products.",
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
    systemPrompt: ACTIVITY_TEST_SUPERVISOR_PROMPT,
  });
}

describe.skipIf(!hasLiveLLMCredentials)("live workflow: activity streaming", () => {
  it(
    "streams main + subagent activity, delivers typed submissions and valid final UI",
    async () => {
      const result = await runLiveScenario(
        async ({ sessionId }) => {
          const agent = buildProductAgent();
          const interaction = createInteractionStream({
            agent,
            includeActivity: true,
            messages: [{ content: ACTIVITY_PRODUCT_REQUEST, role: "user" }],
            requireStructuredOutput: true,
            sessionId,
          });

          const collected: UiUpdate[] = [];
          for await (const update of interaction.updates) {
            collected.push(update);
          }
          const finalResult = await interaction.result;

          // Activity contract: main agent must start, stream deltas, and complete.
          const buckets = bucketActivity(collected);
          if (buckets.mainAgent.length === 0) {
            throw new Error("No main_agent_activity events were streamed.");
          }
          assertActivityLifecycle(buckets.mainAgent, "main agent");

          // Subagent contract: each of clarifier/product-generator/review-agent
          // must be present and match by subagentRunId with full lifecycle.
          const expectedSubagents = ["clarifier", "product-generator", "review-agent"];
          for (const subagentName of expectedSubagents) {
            const byName = buckets.subagentsByName.get(subagentName) ?? [];
            if (byName.length === 0) {
              throw new Error(
                `No subagent_activity events were streamed for ${subagentName}. Saw: ${[...buckets.subagentsByName.keys()].join(", ")}.`,
              );
            }
            // Every event for this subagent must share one or more runIds.
            const runIds = new Set(byName.map((event) => event.subagentRunId ?? "(unknown)"));
            if (runIds.size === 0 || [...runIds].every((id) => id === "(unknown)")) {
              throw new Error(`${subagentName} activity is missing subagentRunId.`);
            }
            // For each runId, the lifecycle should include started and completed.
            for (const runId of runIds) {
              const runEvents = byName.filter((event) => event.subagentRunId === runId);
              const events = runEvents.map((event) => event.event);
              if (!events.includes("started") || !events.includes("completed")) {
                throw new Error(
                  `${subagentName} run ${runId} missing lifecycle (events=${events.join(",")}).`,
                );
              }
            }
            assertActivityLifecycle(byName, `subagent ${subagentName}`);
          }

          // Final structured output: must be a valid catalogue UI, not
          // intermediate activity or prose. The interaction stream promises
          // structuredOutput when delivery succeeds.
          const structured = finalResult.structuredOutput;
          if (!structured) {
            const failure = finalResult.failure;
            const error = new Error(
              `Activity stream did not deliver a structured UI output.${
                failure
                  ? ` Failure code=${failure.code} attempts=${failure.attempts} issues=${failure.issues
                      .map((issue) => `${issue.path}:${issue.message}`)
                      .join("; ")}`
                  : ""
              }`,
            );
            throw error;
          }

          const validation = validatePresentationOutput(structured);
          if (!validation.ok || !validation.output) {
            const error = new Error(
              `Final streamed UI failed catalog validation:\n${validation.issues
                .map((issue) => `${issue.path} [${issue.code}]: ${issue.message}`)
                .join("\n")}`,
            );
            throw Object.assign(error, {
              diagnostics: { catalogueValidationIssues: validation.issues },
            });
          }

          // The final UI must use known catalogue components and a valid root.
          const uiUpdates = validation.output.updates.filter(
            (update): update is Extract<UiUpdate, { type: "ui" }> => update.type === "ui",
          );
          if (uiUpdates.length === 0) {
            throw new Error("Final streamed output did not contain a UI update.");
          }
          const ui = uiUpdates[0];
          if (!ui) throw new Error("Final UI update was undefined.");

          const componentIds = new Set(ui.components.map((component) => component.id));
          const rootId = ui.rootId ?? ui.components[0]?.id;
          if (!rootId || !componentIds.has(rootId)) {
            throw new Error(`Streamed UI root "${rootId ?? "<missing>"}" is not in components.`);
          }
          if (
            !ui.components.every((component) => catalogComponentNames.includes(component.component))
          ) {
            throw new Error("Streamed UI emitted components outside the catalog.");
          }

          // Product presentation invariant: must contain a ProductGrid with
          // exactly two ProductCards.
          const grids = ui.components.filter((component) => component.component === "ProductGrid");
          const cards = ui.components.filter((component) => component.component === "ProductCard");
          if (grids.length !== 1 || cards.length !== 2) {
            throw new Error(
              `Streamed UI must contain one ProductGrid and two ProductCards (grids=${grids.length} cards=${cards.length}).`,
            );
          }

          // Intermediate activity or prose alone must not satisfy delivery.
          // The only acceptable terminal UI is the validated structuredOutput.
          const messageUpdates = collected.filter((update) => update.type === "message");
          if (messageUpdates.length > 0 && finalResult.structuredOutput === null) {
            throw new Error("Stream delivered a message fallback while structuredOutput was null.");
          }

          return {
            value: {
              output: validation.output as ModelUiOutput,
              events: collected.length,
              subagentNames: [...buckets.subagentsByName.keys()],
            },
            collect: () => {},
          };
        },
        { scenarioName: "activity streaming", threadPrefix: "activity-stream" },
      );

      expect(validateModelUiOutput(result.output).ok).toBe(true);
      expect(result.events).toBeGreaterThan(0);
      for (const subagentName of ["clarifier", "product-generator", "review-agent"]) {
        expect(result.subagentNames).toContain(subagentName);
      }
    },
    LIVE_TEST_TIMEOUT_MS,
  );
});
