export type MessageLike = {
  content?: unknown;
  role?: string;
  _getType?: () => string;
};

export type AgentStateLike = {
  messages?: MessageLike[];
};

export function contentToText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text: unknown }).text);
        }

        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  if (content == null) {
    return "";
  }

  return String(content);
}

export function isHumanMessage(message: MessageLike): boolean {
  const type = message._getType?.();

  return type === "human" || message.role === "user" || message.role === "human";
}

export function getLatestHumanMessageText(state: AgentStateLike): string | undefined {
  const messages = state.messages ?? [];

  for (const message of messages.toReversed()) {
    if (isHumanMessage(message)) {
      const text = contentToText(message.content).trim();

      return text.length > 0 ? text : undefined;
    }
  }

  return undefined;
}
