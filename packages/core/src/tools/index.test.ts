import { describe, expect, it } from "bun:test";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

import type { SpecialistRole } from "../scaffold/index.ts";
import {
  createDefaultSpecialistRoleToolsets,
  createSpecializedToolStore,
  resolveSpecializedTools,
  resolveSpecializedToolsForRoles,
} from "./index.ts";

describe("specialized tool store", () => {
  const searchTool = tool(async ({ query }: { query: string }) => `search:${query}`, {
    name: "search_sources",
    description: "Search source material.",
    schema: z.object({
      query: z.string(),
    }),
  });

  const retrieveTool = tool(async ({ id }: { id: string }) => `retrieve:${id}`, {
    name: "retrieve_document",
    description: "Retrieve a document by id.",
    schema: z.object({
      id: z.string(),
    }),
  });

  const executeTool = tool(async ({ code }: { code: string }) => `execute:${code}`, {
    name: "run_analysis",
    description: "Execute an analysis step.",
    schema: z.object({
      code: z.string(),
    }),
  });

  const verifyTool = tool(async ({ claim }: { claim: string }) => `verify:${claim}`, {
    name: "verify_grounding",
    description: "Check groundedness and citations.",
    schema: z.object({
      claim: z.string(),
    }),
  });

  it("resolves tools for a single role and multiple roles in declaration order", () => {
    const store = createSpecializedToolStore({
      tools: [
        {
          id: "search",
          tool: searchTool,
          specialists: ["researcher"],
          evidenceMode: "retrieval",
        },
        {
          id: "retrieve",
          tool: retrieveTool,
          specialists: ["researcher", "critic"],
          evidenceMode: "citation",
        },
        {
          id: "verify",
          tool: verifyTool,
          specialists: ["critic"],
          evidenceMode: "citation",
        },
      ],
      roles: [
        {
          role: "researcher",
          toolIds: ["search", "retrieve"],
        },
        {
          role: "critic",
          toolIds: ["retrieve", "verify"],
        },
      ],
    });

    expect(
      resolveSpecializedTools(store, "researcher").map((resolvedTool) => resolvedTool.name),
    ).toEqual(["search_sources", "retrieve_document"]);
    expect(
      resolveSpecializedToolsForRoles(store, ["researcher", "critic"]).map(
        (resolvedTool) => resolvedTool.name,
      ),
    ).toEqual(["search_sources", "retrieve_document", "verify_grounding"]);
  });

  it("keeps role bundles explicit and exposes metadata without changing resolution", () => {
    const store = createSpecializedToolStore({
      tools: [
        {
          id: "execute",
          tool: executeTool,
          specialists: ["analyst"],
          riskLevel: "restricted",
          evidenceMode: "execution",
        },
      ],
      roles: [
        {
          role: "analyst",
          toolIds: ["execute"],
          purpose: "Computation and file-based work.",
        },
      ],
    });

    expect(store.getRoleToolset("analyst")).toEqual({
      role: "analyst",
      toolIds: ["execute"],
      purpose: "Computation and file-based work.",
    });
    expect(store.getRoleToolDefinitions("analyst")[0]).toMatchObject({
      id: "execute",
      specialists: ["analyst"],
      riskLevel: "restricted",
      evidenceMode: "execution",
    });
    expect(store.resolveRoleTools("analyst")).toEqual([executeTool]);
  });

  it("reports whether a role includes restricted tools", () => {
    const store = createSpecializedToolStore<SpecialistRole>({
      tools: [
        {
          id: "search",
          tool: searchTool,
          riskLevel: "safe",
        },
        {
          id: "execute",
          tool: executeTool,
          riskLevel: "restricted",
        },
      ],
      roles: [
        {
          role: "researcher",
          toolIds: ["search"],
        },
        {
          role: "analyst",
          toolIds: ["execute"],
        },
      ],
    });

    expect(store.roleHasRestrictedTools("researcher")).toBeFalse();
    expect(store.roleHasRestrictedTools("analyst")).toBeTrue();
    expect(store.roleHasRestrictedTools("critic")).toBeFalse();
    expect(store.roleHasRestrictedTools("clarifier")).toBeFalse();
  });

  it("provides explicit default specialist role bundles", () => {
    expect(createDefaultSpecialistRoleToolsets()).toEqual([
      {
        role: "clarifier",
        toolIds: [],
        purpose: "Structured intake, requirement checks, and preflight readiness gating.",
      },
      {
        role: "researcher",
        toolIds: [],
        purpose: "Evidence gathering, retrieval, search, and source collection.",
      },
      {
        role: "analyst",
        toolIds: [],
        purpose: "Computation, extraction, transformation, and file-based analysis.",
      },
      {
        role: "critic",
        toolIds: [],
        purpose: "Grounding, citation checks, and policy or quality verification.",
      },
    ]);
  });

  it("rejects duplicate tool ids", () => {
    expect(() =>
      createSpecializedToolStore({
        tools: [
          {
            id: "search",
            tool: searchTool,
          },
          {
            id: "search",
            tool: retrieveTool,
          },
        ],
        roles: [],
      }),
    ).toThrow('Duplicate specialized tool id "search".');
  });

  it("rejects duplicate role ids", () => {
    expect(() =>
      createSpecializedToolStore({
        tools: [
          {
            id: "search",
            tool: searchTool,
          },
        ],
        roles: [
          {
            role: "researcher",
            toolIds: ["search"],
          },
          {
            role: "researcher",
            toolIds: ["search"],
          },
        ],
      }),
    ).toThrow('Duplicate specialized role "researcher".');
  });

  it("rejects unknown tool ids referenced by a role", () => {
    expect(() =>
      createSpecializedToolStore({
        tools: [
          {
            id: "search",
            tool: searchTool,
          },
        ],
        roles: [
          {
            role: "critic",
            toolIds: ["verify"],
          },
        ],
      }),
    ).toThrow('Specialized role "critic" references unknown tool id "verify".');
  });

  it("returns empty tool arrays for unknown roles", () => {
    const store = createSpecializedToolStore<SpecialistRole>({
      tools: [
        {
          id: "search",
          tool: searchTool,
        },
      ],
      roles: [
        {
          role: "researcher",
          toolIds: ["search"],
        },
      ],
    });

    expect(store.resolveRoleTools("critic")).toEqual([]);
  });
});
