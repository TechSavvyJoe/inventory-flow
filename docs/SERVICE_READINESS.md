# Service workflow contract

Managers use exactly three states: **Waiting for service**, **In service**, and **Ready**. Their wire IDs remain `needs_service`, `in_service`, and `serviced` to preserve compatibility with saved history and extension clients.

Existing inventory without a service record is **Ready** as the operational baseline. This does not assert an inspection, availability for sale, delivery, or completed service. Its `readinessBasis` is `existing_inventory`; completion date, service-start date, actor, and update date remain null. Never derive a service-completion date from a listing date, warranty in-service date, or inventory age.

A verified `new_arrival` event for a current public vehicle creates a durable `vehicle_service_intake` entry in the same transaction as release publication/import. With no manager update, the vehicle is **Waiting for service** with basis `new_arrival`. The entry survives subsequent daily reports, disappearance/reappearance, and time passage. Only a manager action changes that queue state. A public source's arrival event is an intake signal, not evidence of physical custody; the existing location rules remain separate.

Manager actions append to `vehicle_service_events` and override the intake baseline. They retain permissions, matching-store checks, optimistic concurrency, idempotent retry protection, private notes, and immutable history. A manager marking Ready records a real completion date; this yields basis `manager_updated`. Reopening work clears the current start/completion dates while preserving them in history.

Historical `unknown` events are not rewritten or deleted. They display as **Waiting for service** with basis `legacy_review`, preserving the unresolved manager action. New writes cannot select `unknown`. Clients normalize a missing legacy service field to baseline Ready but normalize an explicit historic `unknown` to Waiting.

## Deployment and rollout boundary

Apply `0008_service_intake.sql` after `0007_service_readiness.sql` before deploying the new Worker. The migration adds only an intake table; it does not overwrite or backfill manager attestations. The table is populated by subsequent verified release publications. Already-running pre-migration releases without an intake record remain baseline Ready unless they have an explicit manager record; do not invent retrospective arrivals from elapsed days. Local SQLite creates this table automatically and populates it during import. No remote migrations or production writes are implied by a local code change.
