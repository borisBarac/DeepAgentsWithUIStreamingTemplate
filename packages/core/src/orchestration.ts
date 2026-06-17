import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { DeepAgent } from "deepagents";

import { createBaselineAgent } from "./agent/baseline.ts";
import {
  type ClarificationConfig,
  type ClarificationState,
  resolveClarificationGate,
} from "./clarification/index.ts";
import type { CreateGuardrailDecisionOptions } from "./guardrails/types.ts";
import type {
  CreateChatModelOptions,
  ModelIdentifier,
  OpenRouterModelOptions,
} from "./models/index.ts";
import { DEFAULT_PROMPT_LOADER, type PromptLoader } from "./prompts/index.ts";

//#region Public state and route types

export type OrchestratedDeepAgentRoute =
  | "clarify"
  | "research"
  | "code"
  | "debate"
  | "critic"
  | "judge"
  | "final"
  | "blocked"
  | "end";

export type OrchestratedDeepAgentErrorCategory =
  | "model"
  | "tool"
  | "permission"
  | "validation"
  | "host"
  | "unknown";

export type OrchestratedDeepAgentError = {
  node: string;
  category: OrchestratedDeepAgentErrorCategory;
  message: string;
  retryCount: number;
  required: boolean;
};

export type OrchestratedDeepAgentMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type OrchestratedDeepAgentState = {
  task: string;
  messages: OrchestratedDeepAgentMessage[];
  clarification?: ClarificationState;
  researchResult?: string;
  codeResult?: string;
  debateResult?: string;
  criticResult?: string;
  judgeResult?: string;
  finalAnswer?: string;
  next: OrchestratedDeepAgentRoute;
  errors: OrchestratedDeepAgentError[];
};

//#endregion

//#region Agent callable contract and adapter

export type OrchestratedDeepAgentInvokeInput = {
  messages: OrchestratedDeepAgentMessage[];
};

export type OrchestratedDeepAgentInvokeOutput = {
  messages: OrchestratedDeepAgentMessage[];
};

export type OrchestratedDeepAgentRole = "researcher" | "coder" | "critic" | "judge" | "finalizer";

export type OrchestratedDeepAgent = {
  invoke(input: OrchestratedDeepAgentInvokeInput): Promise<OrchestratedDeepAgentInvokeOutput>;
};

function normalizeMessages(messages: unknown): OrchestratedDeepAgentMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter(
      (message): message is Record<string, unknown> =>
        message !== null && typeof message === "object",
    )
    .map((message) => {
      const rawRole = message.role;
      const role = rawRole === "assistant" || rawRole === "system" ? rawRole : "user";
      return { role, content: messageContentToString(message.content) };
    });
}

function messageContentToString(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === "string"
          ? part
          : part !== null && typeof part === "object" && "text" in part
            ? String((part as { text?: unknown }).text ?? "")
            : "",
      )
      .join("");
  }
  return "";
}

function extractStageOutput(messages: unknown): string {
  const normalized = normalizeMessages(messages);
  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    const message = normalized[index];
    if (message && message.role === "assistant" && message.content.trim() !== "") {
      return message.content;
    }
  }
  const last = normalized.at(-1);
  return last?.content ?? "";
}

export function adaptDeepAgent(agent: DeepAgent): OrchestratedDeepAgent {
  return {
    invoke: async (input) => {
      const result = (await agent.invoke({
        messages: input.messages,
      } as Parameters<typeof agent.invoke>[0])) as { messages?: unknown };
      return { messages: normalizeMessages(result?.messages) };
    },
  };
}

//#endregion

//#region Routing options and helpers

export type OrchestratedDeepAgentRoutingOptions = {
  enableResearch?: boolean;
  enableCoding?: boolean;
  enableDebate?: boolean;
  requireCritic?: boolean;
};

const RESEARCH_KEYWORDS =
  /\b(research|investigate|explore|find|summar|analyz|study|compare|survey|look up|gather)\b/;
const CODING_KEYWORDS =
  /\b(code|implement|build|refactor|function|bug|fix|test|deploy|api|script|class)\b/;
const DEBATE_KEYWORDS =
  /\b(debate|argue|argument|pros and cons|proceedings|versus|vs\.?|contrasting positions)\b/;

