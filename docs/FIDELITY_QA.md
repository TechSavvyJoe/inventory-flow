# Fidelity and interaction QA

The final responsive implementation was compared against the design concepts at 1440×900 and 390×844. The QA images are retained in `design/`.

## Implemented refinements

1. **Operational hierarchy:** Home Store, scope, quick views, four decision metrics, filters, results, and Group Reach appear in that order. A healthy source snapshot is a compact line; only stale or incomplete data receives a prominent warning.
2. **Home-store-first without hiding the group:** the page opens on the employee's Home Store, while All Stores, Group Reach, and the global search provide an intentional expansion path. The global search opens in group scope so a partial stock or VIN from another location is returned immediately.
3. **Premium identity:** Inter Variable is bundled locally, Lucide icons use consistent geometry, and the neutral Inventory Flow mark is paired with a locally bundled official selected-store logo. Ford is not used as a group-wide identity.
4. **Data density:** the desktop table keeps the primary operational fields in one viewport and moves detail into a workspace. At narrower widths, secondary table columns collapse before horizontal overflow. Final browser checks measured no document-level horizontal overflow at 1440px or 390px.
5. **Responsive action design:** the mobile layout becomes a compact vehicle list and bottom sheet, retains My Store / All Stores, and keeps a fixed four-item navigation. Important mobile controls meet a 44px minimum target.
6. **Keyboard behavior:** a skip link targets the main content; mobile navigation and vehicle sheets receive initial focus, contain Tab focus, close with Escape, and restore focus. Vehicle tabs support Arrow Left/Right and Home/End.
7. **Role-appropriate evidence:** salespeople and managers can read exact DealerMail hold owner/customer or reason, salesperson, comments, alerts, expected date, and backups. Porter, driver, and transport-coordinator views keep logistics while restricting those sensitive fields. Customer details do not appear on dashboard cards or alert summaries.
8. **Status separation:** public listing, DealerOn flags, DealerMail hold, app-confirmed location, transfer stage, sold-pending outcome, delivery confirmation, and CDK evidence remain separate. No public or hold signal is presented as confirmed availability, sale, delivery, or closure.
9. **Report-to-action translation:** Today opens on the employee's Home Store, provides exact before/after daily inventory events, and expands to the group without exposing the 44-column report in the normal workflow.
10. **Safe hold signals:** past-expected holds, alert presence, and comment presence are visible without customer-sensitive text. The complete authorized evidence remains in the vehicle workspace.
11. **Search privacy:** global predictive-search text is transient, removed from the URL after legacy-link intake, never saved to localStorage, and invalidated when role or Home Store changes.
12. **CRM-only hold coverage:** Today derives safe store-level hold signals from all active DealerMail hold rows, so a VIN does not silently disappear from review merely because its public listing disappeared.
13. **Small-screen density:** at 320×568, redundant page chrome collapses, the actionable change list begins in the first viewport, and document width remains exactly 320px.

## Verified current baseline

- 220 public VINs
- 217 DealerMail CRM rows
- 30 unique held VINs
- 38 certified public change events: 15 new, 16 removed, 6 price, and 1 website-status change
- 0 invented movement records
- Howell quick view: 68 public units and 10 current held VINs
- Group quick view: 30 current held VINs and 181 public VINs with no current DealerMail hold found
- Production build and TypeScript compilation passed; 40 automated tests across 12 files and live 1440×900, 390×844, and 320×568 browser checks passed

The local prototype still requires dealership identity/SSO, a shared encrypted host/database, production authorization rules, and notification integration before coworker deployment.
