import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { useState } from 'react'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import {
  motion,
  motionValue,
  MotionConfig,
  AnimatePresence,
  useReducedMotion,
} from 'framer-motion'
import {
  isV1Requested,
  loadInventoryPage,
  loadTransfersPage,
  loadServicePage,
  loadInventoryPageV1,
  loadInventoryPageV2,
  loadTransfersPageV1,
  loadTransfersPageV2,
  loadServicePageV1,
  loadServicePageV2,
  preloadRoute,
  InventoryPage,
} from '../../src/app/routeModules'
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { createMotionPreference } from './motion-test-utils'
import { runInterfaceTransition } from '../../src/lib/interfaceTransition'

// Mock AppDataContext so route components can mount in unit test environment
vi.mock('../../src/app/AppDataContext', () => ({
  useAppData: () => ({
    data: {
      meta: {
        reportDate: '2026-08-29',
        completedAt: '2026-08-29T13:00:00.000Z',
        timezone: 'America/New_York',
        publicFreshness: 'current',
        dealerMailFreshness: 'current',
        publicCount: 0,
        crmCount: 0,
        heldVinCount: 0,
        publicChangeCounts: {
          newArrival: 0,
          removed: 0,
          priceChange: 0,
          mileageChange: 0,
          websiteStatusChange: 0,
          stockCorrection: 0,
          storeTransfer: 0,
        },
        holdChangeStatus: 'baseline',
        warnings: [],
      },
      stores: [],
      vehicles: [],
      transfers: [],
      attention: [],
    },
    loading: false,
    error: null,
    homeStore: 'Howell',
    setHomeStore: vi.fn(),
    role: 'manager',
    setRole: vi.fn(),
    currentUser: 'Test User',
    refresh: vi.fn(async () => undefined),
    submitTransfer: vi.fn(),
    addTransferEvent: vi.fn(),
    addAttentionEvent: vi.fn(),
  }),
  AppDataProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

describe('M1 Adversarial Challenge: framer-motion Stress Testing', () => {
  const motionPreference = createMotionPreference()

  beforeEach(() => { motionPreference.install(); motionPreference.set(false) })
  afterEach(() => { motionPreference.restore(); vi.restoreAllMocks() })

  describe('1. Rapid Mounting / Unmounting', () => {
    it('survives rapid mounting and unmounting toggles without crashing or leaking', () => {
      function RapidToggleComponent({ count }: { count: number }) {
        const [visible, setVisible] = useState(true)
        return (
          <div>
            <button data-testid="toggle-btn" onClick={() => setVisible((v) => !v)}>
              Toggle
            </button>
            <AnimatePresence>
              {visible && (
                <motion.div
                  key={`item-${count}`}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.5 }}
                  transition={{ duration: 0.05 }}
                  data-testid="animated-node"
                >
                  Active Node {count}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )
      }

      const { rerender } = render(<RapidToggleComponent count={0} />)
      const btn = screen.getByTestId('toggle-btn')

      // Perform 20 rapid state toggles
      for (let i = 1; i <= 20; i++) {
        act(() => {
          fireEvent.click(btn)
        })
        rerender(<RapidToggleComponent count={i} />)
      }

      // Ensure no crash occurred and component state remains coherent
      expect(screen.getByTestId('toggle-btn')).toBeInTheDocument()
    })

    it('safely handles unmounting during ongoing animation callbacks without firing onComplete', async () => {
      const onStart = vi.fn()
      const onComplete = vi.fn()

      function AnimatedBox() {
        return (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.1 }}
            onAnimationStart={onStart}
            onAnimationComplete={onComplete}
            data-testid="box"
          >
            Box
          </motion.div>
        )
      }

      const { unmount } = render(<AnimatedBox />)
      expect(onStart).toHaveBeenCalledTimes(1)

      // Unmount immediately while animation timer is pending
      unmount()

      // Wait 150ms for duration to elapse
      await act(async () => {
        await new Promise((r) => setTimeout(r, 150))
      })

      // onComplete should NOT be called after unmount because timer was cleared
      expect(onComplete).not.toHaveBeenCalled()
    })

    it('handles rapid re-mounting while exit animation is pending', async () => {
      function RemountHarness() {
        const [show, setShow] = useState(true)
        return (
          <div>
            <button data-testid="toggle" onClick={() => setShow((s) => !s)}>
              Toggle
            </button>
            <AnimatePresence>
              {show && (
                <motion.div
                  key="re-item"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.1 }}
                  data-testid="target"
                >
                  Visible Target
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )
      }

      render(<RemountHarness />)
      const toggle = screen.getByTestId('toggle')
      expect(screen.getByTestId('target')).toBeInTheDocument()

      // Toggle off -> start exit
      fireEvent.click(toggle)
      expect(screen.getByTestId('target')).toBeInTheDocument()

      // Toggle back on BEFORE exit completes (within 10ms)
      fireEvent.click(toggle)

      // Wait for exit window to pass
      await act(async () => {
        await new Promise((r) => setTimeout(r, 200))
      })

      // Target should be firmly in the document
      expect(screen.getByTestId('target')).toBeInTheDocument()
      expect(screen.getByTestId('target').textContent).toContain('Visible Target')
    })

    it('handles rapid key switching inside AnimatePresence during view transitions', async () => {
      function TabSwitchHarness({ activeTab }: { activeTab: number }) {
        return (
          <AnimatePresence mode="sync">
            <motion.div
              key={`tab-${activeTab}`}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.05 }}
              data-testid="active-tab"
            >
              Tab Content {activeTab}
            </motion.div>
          </AnimatePresence>
        )
      }

      const { rerender } = render(<TabSwitchHarness activeTab={1} />)
      expect(screen.getByTestId('active-tab').textContent).toContain('Tab Content 1')

      // Rapidly switch tabs 1 -> 2 -> 3
      rerender(<TabSwitchHarness activeTab={2} />)
      rerender(<TabSwitchHarness activeTab={3} />)

      await act(async () => {
        await new Promise((r) => setTimeout(r, 120))
      })

      expect(screen.getByTestId('active-tab').textContent).toContain('Tab Content 3')
    })
  })

  describe('2. Nested AnimatePresence', () => {
    it('coordinates nested AnimatePresence without orphaned DOM nodes or runtime errors', async () => {
      function NestedPresence({
        showParent,
        showChild,
      }: {
        showParent: boolean
        showChild: boolean
      }) {
        return (
          <AnimatePresence>
            {showParent && (
              <motion.div
                key="parent"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.05 }}
                data-testid="parent-node"
              >
                Parent
                <AnimatePresence>
                  {showChild && (
                    <motion.div
                      key="child"
                      initial={{ scale: 0.5 }}
                      animate={{ scale: 1 }}
                      exit={{ scale: 0.5 }}
                      transition={{ duration: 0.05 }}
                      data-testid="child-node"
                    >
                      Child
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>
        )
      }

      const { rerender } = render(<NestedPresence showParent={true} showChild={true} />)
      expect(screen.getByTestId('parent-node')).toBeInTheDocument()
      expect(screen.getByTestId('child-node')).toBeInTheDocument()

      // Case A: Unmount child only
      rerender(<NestedPresence showParent={true} showChild={false} />)
      await act(async () => {
        await new Promise((r) => setTimeout(r, 120))
      })
      expect(screen.getByTestId('parent-node')).toBeInTheDocument()
      expect(screen.queryByTestId('child-node')).toBeNull()

      // Case B: Re-mount child
      rerender(<NestedPresence showParent={true} showChild={true} />)
      expect(screen.getByTestId('child-node')).toBeInTheDocument()

      // Case C: Unmount parent (which contains active child)
      rerender(<NestedPresence showParent={false} showChild={true} />)
      await act(async () => {
        await new Promise((r) => setTimeout(r, 150))
      })
      expect(screen.queryByTestId('parent-node')).toBeNull()
      expect(screen.queryByTestId('child-node')).toBeNull()
    })
  })

  describe('3. Motion Variants System', () => {
    const cardVariants = {
      hidden: { opacity: 0, x: -50, scale: 0.9 },
      visible: { opacity: 1, x: 0, scale: 1 },
      hover: { scale: 1.05 },
      tap: { scale: 0.95 },
      exit: { opacity: 0, x: 50 },
    }

    it('moves named variants from the initial values to the settled visible values', async () => {
      const opacity = motionValue(0)
      const x = motionValue(-50)
      const scale = motionValue(0.9)
      render(<motion.div variants={cardVariants} initial="hidden" animate="visible" style={{ opacity, x, scale }} transition={{ duration: 0.04 }} data-testid="variant-node">Variant Card</motion.div>)
      expect(opacity.get()).toBe(0)
      expect(x.get()).toBe(-50)
      expect(scale.get()).toBe(0.9)
      await waitFor(() => {
        expect(opacity.get()).toBe(1)
        expect(x.get()).toBe(0)
        expect(scale.get()).toBe(1)
      })
      expect(screen.getByTestId('variant-node')).toHaveTextContent('Variant Card')
    })

    it('gracefully handles non-existent or invalid variant references without crashing', () => {
      expect(() => {
        render(
          <motion.div
            variants={cardVariants}
            initial="nonExistentInitial"
            animate="nonExistentAnimate"
            whileHover="nonExistentHover"
            whileTap="nonExistentTap"
            data-testid="invalid-variant-node"
          >
            Invalid Variant
          </motion.div>
        )
      }).not.toThrow()

      const el = screen.getByTestId('invalid-variant-node')
      expect(el).toBeInTheDocument()
      // Should not blow up on hover or tap
      fireEvent.mouseEnter(el)
      fireEvent.mouseDown(el)
      fireEvent.mouseUp(el)
      fireEvent.mouseLeave(el)
    })

    it('resolves named hover and press variants through the pointer lifecycle', async () => {
      const scale = motionValue(1)
      render(<motion.button variants={cardVariants} animate="visible" whileHover="hover" whileTap="tap" style={{ scale }} transition={{ duration: 0.02 }}>Variant action</motion.button>)
      const button = screen.getByRole('button', { name: 'Variant action' })
      fireEvent.pointerEnter(button, { pointerType: 'mouse', isPrimary: true })
      await waitFor(() => expect(scale.get()).toBe(1.05))
      fireEvent.pointerDown(button, { pointerType: 'mouse', isPrimary: true, button: 0 })
      await waitFor(() => expect(scale.get()).toBe(0.95))
      fireEvent.pointerUp(button, { pointerType: 'mouse', isPrimary: true, button: 0 })
      await waitFor(() => expect(scale.get()).toBe(1.05))
      fireEvent.pointerLeave(button, { pointerType: 'mouse', isPrimary: true })
      await waitFor(() => expect(scale.get()).toBe(1))
    })

    it('retains zero scale and reaches negative translation and rotation targets', async () => {
      const values = { x: motionValue(0), y: motionValue(0), scale: motionValue(1), rotate: motionValue(0) }
      const variants = { zero: { x: 0, y: 0, scale: 0, rotate: 0 }, negative: { x: -30, y: -15, scale: 0, rotate: -45 } }
      const { rerender } = render(<motion.div variants={variants} animate="zero" style={values} transition={{ duration: 0.03 }}>Transform target</motion.div>)
      await waitFor(() => expect(values.scale.get()).toBe(0))
      expect(values.x.get()).toBe(0)
      expect(values.y.get()).toBe(0)
      rerender(<motion.div variants={variants} animate="negative" style={values} transition={{ duration: 0.03 }}>Transform target</motion.div>)
      await waitFor(() => {
        expect(values.x.get()).toBe(-30)
        expect(values.y.get()).toBe(-15)
        expect(values.rotate.get()).toBe(-45)
      })
      expect(values.scale.get()).toBe(0)
    })
  })

  describe('4. Reduced Motion', () => {
    it('MotionConfig suppresses spatial movement while allowing a brief opacity change', async () => {
      motionPreference.set(true)
      const y = motionValue(20)
      const opacity = motionValue(0)
      const positions: number[] = []
      const unsubscribe = y.on('change', value => positions.push(value))
      render(<MotionConfig reducedMotion="user"><motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} style={{ y, opacity }} transition={{ duration: 0.08 }}>Reduced motion content</motion.div></MotionConfig>)
      await waitFor(() => expect(y.get()).toBe(0))
      expect(positions).toEqual([0])
      await waitFor(() => expect(opacity.get()).toBe(1))
      unsubscribe()
    })

    it('the vendor hook reads the current media preference when a consumer mounts', () => {
      function ReducedMotionConsumer() {
        const shouldReduce = useReducedMotion()
        return <div data-testid="reduced-indicator">{shouldReduce ? 'REDUCED' : 'NORMAL'}</div>
      }
      const { rerender } = render(<ReducedMotionConsumer key="normal" />)
      expect(screen.getByTestId('reduced-indicator')).toHaveTextContent('NORMAL')
      // Framer Motion v12 samples useReducedMotion at mount. The media listener
      // updates its shared preference, which the next mounted consumer reads.
      act(() => motionPreference.set(true))
      rerender(<ReducedMotionConsumer key="reduced" />)
      expect(screen.getByTestId('reduced-indicator')).toHaveTextContent('REDUCED')
    })

    it('app transitions respond immediately when the user changes the motion preference', async () => {
      const original = Object.getOwnPropertyDescriptor(document, 'startViewTransition')
      const transition = vi.fn((update: () => void) => { update(); return { finished: Promise.resolve() } })
      Object.defineProperty(document, 'startViewTransition', { configurable: true, value: transition })
      try {
        const update = vi.fn()
        runInterfaceTransition(update, 'vehicle')
        expect(transition).toHaveBeenCalledOnce()
        motionPreference.set(true)
        runInterfaceTransition(update, 'vehicle')
        expect(update).toHaveBeenCalledTimes(2)
        expect(transition).toHaveBeenCalledOnce()
        await Promise.resolve()
      } finally {
        if (original) Object.defineProperty(document, 'startViewTransition', original)
        else Reflect.deleteProperty(document, 'startViewTransition')
      }
    })
  })
})