export function selectWorkRoute(
  task: string,
  routing: OrchestratedDeepAgentRoutingOptions,
): OrchestratedDeepAgentRoute {
  const enableResearch = routing.enableResearch ?? true;
  const enableCoding = routing.enableCoding ?? true;
  const enableDebate = routing.enableDebate ?? false;
  const lowered = task.toLowerCase();

  if (enableDebate && DEBATE_KEYWORDS.test(lowered)) {
    return "debate";
  }
  if (enableCoding && CODING_KEYWORDS.test(lowered)) {
    return "code";
  }
  if (enableResearch && RESEARCH_KEYWORDS.test(lowered)) {
    return "research";
  }
  if (enableResearch) {
    return "research";
  }
  if (enableCoding) {
    return "code";
  }
  return "final";
}

//#endregion

//#region Error helpers

function categorizeError(error: unknown): OrchestratedDeepAgentErrorCategory {
  const message = errorToMessage(error);
  if (/permission|denied|forbidden|unauthor/i.test(message)) return "permission";
  if (/abort|cancel|host|signal/i.test(message)) return "host";
  if (/valid|schema|parse|expected|type error/i.test(message)) return "validation";
  if (/tool|timeout|network|fetch|connection|econn/i.test(message)) return "tool";
  if (/model|rate|quota|api key|429|500|503|overloaded/i.test(message)) return "model";
  return "unknown";
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error ?? "");
}

export function toStructuredError(
  error: unknown,
  node: string,
  options: { required?: boolean; retryCount?: number } = {},
): OrchestratedDeepAgentError {
  return {
    node,
    category: categorizeError(error),
    message: errorToMessage(error),
    retryCount: options.retryCount ?? 0,
    required: options.required ?? false,
  };
}

function missingAgentError(
  role: OrchestratedDeepAgentRole,
  required: boolean,
): OrchestratedDeepAgentError {
  return {
    node: role,
    category: "validation",
    message: `No agent configured for the "${role}" stage and no model was provided to build a default.`,
    retryCount: 0,
    required,
  };
}

//#endregion

//#region Finalizer composition

export function composeFinalAnswer(state: OrchestratedDeepAgentState): string {
  const sections: string[] = [];
  const answers = state.clarification?.answeredInformation ?? [];

  if (answers.length > 0) {
    sections.push(
      `## Clarifications\n${answers.map((answer) => `- ${answer.key}: ${answer.value}`).join("\n")}`,
    );
  }
  if (state.researchResult) {
    sections.push(`## Research\n${state.researchResult}`);
  }
  if (state.codeResult) {
    sections.push(`## Implementation\n${state.codeResult}`);
  }
  if (state.debateResult) {
    sections.push(`## Debate\n${state.debateResult}`);
  }
  if (state.criticResult) {
    sections.push(`## Critique\n${state.criticResult}`);
  }
  if (state.judgeResult) {
    sections.push(`## Judgment\n${state.judgeResult}`);
  }
  if (sections.length === 0) {
    sections.push(state.task);
  }

  const errors = state.errors ?? [];
  if (errors.length > 0) {
    const requiredFailures = errors.filter((entry) => entry.required);
    const heading = requiredFailures.length > 0 ? "## Blocked" : "## Caveats";
    sections.push(
      `${heading}\n${errors
        .map((entry) => `- [${entry.category}] ${entry.node}: ${entry.message}`)
        .join("\n")}`,
    );
  }

  return sections.join("\n\n");
}

//#endregion

//#region Options

export type CreateOrchestratedDeepAgentGraphOptions = CreateChatModelOptions & {
  agents?: Partial<Record<OrchestratedDeepAgentRole, OrchestratedDeepAgent>>;
  routing?: OrchestratedDeepAgentRoutingOptions;
  clarification?: Partial<ClarificationConfig>;
  guardrails?: false | CreateGuardrailDecisionOptions;
  promptLoader?: PromptLoader;
};

//#endregion

//#region Graph state annotation

