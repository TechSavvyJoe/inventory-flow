# Automotive interface research — October 10, 2026

This review informs Inventory Flow's inventory and vehicle workspaces. It covers
major dealer inventory products, classifieds, reconditioning tools, AI vendors
and nine dealership website providers. It is not a market-share ranking or a
claim that every private product version and dealer installation was tested.

Public interfaces, vendor-published screens and advertised capabilities are
different evidence. Undated pages were checked on the review date; an older
guide or screenshot is identified as historical. No dealer authentication,
contact submission, lead generation or live inventory integration was used.
Reference screenshots remain outside Git. The implementation uses our own
components, source rules and genuine provider assets with recorded provenance.

## Dealer inventory, recon and AI

| Product and primary source | Evidence | Useful pattern and limitation |
| --- | --- | --- |
| [vAuto Provision](https://www.vauto.com/products/provision/) and [centralized inventory dashboard FAQ](https://www.vauto.com/wp-content/uploads/2025/08/vauto-centralized-inventory-management-dashboard-faq.pdf) | Current public product page; vendor FAQ in a 2025/08 publication path. | Inventory, merchandising, profit, age and appraisal views; disposition/age filters and contextual reports. Missing price/photos/descriptions become exception queues. Low-lead data depends on a subscribed integration; these signals cannot be assumed to exist in Inventory Flow. Private dashboard interactions were not exercised. |
| [CDK inventory dashboard](https://www.cdkglobal.com/product-updates/vehicle-inventory-suite/manage-inventory-across-every-rooftop-one-dashboard) and [open repair orders](https://www.cdkglobal.com/product-updates/vehicle-inventory-suite/view-open-ros-cdk-vehicle-inventory-suite-dashboard) | Published interface screenshots, August 12 and September 18, 2026. | Stable photo/identity/price/status/age/location columns, exception filters and aligned repair-order facts. Screens establish layout, not a verified integration or workflow. |
| [DealerSocket inventory](https://dealersocket.com/products/inventory-management/inventory-management/) | Current marketing page; demo thumbnail is historical, from 2019. | Comparison columns and contextual full records are useful structural references. The thumbnail does not establish the latest private interface. |
| [AutoManager vehicle details](https://support.automanager.com/hc/en-us/articles/13257162253595-Vehicle-Details), [saved filters](https://support.automanager.com/hc/en-us/articles/5494599383963-Saved-Filters) and [mobile listing](https://play.google.com/store/apps/details?id=com.automanager.android&hl=en_US) | Support screenshots from 2023; mobile store listing reports a September 30, 2026 update. | Photo, identity, stock/VIN and location stay together; reusable filters and focused mobile tasks. Promotional mobile images are not proof that every action works. |
| [Rapid Recon](https://rapidrecon.com/reconditioning-software/) and [vehicle-location example](https://rapidrecon.com/video-wheres-the-car/) | Vendor descriptions and examples. | Current step, next person, elapsed time, cost and physical location help operational handoffs. These are separate facts; do not infer custody from service state. |
| [Velocity Recon](https://velocityautomotive.com/recon_software/) | Current vendor page. | Recon-to-retail workflow, approvals, vendor routing and VIN context are advertised. Private workflow execution was not tested. |
| [DealerCenter Recon and Service Bay announcement](https://dcnation.dealercenter.com/blog/dealercenter-launches-new-workflows-recon-service-bay-available-today) and [inventory](https://get.dealercenter.com/inventory/) | February 6, 2026 announcement and current vendor page. | Distinguishes internal recon from customer service work and describes stage goals, labor, parts and expenses. The protected guide could not be inspected. |
| [Lotlinx VIN Manager](https://www.lotlinx.com/vin-manager) and [LotGPT](https://www.lotlinx.com/platform/lotgpt) | Official promotional dashboard image inspected; current product descriptions. | VIN-specific demand, merchandising and next-action context; date/filter/metric labels surround analytics. Feed availability and AI accuracy were not tested. No unsupported market score or recommendation should be added to our UI. |
| [Impel Merchandising AI](https://impel.ai/merchandising-ai/) and [integrations](https://impel.ai/integrations/) | Current vendor descriptions. | Vehicle-specific media, feature explanations, history and window-sticker content form one coherent package. Generation quality and third-party connections remain unverified. |

## Classified interfaces

| Public interface | Observed pattern | Adaptation boundary |
| --- | --- | --- |
| [Cars.com F-150 search](https://www.cars.com/shopping/ford-f_150/) | Rendered search results and phone layout: categorized filters, broad photo cards, clear identity/price/mileage/location and a main action. | Its detail page required security verification. Consumer photo-card density would conceal too much operational evidence in our table. |
| [CarGurus F-150 search](https://www.cargurus.com/Cars/l-Used-Ford-F-150-d337) | Rendered results and a vehicle page: price evidence separate from identity, comparison/sort controls, categorized specifications/options/history. | The observed phone results overflowed; that behavior is not a model to copy. Financing and dealer lead controls are outside our staff workflow. |
| [Autotrader F-150 search](https://www.autotrader.com/cars-for-sale/ford/f150) | Rendered desktop and phone results: visible criteria/count/sort, photo, trim, mileage, price and restrained badges. | Its sparse consumer cards do not satisfy our requirement to expose equipment, hold and service evidence. |
| [CarMax F-150 search](https://www.carmax.com/cars/ford/f150) | Rendered results and a vehicle page: clear filter/save/sort, categorized photo views and features, explicit history access, persistent vehicle context. | Do not import promotional carousels, payment pitches or repeated conversion actions. |
| [CARFAX F-150 listings](https://www.carfax.com/Used-Ford-F-150_w236) and [official listings explanation](https://support.carfax.com/article/what-is-carfax-used-car-listings/) | Rendered public results: accident, use, ownership and service summaries have predictable positions and matching filters. | Reported history must retain its source and qualification. Our hold or listing evidence cannot become an availability promise. Full report details are distinct from a summary. |

## Dealership website providers

| Provider and primary sources | Evidence and features | What to learn; what remains unverified |
| --- | --- | --- |
| [Dealer.com website experience](https://www.dealer.com/solutions/websites/experience/), [2025 enhancements](https://www.dealer.com/resources/nada-2025-a-sneak-peek-into-new-enhancements/) and [digital retail](https://www.dealer.com/solutions/make-deals/) | Current vendor pages and dated 2025 announcement describe predictive/free-form search, mobile vehicle pages, personalization, payment, incentive and trade workflows. | Keep search persistent and vehicle context intact. Its [2020 SRP guide](https://www.dealer.com/wp-content/uploads/sites/10/2020/10/SRP_Product-and-FAQs_10152020.pdf) is historical, not proof of a current installation. Retail transactions were not exercised. |
| [DealerOn product updates](https://www.dealeron.com/new-product-updates/) and [GM website offering](https://www.dealeron.com/gm-digital-dealer-solution/) | Undated current pages describe header search, saved vehicles, drivetrain/transmission filters and VIN-level photo/lead/age analytics; promotional Cosmos screens are available. | Normalize vehicle attributes and make saved context discoverable. The [Cosmos launch](https://www.dealeron.com/blog/dealeron-launches-cosmos/) is from March 2022. No current private analytics or retail flow was verified. |
| [Dealer Inspire/Cars Commerce Save & Compare](https://www.carscommerce.inc/save-and-compare/), [result photo carousel](https://www.carscommerce.inc/vrp-image-carousel/) and [GM dealer features](https://www.carscommerce.inc/gm-dealer-hub/) | July 2025 comparison announcement, October 2024 carousel announcement and current vendor feature page. A public Dealer Inspire dealer page exposed search/filter/sort, but its results did not reliably load. | Retain comparison context and inspect photos without losing the vehicle. Payment comparison depends on Online Shopper; persistence, generated descriptions and image enhancement were not exercised. |
| [DealerFire/Engine6 feature matrix](https://www.dealerfire.com/index22) and [theme gallery](https://www.dealerfire.com/) | Undated current vendor pages list predictive search, normalized attributes, CARFAX owner filters, highlights, mobile galleries and saved vehicles. Options/packages and persistent VDP actions depend on the package. | Categorize search and keep actions with their vehicle. A live theme preview timed out; full history, comparison and private functionality were not verified. |
| [Overfuel website platform](https://overfuel.com/platform/automotive-websites/), [inventory-block filters](https://overfuel.freshdesk.com/support/solutions/articles/154000261671-building-inventory-landing-pages) and [vehicle actions](https://overfuel.freshdesk.com/support/solutions/articles/154000261677-changing-the-buttons-ctas-on-your-vehicle-pages) | Current vendor page and support instructions describe attribute filters with counts, configurable action order/labels/destinations and usually two card actions. The inventory-block editor supports one value per dropdown; this does not establish every shopper filter's behavior. | Set a deliberate action hierarchy and show filter impact. [AI/retail examples](https://overfuel.com/compare/overfuel-websites-dealerslink/) advertise natural-language search, contextual chat and connected retail; AI quality, history, saved/comparison and transactions remain untested. A 2026/08 asset path is not a release date. |
| [FoxDealer/CatalystIQ company relationship](https://catalystiq.com/about-us), [website product](https://catalystiq.com/solutions/website) and [OEM offering](https://catalystiq.com/who-we-serve/oem-programs/gm-canada) | Current official pages establish the relationship and describe mobile-first sites, i-VDP/Quick View, inventory/pricing-aware content and engagement analytics. | Quick inspection should preserve list context. The public demo timed out; current gallery, equipment-filter, history, saved/comparison and retail behavior remain unverified. |
| [Dealer eProcess Everest websites](https://www.dealereprocess.com/everest-websites/) and [Everest AI Assistant](https://www.dealereprocess.com/everest-ai-assistant/) | Public vendor descriptions and promotional UI figures describe mobile-first search/results/details, a revised photo gallery, saved-vehicle stars, feed-backed trim comparisons and natural-language inventory queries. | Categorize specifications and make similar-vehicle comparisons understandable. Returning-shopper CRM alerts are a separate privacy-sensitive integration. No live dealer search, saved-state, AI quality or retail transaction was exercised. |
| [Dealer Alchemist/NEXUS websites](https://dealeralchemist.com/services/websites) and [NEXUS platform](https://dealeralchemist.com/services/websites-nexus) | Current official product pages describe configurable results, dynamic vehicle pages, CARFAX integration, inventory/pricing updates, lease/finance estimates and trade modules. The [February 1, 2024 company announcement](https://www.globenewswire.com/news-release/2024/02/01/2822023/0/en/Dealer-Alchemist-Announces-Strategic-Acquisition-of-AutoGo-to-Enhance-its-Automotive-Digital-Solutions.html) identifies the acquired AutoGo as formerly Dealer Venom. | Keep vehicle-page facts current and distinguish finance estimates from confirmed terms. These are vendor claims and imagery; private software, mobile interaction, AI behavior and end-to-end retail were not verified. |
| [AutoRevo websites](https://autorevo.com/products/car-dealer-websites/), [inLine inventory management](https://autorevo.com/products/inline-inventory-management/) and [product overview](https://autorevo.com/products/) | Public provider-hosted sample page contents exposed featured vehicles and browsing links. Official descriptions advertise mobile inventory management, feed imports, VIN-decoded factory equipment/paint, CARFAX/AutoCheck advertising and comparable-vehicle pricing. Its [AI description announcement](https://autorevo.com/introducing-a-i-vehicle-description-builder/) is historical, from 2023. | VIN-linked equipment and clearly sourced history are relevant. The sample pages do not establish live inventory accuracy; interactive filters, mobile viewports, saved comparison, AI generation and retail transactions were not tested. |

## Decisions applied to this candidate

1. Compare complete vehicle records in a continuous ledger. The initial four-column
   implementation was rejected after actual desktop/tablet review: narrow report
   columns forced small values and awkward wrapping. Use a wide vehicle reference
   area beside an independent operations rail, followed by a joined source band.
2. Combine the larger unobscured photo, identity, pricing and configuration in
   one vehicle reference area. Stock, full VIN, base MSRP and mileage occupy a
   stable copy ledger. Certification belongs with identity metadata rather than
   covering the vehicle. Factory, history and OEM source marks sit beside their
   respective facts in the joined band; phone records preserve the same order.
3. Keep one compact action footer. Records, Save and Listing form a reference
   group beside permitted Request/Track/Move controls. Full labels and 44px
   targets remain consistent. Additional genuine actions stay direct; no
   operational More disclosure is introduced. Search, location scope, counts
   and visibly labeled Hold/Service filters form one continuous workbench.
4. Keep genuine source marks and explicit destination wording with their facts.
   Captured history, external documents and OEM evidence are not interchangeable
   buttons. Full VIN, stock, base MSRP and mileage remain easy to copy; numeric
   registration values copy without currency formatting.
5. Retain complete operational warnings and source qualification. Empty evidence
   must not turn into a confident status or invented AI recommendation.

This candidate does not implement every competitor feature. Grounded VIN
assistance, richer saved comparisons, market-demand metrics and new digital
retail integrations need their own data contracts, authorization and validation.
Existing source relationships remain read-only, including revoked FMCDealer
access. Our synthetic demo cannot validate a dealership feed or provider login.

## Acceptance evidence

Inspect real renders at 390×844, 1024×768, 1320×820 and 1440×900, plus a
320px phone and rich records at wider desktop sizes. Measure the whole vehicle
group, not just its primary row. Keep the ordinary and rich fixture density
limits in the browser suite, full warning text, native column headers, 44px
controls, exact source destinations and dialog focus restoration. Synthetic
screenshots and run receipts stay outside Git; the PR must state which checks
actually passed. Visual baseline approval is a separate step from functional
tests and from Joe's assessment of the product.
