import { describe, expect, it } from "bun:test";

import { type ClarificationResult, createClarificationState } from "../clarification/index.ts";
import {
  clarificationResultToQuestionUpdates,
  normalizeProductCardSpec,
  normalizeQuestionOption,
  normalizeUiUpdate,
  PRODUCT_CARD_COMPONENT_NAME,
  productCardBatchSchema,
  productCardSchema,
  productCardsToUiUpdates,
  uiUpdateZone,
} from "./envelope.ts";
import type { ProductCard } from "./types.ts";

function first<T>(arr: readonly T[]): T {
  const value = arr[0];
  if (value === undefined) {
    throw new Error("expected a non-empty array");
  }
  return value;
}

const completeCard: ProductCard = {
  id: "card-1",
  title: "Solar Backpack",
  description: "A backpack with integrated solar charging.",
  imageUrl: "https://example.com/backpack.png",
  status: "complete",
};

describe("normalizeQuestionOption", () => {
  it("normalizes a plain string option to a label", () => {
    expect(normalizeQuestionOption("Founders")).toEqual({ label: "Founders" });
  });

  it("preserves description and recommended on structured options", () => {
    expect(
      normalizeQuestionOption({ label: "Founders", description: "Early-stage", recommended: true }),
    ).toEqual({ label: "Founders", description: "Early-stage", recommended: true });
  });

  it("omits absent optional fields", () => {
    expect(normalizeQuestionOption({ label: "Designers" })).toEqual({ label: "Designers" });
  });
});

describe("uiUpdateZone", () => {
  it("routes product-card ui updates to the interaction zone", () => {
    expect(
      uiUpdateZone({
        type: "ui",
        spec: { root: "r", elements: { r: { type: "Card", props: {} } } },
      }),
    ).toBe("interaction");
  });

  it("routes messages, questions, and errors to the chat zone", () => {
    expect(uiUpdateZone({ type: "message", text: "hi" })).toBe("chat");
    expect(
      uiUpdateZone({
        type: "question",
        question: { id: "q", prompt: "p", kind: "open_text" },
      }),
    ).toBe("chat");
    expect(uiUpdateZone({ type: "error", message: "boom" })).toBe("chat");
  });
});

describe("productCardSchema", () => {
  it("accepts a card with optional fields omitted", () => {
    expect(productCardSchema.safeParse({ id: "a", title: "T", description: "D" }).success).toBe(
      true,
    );
  });

  it("rejects an empty title or description", () => {
    expect(productCardSchema.safeParse({ id: "a", title: "", description: "D" }).success).toBe(
      false,
    );
  });

  it("rejects an invalid imageUrl", () => {
    expect(
      productCardSchema.safeParse({
        id: "a",
        title: "T",
        description: "D",
        imageUrl: "not-a-url",
      }).success,
    ).toBe(false);
  });
});

describe("productCardBatchSchema", () => {
  it("requires at least one product", () => {
    expect(productCardBatchSchema.safeParse({ products: [] }).success).toBe(false);
    expect(productCardBatchSchema.safeParse({ products: [completeCard] }).success).toBe(true);
  });

  it("rejects more than 32 products", () => {
    expect(
      productCardBatchSchema.safeParse({ products: Array(33).fill(completeCard) }).success,
    ).toBe(false);
  });
});

describe("productCardsToUiUpdates", () => {
  it("emits one ui update per card rooted at a product-card element", () => {
    const update = first(productCardsToUiUpdates([completeCard]));

    expect(update.type).toBe("ui");
    expect(update.spec.root).toBe("card-1");
    expect(update.spec.elements["card-1"]?.type).toBe(PRODUCT_CARD_COMPONENT_NAME);
    expect(update.spec.elements["card-1"]?.props).toEqual({
      id: "card-1",
      title: "Solar Backpack",
      description: "A backpack with integrated solar charging.",
      imageUrl: "https://example.com/backpack.png",
      status: "complete",
    });
  });

  it("omits imageUrl and status when absent", () => {
    const update = first(productCardsToUiUpdates([{ id: "card-2", title: "T", description: "D" }]));

    expect(update.spec.elements["card-2"]?.props).toEqual({
      id: "card-2",
      title: "T",
      description: "D",
    });
  });

  it("streams multiple cards as separate updates", () => {
    const updates = productCardsToUiUpdates([
      completeCard,
      {
        id: "card-2",
        title: "T",
        description: "D",
      },
    ]);

    expect(updates).toHaveLength(2);
    expect(updates[0]?.spec.root).toBe("card-1");
    expect(updates[1]?.spec.root).toBe("card-2");
  });
});

