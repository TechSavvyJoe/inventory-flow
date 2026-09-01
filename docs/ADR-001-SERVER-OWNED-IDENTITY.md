# ADR-001: Server-owned identity boundary

**Status:** Accepted for prototype hardening; real dealership SSO integration remains required  
**Date:** 2026-09-01  
**Deciders:** Inventory Flow product owner and deployment/security owner

## Context

Inventory Flow authorizes access to customer-sensitive hold evidence and operational actions by employee, role, and Home Store. The prototype previously accepted those values from ordinary browser headers and bootstrap query parameters. That was useful for role previews, but a browser could claim a manager role or a different store. Payload checks prevented some actor spoofing, yet the context used by those checks was itself untrusted.

The local synthetic demo must stay easy to run on Windows and macOS. The repository must not embed dealership credentials, select an identity provider prematurely, or expose service secrets to browser JavaScript. A production process must not start in an unsafe fallback mode.

## Decision

Use two explicit server identity modes:

1. `demo` is the non-production default. It accepts clearly named `x-inventory-demo-*` headers (plus the legacy local aliases during migration) and bootstrap preview parameters. `NODE_ENV=production` rejects this mode during startup.
2. `trusted_proxy` is the only production mode. It requires a server-side secret of at least 32 characters and accepts only `x-inventory-authenticated-user`, `x-inventory-authenticated-role`, and `x-inventory-authenticated-store` when the upstream also supplies the matching secret. Query parameters and browser demo/legacy headers do not affect authorization.

The API resolves identity for every protected request. The workflow service rejects missing or invalid context rather than silently defaulting to Sales/Howell. Bootstrap returns the canonical server access context so the UI can align its display with the authenticated identity. The browser API client removes actor, actor-role, store, requester, and requesting-store fields from write payloads; the server continues rejecting conflicting fields sent by another client.

`GET /api/health` remains unauthenticated for process health checks and returns no protected data.

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

### Option B: Trusted authenticated upstream with a server-to-server secret (chosen)

| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Security | Strong boundary when the backend is private and the gateway strips/replaces headers |
| Demo usability | Preserved through isolated demo mode |
| Operations | Requires gateway configuration and secret rotation |

**Pros:** Provider-neutral, no browser secret, fail-closed startup, canonical server identity, compatible with Entra ID/Okta/another dealership-approved provider.  
**Cons:** The shared secret authenticates the gateway—not the employee. Correct edge isolation, header stripping, group mapping, and identity-provider configuration are still mandatory.

### Option C: Implement OIDC sessions directly in Inventory Flow now

| Dimension | Assessment |
|---|---|
| Complexity | High |
| Security | Strong after provider-specific implementation and review |
| Demo usability | Requires a separate bypass or test provider |
| Operations | Requires provider registration, redirects, cookies, keys, and session lifecycle |

**Pros:** End-to-end identity can be owned by the application.  
**Cons:** No dealership provider, tenant, claims, group rules, or deployment host has been approved; inventing those details would create false assurance.

## Trade-off Analysis

The chosen boundary removes trust from browser-controlled values without pretending a full SSO system exists. Its security depends on deployment topology: the application backend must not be directly reachable, the gateway must delete incoming identity/secret headers before adding its own, TLS must terminate within the trusted boundary, and both services must receive the secret from managed secret storage. The secret should be rotated and never compiled into Vite assets.

The demo remains intentionally insecure and visibly separate. It is appropriate only on loopback/local contributor machines with synthetic or authorized local data.

## Consequences

- Production startup fails instead of falling back to a prototype identity.
- Roles, stores, and audit actors come from the server-resolved context.
- Client role previews cannot elevate production authorization.
- Deployment needs a trusted gateway and managed secret before it can run.
- Independent Home Store approval still requires an authenticated Home Store manager action in the workflow if the business elects to add that stronger two-party control.
- Existing UI code may continue to construct legacy identity fields temporarily because the API client strips them and the server rejects conflicts, but removing those component-level placeholders remains cleanup work.

## Remaining SSO Integration Step

Before production use, the deployment owner must connect the approved dealership identity provider to the trusted upstream and document/test:

1. employee sign-in, logout, session expiry, and disabled-account behavior;
2. authoritative mapping from provider subject/group claims to Inventory Flow user, role, and Home Store;
3. rejection of employees without an allowed role/store;
4. edge removal of all inbound `x-inventory-*` headers before trusted values are injected;
5. private network access from the gateway to Inventory Flow, with no direct public backend route;
6. secret generation, storage, rotation, and incident revocation;
7. audit-log retention for identity, action, store, timestamp, and request correlation;
8. tests for cross-store access, manager-only actions, transport roles, and terminated users.

## Action Items

1. [x] Add fail-closed production configuration and trusted-proxy identity resolution.
2. [x] Return canonical access context and strip client identity fields from normal writes.
3. [x] Add focused configuration, spoofing, and persistence tests.
4. [ ] Select and configure the approved dealership identity provider and gateway.
5. [ ] Put the backend on a private route and verify header stripping with an external penetration test.
6. [ ] Add provider-specific integration tests and production audit monitoring.
