import { describe, expect, it } from "bun:test";

import { createDefaultPermissions } from "./permissions.ts";

describe("scaffold permissions", () => {
  it("locks the filesystem down to the scaffold roots by default", () => {
    expect(createDefaultPermissions()).toEqual([
      {
        operations: ["read"],
        paths: ["/"],
      },
      {
        operations: ["read", "write"],
        paths: [
          "/scratch",
          "/scratch/**",
          "/plans",
          "/plans/**",
          "/reports",
          "/reports/**",
          "/artifacts",
          "/artifacts/**",
          "/memory",
          "/memory/**",
        ],
      },
      {
        operations: ["read"],
        paths: [
          "/scratch",
          "/scratch/**",
          "/plans",
          "/plans/**",
          "/reports",
          "/reports/**",
          "/artifacts",
          "/artifacts/**",
          "/memory",
          "/memory/**",
          "/skills",
          "/skills/**",
        ],
      },
      {
        operations: ["read", "write"],
        paths: ["/**"],
        mode: "deny",
      },
    ]);
  });
});
