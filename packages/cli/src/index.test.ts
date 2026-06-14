import { describe, expect, it } from "bun:test";

import { runCli } from "./index";

describe("runCli", () => {
  it("prints help text", () => {
    const result = runCli(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Usage:");
  });

  it("prints version text", () => {
    expect(runCli(["--version"])).toEqual({
      exitCode: 0,
      output: "0.1.0",
    });
  });

  it("runs the default command with core behavior", () => {
    expect(runCli(["CLI"])).toEqual({
      exitCode: 0,
      output: "Hello, CLI!",
    });
  });
});
