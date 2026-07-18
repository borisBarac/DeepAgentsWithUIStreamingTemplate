import { describe, expect, it } from "bun:test";
import { createAgentFromRuntimeScaffold } from "../src/agent/runtime.ts";
import { catalogPrompt, createRuntimeScaffold, validateUpdate } from "../src/index.ts";
import {
  type AgentInputMessage,
  createInteractionStream,
  type StreamableAgent,
  type UiUpdate,
  UNRENDERABLE_UI_MESSAGE,
} from "../src/interaction-stream/index.ts";
import { createDefaultModelRuntime, hasLiveLLMCredentials } from "./helpers.ts";

const OFF_CATALOG_PROMPT = [
  'Show me a product card for "Aurora NC Pro" headphones — premium over-ear with adaptive ANC, $349.',
  "",
  "Emit your response as NDJSON ui update lines.",
  'For your FIRST ui line you must use a component type called "Carousel", which is intentionally NOT in the supported catalog.',
  "Emit this exact line as your first ui update:",
  '{"type":"ui","rootId":"carousel","components":[{"id":"carousel","component":"Carousel","title":"Aurora NC Pro","children":[]}]}',
  "",
  "If you receive repair feedback that the component is unknown, switch to a valid catalog component such as Card or product-card.",
].join("\n");

function createRecordingProxy(agent: StreamableAgent): {
  invocations: AgentInputMessage[][];
  presentationInvocations: Parameters<NonNullable<StreamableAgent["present"]>>[0][];
  proxy: StreamableAgent;
} {
  const invocations: AgentInputMessage[][] = [];
  const presentationInvocations: Parameters<NonNullable<StreamableAgent["present"]>>[0][] = [];
  const present = agent.present;
  const proxy: StreamableAgent = {
    invoke: async (input) => {
      invocations.push(input.messages);
      return agent.invoke(input);
    },
    streamEvents: async (input, config) => {
      invocations.push(input.messages);
      if (!agent.streamEvents) throw new Error("agent does not support streamEvents");
      return agent.streamEvents(input, config);
    },
    present: present
      ? async (request) => {
          presentationInvocations.push(request);
          return present(request);
        }
      : undefined,
  };
  return { invocations, presentationInvocations, proxy };
}

describe.skipIf(!hasLiveLLMCredentials)(
  "interaction-stream unsupported-catalog-schema repair live e2e",
  () => {
    it("rejects an off-catalog component, repairs or falls back, and never leaks an invalid spec", async () => {
      const modelRuntime = createDefaultModelRuntime(false);
      const scaffold = createRuntimeScaffold({
        modelRuntime,
        generativeUi: { catalogPrompt },
        subagents: [],
      });
      const agent = createAgentFromRuntimeScaffold({
        factoryName: "createScaffoldedAgent",
        scaffold,
        modelRuntime,
        guardrails: false,
      }) as unknown as StreamableAgent;

      const { invocations, presentationInvocations, proxy } = createRecordingProxy(agent);

      const interaction = createInteractionStream({
        agent: proxy,
        messages: [{ content: OFF_CATALOG_PROMPT, role: "user" }],
        sessionId: `unsupported-schema-${crypto.randomUUID()}`,
      });

      const updates: UiUpdate[] = [];
      for await (const update of interaction.updates) {
        updates.push(update);
      }
      const result = await interaction.result;

      console.log({ updates, invocations, presentationInvocations, failure: result.failure });

      const uiUpdates = updates.filter(
        (update): update is Extract<UiUpdate, { type: "ui" }> => update.type === "ui",
      );
      const messageUpdates = updates.filter(
        (update): update is Extract<UiUpdate, { type: "message" }> => update.type === "message",
      );

      for (const update of uiUpdates) {
        expect(validateUpdate(update).ok).toBe(true);
        expect(update.components.every((component) => component.component !== "Carousel")).toBe(
          true,
        );
      }

      expect(uiUpdates.length + messageUpdates.length).toBeGreaterThan(0);

      const presentationFeedback = presentationInvocations[0]?.repairFeedback;
      const retryFeedback = invocations[1]
        ? [...invocations[1]].reverse().find((message) => message.role === "user")?.content
        : undefined;
      const feedback = presentationFeedback ?? retryFeedback;
      const invalidCandidateAttempted =
        feedback?.includes("unknown_component") === true ||
        result.failure?.issues.some((issue) => issue.code === "unknown_component") === true;

      if (invalidCandidateAttempted) {
        expect(feedback).toContain("unknown_component");
        expect(feedback).toContain("components[0].component");
        if (result.failure) {
          expect(result.failure.attempts).toBe(2);
          expect(messageUpdates.map((update) => update.text)).toContain(UNRENDERABLE_UI_MESSAGE);
        }
      }

      if (!invalidCandidateAttempted && uiUpdates.length === 0) {
        expect(messageUpdates.some((update) => update.text.trim().length > 0)).toBe(true);
      }
    }, 180_000);
  },
);
