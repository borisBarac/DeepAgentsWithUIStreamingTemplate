import type {
  ComponentInstance,
  ErrorUpdate,
  MainAgentActivityUpdate,
  MessageUpdate,
  ModelUiOutput,
  ModelUiUpdate,
  QuestionUpdate,
  SubagentActivityUpdate,
  UiQuestion,
  UiSpecUpdate,
  UiUpdate,
} from "./types.ts";

/**
 * Thin constructor helpers for UiUpdate variants. These are the only way the
 * v2 pipeline constructs updates — keeping construction centralised means the
 * chokepoint (_safeEmit) never has to defensive-parse what it's given.
 *
 * The naming deliberately mirrors the wire `type` discriminant so the call
 * site reads like a typed literal: `builder.message("hi")`.
 */

export function message(text: string): MessageUpdate {
  return { type: "message", text };
}

export function question(q: UiQuestion): QuestionUpdate {
  return { type: "question", question: q };
}

export function uiSpec(
  components: ComponentInstance[],
  options: { rootId?: string } = {},
): UiSpecUpdate {
  const update: UiSpecUpdate = { type: "ui", components };
  if (options.rootId !== undefined) update.rootId = options.rootId;
  return update;
}

export function component(
  id: string,
  type: string,
  props: Record<string, unknown> = {},
  children: string[] = [],
): ComponentInstance {
  const instance: ComponentInstance & Record<string, unknown> = {
    id,
    component: type,
    ...props,
  };
  if (children.length > 0) instance.children = children;
  return instance as ComponentInstance;
}

export function error(message: string): ErrorUpdate {
  return { type: "error", message };
}

export function mainAgentActivity(
  event: MainAgentActivityUpdate["event"],
  options: { text?: string; message?: string } = {},
): MainAgentActivityUpdate {
  const update: MainAgentActivityUpdate = { type: "main_agent_activity", event };
  if (options.text !== undefined) update.text = options.text;
  if (options.message !== undefined) update.message = options.message;
  return update;
}

export function subagentActivity(
  subagentName: string,
  event: SubagentActivityUpdate["event"],
  options: {
    subagentRunId?: string;
    task?: string;
    text?: string;
    message?: string;
  } = {},
): SubagentActivityUpdate {
  const update: SubagentActivityUpdate = {
    type: "subagent_activity",
    subagentName,
    event,
  };
  if (options.subagentRunId !== undefined) update.subagentRunId = options.subagentRunId;
  if (options.task !== undefined) update.task = options.task;
  if (options.text !== undefined) update.text = options.text;
  if (options.message !== undefined) update.message = options.message;
  return update;
}

export function modelOutput(updates: ModelUiUpdate[]): ModelUiOutput {
  if (updates.length === 0) {
    throw new Error("ModelUiOutput must contain at least one update.");
  }
  if (updates.length > 32) {
    throw new Error("ModelUiOutput must not contain more than 32 updates.");
  }
  return { version: 1, updates };
}

/**
 * Narrows an arbitrary value to a UiUpdate after the validator has accepted
 * it. Convenience for callers that don't want to cast.
 */
export function asAcceptedUpdate(value: unknown): UiUpdate {
  return value as UiUpdate;
}
