import {
  DEFAULT_RESOURCE_PROFILE,
  type SandboxBackend,
  type SandboxExecutionIdentity,
  type SandboxResourceProfile,
  type SandboxResult,
} from "@deep-agent-template/sandbox";
import type { StructuredTool } from "@langchain/core/tools";
import { tool } from "@langchain/core/tools";
import { context, SpanStatusCode, type Tracer, trace } from "@opentelemetry/api";
import { z } from "zod";

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
type PythonSandboxToolMode =
  | { readonly identity: SandboxExecutionIdentity; readonly singleUser?: never }
  | { readonly singleUser: true; readonly identity?: never };

export type CreatePythonSandboxToolOptions = {
  readonly backend: SandboxBackend;
  readonly defaultResourceProfile?: SandboxResourceProfile;
} & PythonSandboxToolMode;

const SANDBOX_TRACER_NAME = "@deep-agent-template/core";
let cachedTracer: Tracer | undefined;
function tracer(): Tracer {
  // getTracer is cheap and internally cached by the API; still, avoid repeated
  // lookups on the hot path.
  if (cachedTracer === undefined) {
    cachedTracer = trace.getTracer(SANDBOX_TRACER_NAME);
  }
  return cachedTracer;
}

/**
 * Build the LangChain `execute_python` tool that runs Python via the provided
 * {@link SandboxBackend}. The tool always returns a {@link SandboxResult}
 * envelope (even on failure) so the agent sees structured output rather than
 * an exception.
 *
 * The tool name is `execute_python` so it fires the existing
 * `interruptOn.execute_python` slot reserved in `scaffold/runtime.ts`. This
 * avoids colliding with the built-in `execute` (shell) tool reserved by
 * `deepagents`'s `BUILTIN_TOOL_NAMES`.
 *
 * @example
 *   const tool = createPythonSandboxTool({
 *     backend: createDockerSandboxBackend(),
 *     singleUser: true,
 *     defaultResourceProfile: "sandbox-small",
 *   });
 */
export function createPythonSandboxTool(options: CreatePythonSandboxToolOptions): StructuredTool {
  assertPythonSandboxToolMode(options);
  const backend = options.backend;
  const defaultResourceProfile = options.defaultResourceProfile ?? DEFAULT_RESOURCE_PROFILE;
  const identity = options.identity;

  return tool(
    async (input: PythonSandboxToolInput): Promise<SandboxResult> => {
      const executionId = `exec-${crypto.randomUUID()}`;
      // Emit a host-side span so execute_python appears in the OTel trace
      // tree as a child of the enclosing agent.run span. With no SDK
      // registered, the tracer is a no-op and this adds negligible overhead.
      const span = tracer().startSpan("sandbox.execute_python");
      span.setAttribute("sandbox.execution_id", executionId);
      if (input.resourceProfile)
        span.setAttribute("sandbox.resource_profile", input.resourceProfile);
      if (identity) {
        span.setAttribute("tenant.id", identity.tenantId);
        span.setAttribute("user.id", identity.userId);
      }
      try {
        const result = await context.with(trace.setSpan(context.active(), span), () =>
          backend.execute(
            {
              code: input.code,
              stdin: input.stdin,
              argv: input.argv,
              resourceProfile: input.resourceProfile ?? defaultResourceProfile,
              timeoutSeconds: input.timeoutSeconds,
            },
            { executionId, identity },
          ),
        );
        const identityMatches =
          identity === undefined
            ? result.identity === undefined
            : result.identity?.tenantId === identity.tenantId &&
              result.identity.userId === identity.userId;
        if (result.executionId !== executionId || !identityMatches) {
          const mismatch = new Error("Sandbox backend returned mismatched correlation fields.");
          span.recordException(mismatch);
          const sanitized = internalErrorResult({
            executionId,
            identity,
            resourceProfile: input.resourceProfile ?? defaultResourceProfile,
            backend: backend.name,
            failureClass: "result_mismatch",
            retryable: false,
            message: "Sandbox result correlation failed.",
          });
          markSpanFailed(span, sanitized);
          return sanitized;
        }
        span.setAttribute("sandbox.status", result.status);
        span.setAttribute("sandbox.exit_code", result.exitCode ?? -1);
        span.setAttribute("sandbox.backend", result.backend);
        if (result.status !== "succeeded") {
          span.setStatus({ code: SpanStatusCode.ERROR, message: result.failureMessage });
        } else {
          span.setStatus({ code: SpanStatusCode.OK });
        }
        return result;
      } catch (error) {
        span.recordException(error instanceof Error ? error : new Error(String(error)));
        const sanitized = internalErrorResult({
          executionId,
          identity,
          resourceProfile: input.resourceProfile ?? defaultResourceProfile,
          backend: backend.name,
          failureClass: "internal_error",
          retryable: true,
          message: "Sandbox execution failed internally.",
        });
        markSpanFailed(span, sanitized);
        return sanitized;
      } finally {
        span.end();
      }
    },
    {
      name: "execute_python",
      description:
        "Execute Python code in an isolated sandbox. Network access is disabled by default; " +
        "dependencies are frozen to the container image. Returns a structured result envelope " +
        "with stdout, stderr, exit code, any artifacts written to the workspace, and a failure " +
        "classification. Always returns a result — does not throw on Python errors.",
      schema: pythonSandboxInputSchema,
    },
  );
}

function assertPythonSandboxToolMode(options: CreatePythonSandboxToolOptions): void {
  const hasIdentity = options.identity !== undefined;
  const isSingleUser = options.singleUser === true;
  if (hasIdentity === isSingleUser) {
    throw new Error(
      "createPythonSandboxTool requires exactly one of identity or singleUser: true.",
    );
  }
  if (
    options.identity &&
    (options.identity.tenantId.trim() === "" || options.identity.userId.trim() === "")
  ) {
    throw new Error("createPythonSandboxTool identity requires non-empty tenantId and userId.");
  }
}

function internalErrorResult(input: {
  executionId: string;
  identity?: SandboxExecutionIdentity;
  resourceProfile: SandboxResourceProfile;
  backend: string;
  failureClass: "result_mismatch" | "internal_error";
  retryable: boolean;
  message: string;
}): SandboxResult {
  const now = new Date().toISOString();
  return {
    executionId: input.executionId,
    identity: input.identity,
    status: "internal_error",
    exitCode: null,
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
    stdout: "",
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
    artifacts: [],
    failureClass: input.failureClass,
    failureMessage: input.message,
    retryable: input.retryable,
    resourceProfile: input.resourceProfile,
    backend: input.backend,
  };
}

function markSpanFailed(span: ReturnType<Tracer["startSpan"]>, result: SandboxResult): void {
  span.setAttribute("sandbox.status", result.status);
  span.setAttribute("sandbox.backend", result.backend);
  span.setStatus({ code: SpanStatusCode.ERROR, message: result.failureMessage });
}
