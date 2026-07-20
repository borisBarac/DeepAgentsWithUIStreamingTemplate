import { describe, expect, it } from "bun:test";

import { formatHelp, parseArgs } from "./args.ts";

describe("parseArgs", () => {
  it("joins positional tokens into one message", () => {
    const result = parseArgs(["hello", "world"], {});
    expect(result).toEqual({
      ok: true,
      options: {
        baseUrl: "http://localhost:3000",
        failOnError: false,
        includeActivity: true,
        message: "hello world",
        messageFile: null,
        outputFormat: "auto",
        quiet: false,
        repl: false,
        session: null,
        showHistory: false,
        showStructured: false,
      },
    });
  });

  it("strips a leading 'chat' subcommand", () => {
    const result = parseArgs(["chat", "hi"], {});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.options.message).toBe("hi");
  });

  it("lets flags override env defaults", () => {
    const result = parseArgs(["--base-url", "https://example.test", "hi"], {
      AGENT_CLI_BASE_URL: "http://ignored",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.options.baseUrl).toBe("https://example.test");
  });

  it("reads base url from env when no flag is given", () => {
    const result = parseArgs(["hi"], { AGENT_CLI_BASE_URL: "https://env.test" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.options.baseUrl).toBe("https://env.test");
  });

  it("reads session id from env", () => {
    const result = parseArgs(["hi"], { AGENT_CLI_SESSION: "sess-env" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.options.session).toBe("sess-env");
  });

  it("supports --file for loading the message from disk", () => {
    const result = parseArgs(["--file", "prompt.txt"], {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.options.messageFile).toBe("prompt.txt");
      expect(result.options.message).toBe(null);
    }
  });

  it("toggles activity streaming off with --no-include-activity", () => {
    const result = parseArgs(["--no-include-activity", "hi"], {});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.options.includeActivity).toBe(false);
  });

  it("forces ndjson output", () => {
    const result = parseArgs(["--ndjson", "hi"], {});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.options.outputFormat).toBe("ndjson");
  });

  it("enters repl mode", () => {
    const result = parseArgs(["--repl"], {});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.options.repl).toBe(true);
  });

  it("stops parsing flags after --", () => {
    const result = parseArgs(["--", "--not-a-flag", "hi"], {});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.options.message).toBe("--not-a-flag hi");
  });

  it("returns help on --help", () => {
    const result = parseArgs(["--help"], {});
    expect(result.ok).toBe(false);
    if (!result.ok && result.kind === "help") {
      expect(result.text).toContain("Usage");
    }
  });

  it("errors on an unknown flag", () => {
    const result = parseArgs(["--bogus"], {});
    expect(result).toEqual({ ok: false, kind: "error", message: "Unknown flag: --bogus" });
  });

  it("errors when a value flag has no value", () => {
    const result = parseArgs(["--base-url"], {});
    expect(result).toEqual({ ok: false, kind: "error", message: "--base-url requires a value." });
  });
});

describe("formatHelp", () => {
  it("includes the default base url", () => {
    expect(formatHelp()).toContain("http://localhost:3000");
  });
});
