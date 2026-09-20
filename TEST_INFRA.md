# Inventory Flow V2: End-to-End Test Infrastructure (TEST_INFRA.md)

**Document Version**: 2.0.0  
**Status**: ACTIVE  
**Track**: E2E Testing Track (`test_writer_e2e_1`)  
**Target Environment**: Node.js 24+, Vitest 4+, React 19, JSDOM, Testing Library  
**Authoritative Sources**:
- `/Users/joegallant/Documents/GitHub/inventory-flow/.agents/ORIGINAL_REQUEST.md`
- `/Users/joegallant/Documents/GitHub/inventory-flow/PROJECT.md`
- `/Users/joegallant/Documents/GitHub/inventory-flow/DESIGN_SPEC.md`
- `/Users/joegallant/Documents/GitHub/inventory-flow/CLAUDE.md`

---

## 1. Test Philosophy

The Inventory Flow V2 test infrastructure is built upon **opaque-box, requirement-driven verification**. Every test case derives its inputs, expectations, and invariant assertions directly from the user specifications, business rules, and design blueprints, never from private component implementation details.

### 1.1 Core Principles
1. **Opaque-Box Independence**: Tests interact with components via accessible DOM roles, accessible labels, visible user text, and public contract props. Tests never inspect private component state or internals.
2. **Authoritative Ground Truth**: Expected outputs are derived strictly from `ORIGINAL_REQUEST.md` (R1–R4, G1) and `PROJECT.md` (Features 1–29, Interface Contracts).
3. **No Facade Tests**: Every assertion tests observable functional behavior, DOM structure, styling classes, accessibility semantics, or data state transitions. Facades that assert trivial tautologies are strictly forbidden.
4. **Adversarial Boundary Validation**: Tests deliberately exercise missing fields, unverified source states, edge-case financial deltas, transport role redaction, extreme viewports (390px mobile to 1440px desktop), and keyboard accessibility.
5. **Progressive Testability & Determinism**: Test suites execute deterministically without flaky asynchronous timeouts or live external network calls.

---

## 2. Complete Feature Inventory Mapping (Features 1–29)

All 29 features cataloged in `PROJECT.md` are systematically mapped across Tiers 1–3:

