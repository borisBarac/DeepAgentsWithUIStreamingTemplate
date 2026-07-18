export type GenerativeUiOptions = {
  catalogPrompt?: string;
};

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
export type UiZone = "chat" | "interaction";

export type ComponentInstance = {
  id: string;
  component: string;
  children?: string[];
  [prop: string]: unknown;
};

export type UiSpec = {
  components: ComponentInstance[];
  rootId?: string;
};

export type MessageUpdate = { type: "message"; text: string };
export type QuestionUpdate = { type: "question"; question: UiQuestion };
export type UiSpecUpdate = { type: "ui"; components: ComponentInstance[]; rootId?: string };
export type ErrorUpdate = { type: "error"; message: string };
export type MainAgentActivityUpdate = {
  type: "main_agent_activity";
  event: "started" | "delta" | "completed" | "error";
  text?: string;
  message?: string;
};
export type SubagentActivityUpdate = {
  type: "subagent_activity";
  subagentRunId?: string;
  subagentName: string;
  event: "started" | "delta" | "completed" | "error";
  task?: string;
  text?: string;
  message?: string;
};

export type UiUpdate =
  | MessageUpdate
  | QuestionUpdate
  | UiSpecUpdate
  | ErrorUpdate
  | MainAgentActivityUpdate
  | SubagentActivityUpdate;

export type ModelUiUpdate = MessageUpdate | QuestionUpdate | UiSpecUpdate;

export type ModelUiOutput = {
  version: 1;
  updates: ModelUiUpdate[];
};
