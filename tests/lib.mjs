// Shared helper for the browser-free suites: where the extension's files live,
// so tests load the real shipped scripts rather than copies.
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
