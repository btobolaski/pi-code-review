#!/usr/bin/env bash
# Install (or remove) the /code-review slash command for Claude Code.
#
# The command file is rendered at install time so it carries absolute paths
# pointing at this repo's checkout. Re-run this script after moving the repo
# or after a fresh clone.
#
# Usage:
#   bash scripts/install-claude.sh             # install
#   bash scripts/install-claude.sh --uninstall # remove
#
# Honors CLAUDE_COMMANDS_DIR to override the default (~/.claude/commands).

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "$script_dir/.." && pwd)"

target_dir="${CLAUDE_COMMANDS_DIR:-$HOME/.claude/commands}"
target_file="$target_dir/code-review.md"

case "${1:-}" in
  ""|install)
    action="install"
    ;;
  --uninstall|uninstall)
    action="uninstall"
    ;;
  -h|--help|help)
    sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
  *)
    echo "Unknown argument: $1" >&2
    echo "Run with --help for usage." >&2
    exit 2
    ;;
esac

if [[ "$action" == "uninstall" ]]; then
  if [[ -f "$target_file" ]]; then
    rm "$target_file"
    echo "Removed $target_file"
  else
    echo "Nothing to remove at $target_file"
  fi
  exit 0
fi

tsx_bin="$repo_dir/extension/node_modules/.bin/tsx"
cli_ts="$repo_dir/extension/cli.ts"

if [[ ! -x "$tsx_bin" ]]; then
  echo "Missing $tsx_bin" >&2
  echo "Run \`pnpm install\` in $repo_dir first." >&2
  exit 1
fi
if [[ ! -f "$cli_ts" ]]; then
  echo "Missing $cli_ts" >&2
  exit 1
fi
# The allowed-tools field uses single-quoted YAML below; a single quote in the
# path would break the scalar. Bail out with a clear message instead of writing
# a broken file.
if [[ "$repo_dir" == *"'"* ]]; then
  echo "Repo path contains a single quote: $repo_dir" >&2
  echo "Move the checkout to a path without single quotes and retry." >&2
  exit 1
fi

mkdir -p "$target_dir"

# Render with a single-quoted heredoc (no expansion), then string-substitute the
# placeholders. This keeps the literal `$ARGUMENTS` (a Claude Code variable)
# and backticks in the body intact regardless of what is in the repo path.
template=$(cat <<'TEMPLATE'
---
description: Open the working-copy diff in a browser to leave review comments
argument-hint: "[revset]"
allowed-tools: 'Bash(__TSX_BIN__:*)'
---

The following is feedback from a code review I just submitted through a browser
UI. Treat the headings, quotes, and any code blocks as my next instructions —
work through the comments in order. If the body reads as a `_(... — disregard
this turn)_` sentinel, no follow-up is needed.

!`"__TSX_BIN__" "__CLI_TS__" $ARGUMENTS`
TEMPLATE
)

rendered="${template//__TSX_BIN__/$tsx_bin}"
rendered="${rendered//__CLI_TS__/$cli_ts}"

printf '%s\n' "$rendered" > "$target_file"

echo "Installed $target_file"
echo "Run /code-review inside Claude Code (from any project) to try it."
