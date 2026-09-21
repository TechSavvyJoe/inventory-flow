import { useState } from 'react'
import './CertifiedBadge.css'

// Dealer-confirmed: certified inventory at the three Ford stores is Blue Certified.
export function certificationBadge(homeStore?: string | null) {
  if (homeStore === 'Lincoln') return { brand: 'lincoln', label: 'Lincoln Certified Pre-Owned', src: '/resource-brands/lincoln-certified.png' }
  if (['Howell', 'Fowlerville', 'Ford Detroit'].includes(homeStore ?? '')) return { brand: 'ford', label: 'Ford Blue Certified', src: '/resource-brands/ford-blue-certified.svg' }
  return { brand: 'generic', label: 'Certified pre-owned', src: null }
}

export function CertifiedBadge({ certified, homeStore }: { certified?: boolean | null; homeStore?: string | null }) {
  const badge = certificationBadge(homeStore)
  const [failedSource, setFailedSource] = useState<string | null>(null)
  if (!certified) return null
  return <span className={`vehicle-certified-badge vehicle-certified-badge--${badge.brand}`} title={badge.label}>
    {badge.src && failedSource !== badge.src
      ? <><img src={badge.src} alt={badge.label} onError={() => setFailedSource(badge.src)} />{badge.brand === 'ford' ? <span aria-hidden="true">Blue Certified</span> : null}</>
      : <span>{badge.label}</span>}
  </span>
}
