# Maxey Inventory Flow

A separate home-store-first inventory and cross-store vehicle-operations application for Howell, Fowlerville, Ford Detroit, and Lincoln.

The blue “M” is an internal Inventory Flow product mark, not an official Bob Maxey, Ford, or Lincoln corporate logo. The selected Home Store adds a locally bundled logo and restrained store-specific accent sourced from that store's official website; the manufacturer/store treatment never replaces the group-wide product identity.

The app reads only completed, dated public-inventory and DealerMail snapshots named by the daily run manifest. It never modifies source snapshots, DealerMail, DealerOn, or CDK. The hosted app uses Cloudflare Workers, an Access-protected API, private encrypted R2 evidence, and a shared D1 operational ledger. Local SQLite remains a development/recovery format, not the hosted app's database.

## Private hosted app

[Open Inventory Flow](https://inventory-ops.joegallant.me). Hosting no longer depends on a running PC tunnel. Access is explicitly allowlisted; employee roles and stores are enforced by the server, not selected by the browser. GitHub Pages is not used for live data.

The authorized Windows host still performs source collection and publishes only completed, validated releases. If a scan or upload fails, the hosted app retains its last verified release. See the [Cloudflare runbook](docs/CLOUDFLARE_PRIVATE_RELEASE_RUNBOOK.md) for deployment, daily publishing, security boundaries, and remaining pilot acceptance checks. Before shipping a Worker deploy, run through the [deploy checklist](docs/DEPLOY_CHECKLIST.md).

The default move workflow is deliberately simple: a salesperson requests another store's vehicle; their own store's manager checks availability with the Home Store and records one approval. There is no second in-app approval, driver/dispatch assignment, collection, or destination-arrival checklist. Sales can record the outcome or start the return; a Home Store manager records the only physical handoff that closes the move: receipt back home. Home/away/visiting/all-store views show location and time away without granting access to private transfer details. Public listings, holds, CDK, and office-processing signals remain separate read-only evidence and never establish a sale, delivery, funding, or physical custody. The earlier advanced workflow is retained for a later rollout, not required in the everyday interface; see the [phased roadmap](docs/ADVANCED_WORKFLOW_ROADMAP.md).

The inventory screen opens on the signed-in employee's Home Store, can expand to all four stores, and includes quick views for no current hold found, current holds, and vehicles being moved. Salespeople and managers can open the exact DealerMail hold owner/customer or reason, salesperson, comments, alerts, expected date, and backup records. Transport-only roles receive logistics without those customer-sensitive hold details. “No current hold found” always means confirm with the Home Store; it is not an availability promise.

Responsive layouts prioritize useful information, readable text, and reachable actions: a wide comparison table, grouped tablet rows, and compact phone cards with exact equipment highlights and available report/sticker facts. Results grow with the selected page size; filter and sort controls stay compact. Do not restore tiny text, fixed-height nested results, large empty panels, or extra approval steps to make the interface appear more feature-rich.

The Today screen turns the daily report into an action layer. It opens on the employee's Home Store, shows exact new, removed, price, mileage, website-status, stock-correction, and public-store-transfer events, and can expand to the group. Price and status changes retain before/after values. Current hold alerts, comments, and past-expected dates are surfaced as safe signals; customer-sensitive content stays in the authorized vehicle workspace. A public-feed removal is never labeled sold, delivered, released, or physically gone.

Design and implementation notes are in [Brand architecture](docs/BRAND_ARCHITECTURE.md), [Store brand assets](docs/BRAND_ASSETS.md), [Today and change center](docs/CHANGE_CENTER.md), and [Fidelity and interaction QA](docs/FIDELITY_QA.md).

## Release 1.3.0: consistent workspaces and mobile reliability

The default inventory, vehicle, move, and service screens use the established
V1 layout and shared workflow components. A session-only vehicle shortlist and
an optional service Board add useful views without changing operational rules.
Shortlists and in-memory view state clear when access changes; customer notes
are never written to browser storage.

Transient refresh failures retain the last verified workspace with a retry
action. Authentication failures clear protected data. Detail loading, temporary
failure, and missing-record states are explicit, and unsaved forms warn before
navigation. Shared app and companion tokens keep typography, colors, and touch
controls consistent across narrow phones, landscape, tablets, and desktop.

Browser acceptance uses Chromium, Firefox, and WebKit, including narrow and
iPhone/Android emulation. Physical-device and live employee acceptance remain
separate checks; see the [release validation record](docs/RELEASE_1_3_0.md).

## Release 1.2.1: focused workflows and vehicle records

Vehicle moves, Action center, inventory updates, and service prioritize the
task, responsible person, timing, and next action. Unrelated provider panels
are replaced by explicit **Vehicle details** and **Records** links.

On the site and companion, **Base MSRP** means the original
base MSRP used for registration lookup, not a calculated fee. Original sticker
pricing takes priority; an informational vAuto fallback is explicitly labeled.
Unknown currency is never assumed to be USD.

Records show compact history summaries and checks, then OASIS and warranty,
before the full sticker/equipment detail. Routine provenance and duplicate
reference pricing remain available under **Source details**. Section buttons
move within the vehicle workspace without scrolling its header out of view.

### Manager access and service accuracy

Group managers open **Control center** (`/admin`) to manage employees and review
access history. The account menu offers permission previews of the other roles;
the testing banner provides **Return to Group manager**. These are live records,
not a sandbox. See [Admin access](docs/ADMIN_ACCESS.md) for sign-in-policy and
first-administrator setup boundaries.

Missing service records are **Waiting for service**, never automatically Ready.
Managers record the real service state and completion date. Original warranty
in-service dates do not prove reconditioning completion. See
[Service readiness](docs/SERVICE_READINESS.md).

The account menu's **Download companion extension** action provides the matching
1.3.0 Chrome package. Extract it and load the folder containing `manifest.json`
through Chrome's Extensions page, or reload the existing unpacked extension
after updating its files. This is a private unpacked release, not a Chrome Web
Store automatic update. See [Companion installation](extension/README.md).

## Safe quick start for contributors and AI agents

The repository includes a deterministic synthetic release with eight fabricated vehicles, two fabricated holds, document-detail examples, and two seeded movement requests. It never reads the protected daily-report workspace.

1. Install dependencies with `pnpm install --frozen-lockfile`.
2. Start the synthetic API and web app with `pnpm dev:demo`.
3. Open `http://127.0.0.1:4173`.
4. Before handing off a change, run `pnpm check`.

The synthetic API listens on `127.0.0.1:4174`, keeps demo workflow changes in memory, and resets when it stops. Every fixture value is marked `SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS`. Local development uses a non-production demo identity; role/store preview values are not authentication.

The Node server is synthetic-demo only: it needs an explicit synthetic release loader, keeps its ledger in memory, refuses a file-backed database, and refuses to start with `NODE_ENV=production`. Production runs on the Cloudflare Worker. Use `pnpm dev:demo` (or `pnpm start:demo` to serve the production build) for development.

### Apple Silicon Mac (M1/M2/M3/M4)

Use the native Apple Silicon build of Node.js 24 and pnpm 11.19.0. From Terminal:

```bash
git clone https://github.com/TechSavvyJoe/inventory-flow.git
cd inventory-flow
node --version        # expected: v24.x
npm install --global pnpm@11.19.0
pnpm install --frozen-lockfile
pnpm dev:demo
```

Open `http://127.0.0.1:4173`; the synthetic API is at `http://127.0.0.1:4174/api/health`. No Rosetta-only dependency or Windows path is used by the demo or repository-safety scripts.

## Working with other AI tools

- [AI collaboration guide](docs/AI_COLLABORATION.md) explains private-GitHub, Claude Code, and Claude Desktop options.
- [Shared-data architecture](docs/SHARED_DATA_ARCHITECTURE.md) explains why Git shares source code but not saved operational state, and what is required for multiple people or agents to see the same transfers.
- `pnpm check:repo-safety` rejects trackable runtime databases, source caches, report artifacts, unreviewed raster captures outside the brand/demo asset directories, npm/yarn lockfiles, common credential formats, and unmarked fixtures.

## Important boundary

The hosted Worker verifies Cloudflare Access signature, issuer, audience, and expiry, then resolves an enabled employee membership in D1. It ignores browser identity claims, separates upload-only machine access from employee access, and filters private evidence by role. The Node server is synthetic-demo only; production runs on the Worker. See [ADR-001](docs/ADR-001-SERVER-OWNED-IDENTITY.md) and the [Cloudflare runbook](docs/CLOUDFLARE_PRIVATE_RELEASE_RUNBOOK.md). A working deployment is not a claim that multi-employee pilot, disaster recovery, and all UX acceptance checks are complete.
