---
description: Add a new secret to the current repo's manifest (Keychain or 1Password)
allowed-tools: Bash, AskUserQuestion
argument-hint: [SECRET_NAME]
---

Add a single secret to the current repo without going through the full wizard.

## 1. Get the secret name

If the user passed a name as `$ARGUMENTS`, use it. Otherwise ask them via `AskUserQuestion` for the env-var name (e.g. `GITHUB_TOKEN`).

## 2. Pick a backend

Ask via `AskUserQuestion`: **Keychain (macOS)** or **1Password (op)**.

## 3a. Keychain flow

Tell the user to run, in their own terminal (not in chat):

```
${CLAUDE_PLUGIN_ROOT}/bin/claude-secrets set <NAME>
```

Add `--isolate` if they want a per-repo entry distinct from any shared one. The command will prompt securely for the value and write the manifest. Wait for them to confirm.

## 3b. 1Password flow

Ask the user for the `op://` reference. Then run yourself:

```
${CLAUDE_PLUGIN_ROOT}/bin/claude-secrets set <NAME> --backend op --ref <op://...>
```

## 4. Confirm

Run `${CLAUDE_PLUGIN_ROOT}/bin/claude-secrets list` and show the user the updated list.

Remind them that they'll need to add `<NAME>` to the relevant MCP's `args` in `.mcp.json` if it's not already there — or run `/manage-repo` to regenerate.
