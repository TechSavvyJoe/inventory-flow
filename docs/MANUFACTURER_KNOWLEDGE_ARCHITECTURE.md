# Shared manufacturer knowledge on Cloudflare

Status: proposed cloud extension, not deployed. The local 1.4.1 candidate includes
a small official-reference library shared by the app and companion. It is not a
complete Ford/Lincoln package database and does not establish installed equipment.

## Purpose and existing connection

Staff should be able to explain a captured option, see the contents of the exact
package version, compare model years and find an official reference without
leaving the vehicle workflow. Other authorized software and AI clients should
read the same reviewed information.

Inventory Flow already has a Cloudflare integration Worker, a shared read service
and authenticated MCP at `/mcp`. Its existing `get_vehicle_resources` tool returns
VIN-specific parsed document facts. Extend that service rather than create a
second authentication system or an unprotected MCP server. Do not change the
inventory publisher or make knowledge publication depend on a daily inventory
capture.

## Storage and record boundaries

Use **D1** for structured records and lookup indexes, and **R2** for immutable
versioned knowledge bundles. Keep them separate from inventory snapshots. A
bundle contains reviewed structured data and official URLs; retain original PDFs
only where permission or licensing allows it. Do not archive authenticated
DealerMail, vAuto or FMCDealer pages in the knowledge store.

Each record needs:

- Make, exact model, model year, original market and applicable trim or series.
- Package name and option code, explicit included items, prerequisites,
  exclusions and build-date or order-guide revision limits where documented.
- Feature explanation and sales demonstration notes, including relevant
  subscription, trial or activation conditions.
- Official source URL, page or section, document revision, content digest,
  reviewed date and review state.
- Stable record ID, bundle version and links to superseded versions.

VIN equipment remains source evidence from the daily pull. A guide can say what
a package normally contains within its documented applicability; it cannot say
that an inventory vehicle has those items. A model-wide towing maximum, a trim
name, an eligibility rule or an AI summary must not become a VIN-specific fact.
Keep missing information unknown. Conflicting guides require review rather than
silently choosing the newest model year. Canadian or other-market equipment must
not borrow US package contents.

## API and MCP shape

The following are proposed, not currently callable:

| Consumer | Proposed read operation | Result |
| --- | --- | --- |
| App, companion or another system | `GET /api/v1/knowledge` | Bounded exact make/model/year/market/package lookup with source citations |
| App or another system | `GET /api/v1/knowledge/:id` | One reviewed record with revision and applicability |
| MCP | `search_equipment_knowledge` | The same lookup, without free-form SQL or arbitrary URL fetching |
| MCP | `compare_package_years` | Only documented differences between two applicable records, with unknowns preserved |

Use the existing authenticated principal, rate limits, audit path and bounded
schemas. Introduce an explicit `knowledge.read` permission rather than granting
all existing clients access automatically. Recheck permission on each request;
client revocation and store restrictions still apply to any inventory lookup.
Expose read-only MCP annotations and the same structured response to API and MCP
clients. Keep customer data and employee-owned lists out of this service.

An answer should separate `capturedVehicleFacts`, `manufacturerReference` and
`unverifiedOrMissing`, and cite the record version. The API must not synthesize
package contents from similar years. Use conditional requests and bounded client
caches; cache keys include knowledge version and authorization context. Retain the
last successful authorized result during a transient fetch failure and label it
retained. Clear private inventory context on employee changes or revocation.

## Update and rollout sequence

1. Inventory the actual make/model/year/market combinations in authorized data;
   the synthetic fixture cannot establish production coverage.
2. Review official Ford and Lincoln sources for those combinations first, then
   other makes. Validate codes, revisions, provenance and contradictory entries.
3. Test a shared lookup service with wrong-year/model/market, missing contents,
   stale versions, denied scopes, revoked clients and bounded results.
4. Add the D1 index and R2 bundle path through a separately authorized release,
   with a rollback point for schema and active knowledge version.
5. Publish an immutable reviewed bundle and switch the active version atomically
   only after validation. A failed import leaves the previous version active.
6. Enable authenticated API and MCP consumers, then update the app and companion
   to read that version. Verify citation links and installed-equipment separation
   with live authorized data before calling the cloud connection complete.

Structured lookups are sufficient for the first release. Semantic search can be
added later if tested need warrants it; it must return cited records, not invent
vehicle facts. AI can propose draft explanations, but cannot publish them or
overwrite reviewed facts automatically.

## Current local coverage

The shared module `extension/sidepanel/lib/manufacturer-knowledge.mjs` contains
official US links for a limited set of Ford F-150/Bronco Sport, Lincoln
Nautilus/Corsair/Aviator and Toyota Corolla years. General Ford towing and
driver-assist, Lincoln ownership, Toyota Safety Sense and Chevrolet Super Cruise
references supplement those links. Exact guide links do not fall back to a nearby
year or different model. An explicitly non-US original market suppresses US
model-year prompts; an unknown market remains reference material and asks staff
to check it.

The app and companion show reference explanations in the expandable Equipment
sales guide, matched to explicit captured labels. No package contents, speaker or
seat counts, tow ratings, subscription status or installed options are inferred.
No knowledge schema, cloud bundle, API route, MCP tool or live binding was changed
as part of this local starter.

## Platform references

- [Cloudflare D1](https://developers.cloudflare.com/d1/)
- [Cloudflare R2](https://developers.cloudflare.com/r2/)
- [Cloudflare remote MCP](https://developers.cloudflare.com/agents/model-context-protocol/)
