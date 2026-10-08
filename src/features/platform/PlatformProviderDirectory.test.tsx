import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PlatformProviderDirectory } from './PlatformProviderDirectory'
import { SOURCE_CATALOG } from './sourceCatalog'

afterEach(cleanup)

function start(busy = false) {
  const onChoose = vi.fn()
  render(<PlatformProviderDirectory busy={busy} onChoose={onChoose} />)
  return onChoose
}

describe('Provider directory', () => {
  it('searches provider evidence and access notes independently', () => {
    start()
    const search = screen.getByRole('textbox', { name: 'Find providers' })
    fireEvent.change(search, { target: { value: 'inbound DMS imports' } })

    expect(screen.getByRole('article', { name: /DealerCenter DMS/ })).toBeInTheDocument()
    expect(screen.queryByRole('article', { name: /DealerPeak CRM/ })).not.toBeInTheDocument()

    fireEvent.change(search, { target: { value: 'API key' } })
    expect(screen.getByRole('article', { name: /DealerPeak CRM/ })).toBeInTheDocument()
    expect(screen.queryByRole('article', { name: /DealerCenter DMS/ })).not.toBeInTheDocument()
  })

  it('filters by the existing provider category labels', () => {
    start()
    fireEvent.change(screen.getByRole('combobox', { name: 'Provider category' }), { target: { value: 'dms' } })

    expect(screen.getByRole('article', { name: /PBS PartnerHub/ })).toBeInTheDocument()
    expect(screen.queryByRole('article', { name: /DealerPeak CRM/ })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(`${SOURCE_CATALOG.filter(profile => profile.category === 'dms').length} of ${SOURCE_CATALOG.length} providers`)
  })

  it('passes the selected profile to the caller without implying it is connected', () => {
    const onChoose = start()
    const profile = SOURCE_CATALOG.find(item => item.id === 'dealerpeak-crm')!
    fireEvent.click(screen.getByRole('button', { name: 'Configure DealerPeak CRM' }))

    expect(onChoose).toHaveBeenCalledTimes(1)
    expect(onChoose).toHaveBeenCalledWith(profile)
    expect(screen.getByText(/These are planning references, not live integrations/)).toBeInTheDocument()
    expect(screen.getByText(/Saving a source configuration does not install an adapter/)).toBeInTheDocument()
  })

  it('links to the official provider source and disables configuration while busy', () => {
    start(true)
    const row = screen.getByRole('article', { name: /CDK Elead CRM/ })
    const link = within(row).getByRole('link', { name: /Official source.*CDK Elead CRM/ })

    expect(link).toHaveAttribute('href', SOURCE_CATALOG.find(item => item.id === 'elead-crm')?.url)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer')
    expect(within(row).getByRole('button', { name: 'Configure CDK Elead CRM' })).toBeDisabled()
  })
})
