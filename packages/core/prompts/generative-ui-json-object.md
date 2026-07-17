Return one JSON object. Do not add Markdown fences or prose around it.

Use this shape:

{
  "version": 1,
  "updates": [
    { "type": "message", "text": "short assistant message" },
    { "type": "question", "question": { "id": "stable-question-id", "prompt": "question text", "kind": "multiple_choice", "options": ["option 1", "option 2"] } },
    { "type": "question", "question": { "id": "stable-question-id", "prompt": "question text", "kind": "open_text", "placeholder": "optional placeholder" } },
    { "type": "ui", "spec": { "root": "concept-1", "elements": { "concept-1": { "type": "product-card", "props": { "id": "concept-1", "title": "Concept", "description": "A clear description." }, "children": [] } } } }
  ]
}

Every item in `updates` must be a message, question, or ui update. Never emit error, main_agent_activity, or subagent_activity updates. The application creates those updates.

Use question updates only when the user must answer before useful product details can be generated. Keep message updates short. Put each independent UI result in its own ui update.

Each independent ui update must use a unique `spec.root` value. Reuse a root only when the later update replaces the earlier UI with that root. The application keeps only the last ui update for a repeated root.
