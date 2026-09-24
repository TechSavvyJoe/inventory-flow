# ADR-001: Server-owned identity boundary

- **Status:** Amended for the deployed Cloudflare Access architecture
- **Date:** 2026-09-01
- **Amended:** 2026-09-09
- **Deciders:** Inventory Flow product owner and deployment/security owner
- **Operational authority:** [Private Cloudflare application runbook](CLOUDFLARE_PRIVATE_RELEASE_RUNBOOK.md)

## Context

Inventory Flow authorizes access to customer-sensitive hold evidence and operational actions by employee, role, and Home Store. The prototype previously accepted those values from ordinary browser headers and bootstrap query parameters. That was useful for role previews, but a browser could claim a manager role or a different store. Payload checks prevented some actor spoofing, yet the context used by those checks was itself untrusted.

The local synthetic demo must stay easy to run on Windows and macOS. The repository must not embed dealership credentials or expose service secrets to browser JavaScript. Production must fail closed and must not trust browser-selected identities, roles, stores, or ordinary request headers.

The deployed application now runs directly on Cloudflare Workers behind Cloudflare Access. This amendment supersedes the prototype-only trusted-proxy and shared-secret production design below. It does not assert that any particular Access identity provider or broader employee policy is enabled; those settings are external deployment state and must be verified in Cloudflare Zero Trust.

## Decision

Use separate, explicit identity boundaries for local demonstration and deployed production:

1. `demo` remains non-production only. It uses synthetic or explicitly authorized local data and clearly identified preview identity controls. Production must never fall back to demo identity.
2. Cloudflare Access is the deployed employee authentication boundary. Access performs the interactive identity-provider flow. For every protected request, the Worker independently verifies the `cf-access-jwt-assertion` signature, issuer, employee-application audience, algorithm, expiry, issued-at time, and required claims against the Access public key set.
3. A valid Access token is necessary but not sufficient. The Worker accepts an employee only when the token has an email claim and that normalized email exactly matches one enabled `cloud_memberships` row in D1. The D1 row—not browser input or identity-provider role claims—supplies the application user ID, display name, role, and Home Store.
4. Service-token identities are rejected from employee routes. The release publisher uses a separate Access audience plus an additional purpose-scoped Worker secret and cannot use the employee application route.

User-supplied role/store headers and write-payload actor fields do not grant authority. The API resolves canonical identity for every protected request, and the workflow service rejects missing, invalid, disabled, or unmapped identities rather than defaulting to Sales/Howell.

Google or another approved sign-in option belongs in the existing Cloudflare Access application. Enabling an Access identity provider does not require a second OAuth implementation in the React client, but every permitted employee still requires both an approved Access policy decision and a matching enabled D1 membership. Recreating the Access application changes its audience and therefore requires a coordinated Worker configuration change; adding a provider to the existing application avoids that unnecessary break.

## Options Considered

### Option A: Keep browser-selected role and store

| Dimension | Assessment |
|---|---|
| Complexity | Low |
| Security | Unacceptable for production |
| Demo usability | High |
| Operations | No identity-provider dependency |

**Pros:** Simple and already implemented.  
**Cons:** Any caller can impersonate a manager or another store; audit actors are not trustworthy.

### Option B: Trusted authenticated upstream with a shared secret (superseded prototype design)

| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Security | Depended on private routing, correct header stripping, and shared-secret handling |
| Demo usability | Preserved through isolated demo mode |
| Operations | Requires gateway configuration and secret rotation |

**Pros:** Provider-neutral and removed direct trust from browser-selected roles.

**Cons:** The shared secret authenticated a gateway rather than the employee and required a private origin plus perfect header replacement. The deployed Worker no longer uses this as its production trust boundary.

### Option C: Implement OIDC sessions directly in Inventory Flow now

| Dimension | Assessment |
|---|---|
| Complexity | High |
| Security | Strong after provider-specific implementation and review |
| Demo usability | Requires a separate bypass or test provider |
| Operations | Requires provider registration, redirects, cookies, keys, and session lifecycle |

**Pros:** End-to-end identity can be owned by the application.  
**Cons:** Duplicates session, redirect, cookie, key-rotation, and logout responsibilities already supplied by Cloudflare Access.

### Option D: Cloudflare Access assertion plus exact D1 membership (chosen for the deployed app)

| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Security | Signed edge identity plus an independent application authorization lookup |
| Demo usability | Preserved through isolated local demo mode |
| Operations | Requires stable Access audiences, explicit Access policy, and managed D1 membership |

**Pros:** No browser-owned authorization, no application OAuth secret, independent JWT verification in the Worker, application roles remain server-owned, and employee revocation can be enforced in both Access and D1.

**Cons:** Access policy and identity-provider settings live outside the repository and therefore require separate operational verification. A token for the wrong Access application or an employee without an enabled D1 row is correctly denied.

## Trade-off Analysis

The chosen boundary removes trust from browser-controlled identity and authorization values without adding a second application-managed login system. Security depends on retaining the existing Access protection, stable and separate employee/publisher audiences, strict Worker JWT verification, explicit Access policy, least-privilege D1 membership, and managed Worker secrets. None of these values may be compiled into Vite assets.

The demo remains intentionally insecure and visibly separate. It is appropriate only on loopback/local contributor machines with synthetic or authorized local data.

## Consequences

- Production requests fail closed instead of falling back to a prototype identity.
- The Node server is synthetic-demo only: it has no trusted-proxy mode, refuses to start with `NODE_ENV=production` (`NODE_SERVER_DEMO_ONLY`), needs an explicit synthetic release loader, and refuses a file-backed ledger. Production runs on the Cloudflare Worker.
- Access supplies authenticated employee identity; enabled D1 membership supplies application user, role, and Home Store.
- Client role previews cannot elevate production authorization.
- Adding Google or another identity provider is an Access configuration change, not a React authentication feature.
- An Access allow decision without a matching enabled membership remains unauthorized.
- Employee and release-publisher audiences remain separate.
- Independent Home Store approval still requires an authenticated Home Store manager action in the workflow if the business elects to add that stronger two-party control.

## Remaining Access rollout checks

Before expanding beyond the current pilot, the deployment owner must verify and document:

1. sign-in, logout, session expiry, and identity-provider recovery behavior on desktop and mobile;
2. the intended Google or other approved Access identity provider is enabled on the existing employee Access application;
3. Access policy allows only approved employee identities and denies identities outside the pilot;
4. every employee has exactly one enabled D1 membership with the correct least-privilege role and Home Store;
5. disabled, removed, unmapped, wrong-audience, expired, malformed, and service-token identities are rejected;
6. cross-store access, manager-only actions, transport restrictions, and terminated-user revocation work as documented;
7. employee and publisher audience/key rotation, incident revocation, and recovery procedures are exercised;
8. audit retention and alerting cover identity, action, store, timestamp, and request correlation without logging sensitive payloads.

## Action Items

1. [x] Protect the employee hostname with Cloudflare Access and disable alternate Workers.dev/preview entry points.
2. [x] Independently verify Access JWT issuer, audience, signature, algorithm, time, and required claims in the Worker.
3. [x] Resolve canonical employee authorization through enabled exact-email D1 membership and reject service-token identities.
4. [x] Separate employee and release-publisher audiences and privileges.
5. [ ] Verify the chosen Access identity provider and policy in live Cloudflare state; repository files cannot prove this configuration.
6. [ ] Complete the broader employee, role/store, revocation, accessibility, and recovery acceptance checks in the operational runbook.
