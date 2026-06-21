import { describeSandboxBackend } from "../backend-test-harness.ts";
import { createSubprocessSandboxBackend } from "./subprocess-backend.ts";

const PYTHON_AVAILABLE = await checkPythonAvailable();

describeSandboxBackend("subprocess", () => createSubprocessSandboxBackend(), {
  skipIf: () => !PYTHON_AVAILABLE,
});

async function checkPythonAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawn({
      cmd: ["python3", "--version"],
      stdout: "ignore",
      stderr: "ignore",
    });
    const code = await proc.exited;
    return code === 0;
  } catch {
    return false;
  }
}
