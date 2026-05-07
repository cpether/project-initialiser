---
description: View or change which MCPs, skills, and secrets are configured for this repo
allowed-tools: Bash, Read, Write, Edit, AskUserQuestion
---

Help the user inspect or modify the project-initialiser config for the current repo.

## 1. Load state

Determine the repo root with `git rev-parse --show-toplevel`. Read these files (any may be missing):

- `.claude/.project-initialiser.json` — selections + secret references
- `.mcp.json` — generated MCP config
- `.claude/settings.json` — `enabledMcpjsonServers` and `skillOverrides`

If the manifest is missing, tell the user the repo isn't initialised and suggest `/project-initialiser:init-repo`.

## 2. Show current state

Print a concise summary: enabled MCPs, enabled skills, configured secrets (name + backend only — never values).

Also run `${CLAUDE_PLUGIN_ROOT}/bin/claude-secrets list` to verify what's actually stored.

## 3. Ask what to change

Use `AskUserQuestion` with these options:

- **Add or remove MCPs** — re-pick from discovered list
- **Add or remove skills** — re-pick from discovered list
- **Rotate or change a secret** — pick which secret, then re-run set
- **Reset everything** — delete manifest + generated files, suggest `/project-initialiser:init-repo`

For add/remove MCPs or skills: discover via `claude-secrets discover`, show current selections as defaults, ask multi-select, then regenerate `.mcp.json` and `.claude/settings.json` exactly as `/project-initialiser:init-repo` step 6-7 describes.

For secret changes: ask which secret, then either remove (`claude-secrets rm <NAME>`) or re-set following the same backend flow as `/project-initialiser:init-repo` step 5.

For reset: confirm with the user, then `rm .claude/.project-initialiser.json .mcp.json` and clear `enabledMcpjsonServers`/`skillOverrides` from `.claude/settings.json`. Note: keychain entries are NOT removed automatically — tell the user how to remove them manually if they want.
