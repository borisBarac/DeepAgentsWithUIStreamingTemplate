import type { Redis } from "ioredis";
import { LOCK_SCHEMA_VERSION, RedisCodec, type SessionLockRecord } from "./codec.ts";
import { createRedisKeys, DEFAULT_LOCK_LEASE_SECONDS, type RedisKeyspaces } from "./keys.ts";

const lockCodec = new RedisCodec<SessionLockRecord>(LOCK_SCHEMA_VERSION);

// Acquire atomically: SET NX the placeholder (fencingToken 0), and on success
// INCR the counter and rewrite the lock record with the real token — all in one
// script so nothing can interleave between winning the NX race and persisting
// the token. A multi-roundtrip acquire left a window where a paused client
// could let its placeholder expire, another client acquire, then this client's
// unconditional final SET clobbered the new owner. Returns the fencing token
// (number) on success, or the current holder's payload (string) on conflict.
//
// The fencing counter is deliberately NOT expired — it must remain monotonic
// for the Redis keyspace lifetime so that a re-acquire after lease expiry always
// produces a token greater than every earlier token. Redis eviction or
// administrative deletion of the counter key is an infrastructure-level reset.
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

// Release only when the stored fencing token matches the one we hold. Prevents
// a stalled worker from releasing a lock that has been re-acquired by another
// worker. We use GET + DEL in Lua to make the check-and-delete atomic.
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

  // Atomically acquire the lock for (tenant, user, session). Returns the
  // fencing token on success (the worker embeds it in commits) or the current
  // holder on conflict. The entire NX-win + token-allocation + record-rewrite
  // runs in a single Lua script (ACQUIRE_SCRIPT) so a paused client cannot
  // clobber a lock that another client legitimately acquired while it stalled.
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

    // Success: the script returns the allocated fencing token as a number.
    if (typeof result === "number") {
      const lock: SessionLockRecord = { ...placeholder, fencingToken: result };
      return { acquired: true, fencingToken: result, lock };
    }

    // Conflict: the script returned the current holder's payload (string), or
    // null if the key vanished between the failed NX and the GET (impossible
    // within one atomic script, but defended regardless).
    const holderRaw = result === null || result === undefined ? null : String(result);
    const holder = holderRaw ? lockCodec.decode(holderRaw) : null;
    return { acquired: false, holder: holder ?? placeholder };
  }

  // Refresh the lease for a held lock. Returns false when the lock has been
  // lost (e.g. lease expired while the worker was unresponsive) — the worker
  // MUST abort the run when refresh returns false, since another worker may
  // already be processing the same session.
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

  // Release the lock only if our fencing token still matches.
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
