/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// IMPORTANT: setup-dom must be imported FIRST so happy-dom is registered
// before @testing-library/preact or any component module captures DOM globals.
import "./setup-dom";

import { strict as assert } from "node:assert";
import { afterEach, describe, it } from "node:test";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";

import { App } from "../App";
import type { DiffPayload, SubmitPayload } from "../../../extension/src/types";
import { installFetchStub, type FetchCall } from "./fetch-stub";

const sampleDiff: DiffPayload = {
  vcs: "jj",
  revset: "@",
  cwd: "/r",
  files: [
    {
      oldPath: "a.ts",
      newPath: "a.ts",
      filePath: "a.ts",
      status: "modified",
      hunks: [
        {
          oldStart: 1,
          oldLines: 3,
          newStart: 1,
          newLines: 4,
          header: "",
          lines: [
            { kind: "context", oldLine: 1, newLine: 1, text: "alpha" },
            { kind: "del", oldLine: 2, newLine: null, text: "beta" },
            { kind: "add", oldLine: null, newLine: 2, text: "gamma" },
            { kind: "context", oldLine: 3, newLine: 3, text: "delta" },
          ],
        },
      ],
    },
  ],
};

type Stub = ReturnType<typeof installFetchStub>;
let stub: Stub | null = null;

afterEach(() => {
  cleanup();
  stub?.restore();
  stub = null;
});

