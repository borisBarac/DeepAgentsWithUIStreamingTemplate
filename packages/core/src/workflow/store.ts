import type { WorkflowState } from "./types.ts";

// Workflow state store protocol. Workflow state is keyed by threadId so two
// threads never collide. The protocol is synchronous by request: callers may
// await the result, but the store itself performs no async I/O. A durable
// backend (Redis/DB) would require a synchronous in-process mirror with
// asynchronous Redis synchronization behind this interface.
export type WorkflowStateStore = {
  load(threadId: string): WorkflowState | undefined;
  save(threadId: string, state: WorkflowState): void;
  archive(threadId: string, state: WorkflowState): void;
};

// Reserved configuration for the future Redis-backed WorkflowStateStore. The
// constructor accepts this without connecting to Redis; every method throws
// until the implementation lands behind this protocol.
export type RedisWorkflowStateStoreOptions = {
  url?: string;
  keyPrefix?: string;
  ttlSeconds?: number;
};

const REDIS_WORKFLOW_STATE_STORE_NOT_IMPLEMENTED =
  "RedisWorkflowStateStore is not implemented yet.";

// Local in-process adapter for WorkflowStateStore. Active state lives in
// #active; archived state accumulates per thread in #archived. Both maps are
// unbounded; the store is intended to be shared across controller instances
// for the lifetime of a process.
export class InMemoryWorkflowStateStore implements WorkflowStateStore {
  readonly #active = new Map<string, WorkflowState>();
  readonly #archived = new Map<string, WorkflowState[]>();

  load(threadId: string): WorkflowState | undefined {
    return this.#active.get(threadId);
  }

  save(threadId: string, state: WorkflowState): void {
    this.#active.set(threadId, state);
  }

  archive(threadId: string, state: WorkflowState): void {
    const bucket = this.#archived.get(threadId) ?? [];
    bucket.push(state);
    this.#archived.set(threadId, bucket);
    this.#active.delete(threadId);
  }
}

// Placeholder for the future Redis-backed store. Constructed with reserved
// configuration so call sites can wire the type now; every method throws a
// clear not-implemented error. No Redis dependency, connection management,
// serialization, TTL, or migration is added yet.
export class RedisWorkflowStateStore implements WorkflowStateStore {
  constructor(readonly options: RedisWorkflowStateStoreOptions = {}) {}

  load(_threadId: string): WorkflowState | undefined {
    throw new Error(REDIS_WORKFLOW_STATE_STORE_NOT_IMPLEMENTED);
  }

  save(_threadId: string, _state: WorkflowState): void {
    throw new Error(REDIS_WORKFLOW_STATE_STORE_NOT_IMPLEMENTED);
  }

  archive(_threadId: string, _state: WorkflowState): void {
    throw new Error(REDIS_WORKFLOW_STATE_STORE_NOT_IMPLEMENTED);
  }
}
