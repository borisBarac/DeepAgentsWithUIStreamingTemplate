import { BaseStore, type Operation, type OperationResults } from "@langchain/langgraph";

export type BucketMemoryStoreOptions = Record<string, unknown>;

export class BucketMemoryStore extends BaseStore {
  readonly options: BucketMemoryStoreOptions;

  constructor(options: BucketMemoryStoreOptions = {}) {
    super();
    this.options = options;
  }

  override batch<Op extends Operation[]>(_operations: Op): Promise<OperationResults<Op>> {
    throw new Error("BucketMemoryStore is not implemented yet.");
  }
}
