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
import {
  createReviewConfig,
  createReviewState,
  markReviewCaveated,
  parseReviewReport,
  type ReviewConfig,
  type ReviewReport,
  type ReviewState,
  recordReviewReport,
} from "./review/index.ts";

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
  review?: ReviewState;
  next: OrchestratedDeepAgentRoute;
  errors: OrchestratedDeepAgentError[];
};

type OrchestratedStageResultKey =
  | "researchResult"
  | "codeResult"
  | "debateResult"
  | "criticResult"
  | "judgeResult";
//#endregion

//#region Agent callable contract and adapter

export type OrchestratedDeepAgentInvokeInput = {
  messages: OrchestratedDeepAgentMessage[];
};

export type OrchestratedDeepAgentInvokeOutput = {
  messages: OrchestratedDeepAgentMessage[];
};

export type OrchestratedDeepAgentRole =
  | "researcher"
  | "coder"
  | "critic"
  | "judge"
  | "finalizer"
  | "reviewer";

export type OrchestratedDeepAgent = {
  invoke(input: OrchestratedDeepAgentInvokeInput): Promise<OrchestratedDeepAgentInvokeOutput>;
};

type MessageContentPart = { text?: unknown };

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

function messageContentPartToString(part: unknown): string {
  if (typeof part === "string") {
    return part;
  }
  if (part !== null && typeof part === "object" && "text" in part) {
    return String((part as MessageContentPart).text ?? "");
  }
  return "";
}

