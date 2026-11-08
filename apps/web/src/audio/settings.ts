export type SoundSettings = { enabled: boolean; volume: number };

export const DEFAULT_SETTINGS: SoundSettings = { enabled: true, volume: 0.6 };

export function clampVolume(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : DEFAULT_SETTINGS.volume;
}

export function parseSettings(raw: string | null): SoundSettings {
  try {
    const value: unknown = raw === null ? null : JSON.parse(raw);
    if (!value || typeof value !== 'object') return { ...DEFAULT_SETTINGS };
    const settings = value as Record<string, unknown>;
    return {
      enabled: typeof settings.enabled === 'boolean' ? settings.enabled : DEFAULT_SETTINGS.enabled,
      volume: typeof settings.volume === 'number' ? clampVolume(settings.volume) : DEFAULT_SETTINGS.volume,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function canPlay(lastPlayed: number | undefined, now: number, interval = 50): boolean {
  return lastPlayed === undefined || now - lastPlayed >= interval;
}
