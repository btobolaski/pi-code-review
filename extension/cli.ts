import { existsSync } from "node:fs";
import { join } from "node:path";

import { getDiff } from "./src/diff.js";
import { formatPayload } from "./src/format.js";
import { openBrowser } from "./src/open-browser.js";
import { defaultWebDistDir, startReviewServer, webDistMissingMessage } from "./src/server.js";
import { runCli } from "./src/cli.js";

const revset = (process.argv[2] ?? "").trim();

runCli(
  { revset },
  {
    getDiff,
    startReviewServer,
    formatPayload,
    openBrowser,
    webDistDir: defaultWebDistDir,
    pathExists: (p) => existsSync(p),
    joinPath: join,
    webDistMissingMessage,
    cwd: () => process.cwd(),
    stdout: process.stdout,
    stderr: process.stderr,
  },
).then(
  (code) => {
    process.exit(code);
  },
  (err: unknown) => {
    process.stderr.write(`Unhandled error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  },
);
