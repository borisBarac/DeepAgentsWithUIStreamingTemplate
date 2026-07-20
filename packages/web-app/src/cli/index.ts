import { type CliOptions, formatHelp } from "./args.ts";
import { type AgentHttpError, streamAgentUpdates } from "./http-client.ts";
import {
  type RenderLine,
  renderActivitySummary,
  renderHistory,
  renderUiSpecs,
  renderUpdate,
} from "./render.ts";
import { SessionState } from "./session-state.ts";

export type RunResult = {
  exitCode: number;
  errorMessage: string | null;
};

export type RunDeps = {
  env?: Record<string, string | undefined>;
  stdin?: { input?: NodeJS.ReadableStream; isTTY?: boolean; read: () => Promise<string> };
  stdout?: { isTTY?: boolean; write: (text: string) => void };
};

const DEFAULT_BASE_URL = "http://localhost:3000";

function resolveOutputFormat(options: CliOptions, deps: RunDeps): "ndjson" | "pretty" {
  if (options.outputFormat === "ndjson") return "ndjson";
  if (options.outputFormat === "pretty") return "pretty";
  return deps.stdout?.isTTY ? "pretty" : "ndjson";
}

function emit(lines: RenderLine[], sink: (text: string) => void): void {
  for (const line of lines) {
    sink(line.kind === "ndjson" ? `${line.text}\n` : `${line.text}\n`);
  }
}

async function readStdinFully(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function createDefaultDeps(deps: Partial<RunDeps> = {}): RunDeps {
  return {
    env: process.env,
    stdin: {
      input: process.stdin,
      isTTY: process.stdin.isTTY,
      read: readStdinFully,
    },
    stdout: {
      isTTY: process.stdout.isTTY,
      write: (text: string) => {
        process.stdout.write(text);
      },
    },
    ...deps,
  };
}

export async function runOneShot(options: CliOptions, deps: RunDeps): Promise<RunResult> {
  const format = resolveOutputFormat(options, deps);
  const session = new SessionState({
    sessionId: options.session ?? createId(),
  });

  const message = await resolveMessage(options, deps);
  if (message === null) {
    deps.stdout?.write("No message provided. Pass a message, --file <path>, or pipe via stdin.\n");
    deps.stdout?.write(formatHelp());
    return { errorMessage: "No message provided.", exitCode: 2 };
  }

  return sendTurn(options, deps, session, message, format);
}

async function resolveMessage(options: CliOptions, deps: RunDeps): Promise<string | null> {
  if (options.message !== null) return options.message;
  if (options.messageFile) {
    const file = Bun.file(options.messageFile);
    if (!(await file.exists())) {
      throw new Error(`--file not found: ${options.messageFile}`);
    }
    const text = await file.text();
    return text.trim();
  }
  if (!deps.stdin?.isTTY) {
    const text = await deps.stdin?.read();
    if (text?.trim()) return text.trim();
  }
  return null;
}

export async function sendTurn(
  options: CliOptions,
  deps: RunDeps,
  session: SessionState,
  userText: string,
  format: "ndjson" | "pretty",
): Promise<RunResult> {
  const payload = session.composeNextMessage(userText);
  session.beginUserMessage(payload);

  let exitCode = 0;
  let errorMessage: string | null = null;
  let hadErrorUpdate = false;

  const write = deps.stdout?.write ?? ((text: string) => console.log(text));

  if (format === "pretty") {
    write(`[session ${session.sessionId}] → ${payload}\n`);
  }

  await streamAgentUpdates(
    {
      baseUrl: options.baseUrl,
      includeActivity: options.includeActivity,
      message: payload,
      sessionId: session.sessionId,
    },
    {
      onUpdate: (update) => {
        if (update.type === "error") hadErrorUpdate = true;
        const result = session.applyUpdate(update);
        emit(renderUpdate(update, { format, quiet: options.quiet }), write);
        if (result.kind === "ui" && format === "pretty" && !options.quiet) {
          // Pretty mode already renders the spec inline; nothing extra here.
        }
      },
      onError: (error: AgentHttpError) => {
        errorMessage = error.message;
        exitCode = error.status === 0 ? 2 : 1;
        write(`! HTTP ${error.status}: ${error.message}\n`);
      },
    },
  );

  session.finishStreamingAssistant();

  if (options.showStructured) {
    const last = session.uiSpecs.at(-1);
    if (last) {
      write("--- structured spec ---\n");
      write(`${JSON.stringify(last.spec, null, 2)}\n`);
    }
  }

  if (options.showHistory && format === "pretty") {
    write("--- history ---\n");
    write(`${renderHistory(session.messages)}\n`);
  }

  if (session.agentActivity.length > 0 && format === "pretty" && !options.quiet) {
    write("--- activity ---\n");
    for (const line of renderActivitySummary(session.agentActivity)) write(`${line}\n`);
  }

  if (
    session.uiSpecs.length > 0 &&
    format === "pretty" &&
    !options.quiet &&
    !options.showStructured
  ) {
    write("--- ui specs ---\n");
    for (const line of renderUiSpecs(session.uiSpecs)) write(`${line}\n`);
  }

  if (hadErrorUpdate && options.failOnError && exitCode === 0) {
    exitCode = 1;
    if (errorMessage === null) errorMessage = "Agent emitted an error update.";
  }

  return { errorMessage, exitCode };
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function runCli(argv: string[], deps: Partial<RunDeps> = {}): Promise<RunResult> {
  const fullDeps = createDefaultDeps(deps);
  const { parseArgs } = await import("./args.ts");
  const parsed = parseArgs(argv, fullDeps.env);
  if (!parsed.ok) {
    if (parsed.kind === "help") {
      fullDeps.stdout?.write(parsed.text);
      return { errorMessage: null, exitCode: 0 };
    }
    fullDeps.stdout?.write(`${parsed.message}\n`);
    return { errorMessage: parsed.message, exitCode: 2 };
  }

  if (parsed.options.repl) {
    const { runRepl } = await import("./repl.ts");
    return runRepl(parsed.options, fullDeps);
  }

  return runOneShot(parsed.options, fullDeps);
}

export { DEFAULT_BASE_URL };
