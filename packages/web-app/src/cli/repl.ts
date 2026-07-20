import { stdin as nodeStdin } from "node:process";
import * as readline from "node:readline/promises";
import type { QualificationQuestion } from "../ui/session-model.ts";
import type { CliOptions } from "./args.ts";
import { type RunDeps, type RunResult, sendTurn } from "./index.ts";
import { SessionState } from "./session-state.ts";

const PROMPT = "> ";
const REPL_HELP = `
REPL commands:
  :help                Show this help
  :exit, :quit         Leave the REPL
  :reset               Start a new session (new id, empty state)
  :session <id>        Switch to a specific session id
  :session             Show the current session id
  :activity on|off     Toggle subagent/main activity streaming
  :raw on|off          Echo raw NDJSON lines alongside pretty output
  :history             Print the committed chat history
  :specs               Print the latest UI specs summary
  Anything else        Send as a message to the agent
`.trim();

export async function runRepl(options: CliOptions, deps: RunDeps): Promise<RunResult> {
  const write = deps.stdout?.write ?? ((text: string) => process.stdout.write(text));
  let format: "ndjson" | "pretty" =
    options.outputFormat === "ndjson"
      ? "ndjson"
      : options.outputFormat === "pretty"
        ? "pretty"
        : deps.stdout?.isTTY
          ? "pretty"
          : "ndjson";

  let baseUrl = options.baseUrl;
  let includeActivity = options.includeActivity;
  let rawEcho = false;

  let session = new SessionState({
    sessionId: options.session ?? crypto.randomUUID(),
  });

  const rl = readline.createInterface({
    input: deps.stdin?.input ?? nodeStdin,
    crlfDelay: Infinity,
  });
  const lines = rl[Symbol.asyncIterator]();

  async function readLine(prompt: string): Promise<string | null> {
    write(prompt);
    const next = await lines.next();
    return next.done ? null : next.value;
  }

  write(`agent-cli REPL — ${baseUrl}/api/agent (session ${session.sessionId})\n`);
  write(`Type :help for commands, :exit to quit.\n`);

  let exitCode = 0;
  let lastError: string | null = null;

  outer: while (true) {
    const answer = await readLine(PROMPT);
    if (answer === null) break;
    const trimmed = answer.trim();

    if (!trimmed) {
      continue;
    }

    if (trimmed === ":exit" || trimmed === ":quit") {
      break;
    }

    if (trimmed === ":help") {
      write(`${REPL_HELP}\n`);
      continue;
    }

    if (trimmed === ":reset") {
      session = new SessionState({ sessionId: crypto.randomUUID() });
      write(`[session ${session.sessionId}] reset\n`);
      continue;
    }

    if (trimmed === ":session") {
      write(`${session.sessionId}\n`);
      continue;
    }

    if (trimmed.startsWith(":session ")) {
      const id = trimmed.slice(":session ".length).trim();
      if (!id) {
        write("Usage: :session <id>\n");
        continue;
      }
      session = new SessionState({ sessionId: id });
      write(`[session ${session.sessionId}] (fresh state)\n`);
      continue;
    }

    if (trimmed.startsWith(":activity ")) {
      const value = trimmed.slice(":activity ".length).trim().toLowerCase();
      if (value !== "on" && value !== "off") {
        write("Usage: :activity on|off\n");
        continue;
      }
      includeActivity = value === "on";
      write(`activity streaming: ${includeActivity ? "on" : "off"}\n`);
      continue;
    }

    if (trimmed.startsWith(":raw ")) {
      const value = trimmed.slice(":raw ".length).trim().toLowerCase();
      if (value !== "on" && value !== "off") {
        write("Usage: :raw on|off\n");
        continue;
      }
      rawEcho = value === "on";
      write(`raw ndjson echo: ${rawEcho ? "on" : "off"}\n`);
      continue;
    }

    if (trimmed === ":history") {
      write(`${JSON.stringify(session.messages, null, 2)}\n`);
      continue;
    }

    if (trimmed === ":specs") {
      if (session.uiSpecs.length === 0) {
        write("(no specs)\n");
      } else {
        for (const entry of session.uiSpecs) {
          write(`${JSON.stringify(entry.spec)}\n`);
        }
      }
      continue;
    }

    if (trimmed.startsWith(":format ")) {
      const value = trimmed.slice(":format ".length).trim().toLowerCase();
      if (value !== "pretty" && value !== "ndjson") {
        write("Usage: :format pretty|ndjson\n");
        continue;
      }
      format = value;
      write(`format: ${format}\n`);
      continue;
    }

    if (trimmed.startsWith(":base-url ")) {
      const value = trimmed.slice(":base-url ".length).trim();
      if (!value) {
        write("Usage: :base-url <url>\n");
        continue;
      }
      baseUrl = value;
      write(`base url: ${baseUrl}\n`);
      continue;
    }

    // Question flow: if there are open questions, prompt the user for each
    // one (mirroring the website's onQuestion + submitAnswer path) before
    // submitting the next turn. The actual submit uses composeNextMessage,
    // which packs the answers into the formatQuestionAnswers envelope.
    if (session.hasOpenQuestions()) {
      const openQuestions = collectOpenQuestions(session.messages, session.openQuestionIds);
      for (const question of openQuestions) {
        const promptText = formatQuestionPrompt(question);
        write(`${promptText}\n`);
        const answer = await readLine("answer> ");
        if (answer === null) break outer;
        const line = answer.trim();
        if (!line) continue;
        session.recordAnswer(question.id, line);
      }
    }

    const turnOptions: CliOptions = {
      ...options,
      baseUrl,
      includeActivity,
      outputFormat: format === "ndjson" ? "ndjson" : "pretty",
      quiet: false,
      showHistory: false,
      showStructured: false,
    };
    // If raw echo is on, force ndjson for this turn but still print pretty.
    const effectiveFormat = rawEcho ? "ndjson" : format;
    const result = await sendTurn(turnOptions, deps, session, trimmed, effectiveFormat);
    if (result.exitCode !== 0) {
      exitCode = result.exitCode;
      lastError = result.errorMessage;
    }
    if (rawEcho && format === "pretty") {
      // sendTurn already streamed NDJSON; show the pretty view next by
      // re-running through the renderer against the captured state.
      // For simplicity we just print the latest assistant message.
      const last = session.messages.at(-1);
      if (last && last.role === "assistant") {
        write(`[pretty] ${last.content}\n`);
      }
    }
  }

  rl.close();
  return { errorMessage: lastError, exitCode };
}

function collectOpenQuestions(
  messages: SessionState["messages"],
  openIds: Set<string>,
): QualificationQuestion[] {
  const byId = new Map<string, QualificationQuestion>();
  for (const message of messages) {
    if (message.question && openIds.has(message.question.id)) {
      byId.set(message.question.id, message.question);
    }
  }
  return [...byId.values()];
}

function formatQuestionPrompt(question: QualificationQuestion): string {
  if (question.kind === "multiple_choice") {
    const options = question.options
      .map((option, index) => {
        if (typeof option === "string") return `  [${index + 1}] ${option}`;
        const tag = option.recommended ? " (recommended)" : "";
        const description = option.description ? ` — ${option.description}` : "";
        return `  [${index + 1}] ${option.label}${tag}${description}`;
      })
      .join("\n");
    return `? ${question.prompt}\n${options}`;
  }
  const placeholder = question.placeholder ?? "type your answer";
  return `? ${question.prompt}\n  (${placeholder})`;
}
