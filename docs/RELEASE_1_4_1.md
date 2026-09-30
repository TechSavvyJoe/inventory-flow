# Inventory Flow 1.4.1 candidate

Status: feature branch only; this document does not establish a deployment.
The live 1.4.0 release is recorded separately in `RELEASE_1_4_0.md`.

The Action center always exposes its Vehicle issues option. Its issue ledger
keeps the vehicle, location evidence, issue, photos, reporter, assignment and
next action together. Open, Review, Completed and All views retain completed
history and reports for vehicles no longer present in the daily inventory.
Managers can open the completion form directly from Review work; the existing
server permission and required completion note still govern confirmation.

Overview uses a compact store ledger with core operational counts and a
More counts disclosure. Its vehicle-issue summary opens the same scoped issue
ledger. Sales retain the existing read-only Overview.

Inventory rows use the existing daily snapshot for trim/body style, full VIN,
colors, listed MSRP comparison, inventory/capture dates and fuel economy.
Document pricing remains identified by its source; hold, service and location
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

The companion package and update notice are paired at 1.4.1. Its PDF libraries
and fonts are bundled locally with provenance and license notices. The app
loads the PDF renderer only when the take-home sheet opens.

No API, schema, production publisher, task, credential or source-system change
is included. Final check counts and CI/browser evidence belong in the pull
request. Actual iPhone sharing, protected live-photo CORS behavior and employee
acceptance remain separate production/device checks.
