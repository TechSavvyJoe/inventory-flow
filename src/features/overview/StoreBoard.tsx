import { useId, useState, type MouseEvent } from 'react'
import { ChevronDown } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import type { OverviewBoardFlow, OverviewSummary, StoreName, UserRole } from '../../types'
import { boardFlowHref, inventoryViewHref, serviceStatusHref } from './overview-links'
import { plural, type StoreCounts, type WhereFilter } from './overview-selectors'
import { STORE_BOARD_POSITIONS, STORE_BOARD_VIEWBOX, type StoreBoardPosition } from './store-board-config'
import './StoreBoard.css'

/**
 * The store board (OVERVIEW_SPEC §4): an inline SVG schematic of the four
 * stores from store-board-config.ts. It is not a map. Each pin is a link to
 * the list behind its number; each arrow is a link to exactly the moves it
 * draws. The visible move list and the hidden table carry the same facts in
 * text, so the drawing is never the only representation.
 */

interface PinMetric {
  key: keyof StoreCounts
  label: string
  phrase: string
  href: (store: StoreName) => string
}

const PIN_METRICS: Record<WhereFilter, PinMetric> = {
  away: { key: 'away', label: 'Away', phrase: 'away from home', href: (store) => inventoryViewHref(store, 'away') },
  unaccounted: { key: 'unaccounted', label: 'Unaccounted', phrase: 'unaccounted', href: (store) => inventoryViewHref(store, 'unaccounted') },
  holds: { key: 'holds', label: 'Holds', phrase: 'with holds', href: (store) => inventoryViewHref(store, 'holds') },
  waiting: { key: 'waitingForService', label: 'Waiting for service', phrase: 'waiting for service', href: (store) => serviceStatusHref('needs_service', store) },
}

const KIND_WORDS: Record<OverviewBoardFlow['kind'], string> = { outbound: 'Outbound', return: 'Returning home', planned: 'Planned' }
const LEGEND: Record<OverviewBoardFlow['kind'], string> = {
  outbound: 'Left its home store; in transit or at the other store',
  return: 'On its way back to its home store',
  planned: 'Approved, not yet departed',
}
/**
 * The drawing uses 4 internal units per board unit, so SVG text carries a
 * real font size (computed and rendered stay at or above 12px) while the
 * config keeps the spec's 100 × 70 board coordinates.
 */
const SCALE = 4
const PIN_RADIUS = 20
const HIT_RADIUS = 36
const LABEL_SIZE = 16.8
const COUNT_SIZE = 17.6
const BADGE_SIZE = 15.2
const BADGE_RADIUS = 12.8
/** An invisible target around each arrow's count, about 44px at the board's narrowest width. */
const BADGE_HIT_RADIUS = 28.8

const round = (value: number) => Math.round(value * 100) / 100

function position(store: StoreName): StoreBoardPosition | undefined {
  const pin = STORE_BOARD_POSITIONS.find((entry) => entry.store === store)
  return pin && { ...pin, x: pin.x * SCALE, y: pin.y * SCALE }
}

function toward(from: { x: number; y: number }, to: { x: number; y: number }, distance: number) {
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1
  return { x: from.x + ((to.x - from.x) / length) * distance, y: from.y + ((to.y - from.y) / length) * distance }
}

/**
 * A gentle curve from pin edge to pin edge. The bend is to the left of the
 * direction of travel, so a return (drawn destination → home) never sits on
 * top of the outbound leg, and a planned move bows wider than a moving one.
 */
function flowGeometry(flow: OverviewBoardFlow) {
  const start = position(flow.from)
  const end = position(flow.to)
  if (!start || !end) return null
  const length = Math.hypot(end.x - start.x, end.y - start.y) || 1
  const normal = { x: (start.y - end.y) / length, y: (end.x - start.x) / length }
  const bend = (flow.kind === 'planned' ? 7.5 : 3.5) * SCALE
  const control = { x: (start.x + end.x) / 2 + normal.x * bend, y: (start.y + end.y) / 2 + normal.y * bend }
  const from = toward(start, control, PIN_RADIUS + 1.2 * SCALE)
  const to = toward(end, control, PIN_RADIUS + 2 * SCALE)
  const label = { x: 0.25 * from.x + 0.5 * control.x + 0.25 * to.x, y: 0.25 * from.y + 0.5 * control.y + 0.25 * to.y }
  return {
    d: `M ${round(from.x)} ${round(from.y)} Q ${round(control.x)} ${round(control.y)} ${round(to.x)} ${round(to.y)}`,
    label: { x: round(label.x), y: round(label.y) },
  }
}

