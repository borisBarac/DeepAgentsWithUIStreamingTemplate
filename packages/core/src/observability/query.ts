import { Client, type Run } from "langsmith";

/**
 * Metadata key written automatically by deepagents on every run that originates
 * from a subagent (sync or async). The value is the subagent's `name` — for
 * this repo that means one of: `clarifier`, `researcher`, `analyst`,
 * `review-agent`, `product-generator`, `image-designer`, or the auto-added
 * `general-purpose`. The coordinator's own runs carry `coordinator`.
 *
 * The library writes the key regardless of whether tracing is enabled at call
 * time; LangSmith only persists it when tracing is on. Use the helpers in this
 * module to query runs by subagent identity.
 *
 * @see https://docs.langchain.com/oss/python/deepagents/subagents#filter-by-subagent-in-langsmith
 */
export const LC_AGENT_NAME_METADATA_KEY = "lc_agent_name";

/**
 * Options shared by both runs-and-traces subagent queries.
 */
export type SubagentQueryOptions = {
  /** Subagent name to filter on (matched against `metadata.lc_agent_name`). */
  subagentName: string;
  /**
   * LangSmith project name. Defaults to `process.env.LANGSMITH_PROJECT`.
   * The LangSmith SDK rejects list queries when no project resolves.
   */
  project?: string;
  /** Maximum number of runs to return. LangSmith caps this server-side. */
  limit?: number;
  /**
   * Inclusive lower bound on run `start_time`. Translated to a
   * `gte(start_time, "...")` clause appended to the filter string —
   * equivalent to the `langsmith trace list --since` CLI flag.
   */
  since?: Date;
  /** When `true`, only return runs that ended in an error. */
  errorOnly?: boolean;
  /**
   * Order results by `start_time`. LangSmith supports `"asc"` and `"desc"`.
   * Defaults to `"desc"` (newest first) to match the LangSmith UI.
   */
  order?: "asc" | "desc";
  /**
   * Test-only escape hatch: inject a mock Client to bypass network calls and
   * credentials resolution. Production callers must not set this field.
   * @internal
   */
  __clientForTest?: Client;
};

export type LangSmithClientOptions = {
  apiKey?: string;
  endpoint?: string;
  workspaceId?: string;
  /**
   * Test-only escape hatch: inject a mock client. Production callers must not
   * set this field; the cached singleton is shared across calls.
   * @internal
   */
  __clientForTest?: Client;
};

let cachedClient: Client | undefined;
let cachedClientKey: string | undefined;

/**
 * Construct a singleton LangSmith {@link Client} configured from the same
 * environment variables as {@link configureLangSmithTracing}:
 * `LANGSMITH_API_KEY`, `LANGSMITH_ENDPOINT`, `LANGSMITH_WORKSPACE_ID`.
 *
 * Pass explicit overrides only when you need a client pointed at a different
 * workspace or API endpoint than the one currently configured for tracing.
 * The client is reused across calls (keyed on the resolved credentials); a
 * different combination of arguments constructs a fresh client.
 *
 * @throws {Error} when `LANGSMITH_API_KEY` is not set and `apiKey` is omitted.
 * The LangSmith SDK requires an API key to query runs.
 */
export function getLangSmithClient(options: LangSmithClientOptions = {}): Client {
  if (options.__clientForTest) return options.__clientForTest;

  const apiKey = options.apiKey ?? process.env.LANGSMITH_API_KEY;
  const endpoint = options.endpoint ?? process.env.LANGSMITH_ENDPOINT;
  const workspaceId = options.workspaceId ?? process.env.LANGSMITH_WORKSPACE_ID;

  if (!apiKey) {
    throw new Error("LangSmith API key is required. Set LANGSMITH_API_KEY or pass apiKey.");
  }

  const cacheKey = `${apiKey}|${endpoint ?? ""}|${workspaceId ?? ""}`;
  if (cachedClient && cacheKey === cachedClientKey) return cachedClient;

  const client = new Client({
    apiKey,
    ...(endpoint ? { apiUrl: endpoint } : {}),
    ...(workspaceId ? { workspaceId } : {}),
  });
  cachedClient = client;
  cachedClientKey = cacheKey;
  return client;
}

/**
 * Build the LangSmith filter DSL string for a subagent name.
 *
 * Uses the `has(metadata, '{"lc_agent_name": "<value>"}')` form, exactly as
 * documented in the Python deepagents subagents guide. The JSON dict argument
 * is wrapped in **single quotes** because it contains double quotes; the
 * LangSmith filter parser does not honor `\"` escapes inside double-quoted
 * string literals, so wrapping in double quotes produces a parse error
 * (HTTP 400 "unexpected character ... char 1" — the backslash).
 *
 * The previous `eq(metadata.lc_agent_name, "...")` dotted form was also
 * rejected by the filter API ("Attribute metadata.lc_agent_name not
 * accepted"). The `has()` form is the only documented syntax for matching
 * nested metadata key-value pairs.
 *
 * If a future LangSmith backend revision stops accepting the `has()` form,
 * restore the dotted `eq()` form.
 *
 * Subagent names are validated by deepagents at registration (kebab-case
 * identifiers, no quotes), so single-quote wrapping is safe without escaping.
 */
