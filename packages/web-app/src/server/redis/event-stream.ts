import type { UiUpdate } from "@deep-agent-template/core/interaction-stream";
import type { Redis } from "ioredis";

import type { ExecutionResult } from "../agent-runtime/types.ts";
import { createRedisKeys, type RedisKeyspaces, resolveTtlConfig, type TtlConfig } from "./keys.ts";

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
  readonly phase?: "started" | "completed" | "cancelled";
  readonly update?: UiUpdate;
  readonly result?: ExecutionResult;
  readonly message?: string;
  readonly ts: number;
};

function decodeEnvelope(fields: string[]): RunEventEnvelope | null {
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

function decodeXReadReply(reply: unknown, expectedKey: string): [string, string[]][] | null {
  if (!Array.isArray(reply) || reply.length === 0) return null;
  for (const stream of reply) {
    if (!Array.isArray(stream) || stream.length < 2) continue;
    const [streamKey, entries] = stream;
    if (!Array.isArray(entries)) continue;
    if (typeof streamKey !== "string") continue;
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
    await this.#client.xtrim(this.streamKey(runId), "MAXLEN", "~", this.#maxLength);
  }

  async length(runId: string): Promise<number> {
    return this.#client.xlen(this.streamKey(runId));
  }
}
