# AI collaboration and shared data

## What GitHub shares

Use a **private GitHub repository** for source code, tests, schemas, vector brand assets, documentation, and the marked synthetic fixture. A private repository is still not an approved storage location for dealership or customer data.

GitHub does not share the running application's saved state. It will not copy the local SQLite ledger, daily report snapshots, DealerMail holds, comments, alerts, cookies, or customer details to another computer or AI.

| Connection | Source code | Synthetic demo | Live report data | Saved transfers |
| --- | --- | --- | --- | --- |
| Private GitHub repository | Yes | Yes | No | No |
| Claude Code in a local checkout | Yes | Yes | Only if explicitly run on the authorized host | Only that host's ignored local SQLite file |
| Claude Desktop with a GitHub connection | Repository context only | Repository context only | No | No |
| Future authenticated Inventory Flow service | Deployed build | Optional | Role-filtered read-only imports | Shared central ledger |

## Recommended Claude workflow

### Claude Code

Claude Code is the simplest option for implementation because it can work in a repository checkout and run the validation commands. On an Apple Silicon Mac, install the native Node.js 24 build, then use Terminal:

```bash
git clone <private-repository-url>
cd inventory-ops
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

## Saved data: current and future behavior

The prototype currently has two state families:

1. Daily public-inventory and DealerMail snapshots imported read-only from the protected report workspace.
2. Inventory Flow's own transfer requests and custody events stored in the host-local `runtime/inventory-ops.sqlite`.

Neither belongs in Git, and SQLite files cannot be safely merged through pull requests. Copying the database between agents would also copy operational and potentially role-restricted information.

For multiple stores, people, and AI tools to see the same saved state, deploy one authenticated Inventory Flow API backed by a central managed database. Browsers and authorized agents should call that API; they should not receive direct database credentials. The service must enforce identity, store/role authorization, row-level redaction, encryption, backups, and an append-only audit history. See [Shared-data architecture](SHARED_DATA_ARCHITECTURE.md).

Until that service exists:

- same-machine authorized sessions may use the existing local app and local ledger;
- remote humans and AI agents use the synthetic fixture and tests;
- branches and pull requests share code changes only;
- the real daily source release and saved transfer ledger remain on the dealership-controlled host.

## Repository safety gate

Run these commands before the first push and every pull request:

```bash
pnpm check:repo-safety
pnpm check
```

The gate verifies that trackable files do not include:

- `runtime/`, `data/`, `work/`, `outputs/`, exports, SQLite, logs, spreadsheets, HAR files, or bulk-data files;
- `.env` files or common literal credential formats;
- unreviewed raster captures, which can silently contain live VINs or hold/customer details;
- fixture files without `SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS`.

Keep code-based design guidance and reviewed vector assets. Generate visual-regression screenshots from `pnpm dev:demo`; store CI screenshots as short-lived build artifacts rather than committing them by default.

## What a remote AI cannot verify

A remote repository agent cannot truthfully verify current dealership inventory, current DealerMail holds, cookies/authentication, production Cloudflare Access, real vehicle document links, or the contents of the local operational ledger. Its valid evidence is the source, tests, synthetic fixture, build, and synthetic browser QA. Any live-source or production claim requires a separate authorized verification on the controlled host.
