---
description: Set up MCP servers, skills, and secrets for the current repo
allowed-tools: Bash, Read, Write, Edit, AskUserQuestion
---

You are running the project-initialiser setup wizard for the user's current repository. Walk them through it carefully. Be concise — the user wants to get to work, not read essays.

## 0. Repo root

Determine the repo root with `git rev-parse --show-toplevel`. All file paths below are relative to the repo root. If the command fails (not a git repo), tell the user this plugin only supports git repositories and stop.

## 1. Check for existing config

If `.claude/.project-initialiser.json` already exists, ask the user via `AskUserQuestion` whether they want to **edit** the existing config (load it and let them adjust selections) or **start fresh** (overwrite). If they pick edit, use the existing manifest's selections as defaults below.

## 2. Discover available MCPs and skills

Run `${CLAUDE_PLUGIN_ROOT}/bin/claude-secrets discover` and parse the JSON. It returns:

```
{
  "mcps":   [{"name", "command", "args", "env", "requiredSecrets": [...] }, ...],
  "skills": [{"name", "description"}, ...]
}
```

If both lists are empty, tell the user they need to first add MCPs at user scope (`claude mcp add -s user ...`) and/or place skills in `~/.claude/skills/`. Stop.

## 3. Pick MCPs

Use `AskUserQuestion` with `multiSelect: true` to ask which MCPs to enable in this repo. List each by name. Show at most ~12 options per question — if there are more, batch into multiple questions.

## 4. Pick skills

Same pattern, but for skills. Skills not selected will be set to `"off"` in `skillOverrides`.

## 5. Configure secrets

For each selected MCP, look at its `requiredSecrets` list. For each secret name that is NOT already present in the existing manifest's `secrets` field:

  a. Ask the user (`AskUserQuestion`) which backend to use for this secret. Options: **Keychain (macOS)** or **1Password (op)**.

  b. **If Keychain:** Tell the user to run this command in their terminal (do NOT run it yourself, do NOT ask the user to paste the value into chat):

       `${CLAUDE_PLUGIN_ROOT}/bin/claude-secrets set <SECRET_NAME>`

     If they want a per-repo isolated entry (different token in this repo than others), they should add `--isolate`. Wait for them to confirm they've done it before continuing. The `set` command writes the manifest itself, so just verify by reading `.claude/.project-initialiser.json` afterwards.

  c. **If 1Password:** Ask the user for the `op://` reference (e.g. `op://Personal/GitHub/token`). This is just a pointer, safe to record. Then run:

       `${CLAUDE_PLUGIN_ROOT}/bin/claude-secrets set <SECRET_NAME> --backend op --ref <op://...>`

     Run this yourself with the user-provided ref.

## 6. Write `.mcp.json`

Generate a `.mcp.json` at the repo root containing only the selected MCPs. For each MCP, rewrite `command`/`args` so it runs through the secrets helper IF it has `requiredSecrets`:

```json
{
  "mcpServers": {
    "<name>": {
      "type": "stdio",
      "command": "<absolute path to claude-secrets>",
      "args": ["exec", "SECRET_A", "SECRET_B", "--", "<original command>", "<original arg 1>", ...],
      "env": { ...non-secret env entries unchanged... }
    }
  }
}
```

The absolute path to `claude-secrets` is `${CLAUDE_PLUGIN_ROOT}/bin/claude-secrets` — but you must resolve that to an actual absolute filesystem path before writing it into `.mcp.json`, since `${CLAUDE_PLUGIN_ROOT}` isn't expanded inside `.mcp.json`. Get it with `echo $CLAUDE_PLUGIN_ROOT`.

For HTTP-type MCPs (those with `url` instead of `command`), do NOT wrap them — just copy them verbatim. The secrets helper only wraps stdio servers. If an HTTP MCP needs a token, tell the user this version doesn't support secret injection for HTTP MCPs and they'll need to handle it manually (or skip selecting it).

For MCPs with no `requiredSecrets`, copy them verbatim without wrapping.

## 7. Write `.claude/settings.json`

Merge into any existing `.claude/settings.json` (read first, preserve unrelated keys). Set:

- `enabledMcpjsonServers`: array of selected MCP names.
- `skillOverrides`: object mapping each unselected skill to `"off"`. Selected skills can be omitted (default = on) or set to `"on"` explicitly.

## 8. Update `.gitignore`

Append `.claude/.project-initialiser.json` to the repo's `.gitignore` if not already present (create the file if missing). The manifest contains keychain account names and op:// references — not values, but still cleaner to keep local.

## 9. Confirm

Print a short summary: which MCPs and skills are now enabled, which secrets are configured (names + backend, never values), and remind the user that the new MCPs become available next time they start Claude Code in this repo.
