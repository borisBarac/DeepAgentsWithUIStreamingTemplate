// Minimal in-memory Redis fake for unit tests of the Redis-backed stores. It
// implements just the commands our production code uses (GET/SET/MGET/DEL/INCR/
// EXPIRE/SADD/SREM/SMEMBERS/MULTI/EXEC/XADD/XREAD/XLEN/XTRIM/SCRIPT LOAD/EVALSHA
// /PING/QUIT) with the same call signatures and return shapes as ioredis. TTLs
// are tracked but not enforced in real time — tests can inspect them directly.
//
// This is intentionally NOT a general-purpose Redis mock. It exists so the
// store layer can be unit-tested without spinning up a real Redis or pulling
// in a heavy mock dependency.

import type { Redis as IORedis } from "ioredis";

type SortedSetEntry = { score: number; member: string };

type StreamEntry = { id: string; fields: string[] };

type KeyEntry =
  | { type: "string"; value: string; expiresAt?: number }
  | { type: "set"; members: Set<string>; expiresAt?: number }
  | {
      type: "stream";
      entries: StreamEntry[];
      lastTimestamp: number;
      lastSeq: number;
      expiresAt?: number;
    }
  | { type: "zset"; entries: SortedSetEntry[]; expiresAt?: number };

// `Redis` from ioredis has hundreds of methods; tests treat the fake as the
// real type via this alias so call sites compile without per-call casts.
export type FakeRedisLike = IORedis;

export class FakeRedis {
  readonly #store = new Map<string, KeyEntry>();
  readonly #scripts = new Map<string, string>();
  #scriptCounter = 0;
  #streamIdCounter = 0;
  #disconnected = false;

  // Test seam: when non-empty, xread() returns these verbatim in call order
  // (bypassing #readStreams) so tests can feed the real ioredis nested-array
  // reply shape — or malformed shapes — through RedisEventStream.read().
  readonly _xreadReplies: unknown[] = [];

  // Test seam: cast the fake as the real `Redis` type so it can be passed to
  // production code that types its dependency as `Redis` from ioredis. Only
  // the commands actually implemented are guaranteed to behave correctly.
  asRedis(): FakeRedisLike {
    return this as unknown as FakeRedisLike;
  }

  // Test-only inspection helpers.
  _entries(): Map<string, KeyEntry> {
    return this.#store;
  }

  _raw(key: string): KeyEntry | undefined {
    return this.#store.get(key);
  }

  _clear(): void {
    this.#store.clear();
    this.#scripts.clear();
    this.#scriptCounter = 0;
    this.#streamIdCounter = 0;
    this._xreadReplies.length = 0;
  }

  _disconnect(): void {
    this.#disconnected = true;
  }

  private checkLive(): void {
    if (this.#disconnected) {
      throw new Error("Connection is closed.");
    }
  }

  // --- Common commands ---------------------------------------------------

  async ping(): Promise<string> {
    return "PONG";
  }

  async quit(): Promise<string> {
    this.#disconnected = true;
    return "OK";
  }

  async get(key: string): Promise<string | null> {
    this.checkLive();
    const entry = this.#store.get(key);
    if (!entry || entry.type !== "string") return null;
    return entry.value;
  }

  async set(key: string, value: string, ...rest: unknown[]): Promise<string | null> {
    this.checkLive();
    // Parse the ioredis variadic SET args: [EX seconds] [NX | XX]
    let ttl: number | undefined;
    let nx = false;
    let xx = false;
    for (let i = 0; i < rest.length; i++) {
      const token = rest[i];
      if (token === "EX") {
        const seconds = rest[i + 1];
        if (typeof seconds !== "number" && typeof seconds !== "string") {
          throw new Error("SET EX requires a numeric seconds value.");
        }
        ttl = Number(seconds);
        i++;
      } else if (token === "PX") {
        const ms = rest[i + 1];
        if (typeof ms !== "number" && typeof ms !== "string") {
          throw new Error("SET PX requires a numeric milliseconds value.");
        }
        ttl = Number(ms) / 1000;
        i++;
      } else if (token === "NX") {
        nx = true;
      } else if (token === "XX") {
        xx = true;
      }
    }

    const existing = this.#store.get(key);
    if (nx && existing) return null;
    if (xx && !existing) return null;

    const entry: KeyEntry = {
      expiresAt: ttl !== undefined ? Date.now() + ttl * 1000 : undefined,
      type: "string",
      value,
    };
    this.#store.set(key, entry);
    return "OK";
  }

