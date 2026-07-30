import type { UiUpdate } from "@deep-agent-template/core/interaction-stream";
import type { Redis } from "ioredis";

import type { ExecutionResult } from "../agent-runtime/types.ts";
import { createRedisKeys, type RedisKeyspaces, resolveTtlConfig, type TtlConfig } from "./keys.ts";

// One Redis Stream per run. The worker XADDs events; any API instance XREADs
// and relays them to the client over NDJSON. Lifecycle and result events are
// server-only (never sent on the wire); UI updates pass through unchanged.
//
// The stream is bounded by a max length so a runaway run cannot grow Redis
// without limit. A TTL on the stream key (re-applied on first write) ensures
// abandoned runs eventually disappear.

const STREAM_MAX_LEN = 1_000;

export type RedisEventStreamOptions = {
  readonly client: Redis;
  readonly keyPrefix: string;
  readonly ttl?: TtlConfig;
  readonly maxLength?: number;
};

export type RunEventKind = "lifecycle" | "ui" | "result" | "error";

export type RunEventEnvelope = {
  readonly kind: RunEventKind;
  // Lifecycle-only payload field (e.g. "started" | "completed" | "cancelled").
  readonly phase?: "started" | "completed" | "cancelled";
  // UI-only payload field.
  readonly update?: UiUpdate;
  // Result-only payload field.
  readonly result?: ExecutionResult;
  // Error-only payload field.
  readonly message?: string;
  readonly ts: number;
};

function decodeEnvelope(fields: string[]): RunEventEnvelope | null {
  // Redis stream entries arrive as flat [field, value, field, value, ...].
  for (let i = 0; i < fields.length - 1; i += 2) {
    if (fields[i] === "payload") {
      const value = fields[i + 1];
      if (value === undefined) return null;
      try {
        return JSON.parse(value) as RunEventEnvelope;
      } catch {
        return null;
      }
    }
  }
  return null;
}

// ioredis returns XREAD results as nested arrays:
//   [[streamKey, [[id, [field, value, ...]], ...]], ...]
// (or null when no entries arrive within the block). Returns the entries for
// `expectedKey`, or null when the reply is absent or malformed.
function decodeXReadReply(reply: unknown, expectedKey: string): [string, string[]][] | null {
  if (!Array.isArray(reply) || reply.length === 0) return null;
  for (const stream of reply) {
    if (!Array.isArray(stream) || stream.length < 2) continue;
    const [streamKey, entries] = stream;
    if (!Array.isArray(entries)) continue;
    if (typeof streamKey !== "string") continue;
    // read() always XREADs exactly one stream, so the on-wire key must equal
    // the key we passed in. (The shared client no longer applies keyPrefix, so
    // there is no prefix doubling on the wire to tolerate.)
    if (streamKey !== expectedKey) continue;
    const out: [string, string[]][] = [];
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length < 2) continue;
      const [id, fields] = entry;
      if (typeof id !== "string" || !Array.isArray(fields)) continue;
      out.push([id, fields.map((f) => String(f))]);
    }
    return out;
  }
  return null;
}

export class RedisEventStream {
  readonly #client: Redis;
  readonly #keys: RedisKeyspaces;
  readonly #ttl: ReturnType<typeof resolveTtlConfig>;
  readonly #maxLength: number;

  constructor(options: RedisEventStreamOptions) {
    this.#client = options.client;
    this.#keys = createRedisKeys(options.keyPrefix);
    this.#ttl = resolveTtlConfig(options.ttl);
    this.#maxLength = options.maxLength ?? STREAM_MAX_LEN;
  }

  streamKey(runId: string): string {
    return this.#keys.runStream(runId);
  }

  // Append an event to the run's stream. Returns the Redis stream id.
  async publish(runId: string, envelope: RunEventEnvelope): Promise<string> {
    const key = this.streamKey(runId);
    const args: (string | number)[] = [
      "MAXLEN",
      "~",
      this.#maxLength,
      "*",
      "payload",
      JSON.stringify(envelope),
    ];
    const id = await (
      this.#client.xadd as (key: string, ...rest: (string | number)[]) => Promise<string | null>
    )(key, ...args);
    // Refresh TTL so the stream disappears `runStream` seconds after the last
    // write (which is normally the terminal event).
    await this.#client.expire(key, this.#ttl.runStream);
    return id ?? "";
  }

  async publishUi(runId: string, update: UiUpdate): Promise<void> {
    await this.publish(runId, { kind: "ui", ts: Date.now(), update });
  }

  async publishLifecycle(
    runId: string,
    phase: "started" | "completed" | "cancelled",
  ): Promise<void> {
    await this.publish(runId, { kind: "lifecycle", phase, ts: Date.now() });
  }

  async publishResult(runId: string, result: ExecutionResult): Promise<void> {
    await this.publish(runId, { kind: "result", result, ts: Date.now() });
  }

  async publishError(runId: string, message: string): Promise<void> {
    await this.publish(runId, { kind: "error", message, ts: Date.now() });
  }

  // Read events from `afterId` (exclusive) onwards. Pass "$" to read only new
  // events; "0" to read from the start. Resolves once events arrive or after
  // the block timeout. Returns an empty array on timeout/disconnect.
  async read(
    runId: string,
    afterId: string,
    blockMs: number,
    count: number,
  ): Promise<{ id: string; envelope: RunEventEnvelope }[]> {
    const key = this.streamKey(runId);
    const reply = await this.#client.xread(
      "COUNT",
      count,
      "BLOCK",
      blockMs,
      "STREAMS",
      key,
      afterId,
    );
    // ioredis returns a nested array (see decodeXReadReply); absent/malformed
    // replies yield an empty batch.
    const entries = decodeXReadReply(reply, key);
    if (!entries) return [];
    const out: { id: string; envelope: RunEventEnvelope }[] = [];
    for (const [id, fields] of entries) {
      const envelope = decodeEnvelope(fields);
      if (envelope) out.push({ envelope, id });
    }
    return out;
  }

  async trim(runId: string): Promise<void> {
    // Trim is invoked by the worker after a terminal event. MAXLEN ~ keeps the
    // last `maxLength` entries; combined with the TTL this bounds Redis usage.
    await this.#client.xtrim(this.streamKey(runId), "MAXLEN", "~", this.#maxLength);
  }

  async length(runId: string): Promise<number> {
    return this.#client.xlen(this.streamKey(runId));
  }
}
