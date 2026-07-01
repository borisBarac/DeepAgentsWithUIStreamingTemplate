import { describe, expect, it } from "bun:test";
import { StateBackend } from "deepagents";
import type { AgentMiddleware } from "langchain";

import {
  connectLinkloomResearchTools,
  createAppConfig,
  createDefaultSubagentCatalog,
  createRuntimeScaffold,
  createScaffoldedAgent,
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

const LINKLOOM_EXTRACTION_TOOLS = new Set(["scrape", "extract_links"]);

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
          subagents: [researcher],
        });
        if (scaffold.subagents.length !== 1) {
          throw new Error("createRuntimeScaffold did not surface exactly one subagent.");
        }

        const agent = createScaffoldedAgent({
          backend: scaffold.backend,
          modelRuntime,
          permissions: scaffold.permissions,
          guardrails: false,
          subagents: scaffold.subagents,
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
