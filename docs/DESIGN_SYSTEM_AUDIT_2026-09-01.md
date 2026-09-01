# Inventory Flow design-system audit

## Executive summary

Inventory Flow now has a credible product identity, a documented typography floor, reusable tokens, and accessible base components. The visible core routes pass an automated 12 px computed-text floor and document-level horizontal-overflow check at desktop and mobile sizes.

The main visual risk is no longer a missing visual direction. It is incomplete adoption and accumulated cascade debt: many screens still use page-specific button, signal, card, and typography rules, while eleven global style layers and several versioned feature styles compete for precedence. The result can look correct in one viewport yet regress after an unrelated rule lands.

The intended product language is restrained, operational, and premium: clear hierarchy, native system typography, one dominant action per region, compact supporting actions, readable evidence, and OEM atmosphere that never compromises speed or clarity.

## Token coverage

### Present and usable

- Product, neutral, semantic-status, and OEM-skin colors.
- Native-font families and a 12 px absolute text floor.
- A limited 400/500/600/700 weight set to avoid soft synthetic rendering on Windows.
- Spacing, radius, control-height, elevation, focus, motion, and reduced-motion tokens.
- Separate product, tenant, and OEM identity layers.

### Adoption gaps

- Raw colors remain common in feature styles instead of resolving through semantic tokens.
- Several feature styles declare their own font stacks rather than inheriting the application family.
- Page-specific spacing and radii create small but visible inconsistencies in panels, drawers, filters, and action groups.
- Some legacy rules still declare text below 12 px; later readability rules currently override visible instances.

## Component completeness

### Canonical components

- `FlowButton`: primary, OEM, secondary, glass, quiet, danger, disabled, loading, focus, and coarse-pointer states.
- `FlowIconButton`: accessible label and touch-size behavior.
- `FlowSignal`: semantic state presentation that does not rely on color alone.
- `FlowSurface`: base, raised, command, glass, and dark surfaces.
- `FlowBrandLockup`: separate product and tenant identity.
- `FlowActionDock`: one primary action with restrained secondary and utility actions.

### Missing or underused patterns

- The canonical buttons and signals are not yet the default across Inventory, Vehicle Moves, Needs Attention, and Manager surfaces.
- Page header, search/filter toolbar, compact field, data-table action group, disclosure menu, empty state, error state, and confirmation dialog need canonical wrappers.
- Table density needs a single supported compact mode instead of feature-specific size overrides.
- The vehicle workspace and movement workspace need the same action hierarchy and panel-header grammar.

## Measured debt baseline

The regression guard records the present debt so it can only move downward:

- 614 static sub-12 px declarations across legacy CSS. These are debt even when later rules override them.
- 2,684 raw color literals outside token files.
- 11 CSS files imported globally from `src/main.tsx`.

`pnpm check:design-system` fails if a file increases either debt measure or if another unreviewed global CSS layer is added. The end-to-end readability check inspects computed visible text, not only source declarations, and checks page-level horizontal containment on desktop and mobile.

## Priority migration plan

### P0 — release boundaries

1. Fail closed in production when trusted server-provided identity is unavailable.
2. Move shared dealership state to an authenticated, encrypted, auditable backend.
3. Keep the local synthetic demo explicit and isolated from production behavior.

### P1 — visual and workflow convergence

1. Standardize page title, summary, search/filter, and primary-action placement across all four primary work areas.
2. Replace page-specific primary and secondary buttons with the canonical action hierarchy.
3. Make summary cards either perform a real filter/navigation action or render as non-interactive information.
4. Use one compact table grammar: readable vehicle identity first, operational state second, one clear row action, details behind deliberate disclosure.
5. Preserve the adoption-first five-stage movement workflow; keep advanced dispatch and digital cross-store acknowledgment as later modes.

### P2 — cascade reduction

1. Merge global refinement layers into tokenized base, shell, and component styles.
2. Retire superseded `final`, `polish`, `hardening`, `compact-v*`, and `production-v*` files only after visual-regression coverage protects each migrated area.
3. Convert repeated raw colors, dimensions, and shadows into named semantic tokens.
4. Raise or remove every legacy sub-12 px declaration instead of relying on a late override.

## Acceptance bar

- No visible operational text below 12 px; 13–15 px for supporting and body content.
- No document-level horizontal scrolling at supported desktop or mobile sizes.
- One obvious primary action per panel; supporting actions remain discoverable and labeled.
- Touch controls are at least 44 px on coarse-pointer devices.
- Keyboard focus, Escape dismissal, focus return, reduced motion, and forced-colors behavior remain intact.
- Inventory, movement, attention, and manager pages share predictable placement and terminology.
- OEM styling adds atmosphere and context without imitating protected marks or reducing contrast.
