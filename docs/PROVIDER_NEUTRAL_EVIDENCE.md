# Provider-neutral inventory evidence

This change adds optional, read-only evidence channels to the existing
`inventory-flow-vin-document-enrichment-v1` release format. It requires no new
write endpoint or database migration. Manual holds and manager dispositions
remain the app-owned records described in [Manual inventory controls](MANUAL_INVENTORY_CONTROLS.md).

## Employee experience

Staff can place/release an Inventory Flow hold independently of a CRM.
Managers can record Sold pending, Delivered, Other and the existing disposition
choices. Each imported CRM/DMS observation appears separately with its source,
freshness and comparison. Releasing an app hold does not release a source hold.
A source saying Delivered never changes the app's disposition or physical location.
Conflicting evidence prompts review while retaining the recorded disposition label.

Current complete provider holds are included in Held and excluded from No hold.
Retained positive holds remain findable but are unverified. Empty evidence does
not prove that a provider is disconnected or that a vehicle is available.
Legacy DealerMail evidence and product-rule wording remain intact when present.

Service history can contain OEM, AutoCheck and CARFAX reports. Supplied dated
service events appear with their own odometer basis and provider. Current OEM
history is preferred when available; alternate reports remain separately
reviewable. Reports may be incomplete; no events reported does not mean no
service occurred. History never marks the vehicle Ready or proves current
reconditioning. Ford date-only service timelines work without private repair-order IDs.

Remaining factory coverage accepts `warrantyCheck.carfax`, alongside the existing
AutoCheck estimate and OASIS record. The UI labels estimates, displays the captured
mileage basis and keeps each source's coverage rows separate. Missing values remain
unknown. Certification, service plans and manufacturer eligibility are separate.
Each coverage also shows calculated miles remaining when its report supplies a
numeric mileage limit and the vehicle has a known current listed mileage:
`max(0, termMiles - vehicle.mileage)`. This is shown separately from the report's
captured balance, using the current mileage basis. Unlimited mileage and missing
limits remain unknown; no limit is guessed from make, model, year or prose.
Mileage arithmetic does not determine time remaining or warranty eligibility.
CARFAX estimates can omit title or ownership restrictions; verify manufacturer
coverage before quoting. [CARFAX calculation guidance](https://support.carfax.com/article/how-was-the-warranty-coverage-calculated/).

## Normalized input contracts

Each resource record may include:

- `operationalEvidence.records`: maximum 12 unique providers; exact parent VIN,
  provider slug, public source label, ISO `capturedAt`, `dataState`, `readOnly: true`,
  `complete`, `holdState`, optional `reportedDisposition`.
- `serviceHistory.reports`: maximum 12 unique provider/label pairs; exact VIN,
  provider (`oem`, `autocheck`, `carfax`), source label, ISO capture time,
  `dataState`, `historyStatus`, and maximum 250 dated `entries` with optional
  odometer/unit and bounded mechanical-service descriptions.
- `warrantyCheck.carfax`: supplied in-service date/age, mileage basis and coverage
  rows using the existing warranty-check fields. A CARFAX-only check is valid.

Freshness is `current`, `stale_unverified`, `incomplete` or `unknown`.
A not-observed hold requires a current complete observation. Service dates are
strict calendar dates; units are never guessed. Each service description must
match a complete allowed mechanical phrase, such as `Engine mounts replaced`,
`Front brake pads replaced`, `Oil and filter changed`, or a supported inspection
label. Known component/action phrases, scheduled mileage service and oil-grade
facts remain intact. A synthetic prefix uses the same phrase grammar. Names,
approval/attribution suffixes, addresses, mixed narratives and unsupported
phrases are rejected in full, even when they contain a recognized service.
Adapters must emit individual documented mechanical facts in the `services`
array, never copy free-form comments or strip a narrative until it matches.
New description vocabulary requires an explicit grammar addition and regression
coverage. Strict import and Worker release validation reject unsupported
descriptions; optional publishing drops an unsafe service-history channel
instead of retaining part of its narrative. Employee reads of previously stored
history quarantine each complete unsupported description using the same grammar,
while retaining validated dates, odometers, provenance and approved descriptions.
A dated entry may therefore have an empty `services` array in the employee
projection; no substitute service is inferred. A current report with quarantined
descriptions becomes incomplete, while stale or unknown reports retain their
freshness. Structural, identity, typed-value and bound violations still fail
closed, and unsupported fields remain rejected.

The Node importer and Worker share the optional-channel validators and retain
provenance verification. `operationalEvidenceCount` and `serviceHistoryCount`
count VIN resources with nonempty channels and are omitted when zero. Existing
integration/customer-field restrictions and role redaction remain in place.

## Connection and release boundary

The existing vAuto AutoCheck capture also extracts recognized dated mechanical
service entries from the report's Event Date / Details tables. It emits only
canonical service descriptions; ambiguous narratives, private text, count-only
summaries and undated rows do not become service events. The enrichment merge
preserves other providers' history and marks the collector's unrefreshed history
stale. This path was verified with synthetic report fixtures and mocked browser
capture, without running a live collector.

Generic CRM/DMS and CARFAX support provides normalized ingestion and
presentation; their live vendor adapters are not implemented by this change.
No CARFAX/AutoCheck API account, licensing agreement, crawler, CRM/DMS connector,
collector task or feed activation is created. The current release envelope still
uses its existing source types and store/membership boundaries; arbitrary-dealer
source collection needs a separately implemented and verified adapter.

Brighton Ford's public vehicle detail page was inspected on October 8, 2026. A
CARFAX link opened a device-verification screen, so actual report parsing could
not be verified. No challenge was bypassed, and no live report/VIN fixture was
committed. Test records and browser demonstrations are synthetic.

Mission Ford of Dearborn's public CARFAX link was also inspected on that date.
Its report rendered dated service rows with Date, Mileage, Source and Comments
columns, plus a Basic Warranty / Original warranty estimate. Its expandable
warranty disclosure also showed Basic Warranty, Corrosion and Emissions
categories with status fields, but no remaining-month or remaining-mile fields
in that disclosure. Each supplied category is retained; absent balances stay
unknown. This confirmed the available field types. The browser connection
failed during DOM inspection, so
no automatic CARFAX parser was added or claimed as verified. No report token,
live report or VIN was committed. CARFAX ingestion still requires a separately
verified, permitted collector or adapter supplying the normalized contract.
