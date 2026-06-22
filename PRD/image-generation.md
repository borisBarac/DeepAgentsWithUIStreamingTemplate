# Image Generation and Queue Services PRD

Tracking issue: `DeepAgentTemplate-c8e`

## Problem Statement

Application developers need a reliable way to generate and edit images without coupling product code to one image provider or reimplementing concurrency control for every integration. The codebase needs a dedicated image-generation package with shared contracts for provider calls, URL-based inputs and outputs, cancellation, normalized failures, and burst handling.

Direct provider SDK usage leaks provider-specific response shapes and exception behavior into callers. Parallel requests can also overload an upstream API, while an underspecified cancellation model makes it difficult to stop queued or active work cleanly. The package needs a small, explicit architecture that separates one image operation from orchestration of many operations.

## Solution

Add a dedicated `@deep-agent-template/image-gen` package with three public layers:

- An Image Generation Service that performs `generate` and `edit` operations against an injected provider adapter.
- A Generation Queue that wraps the service, applies a configurable concurrency limit, preserves deterministic FIFO start order, exposes task status, and cancels queued or active tasks.
- Provider adapters, including a production Replicate adapter and a fixed provider for deterministic local and application use.

All operation outcomes cross the public boundary as a discriminated result. Validation, cancellation, provider, and internal failures resolve as error results rather than rejecting or throwing. Edit inputs and successful outputs use URLs. Cancellation uses `AbortSignal` for direct service calls and stable task IDs for queued calls.

The highest test seam is the public service and queue API backed by test fixtures that implement the provider or service contract. These fixtures verify externally observable contracts without live provider calls or assertions about internal queue data structures. The exported fixed provider is not responsible for controlling asynchronous test behavior.

## API Integration Notes

The package includes a concrete Replicate adapter using the official Node.js client:

1. Set `REPLICATE_API_TOKEN`.
2. Install the `replicate` package.
3. Create a `Replicate` client.
4. Call `replicate.run(modelSlug, { input })`.
5. Consume the model output and normalize it to the image-generation contract.

Replicate's official quickstart shows this pattern with `black-forest-labs/flux-schnell` for image generation, and the FLUX.1 Kontext Pro model page documents the text-based editing workflow for transforming an existing image with a prompt. The Replicate adapter uses these models by default, allows model slugs to be overridden at construction, and converts the first `FileOutput` into its URL. Replicate output URLs are temporary; retaining or copying an output is the caller's responsibility.

```ts
import Replicate from "replicate";

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

const [generated] = await replicate.run("black-forest-labs/flux-schnell", {
  input: {
    prompt: "An astronaut riding a rainbow unicorn, cinematic, dramatic",
  },
});

const [edited] = await replicate.run("black-forest-labs/flux-kontext-pro", {
  input: {
    prompt: "Change the background to a beach while keeping the subject in place.",
    // The exact source-image key depends on the selected Replicate model schema.
    image: "https://example.com/source-image.png",
  },
});

const generatedUrl = generated.url();
const editedUrl = edited.url();
```

## User Stories

