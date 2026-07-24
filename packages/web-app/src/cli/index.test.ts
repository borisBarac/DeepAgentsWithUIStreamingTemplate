import { describe, expect, it } from "bun:test";

import type { CliOptions } from "./args.ts";
import { runOneShot } from "./index.ts";

describe("runOneShot", () => {
  it("writes only JSON lines to stdout in NDJSON mode", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(`${JSON.stringify({ type: "message", text: "hello" })}\n`, {
          headers: { "Content-Type": "application/x-ndjson" },
        }),
      )) as unknown as typeof fetch;
    const output: string[] = [];
    const options: CliOptions = {
      baseUrl: "http://localhost:3000",
      failOnError: false,
      includeActivity: true,
      message: "hi",
      messageFile: null,
      outputFormat: "ndjson",
      quiet: false,
      repl: false,
      session: "test-session",
      showHistory: false,
      showStructured: false,
    };

    try {
      await runOneShot(options, {
        stdout: { isTTY: false, write: (text) => output.push(text) },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    const lines = output.join("").trim().split("\n");
    expect(lines.map((line) => JSON.parse(line))).toEqual([{ type: "message", text: "hello" }]);
  });
});
