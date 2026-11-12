// Sandbox with mock OutLayer, not testnet evidence. Windows entrypoint; builds/node run inside WSL.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const web = fileURLToPath(new URL("../../apps/web/", import.meta.url));
const cli = fileURLToPath(
  new URL(
    "../../apps/web/node_modules/@playwright/test/cli.js",
    import.meta.url,
  ),
);
const output = mkdtempSync(join(tmpdir(), "pw-SandboxE2E-"));
const started = Date.now();
const child = spawn(
  process.execPath,
  [
    cli,
    "test",
    "--project=sandbox",
    `--output=${output}`,
    ...process.argv.slice(2),
  ],
  {
    cwd: web,
    stdio: "inherit",
    env: { ...process.env, E2E_SANDBOX: "1", E2E_PORT: "5193" },
  },
);
child.on("error", (error) => {
  rmSync(output, { recursive: true, force: true });
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  rmSync(output, { recursive: true, force: true });
  console.log(
    `Sandbox with mock OutLayer, not testnet evidence: total ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
  process.exitCode = code ?? 1;
});
