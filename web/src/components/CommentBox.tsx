import { useEffect, useRef, useState } from "preact/hooks";

export type CommentBoxProps = {
  initial?: string;
  meta?: string;
  onSave: (body: string) => void;
  onCancel: () => void;
};

export function CommentBox(props: CommentBoxProps): preact.JSX.Element {
  const [value, setValue] = useState(props.initial ?? "");
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    taRef.current?.focus();
    // Place caret at the end for edits.
    if (taRef.current && props.initial) {
      taRef.current.selectionStart = taRef.current.selectionEnd = props.initial.length;
    }
  }, [props.initial]);

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      props.onCancel();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (value.trim() !== "") props.onSave(value);
    }
  };

  return (
    <div class="composer">
      {props.meta ? <div class="composer-meta">{props.meta}</div> : null}
      <textarea
        ref={taRef}
        value={value}
        onInput={(e) => setValue((e.target as HTMLTextAreaElement).value)}
        onKeyDown={onKeyDown}
        placeholder="Leave a comment. Press Cmd/Ctrl+Enter to save, Esc to cancel."
      />
      <div class="composer-actions">
        <button class="btn" onClick={() => props.onCancel()}>
          Cancel
        </button>
        <button
          class="btn primary"
          disabled={value.trim() === ""}
          onClick={() => props.onSave(value)}
        >
          Save
        </button>
      </div>
    </div>
  );
}
