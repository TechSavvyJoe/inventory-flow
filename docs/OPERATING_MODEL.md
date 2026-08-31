# Cross-store vehicle operating model

## Governing rule

**The Home Store retains inventory authority. Once a vehicle is released, the requesting-store manager retains custody accountability until the Home Store confirms its return or an authorized final disposition is explicitly completed.**

The application is the source for movement and custody—not for public listing, CRM hold, CDK/office processing, or delivery truth.

## Separate ownership concepts

- **Home Store**: store accountable for the inventory assignment and canonical listing. Initial app values are imported as unconfirmed source baselines; a permanent change requires explicit authorized manager approval.
- **Source-reported physical store**: current DealerOn `Store`/VehicleLocation result from the completed daily scan.
- **CRM Store**: DealerMail store assignment.
- **Operational location**: last location explicitly confirmed in the movement ledger.
- **Custodian**: person or team accountable between accepted handoffs.
- **Requesting Store**: store asking to receive the vehicle.
- **Relationship Store**: salesperson/store working with the customer.
- **Lead Origin**: site, phone, walk-in, or other source that created the opportunity.
- **Destination**: next approved physical location.
- **Location confidence**: Verified, Reported, Stale, Conflicting, or Unknown.

An imported store mismatch creates an exception; it never silently moves or reassigns the vehicle.

## Roles

### Salesperson

- Opens on their own store and deliberately expands to group inventory.
- Can filter public units by hold state and movement state across their store or the group.
- Can open the exact DealerMail hold customer/reason, salesperson, comments, alerts, expected date, and backup positions needed to work the inventory responsibly.
- Sends a simple customer or operational request to their own manager.
- Records the customer outcome.
- Cannot authorize Home Store release, change Home Store, or confirm delivery.

### Requesting-store manager

- Reviews the salesperson's need and priority.
- Contacts the vehicle's Home Store used-car manager to ask whether it is available and can be released.
- Records the explicit Home Store answer, including the answering manager and time; a website listing or DealerMail hold is never a substitute.
- Accepts custody responsibility.
- Owns the outcome update and return plan after arrival.

### Home-store used-car manager

- Confirms physical presence and conflicting commitments.
- Confirms released, not available, or needs more information.
- Defines the release window and any authorized exception to the standard no-sale return rule.
- Accepts the vehicle back before the movement closes.

### Transport coordinator

- For Howell requests, Stacey normally coordinates drivers after release. The salesperson will usually call Stacey to say a driver is needed.
- At other stores, the requesting manager or assigned coordinator arranges the driver.
- Records the assigned driver, pickup/arrival target, route, and return leg.
- Resolves missed pickup/arrival and transport exceptions.

### Driver

- Records checkout, arrival, odometer, fuel, keys, condition, and custody handoff.
- Sees logistics only, not unnecessary customer information.
- Cannot change hold, deal, delivery, or CDK status.

### Porter

- Is not a default transport step or routine assignment.
- May be assigned to drive only when a manager specifically requests it, then confirms pickup, transit, and arrival like an assigned driver.
- Sees only the assigned logistics work and does not gain hold, deal, delivery, or CDK authority.

### Group manager

- Oversees all stores and handles overrides, unknown locations, damage, competing requests, and overdue returns.
- Every override requires a reason and permanent audit event.

## Independent status lanes

### Request

Draft → Waiting on My Manager → Waiting on Home-Store Used-Car Manager → Released / Not Available / Needs Information / Canceled

Release is permission to move within a defined window. It is not a sale.

The two manager steps must never be collapsed into a generic **Approved** state. The requesting-store manager forwards the request; the Home Store used-car manager supplies the release decision.

### Movement and custody

At Home Store — Reported → Home Store Release Confirmed → Pickup Scheduled → Released to Custodian → In Transit → At Requesting Store — Verified → Return Required → Return Scheduled → Returning → Returned — Awaiting Receipt → Home Store Confirmed → Closed

Exception states: Authorized Other Location, Location Stale, Location Conflicting, Location Unknown, Missed ETA, Damage/Key Exception.

Only one active physical movement may control a VIN. Other interest is queued for manager resolution.

### Customer / deal