1. As an application developer, I want one image-generation contract, so that product code is independent of a specific provider SDK.
2. As an application developer, I want to generate an image from a text prompt, so that users can create new visual assets.
3. As an application developer, I want to edit an image from a URL and prompt, so that users can transform an existing visual asset.
4. As an application developer, I want successful generation results to contain a URL, so that downstream code has one stable output shape.
5. As an application developer, I want successful edit results to contain a URL, so that generated and edited assets can use the same consumption path.
6. As an application developer, I want edit source images to be supplied as URLs, so that the core contract does not own local file or binary transport.
7. As an application developer, I want operation results to be discriminated by success, so that TypeScript narrows success and failure safely.
8. As an application developer, I want expected operational failures returned as data, so that callers do not need exception handling around normal provider outcomes.
9. As an application developer, I want the stable error codes `validation`, `canceled`, `provider`, and `internal`, so that application behavior does not depend on provider-specific error classes.
10. As an application developer, I want human-readable error messages, so that failures can be logged or presented appropriately.
11. As an application developer, I want optional structured error details, so that diagnostics can retain safe provider context without changing the stable error contract.
12. As an application developer, I want empty or whitespace-only prompts rejected through the result contract, so that unusable requests do not reach the provider.
13. As an application developer, I want invalid edit URLs rejected through the result contract, so that malformed source references fail predictably.
14. As an application developer, I want to pass an `AbortSignal` to generation, so that active work can be canceled by the application.
15. As an application developer, I want to pass an `AbortSignal` to editing, so that edit requests have the same cancellation behavior as generation.
16. As an application developer, I want an already-aborted signal to prevent provider work from starting, so that cancellation does not waste provider capacity.
17. As an application developer, I want cancellation to resolve as a distinct error code, so that it can be handled differently from provider failures.
18. As an application developer, I want provider exceptions normalized into failure results, so that an adapter cannot violate the public no-throw operation contract.
19. As an application developer, I want provider promise rejections normalized into failure results, so that asynchronous SDK failures do not escape the service.
20. As an application developer, I want provider adapters injected behind an interface, so that Replicate or custom backends can be swapped.
21. As a provider adapter author, I want a minimal adapter contract, so that adding a backend does not require implementing queue behavior.
22. As a provider adapter author, I want to receive an `AbortSignal`, so that cancellation can reach the underlying HTTP or SDK request.
23. As an operator, I want concurrent generation work bounded, so that bursts do not overload provider limits or local resources.
24. As an operator, I want the queue concurrency limit to be configurable, so that capacity can match provider and deployment constraints.
25. As an application developer, I want queued tasks to start in FIFO order when capacity becomes available, so that behavior is deterministic and fair.
26. As an application developer, I want each queued task to have a stable task ID, so that I can inspect or cancel it before completion.
27. As an application developer, I want task identity available immediately at enqueue time, so that cancellation does not race against waiting for the task result.
28. As an application developer, I want to enqueue both generate and edit tasks, so that one queue controls all image-provider load.
29. As an application developer, I want a queued task's completion promise to use the same result type as direct service calls, so that callers share one outcome-handling path.
30. As an application developer, I want to cancel a task that has not started, so that unnecessary work is removed from the queue.
31. As an application developer, I want to cancel a task that is already active, so that the queue aborts the underlying provider request when supported.
32. As an application developer, I want canceling an unknown or terminal task to be safe and observable, so that repeated cleanup calls are idempotent.
33. As an application developer, I want a canceled queued task to resolve with a cancellation result, so that its completion promise never hangs.
34. As an application developer, I want active slots released after success, failure, or cancellation, so that later tasks continue to run.
35. As an operator, I want queue status to report waiting and active counts, so that I can monitor pressure.
36. As an operator, I want queue status to expose the concurrency limit, so that status can be interpreted correctly.
37. As an application developer, I want task status lookup, so that I can distinguish queued, active, succeeded, failed, and canceled work.
38. As an application developer, I want the queue to continue after one task fails, so that a provider error does not stall unrelated work.
39. As an application developer, I want the queue to handle synchronous service failures defensively, so that a faulty injected implementation does not deadlock scheduling.
40. As a test author, I want test-local fixtures to control completion, failure, and cancellation, so that concurrency behavior is deterministic without real network calls.
41. As a package consumer, I want image-generation types and factories exported from the package entry point, so that the feature has a supported public surface.
42. As a maintainer, I want the service and queue concerns separated, so that provider integration and scheduling can evolve independently.
43. As a maintainer, I want queue scheduling to depend only on the image service interface, so that it can be tested with a fake service.
44. As a maintainer, I want public behavior documented, so that no-throw, ordering, cancellation, and URL constraints are unambiguous.
45. As a maintainer, I want the implementation to follow repository TypeScript and Bun conventions, so that it integrates with existing tooling.
46. As an application developer, I want a fixed provider that always returns a configured image URL, so that development and deterministic application flows do not require a live provider.
47. As an operator, I want completed task history bounded, so that a long-running process does not retain terminal tasks indefinitely.
48. As an application developer, I want duplicate caller-supplied task IDs rejected, so that task lookup and cancellation remain unambiguous.
49. As an application developer, I want the Replicate adapter included, so that the package can generate and edit images without additional adapter implementation.

## Implementation Decisions

