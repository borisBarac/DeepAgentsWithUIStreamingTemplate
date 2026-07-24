# Image generation

The `@deep-agent-template/image-gen` package generates new images and edits images from URLs. It includes a fixed provider for local development, a Replicate provider, a service that normalizes errors, and an optional queue for limiting concurrent requests.

## Quick start

Import the package by its workspace name:

```ts
import { createImageGenerationServiceFromEnv } from "@deep-agent-template/image-gen";

const service = createImageGenerationServiceFromEnv();
const result = await service.generate({
  prompt: "A red panda reading beside a window",
  width: 1024,
  height: 1024,
});

if (result.success) {
  console.log(result.url);
} else {
  console.error(result.error.code, result.error.message);
}
```

The environment factory uses the fixed provider by default. The fixed provider always returns the same image URL, so local development and tests do not call Replicate.

## Use Replicate

Set these values in the root `.env` file:

```dotenv
USE_FAKE_IMAGE_PROVIDER="false"
REPLICATE_API_TOKEN="r8_your_token"
```

Then create the service with the same factory:

```ts
import { createImageGenerationServiceFromEnv } from "@deep-agent-template/image-gen";

const service = createImageGenerationServiceFromEnv();
```

`USE_FAKE_IMAGE_PROVIDER` accepts only `true` or `false`. It defaults to `true` when it is missing or empty. Real mode requires `REPLICATE_API_TOKEN`.

The default Replicate models are:

| Operation | Model |
| --- | --- |
| Generate | `black-forest-labs/flux-schnell` |
| Edit | `black-forest-labs/flux-kontext-pro` |

You can override the models in code:

```ts
const service = createImageGenerationServiceFromEnv({
  generationModel: "owner/generation-model",
  editModel: "owner/edit-model",
});
```

## Edit an image

Edits take a prompt and a valid source image URL:

```ts
const result = await service.edit({
  prompt: "Change the background to a snowy forest",
  imageUrl: "https://example.com/source.png",
  width: 1024,
  height: 1024,
});
```

The package passes the source URL to Replicate as `input_image`.

## Handle results

Both `generate` and `edit` return `ImageGenerationResult`. They report expected failures as values instead of throwing:

```ts
type ImageGenerationResult =
  | { success: true; url: string }
  | {
      success: false;
      error: {
        code: "validation" | "canceled" | "provider" | "internal";
        message: string;
        details?: unknown;
      };
    };
```

The error codes mean:

| Code | Meaning |
| --- | --- |
| `validation` | The prompt is empty or an edit URL is invalid. |
| `canceled` | The request's abort signal was canceled. |
| `provider` | The provider call failed. |
| `internal` | The provider or service returned an invalid value. |

Use an `AbortController` to cancel a request:

```ts
const controller = new AbortController();

const pending = service.generate({
  prompt: "A watercolor city map",
  signal: controller.signal,
});

controller.abort();
const result = await pending;
```

## Limit concurrent requests

Use `createImageGenerationQueue` when callers may submit bursts of work:

```ts
import {
  createImageGenerationQueue,
  createImageGenerationServiceFromEnv,
} from "@deep-agent-template/image-gen";

const service = createImageGenerationServiceFromEnv();
const queue = createImageGenerationQueue(service, {
  concurrencyLimit: 2,
  historyLimit: 100,
});

const task = queue.enqueue({
  type: "generate",
  prompt: "A small cabin beside a lake",
  metadata: { productId: "product-123" },
});

if (!task.success) {
  throw new Error(task.error.message);
}

const result = await task.completion;
console.log(task.id, result);
```

Queue requests use either `type: "generate"` or `type: "edit"`. An edit request also needs `imageUrl`. You can supply an `id`, or the queue creates a UUID.

The queue also provides:

- `cancel(id)` to cancel queued or active work.
- `getTask(id)` to read a task snapshot.
- `getStatus()` to read queue and history counts.

Completed task records stay in memory. The queue keeps the latest 1,000 records by default, or the number set by `historyLimit`.

## Configure providers directly

Use the lower level factories when environment based setup does not fit the application:

```ts
import {
  createImageGenerationService,
  createReplicateImageGenerationProvider,
  type ReplicateCompatibleClient,
} from "@deep-agent-template/image-gen";
import Replicate from "replicate";

const client = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
const provider = createReplicateImageGenerationProvider({
  client: client as unknown as ReplicateCompatibleClient,
});
const service = createImageGenerationService(provider);
```

You can implement `ImageGenerationProvider` to use another service:

```ts
import {
  createImageGenerationService,
  type ImageGenerationProvider,
} from "@deep-agent-template/image-gen";

const provider: ImageGenerationProvider = {
  async generate(request) {
    return callCustomGenerator(request);
  },
  async edit(request) {
    return callCustomEditor(request);
  },
};

const service = createImageGenerationService(provider);
```

Provider methods return a URL string. The service checks the URL and converts thrown provider errors into `ImageGenerationResult`.

## Use it with the agent

Pass the service to `createScaffoldedAgent` as `imageGenerationService`. The web app already does this in `packages/web-app/src/server/agent-provider.ts`:

```ts
return createScaffoldedAgent({
  imageGenerationService: createImageGenerationServiceFromEnv(),
  modelRuntime,
  store,
});
```

When the service is present, the scaffold adds the image designer subagent and its `generate_image` tool.

## Run tests

The package tests are offline and use fake clients:

```bash
bun test packages/image-gen
```

After changing the package, run the repository quality gates:

```bash
bun test
bun run typecheck
bun run check
bun run --filter @deep-agent-template/web-app build
```
