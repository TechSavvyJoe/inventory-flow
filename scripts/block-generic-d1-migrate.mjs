// This database predates Wrangler's migration ledger. A generic `migrations
// apply` would try to replay historical schema changes and can leave the
// ledger partially populated. Keep the old script name as a fail-closed guard
// so an accidental invocation cannot write to production.
console.error([
  'Generic D1 migration is intentionally blocked.',
  'See docs/CLOUDFLARE_PRIVATE_RELEASE_RUNBOOK.md for the reviewed,',
  'single-file, explicitly authorized production migration procedure.',
].join(' '))
process.exitCode = 1
