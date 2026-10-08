# Automotive source catalog

Research reviewed on October 7, 2026. This directory covers 55 public provider and government-source profiles used to plan dealership data connections in Inventory Flow. It is a broad North American planning catalog, not an exhaustive vendor registry or a list of installed adapters. Salesforce is excluded at Joe’s request. Dealers may enter another authorized provider.

## How to use the directory

In Software Admin, open a dealer group → Data connections → Provider directory. Search by provider, franchise or independent, then choose Configure. Review the dealership and OEM scope, delivery method, credential reference and schedule before saving. A new connection starts paused. Saving configuration does not grant vendor access, install an adapter, activate an executor or publish inventory.

A provider’s product data is separate from an approved external read contract. Request the dealer-scoped field dictionary, account entitlement, permitted read operations, refresh limits and retention/display terms. A documented inbound import or lead-submission API is not evidence of an outbound read feed.

CRM activities, sales and deliveries remain distinct from a confirmed hold or vehicle availability. OEM decoding does not establish VIN-specific factory equipment, and model-level recall campaigns do not establish a vehicle’s open actions.

The Captured evidence view reads only allowlisted aggregate counts from the stored publication. Missing counts are unknown, not zero; publication totals do not prove source access or complete field capture for a configured provider.

## CRM

| Provider | Dealer / product context | Documented access or remaining gate |
| --- | --- | --- |
| [DealerMail](https://www.dealermail.com/about.php) | Franchise CRM | No public API, feed, export, or webhook contract found. |
| [VinSolutions CRM](https://www.coxautoinc.com/terms/wp-content/uploads/sites/3/VinSolutions-Integration-Agreement.pdf) | Franchise CRM | Partner API plans and eventing; public pages do not establish an account entitlement or current field schema. |
| [DealerSocket CRM](https://dealersocket.com/apis/) | Franchise CRM | Vendor-supported API paths; public documentation does not establish external inventory export. |
| [CDK Elead CRM](https://www2.cdkglobal.com/api-solutions-crm) | Franchise CRM | Fortellis APIs, with exact operations and fields determined by the selected public API specifications. |
| [DriveCentric CRM](https://drivecentric.com/resources/partner-program) | Franchise & independent CRM | Partner API documentation is provided after partner approval; external inventory-read contract is not public. |
| [Reynolds FOCUS CRM](https://www.reyrey.com/solutions/customer-relationship-management-sales/focus) | Franchise CRM | No public third-party read API or export contract found for FOCUS. |
| [AutoAlert CXM](https://www.autoalert.com/autoalert-cxm-leading-automotive-crm-space/) | Franchise CRM / OEM programs | No public third-party inventory-read API or export schema found. |
| [DealerBuilt Oplogic CRM](https://dealerbuilt.com/solutions/) | Franchise CRM | No public Oplogic CRM read/export API contract was found. |
| [Autoxloo / Webxloo CRM](https://www.autoxloo.com/) | Franchise and independent CRM | No public external CRM read API or schema found. |
| [AutoRaptor](https://get.autoraptor.com/automotive-crm-integrations) | Independent & BHPH CRM | Provider-specific integrations; no general external API schema found. |
| [Selly Automotive](https://www.sellyautomotive.com/integrations) | Independent & BHPH CRM | Provider-specific integrations; public documentation does not establish an external read endpoint. |
| [ProMax Complete CRM](https://www.promaxunlimited.com/data-exchange-api/) | Franchise & independent CRM / desking | Partner/vendor API path; available resources are not publicly specified. |
| [DealerPeak CRM](https://www.dealerpeak.com/api-technology/) | Franchise / group CRM | API key and vendor-provided OpenAPI documentation. |
| [DealerMine CRM](https://dealermine.noticeable.news/publications/release-notes-v-9-7-9-march-2026) | Franchise CRM / desking | API access activated by the dealer account manager; detailed contract is not public. |
| [AutoSync Activix](https://www.autosync.ca/dealer-crm/crm-in-depth) | Franchise & independent CRM | Vendor integration path; public technical schema not found. |
| [Carsforsale.com](https://dealers.carsforsale.com/dealer-lead-management/) | Independent CRM / DMS / website | Dealer product and outbound syndication; external read interface not documented. |

## DMS

| Provider | Dealer / product context | Documented access or remaining gate |
| --- | --- | --- |
| [DealerCenter DMS](https://support.dealercenter.net/hc/en-us/articles/115003197366-How-to-Automatically-Import-Inventory-into-DealerCenter) | Independent & BHPH DMS / CRM | Dealer-managed import/export workflows; documented export destination is not a third-party read grant. |
| [DealerSocket IDMS](https://inventoryplus.dealersocket.com/products/idms/) | Independent & BHPH DMS | No public third-party IDMS inventory-read contract or field schema found. |
| [DealerClick DMS](https://dealerclick.com/products/auto-dealer-software) | Independent DMS | No public third-party inventory API or export schema found. |
| [Frazer DMS](https://www.frazerhelp.com/help-manual/exportdata.htm) | Independent & BHPH DMS | Dealer-generated local export file. |
| [AutoManager DeskManager](https://support.automanager.com/hc/en-us/articles/7957202992411-WebManager-Inventory-Imports) | Independent DMS / CRM suite | Provider-arranged FTP path is documented for WebManager imports, not a general DMS read API. |
| [Autosoft Go DMS + CRM](https://autosoftdms.com/platform/integrations/) | Franchise and independent DMS / CRM | Vendor-partner integrations are documented at a high level; no public inventory read schema was found. |
| [Dominion VUE DMS](https://vueintegration.dominiondms.com/) | Franchise DMS | SecureVue API; public schema details require the vendor partner documentation and credentials. |
| [DealerBuilt Lightyear](https://dealerbuilt.com/dms-platform/open-integration-platform/) | Franchise / group DMS | Partner API and batch-export paths; exact vehicle entity schema requires vendor documentation. |
| [Auto/Mate Open/Mate](https://automate.com/dms/openmate/) | Franchise & independent DMS | Partner integration program; specific read/export contract is not public. |
| [PBS PartnerHub](https://partnerhub.pbsdealers.com/) | Franchise & independent DMS / CRM | Partner API queries; exact inventory semantics must be checked in the selected resource spec. |
| [Quorum XSellerator](https://docs.xsellerator.com/) | Franchise DMS / CRM | Contracted API access with user API key; resource and field details require current documentation. |
| [CDK / Fortellis DMS](https://docs.fortellis.io/docs/general/overview/getting-started) | Franchise DMS | OAuth-protected APIs through Fortellis; some API families expose dealer and department-scoped data. |
| [Reynolds RCI](https://www.reyrey.com/company/reynolds-data-management) | Franchise DMS | Dealer-defined secure inventory export or certified RCI interface; public endpoint and field schema not found. |
| [Dealertrack Opentrack](https://us.dealertrack.com/content/dealertrack/en/dealer-management-solutions/platform.html) | Franchise DMS | Vendor-supported integration path; public pages do not document a general inventory read API. |
| [Tekion Automotive Partner Cloud](https://apc.tekioncloud.com/user/home) | Franchise / group DMS | Partner APIs or file/webhook paths, subject to the selected integration and agreement. |

## Websites

| Provider | Dealer / product context | Documented access or remaining gate |
| --- | --- | --- |
| [Dealer.com](https://developer.inv.dealer.com/content/inventory/inventory-home.html) | Website inventory | API-key JSON access for eligible Dealer.com clients and authorized accounts. |
| [DealerOn](https://www.dealeron.com/partners/) | Website inventory | Vendor-managed export/feed; current transport and field contract require vendor confirmation. |
| [Dealer Inspire](https://di-uploads-pod1.training.dealerinspire.com/prod-thedash/uploads/2022/12/Website-Shortcode-__-2022.pdf) | Website inventory | Ask Cars Commerce / Dealer Inspire for a dealer-authorized export; website display is not a feed. |
| [Dealer eProcess Units](https://www.dealereprocess.com/units-inventory-management-system/) | Website inventory | Custom export; transport, schema, and refresh schedule are not specified publicly. |
| [AutoManager WebManager](https://www.automanager.com/webmanager-deskmanager-integration/) | Website inventory | Dealer website and DMS-to-website synchronization are documented; no public third-party inventory API is specified. |
| [Dealer Alchemist Websites](https://dealeralchemist.com/services/websites-nexus) | Franchise and independent website inventory | Website feed integrations are described; no public third-party export/API contract was found. |
| [Overfuel](https://api.overfuel.com/) | Website inventory | Bearer-key JSON API; public docs state inventory scope and a 60-request-per-minute limit. |
| [Dealer Spike](https://help.dealerspike.com/dms-integrations) | Website inventory | Inbound website feed is documented; outward export/API was not verified. |
| [GM Leadbox](https://www.gmdealerdigital.ca/Website/Leadbox) | OEM website inventory | Dealer website package with configured DMS connection. |
| [Dealer Car Search](https://qareact.dealercarsearch.com/frazer-integration) | Website inventory | Provider-paired DMS integration; general outward feed contract not documented. |
| [DealerFire](https://www.dealer.solera.com/products/dealersocket/dealerfire/) | Website inventory | Website inbound feed described; external export format/API not publicly verified. |

## Inventory and feeds

| Provider | Dealer / product context | Documented access or remaining gate |
| --- | --- | --- |
| [HomeNet IOL](https://www.homenetauto.com/eula/) | Merchandising and inventory feed | XML/JSON/CSV HTTP API and dealer export workflow; documented schemas do not establish an account entitlement. |
| [vAuto](https://www.coxautoinc.com/terms/wp-content/uploads/sites/3/vAuto-Integration-Terms-and-Conditions.pdf) | Merchandising and inventory feed | Dealer product integration/feed; OBD API is separately documented and is not a general inventory feed. |
| [Dealer Specialties](https://www.dealerspecialties.com/distribution) | Merchandising and syndication | Syndication service is described; dealer-readable API/export format was not found. |
| [MarketCheck](https://docs.marketcheck.com/docs/api/cars/dealership-syndication/dealership-inventory) | Licensed listing data | Licensed JSON API and data feeds. |

## History

| Provider | Dealer / product context | Documented access or remaining gate |
| --- | --- | --- |
| [Experian AutoCheck](https://www.experian.com/automotive/vehicle-history-services) | Vehicle history | Dealer report subscription, partner FastLink, or licensed Auto AccuSelect API. |
| [CARFAX](https://www.carfax.com/company/partners) | Vehicle history | Dealer report product; third-party integration requests go through Business Development. |

## Equipment

| Provider | Dealer / product context | Documented access or remaining gate |
| --- | --- | --- |
| [DataOne VIN Decoder](https://www.dataonesoftware.com/web-services-vin-decoder-api) | Equipment and enrichment | Licensed REST API (XML/JSON); selected reference data also offered by SFTP. |
| [J.D. Power / ChromeData](https://portal.jdpower.com/wp-content/uploads/2024/04/CVDIntegrationGuide_2026_February-2.pdf) | Equipment and enrichment | Licensed vendor integration; public guide is not proof of an open public API entitlement. |
| [NHTSA vPIC](https://vpic.nhtsa.dot.gov/api/Home/Index) | Government VIN decoding | Public HTTPS API in JSON/XML/CSV or downloadable database; rate controls apply. |

## OEM and recall

| Provider | Dealer / product context | Documented access or remaining gate |
| --- | --- | --- |
| [FordDirect](https://www.forddirect.com/solutions) | OEM dealer programs | Dealer program and partner integrations; public sources do not document a general external feed schema. |
| [Ford Developer APIs](https://developer.ford.com/apis) | OEM data and connected vehicle | OAuth customer consent for connected-vehicle data; WLTP API is for authorized system providers. |
| [Toyota Fleet Data Services](https://fleet.toyota.com/ftc/public/staticContent/docs_public/Forms/Miscellaneous%20Forms%20and%20Documents/Archived/Fleet%20Data%20Packages.pdf) | OEM dealer programs | Direct API integration or data package. |
| [NHTSA Recalls API](https://www.nhtsa.gov/nhtsa-datasets-and-apis) | Government recall information | Public API query by year/make/model. |

## Evidence limits

Official links accompany each profile. Vendor approval and the selected contract remain necessary even when a public API exists. No authenticated systems were queried for this research, and no vendor credentials or dealership/customer records are included. Sincro is a DealerOn alias following its acquisition, rather than a separate adapter. Older supplier material alone was insufficient to add fusionZONE to the current verified directory.

The catalog and strict vendor/category matching live in `src/features/platform/sourceCatalog.ts`; public profile claims can be revised there as vendors publish new contracts.
