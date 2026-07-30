import type { WorkflowState, WorkflowStateStore } from "@deep-agent-template/core";
import type { Redis } from "ioredis";
import { RedisCodec, WORKFLOW_STATE_SCHEMA_VERSION } from "./codec.ts";
import { createRedisKeys, type RedisKeyspaces, resolveTtlConfig, type TtlConfig } from "./keys.ts";

const codec = new RedisCodec<WorkflowState>(WORKFLOW_STATE_SCHEMA_VERSION);

export type RedisWorkflowStateStoreConfig = {
  readonly client: Redis;
  readonly keyPrefix: string;
  readonly ttl?: TtlConfig;
};

// Redis-backed WorkflowStateStore. State is keyed by LangGraph threadId (an
// opaque hash derived from tenant+user+session — see thread-key.ts). A TTL
// keeps the keyspace bounded so abandoned threads eventually disappear.
export class RedisWorkflowStateStore implements WorkflowStateStore {
  readonly #client: Redis;
  readonly #keys: RedisKeyspaces;
  readonly #ttl: ReturnType<typeof resolveTtlConfig>;

  constructor(config: RedisWorkflowStateStoreConfig) {
    this.#client = config.client;
    this.#keys = createRedisKeys(config.keyPrefix);
    this.#ttl = resolveTtlConfig(config.ttl);
  }

  async load(threadId: string): Promise<WorkflowState | undefined> {
    const raw = await this.#client.get(this.#keys.workflowState(threadId));
    return codec.decode(raw) ?? undefined;
  }

  async save(threadId: string, state: WorkflowState): Promise<void> {
    await this.#client.set(
      this.#keys.workflowState(threadId),
      codec.encode(state),
      "EX",
      this.#ttl.workflowState,
    );
  }

  async archive(threadId: string): Promise<void> {
    await this.#client.del(this.#keys.workflowState(threadId));
  }
}
