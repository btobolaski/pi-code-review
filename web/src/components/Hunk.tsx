import { Fragment } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import type {
  DiffFile,
  DiffHunk,
  ReviewSide,
} from "../../../extension/src/types";
import type { CommentDraft, StoredComment } from "../App";
import type { OpenComposer } from "./FilePane";
import { CommentBox } from "./CommentBox";
import { CommentCard } from "./CommentCard";
import { getLanguageFromPath } from "../lib/lang";
import { highlightToHtml } from "../lib/shiki";
import {
  type DragRange,
  indexBySide,
  lineHasSide,
  resolveSelection,
} from "../lib/selection";

export type HunkProps = {
  hunk: DiffHunk;
  file: DiffFile;
  fileIdx: number;
  hunkIdx: number;
  comments: ReadonlyArray<StoredComment & { kind: "line" }>;
  composer: OpenComposer | null;
  onStartNewLine: (side: ReviewSide, startLine: number, endLine: number) => void;
  onCancel: () => void;
  onSaveNew: (body: string, draft: CommentDraft) => void;
  onStartEdit: (id: number) => void;
  onSaveEdit: (id: number, body: string) => void;
  onDelete: (id: number) => void;
};

export function Hunk(props: HunkProps): preact.JSX.Element {
  const { hunk, file, fileIdx, hunkIdx, comments, composer } = props;

  const language = useMemo(() => getLanguageFromPath(file.filePath), [file.filePath]);
  const [highlighted, setHighlighted] = useState<(string | null)[]>(() =>
    hunk.lines.map(() => null),
  );
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      hunk.lines.map((line) => (line.text === "" ? null : highlightToHtml(line.text, language))),
    ).then((results) => {
      if (!cancelled) setHighlighted(results);
    });
    return () => {
      cancelled = true;
    };
  }, [hunk, language]);

  const [drag, setDrag] = useState<DragRange | null>(null);
  // Use a ref so the global mouseup listener (which closes over its initial
  // closure) always sees the latest drag value without re-binding.
  const dragRef = useRef<DragRange | null>(null);
  const suppressGutterClickRef = useRef(false);
  dragRef.current = drag;

  useEffect(() => {
    const onUp = (): void => {
      const current = dragRef.current;
      if (!current) return;
      const resolved = resolveSelection(hunk.lines, current);
      setDrag(null);
      if (resolved) {
        suppressGutterClickRef.current = true;
        props.onStartNewLine(resolved.side, resolved.startLine, resolved.endLine);
      }
    };
    // The mouseup listener is on `window` so releasing the mouse outside the
    // gutter still commits the drag. We rebind whenever `hunk.lines` or the
    // `onStartNewLine` callback identity changes so the closure stays
    // accurate; the live `drag` value is read through `dragRef` to avoid an
    // extra rebind on every drag tick.
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, [hunk.lines, props.onStartNewLine]);

  const lineIdxByOldLine = useMemo(() => indexBySide(hunk.lines, "left"), [hunk.lines]);
  const lineIdxByNewLine = useMemo(() => indexBySide(hunk.lines, "right"), [hunk.lines]);

  const inCommentSet = useMemo(() => {
    const s = new Set<number>();
    for (const c of comments) {
      const map = c.side === "left" ? lineIdxByOldLine : lineIdxByNewLine;
      for (let n = c.startLine; n <= c.endLine; n++) {
        const idx = map.get(n);
        if (idx !== undefined) s.add(idx);
      }
    }
    return s;
  }, [comments, lineIdxByOldLine, lineIdxByNewLine]);

  // Rows in the live drag selection that have a number on the chosen side.
  const selectedSet = useMemo(() => {
    if (!drag) return new Set<number>();
    const lo = Math.min(drag.startIdx, drag.endIdx);
    const hi = Math.max(drag.startIdx, drag.endIdx);
    const s = new Set<number>();
    for (let i = lo; i <= hi; i++) {
      if (lineHasSide(hunk.lines[i], drag.side)) s.add(i);
    }
    return s;
  }, [drag, hunk.lines]);

  const renderUnderLine = useMemo(() => {
    return buildUnderLineMap({
      comments,
      composer,
      hunkIdx,
      lineIdxByOldLine,
      lineIdxByNewLine,
    });
  }, [comments, composer, hunkIdx, lineIdxByOldLine, lineIdxByNewLine]);

  const onGutterMouseDown = (e: MouseEvent, idx: number, side: ReviewSide): void => {
    if (composer) return;
    if (e.button !== 0) return;
    if (!lineHasSide(hunk.lines[idx], side)) return;
    e.preventDefault();
    setDrag({ side, startIdx: idx, endIdx: idx });
  };
  const onGutterMouseEnter = (idx: number, side: ReviewSide): void => {
    const current = dragRef.current;
    if (!current || current.side !== side) return;
    // Skip rows that lack a number on the chosen side; the drag visually
    // "jumps over" them but their indices are still inside [start, end] so we
    // can pick up the line back-numbers when commit happens.
    setDrag({ side, startIdx: current.startIdx, endIdx: idx });
  };
  const onGutterClick = (side: ReviewSide, lineNumber: number): void => {
    if (composer) return;
    if (suppressGutterClickRef.current) {
      suppressGutterClickRef.current = false;
      return;
    }
    props.onStartNewLine(side, lineNumber, lineNumber);
  };

  return (
    <div class="hunk">
      <div class="hunk-header">
        @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
        {hunk.header ? ` ${hunk.header}` : null}
      </div>
      <table class="diff-table" aria-label={`Diff hunk for ${file.filePath}`}>
        <caption class="sr-only">
          Diff hunk for {file.filePath} from old line {hunk.oldStart} to new line {hunk.newStart}
        </caption>
        <thead class="sr-only">
          <tr>
            <th scope="col">Old line</th>
            <th scope="col">New line</th>
            <th scope="col">Change type</th>
            <th scope="col">Code</th>
          </tr>
        </thead>
        <tbody>
          {hunk.lines.map((line, idx) => {
            const rowClass =
              `diff-row kind-${line.kind}` +
              (selectedSet.has(idx) ? " selected" : "") +
              (inCommentSet.has(idx) && !selectedSet.has(idx) ? " in-comment" : "");
            const leftId = line.oldLine !== null ? `${fileIdx}:left:${line.oldLine}` : undefined;
            const rightId = line.newLine !== null ? `${fileIdx}:right:${line.newLine}` : undefined;
            return (
              <Fragment key={`row-${idx}`}>
                <tr class={rowClass}>
                  <td
                    class={`gutter${line.oldLine !== null ? " gutter-active" : ""}`}
                    data-line-id={leftId}
                    onMouseDown={(e) => onGutterMouseDown(e as MouseEvent, idx, "left")}
                    onMouseEnter={() => onGutterMouseEnter(idx, "left")}
                  >
                    {line.oldLine !== null ? (
                      <button
                        type="button"
                        class="gutter-button"
                        aria-label={`Comment on left line ${line.oldLine}`}
                        disabled={composer !== null}
                        onClick={() => onGutterClick("left", line.oldLine as number)}
                      >
                        {line.oldLine}
                      </button>
                    ) : (
                      ""
                    )}
                  </td>
                  <td
                    class={`gutter${line.newLine !== null ? " gutter-active" : ""}`}
                    data-line-id={rightId}
                    onMouseDown={(e) => onGutterMouseDown(e as MouseEvent, idx, "right")}
                    onMouseEnter={() => onGutterMouseEnter(idx, "right")}
                  >
                    {line.newLine !== null ? (
                      <button
                        type="button"
                        class="gutter-button"
                        aria-label={`Comment on right line ${line.newLine}`}
                        disabled={composer !== null}
                        onClick={() => onGutterClick("right", line.newLine as number)}
                      >
                        {line.newLine}
                      </button>
                    ) : (
                      ""
                    )}
                  </td>
                  <td class="diff-prefix">
                    {line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}
                  </td>
                  <td class="diff-text">
                    {highlighted[idx] ? (
                      <span dangerouslySetInnerHTML={{ __html: highlighted[idx] as string }} />
                    ) : (
                      <pre>{line.text || " "}</pre>
                    )}
                  </td>
                </tr>
                {renderUnderLine.get(idx)?.map((item) =>
                  item.kind === "comment" ? (
                    <tr class="comment-row" key={`comment-${item.id}`}>
                      <td colSpan={4}>
                        <CommentCard
                          comment={item.comment}
                          editDisabled={composer !== null}
                          onEdit={() => props.onStartEdit(item.id)}
                          onDelete={() => props.onDelete(item.id)}
                        />
                      </td>
                    </tr>
                  ) : item.kind === "edit" ? (
                    <tr class="comment-row" key={`edit-${item.id}`}>
                      <td colSpan={4}>
                        <CommentBox
                          initial={item.initial}
                          meta={item.meta}
                          onCancel={props.onCancel}
                          onSave={(body) => props.onSaveEdit(item.id, body)}
                        />
                      </td>
                    </tr>
                  ) : (
                    <tr class="comment-row" key={`new-${item.side}-${item.startLine}-${item.endLine}`}>
                      <td colSpan={4}>
                        <CommentBox
                          meta={`New comment on ${file.filePath} ${
                            item.startLine === item.endLine
                              ? `line ${item.startLine}`
                              : `lines ${item.startLine}-${item.endLine}`
                          } (${item.side})`}
                          onCancel={props.onCancel}
                          onSave={(body) =>
                            props.onSaveNew(body, {
                              kind: "line",
                              filePath: file.filePath,
                              side: item.side,
                              startLine: item.startLine,
                              endLine: item.endLine,
                            })
                          }
                        />
                      </td>
                    </tr>
                  ),
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type UnderLineItem =
  | {
      kind: "comment";
      id: number;
      comment: StoredComment & { kind: "line" };
    }
  | {
      kind: "edit";
      id: number;
      initial: string;
      meta: string;
    }
  | {
      kind: "new";
      side: ReviewSide;
      startLine: number;
      endLine: number;
    };

function buildUnderLineMap(params: {
  comments: ReadonlyArray<StoredComment & { kind: "line" }>;
  composer: OpenComposer | null;
  hunkIdx: number;
  lineIdxByOldLine: Map<number, number>;
  lineIdxByNewLine: Map<number, number>;
}): Map<number, UnderLineItem[]> {
  const out = new Map<number, UnderLineItem[]>();
  const push = (idx: number, item: UnderLineItem): void => {
    const list = out.get(idx);
    if (list) list.push(item);
    else out.set(idx, [item]);
  };

  for (const c of params.comments) {
    const map = c.side === "left" ? params.lineIdxByOldLine : params.lineIdxByNewLine;
    const anchor = map.get(c.startLine);
    if (anchor === undefined) continue;
    const editing =
      params.composer?.kind === "edit" && params.composer.commentId === c.id;
    if (editing) {
      push(anchor, {
        kind: "edit",
        id: c.id,
        initial: c.body,
        meta: `Editing comment on line ${c.startLine}`,
      });
    } else {
      push(anchor, { kind: "comment", id: c.id, comment: c });
    }
  }

  if (
    params.composer &&
    params.composer.kind === "new-line" &&
    params.composer.hunkIdx === params.hunkIdx
  ) {
    const map =
      params.composer.side === "left" ? params.lineIdxByOldLine : params.lineIdxByNewLine;
    const anchor = map.get(params.composer.startLine);
    if (anchor !== undefined) {
      push(anchor, {
        kind: "new",
        side: params.composer.side,
        startLine: params.composer.startLine,
        endLine: params.composer.endLine,
      });
    }
  }

  return out;
}
