// GUEST IDENTITY TRUST MODEL
// --------------------------
// Every user is an anonymous guest. There is no authentication, no user
// database, no tenant provisioning. A guest is identified solely by a UUID v4
// minted client-side and sent on every request via the `x-guest-id` header.
//
// The trust boundary is: "any well-formed UUID v4 is accepted as a guest."
// There is no lookup, no auth, no session token. Sanitization is sufficient
// because:
//   - UUID v4 characters (`[0-9a-f-]`) are filesystem-safe and match the
//     memory namespace encoder's raw-id pattern, so the guest id flows through
//     `createUserMemoryNamespace` without the base64 path and without risk of
//     path traversal.
//   - The session store, agent cache, and LangGraph thread key all
//     derive their keys from the (tenantId, userId, sessionId) tuple, so two
//     guests can never share state by accident.
//
// `tenantId` is a fixed constant ("guests") kept for forward compatibility —
// it gives a future bucket for quotas/rate-limits/audit without requiring an
// identity model migration. With no real tenants today it carries no
// authorization meaning.

export const GUEST_TENANT_ID = "guests";

export type TrustedIdentity = {
  readonly tenantId: string;
  readonly userId: string;
};

export class GuestIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuestIdentityError";
  }
}

// Canonical UUID v4 (RFC 4122): hex with version (4) and variant (8/9/a/b)
// nibbles. Case-insensitive.
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const GUEST_ID_HEADER = "x-guest-id";

/**
 * Validate a guest id string. Returns the trimmed id when valid, otherwise
 * throws {@link GuestIdentityError}. Exposed so callers (route, tests) share
 * one acceptance rule.
 */
export function assertValidGuestId(raw: string | undefined | null): string {
  if (raw === undefined || raw === null) {
    throw new GuestIdentityError("Missing x-guest-id header.");
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new GuestIdentityError("Empty x-guest-id header.");
  }
  if (!UUID_V4_PATTERN.test(trimmed)) {
    throw new GuestIdentityError("Invalid x-guest-id header: expected a UUID v4.");
  }
  return trimmed;
}

/**
 * Resolve the guest identity for an incoming request. Reads the
 * {@link GUEST_ID_HEADER} header, validates it as a UUID v4, and pins the
 * tenant to {@link GUEST_TENANT_ID}. Throws {@link GuestIdentityError} on
 * missing/invalid — the caller (route) maps that to a 400 response so the
 * client can mint a fresh id and retry.
 */
export function resolveGuestIdentity(request: Request): TrustedIdentity {
  const userId = assertValidGuestId(request.headers.get(GUEST_ID_HEADER));
  return { tenantId: GUEST_TENANT_ID, userId };
}
