export type CliOptions = {
  baseUrl: string;
  includeActivity: boolean;
  message: string | null;
  messageFile: string | null;
  outputFormat: "auto" | "pretty" | "ndjson";
  quiet: boolean;
  repl: boolean;
  session: string | null;
  showHistory: boolean;
  showStructured: boolean;
  failOnError: boolean;
};

const DEFAULT_BASE_URL = "http://localhost:3000";

const HELP = `agent-cli — talk to the deep-agent web server

Usage:
  agent-cli <message...>              Send a single message
  agent-cli --file <path>             Send the contents of a file
  echo "..." | agent-cli              Send piped stdin
  agent-cli --repl                    Interactive multi-turn mode
  agent-cli chat <message...>         Explicit chat subcommand

Options:
  --base-url <url>                    Server base URL (default: ${DEFAULT_BASE_URL})
  --session <id>                      Session id (default: fresh UUID per run)
  --include-activity                  Stream main/subagent activity (default on)
  --no-include-activity               Disable activity streaming
  --pretty                            Force human-readable output
  --ndjson                            Force one JSON object per line
  --quiet                             Only print the final assistant message
  --show-structured                   Print the final structuredOutput JSON
  --show-history                      Print the committed chat history JSON
  --fail-on-error                     Exit non-zero if an error update arrives
  --repl                              Enter interactive REPL mode
  --help, -h                          Show this help

Environment:
  AGENT_CLI_BASE_URL                  Same as --base-url
  AGENT_CLI_SESSION                   Same as --session
`;

export type ParseResult =
  | { ok: true; options: CliOptions }
  | { ok: false; kind: "help"; text: string }
  | { ok: false; kind: "error"; message: string };

function isFlag(token: string): boolean {
  return token.startsWith("--");
}

function nextValue(args: string[], index: number): [string, number] {
  const value = args[index + 1];
  if (value === undefined || isFlag(value)) {
    return ["", index];
  }
  return [value, index + 1];
}

function boolFromEnv(env: Record<string, string | undefined>, key: string): boolean | undefined {
  const raw = env[key];
  if (raw === undefined) return undefined;
  return raw === "1" || raw.toLowerCase() === "true" || raw.toLowerCase() === "yes";
}

export function parseArgs(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
): ParseResult {
  const positional: string[] = [];
  let baseUrl = env.AGENT_CLI_BASE_URL ?? DEFAULT_BASE_URL;
  let includeActivity = boolFromEnv(env, "AGENT_CLI_INCLUDE_ACTIVITY") ?? true;
  let messageFile: string | null = null;
  let outputFormat: CliOptions["outputFormat"] = "auto";
  let quiet = false;
  let repl = false;
  let session = env.AGENT_CLI_SESSION ?? null;
  let showHistory = false;
  let showStructured = false;
  let failOnError = false;

  let i = 0;
  while (i < argv.length) {
    const token = argv[i];
    if (!token) {
      i += 1;
      continue;
    }

    switch (token) {
      case "-h":
      case "--help":
        return { ok: false, kind: "help", text: HELP };
      case "--repl":
        repl = true;
        i += 1;
        break;
      case "--base-url": {
        const [value, next] = nextValue(argv, i);
        if (!value) return { ok: false, kind: "error", message: `${token} requires a value.` };
        baseUrl = value;
        i = next + 1;
        break;
      }
      case "--session": {
        const [value, next] = nextValue(argv, i);
        if (!value) return { ok: false, kind: "error", message: `${token} requires a value.` };
        session = value;
        i = next + 1;
        break;
      }
      case "--file": {
        const [value, next] = nextValue(argv, i);
        if (!value) return { ok: false, kind: "error", message: `${token} requires a value.` };
        messageFile = value;
        i = next + 1;
        break;
      }
      case "--include-activity":
        includeActivity = true;
        i += 1;
        break;
      case "--no-include-activity":
        includeActivity = false;
        i += 1;
        break;
      case "--pretty":
        outputFormat = "pretty";
        i += 1;
        break;
      case "--ndjson":
        outputFormat = "ndjson";
        i += 1;
        break;
      case "--quiet":
        quiet = true;
        i += 1;
        break;
      case "--show-structured":
        showStructured = true;
        i += 1;
        break;
      case "--show-history":
        showHistory = true;
        i += 1;
        break;
      case "--fail-on-error":
        failOnError = true;
        i += 1;
        break;
      case "--":
        i += 1;
        while (i < argv.length) {
          const tail = argv[i];
          if (tail) positional.push(tail);
          i += 1;
        }
        break;
      default:
        if (isFlag(token)) {
          return { ok: false, kind: "error", message: `Unknown flag: ${token}` };
        }
        positional.push(token);
        i += 1;
        break;
    }
  }

  if (positional[0] === "chat") {
    positional.shift();
  }

  const message = positional.length > 0 ? positional.join(" ").trim() : null;

  return {
    ok: true,
    options: {
      baseUrl,
      failOnError,
      includeActivity,
      message,
      messageFile,
      outputFormat,
      quiet,
      repl,
      session,
      showHistory,
      showStructured,
    },
  };
}

export function formatHelp(): string {
  return HELP;
}
