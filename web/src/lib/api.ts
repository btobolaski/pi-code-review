import type { DiffPayload, SubmitPayload } from "../../../extension/src/types";

export async function fetchDiff(): Promise<DiffPayload> {
  const res = await fetch("/api/diff");
  if (!res.ok) throw new Error(`GET /api/diff -> ${res.status}`);
  return (await res.json()) as DiffPayload;
}

export async function submitReview(payload: SubmitPayload): Promise<void> {
  const res = await fetch("/api/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`POST /api/submit -> ${res.status}`);
}

/**
 * Best-effort cancel — fires from beforeunload too, so use keepalive so the
 * request survives page teardown.
 */
export function cancelReview(): void {
  try {
    fetch("/api/cancel", {
      method: "POST",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: "{}",
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}
