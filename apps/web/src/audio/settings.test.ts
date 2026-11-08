import { describe, expect, it } from 'vitest';
import { canPlay, clampVolume, DEFAULT_SETTINGS, parseSettings } from './settings';

describe('sound settings', () => {
  it('uses defaults for missing or corrupt storage', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('null')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('[]')).toEqual(DEFAULT_SETTINGS);
  });

  it('validates fields independently and clamps volume', () => {
    expect(parseSettings('{"enabled":false,"volume":2}')).toEqual({ enabled: false, volume: 1 });
    expect(parseSettings('{"enabled":"no","volume":-1}')).toEqual({ enabled: true, volume: 0 });
    expect(parseSettings('{"enabled":false,"volume":"loud"}')).toEqual({ enabled: false, volume: 0.6 });
    expect(clampVolume(Number.NaN)).toBe(0.6);
    expect(clampVolume(Infinity)).toBe(0.6);
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