| # | Feature Name | Description | Milestone | Tier 1: Primary Happy Path | Tier 2: Boundary / Edge / Error | Tier 3: Cross-Feature Interactions |
|---|--------------|-------------|-----------|----------------------------|---------------------------------|-------------------------------------|
| 1 | Baseline V1 Code Preservation | Original V1 baseline files remain strictly intact | M1 | V1 file existence, signature preservation, clean baseline exports | Reversion verification, non-destructive import safety, zero V1 edits | V1 / V2 coexistence without symbol clashing |
| 2 | Framer Motion Runtime Package | Vendored / installed typed framer-motion package | M1 | `motion`, `AnimatePresence`, spring/tween transitions, typed exports | `prefers-reduced-motion`, missing variants fallback, zero-duration mode | Component animation wrapping during state changes |
| 3 | Design System CSS Token Hardening | Zero sub-12px text, zero raw hex colors outside tokens | M1 | Font-size >= 12px, CSS custom property references, token compliance | Sub-12px rejection, raw hex regex rejection, border tokens | VDP density without violating 12px min typography |
| 4 | Clean Dynamic Routing Seam | `routeModules.ts` dynamic import seam with ?v=1 fallback | M1 | Dynamic loader resolution, default V2 in demo, ?v=1 fallback | Invalid query params, route preloading error suppression, SSR safety | Navigation between routes via route seam |
| 5 | Persistent Cockpit Header | Fixed top bar with title, price, MSRP delta, identifiers, action dock | M2 | Vehicle title display, formatted price, close button, sticky class | Long 60+ char titles, negative or zero price, missing trim | Header sticky behavior during card scrolls & modal exit |
| 6 | 1-Click Copyable Identifiers | Instant copy for Stock # and 17-char VIN with visual feedback | M2 | Copy button click, clipboard API call, checkmark icon swap | Clipboard API rejection, short stock numbers, 17-char VIN bounds | Multi-identifier copying across VDP and Inventory rows |
| 7 | High-Density 3-Column Cockpit Layout | Proportional 3-column desktop grid without dead whitespace | M2 | 3 distinct dashboard columns, responsive grid classes, no whitespace | 1024px tablet scaling, empty column content, scroll capping | Proportional card alignment across columns |
| 8 | Responsive Vehicle Media Frame | Primary thumbnail with count badge and thumbnail strip | M2 | Main photo render, photo count badge, thumbnail navigation | 0 photos fallback (`ImageOff`), 1 photo (no strip), broken URL | Photo selection synchronization with vehicle changes |
| 9 | Financials & Pricing Card | Sale price, MSRP, invoice/cost delta, tabular numerals | M2 | Formatted sale price, MSRP display, tabular numbers | Price > MSRP, Price < MSRP delta, missing MSRP, zero dollar | Price updates reflecting across cockpit header & card |
| 10 | Technical Specifications Card | Compact 2-column definition list for powertrain & specs | M2 | Engine, transmission, drivetrain, exterior/interior colors | Missing specs fallback ("Not published"), unknown colors | Specs alignment with equipment badges |
| 11 | Hold & DealerMail Context Card | Active holds, backup holds, timer, salesperson info | M2 | Active hold banner, salesperson name, expiration timer | No active hold ("No current hold"), multiple backups, unverified | Hold updates triggering DealerMail drawer & table pills |
| 12 | Service Readiness Card | Service stage, inspection date, technician notes | M2 | `needs_service`, `in_service`, `serviced` badge states | Missing inspection date, empty notes, invalid state | Service readiness toggle advancing Service Board state |
| 13 | Key Equipment & Packages Card | Standout factory equipment badges, package groups, warranty | M2 | Standout equipment list, category badges, warranty outlook bar | 0 equipment items graceful empty state, expired warranty | Equipment group matching window sticker equipment |
| 14 | 2x2 Document Cards Hub | Unclipped 2x2 grid for AutoCheck, Sticker, vAuto, OASIS | M2 | 4 document preview cards, 2x2 grid structure, no horizontal squeeze | Missing document URLs, failed report states, security rel tags | Document modal launch with return focus handling |
| 15 | Quick Action: Update Hold | In-card button to manage or review DealerMail hold | M2 | Click opens DealerMail drawer or triggers hold update | Unauthorized role disabled state, missing hold evidence | Hold status update synchronizing table row pills |
| 16 | Quick Action: Mark Ready / Start Service | 1-click in-card trigger to advance service readiness | M2 | Click calls update service API, advances status to in_service/ready | API network error rollback, already serviced vehicle state | Instant optimistic badge update across header & board |
| 17 | Quick Action: Track / Request Movement | Direct in-card trigger on custody card for vehicle transfer | M2 | Click triggers transfer navigation or request modal | Blocked cross-store move rule, unauthorized store role | Movement status update reflecting across custody timeline |
| 18 | Quick Action: Take-Home Sheet | Quick button to generate deal desk take-home sheet | M2 | Click opens `TakeHomeSheet` dialog with printable summary | Focus trapping inside dialog, Escape key dismissal, print layout | Take-home generation retaining vehicle financials |
| 19 | Framer Motion VDP Disclosure | Spring scale and fade animation for VDP modal & backdrop | M2 | Modal entrance spring transition, backdrop fade, body scroll lock | Immediate escape key exit, backdrop click dismissal | Modal enter/exit coordination with route changes |
| 20 | Button & Badge Micro-Interactions | Animated hover lift, tap compression, status badge morph | M2 | `whileHover` scale, `whileTap` active scale, badge layout prop | Rapid repeated clicks, keyboard focus rings, reduced motion | Micro-interaction feedback across all quick action docks |
| 21 | High-Density Inventory Table V2 | Sticky headers, compact rows, inline status pills | M3 | Dense table rows, sticky column headers, status badges | 0 search results empty state, 100+ vehicle list virtualization | Table row click opening VDP cockpit modal |
| 22 | Inventory Table Micro-Actions | Quick action shortcuts and copy buttons in inventory rows | M3 | Inline copy buttons, quick move/request buttons in row | Restricted role action hiding, disabled action tooltips | Row action triggering transfer drawer without full VDP |
| 23 | Service Board V2 | Multi-column readiness Kanban board with 1-click triggers | M3 | 3 readiness lanes (Waiting, In Service, Ready), card counts | 0 vehicles in lane empty state, lane filter changes | Card action moving vehicle between Kanban lanes |
| 24 | Transfers Movement View V2 | High-utility movement tracking view with route & countdown | M3 | Movement list items, route badges, countdown timers | Overdue move danger highlight, conflicting store locations | Transfer progression advancing vehicle custody state |
| 25 | View Switch Cross-Fade Animations | Coordinated Framer Motion transitions when switching views | M3 | Cross-fade opacity transition between Inventory, Service, Transfers | Rapid view toggle during in-flight animation, reduced motion | View switch preserving filter and search query state |
| 26 | Mobile & Responsive Density (390px+) | Balanced single-column vertical stack for mobile viewports | M2 | Single column layout at 390px, min 44px touch targets | Orientation switch, narrow 320px viewport, overflowing titles | Mobile tap opening full-screen VDP sheet |
| 27 | Opaque-Box E2E Test Suite (Tiers 1-4) | Comprehensive requirement-driven test suite with >=11xN cases | M4 | 100% test execution passing across all tiers | Test runner isolation, clean setup/teardown, zero flakiness | Cross-tier verification of system-wide flows |
| 28 | Adversarial Coverage Hardening (Tier 5) | White-box challenger verification of edge cases & traps | M4 | Keyboard focus traps, extreme string lengths, malformed data | Script injection resilience, NaN price handling, bad dates | Stress testing concurrent quick actions |
| 29 | Forensic Integrity Audit | Static and runtime verification of authentic implementation | M4 | Zero placeholder mocks in production, no display:none cheats | Verifying real DOM nodes, verifying actual CSS token usage | Full pipeline verification from API to DOM |