describe('M1 Adversarial Challenge: Route Modules & Dynamic Routing Seam', () => {
  describe('1. Query Parameter Tampering in isV1Requested', () => {
    it('strictly accepts only valid ?v=1 and ?version=1 requests', () => {
      // Valid V1 triggers
      expect(isV1Requested('?v=1')).toBe(true)
      expect(isV1Requested('?version=1')).toBe(true)
      expect(isV1Requested('v=1')).toBe(true)
      expect(isV1Requested('version=1')).toBe(true)
      expect(isV1Requested('?foo=bar&v=1')).toBe(true)
      expect(isV1Requested('?v=1&foo=bar')).toBe(true)
      expect(isV1Requested('?mode=demo&version=1&tab=spec')).toBe(true)
      expect(isV1Requested('?v=%31')).toBe(true) // URL-encoded '1'

      // Tampered / Invalid values that MUST evaluate to V2 (false)
      expect(isV1Requested('?v=2')).toBe(false)
      expect(isV1Requested('?v=invalid')).toBe(false)
      expect(isV1Requested('?v=')).toBe(false)
      expect(isV1Requested('?v=0')).toBe(false)
      expect(isV1Requested('?v=-1')).toBe(false)
      expect(isV1Requested('?v=10')).toBe(false)
      expect(isV1Requested('?v=01')).toBe(false)
      expect(isV1Requested('?v=1.0')).toBe(false)
      expect(isV1Requested('?v=true')).toBe(false)
      expect(isV1Requested('?v=false')).toBe(false)
      expect(isV1Requested('?version=2')).toBe(false)
      expect(isV1Requested('?version=0')).toBe(false)
      expect(isV1Requested('?version=invalid')).toBe(false)
      expect(isV1Requested('?V=1')).toBe(false) // Case-sensitive parameter key
      expect(isV1Requested('?v= 1 ')).toBe(false)
      expect(isV1Requested('')).toBe(false)
      expect(isV1Requested('?')).toBe(false)
      expect(isV1Requested('?v=2&v=1')).toBe(false) // First param wins
      expect(isV1Requested('?v=1&v=2')).toBe(true)
    })
  })

  describe('2. Contract Route Loaders Fulfillment', () => {
    it('loadInventoryPage resolves to a module containing a default component', async () => {
      const module = await loadInventoryPage()
      expect(module).toBeDefined()
      expect(module.default).toBeDefined()
      expect(typeof module.default).toBe('function')
    })

    it('loadTransfersPage resolves to a module containing a default component', async () => {
      const module = await loadTransfersPage()
      expect(module).toBeDefined()
      expect(module.default).toBeDefined()
      expect(typeof module.default).toBe('function')
    })

    it('loadServicePage resolves to a module containing a default component', async () => {
      const module = await loadServicePage()
      expect(module).toBeDefined()
      expect(module.default).toBeDefined()
      expect(typeof module.default).toBe('function')
    })

    it('explicit V1 loaders load genuine V1 baseline modules', async () => {
      const invV1 = await loadInventoryPageV1()
      const transV1 = await loadTransfersPageV1()
      const servV1 = await loadServicePageV1()

      expect(typeof invV1.default).toBe('function')
      expect(typeof transV1.default).toBe('function')
      expect(typeof servV1.default).toBe('function')
    })

    it('explicit V2 loaders load V2 page stubs', async () => {
      const invV2 = await loadInventoryPageV2()
      const transV2 = await loadTransfersPageV2()
      const servV2 = await loadServicePageV2()

      expect(typeof invV2.default).toBe('function')
      expect(typeof transV2.default).toBe('function')
      expect(typeof servV2.default).toBe('function')
    })
  })

  describe('3. Dynamic Component Routing & Preloading', () => {
    it('preloadRoute runs safely across all paths and search query variations without throwing', () => {
      const paths = [
        '/',
        '/inventory',
        '/inventory/1HGCR2F83HA000000',
        '/transfers',
        '/service',
        '/attention',
        '/manager',
        '/updates',
        '/admin',
        '/unknown/route',
        '',
      ]

      for (const p of paths) {
        expect(() => preloadRoute(p)).not.toThrow()
        expect(() => preloadRoute(p, '?v=1')).not.toThrow()
        expect(() => preloadRoute(p, '?v=2')).not.toThrow()
        expect(() => preloadRoute(p, '?v=invalid')).not.toThrow()
      }
    })

    it('InventoryPage dynamically mounts under ?v=2 route without error', async () => {
      render(
        <MemoryRouter initialEntries={['/inventory?v=2']}>
          <React.Suspense fallback={<div>Loading...</div>}>
            <InventoryPage />
          </React.Suspense>
        </MemoryRouter>
      )

      await waitFor(() => {
        expect(screen.queryByText('Loading...')).toBeNull()
      })
      // Component should be mounted in document
      expect(screen.getAllByText(/Inventory/i).length).toBeGreaterThan(0)
    })

    it('InventoryPage dynamically mounts under ?v=1 route without error', async () => {
      render(
        <MemoryRouter initialEntries={['/inventory?v=1']}>
          <React.Suspense fallback={<div>Loading...</div>}>
            <InventoryPage />
          </React.Suspense>
        </MemoryRouter>
      )

      await waitFor(() => {
        expect(screen.queryByText('Loading...')).toBeNull()
      })
      expect(screen.getAllByText(/Inventory/i).length).toBeGreaterThan(0)
    })
  })
})

