import { useState } from 'react'
import './SourceWordmark.css'

export type SourceWordmarkBrand = 'autocheck' | 'carfax' | 'ford' | 'lincoln' | 'chevrolet'

const WORDMARKS: Record<SourceWordmarkBrand, string> = {
  autocheck: '/resource-brands/autocheck.svg',
  carfax: '/resource-brands/carfax.svg',
  ford: '/resource-brands/ford.svg',
  lincoln: '/resource-brands/lincoln.svg',
  chevrolet: '/resource-brands/chevrolet.svg',
}

/** Decorative source artwork; keep the adjacent visible source name authoritative. */
export function SourceWordmark({ brand, label }: { brand: SourceWordmarkBrand | null | undefined; label: string }) {
  const [failedBrand, setFailedBrand] = useState<SourceWordmarkBrand | null>(null)
  return <span className="source-wordmark">
    {brand && failedBrand !== brand ? <img
      className={`source-wordmark__image source-wordmark__image--${brand}`}
      src={WORDMARKS[brand]}
      alt=""
      aria-hidden="true"
      onError={() => setFailedBrand(brand)}
    /> : null}
    <span>{label}</span>
  </span>
}
