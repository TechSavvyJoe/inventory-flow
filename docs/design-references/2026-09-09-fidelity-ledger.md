# Inventory Flow fidelity ledger — 2026-09-09

## Reference handling

The private concepts were inspected at original image detail. They remain outside version control under `work/private-design-qa/2026-09-09`:

- `2026-09-09-inventory-table-v10.png`
- `2026-09-09-vehicle-overview-v10.png`
- `2026-09-09-vehicle-equipment-v10.png`

The repository contains no copies, embedded previews, or links to those images. QA screenshots remain ignored and private.

## Reproducible synthetic QA

Use only the synthetic fixture when capturing shareable layout evidence:

```text
pnpm dev:demo
INVENTORY_OPS_QA_URL=http://127.0.0.1:4173/inventory pnpm qa:visual
```

Required viewports are `1440x900`, `1700x950`, and `390x844`. Compare the captures with the private concepts at original detail; check layout geometry, legibility, wrapping, clipping, overflow, and interaction states rather than source content.

## Fidelity comparisons

| Area | Reference intent | Implemented comparison target |
| --- | --- | --- |
| Inventory hierarchy | Location context, search, scope, filters, grouped columns, and rows form one clear scan path. | Preserve that order and keep filters and sort controls visually subordinate to search and results. |
| Table density | A useful number of vehicles remains visible without making identifiers, pricing, or equipment hard to read. | Keep stable column groups, clear row separators, readable supporting text, and no document-level horizontal overflow. |
| Vehicle workspace | Media, identity, operational status, actions, tabs, and detail content read as one continuous workspace. | Keep that exact sequence; status, actions, and tabs must never overlap or obscure detail content. |
| Overview information | Vehicle description and decision-ready facts are visible without large empty cards or repeated source data. | Use compact, aligned sections; prioritize vehicle, price, mileage, hold, location, movement, description, and useful highlights. |
| Equipment presentation | Factory packages and major customer-requested features are organized by meaning, with exact source wording available. | Use one calm ledger per category with counts and progressive disclosure; avoid icon repetition, rainbow panels, and duplicate specification walls. |
| Mobile behavior | The workspace remains task-oriented on a phone instead of shrinking the desktop composition. | At `390x844`, use a true single column with readable title, full short identifiers, labeled status cells, compact actions, and zero horizontal overflow. |
| Typography and controls | Type, borders, and actions feel consistent and deliberate across the table and workspace. | Use the app typography tokens and standard weights; maintain strong contrast, consistent control geometry, visible focus, and restrained emphasis. |

## Copy differences

- Use **Days listed** rather than **Days in stock** because the value represents published-listing age, not guaranteed physical lot age.
- Use **View details** or **Details** rather than the concept's **View vehicle** when the action opens the in-app workspace.
- Use **DealerMail tools** only where a verified task menu is available; use **DealerMail** for a direct read-only destination.
- Equipment disclosure labels use the current dynamic item count rather than a fixed number from a concept.
- Status copy stays conservative: a public listing, hold record, expected date, or source flag never becomes a claim of availability, sale, delivery, or physical presence.

## Intentional deviations

- Private concept content is not copied into fixtures or documentation; automated captures use synthetic records only.
- The responsive UI reflows instead of reproducing desktop proportions on smaller screens.
- Frontline views translate source evidence into operational language; raw feed and system terminology stays in progressive audit details.
- The implementation does not invent activity, equipment, movement, availability, or history to visually match a concept.
- Group identity remains neutral; store and manufacturer branding is contextual and must not imply an unsupported affiliation or vehicle state.

## Core interaction path

`Inventory` → search, scope, filter, or sort → open a vehicle row → review Overview → inspect Hold, Movement, Equipment, or Records → copy only a needed identifier or open an authorized read-only resource → close the workspace and restore focus to the originating row.

Acceptance requires keyboard and pointer operation, clear current state, safe external-link behavior, scroll reset when changing workspace sections, and no clipping or horizontal overflow at every required viewport.
