# Inventory Flow visual identity and interface kit

## Recommendation

Use **Flowline** as the product identity. Its single idea is a forward-flowing
`F` built from operational lanes: the vertical route reads as the inventory
spine, while the two rounded channels read as information and vehicles moving
through one controlled system. It remains recognizable in one color and at
16 px.

The other three concepts are retained in `design/brand-kit` as exploration,
not alternate logos. Do not mix their geometry with the winner.

## Brand architecture

The interface has three deliberately separate layers:

1. **Product — Inventory Flow**
   - Permanent software name and Flowline mark.
   - Product palette: Ink, Flow Iris, and Arc Cyan.
   - Never recolored to imitate an OEM and never combined into an OEM oval,
     shield, star, grille, or other protected shape.
2. **Tenant — dealership or group**
   - Replaceable text label such as `Maxey workspace` and an optional
     tenant-owned logo.
   - Lives beside or below the product identity; it never replaces the
     Inventory Flow wordmark.
3. **OEM skin — Ford, Lincoln, or neutral**
   - Changes atmospheric scene, navigation accent, metallic surfaces, and
     selected operational buttons through `data-ifx-oem`.
   - Authorized OEM logo files stay external and appear in the location/OEM
     context area. They are not redrawn, bundled into the Flowline mark, or
     used as the product identity.

Third-party marks such as AutoCheck must likewise use an authorized official
asset and the provider's own usage rules; Inventory Flow never redraws them.

## Asset map

| Asset | Use |
| --- | --- |
| `public/brand-kit/inventory-flow-primary.svg` | Centered presentations, login, launch screen |
| `public/brand-kit/inventory-flow-horizontal.svg` | Header, document, desktop navigation |
| `public/brand-kit/inventory-flow-icon.svg` | App icon, favicon, collapsed navigation |
| `public/brand-kit/inventory-flow-reversed.svg` | Dark hero or presentation surface |
| `public/brand-kit/inventory-flow-monochrome.svg` | One-color print, etching, accessibility fallback |
| `src/design-system/tokens.css` | CSS custom properties and OEM skin hooks |
| `src/design-system/icons.tsx` | 24 px icon frame and the `ActionsIcon` default glyph for `FlowIconButton` |
| `src/design-system/components.tsx` | `FlowButton`, `FlowIconButton` (the icon-only primitive), and `FlowBrandLockup` (rendered by the app shell) |
| `src/design-system/components.css` | Component states and responsive treatment |

## Logo rules

- **Clear space:** keep at least `x`, where `x` is one quarter of the icon tile
  width, on all sides of the icon or lockup.
- **Minimum digital size:** icon 16 px; product wordmark without descriptor
  120 px wide; full horizontal lockup with descriptor 180 px wide.
- **Minimum print size:** icon 6 mm; full horizontal lockup 30 mm wide.
- At sizes below 180 px, remove the `AUTOMOTIVE OPERATIONS` descriptor before
  reducing the wordmark further.
- Use the supplied SVGs. Do not retype, stretch, outline, add effects, place in
  another container, or substitute tenant/OEM colors inside the product mark.
- On photography, use the reversed lockup only over a dark, quiet area with at
  least 4.5:1 contrast; otherwise place it on an Ink scrim.

## Typography

The kit has no remote font dependency. The application uses the native system
interface family through `--font-app`, so Windows receives Segoe UI and Apple
platforms receive San Francisco without synthetic interpolation:

- Display and interface: `system-ui`, `-apple-system`, `BlinkMacSystemFont`,
  `Segoe UI`, sans-serif.
- Technical: `Cascadia Code`, `SFMono-Regular`, Consolas, monospace.

Display type uses tight optical spacing only for large titles. Operational text
uses a 12 px absolute floor, 13–15 px for supporting and body copy, and only
the native 400, 500, 600, and 700 weights. Use uppercase tracking only for
short metadata labels, never paragraphs. Dense views earn space through layout
and progressive disclosure rather than miniature type.

## Components and states

Status wording must carry the meaning; color and icon only reinforce it. Hold,
public listing, CRM state, transport location, sold, and delivered remain
separate signals.

### FlowButton

| Variant | Use |
| --- | --- |
| `primary` | One dominant Inventory Flow action in a region |
| `secondary` | Supporting action such as details or open record |
| `quiet` | Low-priority utility |
| `danger` | Destructive action with a confirmation step |

Every variant includes default, hover, pressed, keyboard focus, disabled, and
loading states. Controls use solid fills, restrained borders, and short color
transitions; glossy overlays, scale effects, and decorative gradients do not
belong in operational action areas.

### FlowIconButton

`label` is required. It becomes the accessible name and tooltip. An icon-only
button must expose a 44 px target on touch devices. This is the designated
primitive for icon-only controls.

### FlowBrandLockup

The app shell renders it in the expanded and compact navigation. Product and
tenant stay separate elements.

## Accessibility

- Product Ink on Paper and white on Flow Iris exceed 4.5:1 for normal text.
- Arc Cyan is an accent, focus ring, or icon highlight; it is not body text on
  white.
- Focus uses a high-contrast 2 px outline plus a soft 3 px outer ring.
- Primary controls retain a 44 px target; compact 36 px controls expand to
  44 px on coarse-pointer devices.
- Icons are decorative by default. Pass `title` to give a standalone icon an
  accessible name; buttons still require visible text or `aria-label`.
- `prefers-reduced-motion` reduces all tokenized motion to near-zero and removes
  button translation. Meaning must never depend on animation.
- Forced-colors mode restores system borders and colors.

## Motion language

- `70 ms` instant feedback — selection glow or checked state.
- `140 ms` tactile — hover/press response.
- `220 ms` standard — menus, drawers, filter changes.
- `360 ms` deliberate — VDP/workspace reveal.
- `600 ms` scene — OEM atmosphere transition only.

Use the `enter` easing for objects arriving and `standard` for layout. OEM
transitions may animate background light, depth, and material, but should not
delay interaction or animate tables themselves.

## Integration sequence

1. Import `src/design-system/tokens.css` before app-level styles, then import
   `components.css` once.
2. Replace the current product mark reference with
   `/brand-kit/inventory-flow-icon.svg` and render
   `<FlowBrandLockup tenantLabel="Maxey" />` in the expanded navigation.
3. Set `data-ifx-oem="ford"`, `"lincoln"`, or `"neutral"` on the app shell.
4. Adopt `FlowButton` and `FlowIconButton` first in Inventory table row
   actions and the vehicle workspace. Do not change source-status wording while
   changing visual treatment.
5. Migrate remaining pages incrementally; the `ifx-` namespace prevents
   collisions with existing styles.

## Future-project reuse

Copy the `src/design-system` and `public/brand-kit` folders. Change only the
tenant context and authorized OEM skin configuration. If the software product
name changes, commission a new identity rather than reusing the Flowline mark
with a different name.
