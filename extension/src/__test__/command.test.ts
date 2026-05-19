import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { registerCodeReviewCommand, type CodeReviewDeps } from "../command.js";
import type { ReviewDecision, ReviewSession } from "../server.js";
import type { DiffPayload, SubmitPayload } from "../types.js";

type NotifyCall = [text: string, level?: string];
type SendCall = [content: unknown, options?: unknown];

type FakeApi = {
  pi: ExtensionAPI;
  handler: () => (args: string, ctx: ExtensionCommandContext) => Promise<void>;
  shutdown: () => () => Promise<void> | void;
  sends: SendCall[];
};

/**
 * Build a structurally-typed fake ExtensionAPI that records the registered
 * command handler and any session_shutdown listeners.
 */
function makeFakeApi(): FakeApi {
  let handler: ((args: string, ctx: ExtensionCommandContext) => Promise<void>) | undefined;
  let shutdown: (() => Promise<void> | void) | undefined;
  const sends: SendCall[] = [];

  const pi = {
    registerCommand: (_name: string, opts: { handler: typeof handler }) => {
      handler = opts.handler;
    },
    on: (event: string, fn: () => Promise<void> | void) => {
      if (event === "session_shutdown") {
        shutdown = fn;
      }
    },
    sendUserMessage: (content: unknown, options?: unknown) => {
      sends.push([content, options]);
    },
  } as unknown as ExtensionAPI;

  return {
    pi,
    handler: () => {
      if (!handler) throw new Error("handler not registered");
      return handler;
    },
    shutdown: () => {
      if (!shutdown) throw new Error("session_shutdown not registered");
      return shutdown;
    },
    sends,
  };
}

function makeCtx(overrides: Partial<{ hasUI: boolean; cwd: string }> = {}): {
  ctx: ExtensionCommandContext;
  notifications: NotifyCall[];
} {
  const notifications: NotifyCall[] = [];
  const ctx = {
    hasUI: overrides.hasUI ?? true,
    cwd: overrides.cwd ?? "/tmp/fake-cwd",
    ui: {
      notify: (text: string, level?: string) => {
        notifications.push([text, level]);
      },
    },
  } as unknown as ExtensionCommandContext;
  return { ctx, notifications };
}

const sampleDiff: DiffPayload = {
  vcs: "jj",
  revset: "@",
  cwd: "/tmp/fake-cwd",
  files: [
    {
      oldPath: "a.ts",
      newPath: "a.ts",
      filePath: "a.ts",
      status: "modified",
      hunks: [],
    },
  ],
};

const emptyDiff: DiffPayload = {
  vcs: "jj",
  revset: "@",
  cwd: "/tmp/fake-cwd",
  files: [],
};

/**
 * Build a baseline deps record with no-op fakes; individual tests override the
 * fields they care about.
 */
function makeDeps(overrides: Partial<CodeReviewDeps> = {}): {
  deps: CodeReviewDeps;
  calls: {
    getDiff: Array<{ cwd: string; revset: string | undefined }>;
    formatPayload: Array<{ payload: SubmitPayload; diff: DiffPayload }>;
    openBrowser: string[];
    pathExists: string[];
    startReviewServer: number;
    stops: number;
  };
} {
  const calls = {
    getDiff: [] as Array<{ cwd: string; revset: string | undefined }>,
    formatPayload: [] as Array<{ payload: SubmitPayload; diff: DiffPayload }>,
    openBrowser: [] as string[],
    pathExists: [] as string[],
    startReviewServer: 0,
    stops: 0,
  };

  const deps: CodeReviewDeps = {
    getDiff: async ({ cwd, revset }) => {
      calls.getDiff.push({ cwd, revset });
      return sampleDiff;
    },
    startReviewServer: async () => {
      calls.startReviewServer++;
      return {
        url: "http://127.0.0.1:0/",
        port: 0,
        waitForDecision: async (): Promise<ReviewDecision> => ({ kind: "cancelled" }),
        stop: () => {
          calls.stops++;
        },
      } satisfies ReviewSession;
    },
    formatPayload: (payload, diff) => {
      calls.formatPayload.push({ payload, diff });
      return "formatted";
    },
    openBrowser: (url) => {
      calls.openBrowser.push(url);
      return true;
    },
    webDistDir: () => "/fake/web/dist",
    pathExists: (p) => {
      calls.pathExists.push(p);
      return true;
    },
    joinPath: (...parts) => parts.join("/"),
    webDistMissingMessage: (dir) => `missing:${dir}`,
    ...overrides,
  };

  return { deps, calls };
}