describe("normalizeProductCardSpec", () => {
  it("accepts a valid product-card spec unchanged", () => {
    const specUpdate = first(productCardsToUiUpdates([completeCard]));
    expect(normalizeProductCardSpec(specUpdate.spec)).toEqual(specUpdate.spec);
  });

  it("rejects a spec whose root element is not a product card", () => {
    expect(
      normalizeProductCardSpec({
        root: "r",
        elements: { r: { type: "OtherComponent", props: {} } },
      }),
    ).toBeNull();
  });

  it("rejects a product-card with invalid props", () => {
    expect(
      normalizeProductCardSpec({
        root: "r",
        elements: {
          r: { type: PRODUCT_CARD_COMPONENT_NAME, props: { id: "r", title: "" } },
        },
      }),
    ).toBeNull();
  });
});

describe("normalizeUiUpdate with enriched options", () => {
  it("accepts structured option objects on multiple-choice questions", () => {
    const update = normalizeUiUpdate({
      type: "question",
      question: {
        id: "audience",
        prompt: "Who is this for?",
        kind: "multiple_choice",
        options: [
          { label: "Founders", description: "Early-stage", recommended: true },
          { label: "Designers" },
        ],
      },
    });

    expect(update).toEqual({
      type: "question",
      question: {
        id: "audience",
        prompt: "Who is this for?",
        kind: "multiple_choice",
        options: [
          { label: "Founders", description: "Early-stage", recommended: true },
          { label: "Designers" },
        ],
      },
    });
  });

  it("still accepts plain string options unchanged", () => {
    expect(
      normalizeUiUpdate({
        type: "question",
        question: {
          id: "audience",
          prompt: "Who is this for?",
          kind: "multiple_choice",
          options: ["Founders", "Designers"],
        },
      }),
    ).toEqual({
      type: "question",
      question: {
        id: "audience",
        prompt: "Who is this for?",
        kind: "multiple_choice",
        options: ["Founders", "Designers"],
      },
    });
  });

  it("validates product-card specs through normalizeProductCardSpec", () => {
    const specUpdate = first(productCardsToUiUpdates([completeCard]));
    expect(normalizeUiUpdate(specUpdate, normalizeProductCardSpec)).toEqual(specUpdate);
  });

  it("rejects non-product-card specs when normalizeProductCardSpec is enforced", () => {
    expect(
      normalizeUiUpdate(
        { type: "ui", spec: { root: "r", elements: { r: { type: "Other", props: {} } } } },
        normalizeProductCardSpec,
      ),
    ).toBeNull();
  });
});

describe("clarificationResultToQuestionUpdates", () => {
  function makeResult(overrides: Partial<ClarificationResult>): ClarificationResult {
    return {
      status: "needs_clarification",
      readyToProceed: false,
      questions: [],
      missingInformation: [],
      answeredInformation: [],
      reasoningSummary: "",
      roundCount: 1,
      maxRounds: 2,
      ...overrides,
    };
  }

  it("returns nothing when the result is ready to proceed", () => {
    expect(
      clarificationResultToQuestionUpdates(makeResult({ status: "ready_to_proceed" })),
    ).toEqual([]);
  });

  it("converts an options question into a multiple_choice update", () => {
    const updates = clarificationResultToQuestionUpdates(
      makeResult({
        questions: [
          {
            id: "audience",
            question: "Who is this for?",
            options: [
              { label: "Founders", description: "Early-stage", recommended: true },
              { label: "Designers", description: "Product design" },
            ],
          },
        ],
      }),
    );

    expect(updates).toEqual([
      {
        type: "question",
        question: {
          id: "audience",
          prompt: "Who is this for?",
          kind: "multiple_choice",
          options: [
            { label: "Founders", description: "Early-stage", recommended: true },
            { label: "Designers", description: "Product design" },
          ],
        },
      },
    ]);
  });

  it("converts a question without options into an open_text update", () => {
    const updates = clarificationResultToQuestionUpdates(
      makeResult({
        questions: [{ id: "budget", question: "What is your budget?" }],
      }),
    );

    expect(updates).toEqual([
      {
        type: "question",
        question: { id: "budget", prompt: "What is your budget?", kind: "open_text" },
      },
    ]);
  });

  it("is consistent with the clarification intake state machine", () => {
    const state = createClarificationState("Generate a product.", { maxRounds: 2 });
    expect(state.status).toBe("needs_clarification");
  });
});
