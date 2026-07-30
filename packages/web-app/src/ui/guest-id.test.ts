import { describe, expect, it } from "bun:test";

import { isValidGuestId, mintUuidV4 } from "./guest-id.ts";

const VALID = [
  "11111111-1111-4111-8111-111111111111",
  "ffffffff-ffff-4fff-bfff-ffffffffffff",
  "00000000-0000-4000-8000-000000000000",
  "A4C3B2B1-1234-4567-8ABC-DEF012345678".toUpperCase(),
];

const INVALID = [
  "",
  "not-a-uuid",
  "alice@example.com",
  "11111111-1111-1111-8111-111111111111", // version nibble wrong (3 not 4)
  "11111111-1111-4111-7111-111111111111", // variant nibble wrong (7 not 8/9/a/b)
  "11111111111141118111111111111111", // missing hyphens
  "11111111-1111-4111-8111-111111111111/../../etc", // path traversal
  undefined,
  null,
  "11111111-1111-4111-8111-g11111111111", // non-hex char
];

describe("mintUuidV4", () => {
  it("produces a string that passes isValidGuestId", () => {
    for (let i = 0; i < 64; i += 1) {
      const id = mintUuidV4();
      expect(isValidGuestId(id)).toBe(true);
    }
  });

  it("sets the RFC 4122 v4 version nibble", () => {
    const id = mintUuidV4();
    // 3rd group starts with '4'.
    expect(id.split("-")[2]?.[0]).toBe("4");
  });

  it("sets the RFC 4122 variant nibble (8/9/a/b)", () => {
    for (let i = 0; i < 32; i += 1) {
      const id = mintUuidV4();
      const variant = id.split("-")[3]?.[0]?.toLowerCase() ?? "";
      expect(["8", "9", "a", "b"]).toContain(variant);
    }
  });

  it("does not produce the same id twice in 256 draws (probabilistic)", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 256; i += 1) {
      ids.add(mintUuidV4());
    }
    expect(ids.size).toBe(256);
  });
});

describe("isValidGuestId", () => {
  it("accepts canonical UUID v4 strings", () => {
    for (const value of VALID) {
      expect(isValidGuestId(value)).toBe(true);
    }
  });

  it("rejects malformed values", () => {
    for (const value of INVALID) {
      expect(isValidGuestId(value as string | null | undefined)).toBe(false);
    }
  });

  it("narrows the type for the consumer", () => {
    const maybe: string | undefined = "11111111-1111-4111-8111-111111111111";
    if (isValidGuestId(maybe)) {
      // TS would error on the next line without the type guard.
      expect(maybe.length).toBe(36);
    } else {
      throw new Error("should have been valid");
    }
  });
});
