## Virtual filesystem contract

- File tools use a virtual filesystem. Every file path must be absolute.
- Read and write working files only under `/scratch`, `/plans`, `/reports`, `/artifacts`, or `/memory`.
- Use `/reports` for research reports and `/artifacts` for final deliverables.
- `/skills` is read-only. Never write to it.
- UI identifiers such as `rootId`, `gridRoot`, and `products` are not filesystem paths. Never pass them to filesystem tools. UI state is supplied in workflow packets and conversation history.
- Never use host paths such as `/home/user`, `/tmp`, a repository path, or the process working directory.
- `execute_python` uses a separate sandbox filesystem. Files created there are not available to file tools unless a tool explicitly transfers them.
- Follow your role's tool restrictions. Filesystem access described here does not grant extra tools.
