import {
  DEFAULT_RESOURCE_PROFILE,
  type SandboxBackend,
  type SandboxResourceProfile,
  type SandboxResult,
} from "@deep-agent-template/sandbox";
import type { StructuredTool } from "@langchain/core/tools";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { SpecializedToolDefinition } from "../tools/types.ts";

/**
 * Input schema for the {@link createPythonSandboxTool} tool. Mirrors the
 * backend-agnostic subset of {@link SandboxRequest}.
 */
export const pythonSandboxInputSchema = z.object({
  code: z.string().min(1).describe("The Python code to execute. Runs as a top-level script."),
  stdin: z.string().optional().describe("Optional string piped to the script's stdin."),
  argv: z
    .array(z.string())
    .optional()
    .describe("Optional argv passed to the script (visible as sys.argv[1:])."),
  resourceProfile: z
    .enum(["sandbox-small", "sandbox-medium", "sandbox-large"])
    .optional()
    .describe(
      "Resource profile determining CPU, memory, timeout, and output caps. " +
        'Defaults to "sandbox-small".',
    ),
  timeoutSeconds: z
    .number()
    .int()
    .positive()
    .max(300)
    .optional()
    .describe(
      "Override the profile's timeout. Clamped to the profile ceiling; " + "must be <= 300.",
    ),
});

export type PythonSandboxToolInput = z.infer<typeof pythonSandboxInputSchema>;

/**
 * Options for {@link createPythonSandboxTool}.
 *
 * The backend is **required** — the tool never picks a default. This forces
 * the choice (and its isolation tradeoffs) to be explicit at composition time.
 */
export type CreatePythonSandboxToolOptions = {
  readonly backend: SandboxBackend;
  readonly defaultResourceProfile?: SandboxResourceProfile;
};

/**
 * Build the LangChain `execute` tool that runs Python via the provided
 * {@link SandboxBackend}. The tool always returns a {@link SandboxResult}
 * envelope (even on failure) so the agent sees structured output rather than
 * an exception.
 *
 * The tool name is `execute` so it fires the existing `interruptOn.execute`
 * slot reserved in `scaffold/runtime.ts`.
 *
 * @example
 *   const tool = createPythonSandboxTool({
 *     backend: createDockerSandboxBackend(),
 *     defaultResourceProfile: "sandbox-small",
 *   });
 */
export function createPythonSandboxTool(options: CreatePythonSandboxToolOptions): StructuredTool {
  const backend = options.backend;
  const defaultResourceProfile = options.defaultResourceProfile ?? DEFAULT_RESOURCE_PROFILE;

  return tool(
    async (input: PythonSandboxToolInput): Promise<SandboxResult> => {
      const executionId = `exec-${crypto.randomUUID()}`;
      return backend.execute(
        {
          code: input.code,
          stdin: input.stdin,
          argv: input.argv,
          resourceProfile: input.resourceProfile ?? defaultResourceProfile,
          timeoutSeconds: input.timeoutSeconds,
        },
        { executionId },
      );
    },
    {
      name: "execute",
      description:
        "Execute Python code in an isolated sandbox. Network access is disabled by default; " +
        "dependencies are frozen to the container image. Returns a structured result envelope " +
        "with stdout, stderr, exit code, any artifacts written to the workspace, and a failure " +
        "classification. Always returns a result — does not throw on Python errors.",
      schema: pythonSandboxInputSchema,
    },
  );
}

/**
 * Build a ready-to-register {@link SpecializedToolDefinition} for the
 * `analyst` specialist role. The definition carries the metadata the existing
 * `SpecializedToolStore` was designed for:
 *   - `riskLevel: "restricted"` — `roleHasRestrictedTools("analyst")` returns true.
 *   - `evidenceMode: "execution"` — flags this as a code-execution tool.
 *
 * @example
 *   const definition = createPythonSandboxToolDefinition({
 *     backend: createDockerSandboxBackend(),
 *   });
 *   const store = createSpecializedToolStore({
 *     tools: [definition],
 *     roles: createDefaultSpecialistRoleToolsets().map((r) =>
 *       r.role === "analyst" ? { ...r, toolIds: ["python-sandbox"] } : r,
 *     ),
 *   });
 */
export function createPythonSandboxToolDefinition(
  options: CreatePythonSandboxToolOptions,
): SpecializedToolDefinition<"analyst"> {
  const definition: SpecializedToolDefinition<"analyst"> = {
    id: "python-sandbox",
    tool: createPythonSandboxTool(options),
    specialists: ["analyst"],
    riskLevel: "restricted",
    evidenceMode: "execution",
  };
  return Object.freeze(definition);
}
