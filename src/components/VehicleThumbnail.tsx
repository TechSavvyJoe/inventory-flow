import { useState } from 'react'
import { CarFront } from 'lucide-react'
import type { VehicleRecord } from '../types'

export function VehicleThumbnail({ vehicle, className = '' }: { vehicle?: VehicleRecord; className?: string }) {
  const sources = [...new Set([vehicle?.imageUrl, ...(vehicle?.imageUrls ?? [])].filter((url): url is string => Boolean(url)))]
  const sourceKey = sources.join('|')
  const [attempt, setAttempt] = useState({ key: sourceKey, index: 0 })
  const index = attempt.key === sourceKey ? attempt.index : 0
  return <span className={`workflow-photo ${className}`}>
    {sources[index] ? <img src={sources[index]} alt={vehicle?.vehicleName ?? 'Vehicle'} width={96} height={72} loading="lazy" decoding="async" onError={() => setAttempt({ key: sourceKey, index: index + 1 })} /> : <CarFront aria-label="Vehicle photo not provided" />}
  </span>
}
