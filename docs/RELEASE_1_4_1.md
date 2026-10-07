# Inventory Flow 1.4.1 feature scope

The deployed artifact and subsequent admin/manual-inventory changes are recorded
in [October 6 release evidence](RELEASE_2026_10_06.md). The candidate behavior
below was documented before that release. Earlier 1.4.0 evidence remains in
`RELEASE_1_4_0.md`.

The Action center always exposes its Vehicle issues option. Its issue ledger
keeps the vehicle, location evidence, issue, photos, reporter, assignment and
next action together. Open, Review, Completed and All views retain completed
history and reports for vehicles no longer present in the daily inventory.
Managers can open the completion form directly from Review work; the existing
server permission and required completion note still govern confirmation.

Overview defaults to a sales workspace for salespeople and an operations view
for managers. Sales see their employee-owned customer lists, useful vehicle
facts and independent hold, location, service and issue signals. Store
operations remain reachable with the same read-only access for sales. Managers
retain the vehicle work queue and compact store ledger with core operational
counts and a More counts disclosure. Its vehicle-issue summary opens the same
scoped issue ledger. Presentation changes never grant or revoke permissions.

Sales can open Customer sheet beside their saved-list selector without returning
to Inventory, using the same detailed and comparison PDF formats. Saved vehicles
without current authorized details stay saved but are excluded from the document,
with a count note. Employee, list selection and access changes close the document snapshot.
The All stores hold count opens the complete active-hold Inventory view, including
ordinary holds that do not have an Action center alert. Its filter can be cleared.

The Service summary leads with Waiting, In service and Ready counts, separate
14-day and 30-day wait counts, and the longest-waiting vehicles with photos,
stock numbers and direct record/service actions. Listing-based wait estimates
are labeled. Median timing and evidence totals are expandable and included in
printed reports.

The customer shortlist opens as a compact corner popover from a fixed launcher.
It adds no page height and preserves the inventory scroll position. Customer
selection, vehicle photos, price/mileage and Open/Remove actions stay close
together; New list and Manage reveal their forms only when requested. Clear
confirmation resets when switching lists. Customer sheets and vehicle details
open above the popover and restore focus to their launch controls.

Service list cards expose Open vehicle, Records and the permission-aware
Update service / View service action. The service control opens the existing
editor; it does not record a status without the employee's deliberate save.

Inventory rows use the existing daily snapshot for trim/body style, full VIN,
colors, powertrain, standout packages, history, certification and fuel economy.
Original and base MSRP come from captured VIN documents, with a copyable base
amount before options and destination. An informational vAuto fallback is
explicitly labeled. Listing MSRP is not used as a discount anchor; repeated
inventory/capture/report-run dates are removed from the scanning surfaces.
Missing listing specifications may be filled from usable VIN documents without
overwriting published values. Document pricing remains identified by its source; hold, service and location
evidence retain their separate meanings. Existing quick actions and source
logos remain visible, with 44-pixel targets and no horizontal page overflow at
the four canonical review viewports.

Both app and companion prepare a real customer-safe PDF before Share is enabled.
Save PDF downloads that file. Share supplies an `application/pdf` File to the
native share sheet when supported, and otherwise downloads the PDF for manual
sharing. Cancelling native Share does not trigger a download. A failed required
asset offers Retry PDF while keeping the sheet and browser printing available.
One document can contain several vehicles. Fonts and photos are embedded;
ordinary vehicle sheets fit one page, and long content continues without
truncation, repeating stock/VIN and vehicle-specific page numbers. Public
listing and store website actions are clickable PDF links. The PDF contains only
the existing customer-safe projection, excluding operational holds, moves,
issue notes and internal warranty estimates. Blocked photos show a placeholder.
The PDF has selectable text but is not structurally tagged for screen readers.

The additional Compare on one sheet format aligns two or three vehicles on a
landscape Letter comparison page, with photos, selling price, mileage, dealership,
grouped specifications, certification and standout equipment. Printable listing
QR codes are generated locally. Larger selections use balanced, numbered pages.
Long values continue without shrinking or clipping the text.
The preview and PDF share the same measured layout; phones show each complete
vehicle in reading order. The existing detailed sheets remain the default.
Both formats can be printed, downloaded and shared as PDF files in the app and
companion. Comparison metadata uses a neutral title rather than the customer's
private saved-list label.

The companion package and update notice are paired at 1.4.1. Its PDF libraries
and fonts are bundled locally with provenance and license notices. The app
loads the PDF renderer only when the take-home sheet opens.

Customer take-homes show selling price, not original or base MSRP. They include
captured title and accident results without implying an inspection or clean
history when evidence is absent. The supporting sales-data research and source
mapping are recorded in `SALES_INFORMATION_REVIEW.md`.

Store and tab changes apply immediately. Whole-table transforms and full-page
transition snapshots are removed; app and companion feedback use shared
80ms/120ms motion tokens. PDF rendering remains lazy and outside inventory
startup. Local interaction measurements are reported separately from live
network performance and physical-device acceptance.

This original candidate introduced no API, schema, publisher, task, credential
or source-system change. The later reviewed 0015 manual-controls migration and
paired deployment are recorded in the October 6 release evidence. Actual iPhone
sharing, protected live-photo CORS behavior and employee acceptance remain
separate production/device checks.

App and companion share an expandable manufacturer-reference starter for
captured options and packages. References apply to exact model/year/market
combinations; they never become VIN-installed equipment or capability claims.
The proposed Cloudflare API/MCP knowledge architecture is documented separately
in `MANUFACTURER_KNOWLEDGE_ARCHITECTURE.md`; no central knowledge deployment is
included in this candidate.
