import { createHash } from "node:crypto";

// LangGraph thread ids flow into store namespaces (including filesystem-backed
// stores), so they must be deterministic, collision-proof across tenants and
// users, and safe to use as path segments. We derive a truncated SHA-256 digest
// over a null-separated composite of tenant, user, and session so that:
//   - the same (tenant, user, session) always resumes the same workflow state;
//   - distinct tenants/users sharing a sessionId can never collide.
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
