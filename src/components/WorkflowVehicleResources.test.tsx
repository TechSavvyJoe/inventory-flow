import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { WorkflowVehicleResources } from './WorkflowVehicleResources'
import type { VehicleRecord } from '../types'

afterEach(cleanup)
function CurrentRoute() { const route = useLocation(); return <output>{route.pathname}{route.search}</output> }

describe('vehicle resources across workflow pages', () => {
  it('opens captured history at the exact vehicle Records pane', () => {
    const vehicle = {vin:'TESTDATAHWELL0001',make:'Ford',autoCheckReport:{dataState:'current',score:91}} as VehicleRecord
    render(<MemoryRouter initialEntries={['/attention']}><WorkflowVehicleResources vehicle={vehicle}/><CurrentRoute/></MemoryRouter>)
    fireEvent.click(screen.getByRole('button',{name:/View AutoCheck data for VIN TESTDATAHWELL0001/}))
    expect(screen.getByRole('status')).toHaveTextContent('/inventory?scope=group&vin=TESTDATAHWELL0001&tab=data&returnTo=%2Fattention')
  })
  it('keeps synthetic sample documents separate from provider records', () => {
    const vehicle = {vin:'TESTDATALNCN00001',make:'Lincoln',imageUrl:'/demo-vehicles/nautilus.jpg'} as VehicleRecord
    render(<MemoryRouter><WorkflowVehicleResources vehicle={vehicle}/></MemoryRouter>)
    const link = screen.getByRole('link',{name:/Open demo sticker for VIN TESTDATALNCN00001/})
    expect(link).toHaveAttribute('href','/demo-documents/window-sticker.html?vehicle=TESTDATALNCN00001')
    expect(link).toHaveAttribute('rel','noopener noreferrer')
    expect(screen.queryByText('CARFAX')).not.toBeInTheDocument()
  })
})