  async del(...keys: string[]): Promise<number> {
    this.checkLive();
    let removed = 0;
    for (const key of keys) {
      if (this.#store.delete(key)) removed++;
    }
    return removed;
  }

  async mget(...keys: string[]): Promise<(string | null)[]> {
    this.checkLive();
    return keys.map((key) => {
      const entry = this.#store.get(key);
      return entry && entry.type === "string" ? entry.value : null;
    });
  }

  async incr(key: string): Promise<number> {
    this.checkLive();
    const existing = this.#store.get(key);
    const current =
      existing && existing.type === "string" ? Number.parseInt(existing.value, 10) : 0;
    if (!Number.isFinite(current)) throw new Error("INC: value is not an integer.");
    const next = current + 1;
    this.#store.set(key, { type: "string", value: String(next) });
    return next;
  }

  async expire(key: string, seconds: number): Promise<number> {
    this.checkLive();
    const entry = this.#store.get(key);
    if (!entry) return 0;
    entry.expiresAt = Date.now() + seconds * 1000;
    return 1;
  }

  // --- Sets --------------------------------------------------------------

  async sadd(key: string, ...members: string[]): Promise<number> {
    this.checkLive();
    let added = 0;
    let entry = this.#store.get(key);
    if (!entry || entry.type !== "set") {
      entry = { members: new Set<string>(), type: "set" };
      this.#store.set(key, entry);
    }
    const set = entry.members;
    for (const m of members) {
      if (!set.has(m)) {
        set.add(m);
        added++;
      }
    }
    return added;
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    this.checkLive();
    const entry = this.#store.get(key);
    if (!entry || entry.type !== "set") return 0;
    let removed = 0;
    for (const m of members) {
      if (entry.members.delete(m)) removed++;
    }
    if (entry.members.size === 0) this.#store.delete(key);
    return removed;
  }

  async smembers(key: string): Promise<string[]> {
    this.checkLive();
    const entry = this.#store.get(key);
    if (!entry || entry.type !== "set") return [];
    return [...entry.members];
  }

  // --- Pipelining / transactions ----------------------------------------

  multi(): FakeMulti {
    return new FakeMulti(this);
  }

  // --- Streams -----------------------------------------------------------

  async xadd(key: string, ...rest: (string | number)[]): Promise<string | null> {
    this.checkLive();
    // Signature variants used in production:
    //   XADD key MAXLEN ~ count * field value
    //   XADD key * field value
    let i = 0;
    let maxLen: number | undefined;
    if (rest[i] === "MAXLEN") {
      i++; // MAXLEN
      if (rest[i] === "~" || rest[i] === "=") i++;
      maxLen = Number(rest[i]);
      i++;
    }
    let id: string;
    if (rest[i] === "*") {
      id = this.#generateStreamId(key);
      i++;
    } else {
      id = String(rest[i]);
      i++;
    }
    const fields: string[] = [];
    for (; i < rest.length; i++) {
      fields.push(String(rest[i]));
    }

    let entry = this.#store.get(key);
    if (!entry || entry.type !== "stream") {
      entry = { entries: [], lastSeq: 0, lastTimestamp: 0, type: "stream" };
      this.#store.set(key, entry);
    }
    entry.entries.push({ fields, id });
    if (maxLen !== undefined && entry.entries.length > maxLen) {
      const drop = entry.entries.length - maxLen;
      entry.entries.splice(0, drop);
    }
    return id;
  }

  async xread(...args: unknown[]): Promise<[string, [string, string[]][]][] | null> {
    this.checkLive();
    // Test seam: serve pre-seeded replies verbatim in call order so tests can
    // exercise the real ioredis nested-array shape (or malformed shapes)
    // without going through #readStreams.
    if (this._xreadReplies.length > 0) {
      return this._xreadReplies.shift() as [string, [string, string[]][]][] | null;
    }
    // Parse: COUNT n BLOCK ms STREAMS key1 key2 ... id1 id2 ...
    let count = Number.MAX_SAFE_INTEGER;
    let blockMs = 0;
    let i = 0;
    while (i < args.length) {
      const token = args[i];
      if (token === "COUNT") {
        count = Number(args[i + 1]);
        i += 2;
      } else if (token === "BLOCK") {
        blockMs = Number(args[i + 1]);
        i += 2;
      } else if (token === "STREAMS") {
        i++;
        break;
      } else {
        i++;
      }
    }
    const remaining = args.slice(i).map(String);
    if (remaining.length % 2 !== 0) {
      throw new Error("XREAD STREAMS requires an even number of keys + ids.");
    }
    const half = remaining.length / 2;
    const keys = remaining.slice(0, half);
    const ids = remaining.slice(half);

    const result = this.#readStreams(keys, ids, count);
    if (result !== null) return result;

    // No data ready. When BLOCK is requested, yield to the event loop so the
    // consumer's for-await loop does not busy-spin while waiting for the next
    // publishX. The fake does not actually block for blockMs — it just lets
    // other microtasks/macrotasks run.
    if (blockMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    return null;
  }

  #readStreams(
    keys: readonly string[],
    ids: readonly string[],
    count: number,
  ): [string, [string, string[]][]][] | null {
    // Mirror the real ioredis XREAD reply shape: a nested array of
    // [streamKey, [[id, [field, value, ...]], ...]] entries.
    const out: [string, [string, string[]][]][] = [];
    let any = false;
    for (let s = 0; s < keys.length; s++) {
      const key = keys[s];
      const afterId = ids[s];
      if (!key || afterId === undefined) continue;
      const entry = this.#store.get(key);
      if (!entry || entry.type !== "stream") continue;
      const matching: [string, string[]][] = [];
      for (const e of entry.entries) {
        if (compareStreamIds(e.id, afterId) <= 0) continue;
        matching.push([e.id, [...e.fields]]);
        if (matching.length >= count) break;
      }
      if (matching.length > 0) {
        out.push([key, matching]);
        any = true;
      }
    }
    return any ? out : null;
  }

  async xlen(key: string): Promise<number> {
    this.checkLive();
    const entry = this.#store.get(key);
    if (!entry || entry.type !== "stream") return 0;
    return entry.entries.length;
  }

  async xtrim(key: string, strategy: string, approx: string, count: number): Promise<number> {
    this.checkLive();
    if (strategy !== "MAXLEN") return 0;
    void approx;
    const entry = this.#store.get(key);
    if (!entry || entry.type !== "stream") return 0;
    const before = entry.entries.length;
    if (entry.entries.length > count) {
      entry.entries.splice(0, entry.entries.length - count);
    }
    return before - entry.entries.length;
  }

  // --- Scripting ---------------------------------------------------------

  async script(command: string, ...args: string[]): Promise<string> {
    this.checkLive();
    if (command !== "LOAD") {
      throw new Error(`FakeRedis.script does not implement ${command}.`);
    }
    const source = args[0];
    if (!source) throw new Error("SCRIPT LOAD requires source.");
    const sha = `sha-${this.#scriptCounter.toString(16)}-${source.length.toString(36)}`;
    this.#scriptCounter++;
    this.#scripts.set(sha, source);
    return sha;
  }

  async evalsha(sha: string, numkeys: number, ...rest: string[]): Promise<unknown> {
    this.checkLive();
    const source = this.#scripts.get(sha);
    if (!source) throw new Error(`NOSCRIPT No matching script for sha ${sha}.`);
    const keys = rest.slice(0, numkeys);
    const argv = rest.slice(numkeys);
    return runLuaSubset(source, keys, argv, this.#store);
  }

  // --- Internal helpers --------------------------------------------------

  #generateStreamId(key: string): string {
    // ioredis stream ids are "{ms}-{seq}". We use a process-wide counter to
    // guarantee monotonicity across calls within a single test.
    const now = Date.now();
    const entry = this.#store.get(key);
    let seq = 0;
    let lastTs = now;
    if (entry && entry.type === "stream") {
      if (entry.lastTimestamp === now) {
        seq = entry.lastSeq + 1;
      }
      lastTs = now;
    }
    if (entry && entry.type === "stream") {
      entry.lastSeq = seq;
      entry.lastTimestamp = lastTs;
    } else {
      this.#store.set(key, {
        entries: [],
        lastSeq: seq,
        lastTimestamp: lastTs,
        type: "stream",
      });
    }
    void this.#streamIdCounter++;
    return `${now}-${seq}`;
  }
}

