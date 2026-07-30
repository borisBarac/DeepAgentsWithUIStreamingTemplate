import { describe, expect, it } from "bun:test";
import type { SessionRecord } from "../agent-runtime/types.ts";
import {
  MEMORY_ITEM_SCHEMA_VERSION,
  RedisCodec,
  RUN_METADATA_SCHEMA_VERSION,
  RUN_STATE_SCHEMA_VERSION,
  type RunStateRecord,
  SESSION_RECORD_SCHEMA_VERSION,
  type SessionLockRecord,
} from "./codec.ts";

describe("RedisCodec", () => {
  it("encodes a payload with the schema version", () => {
    const codec = new RedisCodec<SessionRecord>(SESSION_RECORD_SCHEMA_VERSION);
    const payload: SessionRecord = {
      failure: null,
      history: [],
      structuredOutput: null,
    };
    const encoded = codec.encode(payload);
    expect(JSON.parse(encoded)).toEqual({
      payload,
      v: SESSION_RECORD_SCHEMA_VERSION,
    });
  });

  it("decodes a round-tripped payload", () => {
    const codec = new RedisCodec<SessionRecord>(SESSION_RECORD_SCHEMA_VERSION);
    const payload: SessionRecord = {
      failure: null,
      history: [{ content: "hi", role: "user" }],
      structuredOutput: null,
    };
    expect(codec.decode(codec.encode(payload))).toEqual(payload);
  });

  it("returns null for missing input", () => {
    const codec = new RedisCodec<unknown>(1);
    expect(codec.decode(null)).toBeNull();
    expect(codec.decode(undefined as unknown as null)).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    const codec = new RedisCodec<unknown>(1);
    expect(codec.decode("not-json")).toBeNull();
  });

  it("rejects records written with a different schema version", () => {
    const v1 = new RedisCodec<SessionRecord>(1);
    const v2 = new RedisCodec<SessionRecord>(2);
    const encoded = v1.encode({ failure: null, history: [], structuredOutput: null });
    expect(() => v2.decode(encoded)).toThrow(/Unsupported schema version/);
  });

  it("rejects non-object decoded values", () => {
    const codec = new RedisCodec<unknown>(1);
    expect(codec.decode(JSON.stringify("plain-string"))).toBeNull();
  });

  it("exposes the schema versions for each record type", () => {
    // Locking these down so a future bump is deliberate and updates migrations.
    expect(SESSION_RECORD_SCHEMA_VERSION).toBe(1);
    expect(RUN_METADATA_SCHEMA_VERSION).toBe(1);
    expect(RUN_STATE_SCHEMA_VERSION).toBe(1);
    expect(MEMORY_ITEM_SCHEMA_VERSION).toBe(1);
  });
});

describe("codec record types compile and round-trip", () => {
  it("round-trips a RunStateRecord", () => {
    const codec = new RedisCodec<RunStateRecord>(RUN_STATE_SCHEMA_VERSION);
    const record: RunStateRecord = {
      identity: { tenantId: "t", userId: "u" },
      runId: "r1",
      sessionId: "s1",
      startedAt: 1,
      status: "queued",
    };
    expect(codec.decode(codec.encode(record))).toEqual(record);
  });

  it("round-trips a SessionLockRecord", () => {
    const codec = new RedisCodec<SessionLockRecord>(1);
    const record: SessionLockRecord = {
      acquiredAt: 100,
      fencingToken: 5,
      identity: { tenantId: "t", userId: "u" },
      runId: "r1",
      sessionId: "s1",
    };
    expect(codec.decode(codec.encode(record))).toEqual(record);
  });
});
