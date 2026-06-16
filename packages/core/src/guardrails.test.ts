import { describe, expect, it } from "bun:test";

import { createBasicAgent } from "./agent";
import {
  contentSafetyGuardrail,
  createDefaultGuardrails,
  createSafetyGuardrail,
  createTaskScopeGuardrail,
  DEFAULT_GUARDRAIL_POLICY_LOADER,
  DEFAULT_SAFETY_GUARDRAIL_NAME,
  DEFAULT_TASK_SCOPE_GUARDRAIL_NAME,
  MarkdownGuardrailPolicyLoader,
  type OpenAIContentSafetyClient,
  type TaskScopeClassifier,
} from "./guardrails";

type HookableMiddleware = {
  name: string;
  beforeAgent: {
    hook(state: { messages: Array<{ role: string; content: string }> }): Promise<unknown>;
  };
};

function asHookable(middleware: unknown): HookableMiddleware {
  return middleware as HookableMiddleware;
}

function createFakeOpenAI(flagged: boolean): OpenAIContentSafetyClient {
  return {
    moderations: {
      create: async () => ({
        id: "modr-test",
        model: "omni-moderation-latest",
        results: [
          {
            flagged,
            categories: {},
            category_scores: {},
          },
        ],
      }),
    },
  } as unknown as OpenAIContentSafetyClient;
}

describe("guardrail policies", () => {
  it("loads task-scope policy from markdown", () => {
    const loader = new MarkdownGuardrailPolicyLoader();

    expect(loader.getRequiredContextPolicy()).toContain("Required Context");
    expect(loader.getAllowedTasksPolicy()).toContain("Allowed Tasks");
    expect(loader.getDisallowedTasksPolicy()).toContain("Disallowed Tasks");
  });

  it("exports the default markdown policy loader", () => {
    expect(DEFAULT_GUARDRAIL_POLICY_LOADER.getAllowedTasksPolicy()).toContain(
      "Deep Agent Template project",
    );
  });
});

describe("createSafetyGuardrail", () => {
  it("blocks flagged moderation results before the agent runs", async () => {
    const middleware = asHookable(createSafetyGuardrail({ openai: createFakeOpenAI(true) }));

    const result = await middleware.beforeAgent.hook({
      messages: [{ role: "user", content: "unsafe request" }],
    });

    expect(JSON.stringify(result)).toContain("unsafe content");
  });

  it("allows unflagged moderation results", async () => {
    const middleware = asHookable(createSafetyGuardrail({ openai: createFakeOpenAI(false) }));

    const result = await middleware.beforeAgent.hook({
      messages: [{ role: "user", content: "summarize this file" }],
    });

    expect(result).toBeUndefined();
  });
});

describe("createTaskScopeGuardrail", () => {
  it("blocks out-of-scope requests using the structured classifier", async () => {
    const classifier: TaskScopeClassifier = {
      invoke: async () => ({
        inScope: false,
        missingContext: [],
        violatedRules: ["outside project"],
        reason: "The request is unrelated to this project.",
      }),
    };
    const middleware = asHookable(createTaskScopeGuardrail({ classifier }));

    const result = await middleware.beforeAgent.hook({
      messages: [{ role: "user", content: "book me a flight" }],
    });

    expect(JSON.stringify(result)).toContain("I cannot help with that request");
  });

  it("allows in-scope requests", async () => {
    const classifier: TaskScopeClassifier = {
      invoke: async () => ({
        inScope: true,
        missingContext: [],
        violatedRules: [],
        reason: "The request targets this repository.",
      }),
    };
    const middleware = asHookable(createTaskScopeGuardrail({ classifier }));

    const result = await middleware.beforeAgent.hook({
      messages: [{ role: "user", content: "add guardrail tests" }],
    });

    expect(result).toBeUndefined();
  });
});

describe("createDefaultGuardrails", () => {
  it("creates safety and task-scope middleware in order", () => {
    const classifier: TaskScopeClassifier = {
      invoke: async () => ({
        inScope: true,
        missingContext: [],
        violatedRules: [],
        reason: "ok",
      }),
    };

    const middleware = createDefaultGuardrails({
      safety: {
        openai: createFakeOpenAI(false),
      },
      taskScope: { classifier },
    });

    expect(middleware.map((item) => item.name)).toEqual([
      DEFAULT_SAFETY_GUARDRAIL_NAME,
      DEFAULT_TASK_SCOPE_GUARDRAIL_NAME,
    ]);
  });

  it("can be disabled", () => {
    expect(createDefaultGuardrails({ enabled: false })).toEqual([]);
  });

  it("can be created directly without a task-scope model", () => {
    const middleware = createDefaultGuardrails({
      safety: {
        openai: createFakeOpenAI(false),
      },
    });

    expect(middleware.map((item) => item.name)).toEqual([DEFAULT_SAFETY_GUARDRAIL_NAME]);
  });
});

describe("agent guardrail integration", () => {
  it("adds default guardrails to scaffolded agents before caller middleware", () => {
    const callerMiddleware = { name: "CallerMiddleware" };
    const agent = createBasicAgent({
      guardrails: {
        safety: { openai: createFakeOpenAI(false) },
      },
      openRouter: {
        apiKey: "test-key",
      },
      middleware: [callerMiddleware],
    });
    const names = agent.options.middleware?.map((middleware) => middleware.name);

    expect(names).toContain(DEFAULT_SAFETY_GUARDRAIL_NAME);
    expect(names).toContain(DEFAULT_TASK_SCOPE_GUARDRAIL_NAME);
    expect(names?.indexOf(DEFAULT_SAFETY_GUARDRAIL_NAME)).toBeLessThan(
      names?.indexOf(DEFAULT_TASK_SCOPE_GUARDRAIL_NAME) ?? Number.POSITIVE_INFINITY,
    );
    expect(names?.indexOf(DEFAULT_TASK_SCOPE_GUARDRAIL_NAME)).toBeLessThan(
      names?.indexOf("CallerMiddleware") ?? Number.POSITIVE_INFINITY,
    );
  });

  it("lets callers disable default guardrails", () => {
    const agent = createBasicAgent({
      guardrails: false,
      openRouter: {
        apiKey: "test-key",
      },
    });
    const names = agent.options.middleware?.map((middleware) => middleware.name) ?? [];

    expect(names).not.toContain(DEFAULT_SAFETY_GUARDRAIL_NAME);
    expect(names).not.toContain(DEFAULT_TASK_SCOPE_GUARDRAIL_NAME);
  });
});

describe("contentSafetyGuardrail", () => {
  it("uses the OpenAI moderation client directly", async () => {
    const middleware = asHookable(contentSafetyGuardrail(createFakeOpenAI(true)));

    const result = await middleware.beforeAgent.hook({
      messages: [{ role: "user", content: "unsafe request" }],
    });

    expect(JSON.stringify(result)).toContain("unsafe content");
  });
});
