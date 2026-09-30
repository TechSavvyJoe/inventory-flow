export function bindPhotoSwipe(frame, changePhoto) {
  let start = null, suppressUntil = 0
  frame.addEventListener('pointerdown', event => {
    if (event.isPrimary === false || event.button > 0 || event.target.closest('.hero-nav, .photo-viewer-controls')) return
    start = { x: event.clientX, y: event.clientY, id: event.pointerId }
  }, { passive: true })
  frame.addEventListener('pointercancel', () => { start = null }, { passive: true })
  frame.addEventListener('pointerup', event => {
    if (!start || event.pointerId !== start.id) return
    const dx = event.clientX - start.x, dy = event.clientY - start.y
    start = null
    if (Math.abs(dx) < 36 || Math.abs(dx) < Math.abs(dy) * 1.5) return
    suppressUntil = Date.now() + 500
    changePhoto(dx < 0 ? 1 : -1)
  }, { passive: true })
  return () => Date.now() < suppressUntil
}