export function buildSubagentFilter(subagentName: string): string {
  // Subagent names are kebab-case identifiers — no single quotes, no
  // backslashes, no double quotes — so the JSON value needs no escaping and
  // the outer single-quoted filter literal is unambiguous. The shape mirrors
  // the documented Python example verbatim:
  //   has(metadata, '{"lc_agent_name": "<value>"}')
  return `has(metadata, '{"${LC_AGENT_NAME_METADATA_KEY}": "${subagentName}"}')`;
}

/**
 * Combine the subagent filter with optional time bounds into a single DSL
 * string. The `gte(start_time, ...)` form is the same one the LangSmith CLI
 * uses for `--since`.
 */
function composeFilter(options: SubagentQueryOptions): string {
  const base = buildSubagentFilter(options.subagentName);
  if (!options.since) return base;
  // LangSmith timestamps are ISO 8601. The grammar comparator accepts the
  // same string the API would store.
  return `and(${base}, gte(start_time, "${options.since.toISOString()}"))`;
}

/**
 * Test-only helper: clear the cached singleton client and its cache key.
 * Use in `afterEach` to keep tests isolated — without this, a client cached
 * under one set of credentials can leak into a later test that resolves the
 * same cache key. Production code must not call this; the cache is an
 * intentional optimization.
 * @internal
 */
export function __resetClientCacheForTest(): void {
  cachedClient = undefined;
  cachedClientKey = undefined;
}

/**
 * Materialize an `AsyncIterable<Run>` into an array, capped at `limit`. The
 * LangSmith SDK returns runs lazily; we eagerly drain so callers can use
 * `Array.prototype` and await individual fields without a streaming context.
 */
async function collectRuns(iterable: AsyncIterable<Run>, limit: number): Promise<Run[]> {
  const collected: Run[] = [];
  for await (const run of iterable) {
    collected.push(run);
    if (collected.length >= limit) break;
  }
  return collected;
}

/**
 * List individual LangSmith runs produced by a given subagent. Use this for
 * granular analysis — finding every LLM call by `researcher`, every tool call
 * by `clarifier`, etc. Filters apply to any run in the trace tree.
 *
 * For complete execution trees (a single agent invocation with all nested
 * runs), use {@link listTracesBySubagent} instead.
 *
 * @example
 * ```ts
 * const runs = await listRunsBySubagent({
 *   subagentName: "researcher",
 *   limit: 50,
 * });
 * ```
 */
export async function listRunsBySubagent(options: SubagentQueryOptions): Promise<Run[]> {
  const client = options.__clientForTest ?? getLangSmithClient();
  const limit = options.limit ?? 100;
  const { __clientForTest: _ignored, ...rest } = options;
  const runs = client.listRuns({
    projectName: rest.project ?? process.env.LANGSMITH_PROJECT,
    filter: composeFilter(rest),
    ...(rest.errorOnly !== undefined ? { error: rest.errorOnly } : {}),
    order: rest.order ?? "desc",
  });
  return collectRuns(runs, limit);
}

/**
 * List complete trace trees rooted at runs produced by a given subagent. A
 * "trace" here is the full execution hierarchy (root run + every nested run);
 * use this when you need the complete context of an agent invocation.
 *
 * Filters apply to root runs only — same convention as the
 * `langsmith trace list` CLI command. If a subagent's run is nested inside a
 * larger trace, the parent trace root must carry `lc_agent_name` for this
 * helper to surface it; in practice that means this helper is most useful for
 * `coordinator` runs and for subagent runs dispatched at the top level.
 *
 * For flat per-subagent analysis across all run types (nested or not), prefer
 * {@link listRunsBySubagent}.
 *
 * @example
 * ```ts
 * const traces = await listTracesBySubagent({
 *   subagentName: "coordinator",
 *   limit: 10,
 * });
 * ```
 */
export async function listTracesBySubagent(options: SubagentQueryOptions): Promise<Run[]> {
  const client = options.__clientForTest ?? getLangSmithClient();
  const limit = options.limit ?? 25;
  const { __clientForTest: _ignored, ...rest } = options;
  const runs = client.listRuns({
    projectName: rest.project ?? process.env.LANGSMITH_PROJECT,
    filter: composeFilter(rest),
    // isRoot restricts to trace roots — same convention as the
    // `langsmith trace list` CLI command.
    isRoot: true,
    ...(rest.errorOnly !== undefined ? { error: rest.errorOnly } : {}),
    order: rest.order ?? "desc",
  });
  return collectRuns(runs, limit);
}
