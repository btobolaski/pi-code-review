import { existsSync } from "node:fs";
import { join } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { getDiff } from "./src/diff.js";
import { formatPayload } from "./src/format.js";
import { openBrowser } from "./src/open-browser.js";
import { defaultWebDistDir, startReviewServer, webDistMissingMessage } from "./src/server.js";
import { registerCodeReviewCommand } from "./src/command.js";

export default function (pi: ExtensionAPI): void {
  registerCodeReviewCommand(pi, {
    getDiff,
    startReviewServer,
    formatPayload,
    openBrowser,
    webDistDir: defaultWebDistDir,
    pathExists: (p) => existsSync(p),
    joinPath: join,
    webDistMissingMessage,
  });
}

export type { CodeReviewDeps, ReviewSession } from "./src/command.js";
