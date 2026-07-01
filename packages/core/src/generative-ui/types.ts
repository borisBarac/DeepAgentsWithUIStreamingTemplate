import type { Spec } from "@json-render/core";

/**
 * Opt-in generative-UI streaming options.
 *
 * `catalogPrompt` is optional for the product-generator scaffold (which always
 * appends its own product-card catalog); callers that want additional app
 * components pass them here.
 */
export type GenerativeUiOptions = {
  catalogPrompt?: string;
};

/**
 * A selectable option for a multiple-choice question update.
 *
 * Accepts a plain string (for simple catalogs / back-compat) or a structured
 * object carrying a `label`, optional `description`, and optional `recommended`
 * marker — aligned with the clarifier's `ClarificationOption`.
 */
export type UiQuestionOption =
  | string
  | {
      label: string;
      description?: string;
      recommended?: boolean;
    };

export type MultipleChoiceQuestion = {
  id: string;
  prompt: string;
  kind: "multiple_choice";
  options: UiQuestionOption[];
};

export type OpenTextQuestion = {
  id: string;
  prompt: string;
  kind: "open_text";
  placeholder?: string;
};

export type UiQuestion = MultipleChoiceQuestion | OpenTextQuestion;

/**
 * Lifecycle marker for a streamed product card. "streaming" indicates the card
 * is still being refined (e.g. image pending); "complete" marks it final.
 */
export type ProductCardStatus = "streaming" | "complete";

/**
 * A single generated product. `imageUrl` is optional so cards can render a
 * placeholder until an image is available.
 */
export type ProductCard = {
  id: string;
  title: string;
  description: string;
  imageUrl?: string;
  status?: ProductCardStatus;
};

/**
 * A batch of product cards returned by a product-generator specialist.
 */
export type ProductCardBatch = {
  products: ProductCard[];
};

/**
 * The UI zone an update is routed to. Qualification questions, messages, and
 * errors belong in the chat history; product-card ui specs belong in the
 * dedicated interaction zone.
 */
export type UiZone = "chat" | "interaction";

/**
 * A UI update emitted by a generative-UI agent stream.
 *
 * The wire protocol is a newline-delimited stream of these objects (NDJSON):
 * the model emits one `UiUpdate` per line, the server frames the stream with
 * {@link StreamingLineBuffer}, and each line is validated by
 * {@link normalizeUiUpdate} (or parsed by {@link parseUpdateLine} on the client).
 */
export type UiUpdate =
  | {
      type: "message";
      text: string;
    }
  | {
      type: "question";
      question: UiQuestion;
    }
  | {
      type: "ui";
      spec: Spec;
    }
  | {
      type: "error";
      message: string;
    }
  | {
      type: "main_agent_activity";
      event: "started" | "delta" | "completed" | "error";
      text?: string;
      message?: string;
    }
  | {
      type: "subagent_activity";
      subagentName: string;
      event: "started" | "delta" | "completed" | "error";
      task?: string;
      text?: string;
      message?: string;
    };
