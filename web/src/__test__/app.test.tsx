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

const nestedSidebarDiff: DiffPayload = {
  vcs: "jj",
  revset: "@",
  cwd: "/r",
  files: [
    {
      oldPath: null,
      newPath: "extension/index.ts",
      filePath: "extension/index.ts",
      status: "added",
      hunks: [],
    },
    {
      oldPath: "extension/src/old-command.ts",
      newPath: "extension/src/command.ts",
      filePath: "extension/src/command.ts",
      status: "renamed",
      hunks: [],
    },
    {
      oldPath: "extension/src/diff.ts",
      newPath: "extension/src/diff.ts",
      filePath: "extension/src/diff.ts",
      status: "modified",
      hunks: [],
    },
    {
      oldPath: "web/src/App.tsx",
      newPath: null,
      filePath: "web/src/App.tsx",
      status: "deleted",
      hunks: [],
    },
  ],
};

const duplicateBasenameDiff: DiffPayload = {
  vcs: "jj",
  revset: "@",
  cwd: "/r",
  files: [
    {
      oldPath: "extension/index.ts",
      newPath: "extension/index.ts",
      filePath: "extension/index.ts",
      status: "modified",
      hunks: [],
    },
    {
      oldPath: "web/index.ts",
      newPath: "web/index.ts",
      filePath: "web/index.ts",
      status: "modified",
      hunks: [],
    },
  ],
};

type Stub = ReturnType<typeof installFetchStub>;
let stub: Stub | null = null;
const originalIntersectionObserver = globalThis.IntersectionObserver;
let restoreIntersectionObserver: (() => void) | null = null;

afterEach(() => {
  cleanup();
  stub?.restore();
  stub = null;
  restoreIntersectionObserver?.();
  restoreIntersectionObserver = null;
});

