// @ts-nocheck -- repository script helper is portable ESM.
import { describe, expect, it } from 'vitest'
import { countIdSelectors } from '../../scripts/lib/css-metrics.mjs'

describe('design-system CSS selector metrics', () => {
  it('counts the first selector after a blockless at-rule', () => {
    expect(countIdSelectors('@import "tokens.css"; #example { color: inherit; }')).toBe(1)
  })

  it('counts ID selectors inside nested at-rules and selector lists', () => {
    expect(countIdSelectors('@media (width > 40rem) { #one, .shell #two { display: grid; } .plain { display: block; } }')).toBe(2)
  })

  it('does not mistake at-rule arguments or quoted fragments for ID selectors', () => {
    expect(countIdSelectors('@supports selector(#synthetic) { a[href="#details"] { color: inherit; } }')).toBe(0)
  })
})
