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
