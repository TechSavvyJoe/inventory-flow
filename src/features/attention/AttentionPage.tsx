import { Link } from 'react-router-dom'
import { ArrowRight, Wrench } from 'lucide-react'
import { useAppData } from '../../app/AppDataContext'
import { actionableItems } from './action-center'
import { OperationsQueue } from './OperationsQueue'
import { serviceWorkflowStatus } from '../../lib/service-readiness'

export function AttentionPage() {
  const { data, homeStore, role, currentUser, addAttentionEvent } = useAppData()
  if (!data) return null
  const localVehicles = data.vehicles.filter(vehicle => (vehicle.serviceReadiness?.store ?? vehicle.homeStore) === homeStore)
  const waiting = localVehicles.filter(vehicle => serviceWorkflowStatus(vehicle.serviceReadiness) === 'needs_service').length
  const inService = localVehicles.filter(vehicle => serviceWorkflowStatus(vehicle.serviceReadiness) === 'in_service').length
  return <section className="workflow-page">
    <OperationsQueue key={`${currentUser}:${role}:${homeStore}`} items={actionableItems(data)} vehicles={data.vehicles} homeStore={homeStore} role={role} currentUser={currentUser} reportDate={data.meta.reportDate} onAction={addAttentionEvent}/>
    <Link className="workflow-service-link" to="/service"><Wrench aria-hidden="true"/><span><strong>Service status</strong><span>{waiting} waiting for service · {inService} in service. Start work or mark a vehicle Ready.</span></span><ArrowRight aria-hidden="true"/></Link>
    {data.meta.publicFreshness !== 'current' || data.meta.dealerMailFreshness !== 'current' ? <p className="workflow-notice" role="status">Some inventory details need review. Confirm holds and availability with the home store before promising a vehicle.</p> : null}
  </section>
}
