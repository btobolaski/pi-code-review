// Shared types between the extension backend and the web frontend.
// The frontend imports these via a relative path through vite.

export type DiffLineKind = "add" | "del" | "context";

export type DiffLine = {
  kind: DiffLineKind;
  /** Line number on the "left" (old) side. Present for context and del. */
  oldLine: number | null;
  /** Line number on the "right" (new) side. Present for context and add. */
  newLine: number | null;
  text: string;
};

export type DiffHunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Optional hunk header text (the bit after the `@@`). */
  header?: string;
  lines: DiffLine[];
};

export type DiffFileStatus = "added" | "deleted" | "modified" | "renamed";

export type DiffFile = {
  /** Path on the "left" (old) side, or null for added files. */
  oldPath: string | null;
  /** Path on the "right" (new) side, or null for deleted files. */
  newPath: string | null;
  /** The display path — newPath when present, oldPath otherwise. */
  filePath: string;
  status: DiffFileStatus;
  hunks: DiffHunk[];
};

export type DiffPayload = {
  vcs: "jj" | "git";
  /** The argument that selected the revset (e.g. "@", "HEAD", "main..@"). */
  revset: string;
  cwd: string;
  files: DiffFile[];
};

export type ReviewSide = "left" | "right";

export type LineComment = {
  kind: "line";
  filePath: string;
  side: ReviewSide;
  startLine: number;
  endLine: number;
  body: string;
};

export type FileComment = {
  kind: "file";
  filePath: string;
  body: string;
};

export type Comment = LineComment | FileComment;

export type SubmitPayload = {
  summary?: string;
  comments: Comment[];
};
