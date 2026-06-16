import type { ClientTool, ServerTool, StructuredTool } from "@langchain/core/tools";

import type { SpecialistRole } from "./scaffold";

export type ToolId = string;
export type RoleId = string;
export type SpecializedAgentTool = StructuredTool | ClientTool | ServerTool;
export type SpecializedToolRiskLevel = "safe" | "restricted";
export type SpecializedToolEvidenceMode = "none" | "retrieval" | "citation" | "execution";

export type SpecializedToolDefinition<TRole extends RoleId = RoleId> = {
  id: ToolId;
  tool: SpecializedAgentTool;
  specialists?: readonly TRole[];
  riskLevel?: SpecializedToolRiskLevel;
  evidenceMode?: SpecializedToolEvidenceMode;
};

export type SpecializedRoleToolset<TRole extends RoleId = RoleId> = {
  role: TRole;
  toolIds: readonly ToolId[];
  purpose?: string;
};

export type CreateSpecializedToolStoreOptions<TRole extends RoleId = RoleId> = {
  tools: readonly SpecializedToolDefinition<TRole>[];
  roles: readonly SpecializedRoleToolset<TRole>[];
};

export type SpecializedToolStore<TRole extends RoleId = RoleId> = {
  hasTool(id: ToolId): boolean;
  getTool(id: ToolId): SpecializedAgentTool | undefined;
  getToolDefinition(id: ToolId): SpecializedToolDefinition<TRole> | undefined;
  listTools(): readonly SpecializedToolDefinition<TRole>[];
  hasRole(role: RoleId): boolean;
  getRoleToolset(role: RoleId): SpecializedRoleToolset<TRole> | undefined;
  getRoleToolIds(role: RoleId): readonly ToolId[] | undefined;
  getRoleToolDefinitions(role: RoleId): readonly SpecializedToolDefinition<TRole>[];
  listRoles(): readonly SpecializedRoleToolset<TRole>[];
  resolveRoleTools(role: RoleId): SpecializedAgentTool[];
  resolveRolesTools(roles: readonly RoleId[]): SpecializedAgentTool[];
  roleHasRestrictedTools(role: RoleId): boolean;
};

const DEFAULT_SPECIALIST_ROLE_PURPOSES: Record<SpecialistRole, string> = {
  clarifier: "Structured intake, requirement checks, and preflight readiness gating.",
  researcher: "Evidence gathering, retrieval, search, and source collection.",
  analyst: "Computation, extraction, transformation, and file-based analysis.",
  critic: "Grounding, citation checks, and policy or quality verification.",
};

function freezeToolDefinitions<TRole extends RoleId>(
  tools: readonly SpecializedToolDefinition<TRole>[],
): readonly SpecializedToolDefinition<TRole>[] {
  return Object.freeze(
    tools.map((toolDefinition) =>
      Object.freeze({
        ...toolDefinition,
        specialists: toolDefinition.specialists
          ? Object.freeze([...toolDefinition.specialists])
          : undefined,
      }),
    ),
  );
}

function freezeRoleToolsets<TRole extends RoleId>(
  roles: readonly SpecializedRoleToolset<TRole>[],
): readonly SpecializedRoleToolset<TRole>[] {
  return Object.freeze(
    roles.map((roleToolset) =>
      Object.freeze({
        ...roleToolset,
        toolIds: Object.freeze([...roleToolset.toolIds]),
      }),
    ),
  );
}

function assertUniqueToolIds<TRole extends RoleId>(
  tools: readonly SpecializedToolDefinition<TRole>[],
): void {
  const toolIds = new Set<ToolId>();

  for (const toolDefinition of tools) {
    if (toolIds.has(toolDefinition.id)) {
      throw new Error(`Duplicate specialized tool id "${toolDefinition.id}".`);
    }

    toolIds.add(toolDefinition.id);
  }
}

function assertUniqueRoleIds<TRole extends RoleId>(
  roles: readonly SpecializedRoleToolset<TRole>[],
): void {
  const roleIds = new Set<TRole>();

  for (const roleToolset of roles) {
    if (roleIds.has(roleToolset.role)) {
      throw new Error(`Duplicate specialized role "${roleToolset.role}".`);
    }

    roleIds.add(roleToolset.role);
  }
}

function assertRoleToolIdsExist<TRole extends RoleId>(
  tools: readonly SpecializedToolDefinition<TRole>[],
  roles: readonly SpecializedRoleToolset<TRole>[],
): void {
  const toolIds = new Set(tools.map((toolDefinition) => toolDefinition.id));

  for (const roleToolset of roles) {
    for (const toolId of roleToolset.toolIds) {
      if (!toolIds.has(toolId)) {
        throw new Error(
          `Specialized role "${roleToolset.role}" references unknown tool id "${toolId}".`,
        );
      }
    }
  }
}

