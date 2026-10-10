import { useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRight, Wrench } from 'lucide-react'
import { useAppData } from '../../app/AppDataContext'
import { actionCenterItems } from './action-center'
import { OperationsQueue } from './OperationsQueue'
import { serviceWorkflowStatus } from '../../lib/service-readiness'
import { IssueDialog } from '../issues/IssueDialog'
import { IssueDetail } from '../issues/IssueDetail'
import type { VehicleIssueAction } from '../../types'
import './AttentionPage.css'

const ISSUE_ACTIONS: readonly VehicleIssueAction[] = ['assign', 'start_work', 'request_completion', 'complete', 'reopen', 'add_note']

export function AttentionPage() {
  const { data, homeStore, role, currentUser, addAttentionEvent, refresh } = useAppData()
  const [params, setParams] = useSearchParams()
  const issueId = params.get('issue')
  const requestedIssueAction = params.get('action')
  const initialIssueAction = ISSUE_ACTIONS.find(action => action === requestedIssueAction) ?? 'add_note'
  const issueOpener = useRef<HTMLElement | null>(null)
  if (!data) return null
  const localVehicles = data.vehicles.filter(vehicle => (vehicle.serviceReadiness?.store ?? vehicle.homeStore) === homeStore)
  const waiting = localVehicles.filter(vehicle => serviceWorkflowStatus(vehicle.serviceReadiness) === 'needs_service').length
  const inService = localVehicles.filter(vehicle => serviceWorkflowStatus(vehicle.serviceReadiness) === 'in_service').length
  // Source health is framed by this page's own notice below, as the thing to do
  // before promising a vehicle. The queue never lists it a second time.
  const items = actionCenterItems(data, { store: homeStore, role }).filter(item => item.type !== 'source_freshness')
  return <section className="workflow-page attention-page" onClickCapture={event => { const trigger = (event.target as HTMLElement).closest<HTMLElement>('[data-issue-opener]'); if (trigger) issueOpener.current = trigger }}>
    <OperationsQueue key={`${currentUser}:${role}:${homeStore}`} items={items} vehicles={data.vehicles} homeStore={homeStore} role={role} currentUser={currentUser} reportDate={data.meta.reportDate} onAction={addAttentionEvent} issueData={data} onIssueChanged={refresh}/>
    {issueId ? <IssueDialog key={`${currentUser}:${role}:${homeStore}:${issueId}`} title="Vehicle issue" returnFocusRef={issueOpener} onClose={() => { const next = new URLSearchParams(params); next.delete('issue'); next.delete('action'); setParams(next, { replace: true }) }}><IssueDetail issueId={issueId} role={role} store={homeStore} initialAction={initialIssueAction} readOnly={data.vehicleIssuesEnabled !== true} onSaved={() => { void refresh() }} /></IssueDialog> : null}
    <Link className="workflow-service-link" to="/service"><Wrench aria-hidden="true"/><span><strong>Service status</strong><span>{waiting} waiting for service · {inService} in service. Start work or mark a vehicle Ready.</span></span><ArrowRight aria-hidden="true"/></Link>
    {data.meta.publicFreshness !== 'current' || data.meta.dealerMailFreshness !== 'current' ? <p className="workflow-notice" role="status">Some inventory details need review. Confirm holds and availability with the home store before promising a vehicle.</p> : null}
  </section>
}
