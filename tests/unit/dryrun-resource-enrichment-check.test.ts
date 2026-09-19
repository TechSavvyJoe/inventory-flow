// @vitest-environment node
// The PowerShell publisher aborts the whole day on a non-zero exit from this
// dry run, so it must mirror the importer's publish-mode degradation rather
// than the strict validator. The degradation semantics themselves are covered
// in server-importer.test.ts; this locks in which validator the gate calls.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(fileURLToPath(new URL('../../scripts/dryrun_resource_enrichment_check.mjs', import.meta.url)), 'utf8')

describe('dryrun_resource_enrichment_check', () => {
  it('validates the enrichment file in publish mode', () => {
    expect(source).toContain('validateVinDocumentEnrichmentForPublish(raw, {')
    expect(source).not.toMatch(/\bvalidateVinDocumentEnrichment\(/)
  })

  it('still reports the rejected optional channels', () => {
    expect(source).toContain('onResourceRejected')
    expect(source).toContain('validateVinDocumentEnrichment_rejections')
  })
})
