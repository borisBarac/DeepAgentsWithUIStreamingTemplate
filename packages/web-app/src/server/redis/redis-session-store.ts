import type { Redis } from "ioredis";
import type {
  ExecutionIdentity,
  LoadedSession,
  RunMetadata,
  SessionRecord,
  SessionStore,
} from "../agent-runtime/types.ts";
import { RedisCodec, RUN_METADATA_SCHEMA_VERSION, SESSION_RECORD_SCHEMA_VERSION } from "./codec.ts";
import { createRedisKeys, type RedisKeyspaces, resolveTtlConfig, type TtlConfig } from "./keys.ts";

export type RedisSessionStoreConfig = {
  readonly client: Redis;
  readonly keyPrefix: string;
  readonly ttl?: TtlConfig;
};

const COMMIT_SCRIPT = `
local expected = tonumber(ARGV[1])
local current = tonumber(redis.call('GET', KEYS[2]) or '0')
if current ~= expected then
  return 0
end
local next = current + 1
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 1 then ttl = redis.call('PTTL', KEYS[2]) end
if ttl < 1 then ttl = tonumber(ARGV[3]) * 1000 end
local seconds = math.max(1, math.ceil(ttl / 1000))
redis.call('SET', KEYS[1], ARGV[2], 'EX', seconds)
redis.call('SET', KEYS[2], tostring(next), 'EX', seconds)
return 1
`;

const sessionCodec = new RedisCodec<SessionRecord>(SESSION_RECORD_SCHEMA_VERSION);
const runCodec = new RedisCodec<RunMetadata>(RUN_METADATA_SCHEMA_VERSION);

export class RedisSessionStore implements SessionStore {
  readonly #client: Redis;
  readonly #keys: RedisKeyspaces;
  readonly #ttl: ReturnType<typeof resolveTtlConfig>;
  readonly #commitSha: Promise<string>;

  constructor(config: RedisSessionStoreConfig) {
    this.#client = config.client;
    this.#keys = createRedisKeys(config.keyPrefix);
    this.#ttl = resolveTtlConfig(config.ttl);
    this.#commitSha = this.#client
      .script("LOAD", COMMIT_SCRIPT)
      .then((result: unknown) => String(result));
  }

  async loadSession(identity: ExecutionIdentity, sessionId: string): Promise<LoadedSession> {
    const sessionKey = this.#keys.session(identity.tenantId, identity.userId, sessionId);
    const versionKey = this.#keys.sessionVersion(identity.tenantId, identity.userId, sessionId);
    const [raw, versionRaw] = await this.#client.mget(sessionKey, versionKey);
    const version = versionRaw ? Number.parseInt(versionRaw, 10) : 0;
    if (!raw) return { record: null, version: 0 };
    const record = sessionCodec.decode(raw);
    if (!record) return { record: null, version: 0 };
    return { record, version: Number.isFinite(version) ? version : 0 };
  }

  async commitSession(
    identity: ExecutionIdentity,
    sessionId: string,
    record: SessionRecord,
    expectedVersion: number,
  ): Promise<boolean> {
    const sessionKey = this.#keys.session(identity.tenantId, identity.userId, sessionId);
    const versionKey = this.#keys.sessionVersion(identity.tenantId, identity.userId, sessionId);
    const sha = await this.#commitSha;
    const result = await this.#client.evalsha(
      sha,
      2,
      sessionKey,
      versionKey,
      String(expectedVersion),
      sessionCodec.encode(record),
      String(this.#ttl.session),
    );
    return result === 1;
  }

  async recordRun(identity: ExecutionIdentity, sessionId: string, metadata: RunMetadata) {
    const runKey = this.#keys.runMetadata(identity.tenantId, identity.userId, sessionId);
    const remaining = await this.#remainingTtl(runKey, this.#ttl.runMetadata);
    await this.#client.set(runKey, runCodec.encode(metadata), "EX", remaining);
  }

  async lastRun(identity: ExecutionIdentity, sessionId: string): Promise<RunMetadata | null> {
    const runKey = this.#keys.runMetadata(identity.tenantId, identity.userId, sessionId);
    const raw = await this.#client.get(runKey);
    return runCodec.decode(raw);
  }

  async #remainingTtl(key: string, fallback: number): Promise<number> {
    const pttl = await this.#client.pttl(key);
    return pttl > 0 ? Math.max(1, Math.ceil(pttl / 1_000)) : fallback;
  }
}
