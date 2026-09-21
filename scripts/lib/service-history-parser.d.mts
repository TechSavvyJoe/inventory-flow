export interface ServiceHistoryOrderIndex {
  repairOrderNumber: string
  dealerCode: string
  openDate: string
  closeDate: string
  odometer: number | null
}

export interface ServiceHistoryInspection {
  status: 'confirmed' | 'not_identified'
  type?: string
}

export interface ServiceHistoryRepairOrder extends ServiceHistoryOrderIndex {
  detailComplete: boolean
  inspection: ServiceHistoryInspection
  parts: Array<{ description: string; quantity?: number; partNumber?: string }>
  laborOperations: Array<{ code: string; description: string }>
  services: string[]
  summary: string
}

export function repairOrderFingerprint(order: Partial<ServiceHistoryOrderIndex>): string
export function parseServiceHistoryIndex(html: string, expectedVin: string):
  | { state: 'ok'; repairOrders: ServiceHistoryOrderIndex[] }
  | { state: string; repairOrders?: ServiceHistoryOrderIndex[] }
export function parseServiceHistoryDetails(html: string, expectedOrder: ServiceHistoryOrderIndex):
  | { state: 'ok'; repairOrder: ServiceHistoryRepairOrder }
  | { state: string; repairOrder?: never }
export function serviceCategories(order: Pick<ServiceHistoryRepairOrder, 'parts' | 'laborOperations' | 'inspection'>): string[]
export function summarizeRepairOrder(order: Pick<ServiceHistoryRepairOrder, 'parts' | 'laborOperations' | 'inspection'>): string
