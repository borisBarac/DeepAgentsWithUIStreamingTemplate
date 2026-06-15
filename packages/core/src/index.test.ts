import { describe, expect, it } from "bun:test";

import * as agent from "./agent";
import * as clarification from "./clarification";
import * as greeting from "./greeting";
import * as index from "./index";
import * as models from "./models";
import * as observability from "./observability";
import * as prompts from "./prompts";
import * as scaffold from "./scaffold";
import * as tools from "./tools";

describe("index barrel exports", () => {
  it("re-exports agent helpers from the agent module", () => {
    expect(index.createBasicAgent).toBe(agent.createBasicAgent);
    expect(index.createSupervisorBlueprint).toBe(agent.createSupervisorBlueprint);
    expect(index.DEFAULT_AGENT_NAME).toBe(agent.DEFAULT_AGENT_NAME);
    expect(index.DEFAULT_SYSTEM_PROMPT).toBe(agent.DEFAULT_SYSTEM_PROMPT);
  });

  it("re-exports greeting helpers from the greeting module", () => {
    expect(index.createGreeting).toBe(greeting.createGreeting);
  });

  it("re-exports model helpers from the models module", () => {
    expect(index.createChatModel).toBe(models.createChatModel);
    expect(index.resolveModelIdentifier).toBe(models.resolveModelIdentifier);
    expect(index.DEFAULT_MODEL_ID).toBe(models.DEFAULT_MODEL_ID);
    expect(index.DEFAULT_DEEPSEEK_MODEL).toBe(models.DEFAULT_DEEPSEEK_MODEL);
  });

  it("re-exports observability helpers from the observability module", () => {
    expect(index.configureLangSmithTracing).toBe(observability.configureLangSmithTracing);
  });

  it("re-exports clarification helpers from the clarification module", () => {
    expect(index.createClarificationConfig).toBe(clarification.createClarificationConfig);
    expect(index.createClarificationState).toBe(clarification.createClarificationState);
    expect(index.applyClarificationResult).toBe(clarification.applyClarificationResult);
    expect(index.resolveClarificationGate).toBe(clarification.resolveClarificationGate);
    expect(index.DEFAULT_CLARIFICATION_MAX_ROUNDS).toBe(
      clarification.DEFAULT_CLARIFICATION_MAX_ROUNDS,
    );
    expect(index.DEFAULT_CLARIFICATION_QUESTIONS_PER_ROUND).toBe(
      clarification.DEFAULT_CLARIFICATION_QUESTIONS_PER_ROUND,
    );
  });

  it("re-exports prompt constants from the prompts module", () => {
    expect(index.DEFAULT_ANALYST_SYSTEM_PROMPT).toBe(prompts.DEFAULT_ANALYST_SYSTEM_PROMPT);
    expect(index.DEFAULT_BASELINE_SYSTEM_PROMPT).toBe(prompts.DEFAULT_BASELINE_SYSTEM_PROMPT);
    expect(index.DEFAULT_CLARIFIER_SYSTEM_PROMPT).toBe(prompts.DEFAULT_CLARIFIER_SYSTEM_PROMPT);
    expect(index.DEFAULT_CRITIC_SYSTEM_PROMPT).toBe(prompts.DEFAULT_CRITIC_SYSTEM_PROMPT);
    expect(index.DEFAULT_RESEARCHER_SYSTEM_PROMPT).toBe(prompts.DEFAULT_RESEARCHER_SYSTEM_PROMPT);
    expect(index.DEFAULT_SUPERVISOR_SYSTEM_PROMPT).toBe(prompts.DEFAULT_SUPERVISOR_SYSTEM_PROMPT);
    expect(index.createClarifierSystemPrompt).toBe(prompts.createClarifierSystemPrompt);
    expect(index.createSupervisorSystemPrompt).toBe(prompts.createSupervisorSystemPrompt);
  });

  it("re-exports scaffold helpers from the scaffold module", () => {
    expect(index.createDefaultInterrupts).toBe(scaffold.createDefaultInterrupts);
    expect(index.createDefaultPermissions).toBe(scaffold.createDefaultPermissions);
    expect(index.createDefaultSubagents).toBe(scaffold.createDefaultSubagents);
    expect(index.createSupervisorBlueprint).toBe(scaffold.createSupervisorBlueprint);
    expect(index.createVirtualFilesystemLayout).toBe(scaffold.createVirtualFilesystemLayout);
    expect(index.DEFAULT_ARTIFACTS_ROOT).toBe(scaffold.DEFAULT_ARTIFACTS_ROOT);
    expect(index.DEFAULT_MEMORY_FILE_PATHS).toBe(scaffold.DEFAULT_MEMORY_FILE_PATHS);
    expect(index.DEFAULT_MEMORY_ROOT).toBe(scaffold.DEFAULT_MEMORY_ROOT);
    expect(index.DEFAULT_PLANS_ROOT).toBe(scaffold.DEFAULT_PLANS_ROOT);
    expect(index.DEFAULT_REPORTS_ROOT).toBe(scaffold.DEFAULT_REPORTS_ROOT);
    expect(index.DEFAULT_SCRATCH_ROOT).toBe(scaffold.DEFAULT_SCRATCH_ROOT);
    expect(index.DEFAULT_SKILLS_ROOT).toBe(scaffold.DEFAULT_SKILLS_ROOT);
  });

  it("re-exports specialized tool helpers from the tools module", () => {
    expect(index.createDefaultSpecialistRoleToolsets).toBe(
      tools.createDefaultSpecialistRoleToolsets,
    );
    expect(index.createSpecializedToolStore).toBe(tools.createSpecializedToolStore);
    expect(index.resolveSpecializedTools).toBe(tools.resolveSpecializedTools);
    expect(index.resolveSpecializedToolsForRoles).toBe(tools.resolveSpecializedToolsForRoles);
  });
});
