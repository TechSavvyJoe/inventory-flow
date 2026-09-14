// @ts-nocheck -- capture script is plain ESM.
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { isVautoVin, main } from '../../scripts/vauto-factory-equipment.mjs'

describe('vAuto factory-equipment safety boundary', () => {
  it('accepts only canonical VINs', () => {
    expect(isVautoVin('1FMCU9G66PUA12345')).toBe(true)
    expect(isVautoVin('1FMCU9G66PUA1234I')).toBe(false)
    expect(isVautoVin('1fmcu9g66pua12345')).toBe(false)
  })

  it('refuses the removed appraisal-form UI option before browser access', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(main(['probe', '1FMCU9G66PUA12345', '--ui'])).resolves.toBe(2)
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/UI capture path was removed/i))
    error.mockRestore()
  })
})
