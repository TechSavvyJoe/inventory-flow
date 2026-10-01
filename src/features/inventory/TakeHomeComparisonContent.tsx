import { useLayoutEffect, useRef } from 'react'
import type { ComparisonPlan } from '../../../extension/sidepanel/lib/takehome-comparison.mjs'
import { renderComparisonPage } from '../../../extension/sidepanel/lib/takehome-comparison-view.mjs'
import '../../../extension/sidepanel/lib/takehome-comparison-view.css'

export function TakeHomeComparisonContent({ plan }: { plan:ComparisonPlan }) {
  const container = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    container.current?.replaceChildren(...plan.pages.map(page => renderComparisonPage(plan, page)))
  }, [plan])
  return <div className="comparison-pages" ref={container} />
}