No Outcome → Appointment Scheduled → Customer Show → Still Working / Not Sold / Deal in Progress / Sold Pending / Deal Canceled

Sold Pending never closes the movement and is not delivery confirmation.

### DealerMail

No Active Hold Observed / Primary Hold / Backup Hold / Multiple Hold Records / Stale or Incomplete / Unknown

Keep the exact free-form reason and every backup record. No Active Hold Observed is not an availability claim.

### Public and DealerOn

Publicly Listed / Not Found in Complete Scan / Retained from Prior Verified Scan / Source Incomplete / Website Status Not Provided, plus the separate DealerOn flags.

### Delivery

Not Confirmed / Explicitly Confirmed / Canceled

Delivered Confirmed is always an explicit authorized event with a named actor and timestamp. It is never derived from a hold, expected date, missing listing, paperwork stage, or raw CDK code.

### CDK and office evidence

Raw CDK evidence, office processing, and paperwork completion remain separate read-only evidence. Inventory Flow assigns no finance- or office-user task, approval, or notification and does not infer release, sale, delivery, location, or closure from these signals.

## Operational workflow

1. **Discover**: salesperson searches their store first and expands to the group when needed.
2. **Confirm**: show Home Store, operational location, source location, location freshness, holds, and competing movements.
3. **Ask own manager**: the salesperson sends the vehicle, needed time, short reason, and customer-waiting flag to their own manager.
4. **Confirm with Home Store**: the requesting manager contacts the Home Store used-car manager and records the explicit release answer.
5. **Dispatch**: for Howell, the salesperson usually calls Stacey and Stacey assigns the driver and timing. Elsewhere the requesting manager or coordinator handles it. A porter appears only when a manager specifically requests that assignment.
6. **Checkout**: releasing and accepting custodians record keys, odometer, fuel, condition, and timestamp.
7. **Arrival**: destination confirms location and custody; both managers and salesperson are notified.
8. **Outcome**: salesperson/manager explicitly records shown/not sold, deal in progress, sold pending, or another operational result.
9. **Return or complete**: not-sold creates a return task owned by the requesting-store manager; Stacey normally coordinates the Howell return driver. Sold pending stays open. Only explicit Home Store receipt or explicit delivery confirmation allows the movement to close.

## Starting service levels

These should become configurable store/business-hour rules.

- Customer waiting: acknowledge in 10 minutes; decide in 20.
- Standard same-day request: acknowledge in 30 minutes; decide in 60.
- Assign pickup within 30 minutes after Home Store release confirmation.
- Missed pickup/arrival: warning at due time; escalation after 30 minutes.
- Record outcome within 30 minutes after the appointment, or two business hours after arrival.
- Not sold: assign return within 30 minutes.
- Return departure within two business hours when practical; otherwise require an exact next-business-day manager commitment.
- Off-site vehicle: daily location/custody confirmation.
- Sold pending: daily manager review until delivered, canceled, returned, or reassigned.
- Unknown location, damage, or missing keys: immediate critical escalation and block new releases or dispatches.

Every active record has exactly one **Next Action Owner** and **Due By** time.

## Notifications

- Request submitted → requesting-store manager first.
- Home Store release confirmed/declined → requester, requesting manager, and Home Store used-car manager.
- Driver assigned → driver, requester, and both managers.
- Checkout/arrival → both managers and salesperson.
- ETA missed → custodian and transport coordinator.
- Outcome overdue → salesperson and requesting manager.
- Not sold → requesting-store manager; Stacey also receives the task for a Howell return.
- Past-due return → custodian and both managers; group manager after the configured grace period.
- Unknown location/damage/missing key → group-level critical notification.

Notifications contain stock/VIN and action context, never customer names or verbatim CRM notes.

## Audit requirements

Every request, requesting-manager handoff, Home Store release decision, assignment, location confirmation, custody handoff, outcome, return, exception, override, and administrative correction is append-only and includes actor, role, store, timestamp, prior/new state, reason, and evidence reference.

## Integration boundary

The first operational version reads completed public and DealerMail snapshots and deep-links to official records. It does not write to DealerMail or CDK. Direct write-back requires a documented authorized API, field-by-field mapping, transaction testing, rollback behavior, and security approval.