const OrchestratedStateAnnotation = Annotation.Root({
  task: Annotation<string>,
  messages: Annotation<OrchestratedDeepAgentMessage[]>({
    default: () => [],
    reducer: (current, next) => [...(current ?? []), ...(next ?? [])],
  }),
  clarification: Annotation<ClarificationState | undefined>({
    default: () => undefined,
    reducer: (_current, next) => next,
  }),
  researchResult: Annotation<string | undefined>({
    default: () => undefined,
    reducer: (_current, next) => next,
  }),
  codeResult: Annotation<string | undefined>({
    default: () => undefined,
    reducer: (_current, next) => next,
  }),
  debateResult: Annotation<string | undefined>({
    default: () => undefined,
    reducer: (_current, next) => next,
  }),
  criticResult: Annotation<string | undefined>({
    default: () => undefined,
    reducer: (_current, next) => next,
  }),
  judgeResult: Annotation<string | undefined>({
    default: () => undefined,
    reducer: (_current, next) => next,
  }),
  finalAnswer: Annotation<string | undefined>({
    default: () => undefined,
    reducer: (_current, next) => next,
  }),
  next: Annotation<OrchestratedDeepAgentRoute>({
    default: () => "final",
    reducer: (_current, next) => next,
  }),
  errors: Annotation<OrchestratedDeepAgentError[]>({
    default: () => [],
    reducer: (current, next) => [...(current ?? []), ...(next ?? [])],
  }),
});

type OrchestratedGraphState = typeof OrchestratedStateAnnotation.State;

//#endregion

//#region Node context

type NodeContext = {
  agents: Partial<Record<OrchestratedDeepAgentRole, OrchestratedDeepAgent>>;
  routing: OrchestratedDeepAgentRoutingOptions;
  clarification: Partial<ClarificationConfig>;
  guardrails: false | CreateGuardrailDecisionOptions;
  promptLoader: PromptLoader;
  model?: ModelIdentifier;
  openRouter?: OpenRouterModelOptions;
  defaults: Partial<Record<OrchestratedDeepAgentRole, OrchestratedDeepAgent>>;
};

function resolveAgent(
  ctx: NodeContext,
  role: OrchestratedDeepAgentRole,
): OrchestratedDeepAgent | undefined {
  const injected = ctx.agents[role];
  if (injected) {
    return injected;
  }
  const cached = ctx.defaults[role];
  if (cached) {
    return cached;
  }
  if (ctx.model === undefined && ctx.openRouter === undefined) {
    return undefined;
  }
  const built = adaptDeepAgent(
    createBaselineAgent({
      model: ctx.model,
      openRouter: ctx.openRouter,
      guardrails: ctx.guardrails,
      promptLoader: rolePromptLoader(role, ctx.promptLoader),
    }),
  );
  ctx.defaults[role] = built;
  return built;
}

function rolePromptForRole(role: OrchestratedDeepAgentRole, promptLoader: PromptLoader): string {
  switch (role) {
    case "researcher":
      return promptLoader.getResearcherPrompt();
    case "critic":
      return promptLoader.getCriticPrompt();
    default:
      return promptLoader.getBaselinePrompt();
  }
}

function rolePromptLoader(role: OrchestratedDeepAgentRole, base: PromptLoader): PromptLoader {
  const prompt = rolePromptForRole(role, base);
  return {
    getBaselinePrompt: () => prompt,
    getSupervisorPrompt: base.getSupervisorPrompt.bind(base),
    getClarifierPrompt: base.getClarifierPrompt.bind(base),
    getResearcherPrompt: base.getResearcherPrompt.bind(base),
    getAnalystPrompt: base.getAnalystPrompt.bind(base),
    getCriticPrompt: base.getCriticPrompt.bind(base),
  };
}

function buildStageMessages(
  state: OrchestratedGraphState,
  instruction: string,
): OrchestratedDeepAgentMessage[] {
  const messages: OrchestratedDeepAgentMessage[] = [];
  const answers = state.clarification?.answeredInformation ?? [];

  if (answers.length > 0) {
    messages.push({
      role: "system",
      content: `Clarifications provided:\n${answers
        .map((answer) => `- ${answer.key}: ${answer.value}`)
        .join("\n")}`,
    });
  }
  if (state.researchResult) {
    messages.push({ role: "system", content: `Prior research:\n${state.researchResult}` });
  }
  if (state.codeResult) {
    messages.push({
      role: "system",
      content: `Prior implementation notes:\n${state.codeResult}`,
    });
  }
  if (state.criticResult) {
    messages.push({ role: "system", content: `Prior critique:\n${state.criticResult}` });
  }
  messages.push({ role: "user", content: `${instruction}\n\nTask: ${state.task}` });
  return messages;
}