- Add a standalone workspace package at `packages/image-gen`, published internally as `@deep-agent-template/image-gen`, rather than adding the capability to the core, CLI, agent scaffold, or sandbox packages.
- Separate provider execution from queue orchestration. The Image Generation Service owns one direct operation; the Generation Queue owns admission, ordering, concurrency, task lifecycle, and queued cancellation.
- Define an injected provider adapter interface with `generate` and `edit` operations. The core service wraps the adapter and normalizes its behavior.
- Include a concrete Replicate adapter while keeping the service and queue provider-agnostic.
- Include `FixedImageGenerationProvider`, which returns its configured URL for every generate or edit call. Its default URL is `https://learn.zoner.com/wp-content/uploads/2025/04/zoner-ai-image-creator.jpg`.
- Use URL strings for edit input images and successful output images. Local paths, buffers, blobs, streams, and base64 payloads are outside the public v1 contract.
- Treat one operation as producing one output URL. Batch generation and multiple image outputs are deferred.
- Model outcomes as a discriminated union with a successful URL result or a normalized error payload.
- Define the public operation result exactly as:

  ```ts
  type ImageGenerationErrorCode =
    | "validation"
    | "canceled"
    | "provider"
    | "internal";

  type ImageGenerationResult =
    | { success: true; url: string }
    | {
        success: false;
        error: {
          code: ImageGenerationErrorCode;
          message: string;
          details?: unknown;
        };
      };
  ```

- Normalize upstream HTTP, SDK, rate-limit, and timeout failures to `provider`. Use `internal` only for unexpected package or injected implementation failures. Provider-specific identifiers may be retained in `details`.
- Guarantee that public asynchronous operations settle with a result for expected execution failures. The service must catch synchronous adapter exceptions and asynchronous adapter rejections.
- Limit the no-throw guarantee to operation execution. Programmer errors during construction or invalid static configuration, such as a non-positive concurrency limit, may fail fast.
- Do not create package-owned timeout timers. Upstream SDK or network timeout behavior is normalized to `provider`.
- Use `AbortSignal` as the direct cancellation primitive. The exact same signal is propagated to the provider adapter.
- If a direct call receives an already-aborted signal, return a canceled result without invoking the provider.
- Provider adapters must honor abort signals and settle promptly when aborted. Ignoring cancellation is a provider contract violation.
- Define generation tasks as a discriminated union for generate and edit requests. Edit tasks include an image URL; both task kinds include a prompt and may carry caller-supplied metadata that does not affect scheduling.
- Assign every queued task a stable unique ID at enqueue time. Generate an ID when one is not supplied.
- Make enqueue return a discriminated result. A successful enqueue contains a task handle with the task ID and completion promise. A duplicate caller-supplied ID returns a `validation` error and does not enqueue work.
- Use a configurable positive-integer concurrency limit with deterministic FIFO start order among waiting tasks.
- The queue consumes only the public Image Generation Service contract and does not know provider-specific behavior.
- Each active queued task receives an internal `AbortController`. Canceling active work aborts that controller; canceling waiting work removes it before service invocation.
- Queued cancellation resolves the task completion promise with the same canceled result used by direct operations.
- Cancellation is idempotent. Canceling an unknown or terminal task reports that no state changed and does not throw.
- Track task lifecycle states as queued, active, succeeded, failed, or canceled. Terminal status is derived from the settled result.
- Queue status reports at least the configured concurrency limit plus queued and active counts. Per-task lookup exposes lifecycle state without exposing mutable queue internals.
- Configure terminal task retention with a positive-integer `historyLimit`, defaulting to `1000`. Retain at most that many terminal tasks and evict the oldest terminal task when the limit is exceeded. Queued and active tasks are never evicted.
- Always release an active slot in a completion path that runs for success, failure, cancellation, and defensive normalization of a misbehaving service.
- A failed task must not pause or poison the queue; the next waiting task starts whenever capacity is available.
- Keep scheduling in process and in memory for v1. Persistence and distributed coordination require a separate design.
- Export public contracts, result guards or helpers, providers, and creation factories through the `@deep-agent-template/image-gen` package entry point.
- Document the operation no-throw boundary, cancellation semantics, FIFO definition, task lifecycle, URL-only transport, and timeout ownership.

## Testing Decisions

