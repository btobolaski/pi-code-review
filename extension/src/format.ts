import type {
  Comment,
  DiffFile,
  DiffLine,
  DiffPayload,
  FileComment,
  LineComment,
  ReviewSide,
  SubmitPayload,
} from "./types.js";

const CONTEXT_LINES = 3;

/**
 * Build the markdown payload that gets sent back to the agent as a follow-up
 * user message. Returns `null` if there is nothing to send (no summary and no
 * comments) so the caller can short-circuit.
 */
export function formatPayload(payload: SubmitPayload, diff: DiffPayload): string | null {
  const summary = payload.summary?.trim() ?? "";
  const comments = payload.comments ?? [];

  if (summary === "" && comments.length === 0) return null;

  const parts: string[] = [];
  parts.push("# Code review");
  parts.push("");

  if (summary !== "") {
    parts.push(summary);
    parts.push("");
    parts.push("---");
    parts.push("");
  }

  comments.forEach((comment, index) => {
    parts.push(formatComment(index + 1, comment, diff));
    parts.push("");
  });

  while (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  parts.push("");

  return parts.join("\n");
}

function formatComment(n: number, comment: Comment, diff: DiffPayload): string {
  if (comment.kind === "file") return formatFileComment(n, comment);
  return formatLineComment(n, comment, diff);
}

function formatFileComment(n: number, c: FileComment): string {
  const body = c.body.trim();
  return `## ${n}. (${inlineCode(c.filePath)}) File-level feedback:\n\n${quote(body)}`;
}

function formatLineComment(n: number, c: LineComment, diff: DiffPayload): string {
  const file = diff.files.find((f) => f.filePath === c.filePath);
  const sideLabel = c.side === "left" ? "old" : "new";
  const lineRange =
    c.startLine === c.endLine
      ? `${sideLabel} line ${c.startLine}`
      : `${sideLabel} lines ${c.startLine}-${c.endLine}`;
  const heading = `## ${n}. (${inlineCode(c.filePath)} ${lineRange}) Feedback on:`;
  const code = file ? extractContext(file, c.side, c.startLine, c.endLine) : "";
  const body = c.body.trim();

  const parts = [heading, ""];
  if (code !== "") {
    const fence = pickFence(code);
    parts.push(fence);
    parts.push(code);
    parts.push(fence);
    parts.push("");
  }
  parts.push(quote(body));
  return parts.join("\n");
}

/**
 * Wrap `text` in a CommonMark inline-code span using a backtick run long
 * enough to delimit any backticks already inside the text. A single space
 * padding is added when the text starts or ends with a backtick so the
 * surrounding fence is unambiguous.
 */
export function inlineCode(text: string): string {
  let longest = 0;
  const re = /`+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length > longest) longest = m[0].length;
  }
  const fence = "`".repeat(longest + 1);
  // Pad whenever the text contains any backtick so the boundaries are
  // unambiguous regardless of where the inner backticks sit.
  const pad = longest > 0 ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

/**
 * Pick a backtick fence long enough to contain `code` without ambiguity:
 * CommonMark requires the fence to be strictly longer than any run of
 * backticks inside the body, so we use (max run + 1), with a floor of 3.
 */
export function pickFence(code: string): string {
  let longest = 0;
  const re = /`+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    if (m[0].length > longest) longest = m[0].length;
  }
  return "`".repeat(Math.max(3, longest + 1));
}

function quote(body: string): string {
  if (body === "") return "> _(empty comment)_";
  return body
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

/**
 * Pull the diff lines that cover `[startLine, endLine]` on `side`, plus
 * CONTEXT_LINES of context before and after, from the hunk(s) that contain
 * them. Renders each line with a "<lineno> | <text>" prefix, mirroring the
 * gutter the reviewer sees in the browser. Returns "" if the comment lines
 * cannot be located (e.g. mismatched diff).
 */
export function extractContext(
  file: DiffFile,
  side: ReviewSide,
  startLine: number,
  endLine: number,
): string {
  const matches: { hunkIndex: number; lineIndex: number }[] = [];
  file.hunks.forEach((hunk, hunkIndex) => {
    hunk.lines.forEach((line, lineIndex) => {
      const n = side === "left" ? line.oldLine : line.newLine;
      if (n !== null && n >= startLine && n <= endLine) {
        matches.push({ hunkIndex, lineIndex });
      }
    });
  });

  if (matches.length === 0) return "";

  // Group matches by hunk so we never bridge hunks with phantom context.
  const byHunk = new Map<number, number[]>();
  for (const m of matches) {
    const list = byHunk.get(m.hunkIndex);
    if (list) list.push(m.lineIndex);
    else byHunk.set(m.hunkIndex, [m.lineIndex]);
  }

  const blocks: string[] = [];
  for (const [hunkIndex, lineIndices] of byHunk) {
    const hunk = file.hunks[hunkIndex];
    const minIdx = Math.max(0, Math.min(...lineIndices) - CONTEXT_LINES);
    const maxIdx = Math.min(hunk.lines.length - 1, Math.max(...lineIndices) + CONTEXT_LINES);
    const sliced = hunk.lines.slice(minIdx, maxIdx + 1);
    blocks.push(sliced.map((line) => renderLineWithGutter(line, side)).join("\n"));
  }

  return blocks.join("\n...\n");
}

function renderLineWithGutter(line: DiffLine, side: ReviewSide): string {
  const num = side === "left" ? line.oldLine : line.newLine;
  // For an "add" on the left side or "del" on the right side, the line has no
  // counterpart number — render a dash so the gutter stays aligned.
  const gutter = num === null ? "—" : String(num);
  const prefix = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
  return `${gutter.padStart(4, " ")} ${prefix} ${line.text}`;
}
