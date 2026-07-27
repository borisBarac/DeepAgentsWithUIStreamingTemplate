# Memory setup

The template stores durable agent memory as Markdown files under the virtual `/memory` path. The default files are:

- `/memory/project-facts.md`
- `/memory/user-preferences.md`

The agent reads these files at the start of a request. It may update them through the normal `write_file` and `edit_file` tools.

Use `project-facts.md` for stable project facts. Use `user-preferences.md` only for preferences that the user stated directly. Do not save credentials, inferred preferences, or details that only apply to the current task.

## How memory is connected

The agent only sees virtual paths. A memory store maps those paths to durable storage.

```text
/memory/project-facts.md
  -> CompositeBackend
  -> StoreBackend
  -> BaseStore
  -> local disk or S3
```

Files outside `/memory` use the temporary state backend. Changing the memory store does not change the model facing paths.

## Option 1. Local memory for development

The web app uses **one process-wide in-memory store** for guest memory, shared by every request and **namespaced per guest**. Every user is an anonymous guest identified by a UUID v4 minted in the browser and sent via the `x-guest-id` header. Each guest gets an isolated memory tree, created lazily on their first turn.

This setup is intended for local development or a single server process. **Guest memory is ephemeral:** it lives only in the web-app process and is lost on restart, on agent-cache eviction (LRU-bounded), and across instances behind a load balancer. There is no on-disk persistence for guests today.

### How memory is scoped per guest

The execution environment resolves an identity `{ tenantId: "guests", userId: <uuid> }` for each request and passes it to `createAgentForIdentity`. Memory is scoped by `userId`:

1. A single `InMemoryStore` is shared by all guests (one process-wide instance in `packages/web-app/src/server/agent-provider.ts`).
2. The `userId` selects a namespace via `createUserMemoryNamespace(userId)`, which yields `["users", "<encoded-id>", "memory"]`.
3. Seed files (`project-facts.md`, `user-preferences.md`) are created lazily per guest — only when that guest's first turn runs, and only if the file does not already exist (idempotent read-then-write). There is no startup-time seeding pass.
4. The scaffolded agent is memoized per guest, so the store, repository, and tool graph are built once per guest rather than on every turn.

The `<encoded-id>` segment is either the raw `userId` (when it is already filesystem-safe — a UUID v4 always is, so guest ids flow through raw) or `encoded_` followed by a base64url encoding of the `userId`. See `packages/core/src/memory/namespace.ts` for the exact rules. `assertSafeNamespace` rejects path-traversal attempts.

### Verify guest memory

Because memory is in-process, you cannot inspect files on disk. Instead, ask the agent to save a fact:

```text
Remember that this project's build command is bun run build.
```

Then in the same process, ask:

```text
What is this project's build command?
```

If you restart the web app, the answer is gone — the guest's memory started fresh.

### Local limits

- One web server process. The in-memory store is not shared across instances.
- No persistence across restarts.
- Bounded by the agent cache's LRU eviction (see `DeepAgentTemplate-htgo`).

### Future: durable storage (S3)

When durable guest memory is needed, replace the in-memory singleton in `createAgentForIdentity` with a `BucketMemoryStore` (S3-backed) — see `DeepAgentTemplate-58p3`. The S3 adapter must implement LangGraph's `BaseStore` contract. See Option 2 below for the bucket layout that the placeholder `BucketMemoryStore` will use.

## Option 2. One memory in S3

Use S3 when the application runs on replaceable servers or needs storage outside the application host.

The repository does not yet contain a working S3 store. `BucketMemoryStore` is a placeholder and throws `BucketMemoryStore is not implemented yet.` An S3 setup therefore needs an adapter that implements LangGraph's `BaseStore` contract.

### Create the bucket

Create one private bucket for agent memory. Enable:

- Server side encryption.
- Bucket versioning.
- Public access blocking.
- Lifecycle rules for old object versions, if required.

Give the application identity access only to the memory prefix. It needs these S3 actions:

```text
s3:GetObject
s3:PutObject
s3:DeleteObject
s3:ListBucket
```

Keep AWS credentials in the deployment environment or use an instance role. Do not save credentials in agent memory.

Suggested environment variables:

```dotenv
MEMORY_S3_BUCKET="my-agent-memory"
MEMORY_S3_PREFIX="deep-agent-template/memory/v1"
AWS_REGION="eu-central-1"
```

### Implement the store adapter

Create an application owned `S3MemoryStore` that extends `BaseStore` and implements `batch()`.

Map each store item to one JSON object so the content and metadata are written together. One possible object key format is:

```text
<prefix>/<encoded namespace>/<virtual path without the leading slash>.json
```

For the default memory namespace, the objects would be:

```text
deep-agent-template/memory/v1/users/default/memory/project-facts.md.json
deep-agent-template/memory/v1/users/default/memory/user-preferences.md.json
```

Store at least these fields in each object:

```json
{
  "namespace": ["users", "default", "memory"],
  "key": "/memory/project-facts.md",
  "value": {
    "content": "# Project Facts\n",
    "mimeType": "text/markdown",
    "created_at": "2026-07-24T12:00:00.000Z",
    "modified_at": "2026-07-24T12:00:00.000Z"
  },
  "createdAt": "2026-07-24T12:00:00.000Z",
  "updatedAt": "2026-07-24T12:00:00.000Z"
}
```

