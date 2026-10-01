# Sales information review — September 30, 2026

This review informs the 1.4.1 candidate on PR #61. It uses primary research and
official product information, then maps it to facts already present in Inventory
Flow. It does not authorize source collection, add a data provider or establish
production acceptance.

## What staff need during a sale

Cox Automotive's January 2026 Car Buyer Journey report surveyed 2,300 recent
buyers. It reports that 71% started with an open mind, 66% considered both new
and used vehicles, and 63% prefer a connected online/in-person process. These
findings support rapid comparison, specific differentiating equipment and a
portable customer document. They do not establish that any particular UI will
increase sales. [Cox Automotive study](https://www.coxautoinc.com/insights/cox-automotive-car-buyer-journey-study-finds-efficiency-digital-tools-and-ai-drive-record-satisfaction/)

| Sales question | Captured information to use | Employee table / VDP | Customer take-home |
| --- | --- | --- | --- |
| Which vehicle is this? | Photo, year/make/model/trim, stock, full VIN, exterior/interior | Visible identity and one-click copy | Large photo, name, stock, VIN |
| Is it worth comparing? | Selling price, mileage, engine, drive, transmission, body, published fuel economy | Compact adjacent facts | Price and specifications |
| What makes this one different? | Explicit equipment group, factory options, package contents, standout listing features | Short meaningful highlights, complete expandable ledger | Highlights and additional equipment |
| What do I need for the desk? | Original document MSRP and explicit base MSRP | Source/currency labels and plain-value base copy; no fabricated listing discount | Excluded at Joe's direction |
| What history should we discuss? | AutoCheck title, accident/damage, owners, use, score and reported odometer | History results plus direct report action | Captured title/accident results, score and owners |
| What coverage needs checking? | Explicit certified flag, named program, OASIS start, source warranty terms | Visible program and accessible estimate/official lookup | Certification benefits; no internal warranty estimates |
| Can we show or move it? | Hold evidence, service readiness, confirmed or source-reported location, open move | Distinct signals and next actions | Excluded; confirm with store |
| What can the customer retain? | Public photos/specifications/equipment/history and listing | Save list, customer summary, take-home actions | Print, Save PDF, PDF Share, multiple vehicles |

The candidate fills only missing engine, transmission, drivetrain and color
values from usable VIN-specific sticker/vAuto documents. Published values take
priority. It does not infer optional equipment, payload, towing capacity, seat
count, battery health, remaining coverage or availability from a model name.

## Evidence and presentation boundaries

- **Equipment:** vAuto describes attribute-focused merchandising and visual
  presentations as tools for helping shoppers understand inventory. This is a
  vendor's workflow description, not independent evidence of conversion gains.
  The app uses captured option/package content instead of generic marketing
  claims. [vAuto merchandising](https://www.vauto.com/products/merchandising/)
- **History:** Experian's AutoCheck product includes title, odometer and
  accident information. The FTC separately explains that a history report does
  not replace an independent inspection. Missing checks never become “clean,”
  and an OASIS service campaign never becomes an inferred recall.
  [AutoCheck](https://www.experian.com/automotive/autocheck-business),
  [FTC used-car buying guidance](https://consumer.ftc.gov/articles/buying-used-car-dealer)
- **Certification:** Ford's official comparison distinguishes Gold, EV and
  Blue inspections and coverage. Blue lists a 139-point inspection and a
  90-day/4,000-mile comprehensive limited warranty; Gold lists a 172-point
  inspection and different coverage. Inventory Flow uses the explicit vehicle
  certification flag and store program, never age/mileage eligibility alone.
  [Ford Blue Advantage](https://www.ford.com/used/about-certified/ford-blue-advantage/)
- **Registration lookup:** Michigan SOS describes MSRP at first title as the
  base price for relevant registration calculations. Copying an explicit
  factory-document base amount is a desk aid, not a calculated registration fee
  or proof of the value accepted by the state's lookup. Office verification
  remains necessary. [Michigan SOS](https://www.michigan.gov/sos/all-services/title-transfer-and-vehicle-registration)
- **Capability:** Ford explains that towing capability depends on vehicle
  configuration and equipment. No model-wide maximum is attached to an
  individual inventory vehicle. Exact configuration/door-label evidence would
  be required before adding payload or tow figures.
  [Ford towing resources](https://www.ford.com/towing/)
- **Fuel economy:** EPA labels provide comparative estimates; actual mileage
  varies. The interface displays captured city/highway figures without
  estimating fuel costs, EV range or MPGe from unrelated trims.
  [EPA fuel-economy labels](https://www.epa.gov/greenvehicles/learn-about-fuel-economy-label)

## Priorities and remaining data gaps

The first priority is making the current data usable: complete vehicle context,
specific packages/options, original/base pricing for employees, adverse history
results, clear source actions and a cohesive customer PDF. Repeated inventory,
capture and report-run dates belong in source details, rather than occupying
the scanning surfaces. Warranty start dates, due dates and source-quality
warnings remain meaningful and visible.

Useful future enrichment includes exact seating/cargo measurements, verified
tow/payload ratings, applicable subscription/trial conditions and EV battery
health/range evidence. These require reliable VIN/configuration-level sources;
the current candidate does not fabricate them. Incentives, credit approvals,
payment quotes and customer contact details remain outside this data-only
change and in their authorized dealership systems.

The candidate also adds an expandable manufacturer reference guide shared by
the app and companion. It starts with selected official Ford/Lincoln model-year
references and feature explanations, not a complete package catalog. Explicit
vehicle labels select demonstration prompts; guides never add installed options
or capability figures. The proposed central Cloudflare storage, API and MCP
extension is documented in [the knowledge architecture](MANUFACTURER_KNOWLEDGE_ARCHITECTURE.md).
