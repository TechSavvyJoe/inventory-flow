// One media-query object per test file, just like a browser subscription. A
// reduced-motion hook subscribes to its query once; swapping unrelated vi.fn()
// objects after mounting cannot update that already-subscribed preference.
export function createMotionPreference() {
  const original = window.matchMedia
  let reduced = false
  const listeners = new Set<EventListenerOrEventListenerObject>()
  const media = '(prefers-reduced-motion: reduce)'
  const query: MediaQueryList = {
    get matches() { return reduced },
    media,
    onchange: null,
    addEventListener: (_type: string, listener: unknown) => { if (listener) listeners.add(listener as EventListenerOrEventListenerObject) },
    removeEventListener: (_type: string, listener: unknown) => { if (listener) listeners.delete(listener as EventListenerOrEventListenerObject) },
    addListener: listener => { if (listener) listeners.add(listener as EventListener) },
    removeListener: listener => { if (listener) listeners.delete(listener as EventListener) },
    dispatchEvent: event => {
      listeners.forEach(listener => typeof listener === 'function' ? listener(event) : listener.handleEvent(event))
      return true
    },
  }
  return {
    install() {
      window.matchMedia = requested => requested.includes('prefers-reduced-motion')
        ? query
        : original?.(requested) ?? { ...query, matches: false, media: requested }
    },
    set(value: boolean) {
      reduced = value
      query.dispatchEvent(Object.assign(new Event('change'), { matches: value, media }))
    },
    restore() { window.matchMedia = original },
  }
}
