import { describe, expect, it } from "bun:test";

import {
  createDockerSandboxBackend,
  createPythonSandboxTool,
  createScaffoldedAgent,
  type SandboxResult,
} from "../src/index.ts";
import {
  type AgentInvokeResult,
  createDefaultModelRuntime,
  hasLiveLLMCredentials,
} from "./helpers.ts";

const PYTHON_IMAGE = process.env.SANDBOX_TEST_PYTHON_IMAGE ?? "python:3.12-alpine";
const RESULT_MARKER = "SANDBOX_E2E_RESULT=42";
const DOCKER_AVAILABLE = await checkDockerAvailable();

const EXECUTION_PROMPT = [
  "Use the execute_python tool to run Python code in the sandbox.",
  `The Python code must print exactly ${RESULT_MARKER}.`,
  "Do not calculate or simulate the result yourself; you must call the tool before answering.",
].join("\n");

type ExecuteToolMessage = {
  name?: string;
  content?: unknown;
  tool_call_id?: string;
};

describe.skipIf(!hasLiveLLMCredentials || !DOCKER_AVAILABLE)(
  "scaffolded agent live Python sandbox execution",
  () => {
    it("uses deepseek-v4-flash to execute Python through the sandbox tool", async () => {
      const execute = createPythonSandboxTool({
        backend: createDockerSandboxBackend({ pythonImage: PYTHON_IMAGE }),
      });
      const agent = createScaffoldedAgent({
        modelRuntime: createDefaultModelRuntime(false),
        guardrails: false,
        interruptOn: { execute_python: false },
        tools: [execute],
      });

      const result = (await agent.invoke({
        messages: [{ role: "user", content: EXECUTION_PROMPT }],
      })) as AgentInvokeResult;

      const toolMessage = findExecuteToolMessage(result.messages);
      const sandboxResult = parseSandboxResult(toolMessage);

      expect(toolMessage?.tool_call_id).toBeString();
      expect(sandboxResult.status).toBe("succeeded");
      expect(sandboxResult.exitCode).toBe(0);
      expect(sandboxResult.backend).toBe("docker");
      expect(sandboxResult.stdout.trim()).toBe(RESULT_MARKER);
      expect(sandboxResult.stderr).toBe("");
    }, 120_000);
  },
);

function findExecuteToolMessage(messages: unknown[] | undefined): ExecuteToolMessage | undefined {
  if (!messages) return undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as ExecuteToolMessage | undefined;
    if (message?.name === "execute_python" && typeof message.tool_call_id === "string") {
      return message;
    }
  }
  return undefined;
}

function parseSandboxResult(message: ExecuteToolMessage | undefined): SandboxResult {
  if (!message) {
    throw new Error("The agent did not invoke the execute_python tool.");
  }

  const payload =
    typeof message.content === "string" ? JSON.parse(message.content) : message.content;
  if (!payload || typeof payload !== "object") {
    throw new Error("The execute tool did not return a structured sandbox result.");
  }
  return payload as SandboxResult;
}

async function checkDockerAvailable(): Promise<boolean> {
  if (process.env.DOCKER_AVAILABLE === "0" || process.env.DOCKER_AVAILABLE === "false") {
    return false;
  }
  try {
    const proc = Bun.spawn({
      cmd: ["docker", "info"],
      stdout: "ignore",
      stderr: "ignore",
    });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}
