import { describe, expect, it } from "bun:test";
import type { BaseMessageLike } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { createDeepAgent } from "deepagents";
import { z } from "zod";
import { createModelRuntime } from "./runtime.ts";

type ChatRequest = {
  messages?: Array<{
    additional_kwargs?: Record<string, unknown>;
    reasoning_content?: unknown;
    role?: string;
    tool_calls?: unknown[];
  }>;
};

const REASONING = "I need the lookup tool before answering.";

function streamResponse(chunks: unknown[]): Response {
  const body = `${chunks
    .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
    .join("")}data: [DONE]\n\n`;
  return new Response(body, {
    headers: { "content-type": "text/event-stream" },
  });
}

describe("DeepSeek reasoning replay", () => {
  it("replays full streamed reasoning_content through a DeepAgents tool loop", async () => {
    const requests: ChatRequest[] = [];
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const body = (await request.json()) as ChatRequest;
        requests.push(body);

        if (requests.length === 1) {
          return streamResponse([
            {
              id: "chatcmpl-1",
              model: "deepseek-v4-flash",
              choices: [
                {
                  index: 0,
                  delta: { role: "assistant", content: "", reasoning_content: REASONING },
                },
              ],
            },
            {
              id: "chatcmpl-1",
              model: "deepseek-v4-flash",
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: "call-1",
                        type: "function",
                        function: { name: "lookup_weather", arguments: '{"city":"Prague"}' },
                      },
                    ],
                  },
                },
              ],
            },
            {
              id: "chatcmpl-1",
              model: "deepseek-v4-flash",
              choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
            },
          ]);
        }

        const toolCallMessages =
          body.messages?.filter(
            (message) => message.role === "assistant" && message.tool_calls?.length,
          ) ?? [];
        if (toolCallMessages.some((message) => message.reasoning_content !== REASONING)) {
          return Response.json(
            {
              error: {
                message:
                  "The `reasoning_content` in the thinking mode must be passed back to the API.",
              },
            },
            { status: 400 },
          );
        }

        return streamResponse([
          {
            id: "chatcmpl-2",
            model: "deepseek-v4-flash",
            choices: [
              {
                index: 0,
                delta: { role: "assistant", content: "It is rainy." },
                finish_reason: "stop",
              },
            ],
          },
        ]);
      },
    });

    try {
      const runtime = createModelRuntime({
        connections: {
          local: {
            provider: "openai-compatible",
            apiKey: "test-key",
            baseURL: `http://127.0.0.1:${server.port}/v1`,
          },
        },
        categories: {
          fast: { connection: "local", model: "deepseek-v4-flash" },
          normal: {
            connection: "local",
            model: "deepseek-v4-flash",
            providerOptions: { streaming: true },
          },
          pro: { connection: "local", model: "deepseek-v4-flash" },
        },
        assignments: { default: "normal" },
      });
      const agent = createDeepAgent({
        model: runtime.getModelForCategory("normal"),
        tools: [
          tool(async (input: { city: string }) => `Rain in ${input.city}`, {
            name: "lookup_weather",
            description: "Look up weather.",
            schema: z.object({ city: z.string() }),
          }),
        ],
      });

      const first = await agent.invoke({
        messages: [{ role: "user", content: "Weather in Prague?" }],
      });
      const storedHistory = JSON.parse(JSON.stringify(first.messages)) as BaseMessageLike[];
      await agent.invoke({
        messages: [
          ...storedHistory,
          { role: "user", content: "Do I need an umbrella tomorrow too?" },
        ],
      });

      expect(requests).toHaveLength(3);
    } finally {
      server.stop(true);
    }
  });
});
