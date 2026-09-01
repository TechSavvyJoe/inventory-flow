# Inventory Flow full software review

Review date: September 1, 2026  
Scope: Inventory, vehicle workspace, Vehicle Moves, Needs Attention, manager views, desktop and mobile behavior, workflow enforcement, accessibility, and release readiness.

## Executive verdict

Inventory Flow is now a credible, useful production prototype with a coherent dealership operating model. It is materially stronger than the earlier screens: the hierarchy is clearer, operational facts are readable, the inventory and vehicle workspace contain substantially more useful data, and Vehicle Moves now represents the real phone-based store workflow.

It should not yet be described as fully production-ready. The remaining release blockers are trusted identity/SSO, a shared encrypted production data service, production permissions for private DealerMail evidence, deployment/monitoring/rollback, and final human accessibility/device acceptance. Those are platform controls, not cosmetic defects.

## Product and visual direction

The product is a dealership inventory operations workspace for salespeople and managers. Its single job is to help a person find the right vehicle, understand its exact current evidence, and take the correct next action without confusing a listing, a hold, or an internal code with real availability.

The design direction is an OEM operations cockpit rather than a generic dashboard: restrained Maxey navy, Ford blue, ice, steel, and white; crisp instrument-like data; quiet borders; strong legibility; and one signature ordered workflow rail showing where every inter-store request actually sits. Motion is reserved for state changes and orientation, with reduced-motion support, rather than decorative movement.

## Exact Vehicle Moves workflow

The current five-stage path is:

1. A salesperson requests a vehicle assigned to another Home Store.
2. The requesting-store manager reviews and approves the business need.
3. That requesting-store manager calls the Home Store used-car manager, confirms whether the vehicle may be released, and records the named manager and decision.
4. Only after a recorded release can a driver be requested, assigned, and the vehicle moved.
5. The requesting store records the customer outcome; an unsold vehicle enters a separate return workflow and the Home Store confirms receipt.

Important controls now enforced:

- The requesting store and requester must match the active user context.
- Transfer actors and acting stores cannot be rewritten in the submitted event body.
- The requesting-store manager must complete both the initial approval and the recorded Home Store call decision.
- A Home Store grant or decline requires the name of the manager contacted.
- Home Store contact does not imply availability until a grant is recorded.
- Driver and movement actions remain unavailable until the release gate passes.
- Sale, delivery, hold, movement, custody, and return remain separate states.

The current release evidence is a named, time-stamped record of the phone decision. A later advanced mode may add an independently authenticated digital Home Store acknowledgment, but it is intentionally not required for the adoption-first rollout.

## What is working well

### Inventory

- Search covers stock, VIN, vehicle, feature, salesperson, and hold information.
- Sorting, paging, store scope, hold state, price, mileage, documents, location, and operational actions are visible without opening every vehicle.
- Sort and row-action disclosures are real named buttons with expanded state, Escape and outside-click dismissal, and focus return; their closed panels no longer leak into or cover the table.
- AutoCheck and window-sticker actions are labeled and remain read-only.
- Explicit detail actions provide keyboard access even where the row itself has a pointer affordance.
- Current public and internal states remain separate; the UI does not claim a vehicle is available merely because it is listed or has no current hold record.

### Vehicle workspace

- The overview prioritizes vehicle identity, price, mileage, age, hold, location, movement, description, highlights, and source-labeled record facts.
- Stock, VIN, and mileage retain targeted copy actions; feature lists are presented as readable information rather than a wall of copy boxes.
- AutoCheck, factory sticker, and VIN equipment resources are labeled with their actual role and limitation.
- Full records expose captured AutoCheck checks, OEM options, standard equipment, warranty, and vAuto fallback evidence without pretending a generated equipment profile is an original Monroney label.
- Tabs, modal focus containment, Escape close, return focus, and reduced-motion behavior are implemented.

### Needs Attention

- It behaves as a work queue with real records and next actions, not a decorative KPI page.
- Current work and Daily Changes are linked ARIA tabs with roving focus and Arrow, Home, and End keyboard navigation.
- Mobile detail positioning clears the sticky header, and Daily Changes filters wrap instead of clipping.

### Consistency and content

- Primary pages use a shared shell, title/action hierarchy, filters, queue/detail model, button vocabulary, and availability caveats.
- Customer-sensitive names and reasons stay out of summary dashboards where they do not belong.
- Technical source-system jargon is kept out of the primary operating language while source evidence remains available where it matters.

## Remaining production gates

### 1. Trusted identity and authorization — blocking

The local service still receives role, store, and user through prototype request headers. Although workflow payload spoofing is now rejected, a production service must derive identity and permissions from a verified server session or dealership SSO. Private DealerMail/customer evidence cannot be considered production-protected until this is complete.

### 2. Shared production backend — blocking

The current local/synthetic operating mode is useful for development, but PC/Mac and multi-user production use requires a shared encrypted database, server-side field permissions, immutable action audit, backups, retention, and concurrency controls.

### 3. Deployment operations — blocking

A production release needs reviewed environment configuration, secret isolation, health monitoring, error reporting, rollback, and a tested release pipeline. Role preview remains development-only and is hidden from normal production builds.

### 4. OEM and document coverage — material data gap

The UI now presents available equipment well, but exact VIN-level OEM package and autonomous-safety coverage is only as complete as the source release. Authorized vAuto enrichment and cross-OEM feature normalization remain planned work. Missing evidence must continue to be labeled rather than guessed.

### 5. Human accessibility and device acceptance — required before release

Automated keyboard, naming, focus, mobile layout, and overflow checks are strong. Final acceptance still requires NVDA with Chrome, VoiceOver with Safari, Windows High Contrast, browser text-spacing/200% checks, and physical iOS/Android touch and software-keyboard testing.

### 6. Styling and bundle consolidation — high-priority hardening

The application still carries several large historical CSS refinement layers and a build-size warning. They work, but they increase regression risk and make small typography inconsistencies easier to reintroduce. Consolidate them into the documented design system and split the larger application bundle before calling the visual layer finished.

## Deferred advanced capabilities preserved

The existing model and roadmap retain structured dispatch, driver capacity, route grouping, condition-issue acknowledgment/resolution, escalation history, role-specific saved views, VIN-document enrichment, cross-OEM feature normalization, advanced filters, and bulk review. These are intentionally deferred so the first rollout teaches a small number of clear salesperson and manager actions instead of presenting every possible control at once.

## Validation evidence

- Repository safety check passed.
- Focused Vehicle Moves and server workflow tests passed.
- Final full suite passed: 33 test files and 171 tests.
- Final production build passed. The existing large-bundle warning remains a documented hardening item.
- Desktop and mobile end-to-end vehicle-document tests both passed after validating the current progressive-disclosure flow and correcting the controlled-menu hidden state.
- Live browser review confirmed the five-stage Vehicle Moves language, request empty-state recovery, manager action dialog, modal semantics, and no document-level horizontal overflow in the reviewed desktop/mobile layouts.
- Needs Attention focused tests and 390×844 plus desktop browser checks passed with no console errors.
- No protected dealership snapshot, report, credential, or customer-data artifact was changed by this review.

Final release checks should be rerun after authentication and the shared production service are added.

Interaction behavior was checked against the W3C ARIA tabs and modal-dialog patterns and the WCAG 2.2 target-size guidance:

- https://www.w3.org/WAI/ARIA/apg/patterns/tabs/
- https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
- https://www.w3.org/TR/WCAG22/
