# project-initialiser

A Claude Code plugin that gives you per-repo control over which MCP servers and skills are active, with macOS Keychain or 1Password for secret injection.

## What problem does this solve

Out of the box, Claude Code loads every user-scope MCP server and skill in every repo, and MCPs needing tokens force you to either keep `.env` files everywhere or set tokens as global env vars. This plugin lets you:

- Pick a subset of your globally-configured MCPs to enable per repo.
- Pick a subset of your globally-installed skills to enable per repo.
- Store API tokens in the macOS Keychain or reference them in 1Password — no plain-text tokens on disk, no global env-var soup.

## How it works

1. A `SessionStart` hook detects whether the current repo has been initialised. If not, it nudges Claude to suggest `/init-repo`.
2. `/init-repo` runs a wizard: pick MCPs, pick skills, configure backend per secret. It writes:
   - `.mcp.json` — only the chosen MCPs, with `command`/`args` rewritten to invoke MCPs through the secrets helper.
   - `.claude/settings.json` — `enabledMcpjsonServers` listing chosen MCPs, `skillOverrides` setting unselected skills to `"off"`.
   - `.claude/.project-initialiser.json` — manifest of secret references (keychain account names or `op://` URIs — never values). Gitignored by default.
3. When an MCP starts, the helper looks up secrets from the chosen backend, exports them as env vars, and execs the underlying MCP command.

## Install (personal, single machine)

```sh
git clone https://github.com/cpether/project-initialiser ~/.claude/plugins/project-initialiser
```

Then in Claude Code:

```
/plugin
```

…and add the local path. Or, in `~/.claude/settings.json`:

```json
{
  "plugins": ["~/.claude/plugins/project-initialiser"]
}
```

(Adjust to whatever plugin install mechanism your Claude Code version supports.)

For 1Password support, install the [1Password CLI](https://developer.1password.com/docs/cli/get-started/) and sign in (`op signin`). Keychain works out of the box on macOS.

## Usage

In any git repo:

```
/init-repo
```

Walks you through MCP/skill selection and secret setup. After it finishes, restart Claude Code in that repo — the new `.mcp.json` takes effect on the next session.

```
/manage-repo
```

Edit your existing selections or rotate a secret.

```
/add-secret GITHUB_TOKEN
```

Add a single secret without re-running the full wizard.

## CLI reference

```sh
claude-secrets discover                                # list user-scope MCPs and skills
claude-secrets set <NAME> [--backend keychain|op]      # store a secret reference
                [--ref op://...] [--isolate] [--value VAL]
claude-secrets get <NAME>                              # print secret to stdout (used internally)
claude-secrets list                                    # secrets configured in current repo
claude-secrets rm <NAME>                               # remove a secret
claude-secrets exec <NAME>... -- <cmd> [args]          # run cmd with secrets in env
```

`set` for the keychain backend prompts for the value securely. The value never reaches Claude's chat transcript. `set` for 1Password records the `op://` reference only.

## Secret backends

### macOS Keychain

Default. Stored under service `claude-code-secrets` (shared) or `claude-code-secrets:<repo-hash>` (with `--isolate`). Use isolation when you want a different token in this repo than in others using the same secret name.

### 1Password (`op`)

Records an `op://vault/item/field` reference in the manifest. At MCP startup, the helper resolves it via `op read`. Requires the `op` CLI signed in for your shell session.

## Generated `.mcp.json` example

```json
{
  "mcpServers": {
    "github": {
      "type": "stdio",
      "command": "/Users/me/.claude/plugins/project-initialiser/bin/claude-secrets",
      "args": ["exec", "GITHUB_TOKEN", "--", "npx", "-y", "@modelcontextprotocol/server-github"]
    }
  }
}
```

The MCP command is unchanged — it just runs through the helper, which injects `GITHUB_TOKEN` from the configured backend.

## Limitations

- macOS only (Keychain backend); 1Password backend works anywhere `op` runs.
- HTTP-type MCPs aren't wrapped — the helper only injects env vars for stdio MCPs.
- The `SessionStart` hook can't run an interactive wizard itself (Claude Code hooks are non-interactive). The wizard runs as a slash command instead.
- Plugin-installed skills aren't yet enumerated — only `~/.claude/skills/`.

## Manifest format

`.claude/.project-initialiser.json`:

```json
{
  "version": 1,
  "mcps":   ["github", "linear"],
  "skills": ["claude-api"],
  "secrets": {
    "GITHUB_TOKEN":   { "backend": "keychain", "service": "claude-code-secrets", "account": "GITHUB_TOKEN" },
    "LINEAR_API_KEY": { "backend": "op", "ref": "op://Personal/Linear/credential" }
  }
}
```

No secret values are ever stored in this file.
