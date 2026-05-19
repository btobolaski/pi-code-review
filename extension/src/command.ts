import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { getDiff as getDiffImpl } from "./diff.js";
import type { formatPayload as formatPayloadImpl } from "./format.js";
import type { openBrowser as openBrowserImpl } from "./open-browser.js";
import type { ReviewSession, startReviewServer as startReviewServerImpl } from "./server.js";

export type { ReviewSession } from "./server.js";

/**
 * Injectable dependencies for the /code-review command handler. Real-world
 * wiring lives in extension/index.ts; tests supply fakes for each function so
 * the handler logic can be exercised without spawning servers or shelling out.
 */
export type CodeReviewDeps = {
  getDiff: typeof getDiffImpl;
  startReviewServer: typeof startReviewServerImpl;
  formatPayload: typeof formatPayloadImpl;
  openBrowser: typeof openBrowserImpl;
  webDistDir: () => string;
  pathExists: (path: string) => boolean;
  joinPath: (...parts: string[]) => string;
  webDistMissingMessage: (dir: string) => string;
};

/**
 * Register the /code-review command on the supplied ExtensionAPI using the
 * given dependencies. Returns the underlying session set so callers (and
 * tests) can introspect active sessions if needed.
 */
export function registerCodeReviewCommand(
  pi: ExtensionAPI,
  deps: CodeReviewDeps,
): Set<ReviewSession> {
  const sessions = new Set<ReviewSession>();

  pi.registerCommand("code-review", {
    description: "Open the working-copy diff in a browser to leave review comments",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/code-review requires interactive mode", "error");
        return;
      }

      const webDistDir = deps.webDistDir();
      if (!deps.pathExists(deps.joinPath(webDistDir, "index.html"))) {
        ctx.ui.notify(deps.webDistMissingMessage(webDistDir), "error");
        return;
      }

      let diff;
      try {
        diff = await deps.getDiff({ cwd: ctx.cwd, revset: args });
      } catch (err) {
        ctx.ui.notify(
          `Failed to get diff: ${err instanceof Error ? err.message : String(err)}`,
          "error",
        );
        return;
      }

      if (diff.files.length === 0) {
        ctx.ui.notify(`No changes to review (revset ${diff.revset})`, "info");
        return;
      }

      let session: ReviewSession;
      try {
        session = await deps.startReviewServer({ diff, webDistDir });
      } catch (err) {
        ctx.ui.notify(
          `Failed to start review server: ${err instanceof Error ? err.message : String(err)}`,
          "error",
        );
        return;
      }
      sessions.add(session);

      ctx.ui.notify(`Review server: ${session.url}`, "info");
      deps.openBrowser(session.url);

      try {
        const result = await session.waitForDecision();
        if (result.kind === "cancelled") {
          ctx.ui.notify("Code review cancelled", "info");
          return;
        }

        const formatted = deps.formatPayload(result.payload, diff);
        if (formatted === null) {
          ctx.ui.notify("No comments and no summary \u2014 nothing sent to the agent", "info");
          return;
        }

        // Deliver as a follow-up so the agent picks it up after any in-flight
        // tool calls finish, mirroring how a typed follow-up would behave.
        pi.sendUserMessage(formatted, { deliverAs: "followUp" });
      } finally {
        session.stop();
        sessions.delete(session);
      }
    },
  });

  pi.on("session_shutdown", () => {
    for (const session of sessions) {
      session.stop();
    }
    sessions.clear();
  });

  return sessions;
}
