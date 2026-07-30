import { afterEach, describe, expect, it } from "bun:test";

import { resolveGuestIdentity } from "./guest-identity.ts";

const previousGuestSecret = process.env.GUEST_IDENTITY_SECRET;

afterEach(() => {
  if (previousGuestSecret === undefined) delete process.env.GUEST_IDENTITY_SECRET;
  else process.env.GUEST_IDENTITY_SECRET = previousGuestSecret;
});

describe("resolveGuestIdentity", () => {
  it("uses the code default when the environment secret is absent", () => {
    delete process.env.GUEST_IDENTITY_SECRET;

    const result = resolveGuestIdentity(new Request("http://localhost"));

    expect(result.identity.tenantId).toBe("guest");
    expect(result.setCookie).toContain("guest_identity=");
  });
});
