# Service workflow contract

Managers use exactly three states: **Waiting for service**, **In service**, and **Ready**. Their wire IDs remain `needs_service`, `in_service`, and `serviced` to preserve compatibility with saved history and extension clients.

Inventory without a service record is **Waiting for service** with `readinessBasis: unconfirmed`. The queue includes vehicles awaiting a manager's confirmation; it does not claim that every unconfirmed vehicle physically requires new work. Completion date, service-start date, actor, and update date remain null. Being online for a long time, having no hold, a certified listing, or a historical warranty in-service date does not prove that current store service is complete. Never derive a service-completion date from those signals.

A verified `new_arrival` event for a current public vehicle creates a durable `vehicle_service_intake` entry in the same transaction as release publication/import. With no manager update, the vehicle is **Waiting for service** with basis `new_arrival`. The entry survives subsequent daily reports, disappearance/reappearance, and time passage. Only a manager action changes that queue state. A public source's arrival event is an intake signal, not evidence of physical custody; the existing location rules remain separate.

Manager actions append to `vehicle_service_events` and override the intake baseline. They retain permissions, matching-store checks, optimistic concurrency, idempotent retry protection, private notes, and immutable history. A manager marking Ready records a real completion date; this yields basis `manager_updated`. Reopening work clears the current start/completion dates while preserving them in history.

Historical `unknown` events are not rewritten or deleted. They display as **Waiting for service** with basis `legacy_review`, preserving the unresolved manager action. New writes cannot select `unknown`. Clients normalize both a missing service field and an explicit historic `unknown` to Waiting. `unconfirmed` and `legacy_review` describe evidence; they do not add workflow states.

The imported public listing, DealerMail hold, manager sold/delivered log, and provider reports do not currently supply an authoritative live reconditioning status. Existing manager service events are authoritative and preserved. The service never turns public availability, a clean history report, no open recalls, or a delivery signal into a completed-service claim.

## Deployment and rollout boundary

Apply `0008_service_intake.sql` after `0007_service_readiness.sql` before deploying the Worker that reads intake. The migration adds only an intake table; it does not overwrite or backfill manager attestations. The table is populated by subsequent verified release publications. Releases without intake or manager events display Waiting with unconfirmed evidence; do not invent retrospective arrivals from elapsed days. Local SQLite creates this table automatically and populates it during import. The readiness correction itself needs no migration or backfill and preserves every saved manager event. Ready totals may decrease until managers confirm the vehicles already serviced. No remote migrations or production writes are implied by a local code change.