The `batch()` method must support:

| Store operation | S3 operation |
|---|---|
| Get one item | `GetObject` |
| Create or update one item | `PutObject` |
| Delete one item | `DeleteObject` |
| Search a namespace | `ListObjectsV2`, then load and filter matching objects |
| List namespaces | `ListObjectsV2`, then derive namespaces from object data |

Match the current store behavior:

- Accept string content only.
- Reject unsafe namespace and virtual path segments.
- Preserve `createdAt` when updating an object.
- Update `updatedAt` on each write.
- Return search results in stable order.
- Apply search filters, offsets, and limits.

### Seed S3 memory

Seed only missing files. Use a conditional S3 write with `If-None-Match: *` so two application instances cannot replace each other's seed files. Treat a precondition failure as "the file already exists."

S3 returns `412 Precondition Failed` when the object already exists. It may return `409 ConditionalRequestConflict` when another write is in progress. Retry a `409` response with a limit.

The setup code should follow this shape:

```ts
import {
  createMemoryRepository,
  createMemorySeedFiles,
} from "@deep-agent-template/core/memory";

const memoryStore = new S3MemoryStore({
  bucket: process.env.MEMORY_S3_BUCKET!,
  prefix: process.env.MEMORY_S3_PREFIX!,
  region: process.env.AWS_REGION!,
});

const memoryRepository = createMemoryRepository({
  store: memoryStore,
});

for (const seed of createMemorySeedFiles()) {
  if ((await memoryRepository.read(seed.path)) === null) {
    await memoryRepository.write(seed.path, seed.content);
  }
}
```

The adapter should make the create operation conditional. The read followed by write sequence alone is not safe when several processes start together.

### Connect S3 to the agent

Pass the S3 store as the memory backend. Keep the agent's other state in its existing store.

```ts
const agent = createScaffoldedAgent({
  backendOptions: {
    memoryStore,
  },
  modelRuntime,
});
```

When no `memoryUserId` is supplied the scaffold backfills `"default"`, yielding the namespace `["users", "default", "memory"]`. The web app already passes a per-guest `memoryUserId` (the guest UUID v4) into both `createMemoryRepository()` and `createScaffoldedAgent()` — see Option 1 above. Each guest gets a `["users", "<uuid>", "memory"]` namespace (UUIDs are filesystem-safe, so the encoder uses the raw id). When wiring a custom S3 store, pass the same `memoryUserId` to both:

```ts
const memoryUserId = guestUserId; // UUID v4 from x-guest-id

const memoryRepository = createMemoryRepository({
  store: memoryStore,
  userId: memoryUserId,
});

const agent = createScaffoldedAgent({
  backendOptions: {
    memoryStore,
    memoryUserId,
  },
  modelRuntime,
});
```

Do not add a user ID to only one side. The repository and agent must use the same namespace.

### Prevent lost updates

S3 keeps each object durable, but two writers can still overwrite each other. Return the object's `ETag` with reads and use `If-Match` for updates. If S3 rejects an update because the `ETag` changed, read the latest object, merge the new memory, and retry with a limit.

Bucket versioning helps recovery, but it does not prevent lost updates.

### Verify S3 memory

Verify these cases before deployment:

1. A fresh store creates both seed files.
2. A restart reads existing memory and does not replace it.
3. A memory edit survives replacement of the application instance.
4. Two startup processes do not replace an existing seed.
5. Two concurrent edits either merge safely or return a conflict.
6. The application identity cannot read objects outside the configured prefix.

## Content policy

The web app wires `createMemoryPolicyMiddleware` (from `@deep-agent-template/core/memory`) onto the guest agent. The middleware reviews every `write_file` / `edit_file` whose `file_path` targets `/memory/...` by calling `reviewMemoryContent(...)`. If the content matches a disallowed category — secrets, inferred preferences, or transient details — the write is rejected with a `ToolMessage` and the model is asked to rewrite (drop the credential, state an explicit preference, or keep transient details in `/scratch`). Everything else passes through untouched: reads, writes outside `/memory`, and clean `/memory` writes all reach the underlying tool unchanged.

```ts
import {
  createMemoryPolicy,
  createMemoryPolicyMiddleware,
  createScaffoldedAgent,
} from "@deep-agent-template/core";

const memoryPolicy = createMemoryPolicy();
const agent = createScaffoldedAgent({
  // ...
  middleware: [createMemoryPolicyMiddleware(memoryPolicy)],
});
```

The middleware is opt-in at the library level: core's `createScaffoldedAgent` does not add it by default. The web app opts in inside `buildAgent`. Treat `reviewMemoryContent` as a basic safety check, not a complete secret scanner; applications needing stricter enforcement can additionally call the helper in the S3 adapter or a host-controlled write policy before `PutObject`.

## Choose a setup

Use local memory when one process serves one user and the disk is persistent. Use S3 when application instances are replaced, several processes need the same memory, or memory must live outside the application host.

## S3 references

- [AWS conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)
- [AWS S3 permissions](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security_iam_service-with-iam.html)
- [AWS S3 security practices](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html)