function dedupeResolvedTools<TRole extends RoleId>(
  toolDefinitions: readonly SpecializedToolDefinition<TRole>[],
): SpecializedAgentTool[] {
  const resolvedToolIds = new Set<ToolId>();
  const resolvedTools: SpecializedAgentTool[] = [];

  for (const toolDefinition of toolDefinitions) {
    if (resolvedToolIds.has(toolDefinition.id)) {
      continue;
    }

    resolvedToolIds.add(toolDefinition.id);
    resolvedTools.push(toolDefinition.tool);
  }

  return resolvedTools;
}

export function createDefaultSpecialistRoleToolsets(): readonly SpecializedRoleToolset<SpecialistRole>[] {
  return freezeRoleToolsets([
    {
      role: "clarifier",
      toolIds: [],
      purpose: DEFAULT_SPECIALIST_ROLE_PURPOSES.clarifier,
    },
    {
      role: "researcher",
      toolIds: [],
      purpose: DEFAULT_SPECIALIST_ROLE_PURPOSES.researcher,
    },
    {
      role: "analyst",
      toolIds: [],
      purpose: DEFAULT_SPECIALIST_ROLE_PURPOSES.analyst,
    },
    {
      role: "critic",
      toolIds: [],
      purpose: DEFAULT_SPECIALIST_ROLE_PURPOSES.critic,
    },
  ]);
}

export function createSpecializedToolStore<TRole extends RoleId = RoleId>(
  options: CreateSpecializedToolStoreOptions<TRole>,
): SpecializedToolStore<TRole> {
  assertUniqueToolIds(options.tools);
  assertUniqueRoleIds(options.roles);
  assertRoleToolIdsExist(options.tools, options.roles);

  const toolDefinitions = freezeToolDefinitions(options.tools);
  const roleToolsets = freezeRoleToolsets(options.roles);
  const toolDefinitionsById = new Map(
    toolDefinitions.map((toolDefinition) => [toolDefinition.id, toolDefinition]),
  );
  const roleToolsetsByRole = new Map<RoleId, SpecializedRoleToolset<TRole>>(
    roleToolsets.map((roleToolset) => [roleToolset.role, roleToolset]),
  );

  function getRoleToolDefinitions(role: RoleId): readonly SpecializedToolDefinition<TRole>[] {
    const roleToolset = roleToolsetsByRole.get(role);

    if (!roleToolset) {
      return [];
    }

    return roleToolset.toolIds.map((toolId) => {
      const toolDefinition = toolDefinitionsById.get(toolId);

      if (!toolDefinition) {
        throw new Error(`Unknown tool id referenced by role ${role}: ${toolId}`);
      }

      return toolDefinition;
    });
  }

  return {
    hasTool(id) {
      return toolDefinitionsById.has(id);
    },
    getTool(id) {
      return toolDefinitionsById.get(id)?.tool;
    },
    getToolDefinition(id) {
      return toolDefinitionsById.get(id);
    },
    listTools() {
      return toolDefinitions;
    },
    hasRole(role) {
      return roleToolsetsByRole.has(role);
    },
    getRoleToolset(role) {
      return roleToolsetsByRole.get(role);
    },
    getRoleToolIds(role) {
      return roleToolsetsByRole.get(role)?.toolIds;
    },
    getRoleToolDefinitions,
    listRoles() {
      return roleToolsets;
    },
    resolveRoleTools(role) {
      return dedupeResolvedTools(getRoleToolDefinitions(role));
    },
    resolveRolesTools(roles) {
      return dedupeResolvedTools(roles.flatMap((role) => getRoleToolDefinitions(role)));
    },
    roleHasRestrictedTools(role) {
      return getRoleToolDefinitions(role).some(
        (toolDefinition) => toolDefinition.riskLevel === "restricted",
      );
    },
  };
}

export function resolveSpecializedTools<TRole extends RoleId>(
  store: SpecializedToolStore<TRole>,
  role: RoleId,
): SpecializedAgentTool[] {
  return store.resolveRoleTools(role);
}

export function resolveSpecializedToolsForRoles<TRole extends RoleId>(
  store: SpecializedToolStore<TRole>,
  roles: readonly RoleId[],
): SpecializedAgentTool[] {
  return store.resolveRolesTools(roles);
}