function messageContentToString(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => messageContentPartToString(part)).join("");
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
  const stageSections: Array<{ key: OrchestratedStageResultKey; heading: string }> = [
    { key: "researchResult", heading: "Research" },
    { key: "codeResult", heading: "Implementation" },
    { key: "debateResult", heading: "Debate" },
    { key: "criticResult", heading: "Critique" },
    { key: "judgeResult", heading: "Judgment" },
  ];

  if (answers.length > 0) {
    sections.push(
      `## Clarifications\n${answers.map((answer) => `- ${answer.key}: ${answer.value}`).join("\n")}`,
    );
  }
  for (const section of stageSections) {
    const content = state[section.key];
    if (content) {
      sections.push(`## ${section.heading}\n${content}`);
    }
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
  review?: Partial<ReviewConfig>;
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
  review: Annotation<ReviewState | undefined>({
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
  review: ReviewConfig;
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
    case "reviewer":
      return promptLoader.getReviewAgentPrompt();
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
    getReviewAgentPrompt: base.getReviewAgentPrompt.bind(base),
  };
}

function buildStageMessages(
  state: OrchestratedGraphState,
  instruction: string,
): OrchestratedDeepAgentMessage[] {
  const messages: OrchestratedDeepAgentMessage[] = [];
  const answers = state.clarification?.answeredInformation ?? [];
  const priorStageContext: Array<{ content?: string; label: string }> = [
    {
      content:
        answers.length > 0
          ? answers.map((answer) => `- ${answer.key}: ${answer.value}`).join("\n")
          : undefined,
      label: "Clarifications provided",
    },
    { content: state.researchResult, label: "Prior research" },
    { content: state.codeResult, label: "Prior implementation notes" },
    { content: state.criticResult, label: "Prior critique" },
  ];

  for (const context of priorStageContext) {
    if (context.content) {
      messages.push({
        role: "system",
        content: `${context.label}:\n${context.content}`,
      });
    }
  }
  messages.push({ role: "user", content: `${instruction}\n\nTask: ${state.task}` });
  return messages;
}

type StageRunResult = {
  output?: string;
  next: OrchestratedDeepAgentRoute;
  errors?: OrchestratedDeepAgentError[];
};

type StageNodeConfig = {
  role: OrchestratedDeepAgentRole;
  instruction: string;
  required: boolean;
  successRoute: OrchestratedDeepAgentRoute;
  assignOutput(update: Partial<OrchestratedGraphState>, output: string): void;
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

function routeAfterPrimaryStage(requireCritic: boolean | undefined): OrchestratedDeepAgentRoute {
  return requireCritic ? "critic" : "final";
}
//#endregion

//#region Routing between nodes

function routeToNextNode(state: OrchestratedGraphState, clarifyTarget: string): string {
  return nextNodeName(state.next, { clarifyTarget });
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

function createStageNode(ctx: NodeContext, config: StageNodeConfig) {
  return async (state: OrchestratedGraphState): Promise<Partial<OrchestratedGraphState>> => {
    const result = await runStageAgent(state, ctx, config.role, config.instruction, {
      required: config.required,
      successRoute: config.successRoute,
    });
    const update: Partial<OrchestratedGraphState> = { next: result.next };
    if (result.output !== undefined) {
      config.assignOutput(update, result.output);
    }
    if (result.errors) {
      update.errors = result.errors;
    }
    return update;
  };
}

function createResearchNode(ctx: NodeContext) {
  return createStageNode(ctx, {
    role: "researcher",
    instruction: "Produce concise findings with source notes and unresolved questions.",
    required: false,
    successRoute: routeAfterPrimaryStage(ctx.routing.requireCritic),
    assignOutput: (update, output) => {
      update.researchResult = output;
    },
  });
}

function createCodeNode(ctx: NodeContext) {
  return createStageNode(ctx, {
    role: "coder",
    instruction: "Produce implementation guidance, a changed-file plan, and risks.",
    required: false,
    successRoute: routeAfterPrimaryStage(ctx.routing.requireCritic),
    assignOutput: (update, output) => {
      update.codeResult = output;
    },
  });
}

function createCriticNode(ctx: NodeContext) {
  return createStageNode(ctx, {
    role: "critic",
    instruction:
      "Identify correctness risks, missing evidence, unsafe assumptions, and required revisions.",
    required: ctx.routing.requireCritic ?? false,
    successRoute: "final",
    assignOutput: (update, output) => {
      update.criticResult = output;
    },
  });
}

function createJudgeNode(ctx: NodeContext) {
  return createStageNode(ctx, {
    role: "judge",
    instruction:
      "Adjudicate the competing positions with a rubric and produce a grounded synthesis.",
    required: false,
    successRoute: routeAfterPrimaryStage(ctx.routing.requireCritic),
    assignOutput: (update, output) => {
      update.judgeResult = output;
    },
  });
}

//#region Review finalization gate

function buildReviewContextPacket(
  state: OrchestratedGraphState,
  candidate: string,
): OrchestratedDeepAgentMessage[] {
  const messages: OrchestratedDeepAgentMessage[] = [];
  messages.push({ role: "system", content: `Original user request:\n${state.task}` });

  if (state.researchResult) {
    messages.push({ role: "system", content: `Research performed:\n${state.researchResult}` });
  }
  if (state.codeResult) {
    messages.push({
      role: "system",
      content: `Implementation notes:\n${state.codeResult}`,
    });
  }
  if (state.criticResult) {
    messages.push({ role: "system", content: `Prior critique:\n${state.criticResult}` });
  }

  const errors = state.errors ?? [];
  if (errors.length > 0) {
    messages.push({
      role: "system",
      content: `Known limitations:\n${errors
        .map((entry) => `- [${entry.category}] ${entry.node}: ${entry.message}`)
        .join("\n")}`,
    });
  }

  messages.push({
    role: "user",
    content: `Review the following candidate final answer. Return the structured review report only.\n\nCandidate:\n${candidate}`,
  });
  return messages;
}

async function reviseCandidate(
  ctx: NodeContext,
  candidate: string,
  report: ReviewReport,
): Promise<string | null> {
  const reviser = ctx.agents.finalizer;
  if (!reviser) return null;

  try {
    const result = await reviser.invoke({
      messages: [
        {
          role: "system",
          content: `Required changes from review:\n${report.requiredChanges
            .map((change) => `- ${change}`)
            .join("\n")}`,
        },
        {
          role: "user",
          content: `Revise the following candidate to address every required change. Return only the revised final answer.\n\nCandidate:\n${candidate}`,
        },
      ],
    });
    const revised = extractStageOutput(result.messages);
    return revised || null;
  } catch {
    return null;
  }
}

type ReviewOutcome = {
  state: ReviewState;
  candidate: string;
  errors?: OrchestratedDeepAgentError[];
};

function reviewOutcome(
  state: ReviewState,
  candidate: string,
  errors?: OrchestratedDeepAgentError[],
): ReviewOutcome {
  return { state, candidate, errors };
}

async function runReviewLoop(
  ctx: NodeContext,
  state: OrchestratedGraphState,
  candidate: string,
): Promise<ReviewOutcome> {
  const maxRevisions = ctx.review.maxRevisions;
  let reviewState = createReviewState({ maxRevisions });
  const reviewer = resolveAgent(ctx, "reviewer");

  if (!reviewer) {
    return reviewOutcome(markReviewCaveated({ ...reviewState, status: "blocked" }), candidate, [
      missingAgentError("reviewer", false),
    ]);
  }

  let currentCandidate = candidate;

  for (let attempt = 1; attempt <= maxRevisions; attempt += 1) {
    reviewState = { ...reviewState, status: "review_requested" };

    let report: ReviewReport;
    try {
      const result = await reviewer.invoke({
        messages: buildReviewContextPacket(state, currentCandidate),
      });
      report = parseReviewReport(extractStageOutput(result.messages));
    } catch (error) {
      return reviewOutcome(
        markReviewCaveated({
          ...reviewState,
          status: "blocked",
          reviewCount: attempt,
        }),
        currentCandidate,
        [toStructuredError(error, "reviewer", { required: false })],
      );
    }

    reviewState = recordReviewReport(reviewState, report, attempt);

    switch (report.status) {
      case "approved":
        return reviewOutcome({ ...reviewState, status: "approved" }, currentCandidate);
      case "blocked":
        return reviewOutcome(markReviewCaveated(reviewState), currentCandidate);
      case "changes_required":
        if (attempt < maxRevisions) {
          const revised = await reviseCandidate(ctx, currentCandidate, report);
          if (revised !== null) {
            currentCandidate = revised;
            break;
          }
          return reviewOutcome(markReviewCaveated(reviewState), currentCandidate);
        }
        break;
    }
  }

  return reviewOutcome(markReviewCaveated(reviewState), currentCandidate);
}

function composeCaveatedAnswer(candidate: string, reviewState: ReviewState): string {
  const report = reviewState.report;
  const lines: string[] = [];

  if (reviewState.status === "blocked") {
    lines.push("Review could not approve this result (blocked).");
  } else if (reviewState.status === "changes_required") {
    lines.push(
      `Review required changes after ${reviewState.reviewCount} review pass(es); the review loop limit (${reviewState.maxRevisions}) was reached without approval.`,
    );
  } else {
    lines.push("Review did not approve this result.");
  }

  if (report?.requiredChanges.length) {
    lines.push(
      `Required changes:\n${report.requiredChanges.map((change) => `- ${change}`).join("\n")}`,
    );
  }
  if (report?.finalRecommendation) {
    lines.push(`Reviewer recommendation: ${report.finalRecommendation}`);
  }

  return `${candidate}\n\n## Review Caveats\nThis result was NOT approved by review.\n${lines.join("\n")}`.trim();
}

function createFinalizerNode(ctx: NodeContext) {
  return async (state: OrchestratedGraphState): Promise<Partial<OrchestratedGraphState>> => {
    const draft = composeFinalAnswer(state);
    const errors: OrchestratedDeepAgentError[] = [];

    let candidate = draft;
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
        if (refined) candidate = refined;
      } catch (error) {
        errors.push(toStructuredError(error, "finalizer", { required: false }));
      }
    }

    const outcome = await runReviewLoop(ctx, state, candidate);
    if (outcome.errors) errors.push(...outcome.errors);

    const finalAnswer = outcome.state.caveated
      ? composeCaveatedAnswer(outcome.candidate, outcome.state)
      : outcome.candidate;

    const update: Partial<OrchestratedGraphState> = {
      finalAnswer,
      review: outcome.state,
      next: "end",
    };
    if (errors.length > 0) update.errors = errors;
    return update;
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
    review: createReviewConfig(options.review),
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
    .addConditionalEdges("route_intake", (state) => routeToNextNode(state, "clarify"))
    .addConditionalEdges("clarify", (state) => routeToNextNode(state, END))
    .addConditionalEdges("research", (state) => routeToNextNode(state, END))
    .addConditionalEdges("code", (state) => routeToNextNode(state, END))
    .addConditionalEdges("critic", (state) => routeToNextNode(state, END))
    .addConditionalEdges("judge", (state) => routeToNextNode(state, END))
    .addEdge("finalizer", END);

  return builder.compile();
}

//#endregion
