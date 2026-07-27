import { describe, expect, it } from "bun:test";
import { ToolMessage } from "@langchain/core/messages";

import { createMemoryPolicy } from "./policy.ts";
import { createMemoryPolicyMiddleware } from "./policy-middleware.ts";

type ToolCallRequest = {
  toolCall: { id: string; name: string; args: Record<string, unknown> };
};

const middleware = createMemoryPolicyMiddleware(createMemoryPolicy());

function request(id: string, name: string, args: Record<string, unknown>): ToolCallRequest {
  return { toolCall: { id, name, args } };
}

describe("memory policy middleware", () => {
  it("blocks write_file carrying a secret and never calls the handler", async () => {
    let called = false;
    const handler = async (): Promise<never> => {
      called = true;
      throw new Error("handler should not be called");
    };
    const result = (await middleware.wrapToolCall?.(
      request("c1", "write_file", {
        file_path: "/memory/user-preferences.md",
        content: "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz",
      }) as never,
      handler as never,
    )) as ToolMessage;

    expect(called).toBe(false);
    expect(result).toBeInstanceOf(ToolMessage);
    expect(String(result.content)).toContain("Blocked");
    expect(String(result.content)).toContain("secrets");
  });

  it("passes clean explicit-preference writes through to the handler", async () => {
    let called = false;
    const passthrough = new ToolMessage({ content: "ok", tool_call_id: "c2", name: "write_file" });
    const handler = async () => {
      called = true;
      return passthrough;
    };
    const result = await middleware.wrapToolCall?.(
      request("c2", "write_file", {
        file_path: "/memory/user-preferences.md",
        content: "User prefers concise answers.",
      }) as never,
      handler as never,
    );

    expect(called).toBe(true);
    expect(result).toBe(passthrough);
  });

  it("blocks edit_file whose new_string contains an inferred preference", async () => {
    let called = false;
    const handler = async (): Promise<never> => {
      called = true;
      throw new Error("handler should not be called");
    };
    const result = (await middleware.wrapToolCall?.(
      request("c3", "edit_file", {
        file_path: "/memory/project-facts.md",
        old_string: "x",
        new_string: "The user probably prefers British English.",
      }) as never,
      handler as never,
    )) as ToolMessage;

    expect(called).toBe(false);
    expect(result).toBeInstanceOf(ToolMessage);
    expect(String(result.content)).toContain("Blocked");
    expect(String(result.content)).toContain("inferred-preferences");
  });

  it("passes writes outside /memory through untouched", async () => {
    let called = false;
    const passthrough = new ToolMessage({ content: "ok", tool_call_id: "c4", name: "write_file" });
    const handler = async () => {
      called = true;
      return passthrough;
    };
    const result = await middleware.wrapToolCall?.(
      request("c4", "write_file", {
        file_path: "/scratch/notes.md",
        content: "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz",
      }) as never,
      handler as never,
    );

    expect(called).toBe(true);
    expect(result).toBe(passthrough);
  });

  it("passes read_file through untouched regardless of content", async () => {
    let called = false;
    const passthrough = new ToolMessage({ content: "ok", tool_call_id: "c5", name: "read_file" });
    const handler = async () => {
      called = true;
      return passthrough;
    };
    const result = await middleware.wrapToolCall?.(
      request("c5", "read_file", {
        file_path: "/memory/user-preferences.md",
        content: "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz",
      }) as never,
      handler as never,
    );

    expect(called).toBe(true);
    expect(result).toBe(passthrough);
  });

  it("blocks transient task details written under /memory", async () => {
    let called = false;
    const handler = async (): Promise<never> => {
      called = true;
      throw new Error("handler should not be called");
    };
    const result = (await middleware.wrapToolCall?.(
      request("c6", "write_file", {
        file_path: "/memory/x.md",
        content: "Disable linting temporarily.",
      }) as never,
      handler as never,
    )) as ToolMessage;

    expect(called).toBe(false);
    expect(result).toBeInstanceOf(ToolMessage);
    expect(String(result.content)).toContain("Blocked");
    expect(String(result.content)).toContain("transient-details");
  });

  it("reviews arbitrary /memory paths and passes clean content silently", async () => {
    let called = false;
    const passthrough = new ToolMessage({
      content: "ok",
      tool_call_id: "c7",
      name: "write_file",
    });
    const handler = async () => {
      called = true;
      return passthrough;
    };
    const result = await middleware.wrapToolCall?.(
      request("c7", "write_file", {
        file_path: "/memory/custom-notes.md",
        content: "Build uses Bun.",
      }) as never,
      handler as never,
    );

    expect(called).toBe(true);
    expect(result).toBe(passthrough);
  });
});
