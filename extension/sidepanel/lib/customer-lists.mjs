// Private list references live in the authenticated service. This controller
// keeps only the current page's view and discards late responses after access
// changes. Nothing here writes a source system or browser storage.
export function customerListLabelError(value) {
  const label = String(value ?? '').trim().normalize('NFC')
  if (!label) return 'Enter initials or a nickname.'
  if ([...label].length > 80 || /[\u0000-\u001f\u007f]/u.test(label)) return 'Use 80 characters or fewer.'
  if (/@|https?:\/\/|www\./i.test(label) || (label.match(/\d/g)?.length ?? 0) >= 7) {
    return 'Use initials or a nickname, without contact information.'
  }
  return null
}

export function customerListWritesReady(snapshot) {
  return snapshot?.readyForWrites === true && snapshot.saving !== true && !snapshot.pending
}

export function createCustomerListSession({ read, write, onChange = () => {} }) {
  let generation = 0
  let readPromise = null
  let saveAfterCreate = null
  let value = empty()
  function empty() { return { lists: [], activeId: null, loading: false, saving: false, error: null, pending: null, checkedAt: null, readyForWrites: false } }
  function publish(patch) { value = { ...value, ...patch }; onChange(value) }
  function denied(error) { return ['signin', 'forbidden'].includes(error?.kind) || [401, 403].includes(error?.status) }
  function failure(error) {
    if (denied(error)) { reset(); publish({ error: 'Sign in again to open your customer lists.' }); return }
    publish({ error: error?.status === 409 ? 'This list changed on another device. Review the refreshed list and try the action again.' : 'Customer lists could not be updated. Your last confirmed list is still shown.' })
  }
  function reset() { generation += 1; readPromise = null; saveAfterCreate = null; value = empty(); onChange(value) }
  function select(id) {
    if (value.saving || value.pending) return
    publish({ activeId: value.lists.some(list => list.id === id) ? id : null })
  }
  function active() { return value.lists.find(list => list.id === value.activeId) ?? null }
  async function refresh() {
    if (readPromise || value.saving) return readPromise
    const version = generation
    publish({ loading: true })
    const promise = (async () => {
      try {
        const result = await read()
        if (version !== generation) return
        const lists = result.lists
        const activeId = lists.some(list => list.id === value.activeId) ? value.activeId : lists[0]?.id ?? null
        publish({ lists, activeId, error: value.pending ? value.error : null, checkedAt: Date.now(), readyForWrites: true })
      } catch (error) { if (version === generation) failure(error) }
      finally { if (version === generation) { readPromise = null; publish({ loading: false }) } }
    })()
    readPromise = promise
    return promise
  }
  function requireConfirmedRead() {
    if (value.readyForWrites) return true
    publish({ error: 'Check your customer lists before saving. Retry the list check.' })
    return false
  }
  async function send(input, key = crypto.randomUUID()) {
    if (!requireConfirmedRead() || value.saving) return false
    // Invalidates any older GET so it cannot replace a confirmed mutation.
    generation += 1; readPromise = null
    const version = generation
    publish({ saving: true, loading: false, error: null, pending: { input, key } })
    try {
      const result = await write(input, key)
      if (version !== generation) return false
      const lists = result.deleted ? value.lists.filter(list => list.id !== result.id)
        : [...value.lists.filter(list => list.id !== result.id), result].sort((a, b) => a.createdAt.localeCompare(b.createdAt, 'en-US'))
      const activeId = result.deleted ? (value.activeId === result.id ? lists[0]?.id ?? null : value.activeId) : result.id
      publish({ lists, activeId, pending: null, error: null, checkedAt: Date.now() })
      return true
    } catch (error) {
      if (version !== generation) return false
      if (error?.status === 409 || error?.status === 404 || (error?.status >= 400 && error?.status < 500)) publish({ pending: null })
      failure(error)
      return false
    } finally { if (version === generation) publish({ saving: false }) }
  }
  async function mutate(action, fields = {}) {
    if (!requireConfirmedRead()) return false
    if (value.pending) { publish({ error: 'Retry the unfinished action before changing this list.' }); return false }
    const list = active()
    if (action !== 'create' && !list) return false
    if (action === 'create' || action === 'rename') {
      const label = String(fields.label ?? '').trim().normalize('NFC')
      const error = customerListLabelError(label)
      if (error) { publish({ error }); return false }
      fields = { ...fields, label }
    }
    const ok = await send(action === 'create' ? { action, ...fields } : { action, listId: list.id, expectedRevision: list.revision, ...fields })
    if (!ok && !value.pending && !value.saving) await refresh()
    return ok
  }
  async function continueFirstSave(continuation) {
    if (!continuation || continuation !== saveAfterCreate || !active()) return false
    saveAfterCreate = null
    return mutate('add', { vin: continuation.vin })
  }
  return {
    get snapshot() { return value }, active, reset, select, refresh, mutate,
    async retry() {
      const pending = value.pending, continuation = saveAfterCreate
      if (!pending) return refresh()
      const ok = await send(pending.input, pending.key)
      if (ok && pending.input.action === 'create' && continuation) return continueFirstSave(continuation)
      if (!ok && !value.pending) saveAfterCreate = null
      return ok
    },
    async toggle(vin) {
      if (!requireConfirmedRead() || value.saving || value.pending) return false
      if (!active()) {
        const continuation = { vin }
        saveAfterCreate = continuation
        if (!await mutate('create', { label: 'Customer shortlist' })) {
          if (!value.pending) saveAfterCreate = null
          return false
        }
        return continueFirstSave(continuation)
      }
      return mutate(active().items.some(item => item.vin === vin) ? 'remove' : 'add', { vin })
    },
  }
}
