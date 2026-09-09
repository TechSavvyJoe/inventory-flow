# Inventory Flow recovery verification

The application has two recovery components: the D1 operational database and the encrypted R2 source releases. A daily source release does not contain current move requests or alert assignments. Recover both components and keep their release pointer, version, hashes and encryption keys together.

## Offline synthetic exercise

Run from this repository with Node 24 or newer:

```powershell
node scripts/run-recovery-drill.mjs
```

This command accepts no live path, key or remote arguments. It creates only fabricated evidence, applies the current Cloudflare migrations to isolated SQLite, and exercises the real D1 repository and application service. It creates a move request, manager review, home-store release confirmation, an exact-text audit note and an alert acknowledgment. It backs up SQLite, encrypts the backup, closes and removes the source database, then decrypts and restores a fresh database.

The exercise verifies every table and schema object; exact audit text and immutable identities; all 24 role/store bootstrap views; revision and duplicate-action behavior; foreign keys and integrity; append-only audit triggers; complete source evidence decryption; and rejection of wrong keys, changed metadata and tampered ciphertext. Temporary databases and ephemeral keys are discarded. A count/hash-only summary is retained under ignored `runtime/recovery-drills/`.

The September 9, 2026 exercise passed with 15 tables, 32 schema objects, 24 synthetic memberships, one transfer, four transfer audit records, one alert/action pair and revision 5. The source fixture retained eight public and eight CRM rows, two held VINs, three active holds, one backup and one deleted historical record. These are synthetic test values, never production counts.

## Verify an actual exported database without restoring production

1. Use the protected `runtime/cloud-secrets/recovery/` directory with the existing current-user Windows ACL. Choose unique filenames. An operator with authorized D1 read access exports the production database to that exact directory. The export contains private application data and must not be printed, committed or attached to an issue.
2. Invoke `scripts/verify-d1-recovery-export.mjs` through `scripts/cloud-secret-store.ps1 -Mode Run`, passing `--input <export.sql> --output <backup.encrypted.json>`. The wrapper supplies the existing key in the child process; never provide the key as a command-line argument.
3. The verifier restores the export into memory, validates its schema, operational protections, integrity and foreign keys, writes an AES-256-GCM envelope, reopens and decrypts that artifact, then restores again in memory and compares every schema/table/audit digest. Wrong-key, ciphertext-tamper and metadata-tamper probes must fail. It writes a count/hash-only `.verification.json` beside the envelope. An existing encrypted backup is never overwritten.
4. Add `--disposable-export` only for the exact newly created SQL export. After successful verification, the verifier checks the file identity and hash again and removes only that disposable plaintext export. Without the flag it retains the input. A failed validation retains the source export for authorized investigation.
5. Independently query D1 aggregate table counts, release pointer/version and revision to corroborate the export. If legitimate operations changed during capture, explain the capture point; do not silently call different revisions equivalent.
6. Verify the encrypted artifact again after the SQL export has been removed:

```powershell
& ./scripts/cloud-secret-store.ps1 -Mode Run -Script scripts/verify-d1-recovery-export.mjs -ScriptArguments @('--verify-backup', '<absolute private backup.encrypted.json>')
```

This last command uses only the encrypted artifact and the managed key, and restores only into local memory. It makes no network request. A successful verification does not change the live D1 database or application release.

### September 9, 2026 actual-export result

The authorized production D1 SQL export was verified through the protected wrapper. All 15 tables and 32 schema objects matched exactly after authenticated encryption and in-memory restoration; revision 7 was retained. The export contained two move requests, two transfer audit records, one attention item and one attention audit record, one membership, six release versions and three release-state rows. Integrity, foreign keys, required audit triggers, wrong-key rejection and ciphertext/metadata-tamper rejection passed. Independent queries against live D1 subsequently corroborated all 15 table counts and revision 7; both checks reported zero rows written.

The disposable 20,726-byte SQL export was removed only after successful validation. The 27,908-byte encrypted artifact remains under the current-user-only ACL at `runtime/cloud-secrets/recovery/production-2026-09-09.encrypted.json`; its companion `.verification.json` records aggregate counts and hashes. A second verification used only this encrypted backup and the protected key and passed after the SQL was gone. No production database, membership, release pointer or key was changed. This is an actual-data export/recovery exercise performed locally; it does not establish recovery from loss of the account or encryption key.

## Authorization coverage

Existing tests exercise all application roles, store boundaries, private-field redaction, transport assignments tied to immutable employee IDs, atomic audit writes, concurrency and idempotency. `cloud-access-revocation.test.ts` additionally exercises real signed JWTs and real SQLite membership queries: missing required claims, wrong signature, service identities on employee routes, immediate disable/delete of membership while the same valid token remains in use, and current server-side role/store changes overriding old token claims or forged headers.

These checks do not sign into actual employee accounts or simulate an identity-provider outage. Test real employee logins, scope, logout, session expiry and revocation before adding those staff to the pilot.

## Recovery limits and incident procedure

An in-memory restore of a real export proves that that exported artifact can be decrypted and read using the available key. It does not prove that the key, cloud account or workstation will remain accessible after an actual loss. Current DPAPI settings are Windows-user/machine-bound. A copied DPAPI file cannot serve as independent Mac recovery escrow.

The owner still needs an independently controlled, approved recovery secret store, accountable recovery operators, verified access to historical keys, a retention decision, and an exercise from a different authorized machine. Retain the correct historical encryption key for each retained artifact; rotating the current key alone cannot make old encrypted releases readable.

Cloudflare's [Time Travel documentation](https://developers.cloudflare.com/d1/reference/time-travel/) states that a restore overwrites the chosen database in place and interrupts in-flight work. Read-only bookmark inspection is safe preparation; a real restore requires a concrete approved incident/recovery point, preservation of the current bookmark, and reconciliation of actions after that point. The [D1 import/export guide](https://developers.cloudflare.com/d1/best-practices/import-export-data/) describes the export/import process. No production Time Travel restore is part of these scripts.

For source recovery, also verify the selected immutable R2 object through authenticated decryption and the full existing source validator; preserve its source hashes and date. Do not advance the current release to incomplete evidence. A faulty UI deployment can be rolled back independently while retaining D1, R2, Access and managed secrets.
