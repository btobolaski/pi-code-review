import { spawn } from "node:child_process";
import { platform } from "node:os";

/**
 * Best-effort cross-platform browser launcher. Returns true if we _started_
 * a child (no guarantee the browser opened). Errors are swallowed: the caller
 * already notifies the user of the URL so manual fallback works.
 */
export function openBrowser(url: string): boolean {
  try {
    const { command, args } = browserCommand(url);
    const child = spawn(command, args, {
      stdio: "ignore",
      detached: true,
    });
    child.on("error", () => {
      // Swallow — the caller surfaces the URL via ctx.ui.notify.
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/**
 * Pure command builder so we can unit-test the per-platform mapping without
 * actually spawning anything. The `p` parameter defaults to the live platform
 * but can be overridden from tests.
 */
export function browserCommand(
  url: string,
  p: NodeJS.Platform = platform(),
): { command: string; args: string[] } {
  if (p === "darwin") return { command: "open", args: [url] };
  if (p === "win32") return { command: "cmd", args: ["/c", "start", "", url] };
  // Linux + everything else: prefer xdg-open.
  return { command: "xdg-open", args: [url] };
}
