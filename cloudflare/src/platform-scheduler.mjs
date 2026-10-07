// Opt-in queue planning only. No vendor fetch, credentials, collector or publish.
// Invoked by the trusted Worker scheduled handler, never an HTTP input/route.
export const schedulerEnabled = env => env.PLATFORM_SCHEDULER_ENABLED === 'true'
const localClock = (timezone,now) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(part=>[part.type,part.value]))
  return {date:`${parts.year}-${parts.month}-${parts.day}`,minutes:Number(parts.hour)*60+Number(parts.minute)}
}
const timeText = minutes => `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`
const nextDate = date => new Date(Date.parse(`${date}T12:00:00Z`)+86_400_000).toISOString().slice(0,10)

// Wall-clock slot identity deliberately excludes UTC offset. A repeated DST
// hour has one slot; a skipped start time is caught up on the first later tick.
export function scheduledSlot(source,now) {
  if(!['daily','hourly'].includes(source.cadence))return null
  const localTime=source.local_time??source.localTime
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(localTime))throw new Error('INVALID_SCHEDULE_TIME')
  const clock=localClock(source.timezone,now),[hour,minute]=localTime.split(':').map(Number),start=hour*60+minute
  const due=clock.minutes>=start
  const slotTime=source.cadence==='daily'||!due?localTime:timeText(start+Math.floor((clock.minutes-start)/60)*60)
  return {due,date:clock.date,start,minutes:clock.minutes,time:slotTime,key:`${source.cadence}:${source.timezone}:${clock.date}T${slotTime}`}
}
export function schedulePreview(source,now,lastSlot='') {
  const slot=scheduledSlot(source,now)
  if(!slot)return null
  const done=slot.due&&lastSlot===slot.key
  let date=slot.date,minutes=slot.due?Number(slot.time.slice(0,2))*60+Number(slot.time.slice(3)):slot.start
  if(done) {
    if(source.cadence==='daily')date=nextDate(date)
    else {minutes=Number(slot.time.slice(0,2))*60+Number(slot.time.slice(3))+60;if(minutes>=1440){date=nextDate(date);minutes=slot.start}}
  }
  return {nextLocal:`${date} ${timeText(minutes)}`,due:slot.due&&!done}
}
const sha = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('')
const checkedStatement = (db,id,now,outcome) => db.prepare(`INSERT INTO platform_schedule_checks VALUES(?,?,'',?) ON CONFLICT(connection_id) DO UPDATE SET checked_at=excluded.checked_at,outcome=excluded.outcome WHERE excluded.checked_at>=platform_schedule_checks.checked_at`).bind(id,now,outcome)

