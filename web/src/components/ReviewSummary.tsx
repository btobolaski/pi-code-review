export type ReviewSummaryProps = {
  commentCount: number;
  summary: string;
  onChangeSummary: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  onDiscard: () => void;
  submitting: boolean;
};

export function ReviewSummary(props: ReviewSummaryProps): preact.JSX.Element {
  const canSubmit =
    !props.submitting && (props.commentCount > 0 || props.summary.trim() !== "");

  return (
    <div class="submit-bar">
      <textarea
        value={props.summary}
        onInput={(e) =>
          props.onChangeSummary((e.target as HTMLTextAreaElement).value)
        }
        placeholder="Overall review summary (optional). Sent as the preamble to the agent."
      />
      <div class="submit-bar-actions">
        <div class="submit-bar-status">
          {props.commentCount === 0
            ? "No comments yet"
            : props.commentCount === 1
              ? "1 comment"
              : `${props.commentCount} comments`}
        </div>
        <div class="submit-bar-buttons">
          <button class="btn" onClick={props.onDiscard} disabled={props.submitting}>
            Discard
          </button>
          <button
            class="btn primary"
            onClick={() => void props.onSubmit()}
            disabled={!canSubmit}
          >
            {props.submitting ? "Submitting…" : "Submit review"}
          </button>
        </div>
      </div>
    </div>
  );
}