class FakeMulti {
  readonly #fake: FakeRedis;
  readonly #ops: (() => Promise<unknown>)[] = [];

  constructor(fake: FakeRedis) {
    this.#fake = fake;
  }

  set(...args: unknown[]): this {
    this.#ops.push(() => this.#fake.set(...(args as Parameters<FakeRedis["set"]>)));
    return this;
  }

  get(key: string): this {
    this.#ops.push(() => this.#fake.get(key));
    return this;
  }

  del(...keys: string[]): this {
    this.#ops.push(() => this.#fake.del(...keys));
    return this;
  }

  sadd(key: string, ...members: string[]): this {
    this.#ops.push(() => this.#fake.sadd(key, ...members));
    return this;
  }

  srem(key: string, ...members: string[]): this {
    this.#ops.push(() => this.#fake.srem(key, ...members));
    return this;
  }

  expire(key: string, seconds: number): this {
    this.#ops.push(() => this.#fake.expire(key, seconds));
    return this;
  }

  async exec(): Promise<[error: Error | null, result: unknown][]> {
    const out: [Error | null, unknown][] = [];
    for (const op of this.#ops) {
      try {
        out.push([null, await op()]);
      } catch (error) {
        out.push([error instanceof Error ? error : new Error(String(error)), null]);
      }
    }
    return out;
  }
}