---

## 3. Test Architecture & Directory Layout

### 3.1 Directory Layout
```
tests/e2e/
├── tier1-feature-coverage.test.tsx      # Tier 1: >= 5 tests per feature (Features 1–29) [145+ tests]
├── tier2-boundary-corner.test.tsx       # Tier 2: >= 5 boundary & edge cases per feature [145+ tests]
├── tier3-cross-feature.test.tsx         # Tier 3: Pairwise and multi-feature interaction flows [25+ tests]
└── tier4-application-scenarios.test.tsx  # Tier 4: >= 15 comprehensive real-world application journeys [15+ tests]
```

### 3.2 Test Runner Command
The E2E test suite executes using the project's native Vitest runner in JSDOM mode:
```bash
# Run all E2E test tiers:
npx vitest run tests/e2e

# Or using the direct local node binary:
node node_modules/vitest/vitest.mjs run tests/e2e

# Run a specific tier:
npx vitest run tests/e2e/tier1-feature-coverage.test.tsx
npx vitest run tests/e2e/tier2-boundary-corner.test.tsx
npx vitest run tests/e2e/tier3-cross-feature.test.tsx
npx vitest run tests/e2e/tier4-application-scenarios.test.tsx
```

### 3.3 Pass / Fail Semantics
- **Exit Code 0**: 100% of tests passed, 0 failures, 0 unhandled rejections.
- **Exit Code 1**: Any test failure, timeout, or assertion mismatch.
- **Assertion Framework**: Vitest `expect` augmented with `@testing-library/jest-dom/vitest` (`toBeInTheDocument`, `toHaveAttribute`, `toHaveClass`, `toHaveTextContent`).

---

## 4. Coverage Thresholds

- **Tier 1 (Feature Coverage)**: >= 5 tests per feature across all 29 features = **>= 145 tests**.
- **Tier 2 (Boundary & Corner Cases)**: >= 5 boundary/corner cases per feature across all 29 features = **>= 145 tests**.
- **Tier 3 (Cross-Feature Interactions)**: Pairwise and workflow interaction tests = **>= 25 tests**.
- **Tier 4 (Application Scenarios)**: Complex multi-step user scenarios = **>= 15 scenarios**.
- **Total Test Suite Volume**: **>= 330 comprehensive tests**.

