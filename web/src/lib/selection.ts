import type { DiffLine, ReviewSide } from "../../../extension/src/types";

export type DragRange = { side: ReviewSide; startIdx: number; endIdx: number };

export type ResolvedSelection = {
  side: ReviewSide;
  startLine: number;
  endLine: number;
};

/**
 * Map "line number on a side" -> array index inside hunk.lines. Lines that
 * don't have a number on the requested side are simply absent from the map.
 */
export function indexBySide(lines: ReadonlyArray<DiffLine>, side: ReviewSide): Map<number, number> {
  const m = new Map<number, number>();
  lines.forEach((line, idx) => {
    const n = side === "left" ? line.oldLine : line.newLine;
    if (n !== null) m.set(n, idx);
  });
  return m;
}

/**
 * Given a drag range (inclusive [startIdx, endIdx], possibly reversed) and the
 * side chosen at mousedown, find the min/max line number on that side within
 * the range. Returns `null` if no row in the range has a number on that side
 * (which means the selection produced nothing actionable).
 */
export function resolveSelection(
  lines: ReadonlyArray<DiffLine>,
  range: DragRange,
): ResolvedSelection | null {
  const lo = Math.min(range.startIdx, range.endIdx);
  const hi = Math.max(range.startIdx, range.endIdx);
  let startLine = Number.POSITIVE_INFINITY;
  let endLine = Number.NEGATIVE_INFINITY;
  for (let i = lo; i <= hi; i++) {
    const line = lines[i];
    if (!line) continue;
    const n = range.side === "left" ? line.oldLine : line.newLine;
    if (n !== null) {
      if (n < startLine) startLine = n;
      if (n > endLine) endLine = n;
    }
  }
  if (endLine < startLine) return null;
  return { side: range.side, startLine, endLine };
}

/**
 * Return true if `line` has a number on `side`. Used to decide whether the
 * gutter for that side participates in drag selection.
 */
export function lineHasSide(line: DiffLine, side: ReviewSide): boolean {
  return side === "left" ? line.oldLine !== null : line.newLine !== null;
}
