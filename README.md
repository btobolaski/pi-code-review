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

Pi prints the URL of the local review server and tries to open your default browser. Leave comments, write an optional
overall summary, click **Submit review**, and the formatted markdown lands in the next agent turn.

## How it works

1. The command handler walks up from the working directory to find `.jj/` or `.git/` (jj wins when both exist).
2. It runs `jj diff --git -r <revset>` or `git diff <ref>` and parses the unified diff with
   [`parse-diff`](https://www.npmjs.com/package/parse-diff).
3. It starts a `node:http` server on `127.0.0.1` (random port, or `PI_CODE_REVIEW_PORT` if set) and serves the built
   `web/` SPA at `/`, plus three API routes: `GET /api/diff`, `POST /api/submit`, `POST /api/cancel`.
4. On submit, comments are formatted into a single markdown follow-up message and sent via
   `pi.sendUserMessage(..., { deliverAs: "followUp" })`.

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
- Zero comments and empty summary — nothing is sent to the agent.
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

Coverage:

- `extension/src/__test__/format.test.ts` — markdown formatter + context extraction + fence selection
- `extension/src/__test__/diff.test.ts` — unified-diff parsing + VCS detection
- `extension/src/__test__/server.test.ts` — HTTP server + submit-payload validation
- `web/src/__test__/selection.test.ts` — side-aware line-selection helpers
