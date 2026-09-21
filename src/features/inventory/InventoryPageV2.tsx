import { InventoryPage } from './InventoryPage'
import { InventoryExperienceV2 } from './InventoryExperienceV2'

/** The premium presentation uses the same authorized loading and navigation as inventory. */
export function InventoryPageV2({ homeMode = false }: { homeMode?: boolean }) {
  return <InventoryPage homeMode={homeMode} experienceComponent={InventoryExperienceV2} />
}