- Use one high public seam: instantiate the exported service and queue with provider and service fixtures defined in test files, then assert only observable calls, results, task states, and ordering.
- Follow existing package unit-test conventions: colocated Bun tests, dependency injection, deterministic fixtures, and assertions against public contracts.
- Do not call live image providers in unit or integration tests.
- Test direct generation success and verify that the returned URL is preserved.
- Test direct edit success and verify that the source URL, prompt, and signal reach the adapter.
- Test empty prompt and syntactically invalid URL validation through failure results without provider invocation. URL validation uses `new URL(value)` only and does not restrict schemes, hosts, credentials, fragments, or reachability.
- Test normalization of synchronous adapter throws and asynchronous rejections.
- Test normalization into the four stable error codes.
- Test an already-aborted signal and verify that no provider operation starts.
- Test cancellation during an active direct operation using a fake that observes `AbortSignal`.
- Test queue concurrency by holding fake operations open and verifying that active calls never exceed the configured limit.
- Test FIFO start order under a concurrency limit lower than the number of enqueued tasks.
- Test mixed generate and edit tasks through the same queue.
- Test that enqueue exposes the task ID before completion.
- Test that a duplicate caller-supplied task ID returns a validation error and does not enqueue a second task.
- Test canceling a waiting task: it never reaches the service, resolves canceled, and no longer counts as queued.
- Test canceling an active task: its signal aborts, it resolves canceled, and its slot is released.
- Test repeated cancellation and cancellation of unknown or terminal task IDs as safe, non-throwing operations.
- Test task lifecycle transitions only through public task-status lookup.
- Test aggregate queue status after enqueue, start, success, failure, and cancellation.
- Test terminal history eviction at the configured maximum while preserving all queued and active tasks.
- Test that one failed task does not prevent later tasks from starting.
- Test defensive handling of a service implementation that throws or rejects despite its contract, ensuring the queue settles the task and continues.
- Test invalid construction configuration, including zero, negative, fractional, or non-finite concurrency limits.
- Test invalid construction configuration for both concurrency and terminal history limits.
- Test the Replicate adapter with a stubbed client, including generation, editing, first-output URL extraction, empty output, SDK failure, and abort propagation.
- Test `FixedImageGenerationProvider` returns its configured URL for both operations.
- Avoid tests that assert private arrays, timer implementation, polling loops, or specific scheduling functions.
- Run repository tests, type checking, and linting as implementation quality gates.

## Out of Scope

- Provider credential management or environment-variable loading.
- Provider selection, fallback, routing, retries, backoff, or rate-limit algorithms.
- Package-owned timeout timers or deadline scheduling.
- Binary, base64, blob, stream, multipart, or local-file image inputs and outputs.
- Downloading, uploading, proxying, validating reachability, or persisting image URLs. Replicate output URLs are handed to the caller without durability guarantees.
- Multiple source images for one edit operation.
- Multiple output images or batch generation in one operation.
- Image metadata such as dimensions, format, seed, revised prompt, safety classifications, or usage cost.
- Prompt moderation, content policy enforcement, or user authorization.
- Priority queues, weighted fairness, per-tenant quotas, rate limiting, or scheduled execution.
- Durable queue persistence, retries after process restart, distributed workers, or cross-process coordination.
- Webhooks, events, progress percentages, streaming previews, or UI components.
- Changes to agent orchestration, model runtime, sandbox execution, memory, review, or clarification behavior.

## Further Notes

- “No throw” is an operational contract, not a claim that invalid construction or impossible programmer states must be silently accepted.
- Canceling an active queued task aborts its internal `AbortController`. A conforming provider observes the signal, aborts the underlying request, and settles promptly with cancellation.
- FIFO applies to task start order among tasks that remain queued. Completion order is intentionally unconstrained.
- URL-only transport keeps v1 small and makes callers responsible for image hosting, access control, and persistence. Replicate delivery URLs expire, so callers that need durable assets must copy them before expiry.
- The Replicate Node.js docs demonstrate the minimal adapter flow: authenticate with `REPLICATE_API_TOKEN`, install `replicate`, construct a client, and call `replicate.run(...)` with a model slug and input payload.
- The FLUX.1 Kontext Pro model page is the reference for text-guided image editing. The PRD should treat source-image URL plus prompt as the essential edit inputs, while leaving the exact model-specific input keys to the adapter.
- Controllable asynchronous behavior belongs in test fixtures, not in the exported fixed provider.