function defaultResponder(
  options: { onSubmit?: (call: FetchCall) => Response } = {},
): Stub {
  return installFetchStub((call) => {
    if (call.url === "/api/diff") {
      return new Response(JSON.stringify(sampleDiff), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (call.url === "/api/submit") {
      return options.onSubmit?.(call) ?? new Response("{}", { status: 200 });
    }
    if (call.url === "/api/cancel") {
      return new Response("{}", { status: 200 });
    }
    return new Response("not found", { status: 404 });
  });
}

describe("App", () => {
  it("renders the loading state and then the diff", async () => {
    stub = defaultResponder();
    render(<App />);
    assert.ok(screen.getByText(/Loading diff/i));
    await waitFor(() => screen.getByRole("button", { name: /Comment on this file/i }));
    assert.ok(screen.getByText("No comments yet"));
  });

  it("shows the fatal error pane when /api/diff fails", async () => {
    stub = installFetchStub((call) => {
      if (call.url === "/api/diff") return new Response("nope", { status: 500 });
      return new Response("not found", { status: 404 });
    });
    render(<App />);
    await waitFor(() => assert.ok(screen.getByText(/GET \/api\/diff -> 500/)));
  });

  it("submits a file-level comment and shows the submitted terminal screen", async () => {
    stub = defaultResponder();
    render(<App />);
    await waitFor(() => screen.getByRole("button", { name: /Comment on this file/i }));

    fireEvent.click(screen.getByRole("button", { name: /Comment on this file/i }));
    const textarea = await waitFor(() =>
      screen.getByPlaceholderText(/Leave a comment/i),
    );
    fireEvent.input(textarea, { target: { value: "needs more tests" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));

    // The comment count in the submit bar should update synchronously after save.
    await waitFor(() => screen.getByText("1 comment"));

    fireEvent.click(screen.getByRole("button", { name: /Submit review/i }));

    await waitFor(() =>
      assert.ok(screen.getByText(/Review sent to pi/i), "expected submitted message"),
    );

    const submits = stub.calls.filter((c) => c.url === "/api/submit");
    assert.equal(submits.length, 1);
    const body = JSON.parse((submits[0]?.init?.body as string) ?? "") as SubmitPayload;
    assert.equal(body.summary, undefined);
    assert.equal(body.comments.length, 1);
    assert.equal(body.comments[0]?.kind, "file");
    assert.equal(body.comments[0]?.filePath, "a.ts");
    assert.equal((body.comments[0] as { body: string }).body, "needs more tests");

    assert.equal(
      stub.calls.filter((c) => c.url === "/api/cancel").length,
      0,
      "no cancel fires on a clean submit",
    );
  });

  it("submits the overall summary with no comments when one is present", async () => {
    stub = defaultResponder();
    render(<App />);
    await waitFor(() => screen.getByRole("button", { name: /Comment on this file/i }));

    const summary = screen.getByPlaceholderText(/Overall review summary/i);
    fireEvent.input(summary, { target: { value: "  looks good  " } });
    fireEvent.click(screen.getByRole("button", { name: /Submit review/i }));

    await waitFor(() => screen.getByText(/Review sent to pi/i));
    const submits = stub.calls.filter((c) => c.url === "/api/submit");
    const body = JSON.parse((submits[0]?.init?.body as string) ?? "") as SubmitPayload;
    // The App trims the summary before sending.
    assert.equal(body.summary, "looks good");
    assert.equal(body.comments.length, 0);
  });

  it("disables Submit review until a comment or summary exists", async () => {
    stub = defaultResponder();
    render(<App />);
    await waitFor(() => screen.getByRole("button", { name: /Comment on this file/i }));

    const submitBtn = screen.getByRole("button", { name: /Submit review/i });
    assert.equal((submitBtn as HTMLButtonElement).disabled, true);

    const summary = screen.getByPlaceholderText(/Overall review summary/i);
    fireEvent.input(summary, { target: { value: "x" } });
    assert.equal((submitBtn as HTMLButtonElement).disabled, false);
  });

  it("opens a line-comment composer from gutter button activation", async () => {
    stub = defaultResponder();
    render(<App />);
    await waitFor(() => screen.getByRole("button", { name: /Comment on this file/i }));

    const gutterButton = screen.getByRole("button", { name: /Comment on right line 2/i });
    fireEvent.click(gutterButton, { detail: 0 });

    await waitFor(() => screen.getByText(/New comment on a\.ts line 2 \(right\)/i));
  });

  it("submits a right-side line comment created from the gutter", async () => {
    stub = defaultResponder();
    const { container } = render(<App />);
    await waitFor(() => screen.getByRole("button", { name: /Comment on this file/i }));

    const gutter = container.querySelector('[data-line-id="0:right:2"]');
    assert.ok(gutter, "expected right-side gutter for line 2");
    fireEvent.mouseDown(gutter, { button: 0 });
    fireEvent.mouseUp(window);

    const textarea = (await waitFor(() =>
      screen.getByPlaceholderText(/Leave a comment/i))) as HTMLTextAreaElement;
    assert.ok(screen.getByText(/New comment on a\.ts line 2 \(right\)/i));
    fireEvent.input(textarea, { target: { value: "check this addition" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));

    await waitFor(() => screen.getByText("1 comment"));
    fireEvent.click(screen.getByRole("button", { name: /Submit review/i }));
    await waitFor(() => screen.getByText(/Review sent to pi/i));

    const submits = stub.calls.filter((c) => c.url === "/api/submit");
    assert.equal(submits.length, 1);
    const body = JSON.parse((submits[0]?.init?.body as string) ?? "") as SubmitPayload;
    assert.deepEqual(body.comments, [
      {
        kind: "line",
        filePath: "a.ts",
        side: "right",
        startLine: 2,
        endLine: 2,
        body: "check this addition",
      },
    ]);
  });

  it("submits a dragged line-comment range", async () => {
    stub = defaultResponder();
    const { container } = render(<App />);
    await waitFor(() => screen.getByRole("button", { name: /Comment on this file/i }));

    const start = container.querySelector('[data-line-id="0:right:2"]');
    const end = container.querySelector('[data-line-id="0:right:3"]');
    assert.ok(start, "expected right-side gutter for line 2");
    assert.ok(end, "expected right-side gutter for line 3");
    fireEvent.mouseDown(start, { button: 0 });
    fireEvent.mouseEnter(end);
    fireEvent.mouseUp(window);

    const textarea = (await waitFor(() =>
      screen.getByPlaceholderText(/Leave a comment/i))) as HTMLTextAreaElement;
    assert.ok(screen.getByText(/New comment on a\.ts lines 2-3 \(right\)/i));
    fireEvent.input(textarea, { target: { value: "range note" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    fireEvent.click(screen.getByRole("button", { name: /Submit review/i }));
    await waitFor(() => screen.getByText(/Review sent to pi/i));

    const submits = stub.calls.filter((c) => c.url === "/api/submit");
    const body = JSON.parse((submits[0]?.init?.body as string) ?? "") as SubmitPayload;
    assert.deepEqual(body.comments, [
      {
        kind: "line",
        filePath: "a.ts",
        side: "right",
        startLine: 2,
        endLine: 3,
        body: "range note",
      },
    ]);
  });

  it("edits and deletes a line comment", async () => {
    stub = defaultResponder();
    const { container } = render(<App />);
    await waitFor(() => screen.getByRole("button", { name: /Comment on this file/i }));

    const gutter = container.querySelector('[data-line-id="0:right:2"]');
    assert.ok(gutter, "expected right-side gutter for line 2");
    fireEvent.mouseDown(gutter, { button: 0 });
    fireEvent.mouseUp(window);

    const textarea = (await waitFor(() =>
      screen.getByPlaceholderText(/Leave a comment/i))) as HTMLTextAreaElement;
    fireEvent.input(textarea, { target: { value: "first draft" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => screen.getByText("first draft"));

    fireEvent.click(screen.getByRole("button", { name: /Edit Comment on line 2 \(right\)/i }));
    const editBox = (await waitFor(() =>
      screen.getByDisplayValue("first draft"))) as HTMLTextAreaElement;
    fireEvent.input(editBox, { target: { value: "updated draft" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => screen.getByText("updated draft"));

    fireEvent.click(screen.getByRole("button", { name: /Delete Comment on line 2 \(right\)/i }));
    await waitFor(() => assert.equal(screen.queryByText("updated draft"), null));
    assert.equal(screen.queryByText("1 comment"), null);
  });

  it("disables line-comment edits while another composer is open", async () => {
    stub = defaultResponder();
    const { container } = render(<App />);
    await waitFor(() => screen.getByRole("button", { name: /Comment on this file/i }));

    const gutter = container.querySelector('[data-line-id="0:right:2"]');
    assert.ok(gutter, "expected right-side gutter for line 2");
    fireEvent.mouseDown(gutter, { button: 0 });
    fireEvent.mouseUp(window);

    const textarea = (await waitFor(() =>
      screen.getByPlaceholderText(/Leave a comment/i))) as HTMLTextAreaElement;
    fireEvent.input(textarea, { target: { value: "draft comment" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => screen.getByText("draft comment"));

    const fileButton = screen.getByRole("button", { name: /Comment on this file/i });
    fireEvent.click(fileButton);
    await waitFor(() => screen.getByText("File-level comment on a.ts"));

    const editButton = screen.getByRole("button", {
      name: /Edit Comment on line 2 \(right\)/i,
    }) as HTMLButtonElement;
    assert.equal(editButton.disabled, true);
  });

  it("keeps an open composer when other comment entry points are used", async () => {
    stub = defaultResponder();
    const { container } = render(<App />);
    await waitFor(() => screen.getByRole("button", { name: /Comment on this file/i }));

    const fileButton = screen.getByRole("button", { name: /Comment on this file/i });
    fireEvent.click(fileButton);

    const textarea = (await waitFor(() =>
      screen.getByPlaceholderText(/Leave a comment/i))) as HTMLTextAreaElement;
    fireEvent.input(textarea, { target: { value: "draft comment" } });

    assert.equal((fileButton as HTMLButtonElement).disabled, true);

    const gutter = container.querySelector('[data-line-id="0:right:2"]');
    assert.ok(gutter, "expected right-side gutter for line 2");
    fireEvent.mouseDown(gutter, { button: 0 });
    fireEvent.mouseUp(window);

    assert.equal(textarea.value, "draft comment");
    assert.ok(screen.getByText("File-level comment on a.ts"));
    assert.equal(screen.queryByText(/New comment on a\.ts line 2 \(right\)/i), null);
  });

  it("fires /api/cancel and shows the discarded terminal screen on Discard", async () => {
    stub = defaultResponder();
    render(<App />);
    await waitFor(() => screen.getByRole("button", { name: /Comment on this file/i }));

    fireEvent.click(screen.getByRole("button", { name: /Discard/i }));

    await waitFor(() => screen.getByText(/Review discarded/i));
    // The keepalive fetch is fire-and-forget; yield once to let it land.
    await new Promise((r) => setTimeout(r, 0));
    const cancels = stub.calls.filter((c) => c.url === "/api/cancel");
    assert.equal(cancels.length, 1);
    assert.equal(
      (cancels[0]?.init as RequestInit & { keepalive?: boolean }).keepalive,
      true,
    );
  });

  it("renders the fatal pane when /api/submit fails and stays interactive (no terminal)", async () => {
    stub = defaultResponder({
      onSubmit: () => new Response("", { status: 400 }),
    });
    render(<App />);
    await waitFor(() => screen.getByRole("button", { name: /Comment on this file/i }));

    const summary = screen.getByPlaceholderText(/Overall review summary/i);
    fireEvent.input(summary, { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: /Submit review/i }));

    await waitFor(() => assert.ok(screen.getByText(/Failed to submit/i)));
    // After the fatal error fires, App switches to the fatal screen, so the
    // submitted/discarded notices never render.
    assert.equal(screen.queryByText(/Review sent to pi/i), null);
    assert.equal(screen.queryByText(/Review discarded/i), null);
  });
});
