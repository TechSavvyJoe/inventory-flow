# Perplexity Mac MCP Setup

Perplexity's Mac app currently supports local MCP servers through its helper app. Use this local bridge instead of entering the hosted Cloudflare MCP URL directly.

The bridge runs on the Mac, speaks stdio to Perplexity, and calls the secured Inventory Flow API at `https://inventory-data.joegallant.me/api/v1` with a local read-only integration token.

## Perplexity connector command

From a checkout of this repo on the Mac:

```bash
INVENTORY_FLOW_MCP_TOKEN="iflow_..." pnpm integrations:perplexity-mcp
```

If Perplexity's connector form separates command and environment variables, use:

```text
Command: pnpm
Arguments: integrations:perplexity-mcp
Environment: INVENTORY_FLOW_MCP_TOKEN=iflow_...
```

The token is the Inventory Flow integration API token. Do not paste it into a prompt, URL, browser JavaScript, or source control.

## Exposed tools

- `search_inventory`
- `get_vehicle`
- `get_inventory_changes`
- `get_data_health`
- `get_hold_summary`
- `list_manager_dispositions`
- `get_inventory_capabilities`

All tools are read-only. They cannot change Inventory Flow, DealerMail, holds, transfers, service status, source systems, or vehicle records.

## Why not the hosted `/mcp` URL?

`https://inventory-data.joegallant.me/mcp` is protected by Cloudflare Access Managed OAuth. It is still the correct path for remote MCP clients that complete that OAuth flow. Perplexity's Mac app local connector path expects a local command, and Perplexity's remote MCP support is still rolling out. The local bridge avoids disabling authentication or weakening the Cloudflare Access setup.

## Claude Code and Claude Desktop

The same local bridge works as a stdio MCP server for Claude Code and Claude Desktop, and it can read the token straight from the credential file that the owner-run integration command writes, so no MCP configuration file ever contains the secret.

1. Issue a dedicated read-only grant for Claude (owner-run, from this checkout; requires the existing Wrangler login):

   ```bash
   node scripts/manage-integration-client.mjs create --transport wrangler --confirm --owner-user-id joe-gallant --type api_token --label "Claude" --scopes "inventory.read,health.read" --stores "Howell,Fowlerville,Ford Detroit,Lincoln" --days 90 --secret-output runtime/integration-credentials/claude.json
   ```

   `runtime/` is ignored by Git and by the repository safety gate. Revoke with the `revoke` command when the grant is no longer needed.

2. Point each client at that file with `INVENTORY_FLOW_MCP_CREDENTIAL_FILE` instead of `INVENTORY_FLOW_MCP_TOKEN`:

   - Claude Code (user scope, any project):

     ```bash
     claude mcp add --transport stdio --scope user --env INVENTORY_FLOW_MCP_CREDENTIAL_FILE=/absolute/path/to/inventory-flow/runtime/integration-credentials/claude.json inventory-flow -- /absolute/path/to/node /absolute/path/to/inventory-flow/scripts/perplexity-inventory-mcp.mjs
     ```

   - Claude Desktop: add the same command, arguments and environment variable under `mcpServers.inventory-flow` in `~/Library/Application Support/Claude/claude_desktop_config.json`, then restart Claude Desktop. Use absolute paths; the desktop app does not inherit your shell `PATH`.

The bridge refuses to start with `INVENTORY_FLOW_MCP_TOKEN_EXPIRED` once the grant's `expiresAt` has passed; issue a new grant and replace the file.

The hosted `https://inventory-data.joegallant.me/mcp` endpoint remains the path for claude.ai's custom-connector flow (its OAuth registration permits only the claude.ai callback). A connector added there also appears in Claude Desktop and Claude Code as a `claude.ai` server; that flow has not yet been completed and verified.
