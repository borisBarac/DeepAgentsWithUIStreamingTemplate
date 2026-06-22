import { describe, expect, it } from "bun:test";

import * as agent from "./agent/index.ts";
import * as clarification from "./clarification/index.ts";
import * as guardrails from "./guardrails/index.ts";
import * as index from "./index";
import * as models from "./models/index.ts";
import * as observability from "./observability/index.ts";
import * as prompts from "./prompts/index.ts";
import * as review from "./review/index.ts";
import * as sandbox from "./sandbox/index.ts";
import * as scaffold from "./scaffold/index.ts";
import * as skills from "./skills/index.ts";
import * as tools from "./tools/index.ts";

describe("index barrel exports", () => {
  it("re-exports agent helpers from the agent module", () => {
    expect(index.createScaffoldedAgent).toBe(agent.createScaffoldedAgent);
    expect(index.DEFAULT_AGENT_NAME).toBe(agent.DEFAULT_AGENT_NAME);
  });

  it("re-exports model helpers from the models module", () => {
    expect(index.createModelRuntime).toBe(models.createModelRuntime);
    expect(index.MODEL_ROLES).toBe(models.MODEL_ROLES);
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

  it("re-exports the guardrail decision interface from the guardrails module", () => {
    expect(index.createGuardrailDecision).toBe(guardrails.createGuardrailDecision);
    expect(index.DEFAULT_GUARDRAIL_POLICY_LOADER).toBe(guardrails.DEFAULT_GUARDRAIL_POLICY_LOADER);
  });

  it("re-exports prompt constants from the prompts module", () => {
    expect(index.DEFAULT_ANALYST_SYSTEM_PROMPT).toBe(prompts.DEFAULT_ANALYST_SYSTEM_PROMPT);
    expect(index.DEFAULT_BASELINE_SYSTEM_PROMPT).toBe(prompts.DEFAULT_BASELINE_SYSTEM_PROMPT);
    expect(index.DEFAULT_CLARIFIER_SYSTEM_PROMPT).toBe(prompts.DEFAULT_CLARIFIER_SYSTEM_PROMPT);
    expect(index.DEFAULT_IMAGE_DESIGNER_SYSTEM_PROMPT).toBe(
      prompts.DEFAULT_IMAGE_DESIGNER_SYSTEM_PROMPT,
    );
    expect(index.DEFAULT_RESEARCHER_SYSTEM_PROMPT).toBe(prompts.DEFAULT_RESEARCHER_SYSTEM_PROMPT);
    expect(index.DEFAULT_REVIEW_AGENT_SYSTEM_PROMPT).toBe(
      prompts.DEFAULT_REVIEW_AGENT_SYSTEM_PROMPT,
    );
    expect(index.DEFAULT_SUPERVISOR_SYSTEM_PROMPT).toBe(prompts.DEFAULT_SUPERVISOR_SYSTEM_PROMPT);
    expect(index.createClarifierSystemPrompt).toBe(prompts.createClarifierSystemPrompt);
    expect(index.createSupervisorSystemPrompt).toBe(prompts.createSupervisorSystemPrompt);
  });

  it("re-exports review helpers from the review module", () => {
    expect(index.createReviewConfig).toBe(review.createReviewConfig);
    expect(index.createReviewState).toBe(review.createReviewState);
    expect(index.parseReviewReport).toBe(review.parseReviewReport);
    expect(index.recordReviewReport).toBe(review.recordReviewReport);
    expect(index.isReviewApproved).toBe(review.isReviewApproved);
    expect(index.DEFAULT_REVIEW_MAX_REVISIONS).toBe(review.DEFAULT_REVIEW_MAX_REVISIONS);
    expect(index.DEFAULT_REVIEW_AGENT_NAME).toBe(review.DEFAULT_REVIEW_AGENT_NAME);
    expect(index.reviewReportSchema).toBe(review.reviewReportSchema);
  });

  it("re-exports the runtime scaffold interface from the scaffold module", () => {
    expect(index.createRuntimeScaffold).toBe(scaffold.createRuntimeScaffold);
    expect(index.DEFAULT_ARTIFACTS_ROOT).toBe(scaffold.DEFAULT_ARTIFACTS_ROOT);
    expect(index.DEFAULT_MEMORY_FILE_PATHS).toBe(scaffold.DEFAULT_MEMORY_FILE_PATHS);
    expect(index.DEFAULT_MEMORY_ROOT).toBe(scaffold.DEFAULT_MEMORY_ROOT);
    expect(index.DEFAULT_PLANS_ROOT).toBe(scaffold.DEFAULT_PLANS_ROOT);
    expect(index.DEFAULT_REPORTS_ROOT).toBe(scaffold.DEFAULT_REPORTS_ROOT);
    expect(index.DEFAULT_SCRATCH_ROOT).toBe(scaffold.DEFAULT_SCRATCH_ROOT);
    expect(index.DEFAULT_SKILLS_ROOT).toBe(scaffold.DEFAULT_SKILLS_ROOT);
  });

  it("re-exports sandbox tools and runtime compatibility exports", () => {
    expect(index.createPythonSandboxTool).toBe(sandbox.createPythonSandboxTool);
    expect(index.createDockerSandboxBackend).toBe(sandbox.createDockerSandboxBackend);
    expect(index.SANDBOX_PROFILES).toBe(sandbox.SANDBOX_PROFILES);
  });

  it("re-exports skill helpers from the skills module", () => {
    expect(index.CLARIFY_DEEPLY_SKILL_CONTENT).toBe(skills.CLARIFY_DEEPLY_SKILL_CONTENT);
    expect(index.CLARIFY_DEEPLY_SKILL_DESCRIPTION).toBe(skills.CLARIFY_DEEPLY_SKILL_DESCRIPTION);
    expect(index.CLARIFY_DEEPLY_SKILL_DIR).toBe(skills.CLARIFY_DEEPLY_SKILL_DIR);
    expect(index.CLARIFY_DEEPLY_SKILL_NAME).toBe(skills.CLARIFY_DEEPLY_SKILL_NAME);
    expect(index.CLARIFY_DEEPLY_SKILL_PATH).toBe(skills.CLARIFY_DEEPLY_SKILL_PATH);
    expect(index.createDefaultSkillFiles).toBe(skills.createDefaultSkillFiles);
  });

  it("re-exports specialized tool helpers from the tools module", () => {
    expect(index.createDefaultSpecialistRoleToolsets).toBe(
      tools.createDefaultSpecialistRoleToolsets,
    );
    expect(index.IMAGE_DESIGNER_TOOL_NAME).toBe(tools.IMAGE_DESIGNER_TOOL_NAME);
    expect(index.createSpecializedToolStore).toBe(tools.createSpecializedToolStore);
    expect(index.resolveSpecializedTools).toBe(tools.resolveSpecializedTools);
    expect(index.resolveSpecializedToolsForRoles).toBe(tools.resolveSpecializedToolsForRoles);
  });

  it("re-exports the image designer module helpers", () => {
    expect(typeof index.createImageDesignerTool).toBe("function");
    expect(index.imageDesignerResponseSchema.safeParse).toBeDefined();
  });
});
