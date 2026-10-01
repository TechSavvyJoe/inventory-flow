import type { ComparisonPlan } from './takehome-comparison.mjs'
export function createTakeHomePdf(models: Array<{ vin: string; [key: string]: unknown }>, title: string, options?: { fetcher?: typeof fetch; now?: Date; base?: string; layout?:'detailed'|'comparison'; comparisonObserver?:(plan:ComparisonPlan)=>void; layoutObserver?:(layout:unknown)=>void }): Promise<Blob>
export function customerTakeHomePriceFacts(model: { mileage?: number | null; stockNumber?: string | null; [key: string]: unknown }): Array<{ label: string; value: string }>
