// Runs every browser-free suite and fails if any of them fails.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const suites = ["rules.test.mjs", "background.test.mjs"];
let failed = 0;

for (const suite of suites) {
  console.log(`\n=== ${suite} ===`);
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(suite, import.meta.url))], {
    stdio: "inherit"
  });
  if (result.status !== 0) failed++;
}

console.log(failed === 0 ? "\nAll suites passed." : `\n${failed} suite(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
