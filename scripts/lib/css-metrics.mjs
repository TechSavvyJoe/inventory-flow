/**
 * Count selector-list entries that contain an ID selector.
 *
 * This remains deliberately smaller than a CSS parser: the design-system
 * ratchet needs a stable debt count, not a transformed syntax tree. Blockless
 * at-rules such as `@import` end at a semicolon, so only the prelude after the
 * final top-level delimiter belongs to the rule whose `{` we are inspecting.
 */
export function countIdSelectors(content) {
  const withoutComments = content.replace(/\/\*[\s\S]*?\*\//g, '')
  let count = 0

  for (const chunk of withoutComments.split('{').slice(0, -1)) {
    const selectorList = (chunk.split(/[};]/).pop() ?? '').trim()
    if (!selectorList || selectorList.startsWith('@')) continue

    for (const selector of selectorList.split(',')) {
      // Attribute values and functional arguments may legitimately contain a
      // quoted fragment such as href="#details"; it is not an ID selector.
      const withoutStrings = selector.replace(/(['"])(?:\\.|(?!\1)[^\\])*\1/g, '')
      if (/(?:^|[^\\])#[A-Za-z_-][\w-]*/.test(withoutStrings)) count += 1
    }
  }

  return count
}
