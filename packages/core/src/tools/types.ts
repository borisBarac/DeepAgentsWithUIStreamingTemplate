import type { ClientTool, ServerTool, StructuredTool } from "@langchain/core/tools";

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
