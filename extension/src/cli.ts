import type { getDiff as getDiffImpl } from "./diff.js";
import type { formatPayload as formatPayloadImpl } from "./format.js";
import type { openBrowser as openBrowserImpl } from "./open-browser.js";
import type { startReviewServer as startReviewServerImpl } from "./server.js";

/**
 * Markers we print to stdout in the absence of a real review result. They
 * become the agent's next user message in host integrations (Claude Code's
 * `!`-substitution slash commands, for example), so the wording is meant to
 * make it obvious that no follow-up work was requested.
 */
export const NO_CHANGES_NOTICE = "_(no changes to review — disregard this turn)_";
export const CANCEL_NOTICE = "_(code review cancelled — disregard this turn)_";
export const EMPTY_NOTICE =
  "_(code review submitted with no comments and no summary — disregard this turn)_";

/** Minimal writable surface so tests can substitute in-memory buffers. */
export type CliStream = { write(text: string): void };

/**
 * Injectable dependencies for the CLI orchestrator. The real entrypoint
 * (extension/cli.ts) supplies live implementations; tests supply fakes so the
 * orchestrator can be exercised without spawning servers or shelling out.
 */
export type CliDeps = {
  getDiff: typeof getDiffImpl;
  startReviewServer: typeof startReviewServerImpl;
  formatPayload: typeof formatPayloadImpl;
  openBrowser: typeof openBrowserImpl;
  webDistDir: () => string;
  pathExists: (path: string) => boolean;
  joinPath: (...parts: string[]) => string;
  webDistMissingMessage: (dir: string) => string;
  cwd: () => string;
  stdout: CliStream;
  stderr: CliStream;
};

export type CliArgs = {
  /** Optional VCS revset; empty string means "use the per-VCS default". */
  revset: string;
};

/**
 * Run the host-agnostic review flow once and return a process exit code.
 *
 * Contract:
 *   - On success the formatted review markdown (or a `_(... — disregard)_`
 *     sentinel) is the only thing written to stdout.
 *   - Status text, URLs, and errors go to stderr so they never pollute the
 *     stdout payload that a host may forward to its agent as a user message.
 *   - Exit code 0 means "the flow completed" (including cancel / empty);
 *     non-zero means the flow could not complete (missing build, diff failure,
 *     server failure).
 */
export async function runCli(args: CliArgs, deps: CliDeps): Promise<number> {
  const webDistDir = deps.webDistDir();
  if (!deps.pathExists(deps.joinPath(webDistDir, "index.html"))) {
    deps.stderr.write(`${deps.webDistMissingMessage(webDistDir)}\n`);
    return 1;
  }

  let diff;
  try {
    diff = await deps.getDiff({ cwd: deps.cwd(), revset: args.revset });
  } catch (err) {
    deps.stderr.write(`Failed to get diff: ${errorMessage(err)}\n`);
    return 1;
  }

  if (diff.files.length === 0) {
    deps.stderr.write(`No changes to review (revset ${diff.revset})\n`);
    deps.stdout.write(`${NO_CHANGES_NOTICE}\n`);
    return 0;
  }

  let session;
  try {
    session = await deps.startReviewServer({ diff, webDistDir });
  } catch (err) {
    deps.stderr.write(`Failed to start review server: ${errorMessage(err)}\n`);
    return 1;
  }

  deps.stderr.write(`Review server: ${session.url}\n`);
  deps.openBrowser(session.url);

  try {
    const result = await session.waitForDecision();
    if (result.kind === "cancelled") {
      deps.stderr.write("Code review cancelled\n");
      deps.stdout.write(`${CANCEL_NOTICE}\n`);
      return 0;
    }
    const formatted = deps.formatPayload(result.payload, diff);
    if (formatted === null) {
      deps.stderr.write("No comments and no summary — nothing to send\n");
      deps.stdout.write(`${EMPTY_NOTICE}\n`);
      return 0;
    }
    deps.stdout.write(formatted.endsWith("\n") ? formatted : `${formatted}\n`);
    return 0;
  } finally {
    session.stop();
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