function defaultResponder(
  options: { diff?: DiffPayload; onSubmit?: (call: FetchCall) => Response } = {},
): Stub {
  return installFetchStub((call) => {
    if (call.url === "/api/diff") {
      return new Response(JSON.stringify(options.diff ?? sampleDiff), {
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

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];

  readonly observed = new Set<Element>();

  constructor(
    private readonly callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {
    FakeIntersectionObserver.instances.push(this);
  }

  disconnect(): void {
    this.observed.clear();
  }

  observe(element: Element): void {
    this.observed.add(element);
  }

  unobserve(element: Element): void {
    this.observed.delete(element);
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  emit(entries: Array<{ target: Element; isIntersecting: boolean; top: number }>): void {
    this.callback(
      entries.map(
        ({ target, isIntersecting, top }) =>
          ({
            target,
            isIntersecting,
            boundingClientRect: { top } as DOMRectReadOnly,
          }) as IntersectionObserverEntry,
      ),
      this as unknown as IntersectionObserver,
    );
  }
}

function installIntersectionObserverStub(): typeof FakeIntersectionObserver {
  FakeIntersectionObserver.instances = [];
  globalThis.IntersectionObserver = FakeIntersectionObserver as unknown as typeof IntersectionObserver;
  restoreIntersectionObserver = () => {
    FakeIntersectionObserver.instances = [];
    if (originalIntersectionObserver) {
      globalThis.IntersectionObserver = originalIntersectionObserver;
      return;
    }
    delete (globalThis as { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver;
  };
  return FakeIntersectionObserver;
}

function setMockTop(element: Element, top: number): void {
  (element as HTMLElement).getBoundingClientRect = () => ({ top }) as DOMRect;
}

describe("App", () => {
  it("renders the loading state and then the diff", async () => {
    stub = defaultResponder();
    render(<App />);
    assert.ok(screen.getByText(/Loading diff/i));
    await waitFor(() => screen.getByRole("button", { name: /Comment on this file/i }));
    assert.ok(screen.getByText("No comments yet"));
  });

  it("renders the sidebar as a directory tree with status glyphs", async () => {
    stub = defaultResponder({ diff: nestedSidebarDiff });
    const { container } = render(<App />);

    await waitFor(() => screen.getByText("extension"));

    const dirNames = [...container.querySelectorAll("nav.sidebar .sidebar-dir")].map((node) =>
      node.textContent?.trim(),
    );
    assert.deepEqual(dirNames, ["extension", "src", "web", "src"]);
    assert.equal(screen.queryByRole("button", { name: "extension" }), null);
    assert.equal(screen.queryByRole("button", { name: "src" }), null);

    const sidebarFiles = [...container.querySelectorAll("nav.sidebar .sidebar-file")].map((node) => ({
      label: node.querySelector(".sidebar-file-label")?.textContent,
      status: node.querySelector(".sidebar-file-status")?.textContent,
      statusClass: node.querySelector(".sidebar-file-status")?.className,
      ariaHidden: node.querySelector(".sidebar-file-status")?.getAttribute("aria-hidden"),
    }));
    assert.deepEqual(sidebarFiles, [
      {
        label: "index.ts",
        status: "+",
        statusClass: "sidebar-file-status status-added",
        ariaHidden: "true",
      },
      {
        label: "command.ts",
        status: "~",
        statusClass: "sidebar-file-status status-modified",
        ariaHidden: "true",
      },
      {
        label: "diff.ts",
        status: "~",
        statusClass: "sidebar-file-status status-modified",
        ariaHidden: "true",
      },
      {
        label: "App.tsx",
        status: "-",
        statusClass: "sidebar-file-status status-deleted",
        ariaHidden: "true",
      },
    ]);
  });

  it("gives duplicate sidebar basenames distinct accessible labels", async () => {
    stub = defaultResponder({ diff: duplicateBasenameDiff });
    render(<App />);

    await waitFor(() =>
      screen.getByRole("button", { name: "extension/index.ts modified" }),
    );

    assert.ok(screen.getByRole("button", { name: "extension/index.ts modified" }));
    assert.ok(screen.getByRole("button", { name: "web/index.ts modified" }));
  });

  it("keeps nested sidebar files clickable and updates the active row", async () => {
    stub = defaultResponder({ diff: nestedSidebarDiff });
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    const scrollCalls: string[] = [];
    HTMLElement.prototype.scrollIntoView = function () {
      scrollCalls.push(this.id);
    };

    try {
      render(<App />);
      await waitFor(() =>
        screen.getByRole("button", { name: "extension/index.ts added" }),
      );

      const initialButton = screen.getByRole("button", {
        name: "extension/index.ts added",
      }) as HTMLButtonElement;
      const targetButton = screen.getByRole("button", {
        name: "web/src/App.tsx deleted",
      }) as HTMLButtonElement;

      assert.equal(initialButton.classList.contains("active"), true);
      fireEvent.click(targetButton);
      assert.equal(targetButton.classList.contains("active"), true);
      assert.equal(
        scrollCalls.includes(`file-${encodeURIComponent("web/src/App.tsx")}`),
        true,
      );
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it("updates the active row when the top-band observer reports a new file", async () => {
    stub = defaultResponder({ diff: nestedSidebarDiff });
    const observerClass = installIntersectionObserverStub();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    const scrollCalls: Array<{
      element: HTMLElement;
      options: ScrollIntoViewOptions | boolean | undefined;
    }> = [];
    HTMLElement.prototype.scrollIntoView = function (options) {
      scrollCalls.push({
        element: this,
        options,
      });
    };

    try {
      render(<App />);
      await waitFor(() =>
        screen.getByRole("button", { name: "extension/index.ts added" }),
      );

      const initialButton = screen.getByRole("button", {
        name: "extension/index.ts added",
      }) as HTMLButtonElement;
      const targetButton = screen.getByRole("button", {
        name: "web/src/App.tsx deleted",
      }) as HTMLButtonElement;
      assert.equal(initialButton.classList.contains("active"), true);

      const observer = await waitFor(() => {
        const instance = observerClass.instances[0];
        assert.ok(instance, "expected DiffView to create an IntersectionObserver");
        return instance;
      });

      assert.equal(observer.options?.rootMargin, "0px 0px -85% 0px");
      const mainPane = document.querySelector("main.main");
      assert.equal(observer.options?.root, mainPane);
      assert.deepEqual(
        [...observer.observed].map((element) => (element as HTMLElement).id),
        nestedSidebarDiff.files.map((file) => `file-${encodeURIComponent(file.filePath)}`),
      );

      const initialSection = document.getElementById(
        `file-${encodeURIComponent("extension/index.ts")}`,
      );
      const targetSection = document.getElementById(
        `file-${encodeURIComponent("web/src/App.tsx")}`,
      );
      assert.ok(mainPane, "expected main scroll pane");
      assert.ok(initialSection, "expected initial file section");
      assert.ok(targetSection, "expected target file section");

      setMockTop(mainPane, 0);
      setMockTop(initialSection, -4);
      observer.emit([{ target: initialSection, isIntersecting: true, top: -4 }]);

      setMockTop(targetSection, 12);
      observer.emit([
        { target: initialSection, isIntersecting: false, top: -200 },
        { target: targetSection, isIntersecting: true, top: 12 },
      ]);

      await waitFor(() => assert.equal(targetButton.classList.contains("active"), true));
      await waitFor(() =>
        assert.equal(
          scrollCalls.some(
            (call) =>
              call.element === targetButton &&
              typeof call.options === "object" &&
              call.options?.block === "nearest",
          ),
          true,
        ),
      );
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it("chooses the intersecting file closest to the top of the main pane", async () => {
    stub = defaultResponder({ diff: nestedSidebarDiff });
    const observerClass = installIntersectionObserverStub();

    render(<App />);
    await waitFor(() =>
      screen.getByRole("button", { name: "extension/index.ts added" }),
    );

    const observer = await waitFor(() => {
      const instance = observerClass.instances[0];
      assert.ok(instance, "expected DiffView to create an IntersectionObserver");
      return instance;
    });

    const mainPane = document.querySelector("main.main");
    const firstSection = document.getElementById(
      `file-${encodeURIComponent("extension/index.ts")}`,
    );
    const secondSection = document.getElementById(
      `file-${encodeURIComponent("extension/src/command.ts")}`,
    );
    const thirdSection = document.getElementById(
      `file-${encodeURIComponent("web/src/App.tsx")}`,
    );
    assert.ok(mainPane, "expected main scroll pane");
    assert.ok(firstSection, "expected first file section");
    assert.ok(secondSection, "expected second file section");
    assert.ok(thirdSection, "expected third file section");

    setMockTop(mainPane, 0);
    setMockTop(firstSection, -300);
    setMockTop(secondSection, -10);
    setMockTop(thirdSection, 8);
    observer.emit([
      { target: firstSection, isIntersecting: true, top: -300 },
      { target: secondSection, isIntersecting: true, top: -10 },
      { target: thirdSection, isIntersecting: true, top: 8 },
    ]);

    const secondButton = screen.getByRole("button", {
      name: "extension/src/command.ts renamed",
    }) as HTMLButtonElement;
    await waitFor(() => assert.equal(secondButton.classList.contains("active"), true));
  });

  it("recomputes current section positions instead of using stale observer tops", async () => {
    stub = defaultResponder({ diff: nestedSidebarDiff });
    const observerClass = installIntersectionObserverStub();

    render(<App />);
    await waitFor(() =>
      screen.getByRole("button", { name: "extension/index.ts added" }),
    );

    const observer = await waitFor(() => {
      const instance = observerClass.instances[0];
      assert.ok(instance, "expected DiffView to create an IntersectionObserver");
      return instance;
    });

    const mainPane = document.querySelector("main.main");
    const firstSection = document.getElementById(
      `file-${encodeURIComponent("extension/index.ts")}`,
    );
    const secondSection = document.getElementById(
      `file-${encodeURIComponent("extension/src/command.ts")}`,
    );
    assert.ok(mainPane, "expected main scroll pane");
    assert.ok(firstSection, "expected first file section");
    assert.ok(secondSection, "expected second file section");

    setMockTop(mainPane, 0);
    setMockTop(firstSection, 40);
    observer.emit([{ target: firstSection, isIntersecting: true, top: 40 }]);

    setMockTop(firstSection, -10);
    setMockTop(secondSection, 8);
    observer.emit([{ target: secondSection, isIntersecting: true, top: 8 }]);

    const firstButton = screen.getByRole("button", {
      name: "extension/index.ts added",
    }) as HTMLButtonElement;
    await waitFor(() => assert.equal(firstButton.classList.contains("active"), true));
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
    assert.equal(
      screen.getByRole("button", { name: "a.ts modified 1 comment" }).querySelector(
        ".sidebar-file-count",
      )?.textContent,
      "1",
    );

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
