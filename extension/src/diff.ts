import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

// parse-diff ships CommonJS with `export = parseDiff` and a merged namespace.
// The default import gives us the function; the namespace types are reached
// via the same identifier.
import parseDiff from "parse-diff";

type ParsedFile = ReturnType<typeof parseDiff>[number];
type ParsedChunk = ParsedFile["chunks"][number];
type ParsedChange = ParsedChunk["changes"][number];

import type { DiffFile, DiffFileStatus, DiffHunk, DiffLine, DiffPayload } from "./types.js";

const exec = promisify(execFile);

export type Vcs = "jj" | "git";

export type GetDiffOptions = {
  cwd: string;
  /** User-supplied revset argument, or empty/undefined for the default. */
  revset?: string;
};

export const DEFAULT_REVSET_JJ = "@";
export const DEFAULT_REVSET_GIT = "HEAD";

const MAX_BUFFER = 64 * 1024 * 1024; // 64 MB; large diffs are real-world.

/**
 * Walk up from `cwd` looking for a `.jj` or `.git` directory. Returns the VCS
 * type and the repo root (the directory that contains the marker).
 */
export function detectVcs(cwd: string): { vcs: Vcs; root: string } | null {
  let dir = resolve(cwd);
  // Stop when dirname() returns the same path (root).
  while (true) {
    if (existsSync(`${dir}/.jj`)) return { vcs: "jj", root: dir };
    if (existsSync(`${dir}/.git`)) return { vcs: "git", root: dir };
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Acquire and parse a diff against the current working directory.
 *
 * Throws an Error if no VCS is detected or the underlying command fails.
 */
export async function getDiff(options: GetDiffOptions): Promise<DiffPayload> {
  const detected = detectVcs(options.cwd);
  if (!detected) {
    throw new Error(
      `No VCS detected at ${options.cwd} (looked for .jj/ and .git/). ` +
        `Run /code-review inside a jj or git working copy.`,
    );
  }

  const revset = resolveRevset(detected.vcs, options.revset);

  const raw = await runDiff(detected.vcs, options.cwd, revset);

  return {
    vcs: detected.vcs,
    revset,
    cwd: options.cwd,
    files: parseUnifiedDiff(raw),
  };
}

/**
 * Pure helper: parse a unified-diff string and normalize into our DiffFile
 * shape. Exposed for unit tests.
 */
export function parseUnifiedDiff(raw: string): DiffFile[] {
  return normalize(parseDiff(raw));
}

/**
 * Pick the effective revset, applying the per-VCS default when no
 * user-supplied value is present. Exposed for unit tests.
 */
export function resolveRevset(vcs: Vcs, requested?: string): string {
  const trimmed = requested?.trim() ?? "";
  if (trimmed !== "") return trimmed;
  return vcs === "jj" ? DEFAULT_REVSET_JJ : DEFAULT_REVSET_GIT;
}

/**
 * Build the `{command, args}` pair used to run the VCS diff. Exposed for unit
 * tests so we don't have to spawn real `jj`/`git` to verify wiring.
 */
export function buildDiffCommand(vcs: Vcs, revset: string): { command: string; args: string[] } {
  if (vcs === "jj") {
    return { command: "jj", args: ["diff", "--git", "-r", revset] };
  }
  // git: `git diff <ref>` covers HEAD-style and two-dot ranges (`a..b`) alike.
  // Suppress colour (just in case the user has color.ui=always) and ensure
  // we get a unified diff.
  return { command: "git", args: ["--no-pager", "diff", "--no-color", revset] };
}

async function runDiff(vcs: Vcs, cwd: string, revset: string): Promise<string> {
  const { command, args } = buildDiffCommand(vcs, revset);
  const { stdout } = await exec(command, args, { cwd, maxBuffer: MAX_BUFFER });
  return stdout;
}

function normalize(files: ParsedFile[]): DiffFile[] {
  const out: DiffFile[] = [];
  for (const file of files) {
    // parse-diff sets paths to "/dev/null" for added/deleted files.
    const fromPath = pathOrNull(file.from);
    const toPath = pathOrNull(file.to);

    const status: DiffFileStatus = file.deleted
      ? "deleted"
      : file.new
        ? "added"
        : fromPath && toPath && fromPath !== toPath
          ? "renamed"
          : "modified";

    const filePath = toPath ?? fromPath ?? "(unknown)";

    const hunks: DiffHunk[] = file.chunks.map((chunk) => ({
      oldStart: chunk.oldStart,
      oldLines: chunk.oldLines,
      newStart: chunk.newStart,
      newLines: chunk.newLines,
      header: extractHunkHeader(chunk.content),
      lines: chunk.changes.map(convertChange),
    }));

    out.push({
      oldPath: fromPath,
      newPath: toPath,
      filePath,
      status,
      hunks,
    });
  }
  return out;
}

function pathOrNull(p: string | undefined): string | null {
  if (!p) return null;
  if (p === "/dev/null") return null;
  // Strip leading "a/" or "b/" that git includes by convention. parse-diff
  // sometimes leaves these in place.
  if (p.startsWith("a/") || p.startsWith("b/")) return p.slice(2);
  return p;
}

function convertChange(change: ParsedChange): DiffLine {
  // parse-diff includes the leading +/-/space in `content`. Strip it so the
  // browser renders just the source text and we render +/- in the gutter.
  const text = stripDiffPrefix(change.content);

  if (change.type === "add") {
    return { kind: "add", oldLine: null, newLine: change.ln, text };
  }
  if (change.type === "del") {
    return { kind: "del", oldLine: change.ln, newLine: null, text };
  }
  return { kind: "context", oldLine: change.ln1, newLine: change.ln2, text };
}

function stripDiffPrefix(content: string): string {
  if (content.length === 0) return content;
  const first = content.charCodeAt(0);
  // ' ' (32), '+' (43), '-' (45)
  if (first === 32 || first === 43 || first === 45) return content.slice(1);
  return content;
}

function extractHunkHeader(content: string | undefined): string | undefined {
  if (!content) return undefined;
  // chunk.content looks like "@@ -1,7 +1,8 @@ some optional function header".
  // We just return the part after the trailing "@@", or undefined if absent.
  const m = content.match(/^@@[^@]*@@\s?(.*)$/);
  return m && m[1] ? m[1] : undefined;
}
