import { describe, expect, it } from "bun:test";
import { StateBackend } from "deepagents";
import type { AgentMiddleware } from "langchain";
import { createAgentFromRuntimeScaffold } from "../src/agent/runtime.ts";
import {
  connectLinkloomResearchTools,
  createAppConfig,
  createDefaultSubagentCatalog,
  createRuntimeScaffold,
} from "../src/index.ts";
import {
  type AgentInvokeResult,
  createDefaultModelRuntime,
  findTaskToolMessage,
  hasLiveLLMCredentials,
  type TaskToolMessage,
} from "./helpers.ts";

const RESEARCH_URL = "https://docs.langchain.com/langsmith/managed-deep-agents-quickstart";

const RESEARCH_PROMPT = [
  `Research the following URL: ${RESEARCH_URL}`,
  "",
  "Delegate this to your researcher subagent and relay its findings back unchanged.",
  "The researcher must:",
  "1. Use the `scrape` tool exactly once with the URL.",
  "2. Use the `extract_links` tool exactly once with `{ input: <scrape result>, isHtml: false }`.",
  "3. Report the extracted links back to the supervisor as a list of URLs.",
  "Do not call `scrape` more than once.",
  "Do not summarize or invent links; only report links actually extracted from the page.",
].join("\n");

const RESEARCHER_SYSTEM_PROMPT = [
  "You are a deterministic Linkloom extraction worker.",
  "For this test, use only the `scrape` and `extract_links` tools.",
  "Call `scrape` exactly once with the requested URL.",
  "Then call `extract_links` exactly once with the full scrape result as the `input` field and `isHtml: false`.",
  "Never call `scrape` a second time. Never write files or run code.",
  "Return only the extracted URLs.",
].join("\n");

const RESEARCH_SUPERVISOR_PROMPT = [
  "You are a deterministic researcher supervisor for a live e2e test.",
  "Use the `task` tool exactly once with `subagent_type: researcher`.",
  "Relay the researcher result unchanged.",
].join("\n");

const LINKLOOM_EXTRACTION_TOOLS = new Set(["scrape", "extract_links"]);
const REPORT_PATH = "/reports/kanban_board_research_report.md";
const REPORT_MARKER = "KANBAN_RESEARCH_REPORT_CREATED";

const FILE_WRITING_RESEARCHER_PROMPT = [
  "You are a deterministic report writer.",
  `Use write_file exactly once to create ${REPORT_PATH}.`,
  `The file content must include ${REPORT_MARKER}.`,
  "Return the exact file path and marker after the tool succeeds.",
  "Never use /home/user or any other host path.",
].join("\n");

const FILE_WRITING_SUPERVISOR_PROMPT = [
  "You are a deterministic research supervisor.",
  "Use the task tool exactly once with subagent_type researcher.",
  "Ask the researcher to create the requested report, then relay its result unchanged.",
].join("\n");

const linkloomExtractionOnlyMiddleware: AgentMiddleware = {
  name: "LinkloomExtractionOnlyMiddleware",
  wrapModelCall: async (request, handler) =>
    handler({
      ...request,
      tools: request.tools?.filter(
        (tool) => typeof tool.name === "string" && LINKLOOM_EXTRACTION_TOOLS.has(tool.name),
      ),
    }),
};

function stringifyTaskContent(message: TaskToolMessage | undefined): string {
  if (!message) {
    throw new Error("No task tool message was found in the agent result.");
  }
  const content = message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") return block;
        if (block && typeof block === "object") {
          const text = (block as { text?: unknown }).text;
          if (typeof text === "string") return text;
        }
        return "";
      })
      .join("\n");
  }
  return content == null ? "" : JSON.stringify(content);
}

describe.skipIf(!hasLiveLLMCredentials)(
  "createRuntimeScaffold researcher live Linkloom extraction",
  () => {
    it("uses the researcher to scrape a URL's markdown and report its extracted links", async () => {
      createAppConfig();
      const linkloom = await connectLinkloomResearchTools();
      try {
        const modelRuntime = createDefaultModelRuntime(false);
        const researcher = createDefaultSubagentCatalog({
          modelRuntime,
          researcher: {
            systemPrompt: RESEARCHER_SYSTEM_PROMPT,
            tools: [...linkloom.tools],
            middleware: [linkloomExtractionOnlyMiddleware],
          },
        }).byRole.researcher;
        if (!researcher) {
          throw new Error("createDefaultSubagentCatalog did not produce a researcher subagent.");
        }

        const scaffold = createRuntimeScaffold({
          backend: new StateBackend(),
          modelRuntime,
          systemPrompt: RESEARCH_SUPERVISOR_PROMPT,
          subagents: [researcher],
        });
        if (scaffold.subagents.length !== 1) {
          throw new Error("createRuntimeScaffold did not surface exactly one subagent.");
        }

        const agent = createAgentFromRuntimeScaffold({
          factoryName: "createScaffoldedAgent",
          scaffold,
          modelRuntime,
          guardrails: false,
        });

        const result = (await agent.invoke({
          messages: [{ role: "user", content: RESEARCH_PROMPT }],
        })) as AgentInvokeResult;

        const report = stringifyTaskContent(findTaskToolMessage(result.messages));

        expect(report.length).toBeGreaterThan(0);
        expect(report).toMatch(/https?:\/\/\S+/i);
        expect(report.toLowerCase()).toContain("langchain.com");
      } finally {
        await linkloom.close();
      }
    }, 120_000);
  },
);

describe.skipIf(!hasLiveLLMCredentials)("researcher virtual filesystem live writing", () => {
  it("creates the requested report under /reports", async () => {
    const modelRuntime = createDefaultModelRuntime(false);
    const researcher = createDefaultSubagentCatalog({
      modelRuntime,
      researcher: { systemPrompt: FILE_WRITING_RESEARCHER_PROMPT, tools: [] },
    }).byRole.researcher;
    if (!researcher) {
      throw new Error("createDefaultSubagentCatalog did not produce a researcher subagent.");
    }

    const scaffold = createRuntimeScaffold({
      backend: new StateBackend(),
      modelRuntime,
      systemPrompt: FILE_WRITING_SUPERVISOR_PROMPT,
      subagents: [researcher],
    });
    const agent = createAgentFromRuntimeScaffold({
      factoryName: "createScaffoldedAgent",
      scaffold,
      modelRuntime,
      guardrails: false,
    });

    const result = (await agent.invoke({
      messages: [
        {
          role: "user",
          content: `Create ${REPORT_PATH} containing ${REPORT_MARKER}.`,
        },
      ],
    })) as AgentInvokeResult;
    const taskCalls = (result.messages ?? []).filter(
      (message) =>
        typeof message === "object" &&
        message !== null &&
        "name" in message &&
        message.name === "task" &&
        "tool_call_id" in message,
    );
    expect(taskCalls).toHaveLength(1);
    expect(result.files?.[REPORT_PATH]).toBeDefined();
    expect(JSON.stringify(result.files?.[REPORT_PATH])).toContain(REPORT_MARKER);
    expect(
      Object.keys(result.files ?? {}).some((path) => path.startsWith("/home/user/")),
    ).toBeFalse();
  }, 120_000);
});
