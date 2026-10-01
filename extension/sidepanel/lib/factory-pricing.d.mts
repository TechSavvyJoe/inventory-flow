export interface FactoryPriceSource { dataState?: string; totalMsrp?: number | null; basePrice?: number | null; pricingCurrency?: string | null }
export interface FactoryPrice { value: number | null; source: 'window-sticker' | 'vauto' | null; currency: string | null }
export function factoryPricing(vehicle?: { windowSticker?: FactoryPriceSource | null; factoryEquipment?: FactoryPriceSource | null }): { original: FactoryPrice; base: FactoryPrice }
export function factoryPriceLabel(source: FactoryPrice['source'], base?: boolean): string
export function formatFactoryPrice(value: number | null, currency: string | null): string
