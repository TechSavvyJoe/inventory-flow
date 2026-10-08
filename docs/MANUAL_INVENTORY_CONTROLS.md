# Manual inventory controls

Activated with the reviewed `0015` migration and paired `72e4ca4` release;
[production evidence](RELEASE_2026_10_06.md) records verification and remaining
employee-write acceptance boundaries.
Joe requested app-owned manual holds and dispositions on October 6, 2026.
These records work without DealerMail and sit beside imported evidence.

## Employee workflow

In a vehicle's **Holds & moves** section, use **Place manual hold**. Enter
customer initials/a nickname or an operational reason, optional expected
delivery date, and notes. Salespeople can manage their own active holds at
the vehicle's home store. A home-store manager or group manager can manage
any hold in their permitted scope. Other stores and transport roles cannot
write holds. A release requires a reason; it does not release an imported CRM
hold. Expected delivery dates are planning details, not automatic expiration.

Managers can **Record disposition** or **Change disposition**: Keep, Sold
pending, Delivered, Wholesale, Transfer out, or Other. Other requires an
explanation. Delivered/Wholesale require a date; correcting either back to
Keep requires a note. Disposition permission and existing source-evidence
privacy rules are preserved. Notes do not belong in customer take-home sheets.

Inventory rows show manual holds, decisions and conflicting records on both
desktop and phone. Held includes manual holds; No hold excludes active manual
holds and keeps app dispositions independent. The **Inventory decision** filter
drills into a specific disposition or conflicting records. These filters are not an
availability promise. All continues to retain the vehicle and independent
listing, source hold, service, movement and location evidence.

The comparison describes signals, not customer identity matching. An active
manual hold absent from verified CRM hold evidence, an imported hold remaining
after manual release, or Delivered with an active hold requires review. A
matching held/not-held state does not verify the same customer, or prove sale,
physical delivery or availability. Imported data is never changed by these
controls.

## Storage, authentication and privacy

- `GET/POST /api/vehicles/:vin/manual-hold` reads/writes the app-owned ledger.
- Authenticated same-origin writes use trusted employee membership identity,
  store/role enforcement, a required idempotency key and expected version.
- `vehicle_manual_hold_events` is append-only. Every event retains its actor,
  hold owner, timestamp and version; concurrent changes are rejected.
- List/summary projections contain status, date and permission only. Customer
  labels, notes, actor names and history are returned only in authorized
  detail views. Transport detail excludes these private fields.
- Source-system endpoints remain read-only. The companion's sole write
  exception remains its employee-owned saved-list endpoint. It cannot write
  manual holds or dispositions. The integration API remains read-only and
  excludes private fields.

## Activation and rollback boundary

Migration `0015_manual_inventory_controls.sql` preserves existing disposition
events while adding Other, then creates the separate manual-hold ledger and
append-only triggers. An older hosted database remains readable; manual writes
return `MIGRATION_REQUIRED`, and Other is not offered when its storage is absent.
The isolated Node demo creates/upgrades only its own database.

Production needs a separately named authorization, D1 backup/rollback point,
reviewed migration/ledger validation, Worker release and live identity/store
checks. No migration, production task, source request or Worker deployment was
performed for this implementation. Preserve new events if rolling back the
Worker; do not replace a database with an older backup over newer employee
records. An older Worker does not display the new manual controls, so account
for those holds operationally before rolling back.

## Naming customer saved lists

First Save asks for a list name before creating any record. Use initials or a
nickname, then **Save vehicle**, or select an existing list. Cancel creates
nothing. Legacy generic Customer shortlist lists can be named in place,
preserving their vehicles. A same-named list is reused to avoid another
confusing duplicate. **Manage → Save name** remains available later. The web
and companion retain original payload/key on an interrupted save and clear
private drafts on account/access changes. Customer contacts stay in the CRM.

## Optional provider evidence

[Provider-neutral evidence](PROVIDER_NEUTRAL_EVIDENCE.md) adds independent
CRM/DMS observations without making DealerMail a prerequisite for the app-owned
controls. Imported holds, source dispositions, service history and warranty
estimates remain read-only. Source observations never mutate staff decisions.
