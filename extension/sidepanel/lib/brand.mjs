// Store logos, mirroring src/app/storeBranding.ts. The PNGs in ../brands are
// downscaled copies of the app's own public brand assets.

// Natural sizes are 144×60, 144×62 and 144×124; the stylesheet sets the height.
const BRANDS = Object.freeze({
  'bob-maxey-ford': { src: '../brands/bob-maxey-ford.png', alt: 'Bob Maxey Ford', wide: true },
  'bob-maxey-fowlerville': { src: '../brands/bob-maxey-fowlerville.png', alt: 'Bob Maxey Ford of Fowlerville', wide: true },
  lincoln: { src: '../brands/lincoln.png', alt: 'Bob Maxey Lincoln', wide: false },
})

export function brandFor(store) {
  switch (String(store ?? '').trim()) {
    case 'Howell':
    case 'Ford Detroit':
      return BRANDS['bob-maxey-ford']
    case 'Fowlerville':
      return BRANDS['bob-maxey-fowlerville']
    case 'Lincoln':
      return BRANDS.lincoln
    default:
      return null
  }
}
