#!/usr/bin/env bash
# SessionStart hook: emit additionalContext if the current repo
# hasn't been initialised by project-initialiser yet.
set -eu

cwd="${CLAUDE_PROJECT_DIR:-$PWD}"
manifest="$cwd/.claude/.project-initialiser.json"

if [ -f "$manifest" ]; then
  exit 0
fi

# Only nudge inside git repos to avoid noise in scratch dirs.
if [ ! -d "$cwd/.git" ]; then
  exit 0
fi

cat <<'JSON'
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "This repository has not been initialised by project-initialiser. If the user wants to enable specific MCP servers, skills, and configure secrets for this repo, suggest they run the /project-initialiser:init-repo slash command. Do not run it without being asked."
  }
}
JSON
