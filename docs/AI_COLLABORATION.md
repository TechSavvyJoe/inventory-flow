# AI collaboration and shared data

## What GitHub shares

Use a **private GitHub repository** for source code, tests, schemas, vector brand assets, documentation, and the marked synthetic fixture. A private repository is still not an approved storage location for dealership or customer data.

GitHub does not share the running application's saved state. It will not copy the local SQLite ledger, daily report snapshots, DealerMail holds, comments, alerts, cookies, or customer details to another computer or AI.

| Connection | Source code | Synthetic demo | Live report data | Saved transfers |
| --- | --- | --- | --- | --- |
| Private GitHub repository | Yes | Yes | No | No |
| Claude Code in a local checkout | Yes | Yes | Only if explicitly run on the authorized host | Only that host's ignored local SQLite file |
| Claude Desktop with a GitHub connection | Repository context only | Repository context only | No | No |
| Authenticated Cloudflare Inventory Flow service | Deployed build | Separate local demo | Role-filtered read-only imports | Shared D1 ledger |

## Recommended Claude workflow

### Claude Code

Claude Code is the simplest option for implementation because it can work in a repository checkout and run the validation commands. On an Apple Silicon Mac, install the native Node.js 24 build, then use Terminal:

```bash
git clone https://github.com/TechSavvyJoe/inventory-flow.git
cd inventory-flow
node --version
npm install --global pnpm@11.19.0
pnpm install --frozen-lockfile
npm install --global @anthropic-ai/claude-code
claude doctor
claude
```

Inside Claude Code, start the safe app when browser QA is needed:

```bash
pnpm dev:demo
```

Do not use `sudo` for the Claude Code npm installation. Open a branch for each task, run `pnpm check`, and submit a pull request. `CLAUDE.md` provides the standing product and safety rules. Anthropic's current setup reference is [Set up Claude Code](https://docs.anthropic.com/en/docs/claude-code/getting-started).

### Claude Desktop

Claude Desktop needs an explicit supported connection; the existence of a GitHub repository alone does not grant it files or a terminal.

- Connect the private repository through Claude Desktop's supported GitHub integration when you want repository review or discussion.
- For code changes, launch Claude Code from the cloned `inventory-ops` folder, or use Claude Desktop's supported local-code/open-folder integration if it is available in that installation. Select only this repository checkout.
- Do not grant a filesystem tool the parent report workspace, browser profile, `work/`, `outputs/`, `data/`, or `runtime/` folders.
- Do not paste live DealerMail pages, cookies, customer notes, or SQLite exports into a Claude conversation.

The repository-safe command for either tool is `pnpm dev:demo`. On the M1 Mac it opens at `http://127.0.0.1:4173` and serves eight fabricated vehicles plus a small fabricated movement queue without touching live sources. The Mac cannot see the Windows host's current data or saved transfers merely by cloning the repository.

## Saved data: hosted and local behavior

The application has two state families:

1. Daily public-inventory and DealerMail snapshots imported read-only from the protected report workspace.
2. Inventory Flow's requests, alert actions, and custody events stored centrally in Cloudflare D1. The original host-local SQLite ledger is retained for recovery after the one-time migration, not as an active second ledger.

Neither belongs in Git, and SQLite files cannot be safely merged through pull requests. Copying the database between agents would also copy operational and potentially role-restricted information.

Approved people use the same Access-protected hosted app on their PC, Mac, or phone. The Worker enforces identity and server-owned membership, role filtering, same-origin writes, idempotency, and atomic audited D1 changes. Source evidence is separately encrypted in a private R2 bucket. See [Shared-data architecture](SHARED_DATA_ARCHITECTURE.md) and the [Cloudflare runbook](CLOUDFLARE_PRIVATE_RELEASE_RUNBOOK.md).

Collaboration boundaries:

- authorized humans use the hosted app for shared real state;
- repository agents use the synthetic fixture and tests; cloud access is not granted by GitHub access;
- branches and pull requests share code changes only;
- the work PC still collects and validates daily sources, then publishes them through its separately scoped machine identity;
- the separate read-only API/MCP service has its own scopes and credentials; Git access does not grant data access. Its live activation is currently blocked by Cloudflare CPU limits, and customer/private fields remain excluded. See [Shared data API](SHARED_DATA_API.md) for exact coverage and activation status.

## Repository safety gate

Run these commands before the first push and every pull request:

```bash
pnpm check:repo-safety
pnpm check
```

The gate verifies that trackable files do not include:

- `runtime/`, `data/`, `work/`, `outputs/`, exports, SQLite, logs, spreadsheets, HAR files, or bulk-data files;
- `.env` files or common literal credential formats;
- a `package-lock.json` or `yarn.lock` (only `pnpm-lock.yaml` is tracked; a stray lockfile builds a different dependency tree);
- unreviewed raster captures (png/jpg/jpeg/webp/heic/gif) anywhere outside the reviewed brand/demo asset directories (`public/{brand-kit,brands,resource-brands,demo-vehicles,demo-documents}/`, `extension/{icons,brands,resource-brands}/`) — a raster anywhere else, including the repo root, `docs/`, or `.agents/`, can silently carry a live VIN, hold detail, or an authenticated-page capture;
- fixture files without `SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS`.

`.agents/` (per-session agent transcripts) is gitignored and never tracked. Keep code-based design guidance and reviewed vector assets. Generate visual-regression screenshots from `pnpm dev:demo`; store CI screenshots as short-lived build artifacts rather than committing them by default.

## What a remote AI cannot verify

A remote repository agent cannot truthfully verify current dealership inventory, current DealerMail holds, cookies/authentication, production Cloudflare Access, real vehicle document links, or the contents of the local operational ledger. Its valid evidence is the source, tests, synthetic fixture, build, and synthetic browser QA. Any live-source or production claim requires a separate authorized verification on the controlled host.
