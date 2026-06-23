import type { Spec } from "@json-render/core";

export type JsonRenderSpec = Spec;

export type UiUpdate =
  | {
      type: "message";
      text: string;
    }
  | {
      type: "ui";
      spec: JsonRenderSpec;
    }
  | {
      type: "error";
      message: string;
    };

export type UiStreamEnvelope = {
  updates: UiUpdate[];
};

export type ChatMessage = {
  role: "assistant" | "user";
  content: string;
};
