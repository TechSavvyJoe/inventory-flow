import type { ReactNode } from 'react'

type Tone = 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'neutral'

export function StateLabel({ tone = 'neutral', icon, children }: { tone?: Tone; icon?: ReactNode; children: ReactNode }) {
  return (
    <span className={`state-label state-${tone}`}>
      {icon}
      <span>{children}</span>
    </span>
  )
}
