# Inventory Flow 1.2.0 release review

Reviewed the September 12–15 redesign and its follow-up changes against the
reported website, mobile, companion, service, document and administration issues.

## Delivered

- Bordered desktop comparison cells and source groups, visible vehicle/record/
  hold/service/move actions, larger vehicle photos, compact phone controls and
  consistently separated companion rows in light and dark themes.
- Focused vehicle workspace with prominent warranty in-service, sticker base
  MSRP, captured weight-fee information, and inventory date. AutoCheck estimates
  and unknown-currency vAuto reference prices retain their source qualifications.
- Organized Records and Holds areas; take-home sheets hide the vehicle workspace
  instead of opening behind it. Source logos and exact-source links remain intact.
- Action center and inventory-update rows retain vehicle context, before/after
  change values, source summaries, and direct next-step controls.
- Service has exactly three workflow states. Unconfirmed vehicles enter Waiting,
  never Ready by listing age. The selected service editor stays reachable on a
  laptop and replaces the list on mobile; actual manager actions and dates are
  recorded with attribution and revision protection.
- Group managers can create employees, edit roles/stores, enable/disable access,
  and inspect append-only history. Identity remains immutable; self-demotion and
  removal of the final active administrator are blocked.
- Authorized Group managers can test lower permissions without changing their
  permanent membership. The banner clearly states that actions affect live data.
- The account menu downloads the matching private 1.2.0 companion ZIP. Packaging
  includes only tracked extension files and verifies the extracted bytes.
- Missing OASIS action results can no longer become false zero-action claims.
  Explicit capture provenance and a valid non-future date are required.

## Release evidence

- `pnpm check`: 105 test files, 1,296 tests, safety/design gates and production build.
- `pnpm test:e2e`: 18 desktop/mobile browser tests including employee creation,
  editing, disabling, access history, document details and readable layouts.
- `pnpm cloud:validate`: nine contiguous migrations validated in memory.
- Actual visual checks at 390×844, 1024×768, 1320×820 and 1440×900: no horizontal
  page overflow, no page/console errors in the audited paths, isolated take-home
  sheet, and service editor visible after selecting a lower list item.
- Companion checks at 320, 390 and 500px in both themes, including detail/record
  navigation and source-qualified copied prices.
- Synthetic screenshots are kept outside Git. No live inventory, hold/customer
  evidence, credentials or production database files are release assets.

## Operational boundaries

This is a verified release, not a claim that every real-world condition is known.
Source feeds do not prove reconditioning completion; managers must check actual
service records. Missing documents/fees remain explicitly missing. Provider and
DealerMail links can still require their own authorized sign-in.

New staff require both application membership and admission through the site's
sign-in policy. Adding a member does not send an invitation. Feed/feature tuning
remains read-only until real backend consumers are implemented; no decorative
settings claim to change a feed. Broader rollout and recovery requirements remain
documented in the private-release runbook.

Deployment requires the exact migration `0009_membership_admin.sql`, followed by
the normal Worker deployment and full encrypted-readiness and signed-in browser
checks. The private companion is unpacked distribution, not an automatic Chrome
Web Store update; installed copies must be refreshed separately.
