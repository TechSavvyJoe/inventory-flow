export function compareVersions(left, right) {
  const parse = (value) => {
    const match = String(value ?? '').trim().match(/^(\d+)\.(\d+)\.(\d+)$/)
    return match ? match.slice(1).map(Number) : null
  }
  const a = parse(left)
  const b = parse(right)
  if (!a || !b) return null
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1
  }
  return 0
}
