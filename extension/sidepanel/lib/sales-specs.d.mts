type Specifications = { engine: string | null; transmission: string | null; drivetrain: string | null; exteriorColor: string | null; interiorColor: string | null };
type Document = Partial<Specifications> & { dataState?: string };
export function salesSpecifications(record: Partial<Specifications>, documents?: { windowSticker?: Document | null; factoryEquipment?: Document | null }): Specifications;
