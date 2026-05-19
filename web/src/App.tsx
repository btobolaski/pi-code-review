import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import type {
  Comment,
  DiffPayload,
  ReviewSide,
} from "../../extension/src/types";
import { cancelReview, fetchDiff, submitReview } from "./lib/api";
import { DiffView } from "./components/DiffView";
import { ReviewSummary } from "./components/ReviewSummary";

export type CommentDraft =
  | { kind: "line"; filePath: string; side: ReviewSide; startLine: number; endLine: number }
  | { kind: "file"; filePath: string };

export type StoredComment = Comment & { id: number };

let nextCommentId = 1;
const allocateCommentId = (): number => nextCommentId++;

export function App(): preact.JSX.Element {
  const [diff, setDiff] = useState<DiffPayload | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [comments, setComments] = useState<StoredComment[]>([]);
  const [summary, setSummary] = useState("");
  const [terminal, setTerminal] = useState<"active" | "submitted" | "discarded">("active");
  const [submitting, setSubmitting] = useState(false);
  // Refs are the authoritative synchronous source-of-truth for the submit /
  // terminal state. The server is first-decision-wins, so we must guarantee
  // that fast user actions (Submit immediately followed by Discard, or a tab
  // close mid-submit) can't race a cancel against an in-flight submit. The
  // state setters always go through helpers that update the ref first.
  const terminalRef = useRef<"active" | "submitted" | "discarded">("active");
  const submittingRef = useRef(false);
  const setTerminalSync = (next: "active" | "submitted" | "discarded"): void => {
    terminalRef.current = next;
    setTerminal(next);
  };
  const setSubmittingSync = (next: boolean): void => {
    submittingRef.current = next;
    setSubmitting(next);
  };

  useEffect(() => {
    fetchDiff()
      .then(setDiff)
      .catch((err) => setFatal(err instanceof Error ? err.message : String(err)));
  }, []);

  // If the user closes the tab without submitting, fire a best-effort cancel
  // so the extension stops waiting and the agent doesn't hang. Skip when a
  // submit is in flight to avoid cancelling our own review.
  useEffect(() => {
    const onBeforeUnload = (): void => {
      if (terminalRef.current === "active" && !submittingRef.current) cancelReview();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const addComment = (draft: CommentDraft, body: string): void => {
    const trimmed = body.trim();
    if (trimmed === "") return;
    const id = allocateCommentId();
    setComments((cs) => [...cs, { ...draft, body: trimmed, id }]);
  };

  const updateComment = (id: number, body: string): void => {
    const trimmed = body.trim();
    if (trimmed === "") return;
    setComments((cs) => cs.map((c) => (c.id === id ? { ...c, body: trimmed } : c)));
  };

  const deleteComment = (id: number): void => {
    setComments((cs) => cs.filter((c) => c.id !== id));
  };

  const handleSubmit = async (): Promise<void> => {
    if (submittingRef.current || terminalRef.current !== "active") return;
    setSubmittingSync(true);
    try {
      // Strip the synthetic `id` before sending; the extension only knows
      // about the wire-shape Comment.
      const stripped: Comment[] = comments.map(({ id: _id, ...rest }) => rest as Comment);
      await submitReview({ summary: summary.trim() || undefined, comments: stripped });
      setTerminalSync("submitted");
    } catch (err) {
      setFatal(`Failed to submit: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSubmittingSync(false);
    }
  };

  const handleDiscard = (): void => {
    if (terminalRef.current !== "active" || submittingRef.current) return;
    cancelReview();
    setTerminalSync("discarded");
  };

  const commentsByFile = useMemo(() => groupByFile(comments), [comments]);

  if (fatal) {
    return (
      <div class="app fatal">
        <div class="error">{fatal}</div>
      </div>
    );
  }
  if (!diff) {
    return (
      <div class="app loading">
        <div class="notice">Loading diff…</div>
      </div>
    );
  }

  if (terminal !== "active") {
    const message =
      terminal === "submitted"
        ? "Review sent to pi. You can close this tab and return to your terminal."
        : "Review discarded. Pi has been told to cancel; you can close this tab.";
    return (
      <div class="app fatal">
        <div class="notice">{message}</div>
      </div>
    );
  }

  return (
    <div class="app">
      <DiffView
        diff={diff}
        commentsByFile={commentsByFile}
        onAddComment={addComment}
        onUpdateComment={updateComment}
        onDeleteComment={deleteComment}
      />
      <ReviewSummary
        commentCount={comments.length}
        summary={summary}
        onChangeSummary={setSummary}
        onSubmit={handleSubmit}
        onDiscard={handleDiscard}
        submitting={submitting}
      />
    </div>
  );
}

function groupByFile(comments: StoredComment[]): Map<string, StoredComment[]> {
  const m = new Map<string, StoredComment[]>();
  for (const c of comments) {
    const list = m.get(c.filePath);
    if (list) list.push(c);
    else m.set(c.filePath, [c]);
  }
  return m;
}
