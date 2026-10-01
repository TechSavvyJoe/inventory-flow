// Reviewed official US references. These explain equipment; they never add
// installed features, package contents or capability figures to a vehicle.
const fordGuide = (year, model, file) => ({ make: 'ford', year, model, label: `${year} Ford ${model} order guide`, url: `https://www.fromtheroad.ford.com/content/dam/fordmediasite/us/en/library/${year}/order-guides/${file}.pdf` });
const REFERENCES = [
  fordGuide(2025, 'F-150', '2025_Ford_F-150_Order_Guide'),
  fordGuide(2025, 'Bronco Sport', '2025_Ford_Bronco_Sport_Order_Guide'),
  fordGuide(2026, 'Bronco Sport', '2026_Ford_Bronco_Sport_Order_Guide'),
  { make: 'ford', year: 2024, model: 'F-150', label: '2024 F-150 changes & available features', url: 'https://www.fromtheroad.ford.com/us/en/articles/2023/the-new-2024-ford-f-150--a-built-ford-tough-truck-that-is-smart' },
  { make: 'ford', year: 2023, model: 'Bronco Sport', label: '2023 Bronco Sport option names', url: 'https://shop.ford.com/quote/broncosport/2023/' },
  { make: 'lincoln', year: 2024, model: 'Nautilus', label: '2024 Nautilus features & available packages', url: 'https://www.fromtheroad.ford.com/us/en/articles/2024/sanctuary-for-the-senses--all-new-lincoln-nautilus-debuts-with-r' },
  { make: 'lincoln', year: 2022, model: 'Corsair', label: '2022 Corsair towing & configuration guide', url: 'https://www.lincoln.com/cmslibs/content/dam/brand_lincoln/en_us/brand/resources/general/pdf/22%20Lincoln%20Corsair_Towing%20Information_Sep23.pdf' },
  { make: 'toyota', year: 2024, model: 'Corolla', label: '2024 Corolla features & package matrix', url: 'https://www.toyota.com/content/dam/toyota/brochures/pdf/2024/corolla_ebrochure.pdf' },
];
const normalize = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const permitsUsReference = vehicle => {
  const market = normalize(vehicle.originalMarket ?? vehicle.windowSticker?.originalMarket ?? vehicle.documents?.windowSticker?.originalMarket);
  return !market || ['us', 'usa', 'unitedstates', 'unitedstatesofamerica'].includes(market);
};
const FORD_TECH = 'https://www.ford.com/technology/driver-assist-technology/';
const BLUECRUISE = 'https://www.fromtheroad.ford.com/us/en/articles/2026/bluecruise--technology-designed-for-trust-driver-collaboration';
const LINCOLN_NAUTILUS = REFERENCES.find(item => item.make === 'lincoln' && item.model === 'Nautilus').url;
const LINCOLN_BENEFITS = 'https://www.lincoln.com/ownership-benefits/';
const CHEVROLET_CRUISE = 'https://www.chevrolet.com/technology/super-cruise';
const TOYOTA_SAFETY = 'https://www.buyatoyota.com/home/tools/toyota-safety-sense/';

export function manufacturerReferences(vehicle) {
  const make = normalize(vehicle.make);
  const model = normalize(vehicle.model);
  const year = Number(vehicle.year);
  const exact = REFERENCES.filter(item => permitsUsReference(vehicle) && item.make === make && item.year === year && normalize(item.model) === model)
    .map(({ label, url }) => ({ label, url, modelYear: year }));
  const general = make === 'ford' ? [
    { label: 'Ford towing guides by year', url: 'https://www.ford.com/towing/', modelYear: null },
    { label: 'Ford driver-assist explanations', url: FORD_TECH, modelYear: null },
  ] : make === 'lincoln' ? [{ label: 'Lincoln ownership benefits & terms', url: LINCOLN_BENEFITS, modelYear: null }]
    : make === 'toyota' ? [{ label: 'Toyota Safety Sense versions', url: TOYOTA_SAFETY, modelYear: null }]
      : make === 'chevrolet' ? [{ label: 'Chevrolet Super Cruise explanation', url: CHEVROLET_CRUISE, modelYear: null }] : [];
  return [...exact, ...general];
}

/** Contextual desk/demo prompts, matched only to explicitly captured labels. */
export function equipmentTalkingPoints(vehicle, labels) {
  const make = normalize(vehicle.make);
  const text = labels.filter(label => typeof label === 'string').join(' | ');
  const points = [];
  const add = (id, title, detail, url) => points.push({ id, title, detail, url });
  if (['ford', 'lincoln'].includes(make)) {
    if (/bluecruise|activeglide/i.test(text)) add('hands-free', 'Hands-free driving', 'Check the exact system, enabled features and active connected-service plan before the demonstration. Adaptive cruise by itself does not establish hands-free capability.', BLUECRUISE);
    if (/co[- ]?pilot\s*360/i.test(text)) add('driver-assist', 'Driver-assist package', 'Compare the captured package name and its listed contents. Co-Pilot360, Assist and Active packages are different; do not assume adaptive cruise or hands-free driving from the family name.', FORD_TECH);
    if (make === 'ford' && /tow|trailer|hitch/i.test(text)) add('towing', 'Towing conversation', 'Match the model year, engine, axle, cab and installed towing equipment in the guide. Check the vehicle labels before quoting its payload or trailer rating.', 'https://www.ford.com/towing/');
    if (/package|equipment\s+group|appearance|edition/i.test(text)) add('packages', 'What is in this package?', 'Use the captured option code and VIN-specific contents above. Compare the same model year and market; package contents, deletions and freestanding options can change.', manufacturerReferences(vehicle).find(item => item.modelYear)?.url ?? null);
  }
  if (make === 'lincoln' && permitsUsReference(vehicle) && Number(vehicle.year) === 2024 && normalize(vehicle.model) === 'nautilus') {
    if (/revel/i.test(text)) add('audio', 'Revel audio demonstration', 'Distinguish the captured Revel system from Revel Ultima 3D. Demonstrate its audio controls; use the sticker for the actual system and speaker count.', LINCOLN_NAUTILUS);
    if (/perfect\s+position|massage|multi[- ]contour/i.test(text)) add('seats', 'Seat comfort demonstration', 'Show the captured seat adjustments and massage controls. Use this vehicle’s equipment record for its adjustment count and included functions.', LINCOLN_NAUTILUS);
    if (/jet\s+appearance|black\s+label/i.test(text)) add('appearance', 'Appearance & interior theme', 'Compare this vehicle’s wheels, exterior treatment and interior theme with its original equipment. Confirm any ownership benefits separately.', LINCOLN_NAUTILUS);
  }
  if (make === 'chevrolet' && /super\s+cruise/i.test(text)) add('hands-free', 'Super Cruise demonstration', 'Confirm equipped hardware, active OnStar service and the supported road before demonstrating. Do not equate it with ordinary adaptive cruise.', CHEVROLET_CRUISE);
  if (make === 'toyota' && /toyota\s+safety\s+sense|\btss\b/i.test(text)) add('driver-assist', 'Toyota Safety Sense version', 'Use the captured version and model-year guide to identify its functions; different versions and models have different features.', TOYOTA_SAFETY);
  return points;
}
