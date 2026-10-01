import { StrictMode } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useModalBackgroundIsolation } from './useModalBackgroundIsolation'

function Owner({ background }: { background:HTMLElement }) {
  useModalBackgroundIsolation({ active:true, backgroundRef:{ current:background } })
  return null
}

afterEach(() => { cleanup(); document.body.removeAttribute('style') })

describe('modal background ownership', () => {
  for (const firstClosed of ['first', 'second']) {
    it(`keeps the background locked until both owners close, ${firstClosed} first`, () => {
      const background = document.createElement('main')
      background.setAttribute('aria-hidden', 'false')
      document.body.style.setProperty('overflow', 'auto', 'important')
      document.body.style.setProperty('overscroll-behavior', 'contain')
      const first = render(<Owner background={background} />)
      const second = render(<Owner background={background} />)
      const owners = firstClosed === 'first' ? [first,second] : [second,first]
      owners[0].unmount()
      expect(background).toHaveAttribute('inert')
      expect(background).toHaveAttribute('aria-hidden', 'true')
      expect(document.body.style.overflow).toBe('hidden')
      owners[1].unmount()
      expect(background).not.toHaveAttribute('inert')
      expect(background).toHaveAttribute('aria-hidden', 'false')
      expect(document.body.style.overflow).toBe('auto')
      expect(document.body.style.getPropertyPriority('overflow')).toBe('important')
      expect(document.body.style.overscrollBehavior).toBe('contain')
    })
  }

  it('shares the scroll lock across different backgrounds and preserves pre-existing inert state in StrictMode', () => {
    const firstBackground = document.createElement('main')
    const secondBackground = document.createElement('section')
    secondBackground.setAttribute('inert', '')
    secondBackground.setAttribute('aria-hidden', 'true')
    const first = render(<StrictMode><Owner background={firstBackground} /></StrictMode>)
    const second = render(<StrictMode><Owner background={secondBackground} /></StrictMode>)
    first.unmount()
    expect(firstBackground).not.toHaveAttribute('inert')
    expect(firstBackground).not.toHaveAttribute('aria-hidden')
    expect(document.body.style.overflow).toBe('hidden')
    second.unmount()
    expect(secondBackground).toHaveAttribute('inert')
    expect(secondBackground).toHaveAttribute('aria-hidden', 'true')
    expect(document.body.style.overflow).toBe('')
  })
})
