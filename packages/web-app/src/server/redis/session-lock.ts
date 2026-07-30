import type { Redis } from "ioredis";
import { LOCK_SCHEMA_VERSION, RedisCodec, type SessionLockRecord } from "./codec.ts";
import { createRedisKeys, DEFAULT_LOCK_LEASE_SECONDS, type RedisKeyspaces } from "./keys.ts";

const lockCodec = new RedisCodec<SessionLockRecord>(LOCK_SCHEMA_VERSION);

const ACQUIRE_SCRIPT = `
local ok = redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2], 'NX')
if not ok then
  return redis.call('GET', KEYS[1])
end
local token = redis.call('INCR', KEYS[2])
local parsed = cjson.decode(ARGV[1])
parsed.payload.fencingToken = token
redis.call('SET', KEYS[1], cjson.encode(parsed), 'EX', ARGV[2])
return token
`;

const RELEASE_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then return 1 end
local parsed = cjson.decode(current)
if tostring(parsed.payload.fencingToken) == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 1
end
return 0
`;

export type AcquireResult =
  | { readonly acquired: true; readonly fencingToken: number; readonly lock: SessionLockRecord }
  | { readonly acquired: false; readonly holder: SessionLockRecord };

export type RedisSessionLockOptions = {
  readonly client: Redis;
  readonly keyPrefix: string;
  readonly leaseSeconds?: number;
};

export class RedisSessionLock {
  readonly #client: Redis;
  readonly #keys: RedisKeyspaces;
  readonly #leaseSeconds: number;
  readonly #acquireSha: Promise<string>;
  readonly #releaseSha: Promise<string>;

  constructor(options: RedisSessionLockOptions) {
    this.#client = options.client;
    this.#keys = createRedisKeys(options.keyPrefix);
    this.#leaseSeconds = options.leaseSeconds ?? DEFAULT_LOCK_LEASE_SECONDS;
    this.#acquireSha = this.#client.script("LOAD", ACQUIRE_SCRIPT).then((r: unknown) => String(r));
    this.#releaseSha = this.#client.script("LOAD", RELEASE_SCRIPT).then((r: unknown) => String(r));
  }

  async acquire(
    tenantId: string,
    userId: string,
    sessionId: string,
    runId: string,
  ): Promise<AcquireResult> {
    const lockKey = this.#keys.sessionLock(tenantId, userId, sessionId);
    const counterKey = this.#counterKey(tenantId, userId, sessionId);
    const placeholder: SessionLockRecord = {
      acquiredAt: Date.now(),
      fencingToken: 0,
      identity: { tenantId, userId },
      runId,
      sessionId,
    };

    const sha = await this.#acquireSha;
    const result = await this.#client.evalsha(
      sha,
      2,
      lockKey,
      counterKey,
      lockCodec.encode(placeholder),
      String(this.#leaseSeconds),
    );

    if (typeof result === "number") {
      const lock: SessionLockRecord = { ...placeholder, fencingToken: result };
      return { acquired: true, fencingToken: result, lock };
    }

    const holderRaw = result === null || result === undefined ? null : String(result);
    const holder = holderRaw ? lockCodec.decode(holderRaw) : null;
    return { acquired: false, holder: holder ?? placeholder };
  }

  async refresh(
    tenantId: string,
    userId: string,
    sessionId: string,
    fencingToken: number,
  ): Promise<boolean> {
    const lockKey = this.#keys.sessionLock(tenantId, userId, sessionId);
    const current = lockCodec.decode(await this.#client.get(lockKey));
    if (!current || current.fencingToken !== fencingToken) return false;
    await this.#client.set(lockKey, lockCodec.encode(current), "EX", this.#leaseSeconds);
    return true;
  }

  async release(
    tenantId: string,
    userId: string,
    sessionId: string,
    fencingToken: number,
  ): Promise<boolean> {
    const lockKey = this.#keys.sessionLock(tenantId, userId, sessionId);
    const sha = await this.#releaseSha;
    const result = await this.#client.evalsha(sha, 1, lockKey, String(fencingToken));
    return result === 1 || result === "1";
  }

  async currentHolder(
    tenantId: string,
    userId: string,
    sessionId: string,
  ): Promise<SessionLockRecord | null> {
    return lockCodec.decode(
      await this.#client.get(this.#keys.sessionLock(tenantId, userId, sessionId)),
    );
  }

  #counterKey(tenantId: string, userId: string, sessionId: string): string {
    return `${this.#keys.sessionLock(tenantId, userId, sessionId)}:ctr`;
  }
}
