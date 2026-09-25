// @vitest-environment node
// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
// @ts-expect-error -- shared Node/Worker ESM module
import { prepareIssuePhotos, sanitizeIssueJpeg, ISSUE_PHOTO_BYTES } from '../../server/issue-photos.mjs'
// @ts-expect-error -- Worker ESM module
import { readIssuePhoto, storeIssuePhotos } from '../../cloudflare/src/issue-photo-storage.mjs'

const jpeg = readFileSync(new URL('../../public/demo-vehicles/f150.jpg', import.meta.url))
const segment = (marker: number, text: string) => {
  const data = Buffer.from(text)
  const header = Buffer.from([0xff, marker, 0, 0])
  header.writeUInt16BE(data.length + 2, 2)
  return Buffer.concat([header, data])
}

describe('staff photo upload trust boundary', () => {
  it('retains a synthetic JPEG while stripping EXIF/GPS, comments and application metadata', () => {
    const annotated = Buffer.concat([jpeg.subarray(0, 2), segment(0xe1, 'Exif\0SYNTHETIC GPS PRIVATE'), segment(0xfe, 'SYNTHETIC comment'), segment(0xed, 'SYNTHETIC editor metadata'), jpeg.subarray(2)])
    expect(sanitizeIssueJpeg(annotated)).toEqual(jpeg)
    const [prepared] = prepareIssuePhotos([{ data: annotated.toString('base64') }])
    expect(prepared.metadata).toMatchObject({ contentType: 'image/jpeg', bytes: jpeg.length })
    expect(prepared.metadata.id).toMatch(/^[a-f0-9]{64}$/)
    expect(prepared.bytes).toEqual(jpeg)
  })

  it('rejects spoofed metadata, malformed base64, non-images, duplicates and too many photos', () => {
    for (const photos of [{}, [null], [{ id: 'x', contentType: 'image/jpeg' }], [{ data: '<svg onload=alert(1)>' }], [{ data: 'SGVsbG8=' }], [{ data: 'a====' }]]) {
      expect(() => prepareIssuePhotos(photos)).toThrow()
    }
    const photo = { data: jpeg.toString('base64') }
    expect(() => prepareIssuePhotos([photo, photo])).toThrow('more than once')
    expect(() => prepareIssuePhotos([photo, photo, photo, photo])).toThrow('three photos')
    expect(prepareIssuePhotos(undefined)).toEqual([])
  })

  it('rejects oversized, truncated, trailing-payload and oversized-dimension images', () => {
    expect(() => sanitizeIssueJpeg(Buffer.alloc(ISSUE_PHOTO_BYTES + 1))).toThrow('500 KB')
    expect(() => sanitizeIssueJpeg(jpeg.subarray(0, jpeg.length - 2))).toThrow('incomplete')
    expect(() => sanitizeIssueJpeg(Buffer.concat([jpeg, Buffer.from('<script>')]))).toThrow('unexpected data')
    const oversized = Buffer.from(jpeg)
    const frame = Math.max(oversized.indexOf(Buffer.from([0xff, 0xc0])), oversized.indexOf(Buffer.from([0xff, 0xc2])))
    expect(frame).toBeGreaterThan(0)
    oversized.writeUInt16BE(65000, frame + 7)
    expect(() => sanitizeIssueJpeg(oversized)).toThrow('1600 pixels')
  })

  it('rejects invalid scan component counts, lengths and frame references', () => {
    const malformed = Buffer.from('ffd8ffc00011080001000103011100021100031100ffda000601010000ffd9', 'hex')
    expect(() => sanitizeIssueJpeg(malformed)).toThrow('invalid scan')
    const scan = jpeg.indexOf(Buffer.from([0xff, 0xda]))
    for (const [position, value] of [[scan + 4, 0], [scan + 5, 250], [scan + 3, 6]]) {
      const invalid = Buffer.from(jpeg)
      invalid[position] = value
      expect(() => sanitizeIssueJpeg(invalid)).toThrow('invalid scan')
    }
  })

  it('encrypts only content-addressed bytes and rejects corruption or object substitution', async () => {
    const objects = new Map<string, Uint8Array>()
    const env = { RELEASE_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 19).toString('base64'), RELEASE_SNAPSHOTS: {
      put: async (key: string, data: Uint8Array) => { objects.set(key, data) },
      get: async (key: string) => { const data = objects.get(key); return data ? { arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) } : null },
    } }
    const photos = prepareIssuePhotos([{ data: jpeg.toString('base64') }])
    await storeIssuePhotos(env, 'TESTDATAHWELL0001', photos)
    const [key, encrypted] = [...objects.entries()][0]
    expect(Buffer.from(encrypted).includes(jpeg)).toBe(false)
    expect(Buffer.from(await readIssuePhoto(env, 'TESTDATAHWELL0001', photos[0].metadata))).toEqual(jpeg)
    objects.set(key.replace('TESTDATAHWELL0001', 'TESTDATAHWELL0002'), encrypted)
    await expect(readIssuePhoto(env, 'TESTDATAHWELL0002', photos[0].metadata)).rejects.toThrow('could not be loaded')
    encrypted[encrypted.length - 1] ^= 1
    await expect(readIssuePhoto(env, 'TESTDATAHWELL0001', photos[0].metadata)).rejects.toThrow('could not be loaded')
    objects.clear()
    await expect(readIssuePhoto(env, 'TESTDATAHWELL0001', photos[0].metadata)).rejects.toThrow('temporarily unavailable')
  })
})
