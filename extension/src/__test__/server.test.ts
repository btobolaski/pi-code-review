import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { request as httpRequest } from "node:http";

import { startReviewServer, validateSubmitPayload, webDistMissingMessage } from "../server.js";
import type { DiffPayload, SubmitPayload } from "../types.js";

function makeWebDist(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-code-review-web-"));
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>t</title>");
  writeFileSync(join(dir, "assets", "app.js"), "console.log('app');");
  return dir;
}

const sampleDiff: DiffPayload = {
  vcs: "jj",
  revset: "@",
  cwd: "/repo",
  files: [],
};

describe("startReviewServer", () => {
  it("rejects when web dist is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-code-review-empty-"));
    try {
      await assert.rejects(
        () => startReviewServer({ diff: sampleDiff, webDistDir: dir }),
        /Frontend assets are missing/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("serves the diff and resolves to a submitted decision", async () => {
    const dir = makeWebDist();
    const session = await startReviewServer({ diff: sampleDiff, webDistDir: dir });
    try {
      const diffRes = await fetch(`${session.url}/api/diff`);
      assert.equal(diffRes.status, 200);
      assert.deepEqual(await diffRes.json(), sampleDiff);

      const payload: SubmitPayload = {
        summary: "Looks fine",
        comments: [{ kind: "file", filePath: "a.ts", body: "ok" }],
      };
      const submitRes = await fetch(`${session.url}/api/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      assert.equal(submitRes.status, 200);

      const decision = await session.waitForDecision();
      assert.deepEqual(decision, { kind: "submitted", payload });
    } finally {
      session.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("cancel resolves to a cancelled decision", async () => {
    const dir = makeWebDist();
    const session = await startReviewServer({ diff: sampleDiff, webDistDir: dir });
    try {
      const res = await fetch(`${session.url}/api/cancel`, { method: "POST" });
      assert.equal(res.status, 200);
      assert.deepEqual(await session.waitForDecision(), { kind: "cancelled" });
    } finally {
      session.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("stop on an undecided session resolves to cancelled", async () => {
    const dir = makeWebDist();
    const session = await startReviewServer({ diff: sampleDiff, webDistDir: dir });
    const decision = session.waitForDecision();
    session.stop();
    try {
      assert.deepEqual(await decision, { kind: "cancelled" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the first decision wins (later submits are ignored)", async () => {
    const dir = makeWebDist();
    const session = await startReviewServer({ diff: sampleDiff, webDistDir: dir });
    try {
      await fetch(`${session.url}/api/cancel`, { method: "POST" });
      await fetch(`${session.url}/api/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ comments: [] }),
      });
      assert.deepEqual(await session.waitForDecision(), { kind: "cancelled" });
    } finally {
      session.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("serves index.html at / and unknown paths (SPA fallback)", async () => {
    const dir = makeWebDist();
    const session = await startReviewServer({ diff: sampleDiff, webDistDir: dir });
    try {
      const root = await fetch(`${session.url}/`);
      assert.equal(root.status, 200);
      assert.match(root.headers.get("content-type") ?? "", /text\/html/);
      assert.match(await root.text(), /<title>t<\/title>/);

      const unknown = await fetch(`${session.url}/no/such/route`);
      assert.equal(unknown.status, 200);
      assert.match(await unknown.text(), /<title>t<\/title>/);

      const asset = await fetch(`${session.url}/assets/app.js`);
      assert.equal(asset.status, 200);
      assert.match(asset.headers.get("content-type") ?? "", /javascript/);
    } finally {
      session.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects non-GET/HEAD/POST methods with 405", async () => {
    const dir = makeWebDist();
    const session = await startReviewServer({ diff: sampleDiff, webDistDir: dir });
    try {
      const res = await fetch(`${session.url}/anything`, { method: "DELETE" });
      assert.equal(res.status, 405);
    } finally {
      session.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects invalid PI_CODE_REVIEW_PORT values", async () => {
    const dir = makeWebDist();
    const previous = process.env.PI_CODE_REVIEW_PORT;
    try {
      for (const bad of ["abc", "1234.5", "-1", "99999"]) {
        process.env.PI_CODE_REVIEW_PORT = bad;
        await assert.rejects(
          () => startReviewServer({ diff: sampleDiff, webDistDir: dir }),
          /Invalid PI_CODE_REVIEW_PORT/,
        );
      }
    } finally {
      if (previous === undefined) delete process.env.PI_CODE_REVIEW_PORT;
      else process.env.PI_CODE_REVIEW_PORT = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects malformed JSON submits with 400", async () => {
    const dir = makeWebDist();
    const session = await startReviewServer({ diff: sampleDiff, webDistDir: dir });
    try {
      const res = await fetch(`${session.url}/api/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not-json",
      });
      assert.equal(res.status, 400);
    } finally {
      session.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects submit payloads with the wrong shape (400) and does not resolve", async () => {
    const dir = makeWebDist();
    const session = await startReviewServer({ diff: sampleDiff, webDistDir: dir });
    let decided: unknown = null;
    void session.waitForDecision().then((d) => {
      decided = d;
    });
    try {
      const res = await fetch(`${session.url}/api/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ comments: "nope" }),
      });
      assert.equal(res.status, 400);
      // Yield twice so any microtasks would have settled if the server had
      // mistakenly resolved the decision.
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(decided, null);
    } finally {
      session.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects submit bodies larger than the 1MB cap with 400", async () => {
    const dir = makeWebDist();
    const session = await startReviewServer({ diff: sampleDiff, webDistDir: dir });
    try {
      // A 2MB string of `x`s will exceed the 1MB MAX_BODY_BYTES cap.
      const oversized = "x".repeat(2 * 1024 * 1024);
      const res = await fetch(`${session.url}/api/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: oversized,
      });
      assert.equal(res.status, 400);
      const json = (await res.json()) as { error?: string };
      assert.match(json.error ?? "", /exceeds/);
    } finally {
      session.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("HEAD requests return headers without a body", async () => {
    const dir = makeWebDist();
    const session = await startReviewServer({ diff: sampleDiff, webDistDir: dir });
    try {
      const res = await fetch(`${session.url}/assets/app.js`, { method: "HEAD" });
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type") ?? "", /javascript/);
      assert.equal(await res.text(), "");
    } finally {
      session.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("static path traversal attempts do not escape the web dist", async () => {
    const dir = makeWebDist();
    // Put a secret beside the web dist; if traversal escapes the root, the
    // server might serve it.
    writeFileSync(join(dir, "..", "secret.txt"), "shh");
    const session = await startReviewServer({ diff: sampleDiff, webDistDir: dir });
    try {
      // node:http preserves the literal `/..` in req.url without URL
      // normalization, so this exercises the server's own traversal guard
      // rather than what fetch would normalize away.
      const body = await rawGet(session.port, "/../secret.txt");
      assert.ok(!body.includes("shh"), `unexpected leak: ${body}`);
    } finally {
      session.stop();
      rmSync(dir, { recursive: true, force: true });
      try {
        rmSync(join(dir, "..", "secret.txt"), { force: true });
      } catch {
        // best-effort
      }
    }
  });
});

/** Bare HTTP GET that preserves literal `/..` segments. */
function rawGet(port: number, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, method: "GET", path }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c as Buffer));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}

describe("validateSubmitPayload", () => {
  it("returns null for non-object payloads", () => {
    assert.equal(validateSubmitPayload(null), null);
    assert.equal(validateSubmitPayload(42), null);
    assert.equal(validateSubmitPayload("string"), null);
  });

  it("normalizes a valid payload", () => {
    const v = validateSubmitPayload({
      summary: "hi",
      comments: [
        { kind: "file", filePath: "a.ts", body: "good" },
        {
          kind: "line",
          filePath: "a.ts",
          side: "right",
          startLine: 1,
          endLine: 2,
          body: "see here",
        },
      ],
    });
    assert.deepEqual(v, {
      summary: "hi",
      comments: [
        { kind: "file", filePath: "a.ts", body: "good" },
        {
          kind: "line",
          filePath: "a.ts",
          side: "right",
          startLine: 1,
          endLine: 2,
          body: "see here",
        },
      ],
    });
  });

  it("rejects payloads where comments is present but not an array", () => {
    assert.equal(validateSubmitPayload({ summary: "x", comments: "nope" }), null);
    assert.equal(validateSubmitPayload({ comments: { 0: {} } }), null);
  });

  it("defaults missing comments to []", () => {
    const v = validateSubmitPayload({ summary: "x" });
    assert.deepEqual(v, { summary: "x", comments: [] });
  });

  it("drops line comments with non-positive or non-integer line numbers", () => {
    const base = {
      kind: "line" as const,
      filePath: "a.ts",
      side: "right" as const,
      body: "x",
    };
    const v = validateSubmitPayload({
      comments: [
        { ...base, startLine: 0, endLine: 1 },
        { ...base, startLine: -1, endLine: 1 },
        { ...base, startLine: 1.5, endLine: 2 },
        { ...base, startLine: Number.NaN, endLine: 1 },
        { ...base, startLine: 1, endLine: 1 },
      ],
    });
    assert.ok(v, "validator should accept the payload");
    assert.equal(v.comments.length, 1);
    assert.deepEqual(v.comments[0], { ...base, startLine: 1, endLine: 1 });
  });

  it("drops malformed comment entries but keeps valid ones", () => {
    const v = validateSubmitPayload({
      comments: [
        { kind: "file", filePath: "a.ts", body: "good" },
        { kind: "file" }, // missing fields
        { kind: "line", filePath: "a.ts", side: "right", startLine: 5, endLine: 4, body: "x" }, // start > end
        { kind: "line", filePath: "a.ts", side: "middle", startLine: 1, endLine: 1, body: "x" }, // bad side
        { kind: "garbage" },
      ],
    });
    assert.ok(v, "validator should accept the payload");
    assert.equal(v.comments.length, 1);
    assert.equal(v.comments[0]?.kind, "file");
  });
});

describe("webDistMissingMessage", () => {
  it("mentions the path and the build command", () => {
    const msg = webDistMissingMessage("/some/path");
    assert.match(msg, /\/some\/path/);
    assert.match(msg, /pnpm.*build/);
  });
});