---

## 5. Real-World Application Scenarios (Tier 4: 15 Scenarios)

1. **Scenario 1: Salesperson Lead Response & Take-Home Sheet Generation**  
   Salesperson receives a walk-in customer inquiring about an F-150. Navigates inventory table, searches stock number, opens VDP cockpit, verifies sale price and MSRP delta, copies VIN to CRM, reviews standout packages, and generates a printable take-home customer sheet.

2. **Scenario 2: Deal Desk Manager DealerMail Hold Expiration & Reallocation**  
   Manager audits active customer holds. Opens VDP for a held vehicle nearing expiration, inspects DealerMail hold evidence and salesperson attribution, initiates hold extension or release, and verifies status updates.

3. **Scenario 3: Service Technician Intake to Delivery Readiness**  
   Vehicle arrives from auction. Service tech opens Service Board, identifies unit in "Waiting for Service", advances status to "In Service" with inspection notes, performs multipoint check, and advances status to "Serviced Ready".

4. **Scenario 4: Porter / Transport Driver Vehicle Transfer Execution**  
   Cross-store transfer requested between Howell and Fowlerville. Driver opens Transfers view, verifies route and vehicle VIN, inspects movement details in VDP, and verifies departure/arrival status updates.

5. **Scenario 5: High-Density VDP Inspection of Zero-Photo Auction Intake**  
   New auction acquisition arrives with 0 photos. Manager opens VDP cockpit, verifies graceful `ImageOff` fallback without layout collapse, inspects technical specs, confirms in-service date, and prints window sticker.

6. **Scenario 6: Transport Role Privacy Redaction & Access Enforcement**  
   Driver logs into system. Views VDP for customer-held vehicle; verifies customer personal name and contact information are strictly redacted while operational vehicle facts remain readable.

7. **Scenario 7: Rapid Deal Desk Multi-Identifier Clipboard Copying**  
   Desk manager rapidly copies Stock # and 17-character VIN in sequence for loan structuring. Verifies clipboard contents, animated checkmark feedback, and aria-live announcements.

8. **Scenario 8: Overdue Transfer Alert & Timeline Audit**  
   Transfers dashboard flags a movement overdue by 48 hours. Manager opens vehicle workspace, investigates timeline audit trail to identify dispatch delay, and resolves custody conflict.

9. **Scenario 9: Mobile Salesperson Lot Walk on 390px Viewport**  
   Salesperson walks the dealership lot on iPhone (390px width). Filters inventory table, opens full-screen VDP sheet, navigates single-column stacked layout, and taps quick action with >=44px touch target.

10. **Scenario 10: Multi-Vehicle Service Batch Progression**  
    Service advisor processes 3 vehicles in sequence, toggling readiness status on each card with instant optimistic UI badge updates and zero UI layout shifts.

11. **Scenario 11: Backup Hold Queue & Customer Priority Management**  
    Popular vehicle receives primary and backup customer holds. Manager reviews hold positions, verifies primary salesperson ownership, and checks backup queue order.

12. **Scenario 12: Margin & Pricing Delta Analysis Under Manager Credentials**  
    Manager audits pricing margins. Compares listed price against Window Sticker base MSRP and vAuto invoice reference to ensure gross margin thresholds are maintained.

13. **Scenario 13: View Switch Transitions & State Retention**  
    User navigates from Inventory Table to Service Board to Transfers View with Framer Motion cross-fading, verifying active filters and query parameters remain intact across navigation.

14. **Scenario 14: Strict Keyboard-Only Accessibility Workflow**  
    User navigates entirely using keyboard (`Tab`, `Shift-Tab`, `Enter`, `Escape`). Opens VDP modal from table, tabs through action dock and document cards, traps focus inside modal, and dismisses with `Escape`.

15. **Scenario 15: Factory Equipment & CPO Warranty Validation**  
    Salesperson validates Ford CPO eligibility. Inspects FX4 and Towing package equipment badges, checks Ford OASIS warranty start date, and validates remaining powertrain warranty months.
