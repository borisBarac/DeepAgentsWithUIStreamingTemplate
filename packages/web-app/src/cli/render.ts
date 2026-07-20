import type { ComponentInstance, UiUpdate } from "@deep-agent-template/core/generative-ui/types";

import type { DisplayAgentActivity, DisplayMessage, DisplayUiSpec } from "../ui/session-model.ts";
import { labelSubagent } from "../ui/subagent-labels.ts";

export type NdjsonLine = { kind: "ndjson"; text: string };
export type PrettyLine = { kind: "pretty"; text: string; stream?: boolean };
export type RenderLine = NdjsonLine | PrettyLine;

export type RenderOptions = {
  format: "ndjson" | "pretty";
  quiet: boolean;
};

function summarizeComponent(component: ComponentInstance, indent = "    "): string[] {
  const parts = [`${indent}- ${component.component}#${component.id}`];
  for (const [key, value] of Object.entries(component)) {
    if (key === "id" || key === "component" || key === "children") continue;
    const formatted = typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
    parts.push(`${indent}    ${key}: ${truncate(formatted, 80)}`);
  }
  if (component.children && component.children.length > 0) {
    parts.push(`${indent}    children: ${component.children.join(", ")}`);
  }
  return parts;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

export function renderUpdate(update: UiUpdate, options: RenderOptions): RenderLine[] {
  if (options.format === "ndjson") {
    return [{ kind: "ndjson", text: JSON.stringify(update) }];
  }

  if (options.quiet) {
    if (update.type === "message") {
      return [{ kind: "pretty", text: update.text }];
    }
    if (update.type === "error") {
      return [{ kind: "pretty", text: `! ${update.message}` }];
    }
    return [];
  }

  switch (update.type) {
    case "message":
      return [{ kind: "pretty", text: update.text, stream: true }];
    case "error":
      return [{ kind: "pretty", text: `! ${update.message}` }];
    case "question": {
      const lines = [`? ${update.question.prompt}`];
      if (update.question.kind === "multiple_choice") {
        update.question.options.forEach((option, index) => {
          if (typeof option === "string") {
            lines.push(`  [${index + 1}] ${option}`);
          } else {
            const tag = option.recommended ? " (recommended)" : "";
            const description = option.description ? ` — ${option.description}` : "";
            lines.push(`  [${index + 1}] ${option.label}${tag}${description}`);
          }
        });
      } else {
        lines.push(`  ${update.question.placeholder ?? "(open text)"}`);
      }
      return lines.map((text) => ({ kind: "pretty" as const, text }));
    }
    case "ui": {
      const root = update.rootId ?? update.components[0]?.id ?? "<unknown>";
      const lines = [`◆ ui root=${root} (${update.components.length} components)`];
      for (const component of update.components) {
        lines.push(...summarizeComponent(component));
      }
      return lines.map((text) => ({ kind: "pretty" as const, text }));
    }
    case "main_agent_activity":
      return [{ kind: "pretty", text: `• main ${update.event}${activitySuffix(update)}` }];
    case "subagent_activity":
      return [
        {
          kind: "pretty",
          text: `• ${labelSubagent(update.subagentName)} ${update.event}${activitySuffix(update)}`,
        },
      ];
  }
}

function activitySuffix(update: {
  event: string;
  text?: string;
  message?: string;
  task?: string;
}): string {
  if (update.event === "started" && update.task) {
    return ` — ${truncate(update.task, 100)}`;
  }
  if (update.text) {
    return ` — ${truncate(update.text, 120)}`;
  }
  if (update.message) {
    return ` — ${truncate(update.message, 120)}`;
  }
  return "";
}

export function renderActivitySummary(activity: DisplayAgentActivity[]): string[] {
  return activity.map((entry) => {
    const label = entry.type === "main_agent_activity" ? "main" : labelSubagent(entry.subagentName);
    const task = entry.type === "subagent_activity" ? entry.task : undefined;
    const detail = entry.text?.trim() || entry.message?.trim() || task?.trim() || "";
    return detail
      ? `  ${label} (${entry.event}): ${truncate(detail, 120)}`
      : `  ${label} (${entry.event})`;
  });
}

export function renderUiSpecs(specs: readonly DisplayUiSpec[]): string[] {
  return specs.flatMap((entry, index) => {
    const components = Object.values(entry.spec.elements);
    const header = `[${index}] root=${entry.spec.root} (${components.length} elements)`;
    const body = components.map((element) => {
      const props = element.props as Record<string, unknown> | undefined;
      const propSummary = props
        ? Object.entries(props)
            .slice(0, 3)
            .map(
              ([key, value]) =>
                `${key}=${truncate(typeof value === "string" ? value : JSON.stringify(value), 60)}`,
            )
            .join(", ")
        : "";
      return `    - ${element.type}${propSummary ? ` (${propSummary})` : ""}`;
    });
    return [header, ...body];
  });
}

export function renderHistory(messages: readonly DisplayMessage[]): string {
  return JSON.stringify(
    messages.map((message) => ({
      content: message.content,
      question: message.question?.prompt ?? null,
      role: message.role,
    })),
    null,
    2,
  );
}
