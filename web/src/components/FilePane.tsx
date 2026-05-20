import { useState } from "preact/hooks";

import type { DiffFile, ReviewSide } from "../../../extension/src/types";
import type { CommentDraft, StoredComment } from "../App";
import { CommentBox } from "./CommentBox";
import { CommentCard } from "./CommentCard";
import { Hunk } from "./Hunk";

export type FilePaneProps = {
  file: DiffFile;
  fileIdx: number;
  anchorId: string;
  comments: StoredComment[];
  onAddComment: (draft: CommentDraft, body: string) => void;
  onUpdateComment: (id: number, body: string) => void;
  onDeleteComment: (id: number) => void;
};

/**
 * Composer state lives at the file level so the user only ever has one open
 * editor per file. `open.kind` identifies what we're composing:
 * - "new-file": a fresh file-level comment
 * - "new-line": a fresh line/range comment in some hunk
 * - "edit":     editing an existing comment by id
 */
export type OpenComposer =
  | { kind: "new-file"; filePath: string }
  | {
      kind: "new-line";
      filePath: string;
      side: ReviewSide;
      hunkIdx: number;
      startLine: number;
      endLine: number;
    }
  | { kind: "edit"; commentId: number };

export function FilePane(props: FilePaneProps): preact.JSX.Element {
  const { file, fileIdx, comments, anchorId } = props;
  const [open, setOpen] = useState<OpenComposer | null>(null);

  const fileComments = comments.filter(
    (c): c is StoredComment & { kind: "file" } => c.kind === "file",
  );
  const lineComments = comments.filter(
    (c): c is StoredComment & { kind: "line" } => c.kind === "line",
  );

  const closeComposer = (): void => setOpen(null);

  const openComposer = (next: OpenComposer): void => {
    if (open !== null) return;
    setOpen(next);
  };

  const startNewLineComposer = (
    hunkIdx: number,
    side: ReviewSide,
    startLine: number,
    endLine: number,
  ): void => {
    openComposer({
      kind: "new-line",
      filePath: file.filePath,
      hunkIdx,
      side,
      startLine,
      endLine,
    });
  };

  return (
    <section class="file" id={anchorId}>
      <header class="file-header">
        <div>
          <span class="file-header-path">{file.filePath}</span>
          <span class="file-header-status">{file.status}</span>
        </div>
        <div class="file-header-actions">
          <button
            class="btn"
            disabled={open !== null}
            onClick={() => openComposer({ kind: "new-file", filePath: file.filePath })}
          >
            💬 Comment on this file
          </button>
        </div>
      </header>

      {(fileComments.length > 0 || open?.kind === "new-file") && (
        <div class="file-comments">
          <div class="comment-list">
            {fileComments.map((c) =>
              open?.kind === "edit" && open.commentId === c.id ? (
                <CommentBox
                  key={c.id}
                  initial={c.body}
                  meta="Editing file-level comment"
                  onCancel={closeComposer}
                  onSave={(body) => {
                    props.onUpdateComment(c.id, body);
                    closeComposer();
                  }}
                />
              ) : (
                <CommentCard
                  key={c.id}
                  comment={c}
                  editDisabled={open !== null}
                  onEdit={() => openComposer({ kind: "edit", commentId: c.id })}
                  onDelete={() => props.onDeleteComment(c.id)}
                />
              ),
            )}
          </div>
          {open?.kind === "new-file" ? (
            <CommentBox
              meta={`File-level comment on ${file.filePath}`}
              onCancel={closeComposer}
              onSave={(body) => {
                props.onAddComment({ kind: "file", filePath: file.filePath }, body);
                closeComposer();
              }}
            />
          ) : null}
        </div>
      )}

      <div class={`file-diff${open !== null ? " composer-open" : ""}`}>
        {file.hunks.map((hunk, hunkIdx) => (
          <Hunk
            key={hunkIdx}
            hunk={hunk}
            file={file}
            fileIdx={fileIdx}
            hunkIdx={hunkIdx}
            comments={lineComments.filter((c) => isCommentInHunk(c, hunk))}
            composer={open}
            onStartNewLine={(side, startLine, endLine) =>
              startNewLineComposer(hunkIdx, side, startLine, endLine)
            }
            onCancel={closeComposer}
            onSaveNew={(body, draft) => {
              props.onAddComment(draft, body);
              closeComposer();
            }}
            onStartEdit={(id) => openComposer({ kind: "edit", commentId: id })}
            onSaveEdit={(id, body) => {
              props.onUpdateComment(id, body);
              closeComposer();
            }}
            onDelete={(id) => props.onDeleteComment(id)}
          />
        ))}
      </div>
    </section>
  );
}

function isCommentInHunk(
  c: StoredComment & { kind: "line" },
  hunk: { lines: ReadonlyArray<{ oldLine: number | null; newLine: number | null }> },
): boolean {
  for (const line of hunk.lines) {
    const n = c.side === "left" ? line.oldLine : line.newLine;
    if (n !== null && n >= c.startLine && n <= c.endLine) return true;
  }
  return false;
}
