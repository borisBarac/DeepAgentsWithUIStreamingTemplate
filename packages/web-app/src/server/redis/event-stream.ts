import type { UiUpdate } from "@deep-agent-template/core/interaction-stream";
import type { Redis } from "ioredis";
import type { ExecutionIdentity, ExecutionResult } from "../agent-runtime/types.ts";
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

  streamKey(runId: string): string;
  streamKey(identity: ExecutionIdentity, runId: string): string;
  streamKey(first: string | ExecutionIdentity, second?: string): string {
    const identity = typeof first === "string" ? undefined : first;
    const runId = typeof first === "string" ? first : second;
    if (!runId) throw new Error("runId is required.");
    return this.#keys.runStream(runId, identity);
  }

  async publish(runId: string, envelope: RunEventEnvelope): Promise<string>;
  async publish(
    identity: ExecutionIdentity,
    runId: string,
    envelope: RunEventEnvelope,
  ): Promise<string>;
  async publish(
    first: string | ExecutionIdentity,
    second: RunEventEnvelope | string,
    third?: RunEventEnvelope,
  ): Promise<string> {
    const identity = typeof first === "string" ? undefined : first;
    const runId = typeof first === "string" ? first : second;
    const envelope = typeof first === "string" ? second : third;
    if (typeof runId !== "string" || !envelope) throw new Error("runId and envelope are required.");
    const key = identity ? this.streamKey(identity, runId) : this.streamKey(runId);
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
    const pttl = await this.#client.pttl(key);
    if (pttl < 0) {
      await (
        this.#client.expire as unknown as (
          key: string,
          seconds: number,
          mode: string,
        ) => Promise<number>
      )(key, this.#ttl.runStream, "NX");
    }
    return id ?? "";
  }

  async publishUi(runId: string, update: UiUpdate): Promise<void>;
  async publishUi(identity: ExecutionIdentity, runId: string, update: UiUpdate): Promise<void>;
  async publishUi(
    first: string | ExecutionIdentity,
    second: UiUpdate | string,
    third?: UiUpdate,
  ): Promise<void> {
    if (typeof first === "string")
      await this.publish(first, { kind: "ui", ts: Date.now(), update: second as UiUpdate });
    else
      await this.publish(first, second as string, {
        kind: "ui",
        ts: Date.now(),
        update: third as UiUpdate,
      });
  }

  async publishLifecycle(
    runId: string,
    phase: "started" | "completed" | "cancelled",
  ): Promise<void>;
  async publishLifecycle(
    identity: ExecutionIdentity,
    runId: string,
    phase: "started" | "completed" | "cancelled",
  ): Promise<void>;
  async publishLifecycle(
    first: string | ExecutionIdentity,
    second: string | "started" | "completed" | "cancelled",
    third?: "started" | "completed" | "cancelled",
  ): Promise<void> {
    if (typeof first === "string")
      await this.publish(first, {
        kind: "lifecycle",
        phase: second as "started" | "completed" | "cancelled",
        ts: Date.now(),
      });
    else
      await this.publish(first, second as string, {
        kind: "lifecycle",
        phase: third as "started" | "completed" | "cancelled",
        ts: Date.now(),
      });
  }

  async publishResult(runId: string, result: ExecutionResult): Promise<void>;
  async publishResult(
    identity: ExecutionIdentity,
    runId: string,
    result: ExecutionResult,
  ): Promise<void>;
  async publishResult(
    first: string | ExecutionIdentity,
    second: ExecutionResult | string,
    third?: ExecutionResult,
  ): Promise<void> {
    if (typeof first === "string")
      await this.publish(first, {
        kind: "result",
        result: second as ExecutionResult,
        ts: Date.now(),
      });
    else
      await this.publish(first, second as string, {
        kind: "result",
        result: third as ExecutionResult,
        ts: Date.now(),
      });
  }

  async publishError(runId: string, message: string): Promise<void>;
  async publishError(identity: ExecutionIdentity, runId: string, message: string): Promise<void>;
  async publishError(
    first: string | ExecutionIdentity,
    second: string,
    third?: string,
  ): Promise<void> {
    if (typeof first === "string")
      await this.publish(first, { kind: "error", message: second, ts: Date.now() });
    else await this.publish(first, second, { kind: "error", message: third ?? "", ts: Date.now() });
  }

  async read(
    runId: string,
    afterId: string,
    blockMs: number,
    count: number,
  ): Promise<{ id: string; envelope: RunEventEnvelope }[]>;
  async read(
    identity: ExecutionIdentity,
    runId: string,
    afterId: string,
    blockMs: number,
    count: number,
  ): Promise<{ id: string; envelope: RunEventEnvelope }[]>;
  async read(
    first: string | ExecutionIdentity,
    second: string,
    third: string | number,
    fourth: number,
    fifth?: number,
  ): Promise<{ id: string; envelope: RunEventEnvelope }[]> {
    const identity = typeof first === "string" ? undefined : first;
    const runId = typeof first === "string" ? first : second;
    const afterId = typeof first === "string" ? second : (third as string);
    const blockMs = typeof first === "string" ? (third as number) : fourth;
    const count = typeof first === "string" ? fourth : fifth;
    if (count === undefined) throw new Error("count is required.");
    const key = identity ? this.streamKey(identity, runId) : this.streamKey(runId);
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

  async trim(runId: string): Promise<void>;
  async trim(identity: ExecutionIdentity, runId: string): Promise<void>;
  async trim(first: string | ExecutionIdentity, second?: string): Promise<void> {
    const identity = typeof first === "string" ? undefined : first;
    const runId = typeof first === "string" ? first : second;
    if (!runId) throw new Error("runId is required.");
    await this.#client.xtrim(
      identity ? this.streamKey(identity, runId) : this.streamKey(runId),
      "MAXLEN",
      "~",
      this.#maxLength,
    );
  }

  async length(runId: string): Promise<number>;
  async length(identity: ExecutionIdentity, runId: string): Promise<number>;
  async length(first: string | ExecutionIdentity, second?: string): Promise<number> {
    const identity = typeof first === "string" ? undefined : first;
    const runId = typeof first === "string" ? first : second;
    if (!runId) throw new Error("runId is required.");
    return this.#client.xlen(identity ? this.streamKey(identity, runId) : this.streamKey(runId));
  }
}