describe("registerCodeReviewCommand", () => {
  it("notifies and exits when invoked without interactive UI", async () => {
    const api = makeFakeApi();
    const { deps, calls } = makeDeps();
    registerCodeReviewCommand(api.pi, deps);
    const { ctx, notifications } = makeCtx({ hasUI: false });

    await api.handler()("", ctx);

    assert.deepEqual(notifications, [["/code-review requires interactive mode", "error"]]);
    assert.equal(calls.getDiff.length, 0);
    assert.equal(calls.pathExists.length, 0);
    assert.equal(calls.startReviewServer, 0);
    assert.equal(api.sends.length, 0);
  });

  it("notifies and exits when the web dist is missing", async () => {
    const api = makeFakeApi();
    const { deps, calls } = makeDeps({ pathExists: () => false });
    registerCodeReviewCommand(api.pi, deps);
    const { ctx, notifications } = makeCtx();

    await api.handler()("", ctx);

    assert.equal(notifications.length, 1);
    const first = notifications[0];
    assert.ok(first);
    assert.equal(first[0], "missing:/fake/web/dist");
    assert.equal(first[1], "error");
    assert.equal(calls.getDiff.length, 0);
    assert.equal(calls.startReviewServer, 0);
  });

  it("forwards args to getDiff and notifies on failure", async () => {
    const api = makeFakeApi();
    const { deps, calls } = makeDeps({
      getDiff: async ({ cwd, revset }) => {
        calls.getDiff.push({ cwd, revset });
        throw new Error("boom");
      },
    });
    registerCodeReviewCommand(api.pi, deps);
    const { ctx, notifications } = makeCtx({ cwd: "/work" });

    await api.handler()("main..@", ctx);

    assert.deepEqual(calls.getDiff, [{ cwd: "/work", revset: "main..@" }]);
    assert.deepEqual(notifications, [["Failed to get diff: boom", "error"]]);
    assert.equal(calls.startReviewServer, 0);
  });

  it("notifies when there are no changes to review", async () => {
    const api = makeFakeApi();
    const { deps, calls } = makeDeps({ getDiff: async () => emptyDiff });
    registerCodeReviewCommand(api.pi, deps);
    const { ctx, notifications } = makeCtx();

    await api.handler()("", ctx);

    assert.deepEqual(notifications, [["No changes to review (revset @)", "info"]]);
    assert.equal(calls.startReviewServer, 0);
  });

  it("notifies when startReviewServer throws", async () => {
    const api = makeFakeApi();
    const { deps } = makeDeps({
      startReviewServer: async () => {
        throw new Error("port busy");
      },
    });
    registerCodeReviewCommand(api.pi, deps);
    const { ctx, notifications } = makeCtx();

    await api.handler()("", ctx);

    assert.equal(notifications.length, 1);
    const first = notifications[0];
    assert.ok(first);
    assert.equal(first[0], "Failed to start review server: port busy");
    assert.equal(first[1], "error");
    assert.equal(api.sends.length, 0);
  });

  it("delivers the formatted payload as a follow-up on submit and stops the session", async () => {
    const api = makeFakeApi();
    let stops = 0;
    const submitted: ReviewDecision = {
      kind: "submitted",
      payload: { summary: "looks good", comments: [] },
    };
    const session: ReviewSession = {
      url: "http://127.0.0.1:1234/",
      port: 1234,
      waitForDecision: async () => submitted,
      stop: () => {
        stops++;
      },
    };
    const { deps, calls } = makeDeps({
      startReviewServer: async () => {
        calls.startReviewServer++;
        return session;
      },
      formatPayload: (payload, diff) => {
        calls.formatPayload.push({ payload, diff });
        return "## summary\n\nlooks good";
      },
    });
    const sessions = registerCodeReviewCommand(api.pi, deps);
    const { ctx, notifications } = makeCtx();

    await api.handler()("", ctx);

    assert.equal(calls.startReviewServer, 1);
    assert.deepEqual(calls.openBrowser, ["http://127.0.0.1:1234/"]);
    assert.deepEqual(calls.formatPayload, [{ payload: submitted.payload, diff: sampleDiff }]);
    assert.deepEqual(api.sends, [["## summary\n\nlooks good", { deliverAs: "followUp" }]]);
    assert.equal(stops, 1);
    assert.equal(sessions.size, 0, "session should be removed after completion");
    assert.deepEqual(
      notifications.map((n) => n[0]),
      ["Review server: http://127.0.0.1:1234/"],
    );
  });

  it("notifies and skips sendUserMessage when the decision is cancelled", async () => {
    const api = makeFakeApi();
    let stops = 0;
    const session: ReviewSession = {
      url: "http://127.0.0.1:0/",
      port: 0,
      waitForDecision: async () => ({ kind: "cancelled" }),
      stop: () => {
        stops++;
      },
    };
    const { deps } = makeDeps({ startReviewServer: async () => session });
    registerCodeReviewCommand(api.pi, deps);
    const { ctx, notifications } = makeCtx();

    await api.handler()("", ctx);

    assert.equal(api.sends.length, 0);
    assert.equal(stops, 1);
    assert.ok(
      notifications.some(([text]) => text === "Code review cancelled"),
      "should notify about cancellation",
    );
  });

  it("notifies and skips sendUserMessage when formatPayload returns null", async () => {
    const api = makeFakeApi();
    let stops = 0;
    const session: ReviewSession = {
      url: "http://127.0.0.1:0/",
      port: 0,
      waitForDecision: async () => ({
        kind: "submitted",
        payload: { comments: [] },
      }),
      stop: () => {
        stops++;
      },
    };
    const { deps } = makeDeps({
      startReviewServer: async () => session,
      formatPayload: () => null,
    });
    registerCodeReviewCommand(api.pi, deps);
    const { ctx, notifications } = makeCtx();

    await api.handler()("", ctx);

    assert.equal(api.sends.length, 0);
    assert.equal(stops, 1);
    assert.ok(
      notifications.some(([text]) => text.startsWith("No comments and no summary")),
      "should notify about empty submission",
    );
  });

  it("stops live sessions on session_shutdown and clears the registry", async () => {
    const api = makeFakeApi();
    let stops = 0;
    let resolveDecision: (d: ReviewDecision) => void = () => {};
    const session: ReviewSession = {
      url: "http://127.0.0.1:0/",
      port: 0,
      waitForDecision: () =>
        new Promise<ReviewDecision>((resolve) => {
          resolveDecision = resolve;
        }),
      stop: () => {
        stops++;
      },
    };
    const { deps } = makeDeps({ startReviewServer: async () => session });
    const sessions = registerCodeReviewCommand(api.pi, deps);
    const { ctx } = makeCtx();

    const pending = api.handler()("", ctx);
    // Yield a few microtasks so the handler reaches `waitForDecision`.
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(sessions.size, 1, "session is live while waiting for decision");

    await api.shutdown()();
    assert.equal(stops, 1, "shutdown should stop the live session");
    assert.equal(sessions.size, 0, "shutdown should clear the registry");

    // Resolve the decision so the handler unwinds, and confirm the finally
    // block tolerates the session already being removed.
    resolveDecision({ kind: "cancelled" });
    await pending;
    assert.equal(stops, 2, "the finally clause still calls stop once");
  });
});
