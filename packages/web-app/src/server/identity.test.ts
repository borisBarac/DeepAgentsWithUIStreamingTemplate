import { describe, expect, it } from "bun:test";

import {
  assertValidGuestId,
  GUEST_ID_HEADER,
  GUEST_TENANT_ID,
  GuestIdentityError,
  resolveGuestIdentity,
} from "./identity.ts";

const VALID_GUEST_A = "11111111-1111-4111-8111-111111111111";
const VALID_GUEST_B = "22222222-2222-4222-9222-222222222222";

function requestWith(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/agent", { headers });
}

describe("assertValidGuestId", () => {
  it("accepts a canonical UUID v4 (lowercase)", () => {
    expect(assertValidGuestId(VALID_GUEST_A)).toBe(VALID_GUEST_A);
  });

  it("accepts a canonical UUID v4 (uppercase) and returns it trimmed", () => {
    const upper = VALID_GUEST_A.toUpperCase();
    expect(assertValidGuestId(upper)).toBe(upper);
  });

  it("trims surrounding whitespace before validating", () => {
    expect(assertValidGuestId(`  ${VALID_GUEST_A}  `)).toBe(VALID_GUEST_A);
  });

  it("rejects undefined", () => {
    expect(() => assertValidGuestId(undefined)).toThrow(GuestIdentityError);
  });

  it("rejects empty string", () => {
    expect(() => assertValidGuestId("")).toThrow(GuestIdentityError);
  });

  it("rejects whitespace-only string", () => {
    expect(() => assertValidGuestId("   ")).toThrow(GuestIdentityError);
  });

  it("rejects a non-UUID string", () => {
    expect(() => assertValidGuestId("alice@example.com")).toThrow(GuestIdentityError);
    expect(() => assertValidGuestId("not-a-uuid")).toThrow(GuestIdentityError);
  });

  it("rejects a malformed UUID (wrong version nibble)", () => {
    // 3rd group must start with 4 for v4.
    const bad = "11111111-1111-3111-8111-111111111111";
    expect(() => assertValidGuestId(bad)).toThrow(GuestIdentityError);
  });

  it("rejects a malformed UUID (wrong variant nibble)", () => {
    // 4th group must start with 8/9/a/b.
    const bad = "11111111-1111-4111-7111-111111111111";
    expect(() => assertValidGuestId(bad)).toThrow(GuestIdentityError);
  });

  it("rejects path-traversal attempts", () => {
    expect(() => assertValidGuestId("../../etc/passwd")).toThrow(GuestIdentityError);
    expect(() => assertValidGuestId("11111111-1111-4111-8111-111111111111/../../x")).toThrow(
      GuestIdentityError,
    );
  });
});

describe("resolveGuestIdentity", () => {
  it("returns the guests tenant and the supplied userId for a valid UUID", () => {
    const identity = resolveGuestIdentity(requestWith({ [GUEST_ID_HEADER]: VALID_GUEST_A }));
    expect(identity).toEqual({ tenantId: GUEST_TENANT_ID, userId: VALID_GUEST_A });
  });

  it("treats two distinct guest ids as distinct identities", () => {
    const a = resolveGuestIdentity(requestWith({ [GUEST_ID_HEADER]: VALID_GUEST_A }));
    const b = resolveGuestIdentity(requestWith({ [GUEST_ID_HEADER]: VALID_GUEST_B }));
    expect(a.tenantId).toBe(b.tenantId);
    expect(a.userId).not.toBe(b.userId);
  });

  it("throws GuestIdentityError when the header is missing", () => {
    expect(() => resolveGuestIdentity(requestWith({}))).toThrow(GuestIdentityError);
  });

  it("throws GuestIdentityError when the header is invalid", () => {
    expect(() => resolveGuestIdentity(requestWith({ [GUEST_ID_HEADER]: "not-a-uuid" }))).toThrow(
      GuestIdentityError,
    );
  });

  it("does not read identity from any other source (cookie, query, body)", () => {
    // Even if a cookie or query string carries a valid id, the resolver must
    // only consult the configured header.
    const req = new Request(`http://localhost/api/agent?guest=${VALID_GUEST_A}`, {
      headers: { Cookie: `guest=${VALID_GUEST_A}` },
    });
    expect(() => resolveGuestIdentity(req)).toThrow(GuestIdentityError);
  });
});
