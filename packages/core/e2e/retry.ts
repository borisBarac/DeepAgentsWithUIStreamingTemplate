export type RetryOptions = {
  name: string;
  attempts?: number;
  timeoutMs?: number;
};

/**
 * Lean retry loop for live model e2e tests. Runs `fn` up to `attempts` times,
 * enforcing a per-attempt `timeoutMs` so a hung model call cannot burn the
 * whole budget on a single attempt. On every failure it logs a one-line
 * summary; the last error is rethrown after the final attempt. Deliberately
 * free of diagnostic/transcript machinery — tests assert on their own results.
 */
export async function runWithRetry<T>(
  fn: () => Promise<T>,
  { name, attempts = 2, timeoutMs }: RetryOptions,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await (timeoutMs ? withTimeout(fn(), timeoutMs, name, attempt, attempts) : fn());
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        console.error(
          `[${name} · attempt ${attempt}/${attempts}] failed:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  }
  throw lastError;
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  name: string,
  attempt: number,
  attempts: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(`[${name} · attempt ${attempt}/${attempts}] timed out after ${timeoutMs}ms`),
        ),
      timeoutMs,
    );
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
