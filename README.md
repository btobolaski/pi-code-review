# pi-code-review

A [pi](https://pi.earendil.works) extension that opens the working-copy diff in a browser, lets you leave per-line,
multi-line, file-level, and overall comments — like the GitHub PR review page — and forwards the result back to the
agent as the next user message.

## Layout

```
extension/   Pi extension (node:http server + diff acquisition + payload formatting)
web/         Vite + Preact UI served by the extension
```

The extension serves the **built** frontend assets from `web/dist/`, so the frontend must be built before running
`/code-review`.

## Setup

```bash
nix develop          # or install Node 22 + pnpm yourself
pnpm install
pnpm --filter web build
```

## Usage

### Pi

Point pi at the extension once:

```bash
pi -e ./extension/index.ts
```

Or, for repeated use, drop the extension in a Pi-discovered location (see `~/.pi/agent/extensions/README.md`).

Inside an interactive Pi session:

```
/code-review              # default revset: jj `@`, git `HEAD`
/code-review @-           # jj: parent of the working copy
/code-review main..@      # git: range
```

### Claude Code

Install the `/code-review` slash command into `~/.claude/commands/`:

```bash
bash scripts/install-claude.sh             # install
bash scripts/install-claude.sh --uninstall # remove
```

The installer renders the command file with absolute paths into this checkout, so re-run it after moving or
re-cloning the repo. Override the destination with `CLAUDE_COMMANDS_DIR=/path/to/commands` if you want a
project-scoped install instead of the global one.

Then, from any jj/git working copy:

```
/code-review              # default revset
/code-review @-           # jj parent
/code-review main..@      # git range
```

Under the hood the slash command invokes `extension/cli.ts`, which is host-agnostic: it acquires the diff,
starts the same local review server, blocks on submit/cancel, and prints the formatted markdown to stdout.
Claude Code's `!`-substitution then sends that stdout as your next user message. On cancel or an empty review
the script emits a `_(... — disregard this turn)_` sentinel so Claude knows no follow-up was requested.

Pi prints the URL of the local review server and tries to open your default browser. Leave comments, write an optional
overall summary, then click **Submit review** to send the formatted markdown to the next agent turn, or **Discard** to
cancel the review without sending a follow-up message. After either action, the review tab shows a short confirmation
message and tries to close itself after 3 seconds. The review sidebar groups changed files into a directory tree, uses
`+`, `-`, and `~` glyphs for added, deleted, and modified/renamed files, and keeps the active file highlight synced to
the file currently pinned at the top of the review pane. Clicking a file header collapses or expands that file's diff
while leaving any file-level comments visible, except while a line-comment composer or line-comment edit is open, and
clicking the same file in the sidebar always re-expands it and scrolls it into view. When the active file changes while
you scroll, the sidebar scrolls just enough to keep that row visible.

## How it works

1. The command handler walks up from the working directory to find `.jj/` or `.git/` (jj wins when both exist).
2. It runs `jj diff --git -r <revset>` or `git diff <ref>` and parses the unified diff with
   [`parse-diff`](https://www.npmjs.com/package/parse-diff).
3. It starts a `node:http` server on `127.0.0.1` (random port, or `PI_CODE_REVIEW_PORT` if set) and serves the built
   `web/` SPA at `/`, plus three API routes: `GET /api/diff`, `POST /api/submit`, `POST /api/cancel`.
4. On submit, comments are formatted into a single markdown follow-up message. Pi delivers it via
   `pi.sendUserMessage(..., { deliverAs: "followUp" })`; the Claude Code path prints the same markdown to
   stdout, which the slash command's `!`-substitution turns into the next user message.

The submit payload looks like:

```ts
type SubmitPayload = {
  summary?: string;
  comments: Array<
    | { kind: "line"; filePath: string; side: "left" | "right"; startLine: number; endLine: number; body: string }
    | { kind: "file"; filePath: string; body: string }
  >;
};
```

Submitted markdown looks like:

````
# Code review

Overall: looks fine.

---

## 1. (`src/a.ts` new line 5) Feedback on:

```
   3   line 3
   — - old line 4
   4 + new line 4
   5 + new line 5
   6   line 6
   7   line 7
```

> Why is this added?

## 2. (`src/a.ts`) File-level feedback:

> Consider splitting this file.
````

The code-block fence grows automatically so embedded triple-backticks don't break the framing.

## Edge cases

- `web/dist/` missing — the command short-circuits with an error pointing at the build command. The HTTP server is never
  started.
- No changes for the chosen revset — the command notifies and exits.
- Submit review stays disabled until you add at least one comment or a non-empty overall summary. If an empty payload
  somehow still reaches the extension, nothing is sent to the agent.
- Browser closed without submitting — `beforeunload` fires `/api/cancel`, the extension stops waiting, no agent message.
- Non-interactive Pi mode (`-p`) — command short-circuits with a notice.

## Development

Run the Vite dev server (HMR) alongside the extension:

```bash
PI_CODE_REVIEW_PORT=8765 pi -e ./extension/index.ts   # terminal 1
PI_CODE_REVIEW_PORT=8765 pnpm --filter web dev        # terminal 2
```

Then trigger `/code-review` in Pi; the extension binds to port 8765 and the Vite dev server (on 5173) proxies `/api/*`
to it. Open `http://localhost:5173` instead of the URL Pi prints.

The extension still checks for `web/dist/index.html` before starting the server, so run `pnpm --filter web build` at
least once (a previous build is fine) before launching `/code-review`.

## Tests

```bash
pnpm test          # runs both workspace test suites
```

For fuller local verification, also run:

```bash
pnpm typecheck
pnpm --filter web build
```

Coverage:

- `extension/src/__test__/command.test.ts` — `/code-review` command lifecycle, notifications, follow-up sending, and
  cleanup
- `extension/src/__test__/diff.test.ts` — unified-diff parsing + VCS detection
- `extension/src/__test__/format.test.ts` — markdown formatter + context extraction + fence selection
- `extension/src/__test__/open-browser.test.ts` — platform-specific browser launch command selection
- `extension/src/__test__/server.test.ts` — HTTP server + submit-payload validation
- `web/src/__test__/api.test.ts` — frontend API helpers for diff fetch, submit, and cancel
- `web/src/__test__/app.test.tsx` — top-level Preact review workflow
- `web/src/__test__/fileTree.test.ts` — sidebar directory-tree construction and ordering
- `web/src/__test__/lang.test.ts` — language detection for syntax highlighting
- `web/src/__test__/selection.test.ts` — side-aware line-selection helpers
