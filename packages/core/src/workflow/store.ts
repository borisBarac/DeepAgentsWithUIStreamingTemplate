import { randomUUID } from "node:crypto";
import type { BaseStore } from "@langchain/langgraph";

import type { WorkflowState } from "./types.ts";

// Workflow state store protocol. Workflow state is keyed by threadId so two
// threads never collide. The protocol is async so a durable backend
// (Redis/DB) can round-trip without blocking the event loop; the in-process
// adapter resolves synchronously behind the same Promise shape.
export type WorkflowStateStore = {
  load(threadId: string): Promise<WorkflowState | undefined>;
  save(threadId: string, state: WorkflowState): Promise<void>;
  archive(threadId: string): Promise<void>;
};

// Local in-process adapter for WorkflowStateStore. Active state lives in
// #active for reuse across controller instances. Archiving is terminal cleanup:
// completed state is deleted rather than retained in process memory.
export class InMemoryWorkflowStateStore implements WorkflowStateStore {
  readonly #active = new Map<string, WorkflowState>();

  async load(threadId: string): Promise<WorkflowState | undefined> {
    return this.#active.get(threadId);
  }

  async save(threadId: string, state: WorkflowState): Promise<void> {
    this.#active.set(threadId, state);
  }

  async archive(threadId: string): Promise<void> {
    this.#active.delete(threadId);
  }
}

// BaseStore-backed adapter for WorkflowStateStore. Restores the contract that
// ANY LangGraph BaseStore passed to the agent backs workflow state: active
// state lives under ["agent-workflow", threadId] key "active"; archiving copies
// the current state into ["agent-workflow", threadId, "archive"] under a random
// key and deletes "active" so a subsequent load() returns undefined. The
// namespace scheme matches the pre-abstraction controller exactly, so any
// state written by that controller (or by a sibling process sharing the same
// BaseStore) is readable here — i.e. a rebuilt agent resumes the same workflow.
export class BaseStoreWorkflowStateStore implements WorkflowStateStore {
  readonly #store: BaseStore;

  constructor(store: BaseStore) {
    this.#store = store;
  }

  async load(threadId: string): Promise<WorkflowState | undefined> {
    const item = await this.#store.get(["agent-workflow", threadId], "active");
    return item?.value as WorkflowState | undefined;
  }

  async save(threadId: string, state: WorkflowState): Promise<void> {
    await this.#store.put(["agent-workflow", threadId], "active", state);
  }

  async archive(threadId: string): Promise<void> {
    const current = await this.load(threadId);
    if (current) {
      await this.#store.put(["agent-workflow", threadId, "archive"], randomUUID(), current);
    }
    await this.#store.delete(["agent-workflow", threadId], "active");
  }
}
