import { useMemo, useState } from "preact/hooks";

import type { DiffPayload } from "../../../extension/src/types";
import type { CommentDraft, StoredComment } from "../App";
import { FilePane } from "./FilePane";

export type DiffViewProps = {
  diff: DiffPayload;
  commentsByFile: Map<string, StoredComment[]>;
  onAddComment: (draft: CommentDraft, body: string) => void;
  onUpdateComment: (id: number, body: string) => void;
  onDeleteComment: (id: number) => void;
};

export function DiffView(props: DiffViewProps): preact.JSX.Element {
  const { diff, commentsByFile } = props;
  const [activeFile, setActiveFile] = useState<string>(diff.files[0]?.filePath ?? "");

  const summary = useMemo(() => {
    return diff.files.map((f) => ({
      filePath: f.filePath,
      status: f.status,
      count: commentsByFile.get(f.filePath)?.length ?? 0,
    }));
  }, [diff.files, commentsByFile]);

  return (
    <>
      <nav class="sidebar">
        <div class="sidebar-heading">
          Files ({diff.files.length}) · {diff.vcs} {diff.revset}
        </div>
        {summary.map((row) => (
          <button
            key={row.filePath}
            class={`sidebar-file${row.filePath === activeFile ? " active" : ""}`}
            onClick={() => {
              setActiveFile(row.filePath);
              const el = document.getElementById(fileAnchorId(row.filePath));
              if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            <span>{row.filePath}</span>
            <span class="sidebar-file-status">
              {row.status}
              {row.count > 0 ? (
                <span class="sidebar-file-count" style="margin-left: 6px">
                  {row.count}
                </span>
              ) : null}
            </span>
          </button>
        ))}
      </nav>
      <main class="main">
        {diff.files.map((file, fileIdx) => (
          <FilePane
            key={file.filePath}
            file={file}
            fileIdx={fileIdx}
            anchorId={fileAnchorId(file.filePath)}
            comments={commentsByFile.get(file.filePath) ?? []}
            onAddComment={props.onAddComment}
            onUpdateComment={props.onUpdateComment}
            onDeleteComment={props.onDeleteComment}
          />
        ))}
      </main>
    </>
  );
}

function fileAnchorId(filePath: string): string {
  // Anchor IDs must be valid HTML ids; encode slashes etc.
  return `file-${encodeURIComponent(filePath)}`;
}
