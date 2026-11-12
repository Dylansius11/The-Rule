export type SoundSettings = { enabled: boolean; volume: number; music: { enabled: boolean; volume: number } };

export const DEFAULT_SETTINGS: SoundSettings = {
  enabled: true,
  volume: 0.6,
  music: { enabled: true, volume: 0.3 },
};

export function clampVolume(value: number, fallback = DEFAULT_SETTINGS.volume): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
}

export function parseSettings(raw: string | null): SoundSettings {
  try {
    const value: unknown = raw === null ? null : JSON.parse(raw);
    if (!value || typeof value !== 'object')
      return { ...DEFAULT_SETTINGS, music: { ...DEFAULT_SETTINGS.music } };
    const settings = value as Record<string, unknown>;
    const music =
      settings.music && typeof settings.music === 'object' ? (settings.music as Record<string, unknown>) : {};
    return {
      enabled: typeof settings.enabled === 'boolean' ? settings.enabled : DEFAULT_SETTINGS.enabled,
      volume: typeof settings.volume === 'number' ? clampVolume(settings.volume) : DEFAULT_SETTINGS.volume,
      music: {
        enabled: typeof music.enabled === 'boolean' ? music.enabled : DEFAULT_SETTINGS.music.enabled,
        volume:
          typeof music.volume === 'number'
            ? clampVolume(music.volume, DEFAULT_SETTINGS.music.volume)
            : DEFAULT_SETTINGS.music.volume,
      },
    };
  } catch {
    return { ...DEFAULT_SETTINGS, music: { ...DEFAULT_SETTINGS.music } };
  }
}

export function duckLevel(volume: number): number {
  return clampVolume(volume, DEFAULT_SETTINGS.music.volume) * 0.45;
}

export function canPlay(lastPlayed: number | undefined, now: number, interval = 50): boolean {
  return lastPlayed === undefined || now - lastPlayed >= interval;
}
