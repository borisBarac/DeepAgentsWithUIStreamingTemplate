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

## Option 1. One local memory

The web app already uses one persistent local memory for all requests. Use this setup for local development or for one server process with a persistent disk.

### Configure the path

Set `WEB_APP_MEMORY_DIR` in the root `.env` file:

```dotenv
WEB_APP_MEMORY_DIR=".data/memory"
```

A relative path starts in `packages/web-app`. The setting above resolves to:

```text
packages/web-app/.data/memory
```

The same path is the default when `WEB_APP_MEMORY_DIR` is empty. The directory is ignored by Git.

You may use an absolute path:

```dotenv
WEB_APP_MEMORY_DIR="/var/lib/deep-agent-template/memory"
```

The selected directory must be writable by the web server and must remain available after a restart.

### Start the web app

```bash
bun run web-app
```

During startup, the web app:

1. Creates a `FileSystemMemoryStore`.
2. Uses the `single-user` namespace.
3. Creates the two default memory files when they are missing.
4. Keeps existing files unchanged.
5. Passes the same store to the scaffolded agent.

With the default path, the Markdown files are stored at:

```text
packages/web-app/.data/memory/single-user/memory/project-facts.md
packages/web-app/.data/memory/single-user/memory/user-preferences.md
```

Each Markdown file has a neighboring `.meta.json` file. The metadata records the namespace, virtual path, and creation and update times.

### Verify local memory

Ask the agent to save an explicit fact:

```text
Remember that this project's build command is bun run build.
```

Restart the web app, then ask:

```text
What is this project's build command?
```

You can also inspect the stored file directly:

```bash
sed -n '1,160p' packages/web-app/.data/memory/single-user/memory/project-facts.md
```

### Local limits

Use one web server process with this setup. Several processes can race while creating or updating the same files. An ephemeral serverless filesystem will lose the files when the instance is replaced.

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

For the default single-user memory, the objects would be:

```text
deep-agent-template/memory/v1/single-user/memory/project-facts.md.json
deep-agent-template/memory/v1/single-user/memory/user-preferences.md.json
```

Store at least these fields in each object:

```json
{
  "namespace": ["single-user"],
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

The default namespace remains `["single-user"]`. If the application later serves several users, pass the same `memoryUserId` to both `createMemoryRepository()` and `createScaffoldedAgent()`:

```ts
const memoryUserId = authenticatedUser.id;

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

The current content policy is enforced mainly through prompts and seed file instructions. `reviewMemoryContent()` can flag likely secrets, inferred preferences, and transient details, but the agent's filesystem write path does not call it automatically.

If the application needs strict enforcement, call the content review helper in the S3 adapter or in a host controlled write policy before `PutObject`. Treat the helper as a basic safety check, not a complete secret scanner.

## Choose a setup

Use local memory when one process serves one user and the disk is persistent. Use S3 when application instances are replaced, several processes need the same memory, or memory must live outside the application host.

## S3 references

- [AWS conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)
- [AWS S3 permissions](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security_iam_service-with-iam.html)
- [AWS S3 security practices](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html)
