# AGENTS.md

Project-specific guidance for agents working in `pi-code-review`.

## Project overview

This repository implements a Pi extension that opens a browser-based code review UI for the current jj/git diff and
returns the submitted review to Pi as the next follow-up user message.

The repo is a small pnpm workspace with two main packages:

- `extension/`: Pi extension backend, diff acquisition, HTTP server, payload validation, markdown formatting
- `web/`: Vite + Preact frontend for browsing diffs and composing review comments

Start with `README.md` for the user-facing workflow and expected behavior.

## Repository layout

- `extension/index.ts`: extension entrypoint that wires the command dependencies together
- `extension/src/command.ts`: `/code-review` command lifecycle and session cleanup
- `extension/src/diff.ts`: repo root detection, jj/git selection, and unified-diff parsing
- `extension/src/server.ts`: local API/static server for the review UI
- `extension/src/format.ts`: submitted review -> markdown follow-up formatting
- `extension/src/types.ts`: shared backend/frontend types
- `web/src/App.tsx`: top-level review UI state machine
- `web/src/components/`: diff rendering, selection, and comment UI
- `web/src/lib/`: small frontend helpers such as API access, selection, syntax highlighting, and language detection
- `extension/src/__test__/` and `web/src/__test__/`: test suites

## Tooling and workflow

- Use `pnpm`; the workspace is configured with `pnpm-workspace.yaml` and `packageManager: pnpm@11.1.1`.
- Useful root commands:
  - `pnpm test`
  - `pnpm typecheck`
  - `pnpm --filter web build`
  - `pnpm --filter web dev`
- `treefmt.toml` runs Prettier for Markdown and `.ts` files. `.tsx` files are not currently covered by that config.
- The extension serves built assets from `web/dist/`. Do not assume `/code-review` can run unless
  `pnpm --filter web build` has succeeded at least once.
- For local development with the Vite dev server, `PI_CODE_REVIEW_PORT` must match between the extension process and
  `pnpm --filter web dev`.

## Project conventions

- Prefer `jj` over `git` when both are available. The implementation intentionally gives `.jj` precedence.
- Import conventions differ by package:
  - `extension/` uses TypeScript ESM-style local imports with explicit `.js` specifiers
  - `web/` follows the existing Vite/Preact frontend style, which currently uses extensionless local imports
- Preserve the separation between:
  - diff acquisition/parsing (`extension/src/diff.ts`)
  - request handling and validation (`extension/src/server.ts`)
  - review markdown rendering (`extension/src/format.ts`)
  - frontend state/rendering (`web/`)
- `README.md` is the canonical user-facing documentation. If behavior changes, update it too.
- Existing comments are intentional and usually explain invariants, race handling, or test setup. Keep that style when
  adding new comments.

## Behavior constraints worth preserving

- `/code-review` should fail fast in non-interactive sessions.
- Missing `web/dist/index.html` should produce a clear build instruction instead of starting the server.
- Empty diffs should exit cleanly with a notification.
- Server-side payload validation is intentionally defensive:
  - malformed top-level payloads are rejected
  - malformed individual comment entries are ignored instead of crashing the whole submission
  - only the first submit/cancel decision wins
  - static file serving must continue guarding against path traversal
- Frontend syntax highlighting is opportunistic. Falling back to plain text is acceptable if language detection or Shiki
  setup fails.

## Testing notes

- Root tests run both workspace packages with `pnpm test`.
- Root verification commands are safest from the repo root:
  - `pnpm test`
  - `pnpm typecheck` for the extension package
  - `pnpm --filter web build` for frontend TypeScript/build verification
- If you need package-local test commands, run them from the package directory:
  - `cd extension && pnpm test`
  - `cd web && pnpm test`
- Equivalent direct commands are:
  - `extension`: `node --import tsx --test src/__test__/*.test.ts`
  - `web`: `node --import tsx --test src/__test__/*.test.ts src/__test__/*.test.tsx`
- Frontend tests use `happy-dom`. In `web/src/__test__/*.test.tsx`, `./setup-dom` must be imported first before
  `@testing-library/preact` or app modules.
- Prefer small `node:test` coverage additions near the changed behavior instead of introducing a new test framework.

## Documentation expectations for agents

When you change behavior, check whether the following need updates:

- `README.md` for user-visible workflow, setup, or edge-case changes
- inline doc comments on exported types/functions when their contract changes
- test names/descriptions when behavior shifts

For AGENTS updates, favor concrete repository facts and workflow guidance over generic coding advice.
