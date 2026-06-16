# Required Context

Before starting implementation work, the agent should have enough context to identify:

- The user's concrete objective.
- The relevant project, package, file, or runtime surface.
- Any referenced example, specification, research thread, issue, or design artifact.
- The acceptance criteria or observable behavior that would prove the task is complete.
- The commands, tests, or checks that should verify the change when available.

If required context is missing, the request is not automatically disallowed. The agent should ask a concise clarification question unless the missing context can be discovered from the workspace or provided references.
