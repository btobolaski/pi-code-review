import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { extractContext, formatPayload, inlineCode, pickFence } from "../format.js";
import type { DiffFile, DiffPayload, SubmitPayload } from "../types.js";

const sampleFile: DiffFile = {
  oldPath: "src/a.ts",
  newPath: "src/a.ts",
  filePath: "src/a.ts",
  status: "modified",
  hunks: [
    {
      oldStart: 1,
      oldLines: 6,
      newStart: 1,
      newLines: 7,
      lines: [
        { kind: "context", oldLine: 1, newLine: 1, text: "line 1" },
        { kind: "context", oldLine: 2, newLine: 2, text: "line 2" },
        { kind: "context", oldLine: 3, newLine: 3, text: "line 3" },
        { kind: "del", oldLine: 4, newLine: null, text: "old line 4" },
        { kind: "add", oldLine: null, newLine: 4, text: "new line 4" },
        { kind: "add", oldLine: null, newLine: 5, text: "new line 5" },
        { kind: "context", oldLine: 5, newLine: 6, text: "line 6" },
        { kind: "context", oldLine: 6, newLine: 7, text: "line 7" },
      ],
    },
  ],
};

const diff: DiffPayload = {
  vcs: "jj",
  revset: "@",
  cwd: "/repo",
  files: [sampleFile],
};

describe("extractContext", () => {
  it("pulls a single right-side line with 3 lines of leading + trailing context", () => {
    const ctx = extractContext(sampleFile, "right", 5, 5);
    // Lines around new line 5 (index 5) with 3 lines either side.
    // CONTEXT_LINES=3 around index 5 ("new line 5"). Leading context is
    // indices 2..4, trailing is indices 6..7 (8 is out of bounds and clamped).
    assert.equal(
      ctx,
      [
        "   3   line 3",
        "   — - old line 4",
        "   4 + new line 4",
        "   5 + new line 5",
        "   6   line 6",
        "   7   line 7",
      ].join("\n"),
    );
  });

  it("returns empty string when the requested line is outside the diff", () => {
    assert.equal(extractContext(sampleFile, "right", 999, 999), "");
  });

  it("handles a multi-line right-side range", () => {
    const ctx = extractContext(sampleFile, "right", 4, 5);
    assert.ok(ctx.includes("+ new line 4"));
    assert.ok(ctx.includes("+ new line 5"));
  });
});

describe("inlineCode", () => {
  it("wraps plain text in single backticks", () => {
    assert.equal(inlineCode("src/a.ts"), "`src/a.ts`");
  });
  it("uses a longer fence and pads when the text contains backticks", () => {
    // text contains a single backtick -> fence is double-backticks, padded.
    assert.equal(inlineCode("weird`name.ts"), "`` weird`name.ts ``");
    // text contains a triple backtick -> fence grows to 4 with padding.
    assert.equal(inlineCode("a```b"), "```` a```b ````");
  });
});

describe("pickFence", () => {
  it("returns 3 backticks for code with no backticks", () => {
    assert.equal(pickFence("hello world"), "```");
  });
  it("returns N+1 backticks for code containing N consecutive backticks", () => {
    assert.equal(pickFence("foo `bar` baz"), "```");
    assert.equal(pickFence("```"), "````");
    assert.equal(pickFence("`````"), "``````");
  });
});

