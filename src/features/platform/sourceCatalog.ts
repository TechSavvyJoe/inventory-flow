export interface SourceProfile {
  id: string
  name: string
  category: string
  segment: string
  evidence: string[]
  access: string
  gate: string
  url: string
  aliases?: string[]
}

/** Publicly documented provider capabilities for planning. These are not Inventory Flow adapters. */
export const SOURCE_CATALOG: SourceProfile[] = [
  {
    id: 'dealermail', name: 'DealerMail', category: 'dealermail', segment: 'Franchise CRM',
    evidence: ['Public product pages describe leads, customer communications, appointments, and sales reporting; no public inventory or hold schema was found.'],
    access: 'No public API, feed, export, or webhook contract found.',
    gate: 'Request a written, read-only interface and rooftop scope from the dealer and vendor. CRM activity is not a hold signal.',
    url: 'https://www.dealermail.com/about.php', aliases: ['Autolead'],
  },
  {
    id: 'vinsolutions-crm', name: 'VinSolutions CRM', category: 'crm', segment: 'Franchise CRM',
    evidence: ['Public integration terms list organization, user, contact, vehicle-inventory, and lead resources; eventing is also described.'],
    access: 'Partner API plans and eventing; public pages do not establish an account entitlement or current field schema.',
    gate: 'Partner agreement, selected plan, dealer authorization, and field scope required. Exclude customer and lead data from inventory evidence.',
    url: 'https://www.coxautoinc.com/terms/wp-content/uploads/sites/3/VinSolutions-Integration-Agreement.pdf', aliases: ['Vin Solutions'],
  },
  {
    id: 'dealersocket-crm', name: 'DealerSocket CRM', category: 'crm', segment: 'Franchise CRM',
    evidence: ['Public API pages describe deal-push data and inbound customer/activity updates; no inventory-read feed is documented.'],
    access: 'Vendor-supported API paths; public documentation does not establish external inventory export.',
    gate: 'Vendor integration approval and dealer authorization. Vehicle-of-interest and deal-push data do not prove current inventory or hold state.',
    url: 'https://dealersocket.com/apis/',
  },
  {
    id: 'elead-crm', name: 'CDK Elead CRM', category: 'crm', segment: 'Franchise CRM',
    evidence: ['Fortellis listings describe sales-opportunity, customer, reference-data, and activity resources, including vehicle-of-interest context.'],
    access: 'Fortellis APIs, with exact operations and fields determined by the selected public API specifications.',
    gate: 'Developer/app setup, API subscription, dealership acceptance, and approved scopes required. Opportunity context is not inventory availability.',
    url: 'https://www2.cdkglobal.com/api-solutions-crm', aliases: ['Elead', 'CDK Elead'],
  },
  {
    id: 'drivecentric-crm', name: 'DriveCentric CRM', category: 'crm', segment: 'Franchise & independent CRM',
    evidence: ['Partner materials describe partner-to-CRM data pushes and VIN-level inventory display inside its CRM.'],
    access: 'Partner API documentation is provided after partner approval; external inventory-read contract is not public.',
    gate: 'Partner review, agreement, and dealer authorization. CRM display or inbound push does not establish outbound read rights.',
    url: 'https://drivecentric.com/resources/partner-program',
  },
  {
    id: 'reynolds-focus-crm', name: 'Reynolds FOCUS CRM', category: 'crm', segment: 'Franchise CRM',
    evidence: ['Reynolds describes customer, deal, website-interaction, appointment, and service views, with customer profiles spanning group stores.'],
    access: 'No public third-party read API or export contract found for FOCUS.',
    gate: 'Request a vendor-approved interface and dealer scope. CRM opportunities and in-stock recommendations are not a hold or inventory feed.',
    url: 'https://www.reyrey.com/solutions/customer-relationship-management-sales/focus', aliases: ['FOCUS', 'Reynolds FOCUS'],
  },
  {
    id: 'autoalert-cxm', name: 'AutoAlert CXM', category: 'crm', segment: 'Franchise CRM / OEM programs',
    evidence: ['AutoAlert describes a dealer CRM for managing leads, tasks, customer interactions, and desking; public materials list OEM program certifications.'],
    access: 'No public third-party inventory-read API or export schema found.',
    gate: 'Vendor and dealer approval required for any data interface; customer engagement records do not establish vehicle availability or hold state.',
    url: 'https://www.autoalert.com/autoalert-cxm-leading-automotive-crm-space/', aliases: ['AutoAlert'],
  },
  {
    id: 'dealerbuilt-oplogic-crm', name: 'DealerBuilt Oplogic CRM', category: 'crm', segment: 'Franchise CRM',
    evidence: ['DealerBuilt lists Oplogic as its CRM product, with desking, equity-calculator, telephony, and related capabilities.'],
    access: 'No public Oplogic CRM read/export API contract was found.',
    gate: 'Request Oplogic-specific technical documentation and dealer authorization. DealerBuilt Lightyear DMS API materials do not establish Oplogic CRM access.',
    url: 'https://dealerbuilt.com/solutions/', aliases: ['Oplogic', 'Oplogic CRM'],
  },
  {
    id: 'autoxloo-webxloo-crm', name: 'Autoxloo / Webxloo CRM', category: 'crm', segment: 'Franchise and independent CRM',
    evidence: ['Autoxloo describes CRM lead and communication tracking and identifies both independent and franchised dealerships among its business audiences.'],
    access: 'No public external CRM read API or schema found.',
    gate: 'Request an approved vendor interface and dealer scope; public CRM product descriptions do not establish data access.',
    url: 'https://www.autoxloo.com/', aliases: ['Autoxloo', 'Webxloo CRM'],
  },
  {
    id: 'autoraptor-crm', name: 'AutoRaptor', category: 'crm', segment: 'Independent & BHPH CRM',
    evidence: ['Vendor documents inventory-provider integrations and CRM inventory synchronization; its help material notes some DMS sale imports may take several days.'],
    access: 'Provider-specific integrations; no general external API schema found.',
    gate: 'Dealer and source-provider setup required. Verify direction, fields, and update delay before relying on status.',
    url: 'https://get.autoraptor.com/automotive-crm-integrations', aliases: ['Auto Raptor'],
  },
  {
    id: 'selly-automotive', name: 'Selly Automotive', category: 'crm', segment: 'Independent & BHPH CRM',
    evidence: ['Official materials list inventory/XML ADF and sales-data integration categories; no public field or API contract was found.'],
    access: 'Provider-specific integrations; public documentation does not establish an external read endpoint.',
    gate: 'Confirm integration direction, schedule, fields, and dealer authorization with the vendor.',
    url: 'https://www.sellyautomotive.com/integrations', aliases: ['Selly Automotive CRM'],
  },
  {
    id: 'promax-crm', name: 'ProMax Complete CRM', category: 'crm', segment: 'Franchise & independent CRM / desking',
    evidence: ['Vendor advertises a Universal Data Exchange API and real-time data sharing; public endpoint and field schemas were not found.'],
    access: 'Partner/vendor API path; available resources are not publicly specified.',
    gate: 'Partner implementation and dealer authorization required; validate exact read scope and vehicle semantics.',
    url: 'https://www.promaxunlimited.com/data-exchange-api/', aliases: ['ProMax', 'Complete CRM'],
  },
  {
    id: 'dealerpeak-crm', name: 'DealerPeak CRM', category: 'crm', segment: 'Franchise / group CRM',
    evidence: ['Vendor describes a REST/JSON OpenAPI and CRM inventory features; exact inventory endpoints and fields require its API specification.'],
    access: 'API key and vendor-provided OpenAPI documentation.',
    gate: 'Dealer/vendor approval; confirm object scope, freshness, and any high-volume export fees.',
    url: 'https://www.dealerpeak.com/api-technology/',
  },
  {
    id: 'dealermine-crm', name: 'DealerMine CRM', category: 'crm', segment: 'Franchise CRM / desking',
    evidence: ['Vendor release notes announce APIs and updated Swagger documentation, but do not publicly enumerate resources or fields.'],
    access: 'API access activated by the dealer account manager; detailed contract is not public.',
    gate: 'Dealer account activation and approval; verify inventory object access separately from customer records.',
    url: 'https://dealermine.noticeable.news/publications/release-notes-v-9-7-9-march-2026', aliases: ['DealerMine'],
  },
  {
    id: 'autosync-activix', name: 'AutoSync Activix', category: 'crm', segment: 'Franchise & independent CRM',
    evidence: ['Vendor describes CRM and open integrations; public materials reviewed do not establish read verbs, inventory objects, or fields.'],
    access: 'Vendor integration path; public technical schema not found.',
    gate: 'Request technical docs and dealer authorization; treat CRM activity as context, not inventory or hold evidence.',
    url: 'https://www.autosync.ca/dealer-crm/crm-in-depth', aliases: ['Activix', 'AutoSync'],
  },
  {
    id: 'dealercenter-dms', name: 'DealerCenter DMS', category: 'dms', segment: 'Independent & BHPH DMS / CRM',
    evidence: ['Public help describes inventory imports into DealerCenter and inventory exports to advertising destinations; no outward DealerCenter read API was found.'],
    access: 'Dealer-managed import/export workflows; documented export destination is not a third-party read grant.',
    gate: 'Dealer authorization and vendor setup; distinguish inbound DMS imports from permission to read data back out.',
    url: 'https://support.dealercenter.net/hc/en-us/articles/115003197366-How-to-Automatically-Import-Inventory-into-DealerCenter', aliases: ['DealerCenter'],
  },
  {
    id: 'dealersocket-idms', name: 'DealerSocket IDMS', category: 'dms', segment: 'Independent & BHPH DMS',
    evidence: ['DealerSocket describes inventory management and vehicle, sales, customer, and payment lifecycle tools for independent and BHPH dealers.'],
    access: 'No public third-party IDMS inventory-read contract or field schema found.',
    gate: 'Dealer/vendor approval required; confirm a supported external read path and its scope.',
    url: 'https://inventoryplus.dealersocket.com/products/idms/', aliases: ['IDMS'],
  },
  {
    id: 'dealerclick-dms', name: 'DealerClick DMS', category: 'dms', segment: 'Independent DMS',
    evidence: ['DealerClick describes inventory, desking, CRM, and F&I functions for independent dealers.'],
    access: 'No public third-party inventory API or export schema found.',
    gate: 'Confirm an approved dealer-authorized export and current field contract with DealerClick.',
    url: 'https://dealerclick.com/products/auto-dealer-software', aliases: ['DealerClick'],
  },
  {
    id: 'frazer-dms', name: 'Frazer DMS', category: 'dms', segment: 'Independent & BHPH DMS',
    evidence: ['Official help describes operator-generated CSV/TXT exports with selectable fields and date ranges; no public API was found.'],
    access: 'Dealer-generated local export file.',
    gate: 'Dealer chooses fields and authorizes sharing; use an explicitly approved export workflow.',
    url: 'https://www.frazerhelp.com/help-manual/exportdata.htm', aliases: ['Frazer'],
  },
  {
    id: 'automanager-dms', name: 'AutoManager DeskManager', category: 'dms', segment: 'Independent DMS / CRM suite',
    evidence: ['Public docs describe CRM-to-DMS lead export and FTP inventory imports into WebManager; no outward DeskManager inventory API was found.'],
    access: 'Provider-arranged FTP path is documented for WebManager imports, not a general DMS read API.',
    gate: 'Dealer/vendor must specify FTP account, file schema, direction, and authorized data scope.',
    url: 'https://support.automanager.com/hc/en-us/articles/7957202992411-WebManager-Inventory-Imports', aliases: ['AutoManager', 'DeskManager', 'WebManager'],
  },
  {
    id: 'autosoft-dms', name: 'Autosoft Go DMS + CRM', category: 'dms', segment: 'Franchise and independent DMS / CRM',
    evidence: ['Autosoft describes its DMS and CRM capabilities for franchise and independent dealerships and a partner integration ecosystem.'],
    access: 'Vendor-partner integrations are documented at a high level; no public inventory read schema was found.',
    gate: 'Request partner and dealer authorization plus the exact inventory interface and field scope.',
    url: 'https://autosoftdms.com/platform/integrations/', aliases: ['Autosoft', 'Autosoft DMS'],
  },
  {
    id: 'dominion-vue-dms', name: 'Dominion VUE DMS', category: 'dms', segment: 'Franchise DMS',
    evidence: ['Dominion publishes SecureVue API v1/v2 Swagger entry points for external customers and integration partners.'],
    access: 'SecureVue API; public schema details require the vendor partner documentation and credentials.',
    gate: 'Approved partner credentials and authorized dealership scope required; confirm current resources and permissions.',
    url: 'https://vueintegration.dominiondms.com/', aliases: ['Dominion VUE', 'VUE DMS', 'SecureVue'],
  },
  {
    id: 'dealerbuilt-dms', name: 'DealerBuilt Lightyear', category: 'dms', segment: 'Franchise / group DMS',
    evidence: ['Vendor describes certified partner APIs for sales, service, customer, and accounting data plus scheduled batch exports; inventory fields are not listed in the overview.'],
    access: 'Partner API and batch-export paths; exact vehicle entity schema requires vendor documentation.',
    gate: 'Partner-network approval and dealer-selected integration; confirm inventory object, VIN/status fields, and scope.',
    url: 'https://dealerbuilt.com/dms-platform/open-integration-platform/', aliases: ['DealerBuilt', 'Lightyear'],
  },
  {
    id: 'automate-openmate', name: 'Auto/Mate Open/Mate', category: 'dms', segment: 'Franchise & independent DMS',
    evidence: ['Vendor describes secure real-time data exchange and notifications, but public entity and field schemas were not found.'],
    access: 'Partner integration program; specific read/export contract is not public.',
    gate: 'Partner enrollment and dealer authorization; confirm source objects and field-level access.',
    url: 'https://automate.com/dms/openmate/', aliases: ['Auto/Mate', 'Open/Mate'],
  },
  {
    id: 'pbs-partnerhub', name: 'PBS PartnerHub', category: 'dms', segment: 'Franchise & independent DMS / CRM',
    evidence: ['Public partner API documentation supports SOAP/XML/JSON/REST and lists Vehicles and Customers resources.'],
    access: 'Partner API queries; exact inventory semantics must be checked in the selected resource spec.',
    gate: 'PBS partner registration and credentials; credentials are scoped to authorized dealerships.',
    url: 'https://partnerhub.pbsdealers.com/', aliases: ['PBS Systems', 'APEX'],
  },
  {
    id: 'quorum-xsellerator', name: 'Quorum XSellerator', category: 'dms', segment: 'Franchise DMS / CRM',
    evidence: ['Official API docs index REST resources including Vehicles and Inventory; this review did not inspect a stable field schema.'],
    access: 'Contracted API access with user API key; resource and field details require current documentation.',
    gate: 'API contract/cost and organization activation required; validate dealership scope and exact vehicle fields.',
    url: 'https://docs.xsellerator.com/', aliases: ['Quorum', 'XSellerator'],
  },
  {
    id: 'cdk-fortellis-dms', name: 'CDK / Fortellis DMS', category: 'dms', segment: 'Franchise DMS',
    evidence: ['Fortellis documents an API marketplace and vehicle merchandising API family; specific fields depend on the selected API and subscription.'],
    access: 'OAuth-protected APIs through Fortellis; some API families expose dealer and department-scoped data.',
    gate: 'Developer/app registration, active subscription, dealer acceptance, and authorized department/field scope required.',
    url: 'https://docs.fortellis.io/docs/general/overview/getting-started', aliases: ['CDK', 'Fortellis'],
  },
  {
    id: 'reynolds-rci', name: 'Reynolds RCI', category: 'dms', segment: 'Franchise DMS',
    evidence: ['Reynolds describes dealer-defined inventory downloads and custom reports; RCI participation is application and component specific.'],
    access: 'Dealer-defined secure inventory export or certified RCI interface; public endpoint and field schema not found.',
    gate: 'Dealer authorization plus interface application/certification for the specific integration and components.',
    url: 'https://www.reyrey.com/company/reynolds-data-management', aliases: ['Reynolds & Reynolds', 'RCI'],
  },
  {
    id: 'dealertrack-opentrack', name: 'Dealertrack Opentrack', category: 'dms', segment: 'Franchise DMS',
    evidence: ['Dealertrack describes its Opentrack third-party integration platform and OEM integrations; no public inventory endpoint schema was found.'],
    access: 'Vendor-supported integration path; public pages do not document a general inventory read API.',
    gate: 'Dealer and integration-provider authorization; verify the current approved interface and field list with Dealertrack.',
    url: 'https://us.dealertrack.com/content/dealertrack/en/dealer-management-solutions/platform.html', aliases: ['Dealertrack', 'Opentrack'],
  },
  {
    id: 'tekion-apc', name: 'Tekion Automotive Partner Cloud', category: 'dms', segment: 'Franchise / group DMS',
    evidence: ['Public partner materials describe API, FTP, and webhook integration capabilities; exact API documentation is partner gated.'],
    access: 'Partner APIs or file/webhook paths, subject to the selected integration and agreement.',
    gate: 'Approved partner account, signed terms, dealer permission, and a vendor-specified scope required.',
    url: 'https://apc.tekioncloud.com/user/home', aliases: ['Tekion', 'APC'],
  },
  {
    id: 'dealer-com', name: 'Dealer.com', category: 'public_inventory', segment: 'Website inventory',
    evidence: ['Public developer docs describe an inventory API for vehicles, equipment, prices, listings, and dealer resources.'],
    access: 'API-key JSON access for eligible Dealer.com clients and authorized accounts.',
    gate: 'Dealer.com client status, API registration/key, and dealer authorization required; confirm current contract and field scope.',
    url: 'https://developer.inv.dealer.com/content/inventory/inventory-home.html', aliases: ['DDC'],
  },
  {
    id: 'dealeron', name: 'DealerOn', category: 'public_inventory', segment: 'Website inventory',
    evidence: ['DealerOn documents exportable inventory and daily inventory-export products; current feed schema was not found.'],
    access: 'Vendor-managed export/feed; current transport and field contract require vendor confirmation.',
    gate: 'Dealer enrollment and destination-specific vendor setup; obtain an approved sample feed and terms.',
    url: 'https://www.dealeron.com/partners/', aliases: ['DealerOn Connect', 'Cosmos', 'Sincro'],
  },
  {
    id: 'dealer-inspire', name: 'Dealer Inspire', category: 'public_inventory', segment: 'Website inventory',
    evidence: ['Public materials document inventory display and website shortcodes; an outward dealer-inventory API contract was not found.'],
    access: 'Ask Cars Commerce / Dealer Inspire for a dealer-authorized export; website display is not a feed.',
    gate: 'Dealer and vendor approval; confirm fields, format, cadence, media rights, and rooftop scope.',
    url: 'https://di-uploads-pod1.training.dealerinspire.com/prod-thedash/uploads/2022/12/Website-Shortcode-__-2022.pdf', aliases: ['Cars Commerce'],
  },
  {
    id: 'dealer-eprocess', name: 'Dealer eProcess Units', category: 'public_inventory', segment: 'Website inventory',
    evidence: ['Vendor describes inventory management and dealer-configured exports to selected destinations.'],
    access: 'Custom export; transport, schema, and refresh schedule are not specified publicly.',
    gate: 'Dealer-configured destination and vendor approval; verify media rights and exact field mapping.',
    url: 'https://www.dealereprocess.com/units-inventory-management-system/', aliases: ['Dealer eProcess'],
  },
  {
    id: 'automanager-webmanager', name: 'AutoManager WebManager', category: 'public_inventory', segment: 'Website inventory',
    evidence: ['WebManager documents live inventory views and exports; DeskManager can sync vehicle fields, sold/archive status, VIN-decoded equipment, and up to 100 photos into the website.'],
    access: 'Dealer website and DMS-to-website synchronization are documented; no public third-party inventory API is specified.',
    gate: 'Dealer/vendor approval and a supported external export are required. DeskManager-to-WebManager sync is inbound to the website, not a third-party read grant.',
    url: 'https://www.automanager.com/webmanager-deskmanager-integration/', aliases: ['WebManager'],
  },
  {
    id: 'dealer-alchemist', name: 'Dealer Alchemist Websites', category: 'public_inventory', segment: 'Franchise and independent website inventory',
    evidence: ['Vendor describes real-time website inventory/pricing sync, in-transit units, and OEM incentives for franchise and independent dealerships.'],
    access: 'Website feed integrations are described; no public third-party export/API contract was found.',
    gate: 'Confirm dealer/vendor authorization, feed direction, field list, cadence, and any export rights before setup.',
    url: 'https://dealeralchemist.com/services/websites-nexus', aliases: ['Dealer Alchemist', 'Websites Nexus'],
  },
  {
    id: 'overfuel', name: 'Overfuel', category: 'public_inventory', segment: 'Website inventory',
    evidence: ['Public API documentation describes dealer-scoped, read-only inventory and VIN/filter routes.'],
    access: 'Bearer-key JSON API; public docs state inventory scope and a 60-request-per-minute limit.',
    gate: 'Dealer admin creates a scoped key; confirm allowed rooftops, data fields, and current API plan.',
    url: 'https://api.overfuel.com/',
  },
  {
    id: 'dealer-spike', name: 'Dealer Spike', category: 'public_inventory', segment: 'Website inventory',
    evidence: ['Help materials document inbound DMS inventory feeds to dealer websites and trim matching.'],
    access: 'Inbound website feed is documented; outward export/API was not verified.',
    gate: 'Request vendor confirmation and dealer authorization for an external inventory feed.',
    url: 'https://help.dealerspike.com/dms-integrations',
  },
  {
    id: 'leadbox', name: 'GM Leadbox', category: 'public_inventory', segment: 'OEM website inventory',
    evidence: ['GM Canada describes DMS-fed dealer inventory, pricing/rebates, and listing syndication; external read API and field schema are not documented.'],
    access: 'Dealer website package with configured DMS connection.',
    gate: 'OEM/dealer enrollment and vendor setup; this does not establish a separate third-party feed.',
    url: 'https://www.gmdealerdigital.ca/Website/Leadbox', aliases: ['Leadbox'],
  },
  {
    id: 'dealer-car-search', name: 'Dealer Car Search', category: 'public_inventory', segment: 'Website inventory',
    evidence: ['Official materials document a specific Frazer-to-website vehicle sync and website-lead-to-Frazer path; no general inventory API was found.'],
    access: 'Provider-paired DMS integration; general outward feed contract not documented.',
    gate: 'Dealer must enable the named vendor integration; confirm direction and data fields with both providers.',
    url: 'https://qareact.dealercarsearch.com/frazer-integration', aliases: ['DCS'],
  },
  {
    id: 'carsforsale-crm', name: 'Carsforsale.com', category: 'crm', segment: 'Independent CRM / DMS / website',
    evidence: ['Official materials describe lead management and inventory exports to listing partners; no third-party CRM/inventory read API was found.'],
    access: 'Dealer product and outbound syndication; external read interface not documented.',
    gate: 'Dealer subscription and a separate approved data-export contract are required for external access.',
    url: 'https://dealers.carsforsale.com/dealer-lead-management/', aliases: ['Carsforsale'],
  },
  {
    id: 'dealerfire', name: 'DealerFire', category: 'public_inventory', segment: 'Website inventory',
    evidence: ['Official product materials describe real-time DMS inventory feeds to dealer websites.'],
    access: 'Website inbound feed described; external export format/API not publicly verified.',
    gate: 'Vendor and dealer must approve any separate outward feed and identify its field scope.',
    url: 'https://www.dealer.solera.com/products/dealersocket/dealerfire/', aliases: ['Solera DealerFire'],
  },
  {
    id: 'home-net', name: 'HomeNet IOL', category: 'other', segment: 'Merchandising and inventory feed',
    evidence: ['Public API metadata lists VIN/stock, pricing, mileage, colors, drivetrain, equipment, and photo metadata; export and sticker-PDF operations are documented.'],
    access: 'XML/JSON/CSV HTTP API and dealer export workflow; documented schemas do not establish an account entitlement.',
    gate: 'Dealer subscription, authorized rooftop access, source/licensor permissions, and export configuration required.',
    url: 'https://www.homenetauto.com/eula/', aliases: ['HomeNet', 'IOL'],
  },
  {
    id: 'vauto', name: 'vAuto', category: 'vauto', segment: 'Merchandising and inventory feed',
    evidence: ['Cox describes inventory-management integrations; a general public dealer inventory API schema was not found. Separate OBD API docs cover cached scans and indicators.'],
    access: 'Dealer product integration/feed; OBD API is separately documented and is not a general inventory feed.',
    gate: 'Dealer vAuto relationship and written integration/data scope; product terms govern use and redistribution.',
    url: 'https://www.coxautoinc.com/terms/wp-content/uploads/sites/3/vAuto-Integration-Terms-and-Conditions.pdf',
  },
  {
    id: 'dealer-specialties', name: 'Dealer Specialties', category: 'other', segment: 'Merchandising and syndication',
    evidence: ['Vendor advertises inventory distribution to third-party destinations.'],
    access: 'Syndication service is described; dealer-readable API/export format was not found.',
    gate: 'Dealer account and recipient/vendor authorization; request a current export specification.',
    url: 'https://www.dealerspecialties.com/distribution',
  },
  {
    id: 'autocheck', name: 'Experian AutoCheck', category: 'autocheck', segment: 'Vehicle history',
    evidence: ['Public materials describe history reports with accident/damage, odometer, title, ownership/use, auction, and recall sections; Auto AccuSelect offers API attributes.'],
    access: 'Dealer report subscription, partner FastLink, or licensed Auto AccuSelect API.',
    gate: 'Business verification and contract; third-party API/FastLink integrations require partner approval and data-use terms.',
    url: 'https://www.experian.com/automotive/vehicle-history-services', aliases: ['AutoCheck', 'Experian AutoCheck', 'Auto AccuSelect'],
  },
  {
    id: 'carfax', name: 'CARFAX', category: 'carfax', segment: 'Vehicle history',
    evidence: ['CARFAX offers dealer vehicle-history products; public pages do not define a full structured API schema.'],
    access: 'Dealer report product; third-party integration requests go through Business Development.',
    gate: 'Dealer subscription and explicit integration/data-display approval required.',
    url: 'https://www.carfax.com/company/partners', aliases: ['CARFAX Vehicle History'],
  },
  {
    id: 'dataone', name: 'DataOne VIN Decoder', category: 'equipment', segment: 'Equipment and enrichment',
    evidence: ['Product docs describe trim/style, installed and available equipment/packages, specs, colors, warranty, and base/as-built MSRP; some reference datasets offer daily SFTP.'],
    access: 'Licensed REST API (XML/JSON); selected reference data also offered by SFTP.',
    gate: 'Commercial license required; OEM build data has additional OEM terms and coverage limits.',
    url: 'https://www.dataonesoftware.com/web-services-vin-decoder-api', aliases: ['DataOne', 'DataOne Software'],
  },
  {
    id: 'chrome-data', name: 'J.D. Power / ChromeData', category: 'equipment', segment: 'Equipment and enrichment',
    evidence: ['Integration documentation describes VIN-based features, packages, technical specs, and vehicle attributes.'],
    access: 'Licensed vendor integration; public guide is not proof of an open public API entitlement.',
    gate: 'Current product license, approved integration, and redistribution terms must be confirmed.',
    url: 'https://portal.jdpower.com/wp-content/uploads/2024/04/CVDIntegrationGuide_2026_February-2.pdf', aliases: ['ChromeData', 'J.D. Power'],
  },
  {
    id: 'marketcheck', name: 'MarketCheck', category: 'other', segment: 'Licensed listing data',
    evidence: ['Public API docs describe dealership-inventory search and listing/spec data; this is third-party listing coverage, not dealer source-of-truth authorization.'],
    access: 'Licensed JSON API and data feeds.',
    gate: 'API key/plan and contract required; verify provenance, coverage, freshness, and permitted use.',
    url: 'https://docs.marketcheck.com/docs/api/cars/dealership-syndication/dealership-inventory',
  },
  {
    id: 'ford-direct', name: 'FordDirect', category: 'oem', segment: 'OEM dealer programs',
    evidence: ['FordDirect describes Ford/Lincoln dealer inventory tools and lists website partners; no public general dealer inventory API contract was found.'],
    access: 'Dealer program and partner integrations; public sources do not document a general external feed schema.',
    gate: 'Eligible Ford/Lincoln retailer and program/vendor approval; confirm feed rights, fields, and rooftop scope.',
    url: 'https://www.forddirect.com/solutions', aliases: ['Ford Direct'],
  },
  {
    id: 'ford-developer', name: 'Ford Developer APIs', category: 'oem', segment: 'OEM data and connected vehicle',
    evidence: ['Public marketplace lists customer-consented connected-vehicle APIs and an EU-only WLTP API; no dealer inventory/build/sticker API is documented.'],
    access: 'OAuth customer consent for connected-vehicle data; WLTP API is for authorized system providers.',
    gate: 'Developer access and use-case approval; APIs described publicly do not authorize inventory scraping or sticker redistribution.',
    url: 'https://developer.ford.com/apis', aliases: ['Ford', 'Lincoln'],
  },
  {
    id: 'toyota-fleet-data', name: 'Toyota Fleet Data Services', category: 'oem', segment: 'OEM dealer programs',
    evidence: ['Toyota fleet materials describe vehicle-data API and file-package options; they do not establish a general dealer inventory feed.'],
    access: 'Direct API integration or data package.',
    gate: 'Signed Toyota Data Services Agreement and applicable fleet/dealer authorization required.',
    url: 'https://fleet.toyota.com/ftc/public/staticContent/docs_public/Forms/Miscellaneous%20Forms%20and%20Documents/Archived/Fleet%20Data%20Packages.pdf', aliases: ['Toyota Fleet'],
  },
  {
    id: 'nhtsa-vpic', name: 'NHTSA vPIC', category: 'equipment', segment: 'Government VIN decoding',
    evidence: ['Public VIN decode API/database returns manufacturer-submitted vehicle variables and basic specifications; batch API accepts up to 50 VINs.'],
    access: 'Public HTTPS API in JSON/XML/CSV or downloadable database; rate controls apply.',
    gate: 'Coverage varies with manufacturer submissions; missing values do not mean a feature is absent. It does not provide as-built MSRP or vehicle history.',
    url: 'https://vpic.nhtsa.dot.gov/api/Home/Index', aliases: ['vPIC', 'NHTSA VIN Decoder'],
  },
  {
    id: 'nhtsa-recalls', name: 'NHTSA Recalls API', category: 'oem', segment: 'Government recall information',
    evidence: ['Public API returns recall campaigns by model year, make, and model; it is not VIN completion evidence.'],
    access: 'Public API query by year/make/model.',
    gate: 'Confirm VIN applicability and completion with an authorized OEM/dealer source.',
    url: 'https://www.nhtsa.gov/nhtsa-datasets-and-apis', aliases: ['NHTSA recalls', 'NHTSA recall API'],
  },
]

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
}

function searchableNames(profile: SourceProfile): string[] {
  return [profile.name, ...(profile.aliases ?? [])]
}

/** Exact normalized vendor name/alias match with a matching provider category. */
export function matchSourceProfile(provider: string, vendor: string): SourceProfile | undefined {
  const category = normalize(provider)
  const vendorName = normalize(vendor)
  if (!category || !vendorName) return undefined
  return SOURCE_CATALOG.find(profile => normalize(profile.category) === category && searchableNames(profile).some(name => vendorName === normalize(name)))
}

export function sourceProfiles(query: string, category?: string): SourceProfile[] {
  const term = normalize(query)
  return SOURCE_CATALOG.filter(profile => {
    if (category && profile.category !== category) return false
    if (!term) return true
    const text = [profile.name, profile.category, profile.segment, profile.access, profile.gate, ...profile.evidence, ...(profile.aliases ?? [])].map(normalize).join(' ')
    return text.includes(term)
  })
}
