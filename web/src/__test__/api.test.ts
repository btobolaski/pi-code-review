import { strict as assert } from "node:assert";
import { afterEach, beforeEach, describe, it } from "node:test";

import { cancelReview, fetchDiff, submitReview } from "../lib/api";
import { installFetchStub } from "./fetch-stub";

let stub: ReturnType<typeof installFetchStub> | null = null;

afterEach(() => {
  stub?.restore();
  stub = null;
});

describe("fetchDiff", () => {
  it("returns the parsed body on 200", async () => {
    stub = installFetchStub(
      () =>
        new Response(JSON.stringify({ vcs: "jj", revset: "@", cwd: "/r", files: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const diff = await fetchDiff();
    assert.equal(diff.vcs, "jj");
    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0].url, "/api/diff");
  });

  it("throws when /api/diff returns a non-ok status", async () => {
    stub = installFetchStub(() => new Response("nope", { status: 500 }));
    await assert.rejects(() => fetchDiff(), /GET \/api\/diff -> 500/);
  });
});

describe("submitReview", () => {
  it("POSTs a JSON body and resolves on success", async () => {
    stub = installFetchStub(() => new Response("{}", { status: 200 }));
    await submitReview({ summary: "hi", comments: [] });
    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0].url, "/api/submit");
    assert.equal(stub.calls[0].init?.method, "POST");
    assert.equal(
      (stub.calls[0].init?.headers as Record<string, string>)["content-type"],
      "application/json",
    );
    assert.equal(stub.calls[0].init?.body, JSON.stringify({ summary: "hi", comments: [] }));
  });

  it("throws on a non-ok status", async () => {
    stub = installFetchStub(() => new Response("", { status: 400 }));
    await assert.rejects(() => submitReview({ comments: [] }), /POST \/api\/submit -> 400/);
  });
});

describe("cancelReview", () => {
  it("fires a keepalive POST and never throws", async () => {
    stub = installFetchStub(() => new Response("{}", { status: 200 }));
    // Returns void synchronously even though it kicks off async work.
    assert.equal(cancelReview(), undefined);
    // Yield once so the awaited promise inside is allowed to settle.
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0].url, "/api/cancel");
    assert.equal(stub.calls[0].init?.method, "POST");
    assert.equal((stub.calls[0].init as RequestInit & { keepalive?: boolean }).keepalive, true);
  });

  it("swallows network errors so beforeunload can't break", async () => {
    const previous = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("boom");
    }) as typeof fetch;
    try {
      assert.doesNotThrow(() => cancelReview());
    } finally {
      globalThis.fetch = previous;
    }
  });
});

beforeEach(() => {
  /* fresh slate per test */
});