export async function planScheduledPulls(env,now=new Date()) {
  if(!schedulerEnabled(env))return {enabled:false,checked:0,queued:0,waiting:0,failed:0}
  const limit=Number(env.PLATFORM_SCHEDULER_BATCH_SIZE??8)
  if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isFinite(now.getTime()))throw new Error('INVALID_SCHEDULER_CONFIGURATION')
  const db=env.PLATFORM_DB,timestamp=now.toISOString()
  // Least recently checked first. One source's backlog or malformed settings
  // never monopolize a batch or create an unbounded queue.
  const rows=await db.prepare(`SELECT c.* FROM platform_data_connections c JOIN platform_groups g ON g.id=c.group_id JOIN platform_dealerships d ON d.id=c.dealership_id AND d.group_id=c.group_id LEFT JOIN platform_schedule_checks s ON s.connection_id=c.id WHERE g.status='active' AND c.enabled=1 AND c.cadence IN ('daily','hourly') ORDER BY COALESCE(s.checked_at,''),c.id LIMIT ?`).bind(limit).all()
  if(rows.success===false)throw new Error('SCHEDULER_UNAVAILABLE')
  const report={enabled:true,checked:0,queued:0,waiting:0,failed:0}
  for(const source of rows.results) {
    report.checked++
    try {
      let slot
      try{slot=scheduledSlot(source,now)}catch{await db.batch([checkedStatement(db,source.id,timestamp,'invalid')]);report.failed++;continue}
      if(!slot?.due){await db.batch([checkedStatement(db,source.id,timestamp,'not_due')]);continue}
      const id=`scheduled-${await sha(`${source.id}:${slot.key}`)}`,auditId=`audit-${id}`
      const next={id,groupId:source.group_id,connectionId:source.id,name:source.name,state:'queued',kind:'scheduled',scheduleSlot:slot.key}
      const results=await db.batch([
        // Recheck every routing/enablement field atomically against owner edits.
        db.prepare(`INSERT INTO platform_pull_requests SELECT ?,c.group_id,c.id,'queued','scheduled',NULL,'Daily pull scheduler',?,?,? FROM platform_data_connections c JOIN platform_groups g ON g.id=c.group_id JOIN platform_dealerships d ON d.id=c.dealership_id AND d.group_id=c.group_id WHERE c.id=? AND c.group_id=? AND c.dealership_id=? AND c.updated_at=? AND c.cadence=? AND c.local_time=? AND c.timezone=? AND c.name=? AND c.provider=? AND c.vendor=? AND c.oem=? AND c.method=? AND c.endpoint=? AND c.credential_ref=? AND c.enabled=1 AND g.status='active' ON CONFLICT DO NOTHING`).bind(id,slot.key,timestamp,timestamp,source.id,source.group_id,source.dealership_id,source.updated_at,source.cadence,source.local_time,source.timezone,source.name,source.provider,source.vendor,source.oem,source.method,source.endpoint,source.credential_ref),
        db.prepare(`INSERT INTO platform_audit SELECT ?,'system:scheduler','Daily pull scheduler','pulls',?,'scheduled','Configured local schedule',NULL,?,?,?,? WHERE changes()>0`).bind(auditId,id,JSON.stringify(next),id,id,timestamp),
        db.prepare('UPDATE platform_revision SET revision=revision+1 WHERE id=1 AND changes()>0'),
        db.prepare(`INSERT INTO platform_schedule_checks SELECT ?,?,CASE WHEN EXISTS(SELECT 1 FROM platform_pull_requests WHERE id=?) THEN ? ELSE '' END,CASE WHEN changes()>0 THEN 'queued' WHEN EXISTS(SELECT 1 FROM platform_pull_requests WHERE id=?) THEN 'already_planned' WHEN EXISTS(SELECT 1 FROM platform_pull_requests WHERE connection_id=? AND state='queued') THEN 'waiting' ELSE 'disabled' END ON CONFLICT(connection_id) DO UPDATE SET checked_at=excluded.checked_at,last_slot=CASE WHEN excluded.last_slot<>'' THEN excluded.last_slot ELSE platform_schedule_checks.last_slot END,outcome=excluded.outcome WHERE excluded.checked_at>=platform_schedule_checks.checked_at`).bind(source.id,timestamp,id,slot.key,id,source.id),
        db.prepare('SELECT outcome FROM platform_schedule_checks WHERE connection_id=?').bind(source.id),
      ])
      if(results.some(result=>result.success===false))throw new Error('SCHEDULER_WRITE_FAILED')
      if(results[0].meta?.changes>0)report.queued++
      else if(results[4].results[0]?.outcome==='waiting')report.waiting++
    } catch {
      report.failed++
      // Persist only a code; never include provider responses or credentials.
      await db.batch([checkedStatement(db,source.id,timestamp,'failed')])
    }
  }
  await db.batch([db.prepare(`INSERT INTO platform_scheduler_state VALUES(1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET checked_at=excluded.checked_at,checked=excluded.checked,queued=excluded.queued,waiting=excluded.waiting,failed=excluded.failed WHERE excluded.checked_at>=platform_scheduler_state.checked_at`).bind(timestamp,report.checked,report.queued,report.waiting,report.failed)])
  return report
}
