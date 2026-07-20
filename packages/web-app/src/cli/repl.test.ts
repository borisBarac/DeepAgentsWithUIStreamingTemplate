import { expect, it } from "bun:test";
import { Readable } from "node:stream";
import type { CliOptions } from "./args.ts";
import { runRepl } from "./repl.ts";

const options: CliOptions = {
  baseUrl: "http://localhost:3000",
  failOnError: false,
  includeActivity: true,
  message: null,
  messageFile: null,
  outputFormat: "pretty",
  quiet: false,
  repl: true,
  session: "test-session",
  showHistory: false,
  showStructured: false,
};

it("processes buffered REPL commands", async () => {
  let output = "";
  const result = await runRepl(options, {
    stdin: {
      input: Readable.from([":help\n:exit\n"]),
      isTTY: false,
      read: async () => "",
    },
    stdout: {
      isTTY: true,
      write: (text) => {
        output += text;
      },
    },
  });

  expect(result).toEqual({ errorMessage: null, exitCode: 0 });
  expect(output).toContain("REPL commands:");
});
