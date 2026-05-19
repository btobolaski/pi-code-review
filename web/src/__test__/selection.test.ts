import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import type { DiffLine } from "../../../extension/src/types";
import { indexBySide, lineHasSide, resolveSelection } from "../lib/selection";

const lines: DiffLine[] = [
  { kind: "context", oldLine: 1, newLine: 1, text: "same" },
  { kind: "del", oldLine: 2, newLine: null, text: "old" },
  { kind: "add", oldLine: null, newLine: 2, text: "new" },
  { kind: "context", oldLine: 3, newLine: 3, text: "tail" },
];

describe("indexBySide", () => {
  it("maps left-side line numbers to row indices, skipping add rows", () => {
    const m = indexBySide(lines, "left");
    assert.deepEqual(
      [...m.entries()],
      [
        [1, 0],
        [2, 1],
        [3, 3],
      ],
    );
  });

  it("maps right-side line numbers to row indices, skipping del rows", () => {
    const m = indexBySide(lines, "right");
    assert.deepEqual(
      [...m.entries()],
      [
        [1, 0],
        [2, 2],
        [3, 3],
      ],
    );
  });
});

describe("resolveSelection", () => {
  it("returns a single-line right-side selection", () => {
    const out = resolveSelection(lines, { side: "right", startIdx: 2, endIdx: 2 });
    assert.deepEqual(out, { side: "right", startLine: 2, endLine: 2 });
  });

  it("returns a single-line left-side selection on a deleted line", () => {
    const out = resolveSelection(lines, { side: "left", startIdx: 1, endIdx: 1 });
    assert.deepEqual(out, { side: "left", startLine: 2, endLine: 2 });
  });

  it("clamps a left-side drag that crossed an add row to only the left line numbers", () => {
    // Indices 1..3 cover [del(old=2), add, context(old=3)] — on the left side
    // that's lines 2 and 3.
    const out = resolveSelection(lines, { side: "left", startIdx: 1, endIdx: 3 });
    assert.deepEqual(out, { side: "left", startLine: 2, endLine: 3 });
  });

  it("returns null when no row in the range has a number on the chosen side", () => {
    // Only the add row (index 2) is selected, but side is left.
    const out = resolveSelection(lines, { side: "left", startIdx: 2, endIdx: 2 });
    assert.equal(out, null);
  });

  it("handles reversed drags (endIdx < startIdx)", () => {
    const out = resolveSelection(lines, { side: "right", startIdx: 3, endIdx: 0 });
    assert.deepEqual(out, { side: "right", startLine: 1, endLine: 3 });
  });
});

describe("lineHasSide", () => {
  it("recognises add rows as right-only", () => {
    assert.equal(lineHasSide(lines[2], "right"), true);
    assert.equal(lineHasSide(lines[2], "left"), false);
  });
  it("recognises del rows as left-only", () => {
    assert.equal(lineHasSide(lines[1], "left"), true);
    assert.equal(lineHasSide(lines[1], "right"), false);
  });
  it("recognises context rows as both", () => {
    assert.equal(lineHasSide(lines[0], "left"), true);
    assert.equal(lineHasSide(lines[0], "right"), true);
  });
});
