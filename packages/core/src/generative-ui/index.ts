export {
  asAcceptedUpdate,
  component,
  error as componentError,
  mainAgentActivity,
  message as messageUpdate,
  modelOutput,
  question,
  subagentActivity,
  uiSpec,
} from "./builder.ts";
export type { CatalogDoc } from "./catalog.ts";
export {
  catalog,
  catalogComponentNames,
  catalogLimits,
  catalogVersion,
  envelopeSchemaDoc,
  getComponentSchema,
  isKnownComponent,
} from "./catalog.ts";
export type { EmitOptions, SafeEmitResult } from "./emit.ts";
export { safeEmit, safeEmitModelOutput } from "./emit.ts";
export {
  applyUiUpdate,
  type ClassifiedUpdates,
  clarificationResultToQuestionUpdates,
  classifyUpdateText,
  normalizeQuestionOption,
  normalizeUiUpdate,
  parseUpdateLine,
  parseUpdateText,
  type QuestionUpdate,
  type RejectedUiCandidate,
  StreamingLineBuffer,
  type UiSpecUpdate,
  type UpdateHandlers,
  uiUpdateZone,
} from "./envelope.ts";
export type {
  A2UIComponentValidationResult,
  A2UIValidationError,
  A2UIValidationErrorCode,
  A2UIValidationResult,
} from "./errors.ts";
export { toErrorEnvelope } from "./errors.ts";
export {
  type ModelUiOutput,
  type ModelUiUpdate,
  modelUiOutputSchema,
  modelUiUpdateSchema,
  normalizeModelUiOutput,
} from "./model-output.ts";
export {
  productBatchToModelUiUpdates,
  productBatchToUiUpdate,
} from "./product-ui.ts";
export {
  composeGenerativeUiPrompt,
  GENERATIVE_UI_JSON_OBJECT_PROMPT,
} from "./prompt.ts";
export { catalogPrompt } from "./prompt-from-catalog.ts";
export type {
  ComponentInstance,
  ErrorUpdate,
  GenerativeUiOptions,
  MainAgentActivityUpdate,
  MessageUpdate,
  MultipleChoiceQuestion,
  OpenTextQuestion,
  QuestionUpdate as QuestionUpdateType,
  SubagentActivityUpdate,
  UiQuestion,
  UiQuestionOption,
  UiSpec,
  UiUpdate,
  UiZone,
} from "./types.ts";
export { isCatalogUri } from "./uri.ts";
export type {
  AcceptedUiUpdateFixture,
  RejectedUiUpdateFixture,
} from "./validation-fixtures.ts";
export {
  acceptedUiUpdateFixtures,
  rejectedUiUpdateFixtures,
} from "./validation-fixtures.ts";
export {
  validateComponentInstance,
  validateModelUiOutput,
  validateUpdate,
} from "./validator.ts";
