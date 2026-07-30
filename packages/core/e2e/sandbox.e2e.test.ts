import { describe, expect, it } from "bun:test";
import { createSandboxMcpServer, startSandboxHttpServer } from "@deep-agent-template/sandbox";
import {
  connectSandboxTools,
  createDockerSandboxBackend,
  type SandboxResult,
} from "../src/index.ts";

const PYTHON_IMAGE = process.env.SANDBOX_TEST_PYTHON_IMAGE ?? "python:3.12-alpine";
const RESULT_MARKER = "SANDBOX_E2E_RESULT=42";
const DOCKER_AVAILABLE = await checkDockerAvailable();

describe.skipIf(!DOCKER_AVAILABLE)("sandbox MCP execution", () => {
  it("executes Python through the MCP tool", async () => {
    const http = await startSandboxHttpServer(
      createSandboxMcpServer({
        backend: createDockerSandboxBackend({ pythonImage: PYTHON_IMAGE }),
      }),
      { host: "127.0.0.1", port: 0 },
    );
    const connection = await connectSandboxTools({
      url: `http://127.0.0.1:${http.port}/mcp`,
    });
    try {
      const tool = connection.tools.find((candidate) => candidate.name === "execute_python");
      if (!tool) throw new Error("Sandbox MCP did not expose execute_python.");
      const response = await tool.invoke({ code: `print(${JSON.stringify(RESULT_MARKER)})` });
      const sandboxResult = parseSandboxResult(response);

      expect(sandboxResult.status).toBe("succeeded");
      expect(sandboxResult.exitCode).toBe(0);
      expect(sandboxResult.stdout.trim()).toBe(RESULT_MARKER);
      expect(sandboxResult.stderr).toBe("");
      expect("backend" in sandboxResult).toBeFalse();
    } finally {
      await connection.close();
      await http.stop();
    }
  }, 120_000);
});

function parseSandboxResult(response: unknown): Omit<SandboxResult, "artifacts" | "backend"> {
  if (typeof response === "string")
    return JSON.parse(response) as Omit<SandboxResult, "artifacts" | "backend">;
  const content = response as { content?: unknown };
  const text = Array.isArray(content.content)
    ? content.content.find((part) => typeof part === "object" && part && "text" in part)
    : undefined;
  const payload =
    typeof text === "object" && text && "text" in text ? JSON.parse(String(text.text)) : text;
  if (!payload || typeof payload !== "object") {
    throw new Error(
      `The execute tool did not return a structured sandbox result: ${JSON.stringify(response)}`,
    );
  }
  return payload as Omit<SandboxResult, "artifacts" | "backend">;
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
