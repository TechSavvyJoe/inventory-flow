# Shared-data architecture

## Outcome

As of September 2, 2026, the private hosted implementation uses Cloudflare Workers + Access, D1 for shared workflow state, and encrypted private R2 releases. The work PC remains the source collector, not the web host. Employee access remains an explicit single-account pilot. See [Deployment and recovery runbook](CLOUDFLARE_PRIVATE_RELEASE_RUNBOOK.md) for implemented controls and uncompleted pilot checks.

GitHub should share the application, not the dealership database. The production system should have one authenticated Inventory Flow service that owns the shared operational ledger and exposes role-filtered API responses to store employees and approved tools.

```text
completed daily source release (read only)
                 |
                 v
       Inventory Flow API service
          |                |
          v                v
 central operational DB   audit/event history
          |
          v
 browsers and approved AI tools through role-filtered API responses
```

No browser or AI tool receives a database password. No Git branch contains runtime rows.

## Data ownership

### Immutable imported evidence

- normalized public inventory and its physical-store evidence;
- DealerMail inventory, holds, primary/backups, comments, alerts, and raw CDK evidence;
- document-resource metadata such as approved AutoCheck and equipment facts;
- report date, extraction state, source hashes, and stale/incomplete warnings.

Each import is keyed by source type, report date, and content hash. A failed or incomplete refresh retains the last verified source and cannot manufacture a hold release, sale, delivery, removal, or availability conclusion.

### App-owned operational state

- cross-store request and requesting-manager review;
- Home Store release decision and evidence;
- driver/porter assignment, custody, current operational location, and ETA;
- shown/not-sold/sale-pending outcomes kept separate from delivery confirmation;
- return request, return assignment, condition issues, receipt, and closure;
- attributed event history, idempotency keys, and audit timestamps.

This state is shared through the service API. It is not copied into a daily snapshot and is not merged through Git.

## Required production controls

Before centralizing live state, the deployment needs:

1. dealership identity or SSO with a stable employee identifier;
2. server-enforced store and role authorization—never trusted from browser headers;
3. row/field filtering for customer names, free-form reasons, comments, and alerts;
4. encrypted transport and encrypted database/backups;
5. append-only actor/time/source audit events for every operational change;
6. idempotency and optimistic concurrency so retries cannot duplicate actions;
7. source freshness and stale-data protections at the API boundary;
8. backup, restore, retention, monitoring, and incident procedures;
9. a separate lower-privilege machine identity for any approved AI integration.

## How shared updates should work

- The API writes one attributed event for each authorized action.
- The current transfer status is derived/materialized from the event sequence.
- Clients refresh through short polling or a secure server-sent update channel.
- Store views receive only the records and private fields their server-validated role permits.
- AI tools receive the minimum endpoint scope needed for the task; repository agents receive synthetic data only.
- External systems such as DealerMail remain read-only until a documented, approved integration exists.

## Migration sequence

1. Keep repository work on `pnpm dev:demo` and validate all workflows with synthetic state.
2. Deploy the API and managed database to a private staging environment using synthetic data.
3. Add SSO, server-side authorization, audit history, encryption, backup, and restore testing.
4. Connect the completed daily source release through a read-only import identity.
5. Pilot with one store and explicit role tests before group rollout.
6. Only after the pilot, issue narrowly scoped access for approved automation or AI tools.

The original local SQLite database is retained for recovery after initial migration. A host-local cutover marker prevents accidentally starting a second writable ledger. Synthetic in-memory development is unaffected. Local files must never be copied back over newer cloud state.
