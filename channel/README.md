# Heardex channel for Claude Code

Sends issues from Heardex straight into the Claude Code session you already
have open on your code. Click **Investigate with Claude** on an issue in Heardex and,
a few seconds later, the task appears in your session. Claude investigates in that
session's folder and reports back to Heardex. After you approve the plan in
Heardex, the implementation arrives the same way.

Uses Claude Code [channels](https://code.claude.com/docs/en/channels) (research preview,
Claude Code v2.1.80 or newer; Team and Enterprise organizations must enable channels).

## Setup (once per computer)

```bash
node channel/signalforge-channel.mjs login
```

This opens Heardex in your browser. Choose the workspace and approve. Tokens are stored
in `~/.config/signalforge/channel.json`, readable only by you. Revoke them any time in
Heardex → Settings → Claude → Manage connection.

For a Heardex other than the hosted one, add `--site https://your-signalforge`. Set the
same address as `SIGNALFORGE_URL` in `.mcp.json`.

## Every session

From the project folder (where `.mcp.json` is):

```bash
claude --dangerously-load-development-channels server:signalforge
```

Custom channels aren't on Claude Code's approved list during the research preview, so
the development flag is required. Claude Code asks you to confirm it.

## Options (`env` in `.mcp.json`)

| Variable | Meaning |
|---|---|
| `SIGNALFORGE_PRODUCT` | Only receive tasks for this product (its name or id). Leave it empty to receive tasks for every product. |
| `SIGNALFORGE_URL` | Heardex address (default: the hosted app). |
| `SIGNALFORGE_POLL_SECONDS` | How often to check for new tasks (default 15). |

## Other projects

To use it in another repository, copy `.mcp.json` there and use the absolute path to
`signalforge-channel.mjs` in `args`. The channel needs `@modelcontextprotocol/sdk`, which
Heardex's `node_modules` already has.
