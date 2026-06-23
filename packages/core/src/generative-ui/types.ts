import type { Spec } from "@json-render/core";

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
      type: "ui";
      spec: Spec;
    }
  | {
      type: "error";
      message: string;
    };
