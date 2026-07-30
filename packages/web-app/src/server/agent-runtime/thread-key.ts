import { createHash } from "node:crypto";

const NULL = "\u0000";

export function createInternalThreadKey(
  tenantId: string,
  userId: string,
  sessionId: string,
): string {
  const material = `${tenantId}${NULL}${userId}${NULL}${sessionId}`;
  const digest = createHash("sha256").update(material, "utf8").digest("hex").slice(0, 32);
  return `rt_${digest}`;
}
