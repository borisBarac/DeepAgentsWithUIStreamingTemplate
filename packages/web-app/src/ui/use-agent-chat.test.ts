import { describe, expect, it } from "bun:test";

import { appendSubagentActivity, type DisplayMessage } from "./use-agent-chat.ts";

describe("subagent activity state", () => {
  it("stores activity separately from chat transcript", () => {
    const messages: DisplayMessage[] = [];
    const activity = appendSubagentActivity(
      [],
      {
        type: "subagent_activity",
        subagentName: "researcher",
        event: "delta",
        text: "Searching",
      },
      "activity-1",
    );

    expect(activity).toEqual([
      {
        id: "activity-1",
        type: "subagent_activity",
        subagentName: "researcher",
        event: "delta",
        text: "Searching",
      },
    ]);
    expect(messages).toEqual([]);
  });
});