type StageRunResult = {
  output?: string;
  next: OrchestratedDeepAgentRoute;
  errors?: OrchestratedDeepAgentError[];
};

async function runStageAgent(
  state: OrchestratedGraphState,
  ctx: NodeContext,
  role: OrchestratedDeepAgentRole,
  instruction: string,
  options: { required: boolean; successRoute: OrchestratedDeepAgentRoute },
): Promise<StageRunResult> {
  const agent = resolveAgent(ctx, role);
  if (!agent) {
    return {
      next: options.required ? "blocked" : options.successRoute,
      errors: [missingAgentError(role, options.required)],
    };
  }
  try {
    const result = await agent.invoke({ messages: buildStageMessages(state, instruction) });
    return {
      output: extractStageOutput(result.messages),
      next: options.successRoute,
    };
  } catch (error) {
    return {
      next: options.required ? "blocked" : options.successRoute,
      errors: [toStructuredError(error, role, { required: options.required })],
    };
  }
}

//#endregion

//#region Routing between nodes

function routeAfterIntake(state: OrchestratedGraphState): string {
  return nextNodeName(state.next, { clarifyTarget: "clarify" });
}

function routeAfterClarify(state: OrchestratedGraphState): string {
  return nextNodeName(state.next, { clarifyTarget: END });
}

function routeAfterWork(state: OrchestratedGraphState): string {
  return nextNodeName(state.next, { clarifyTarget: END });
}

function nextNodeName(
  next: OrchestratedDeepAgentRoute,
  options: { clarifyTarget: string },
): string {
  switch (next) {
    case "clarify":
      return options.clarifyTarget;
    case "research":
      return "research";
    case "code":
      return "code";
    case "debate":
    case "judge":
      return "judge";
    case "critic":
      return "critic";
    case "final":
      return "finalizer";
    default:
      return END;
  }
}

//#endregion

//#region Nodes

function createIntakeNode(ctx: NodeContext) {
  return (state: OrchestratedGraphState): Partial<OrchestratedGraphState> => {
    const gate = resolveClarificationGate({
      isNewRequest: true,
      request: state.task,
      state: state.clarification ?? null,
      config: ctx.clarification,
    });

    if (gate.state) {
      if (gate.phase === "clarification") {
        return { clarification: gate.state, next: "clarify" };
      }
      if (gate.phase === "blocked") {
        return { clarification: gate.state, next: "blocked" };
      }
    }

    return {
      clarification: gate.state ?? state.clarification,
      next: selectWorkRoute(state.task, ctx.routing),
    };
  };
}

function createClarifyNode(ctx: NodeContext) {
  return (state: OrchestratedGraphState): Partial<OrchestratedGraphState> => {
    const gate = resolveClarificationGate({
      isNewRequest: false,
      request: state.task,
      state: state.clarification ?? null,
      config: ctx.clarification,
    });
    const clarification = gate.state ?? state.clarification;

    if (clarification?.status === "ready_to_proceed") {
      return { clarification, next: selectWorkRoute(state.task, ctx.routing) };
    }

    return { clarification, next: "clarify" };
  };
}

function createResearchNode(ctx: NodeContext) {
  return async (state: OrchestratedGraphState): Promise<Partial<OrchestratedGraphState>> => {
    const result = await runStageAgent(
      state,
      ctx,
      "researcher",
      "Produce concise findings with source notes and unresolved questions.",
      {
        required: false,
        successRoute: ctx.routing.requireCritic ? "critic" : "final",
      },
    );
    const update: Partial<OrchestratedGraphState> = { next: result.next };
    if (result.output !== undefined) {
      update.researchResult = result.output;
    }
    if (result.errors) {
      update.errors = result.errors;
    }
    return update;
  };
}

