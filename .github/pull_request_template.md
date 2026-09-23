## What changed

Describe the user-visible result and the dealership workflow it supports.

## Safety boundaries

- [ ] Public, DealerMail, CDK, AutoCheck, sticker, and equipment evidence remain read-only.
- [ ] Status concepts remain separate; no availability, sale, delivery, or location is inferred.
- [ ] No credentials, cookies, customer data, CRM snapshots, reports, or runtime database files are included.
- [ ] Screenshots and fixtures were generated from `pnpm dev:demo`, or were separately reviewed and approved.
- [ ] Role-restricted information remains redacted in unauthorized views.

## Validation

- [ ] `pnpm check:repo-safety`
- [ ] `pnpm check`
- [ ] Inspected at the AGENTS.md viewports (390x844, 1024x768, 1320x820, 1440x900)
- [ ] Keyboard and focus behavior checked for changed controls/dialogs

Attach before/after screenshots for visual changes and list any remaining local-only or simulated behavior.
