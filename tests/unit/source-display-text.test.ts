// @vitest-environment node
// @ts-nocheck -- App/extension helper parity includes dependency-free extension ESM.
import { describe, expect, it } from 'vitest';
import { sourceDisplayText as appText } from '../../src/lib/source-text';
import { sourceDisplayText as companionText } from '../../extension/sidepanel/lib/source-text.mjs';

describe.each([['site', appText], ['companion', companionText]])('%s source text presentation', (_, displayText) => {
  it.each([
    ['REAR AXLE &#x25B4; &amp; HUB', 'REAR AXLE ▴ & HUB'],
    ['Recall &#9652; &#X25b4; &#128663;', 'Recall ▴ ▴ 🚗'],
    ['&quot;Ford&quot; &apos;record&apos; &ndash; &mdash; &bull; &reg; &trade; &copy;', '"Ford" \'record\' – — • ® ™ ©'],
    ['36&nbsp;months', '36\u00a0months'],
    ['Unchanged &unknown; &amp missing semicolon', 'Unchanged &unknown; &amp missing semicolon'],
    ['&#0; &#31; &#127; &#159; &#xD800; &#x110000;', '&#0; &#31; &#127; &#159; &#xD800; &#x110000;'],
    ['&amp;#x25B4;', '&#x25B4;'],
    ['&lt;img src=x onerror=alert(1)&gt;', '<img src=x onerror=alert(1)>'],
    [null, ''],
    [undefined, ''],
  ])('decodes one layer of supported entities in %s without parsing HTML', (input, expected) => {
    expect(displayText(input)).toBe(expected);
  });
});