// Compare ioredis stream ids "<ms>-<seq>". Returns negative if a<b, 0 if equal,
// positive if a>b. Treats "$" as greater than everything (used by XREAD to mean
// "only new events").
function compareStreamIds(a: string, b: string): number {
  if (a === "$") return 1;
  if (b === "$") return -1;
  const [aMsStr, aSeqStr] = a.split("-");
  const [bMsStr, bSeqStr] = b.split("-");
  const aMs = Number(aMsStr ?? 0);
  const bMs = Number(bMsStr ?? 0);
  if (aMs !== bMs) return aMs - bMs;
  const aSeq = Number(aSeqStr ?? 0);
  const bSeq = Number(bSeqStr ?? 0);
  return aSeq - bSeq;
}

// Minimal interpreter for the Lua subset our production scripts use:
//   - locals, assignments, numeric/string literals
//   - redis.call('GET'|'SET'|'DEL'|'INCR'|'CJSON.DECODE', ...)
//   - cjson.decode() (when called directly)
//   - tonumber, tostring
//   - if/then/return control flow
//
// We don't aim to be a real Lua interpreter — only enough to evaluate the
// specific scripts in this codebase. New scripts MUST be accompanied by tests
// that exercise them through the FakeRedis.script / evalsha entry points so
// breakage is caught.
function runLuaSubset(
  source: string,
  keys: string[],
  argv: string[],
  store: Map<string, KeyEntry>,
): unknown {
  // ACQUIRE_SCRIPT (session-lock acquire): atomic SET NX placeholder, INCR
  // counter, rewrite record with the real fencing token. Returns the token
  // (number) on success or the current holder value (string) on conflict.
  if (source.includes("parsed.payload.fencingToken = token")) {
    const lockKey = keys[0];
    const counterKey = keys[1];
    if (!lockKey || !counterKey) {
      throw new Error("ACQUIRE_SCRIPT requires lockKey + counterKey.");
    }
    const placeholderJson = argv[0];
    const lease = Number(argv[1] ?? 0);
    if (!placeholderJson) throw new Error("ACQUIRE_SCRIPT requires placeholder JSON.");
    const existing = store.get(lockKey);
    if (existing && existing.type === "string") {
      return existing.value;
    }
    const ttl = lease ? Date.now() + lease * 1000 : undefined;
    store.set(lockKey, { expiresAt: ttl, type: "string", value: placeholderJson });
    const ctrEntry = store.get(counterKey);
    const cur = ctrEntry && ctrEntry.type === "string" ? Number.parseInt(ctrEntry.value, 10) : 0;
    const token = cur + 1;
    // Counter has NO expiry — it stays monotonic for the keyspace lifetime.
    store.set(counterKey, { type: "string", value: String(token) });
    const parsed = JSON.parse(placeholderJson) as { payload: { fencingToken: number } };
    parsed.payload.fencingToken = token;
    store.set(lockKey, { expiresAt: ttl, type: "string", value: JSON.stringify(parsed) });
    return token;
  }
  // COMMIT_SCRIPT (session-lock release): test expectedVersion, set next version.
  // We pattern-match on script content rather than parse Lua generically.
  if (source.includes("local expected = tonumber(ARGV[1])")) {
    const sessionKey = keys[0];
    const versionKey = keys[1];
    if (!sessionKey || !versionKey) {
      throw new Error("COMMIT_SCRIPT requires sessionKey + versionKey.");
    }
    const expected = Number(argv[0]);
    const encoded = argv[1];
    if (encoded === undefined) throw new Error("COMMIT_SCRIPT requires encoded payload.");
    const ttl = Number(argv[2]);
    const verRaw = store.get(versionKey);
    const current = verRaw && verRaw.type === "string" ? Number.parseInt(verRaw.value, 10) : 0;
    if (current !== expected) return 0;
    const next = current + 1;
    store.set(sessionKey, {
      expiresAt: ttl ? Date.now() + ttl * 1000 : undefined,
      type: "string",
      value: encoded,
    });
    store.set(versionKey, {
      expiresAt: ttl ? Date.now() + ttl * 1000 : undefined,
      type: "string",
      value: String(next),
    });
    return 1;
  }
  // RELEASE_SCRIPT (session-lock release): GET + parse JSON + DEL on token match.
  if (source.includes("local parsed = cjson.decode(current)")) {
    const lockKey = keys[0];
    if (!lockKey) throw new Error("RELEASE_SCRIPT requires lockKey.");
    const expected = argv[0];
    if (expected === undefined) throw new Error("RELEASE_SCRIPT requires expected token.");
    const entry = store.get(lockKey);
    if (!entry || entry.type !== "string") return 1;
    try {
      const parsed = JSON.parse(entry.value) as { payload?: { fencingToken?: number } };
      if (String(parsed.payload?.fencingToken) === expected) {
        store.delete(lockKey);
        return 1;
      }
      return 0;
    } catch {
      return 0;
    }
  }
  throw new Error(`FakeRedis has no interpreter for this Lua script:\n${source}`);
}
