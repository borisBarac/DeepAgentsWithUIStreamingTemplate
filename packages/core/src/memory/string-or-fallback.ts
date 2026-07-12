export function stringOrFallback(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}
