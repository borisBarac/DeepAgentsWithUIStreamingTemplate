import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { Client, Run } from "langsmith";

import {
  __resetClientCacheForTest,
  buildSubagentFilter,
  getLangSmithClient,
  LC_AGENT_NAME_METADATA_KEY,
  listRunsBySubagent,
  listTracesBySubagent,
  type SubagentQueryOptions,
} from "./query.ts";

const langSmithEnvKeys = [
  "LANGSMITH_API_KEY",
  "LANGSMITH_ENDPOINT",
  "LANGSMITH_PROJECT",
  "LANGSMITH_TRACING",
  "LANGSMITH_WORKSPACE_ID",
] as const;

const originalLangSmithEnv = Object.fromEntries(
  langSmithEnvKeys.map((key) => [key, process.env[key]]),
);

beforeEach(() => {
  for (const key of langSmithEnvKeys) {
    delete process.env[key];
  }
  __resetClientCacheForTest();
});

afterEach(() => {
  for (const key of langSmithEnvKeys) {
    const originalValue = originalLangSmithEnv[key];
    if (originalValue === undefined) {
      delete process.env[key];
      continue;
    }
    process.env[key] = originalValue;
  }
  __resetClientCacheForTest();
});

describe("buildSubagentFilter", () => {
  it("emits the has(metadata, ...) DSL form with single-quoted JSON", () => {
    // The dotted eq(metadata.lc_agent_name, ...) form was rejected by the
    // LangSmith filter API; the has() form is the documented replacement.
    // The JSON dict argument is wrapped in single quotes because the filter
    // parser does not honor \" escapes inside double-quoted literals.
    expect(buildSubagentFilter("researcher")).toBe(
      `has(metadata, '{"${LC_AGENT_NAME_METADATA_KEY}": "researcher"}')`,
    );
  });

  it("quotes the coordinator name identically", () => {
    expect(buildSubagentFilter("coordinator")).toBe(
      `has(metadata, '{"${LC_AGENT_NAME_METADATA_KEY}": "coordinator"}')`,
    );
  });

  it("assumes kebab-case identifiers and does not escape", () => {
    // Subagent names are validated by deepagents at registration (kebab-case
    // identifiers — no quotes, no backslashes). The single-quoted filter
    // literal is therefore unambiguous without escaping. A hypothetical name
    // containing a single quote would break the filter; that is the caller's
    // contract to uphold, not this helper's.
    expect(buildSubagentFilter("review-agent")).toBe(
      `has(metadata, '{"${LC_AGENT_NAME_METADATA_KEY}": "review-agent"}')`,
    );
  });
});

describe("getLangSmithClient", () => {
  it("throws when no API key is resolvable", () => {
    expect(() => getLangSmithClient()).toThrow(/LANGSMITH_API_KEY/);
  });

  it("reads credentials from process.env", () => {
    process.env.LANGSMITH_API_KEY = "env-key";
    const client = getLangSmithClient();
    expect(client).toBeDefined();
    // Singleton: second call returns the same instance.
    expect(getLangSmithClient()).toBe(client);
  });

  it("rebuilds the singleton when explicit options differ from env", () => {
    process.env.LANGSMITH_API_KEY = "env-key";
    const first = getLangSmithClient();
    const second = getLangSmithClient({ apiKey: "explicit-key" });
    expect(second).not.toBe(first);
  });
});

/**
 * Build a mocked Client whose `listRuns` captures the call args and yields a
 * pre-baked run list. The mock bypasses the network entirely. Returns a
 * `Client`-typed stub so the public `__clientForTest` seam accepts it without
 * per-callsite casts.
 */
function mockClient(runs: Run[]): {
  client: Client;
  calls: Array<Record<string, unknown>>;
} {
  const calls: Array<Record<string, unknown>> = [];
  const listRuns = mock((params: Record<string, unknown>) => {
    calls.push(params);
    async function* gen(): AsyncIterable<Run> {
      for (const run of runs) yield run;
    }
    return gen();
  });
  const stub = { listRuns } as unknown as Client;
  return { client: stub, calls };
}

const baseOptions: SubagentQueryOptions = {
  subagentName: "researcher",
  project: "deep-agent-template",
  limit: 3,
};

function fakeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    name: "fake-run",
    start_time: "2026-01-01T00:00:00.000Z",
    run_type: "llm",
    session_name: "deep-agent-template",
    ...overrides,
  } as Run;
}

describe("listRunsBySubagent", () => {
  // Shared expectation: the filter passed to client.listRuns matches what
  // buildSubagentFilter emits. Building it from the production helper keeps
  // these tests from drifting if the DSL form changes again.
  const expectedFilter = (name = "researcher") => buildSubagentFilter(name);

  it("passes the lc_agent_name filter and projectName to listRuns", async () => {
    const { client, calls } = mockClient([fakeRun()]);
    const runs = await listRunsBySubagent({ ...baseOptions, __clientForTest: client });
    expect(runs).toHaveLength(1);
    expect(calls[0]?.projectName).toBe("deep-agent-template");
    expect(calls[0]?.filter).toBe(expectedFilter());
    expect(calls[0]?.order).toBe("desc");
  });

  it("combines the subagent filter with gte(start_time) when since is set", async () => {
    const { client, calls } = mockClient([]);
    const since = new Date("2026-01-01T00:00:00Z");
    await listRunsBySubagent({ ...baseOptions, since, __clientForTest: client });
    expect(calls[0]?.filter).toBe(
      `and(${expectedFilter()}, gte(start_time, "${since.toISOString()}"))`,
    );
  });

  it("forwards errorOnly as the error flag", async () => {
    const { client, calls } = mockClient([]);
    await listRunsBySubagent({ ...baseOptions, errorOnly: true, __clientForTest: client });
    expect(calls[0]?.error).toBe(true);
  });

  it("caps the materialized array at limit", async () => {
    const many = Array.from({ length: 10 }, (_, i) => fakeRun({ id: `run-${i}` }));
    const { client } = mockClient(many);
    const runs = await listRunsBySubagent({ ...baseOptions, limit: 4, __clientForTest: client });
    expect(runs).toHaveLength(4);
  });

  it("defaults project to process.env.LANGSMITH_PROJECT", async () => {
    process.env.LANGSMITH_PROJECT = "env-project";
    const { client, calls } = mockClient([]);
    await listRunsBySubagent({ subagentName: "researcher", __clientForTest: client });
    expect(calls[0]?.projectName).toBe("env-project");
  });
});

describe("listTracesBySubagent", () => {
  const expectedFilter = (name = "researcher") => buildSubagentFilter(name);

  it("restricts to root runs (isRoot: true)", async () => {
    const { client, calls } = mockClient([fakeRun()]);
    const traces = await listTracesBySubagent({ ...baseOptions, __clientForTest: client });
    expect(traces).toHaveLength(1);
    expect(calls[0]?.isRoot).toBe(true);
    expect(calls[0]?.filter).toBe(expectedFilter());
  });
});