function createCodeNode(ctx: NodeContext) {
  return async (state: OrchestratedGraphState): Promise<Partial<OrchestratedGraphState>> => {
    const result = await runStageAgent(
      state,
      ctx,
      "coder",
      "Produce implementation guidance, a changed-file plan, and risks.",
      {
        required: false,
        successRoute: ctx.routing.requireCritic ? "critic" : "final",
      },
    );
    const update: Partial<OrchestratedGraphState> = { next: result.next };
    if (result.output !== undefined) {
      update.codeResult = result.output;
    }
    if (result.errors) {
      update.errors = result.errors;
    }
    return update;
  };
}

function createCriticNode(ctx: NodeContext) {
  return async (state: OrchestratedGraphState): Promise<Partial<OrchestratedGraphState>> => {
    const result = await runStageAgent(
      state,
      ctx,
      "critic",
      "Identify correctness risks, missing evidence, unsafe assumptions, and required revisions.",
      {
        required: ctx.routing.requireCritic ?? false,
        successRoute: "final",
      },
    );
    const update: Partial<OrchestratedGraphState> = { next: result.next };
    if (result.output !== undefined) {
      update.criticResult = result.output;
    }
    if (result.errors) {
      update.errors = result.errors;
    }
    return update;
  };
}

function createJudgeNode(ctx: NodeContext) {
  return async (state: OrchestratedGraphState): Promise<Partial<OrchestratedGraphState>> => {
    const result = await runStageAgent(
      state,
      ctx,
      "judge",
      "Adjudicate the competing positions with a rubric and produce a grounded synthesis.",
      {
        required: false,
        successRoute: ctx.routing.requireCritic ? "critic" : "final",
      },
    );
    const update: Partial<OrchestratedGraphState> = { next: result.next };
    if (result.output !== undefined) {
      update.judgeResult = result.output;
    }
    if (result.errors) {
      update.errors = result.errors;
    }
    return update;
  };
}

function createFinalizerNode(ctx: NodeContext) {
  return async (state: OrchestratedGraphState): Promise<Partial<OrchestratedGraphState>> => {
    const draft = composeFinalAnswer(state);

    if (ctx.agents.finalizer) {
      try {
        const result = await ctx.agents.finalizer.invoke({
          messages: [
            {
              role: "user",
              content: `Turn the following orchestration output into the final user-facing response:\n\n${draft}`,
            },
          ],
        });
        const refined = extractStageOutput(result.messages);
        return { finalAnswer: refined || draft, next: "end" };
      } catch (error) {
        return {
          finalAnswer: draft,
          next: "end",
          errors: [toStructuredError(error, "finalizer", { required: false })],
        };
      }
    }

    return { finalAnswer: draft, next: "end" };
  };
}

//#endregion

//#region Graph factory

export type OrchestratedDeepAgentGraph = ReturnType<typeof createOrchestratedDeepAgentGraph>;

export function createOrchestratedDeepAgentGraph(
  options: CreateOrchestratedDeepAgentGraphOptions = {},
) {
  const ctx: NodeContext = {
    agents: options.agents ?? {},
    routing: options.routing ?? {},
    clarification: options.clarification ?? {},
    guardrails: options.guardrails ?? false,
    promptLoader: options.promptLoader ?? DEFAULT_PROMPT_LOADER,
    model: options.model,
    openRouter: options.openRouter,
    defaults: {},
  };

  const builder = new StateGraph(OrchestratedStateAnnotation)
    .addNode("route_intake", createIntakeNode(ctx))
    .addNode("clarify", createClarifyNode(ctx))
    .addNode("research", createResearchNode(ctx))
    .addNode("code", createCodeNode(ctx))
    .addNode("critic", createCriticNode(ctx))
    .addNode("judge", createJudgeNode(ctx))
    .addNode("finalizer", createFinalizerNode(ctx))
    .addEdge(START, "route_intake")
    .addConditionalEdges("route_intake", routeAfterIntake)
    .addConditionalEdges("clarify", routeAfterClarify)
    .addConditionalEdges("research", routeAfterWork)
    .addConditionalEdges("code", routeAfterWork)
    .addConditionalEdges("critic", routeAfterWork)
    .addConditionalEdges("judge", routeAfterWork)
    .addEdge("finalizer", END);

  return builder.compile();
}

//#endregion