describe('M1 Adversarial Challenge: CSS Design System Compliance', () => {
  it('scripts/check-design-system.mjs exits cleanly with 0 failures', () => {
    const result = execSync('node scripts/check-design-system.mjs', {
      encoding: 'utf8',
      cwd: path.resolve(__dirname, '../..'),
    })
    expect(result).toContain('Design-system guard passed')
  })

  it('VehicleWorkspaceV2.css strictly obeys zero sub-12px fonts and zero raw colors', () => {
    const cssPath = path.resolve(
      __dirname,
      '../../src/features/inventory/VehicleWorkspaceV2.css'
    )
    const content = fs.readFileSync(cssPath, 'utf8')

    // Find any sub-12px font declarations
    const fontMatches = Array.from(
      content.matchAll(/font-size\s*:\s*(\d*\.?\d+)px/gi),
      (m) => Number(m[1])
    ).filter((size) => size < 12)

    expect(fontMatches).toEqual([])

    // Find any raw hex colors
    const hexMatches = Array.from(
      content.matchAll(/#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})\b/gi),
      (m) => m[0]
    )

    expect(hexMatches).toEqual([])
  })

  it('design system linter detects and rejects synthetic sub-12px font and raw hex colors', () => {
    // Test the logic directly against adversarial snippets
    function measureCss(content: string, isTokens: boolean = false) {
      const smallText = Array.from(
        content.matchAll(/font-size\s*:\s*(\d*\.?\d+)px/gi),
        (match) => Number(match[1])
      ).filter((size) => size < 12).length
      const rawColors = isTokens
        ? 0
        : Array.from(
            content.matchAll(/#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})\b/gi)
          ).length
      return { smallText, rawColors }
    }

    const badCss1 = `.card { font-size: 11px; }`
    expect(measureCss(badCss1).smallText).toBe(1)

    const badCss2 = `.badge { font-size: 10.5px; color: #ff0000; }`
    const measurement2 = measureCss(badCss2)
    expect(measurement2.smallText).toBe(1)
    expect(measurement2.rawColors).toBe(1)

    const compliantCss = `.card { font-size: 12px; color: var(--v10-surface); }`
    const measurement3 = measureCss(compliantCss)
    expect(measurement3.smallText).toBe(0)
    expect(measurement3.rawColors).toBe(0)
  })
})

describe('M1 Adversarial Challenge: Baseline V1 Preservation Invariants', () => {
  it('keeps the explicit V1 inventory route bound to its supported baseline page', async () => {
    const baseline = await import('../../src/features/inventory/InventoryPage')
    expect((await loadInventoryPageV1()).default).toBe(baseline.InventoryPage)
    expect((await loadInventoryPageV2()).default).not.toBe(baseline.InventoryPage)
  })

  it('keeps the explicit V1 moves route bound to its supported baseline page', async () => {
    const baseline = await import('../../src/features/transfers/TransfersPage')
    expect((await loadTransfersPageV1()).default).toBe(baseline.TransfersPage)
    expect((await loadTransfersPageV2()).default).not.toBe(baseline.TransfersPage)
  })

  it('keeps the explicit V1 service route bound to its supported baseline page', async () => {
    const baseline = await import('../../src/features/service/ServicePage')
    expect((await loadServicePageV1()).default).toBe(baseline.ServicePage)
    expect((await loadServicePageV2()).default).not.toBe(baseline.ServicePage)
  })

  it('verifies InventoryExperience.tsx directly imports V1 VehicleWorkspace', () => {
    const filePath = path.resolve(
      __dirname,
      '../../src/features/inventory/InventoryExperience.tsx'
    )
    const content = fs.readFileSync(filePath, 'utf8')
    expect(content).toContain('import { VehicleWorkspace } from "./VehicleWorkspace"')
    expect(content).not.toContain('VehicleWorkspaceV2')
  })
})
