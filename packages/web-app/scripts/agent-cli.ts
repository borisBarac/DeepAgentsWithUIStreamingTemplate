#!/usr/bin/env bun
import { runCli } from "../src/cli/index.ts";

const result = await runCli(process.argv.slice(2));
if (result.exitCode !== 0) {
  process.exit(result.exitCode);
}
