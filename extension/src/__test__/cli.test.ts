import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CANCEL_NOTICE,
  EMPTY_NOTICE,
  NO_CHANGES_NOTICE,
  runCli,
  type CliDeps,
} from "../cli.js";
import type { ReviewDecision, ReviewSession } from "../server.js";
import type { DiffPayload, SubmitPayload } from "../types.js";

type RecordedStream = { write(text: string): void; chunks: string[] };

function makeStream(): RecordedStream {
  const chunks: string[] = [];
  return {
    chunks,
    write(text: string) {
      chunks.push(text);
    },
  };
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

function makeDeps(overrides: Partial<CliDeps> = {}): {
  deps: CliDeps;
  stdout: RecordedStream;
  stderr: RecordedStream;
  calls: {
    getDiff: Array<{ cwd: string; revset: string | undefined }>;
    formatPayload: Array<{ payload: SubmitPayload; diff: DiffPayload }>;
    openBrowser: string[];
    startReviewServer: number;
    stops: number;
  };
} {
  const stdout = makeStream();
  const stderr = makeStream();
  const calls = {
    getDiff: [] as Array<{ cwd: string; revset: string | undefined }>,
    formatPayload: [] as Array<{ payload: SubmitPayload; diff: DiffPayload }>,
    openBrowser: [] as string[],
    startReviewServer: 0,
    stops: 0,
  };

  const deps: CliDeps = {
    getDiff: async ({ cwd, revset }) => {
      calls.getDiff.push({ cwd, revset });
      return sampleDiff;
    },
    startReviewServer: async () => {
      calls.startReviewServer++;
      return {
        url: "http://127.0.0.1:0",
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
    pathExists: () => true,
    joinPath: (...parts) => parts.join("/"),
    webDistMissingMessage: (dir) => `missing:${dir}`,
    cwd: () => "/tmp/fake-cwd",
    stdout,
    stderr,
    ...overrides,
  };

  return { deps, stdout, stderr, calls };
}

describe("runCli", () => {
  it("returns 1 and reports a stderr message when web/dist is missing", async () => {
    const { deps, stdout, stderr, calls } = makeDeps({ pathExists: () => false });

    const code = await runCli({ revset: "" }, deps);

    assert.equal(code, 1);
    assert.equal(stdout.chunks.length, 0);
    assert.deepEqual(stderr.chunks, ["missing:/fake/web/dist\n"]);
    assert.equal(calls.getDiff.length, 0);
    assert.equal(calls.startReviewServer, 0);
  });

  it("forwards args to getDiff and reports failures on stderr without sending output", async () => {
    const { deps, stdout, stderr, calls } = makeDeps({
      cwd: () => "/work",
      getDiff: async ({ cwd, revset }) => {
        calls.getDiff.push({ cwd, revset });
        throw new Error("boom");
      },
    });

    const code = await runCli({ revset: "main..@" }, deps);

    assert.equal(code, 1);
    assert.deepEqual(calls.getDiff, [{ cwd: "/work", revset: "main..@" }]);
    assert.equal(stdout.chunks.length, 0);
    assert.deepEqual(stderr.chunks, ["Failed to get diff: boom\n"]);
    assert.equal(calls.startReviewServer, 0);
  });

  it("renders non-Error throws via String() so the stderr message is still readable", async () => {
    const { deps, stdout, stderr } = makeDeps({
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- intentional non-Error throw
      getDiff: async () => {
        throw "string failure";
      },
    });

    const code = await runCli({ revset: "" }, deps);

    assert.equal(code, 1);
    assert.equal(stdout.chunks.length, 0);
    assert.deepEqual(stderr.chunks, ["Failed to get diff: string failure\n"]);
  });

  it("emits the no-changes sentinel when the diff is empty", async () => {
    const { deps, stdout, stderr, calls } = makeDeps({
      getDiff: async ({ cwd, revset }) => {
        calls.getDiff.push({ cwd, revset });
        return emptyDiff;
      },
    });

    const code = await runCli({ revset: "" }, deps);

    assert.equal(code, 0);
    assert.deepEqual(stdout.chunks, [`${NO_CHANGES_NOTICE}\n`]);
    assert.deepEqual(stderr.chunks, ["No changes to review (revset @)\n"]);
    assert.deepEqual(calls.getDiff, [{ cwd: "/tmp/fake-cwd", revset: "" }]);
    assert.equal(calls.startReviewServer, 0);
  });

  it("returns 1 and reports a stderr message when startReviewServer throws", async () => {
    const { deps, stdout, stderr } = makeDeps({
      startReviewServer: async () => {
        throw new Error("port busy");
      },
    });

    const code = await runCli({ revset: "" }, deps);

    assert.equal(code, 1);
    assert.equal(stdout.chunks.length, 0);
    assert.deepEqual(stderr.chunks, ["Failed to start review server: port busy\n"]);
  });

  it("emits the cancel sentinel and stops the session on cancel", async () => {
    let stops = 0;
    const session: ReviewSession = {
      url: "http://127.0.0.1:1234",
      port: 1234,
      waitForDecision: async () => ({ kind: "cancelled" }),
      stop: () => {
        stops++;
      },
    };
    const { deps, stdout, stderr, calls } = makeDeps({
      startReviewServer: async () => session,
    });

    const code = await runCli({ revset: "" }, deps);

    assert.equal(code, 0);
    assert.deepEqual(stdout.chunks, [`${CANCEL_NOTICE}\n`]);
    assert.ok(
      stderr.chunks.includes("Review server: http://127.0.0.1:1234\n"),
      "stderr should include the review URL",
    );
    assert.ok(
      stderr.chunks.includes("Code review cancelled\n"),
      "stderr should include the cancellation notice",
    );
    assert.deepEqual(calls.openBrowser, ["http://127.0.0.1:1234"]);
    assert.equal(stops, 1, "session should be stopped exactly once");
  });

  it("emits the empty sentinel when formatPayload returns null", async () => {
    let stops = 0;
    const session: ReviewSession = {
      url: "http://127.0.0.1:0",
      port: 0,
      waitForDecision: async () => ({
        kind: "submitted",
        payload: { comments: [] },
      }),
      stop: () => {
        stops++;
      },
    };
    const { deps, stdout, stderr } = makeDeps({
      startReviewServer: async () => session,
      formatPayload: () => null,
    });

    const code = await runCli({ revset: "" }, deps);

    assert.equal(code, 0);
    assert.deepEqual(stdout.chunks, [`${EMPTY_NOTICE}\n`]);
    assert.ok(
      stderr.chunks.some((line) => line.startsWith("No comments and no summary")),
      "stderr should include the empty-submission notice",
    );
    assert.equal(stops, 1);
  });

  it("writes the formatted payload to stdout exactly once and stops the session", async () => {
    let stops = 0;
    const submitted: ReviewDecision = {
      kind: "submitted",
      payload: { summary: "looks good", comments: [] },
    };
    const session: ReviewSession = {
      url: "http://127.0.0.1:7777",
      port: 7777,
      waitForDecision: async () => submitted,
      stop: () => {
        stops++;
      },
    };
    const { deps, stdout, stderr, calls } = makeDeps({
      startReviewServer: async () => session,
      formatPayload: (payload, diff) => {
        calls.formatPayload.push({ payload, diff });
        return "# Code review\n\nlooks good";
      },
    });

    const code = await runCli({ revset: "" }, deps);

    assert.equal(code, 0);
    assert.deepEqual(stdout.chunks, ["# Code review\n\nlooks good\n"]);
    // The success path is allowed exactly one stderr line (the review URL) so a
    // future regression that adds noise — extra status, leaked errors — fails
    // immediately rather than going unnoticed.
    assert.deepEqual(stderr.chunks, ["Review server: http://127.0.0.1:7777\n"]);
    assert.deepEqual(calls.formatPayload, [{ payload: submitted.payload, diff: sampleDiff }]);
    assert.equal(stops, 1);
  });

  it("does not append a duplicate newline when formatPayload already ends in one", async () => {
    const session: ReviewSession = {
      url: "http://127.0.0.1:0",
      port: 0,
      waitForDecision: async () => ({
        kind: "submitted",
        payload: { summary: "hi", comments: [] },
      }),
      stop: () => {},
    };
    const { deps, stdout } = makeDeps({
      startReviewServer: async () => session,
      formatPayload: () => "already-newlined\n",
    });

    const code = await runCli({ revset: "" }, deps);

    assert.equal(code, 0);
    assert.deepEqual(stdout.chunks, ["already-newlined\n"]);
  });

  it("stops the session even when waitForDecision rejects", async () => {
    let stops = 0;
    const session: ReviewSession = {
      url: "http://127.0.0.1:0",
      port: 0,
      waitForDecision: async () => {
        throw new Error("crashed");
      },
      stop: () => {
        stops++;
      },
    };
    const { deps } = makeDeps({ startReviewServer: async () => session });

    await assert.rejects(runCli({ revset: "" }, deps), /crashed/);
    assert.equal(stops, 1, "the finally clause should stop the session");
  });
});