describe("formatPayload", () => {
  it("returns null when there is nothing to send", () => {
    const payload: SubmitPayload = { summary: "  ", comments: [] };
    assert.equal(formatPayload(payload, diff), null);
  });

  it("renders summary + a numbered line comment + a file comment", () => {
    const payload: SubmitPayload = {
      summary: "Overall: looks fine.",
      comments: [
        {
          kind: "line",
          filePath: "src/a.ts",
          side: "right",
          startLine: 5,
          endLine: 5,
          body: "Why is this added?",
        },
        {
          kind: "file",
          filePath: "src/a.ts",
          body: "Consider splitting this file.",
        },
      ],
    };

    const out = formatPayload(payload, diff);
    assert.ok(out !== null);
    assert.ok(out.startsWith("# Code review"));
    assert.ok(out.includes("Overall: looks fine."));
    assert.ok(out.includes("## 1. (`src/a.ts` new line 5) Feedback on:"));
    assert.ok(out.includes("> Why is this added?"));
    assert.ok(out.includes("## 2. (`src/a.ts`) File-level feedback:"));
    assert.ok(out.includes("> Consider splitting this file."));
  });

  it("renders multi-line range heading as 'lines X-Y'", () => {
    const payload: SubmitPayload = {
      comments: [
        {
          kind: "line",
          filePath: "src/a.ts",
          side: "right",
          startLine: 4,
          endLine: 5,
          body: "Two lines",
        },
      ],
    };
    const out = formatPayload(payload, diff);
    assert.ok(out !== null);
    assert.ok(out.includes("## 1. (`src/a.ts` new lines 4-5) Feedback on:"));
  });

  it("uses a longer fence when the embedded code already contains triple backticks", () => {
    // The diff fixture only contains short text, so we add a comment to a line
    // whose text was replaced with backticks. Construct a one-off DiffPayload.
    const tickFile = {
      ...sampleFile,
      hunks: [
        {
          ...sampleFile.hunks[0],
          lines: sampleFile.hunks[0].lines.map((l, i) =>
            i === 5 ? { ...l, text: "const md = `prefix ``` infix ``` suffix`;" } : l,
          ),
        },
      ],
    };
    const diffWithTicks = { ...diff, files: [tickFile] };
    const out = formatPayload(
      {
        comments: [
          {
            kind: "line",
            filePath: "src/a.ts",
            side: "right",
            startLine: 5,
            endLine: 5,
            body: "why",
          },
        ],
      },
      diffWithTicks,
    );
    assert.ok(out !== null);
    // Must contain a fence of at least four backticks so the inner ``` is not
    // misinterpreted as the closing fence.
    assert.match(out, /````+/);
  });

  it("escapes file paths containing backticks in headings", () => {
    const out = formatPayload(
      {
        comments: [
          { kind: "file", filePath: "src/a`b.ts", body: "file" },
          {
            kind: "line",
            filePath: "src/a`b.ts",
            side: "right",
            startLine: 1,
            endLine: 1,
            body: "line",
          },
        ],
      },
      { ...diff, files: [] },
    );
    assert.ok(out !== null);
    assert.ok(out.includes("## 1. (`` src/a`b.ts ``) File-level feedback:"));
    assert.ok(out.includes("## 2. (`` src/a`b.ts `` new line 1) Feedback on:"));
  });

  it("renders left-side selections with an 'old' label and old-side gutter", () => {
    const payload: SubmitPayload = {
      comments: [
        {
          kind: "line",
          filePath: "src/a.ts",
          side: "left",
          startLine: 4,
          endLine: 4,
          body: "why remove this?",
        },
      ],
    };
    const out = formatPayload(payload, diff);
    assert.ok(out !== null);
    assert.ok(out.includes("## 1. (`src/a.ts` old line 4) Feedback on:"));
    // Left-side rendering: the deleted line shows its old line number; added
    // rows have no old-side number, so the gutter is the em-dash placeholder.
    assert.ok(out.includes("   4 - old line 4"));
    assert.ok(out.includes("   \u2014 + new line 4"));
    assert.ok(out.includes("   \u2014 + new line 5"));
  });

  it("separates matches in different hunks with a '...' divider", () => {
    const twoHunkFile: DiffFile = {
      ...sampleFile,
      hunks: [
        sampleFile.hunks[0],
        {
          oldStart: 20,
          oldLines: 1,
          newStart: 21,
          newLines: 2,
          lines: [
            { kind: "context", oldLine: 20, newLine: 21, text: "keep" },
            { kind: "add", oldLine: null, newLine: 22, text: "added in second hunk" },
          ],
        },
      ],
    };
    const twoHunkDiff: DiffPayload = { ...diff, files: [twoHunkFile] };
    const out = formatPayload(
      {
        comments: [
          {
            kind: "line",
            filePath: "src/a.ts",
            side: "right",
            startLine: 5,
            endLine: 22,
            body: "spans hunks",
          },
        ],
      },
      twoHunkDiff,
    );
    assert.ok(out !== null);
    assert.ok(out.includes("+ new line 5"));
    assert.ok(out.includes("+ added in second hunk"));
    assert.match(out, /new line 5[\s\S]+\n\.\.\.\n[\s\S]+added in second hunk/);
  });

  it("renders a comment whose file is missing from the diff with no code block", () => {
    const out = formatPayload(
      {
        comments: [
          {
            kind: "line",
            filePath: "gone.ts",
            side: "right",
            startLine: 1,
            endLine: 1,
            body: "why",
          },
        ],
      },
      diff,
    );
    assert.ok(out !== null);
    assert.ok(out.includes("## 1. (`gone.ts` new line 1) Feedback on:"));
    assert.ok(!out.includes("```"));
    assert.ok(out.includes("> why"));
  });

  it("preserves multi-line comment bodies with > quoting", () => {
    const payload: SubmitPayload = {
      comments: [
        {
          kind: "file",
          filePath: "src/a.ts",
          body: "first\nsecond\nthird",
        },
      ],
    };
    const out = formatPayload(payload, diff);
    assert.ok(out !== null);
    assert.ok(out.includes("> first\n> second\n> third"));
  });
});
