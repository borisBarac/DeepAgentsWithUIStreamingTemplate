import type { UiUpdate } from "../generative-ui/index.ts";

class AsyncUpdateQueue implements AsyncIterable<UiUpdate> {
  #closed = false;
  #error: unknown;
  #queue: UiUpdate[] = [];
  #waiter: (() => void) | undefined;

  push(update: UiUpdate): void {
    if (this.#closed) return;
    this.#queue.push(update);
    this.#waiter?.();
    this.#waiter = undefined;
  }

  close(): void {
    this.#closed = true;
    this.#waiter?.();
    this.#waiter = undefined;
  }

  throw(error: unknown): void {
    this.#error = error;
    this.close();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<UiUpdate> {
    while (true) {
      if (this.#queue.length > 0) {
        yield this.#queue.shift() as UiUpdate;
        continue;
      }
      if (this.#error) {
        throw this.#error;
      }
      if (this.#closed) {
        return;
      }
      await new Promise<void>((resolve) => {
        this.#waiter = resolve;
      });
    }
  }
}

export { AsyncUpdateQueue };
