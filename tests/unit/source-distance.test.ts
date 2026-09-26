// @vitest-environment node
// @ts-nocheck -- App/extension helper parity includes dependency-free extension ESM.
import { describe, expect, it } from 'vitest';
import { sourceDistanceText as appDistance, statesKilometres as appStates } from '../../src/lib/source-distance';
import { sourceDistanceText as companionDistance, statesKilometres as companionStates } from '../../extension/sidepanel/lib/source-distance.mjs';

it('uses the same source-distance implementation in the app and companion', () => {
  expect(appDistance).toBe(companionDistance);
  expect(appStates).toBe(companionStates);
});

describe.each([['site', appDistance], ['companion', companionDistance]])('%s source distance presentation', (_, distanceText) => {
  it.each([
    ['12,000 km', '7,456 mi (12,000 km in the source)'],
    ['12000 kilometres', '7,456 mi (12,000 km in the source)'],
    ['12000 kilometers', '7,456 mi (12,000 km in the source)'],
    ['60 months/100,000 km', '60 months/62,137 mi (100,000 km in the source)'],
    ['3 years / 60,000 km (whichever occurs first)', '3 years / 37,282 mi (whichever occurs first) (60,000 km in the source)'],
    ['5 years / unlimited kilometres', '5 years / unlimited miles (unlimited km in the source)'],
    ['Last reported odometer: 148 000 km', 'Last reported odometer: 91,963 mi (148,000 km in the source)'],
    ['Combined 9.8 L/100 km', 'Combined 24 mpg (9.8 L/100 km in the source)'],
    ['Speed limiter 180 km/h', 'Speed limiter 112 mph (180 km/h in the source)'],
    ['3 years / 36,000 miles', '3 years / 36,000 miles'],
    ['Last reported 12,450 mi', 'Last reported 12,450 mi'],
    ['No Accidents or Damage Reported', 'No Accidents or Damage Reported'],
    ['', ''],
    [null, ''],
    [undefined, ''],
  ])('renders %s in US miles without changing text that states none', (input, expected) => {
    expect(distanceText(input)).toBe(expected);
  });

  it('names every distinct source figure once', () => {
    expect(distanceText('Basic 60,000 km · Powertrain 100,000 km · Corrosion 100,000 km')).toBe(
      'Basic 37,282 mi · Powertrain 62,137 mi · Corrosion 62,137 mi (60,000 km, 100,000 km in the source)',
    );
  });

  it('is safe to apply twice: the source evidence is never re-converted', () => {
    const once = distanceText('60 months/100,000 km');
    expect(once).toBe('60 months/62,137 mi (100,000 km in the source)');
    expect(distanceText(once)).toBe(once);
  });

  it('leaves an unrelated "km" word alone', () => {
    expect(distanceText('Trim package KM Edition')).toBe('Trim package KM Edition');
  });
});

describe.each([['site', appStates], ['companion', companionStates]])('%s kilometre detection', (_, states) => {
  it.each([
    ['60 months/100,000 km', true],
    ['9.8 L/100 km', true],
    ['unlimited kilometres', true],
    ['3 years / 36,000 miles', false],
    ['KM Edition', false],
    [null, false],
  ])('reports %s', (input, expected) => {
    expect(states(input)).toBe(expected);
  });
});
