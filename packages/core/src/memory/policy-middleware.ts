import { ToolMessage } from "@langchain/core/messages";
import type { CreateDeepAgentParams } from "deepagents";
import { createMiddleware } from "langchain";

import type { MemoryPolicy } from "./policy.ts";
import { reviewMemoryContent } from "./policy.ts";

type DeepAgentMiddleware = NonNullable<CreateDeepAgentParams["middleware"]>[number];

const BLOCKED_TOOL_NAMES = new Set(["write_file", "edit_file"]);

export function createMemoryPolicyMiddleware(policy: MemoryPolicy): DeepAgentMiddleware {
  const writableRoot = policy.writableRoot;
  return createMiddleware({
    name: "memoryPolicy",
    wrapToolCall: async (request, handler) => {
      const name = request.toolCall.name;
      if (!BLOCKED_TOOL_NAMES.has(name)) {
        return handler(request);
      }

      const args = request.toolCall.args as Record<string, unknown>;
      const filePath = typeof args.file_path === "string" ? args.file_path : "";
      if (!filePath.startsWith(`${writableRoot}/`)) {
        return handler(request);
      }

      const text =
        typeof args.content === "string"
          ? args.content
          : typeof args.new_string === "string"
            ? args.new_string
            : "";
      const review = reviewMemoryContent(text);
      if (review.allowed) {
        return handler(request);
      }

      return new ToolMessage({
        content: `Blocked from writing ${filePath}: content policy matched [${review.reasons.join(", ")}]. Rewrite without the credential / state an explicit preference / keep transient details in /scratch.`,
        tool_call_id: request.toolCall.id ?? "memory-policy",
        name,
      });
    },
  }) as DeepAgentMiddleware;
}
