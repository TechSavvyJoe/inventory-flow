interface Vehicle { make?: string | null; model?: string | null; year?: string | number | null; originalMarket?: string | null; windowSticker?: { originalMarket?: string | null } | null; documents?: { windowSticker?: { originalMarket?: string | null } | null } }
export function manufacturerReferences(vehicle: Vehicle): Array<{ label: string; url: string; modelYear: number | null }>;
export function equipmentTalkingPoints(vehicle: Vehicle, labels: string[]): Array<{ id: string; title: string; detail: string; url: string | null }>;
