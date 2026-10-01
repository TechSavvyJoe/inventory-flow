// Fill gaps in the listing with explicit facts from this vehicle's documents.
// Never replace a published value or infer a capability from the model name.
export function salesSpecifications(record, documents = record) {
  const usable = source => source && ['current', 'stale'].includes(source.dataState);
  const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;
  const sticker = usable(documents.windowSticker) ? documents.windowSticker : null;
  const equipment = usable(documents.factoryEquipment) ? documents.factoryEquipment : null;
  return Object.fromEntries(['engine', 'transmission', 'drivetrain', 'exteriorColor', 'interiorColor']
    .map(key => [key, text(record[key]) || text(sticker?.[key]) || text(equipment?.[key])]));
}
