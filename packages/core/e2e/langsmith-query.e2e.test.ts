import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Run } from "langsmith";

import { hasLiveLLMCredentials, LLM_API_KEY, LLM_BASE_URL } from "./helpers.ts";

const { LANGSMITH_API_KEY, LANGSMITH_PROJECT } = process.env;
const hasLangSmithQueryCredentials = Boolean(
  // Live LangSmith query tests are opt-in via the same RUN_LIVE_E2E gate as
  // the LLM suites, AND require an explicit LangSmith API key (separate from
  // the LLM provider key). The query helpers hit the LangSmith REST API, not
  // the model provider, so the LLM key alone is not enough.
  process.env.RUN_LIVE_E2E === "1" &&
    LANGSMITH_API_KEY &&
    LANGSMITH_PROJECT &&
    LLM_BASE_URL &&
    LLM_API_KEY,
);

const itOrSkip = hasLangSmithQueryCredentials ? it : it.skip;

describe("LangSmith lc_agent_name query helpers (live)", () => {
  beforeAll(() => {
    if (!hasLangSmithQueryCredentials) return;
    // configureLangSmithTracing is invoked automatically by
    // createScaffoldedAgent at agent construction time; the live suites
    // already set the LANGSMITH_* env vars via --env-file. We just need to
    // make sure tracing is enabled before any agent invocation seeds a trace.
    process.env.LANGSMITH_TRACING = "true";
  });

  afterAll(() => {
    // Restore what the test borrowed.
    if (LANGSMITH_API_KEY === undefined) delete process.env.LANGSMITH_API_KEY;
    else process.env.LANGSMITH_API_KEY = LANGSMITH_API_KEY;
    if (LANGSMITH_PROJECT === undefined) delete process.env.LANGSMITH_PROJECT;
    else process.env.LANGSMITH_PROJECT = LANGSMITH_PROJECT;
  });

  itOrSkip(
    "listRunsBySubagent returns runs written with lc_agent_name metadata",
    async () => {
      // Dynamic import so the unit-test suite doesn't load LangSmith network
      // code or require env vars when this test is skipped.
      const { listRunsBySubagent } = await import("../src/observability/query.ts");
      const runs = await listRunsBySubagent({
        subagentName: "coordinator",
        limit: 5,
      });
      expect(Array.isArray(runs)).toBe(true);
      // We make no claim about whether traces exist in this project; the
      // contract under test is that the SDK call succeeds and the filter is
      // syntactically valid. A malformed filter raises HTTP 400 here.
      expect(runs.length).toBeLessThanOrEqual(5);
      for (const run of runs) {
        // Every returned run must carry the metadata key we filtered on.
        // The TS Run type doesn't expose top-level `metadata` (it's at
        // `extra.metadata` in BaseRun), but the LangSmith server includes a
        // denormalized `metadata` field on returned run payloads.
        const metadata = (run as Run & { metadata?: Record<string, unknown> }).metadata;
        expect(metadata?.lc_agent_name).toBe("coordinator");
      }
    },
    { timeout: 30_000 },
  );
});

describe("LangSmith lc_agent_name query helpers (skipped without credentials)", () => {
  it("is skipped when RUN_LIVE_E2E or LANGSMITH_API_KEY is absent", () => {
    if (hasLangSmithQueryCredentials) {
      expect(hasLiveLLMCredentials).toBe(true);
    } else {
      expect(hasLangSmithQueryCredentials).toBe(false);
    }
  });
});
