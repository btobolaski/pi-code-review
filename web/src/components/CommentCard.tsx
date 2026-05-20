import type { StoredComment } from "../App";

export type CommentCardProps = {
  comment: StoredComment;
  onEdit: () => void;
  onDelete: () => void;
  editDisabled?: boolean;
};

export function CommentCard(props: CommentCardProps): preact.JSX.Element {
  const { comment } = props;
  const label =
    comment.kind === "file"
      ? "File-level comment"
      : comment.startLine === comment.endLine
        ? `Comment on line ${comment.startLine} (${comment.side})`
        : `Comment on lines ${comment.startLine}-${comment.endLine} (${comment.side})`;

  return (
    <div class="comment-card">
      <div class="comment-card-header">
        <span>{label}</span>
        <span>
          <button
            class="btn"
            aria-label={`Edit ${label}`}
            disabled={props.editDisabled}
            onClick={props.onEdit}
          >
            Edit
          </button>{" "}
          <button class="btn danger" aria-label={`Delete ${label}`} onClick={props.onDelete}>
            Delete
          </button>
        </span>
      </div>
      <div class="comment-card-body">{comment.body}</div>
    </div>
  );
}
