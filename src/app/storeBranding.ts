import type { StoreName } from '../types'

export type StoreBrandThemeKey = 'ford' | 'fowlerville' | 'lincoln'
export type OemBrandKey = 'ford' | 'lincoln'
export type DealerGroupKey = 'bob-maxey'

export interface StoreBranding {
  assetPath: string
  altText: string
  dealerGroupKey: DealerGroupKey
  oemKey: OemBrandKey
  oemLabel: string
  themeKey: StoreBrandThemeKey
  sourceUrl: string
}

export const STORE_BRANDING = {
  Howell: {
    assetPath: '/brands/bob-maxey-ford.png',
    altText: 'Bob Maxey Ford of Howell',
    dealerGroupKey: 'bob-maxey',
    oemKey: 'ford',
    oemLabel: 'Ford',
    themeKey: 'ford',
    sourceUrl: 'https://www.bobmaxeyfordhowell.com/static/dealer-21521/logo.png',
  },
  Fowlerville: {
    assetPath: '/brands/bob-maxey-fowlerville.png',
    altText: 'Bob Maxey Ford in Fowlerville',
    dealerGroupKey: 'bob-maxey',
    oemKey: 'ford',
    oemLabel: 'Ford',
    themeKey: 'fowlerville',
    sourceUrl: 'https://www.bobmaxeyfordinfowlerville.com/static/dealer-23328/logo.png',
  },
  'Ford Detroit': {
    assetPath: '/brands/bob-maxey-ford.png',
    altText: 'Bob Maxey Ford Detroit',
    dealerGroupKey: 'bob-maxey',
    oemKey: 'ford',
    oemLabel: 'Ford',
    themeKey: 'ford',
    sourceUrl: 'https://www.bobmaxeyford.com/static/dealer-21520/logo.png',
  },
  Lincoln: {
    assetPath: '/brands/lincoln.png',
    altText: 'Lincoln',
    dealerGroupKey: 'bob-maxey',
    oemKey: 'lincoln',
    oemLabel: 'Lincoln',
    themeKey: 'lincoln',
    sourceUrl:
      'https://www.bobmaxeylincoln.com/static/industry-automotive/logos/supp/lincoln/transparent/lincoln.png',
  },
} as const satisfies Record<StoreName, StoreBranding>
