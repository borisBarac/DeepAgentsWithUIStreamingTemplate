import { HumanMessage } from "@langchain/core/messages";
import { type CreateDeepAgentParams, createDeepAgent, type DeepAgent } from "deepagents";
import { z } from "zod";

import { createCasualScopeGuardrail } from "../guardrails/casual-scope.ts";
import type { StructuredTaskScopeModel, TaskScopeClassifier } from "../guardrails/types.ts";
import { extractLatestProductSet } from "../workflow/products.ts";

export const productGateDecisionSchema = z
  .object({
    route: z.enum(["casual", "product"]).optional(),
    destination: z.enum(["casual", "product"]).optional(),
  })
  .transform((value) => ({ route: value.route ?? value.destination ?? "product" }));
type ProductGateDecision = { route: "casual" | "product" };

type WorkflowStateReader = {
  hasWorkflowState(id: string): boolean;
};

type ProductGateOptions = {
  mainAgent: DeepAgent;
  casualModel: CreateDeepAgentParams["model"];
  classifierModel: StructuredTaskScopeModel;
  workflowController?: WorkflowStateReader;
  casualAgent?: DeepAgent;
};

const CASUAL_SYSTEM_PROMPT = `You are a concise conversational assistant.
Answer greetings, small talk, and brief, simple questions directly.
Do not start, describe, or imitate the product workflow.
If asked to perform a task or answer in depth, decline and explain that this system designs and builds product concepts.`;

const ROUTER_SYSTEM_PROMPT = `Return JSON only. The JSON must have a single key "route" with value "casual" or "product".
Route the latest user message to "product" when it asks to create, change, review, plan, research, or discuss a product or product idea.
Route greetings, small talk, and unrelated general questions to "casual".
When unsure, route to "product".
Example: {"route": "product"}`;

function threadIdFromConfig(config: unknown): string {
  return String(
    (config as { configurable?: { thread_id?: unknown } } | undefined)?.configurable?.thread_id ??
      "__default__",
  );
}

function inputMessages(input: unknown): unknown[] {
  if (typeof input !== "object" || input === null) return [];
  const messages = (input as { messages?: unknown }).messages;
  return Array.isArray(messages) ? messages : [];
}

function latestUserText(messages: readonly unknown[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message instanceof HumanMessage) {
      return typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content);
    }
    if (
      typeof message === "object" &&
      message !== null &&
      "role" in message &&
      (message as { role?: unknown }).role === "user"
    ) {
      const content = (message as { content?: unknown }).content;
      return typeof content === "string" ? content : JSON.stringify(content ?? "");
    }
  }
  return "";
}

async function shouldUseMainAgent(
  input: unknown,
  config: unknown,
  classifier: TaskScopeClassifier,
  workflowController?: WorkflowStateReader,
): Promise<boolean> {
  const messages = inputMessages(input);
  if (extractLatestProductSet(messages)) return true;
  if (workflowController?.hasWorkflowState(threadIdFromConfig(config))) return true;

  const request = latestUserText(messages);
  if (!request) return true;
  try {
    const raw = await classifier.invoke([
      { role: "system", content: ROUTER_SYSTEM_PROMPT },
      { role: "user", content: request },
    ]);
    const decision: ProductGateDecision = productGateDecisionSchema.parse(raw);
    return decision.route !== "casual";
  } catch {
    return true;
  }
}

export function createProductGateAgent(options: ProductGateOptions): DeepAgent {
  const casualAgent =
    options.casualAgent ??
    createDeepAgent({
      name: "casual-agent",
      model: options.casualModel,
      systemPrompt: CASUAL_SYSTEM_PROMPT,
      subagents: [],
      middleware: [createCasualScopeGuardrail({ model: options.classifierModel })],
    });
  const classifier = options.classifierModel.withStructuredOutput(productGateDecisionSchema, {
    method: "jsonMode",
  });

  return new Proxy(options.mainAgent, {
    get(target, property) {
      if (property === "invoke") {
        return async (input: unknown, config?: unknown) => {
          const agent = (await shouldUseMainAgent(
            input,
            config,
            classifier,
            options.workflowController,
          ))
            ? options.mainAgent
            : casualAgent;
          return agent.invoke(input as never, config as never);
        };
      }
      if (property === "streamEvents") {
        return async (input: unknown, config?: unknown) => {
          const agent = (await shouldUseMainAgent(
            input,
            config,
            classifier,
            options.workflowController,
          ))
            ? options.mainAgent
            : casualAgent;
          return agent.streamEvents(input as never, config as never);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as DeepAgent;
}
