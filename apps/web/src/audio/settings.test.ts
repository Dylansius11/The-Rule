import { describe, expect, it } from 'vitest';
import { canPlay, clampVolume, DEFAULT_SETTINGS, duckLevel, parseSettings } from './settings';

describe('sound settings', () => {
  it('uses defaults for missing or corrupt storage', () => {
    for (const raw of [null, '{', 'null', '[]']) expect(parseSettings(raw)).toEqual(DEFAULT_SETTINGS);
  });

  it('migrates old settings without changing sound preferences', () => {
    expect(parseSettings('{"enabled":false,"volume":2}')).toEqual({
      enabled: false,
      volume: 1,
      music: { enabled: true, volume: 0.3 },
    });
    expect(parseSettings('{"enabled":"no","volume":-1}')).toEqual({
      enabled: true,
      volume: 0,
      music: { enabled: true, volume: 0.3 },
    });
    expect(parseSettings('{"enabled":false,"volume":"loud"}')).toEqual({
      enabled: false,
      volume: 0.6,
      music: { enabled: true, volume: 0.3 },
    });
    expect(clampVolume(Number.NaN)).toBe(0.6);
    expect(clampVolume(Infinity)).toBe(0.6);
  });

  it('validates music fields independently', () => {
    expect(parseSettings('{"music":{"enabled":false,"volume":2}}').music).toEqual({
      enabled: false,
      volume: 1,
    });
    expect(parseSettings('{"music":{"enabled":"no","volume":-1}}').music).toEqual({
      enabled: true,
      volume: 0,
    });
    expect(parseSettings('{"music":null}').music).toEqual(DEFAULT_SETTINGS.music);
  });
});

describe('ducking', () => {
  it('dips to 45 percent of the bounded music volume', () => {
    expect(duckLevel(1)).toBe(0.45);
    expect(duckLevel(0)).toBe(0);
    expect(duckLevel(2)).toBe(0.45);
    expect(duckLevel(NaN)).toBeCloseTo(0.135);
  });
});

describe('sound throttle', () => {
  it('allows the first sound and enforces the minimum interval', () => {
    expect(canPlay(undefined, 0)).toBe(true);
    expect(canPlay(100, 149)).toBe(false);
    expect(canPlay(100, 150)).toBe(true);
    expect(canPlay(100, 200, 101)).toBe(false);
  });
});