function labelPlacement(pin: StoreBoardPosition) {
  if (pin.anchor === 'middle') return { x: pin.x, y: pin.y + PIN_RADIUS + LABEL_SIZE + 0.6 * SCALE, anchor: 'middle' as const }
  const offset = PIN_RADIUS + 1.5 * SCALE
  return { x: pin.anchor === 'end' ? pin.x - offset : pin.x + offset, y: pin.y + LABEL_SIZE / 2.8, anchor: pin.anchor }
}

function flowName(flow: OverviewBoardFlow): string {
  return `${plural(flow.count, 'vehicle')} ${flow.from} to ${flow.to}, ${KIND_WORDS[flow.kind].toLowerCase()}`
}

export function StoreBoard({ overview, homeStore, role, metric, collapsible }: {
  overview: OverviewSummary
  homeStore: StoreName
  role: UserRole
  metric: WhereFilter
  /** On a phone the board sits closed inside a disclosure below the list. */
  collapsible: boolean
}) {
  const navigate = useNavigate()
  const uid = useId().replaceAll(':', '')
  const [open, setOpen] = useState(false)
  const pinMetric = PIN_METRICS[metric]
  const counts = new Map(overview.stores.map((entry) => [entry.store, entry]))
  const flows = overview.board.flows.filter((flow) => position(flow.from) && position(flow.to))

  // SVG links cannot be router <Link>s; keep same-origin navigation in the app.
  function follow(event: MouseEvent<Element>, href: string) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigate(href)
  }

  const heading = <h2 id="ov-board-title">Store board</h2>
  const body = (
    <div className="ov-board-body">
      <figure className="ov-board-figure">
        <svg className="ov-board-svg" viewBox={`0 0 ${STORE_BOARD_VIEWBOX.width * SCALE} ${STORE_BOARD_VIEWBOX.height * SCALE}`} role="img" aria-labelledby={`ov-board-title ${uid}-desc`}>
          <desc id={`${uid}-desc`}>
            {`Schematic of the four stores, not a map. Pin numbers count vehicles ${pinMetric.phrase} by home store. Arrows are moves in progress${role === 'group_manager' ? '' : ' visible to you'}.`}
          </desc>
          <defs>
            {(['outbound', 'return', 'planned'] as const).map((kind) => (
              <marker key={kind} id={`${uid}-arrow-${kind}`} viewBox="0 0 6 6" refX="5" refY="3" markerWidth="3.6" markerHeight="3.6" orient="auto">
                <path d="M0,0 L6,3 L0,6 z" className={`ov-board-arrowhead ov-board-arrowhead--${kind}`} />
              </marker>
            ))}
          </defs>
          {flows.map((flow) => {
            const geometry = flowGeometry(flow)
            if (!geometry) return null
            const href = boardFlowHref(flow)
            return (
              <a key={`${flow.from}-${flow.to}-${flow.kind}`} href={href} className={`ov-board-flow ov-board-flow--${flow.kind}`} aria-label={flowName(flow)} onClick={(event) => follow(event, href)}>
                <title>{`${plural(flow.count, 'vehicle')} ${flow.from} → ${flow.to} · ${KIND_WORDS[flow.kind].toLowerCase()}`}</title>
                <path d={geometry.d} className="ov-board-flow-hit" />
                <circle cx={geometry.label.x} cy={geometry.label.y} r={BADGE_HIT_RADIUS} className="ov-board-hit" />
                <path d={geometry.d} className="ov-board-flow-line" markerEnd={`url(#${uid}-arrow-${flow.kind})`} />
                <circle cx={geometry.label.x} cy={geometry.label.y} r={BADGE_RADIUS} className="ov-board-flow-badge" />
                <text x={geometry.label.x} y={geometry.label.y} dy="0.35em" textAnchor="middle" fontSize={BADGE_SIZE} className="ov-board-flow-count">{flow.count}</text>
              </a>
            )
          })}
          {STORE_BOARD_POSITIONS.map((configured) => {
            const pin = position(configured.store)!
            const storeCounts = counts.get(pin.store)
            if (!storeCounts) return null
            const value = storeCounts[pinMetric.key] as number
            const href = pinMetric.href(pin.store)
            const label = labelPlacement(pin)
            const home = pin.store === homeStore
            return (
              <a key={pin.store} href={href} className={`ov-board-pin${home ? ' is-home' : ''}`} aria-label={`Store board pin, ${pin.store}: ${plural(value, 'vehicle')} ${pinMetric.phrase}`} onClick={(event) => follow(event, href)}>
                <title>{`${pin.store} · ${storeCounts.onLot} on lot · ${storeCounts.away} away · ${storeCounts.inTransit} in transit`}</title>
                <circle cx={pin.x} cy={pin.y} r={HIT_RADIUS} className="ov-board-hit" />
                <circle cx={pin.x} cy={pin.y} r={PIN_RADIUS + 1.4} className="ov-board-pin-focus" />
                <circle cx={pin.x} cy={pin.y} r={PIN_RADIUS} className="ov-board-pin-dot" />
                <text x={pin.x} y={pin.y} dy="0.35em" textAnchor="middle" fontSize={COUNT_SIZE} className="ov-board-pin-count">{value}</text>
                <text x={label.x} y={label.y} textAnchor={label.anchor} fontSize={LABEL_SIZE} className="ov-board-pin-label">{pin.store}</text>
              </a>
            )
          })}
        </svg>
        <figcaption className="ov-board-caption">Pins: {pinMetric.label.toLowerCase()} by home store · schematic positions, not a map</figcaption>
      </figure>
      <div className="ov-board-moves">
        <h3 className="ov-subheading">Moves on the board</h3>
        {flows.length ? (
          <ul>
            {flows.map((flow) => (
              <li key={`${flow.from}-${flow.to}-${flow.kind}`}>
                <Link to={boardFlowHref(flow)} aria-label={flowName(flow)}>
                  <svg className={`ov-board-swatch ov-board-swatch--${flow.kind}`} viewBox="0 0 24 8" aria-hidden="true"><line x1="1" y1="4" x2="23" y2="4" /></svg>
                  <span className="ov-board-route">{flow.from} → {flow.to}</span>
                  <span className="ov-board-kind">{KIND_WORDS[flow.kind]}</span>
                  <strong>{flow.count}</strong>
                </Link>
              </li>
            ))}
          </ul>
        ) : <p className="ov-empty">No moves in progress{role === 'group_manager' ? '' : ' that you can see'}.</p>}
        <dl className="ov-board-legend" aria-label="Board key">
          {(['outbound', 'return', 'planned'] as const).map((kind) => (
            <div key={kind}>
              <dt><svg className={`ov-board-swatch ov-board-swatch--${kind}`} viewBox="0 0 24 8" aria-hidden="true"><line x1="1" y1="4" x2="23" y2="4" /></svg>{KIND_WORDS[kind]}</dt>
              <dd>{LEGEND[kind]}</dd>
            </div>
          ))}
          <div><dt><span className="ov-board-legend-home" aria-hidden="true" />Your home store</dt><dd>Blue ring; pin numbers link to the list behind them</dd></div>
        </dl>
      </div>
      {/* A table ignores width:1px, so the clip lives on a wrapper. */}
      <div className="sr-only">
      <table>
        <caption>Store board counts by home store</caption>
        <thead><tr><th scope="col">Store</th><th scope="col">On lot</th><th scope="col">Away</th><th scope="col">In transit</th><th scope="col">Holds</th><th scope="col">Waiting for service</th><th scope="col">Unaccounted</th></tr></thead>
        <tbody>
          {overview.stores.map((entry) => (
            <tr key={entry.store}><th scope="row">{entry.store}</th><td>{entry.onLot}</td><td>{entry.away}</td><td>{entry.inTransit}</td><td>{entry.holds}</td><td>{entry.waitingForService}</td><td>{entry.unaccounted}</td></tr>
          ))}
        </tbody>
      </table>
      </div>
      <p className="ov-source">Arrows: {role === 'group_manager' ? 'moves in progress' : 'moves as visible to you'} · Inventory Flow move ledger · live</p>
    </div>
  )

  if (collapsible) {
    return (
      <section className="ov-section ov-board" aria-labelledby="ov-board-title">
        <details className="ov-board-details" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
          <summary aria-expanded={open}>
            {heading}
            <span className="ov-board-summary-meta">{plural(flows.reduce((total, flow) => total + flow.count, 0), 'move')}</span>
            <ChevronDown aria-hidden="true" />
          </summary>
          {body}
        </details>
      </section>
    )
  }
  return (
    <section className="ov-section ov-board" aria-labelledby="ov-board-title">
      <header className="ov-section-heading">{heading}</header>
      {body}
    </section>
  )
}
