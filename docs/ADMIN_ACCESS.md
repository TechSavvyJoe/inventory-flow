# Control center access

Open `/admin`, or choose **Control center** in the left navigation. The signed-in employee must have an enabled `group_manager` membership. While testing a lower role, use **Return to Group manager** first.

## People & access

Group managers can add employees, change names, roles and home stores, and enable or disable access. Every save requires a reason and produces an append-only access-history entry. Sign-in email and the generated employee ID stay tied to the same history; an email change requires disabling the old account and adding a new account. Another group manager must change your own role or disable you. The database also prevents removing the final active group manager.

Adding an employee does not send an invitation. The employee must also be admitted by the site's Cloudflare Access sign-in policy. The pilot currently has a limited sign-in policy; access to the Cloudflare dashboard is required to expand that policy. Application membership alone does not bypass that gate.

The initial group manager is configured by a trusted owner with access to the production database. Resolve the exact enabled email and immutable `user_id`, record the previous membership, and perform a revision-guarded update to `role='group_manager'` together with a `cloud_membership_events` audit entry. The browser cannot grant itself an initial administrator role. Never change another user's row or broaden the sign-in policy as a side effect of bootstrap.

## Deployment prerequisite

Apply only `cloudflare/migrations/0009_membership_admin.sql` to an already migrated database before deploying the membership-management routes. It adds the append-only access history and final-group-manager protection triggers. It does not change memberships or other business data. Generic migration execution remains blocked by the repository's release safeguards.

`GET /api/admin/members` returns the membership directory, current revision and recent access history. `POST /api/admin/members` requires the signed-in enabled group-manager membership, same-origin request, an idempotency key, a supported role and store, and the revision seen by the editor. The directory change, audit event and application revision advance commit atomically. A stale editor must reload and review the change again.

## Local demo

The synthetic launcher uses an isolated in-memory employee directory and the same validation and transactions. Its sample emails use `example.invalid`. Demo changes disappear when the server restarts and do not change real sign-in access.

## Settings covered in this release

People & access edits are live controls. Feed health, source freshness and operational activity remain observations from the actual feeds and workflow ledger. Provider/import tuning and feature settings should be added only together with their real backend consumers; this release does not expose decorative controls that have no effect.
