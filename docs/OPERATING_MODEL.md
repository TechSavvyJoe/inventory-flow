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
- Calls the vehicle's Home Store used-car manager to ask whether it is free and can be released.
- Records the explicit Home Store answer, including the answering manager and time; a website listing or DealerMail hold is never a substitute.
- Accepts custody responsibility.
- Owns the outcome update and return plan after arrival.

### Home-store used-car manager

- Confirms physical presence and conflicting commitments.
- Confirms released, not available, or needs more information.
- Defines the release window and any authorized exception to the standard no-sale return rule.
- Confirms the vehicle is back before the move closes.

### Transport coordinator

- For Howell requests, Stacey normally assigns drivers after release. The salesperson usually asks Stacey for a driver.
- At other stores, the requesting manager or assigned coordinator arranges the driver.
- Records the assigned driver, pickup/arrival target, route, and return leg.
- Resolves missed pickup/arrival and transport exceptions.

### Driver

- Marks the vehicle collected and arrived, and records odometer, fuel, keys, condition, and the custody handoff.
- Sees logistics only, not unnecessary customer information.
- Cannot change hold, deal, delivery, or CDK status.

### Porter

- Is not a default transport step or routine assignment.
- May be assigned to drive only when a manager specifically requests it, then marks the vehicle collected, in transit, and arrived like an assigned driver.
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

Only one active move may control a VIN. Other interest is queued for manager resolution.

### Customer / deal

No Outcome → Appointment Scheduled → Customer Show → Still Working / Not Sold / Deal in Progress / Sold Pending / Deal Canceled

Sold Pending never closes the move and is not delivery confirmation. Only a manager can record that the deal fell through, which puts the vehicle back on the return path.

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
4. **Call the Home Store, record the answer**: the requesting manager calls the Home Store used-car manager and records the explicit release answer.
5. **Ask for a driver**: for Howell, the salesperson usually asks Stacey, who assigns the driver and pickup time. Elsewhere the requesting manager or coordinator assigns the driver. A porter appears only when a manager specifically requests that assignment.
6. **Collect the vehicle**: the driver marks the vehicle collected; releasing and accepting custodians record keys, odometer, fuel, condition, and time.
7. **Confirm the vehicle arrived**: the destination confirms the vehicle arrived at the requesting store and who has it; both managers and the salesperson are notified.
8. **Record the showing outcome**: sales or the manager explicitly records showing in progress, shown · not sold, decision or paperwork pending, or sold pending.
9. **Start the return, or close the move**: shown · not sold starts the return, owned by the requesting-store manager; Stacey normally assigns the Howell return driver. Sold pending stays open until the manager confirms delivery or records the deal fell through. Only the Home Store confirming the vehicle is back, or explicit delivery confirmation, lets the move close.

## Starting service levels

These should become configurable store/business-hour rules.

- Customer waiting: acknowledge in 10 minutes; decide in 20.
- Standard same-day request: acknowledge in 30 minutes; decide in 60.
- Assign a driver within 30 minutes after the Home Store release is recorded.
- Missed pickup/arrival: warning at due time; escalation after 30 minutes.
- Record outcome within 30 minutes after the appointment, or two business hours after arrival.
- Not sold: assign return within 30 minutes.
- Return departure within two business hours when practical; otherwise require an exact next-business-day manager commitment.
- Off-site vehicle: daily location/custody confirmation.
- Sold pending: daily manager review until delivered, canceled, returned, or reassigned.
- Unknown location, damage, or missing keys: immediate critical escalation and block new releases or driver assignments.

Every active move has exactly one **next step** owner and **due** time.

## Notifications

- Request submitted → requesting-store manager first.
- Home Store release recorded or declined → requester, requesting manager, and Home Store used-car manager.
- Driver assigned → driver, requester, and both managers.
- Vehicle collected or arrived → both managers and salesperson.
- ETA missed → custodian and transport coordinator.
- Outcome overdue → salesperson and requesting manager.
- Shown · not sold, or deal fell through → requesting-store manager; Stacey also receives the task for a Howell return.
- Past-due return → custodian and both managers; group manager after the configured grace period.
- Unknown location/damage/missing key → group-level critical notification.

Notifications contain stock/VIN and action context, never customer names or verbatim CRM notes.

## Audit requirements

Every request, requesting-manager handoff, Home Store release decision, assignment, location confirmation, custody handoff, outcome, return, exception, override, and administrative correction is append-only and includes actor, role, store, timestamp, prior/new state, reason, and evidence reference.

## Integration boundary

The first operational version reads completed public and DealerMail snapshots and deep-links to official records. It does not write to DealerMail or CDK. Direct write-back requires a documented authorized API, field-by-field mapping, transaction testing, rollback behavior, and security approval.
