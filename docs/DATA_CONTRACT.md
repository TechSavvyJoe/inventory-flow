# Daily snapshot import contract

## Commit marker

The importer considers a day releasable only through a `work/run-status/YYYY-MM-DD.json` manifest where:

- `complete` is `true`;
- `public_inventory_status` is `complete`;
- `dealermail_status` is `complete`, or the UI explicitly retains a prior DealerMail source as stale;
- `validation_results.passed` is `true`;
- exact dated source paths exist and their report dates agree.

Files with suffixes such as `-cold-start-test.json` are never run manifests.

## Public adapter

The public JSON contains a VIN-keyed `vehicles` object and four `source_statuses`. The importer validates:

- source completion and expected/fetched/unique counts;
- VIN key equals row VIN;
- VIN and stock uniqueness;
- authoritative `store` value is one of the four canonical stores;
- listing URL VIN/domain relationship;
- report date and manifest relationship.

The app labels `store` as **Source-reported physical store**. It may seed an unconfirmed Home Store baseline but never treats a scan change as an authorized permanent reassignment.

## DealerMail adapter

The importer validates the expected schema version, report date, authenticated read-only source status, set equation, row/unique counts, hold-detail endpoint success, and active primary/backup/deleted-history reconciliation.

The API derives role-safe fields. Raw source arrays, customer/reason, comments, alerts, and CDK bodies are never placed in a static web bundle.

## Idempotency and ownership

- Import key: source type + report date + SHA-256.
- Runtime writes stay under `apps/inventory-ops/runtime/`.
- Daily `work/`, `outputs/`, workbook, automation, and source systems are never written or locked.
- The app advances its current source pointer only after complete validation.
- Source failure retains the prior verified snapshot with a visible as-of time and never implies released holds, availability, sale, delivery, or return.
- Date rollover keeps the selected release’s hold details and inspection-based service readiness until a validated replacement is published. Retained holds remain in Held views as “Last verified hold”; current hold status stays unverified. Service evidence must have been complete in the selected release, and manager decisions continue to take precedence.

## App-owned data

Transfer requests, requesting-manager handoffs, attributed Home Store release responses, operational location, transport assignments, custodians, outcomes, returns, acknowledgments, and audit events are not present in the daily sources and therefore live only in the application ledger. Public, DealerOn, DealerMail, CDK, and office-processing evidence can never create those operational states automatically.
