# Use the Python sandbox

`@deep-agent-template/sandbox` runs Python in an isolated Docker container and
exposes it through an MCP server. Agents receive it through MCP; applications
can also call the backend directly.

The current sandbox has no network access and does not install packages. The
container uses the packages included in its Python image.

## Requirements

Install Docker and start the Docker daemon. The default backend uses the
`python:3.12-slim` image, so Docker may download that image on the first run.

The package is already part of this workspace. Import it by package name:

```ts
import { createDockerSandboxBackend } from "@deep-agent-template/sandbox";
```

## Use with the agent

Start the Sandbox MCP service, then set `SANDBOX_MCP_URL`. The worker discovers
the `execute_python` tool and provides it to the `researcher` and `analyst`.

```ts
SANDBOX_MCP_URL="http://localhost:3010/mcp"
```

The `general-purpose` role does not receive the tool.

## Run the MCP service

```sh
bun run --filter @deep-agent-template/sandbox mcp --transport http --host 0.0.0.0 --port 3010
```

Use `--transport stdio` for stdio clients. Compose starts the HTTP service as
`sandbox-mcp` and mounts the Docker socket for per-execution containers.

## Call the backend directly

Direct calls support standard input, command arguments, input files, result
files, timeouts, and cancellation:

```ts
import { createDockerSandboxBackend } from "@deep-agent-template/sandbox";

const backend = createDockerSandboxBackend();
const controller = new AbortController();

const result = await backend.execute(
  {
    code: `
from pathlib import Path
import sys

source = Path("input.txt").read_text()
Path("output.txt").write_text(source.upper())
print(sys.argv[1])
`,
    stdin: "optional standard input",
    argv: ["finished"],
    inputArtifacts: new Map([
      ["input.txt", new TextEncoder().encode("hello")],
    ]),
    resourceProfile: "sandbox-small",
    timeoutSeconds: 30,
  },
  {
    executionId: crypto.randomUUID(),
    signal: controller.signal,
  },
);

if (result.status !== "succeeded") {
  console.error(result.failureClass, result.failureMessage);
}

for (const artifact of result.artifacts) {
  console.log(artifact.name, new TextDecoder().decode(artifact.bytes));
}
```

Each execution gets a new workspace. The backend deletes the workspace after it
collects the result files. The Python entrypoint is not returned. Input files
and files created by the Python code are returned in `result.artifacts`, subject
to the selected profile's limits.

Artifact names must be relative POSIX paths. Absolute paths, backslashes, and
`..` are rejected.

## Choose a resource profile

| Profile | CPU | Memory | Maximum timeout | Output limit | Result files |
|---|---:|---:|---:|---:|---:|
| `sandbox-small` | 0.5 | 256 MB | 60 seconds | 64 KiB | 1 MiB each, 8 files |
| `sandbox-medium` | 1.0 | 512 MB | 180 seconds | 256 KiB | 8 MiB each, 32 files |
| `sandbox-large` | 2.0 | 1 GB | 300 seconds | 1 MiB | 32 MiB each, 64 files |

The default profile is `sandbox-small`. A custom `timeoutSeconds` value cannot
exceed the profile limit.

## Read the result

The backend returns a `SandboxResult` for successful runs, Python errors,
timeouts, cancellation, validation errors, and backend failures. Python errors
do not throw.

Check these fields:

```ts
result.status;
result.exitCode;
result.stdout;
result.stderr;
result.stdoutTruncated;
result.stderrTruncated;
result.artifacts;
result.failureClass;
result.failureMessage;
result.retryable;
```

`status` is one of `succeeded`, `failed`, `timeout`, `cancelled`, or
`internal_error`. Use `failureClass` to decide how to handle a failed run. Use
the truncation fields before assuming that stdout or stderr is complete.

## Reuse a running container

The default backend starts a fresh container for every execution. For faster
local startup, you can reuse the container defined in
`packages/sandbox/infra/docker-compose.yml`.

Run these commands from `packages/sandbox/infra`:

```bash
mkdir -p sandbox-workspace
chmod 0777 sandbox-workspace
docker compose up --detach sandbox
```

Then configure the backend with the matching host path:

```ts
import { resolve } from "node:path";
import { createDockerSandboxBackend } from "@deep-agent-template/sandbox";

const backend = createDockerSandboxBackend({
  containerName: "python-sandbox",
  workDirRoot: resolve("packages/sandbox/infra/sandbox-workspace"),
});
```

The `workDirRoot` path must match the host directory mounted at `/workspace`.

Container reuse is for sequential local work. It does not enforce CPU and
memory limits per execution, shares `/tmp` between executions, and is not safe
for concurrent or hostile executions. Use the default fresh container mode for
untrusted code or concurrent runs.

Stop the reused container when finished:

```bash
docker compose down
```

## Change the Python image

Pass another image when you need a fixed set of extra packages:

```ts
const backend = createDockerSandboxBackend({
  pythonImage: "your-registry/python-sandbox:version",
});
```

Build the packages into the image. Runtime package installation and network
access are disabled.

## Run the package tests

Run the sandbox tests from the repository root:

```bash
bun test packages/sandbox
```

The Docker backend tests require a running Docker daemon. See
[`packages/sandbox/README.md`](../packages/sandbox/README.md) for the security
model and instructions for adding another backend.
