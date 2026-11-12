import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { canPlay, clampVolume, DEFAULT_SETTINGS, parseSettings } from './settings';
import type { MusicEngine } from './music';

export type SoundName =
  | 'tap'
  | 'toggle'
  | 'open'
  | 'close'
  | 'whoosh'
  | 'page'
  | 'stamp'
  | 'yes'
  | 'no'
  | 'duplicate'
  | 'pending'
  | 'refund'
  | 'error'
  | 'seal'
  | 'replay-pass'
  | 'replay-fail'
  | 'mint'
  | 'blot'
  | 'jump'
  | 'success'
  | 'nav'
  | 'sign'
  | 'stamp-roll'
  | 'win'
  | 'correct';

type SoundControls = {
  play: (name: SoundName) => void;
  enabled: boolean;
  setEnabled: (on: boolean) => void;
  volume: number;
  setVolume: (v: number) => void;
  music: { enabled: boolean; volume: number };
  setMusicEnabled: (on: boolean) => void;
  setMusicVolume: (v: number) => void;
};

const KEY = 'the-rule:sound';
const GAINS: Record<SoundName, number> = {
  tap: 0.55,
  toggle: 0.6,
  open: 0.65,
  close: 0.6,
  whoosh: 0.55,
  page: 0.55,
  stamp: 0.8,
  yes: 0.65,
  no: 0.7,
  duplicate: 0.65,
  pending: 0.55,
  refund: 0.65,
  error: 0.65,
  seal: 0.75,
  'replay-pass': 0.65,
  'replay-fail': 0.65,
  mint: 0.6,
  blot: 0.6,
  jump: 0.65,
  success: 0.65,
  nav: 0.5,
  sign: 0.6,
  'stamp-roll': 0.6,
  win: 0.8,
  correct: 0.75,
};
/**
 * Sounds whose own file may not exist yet play an older cue instead, so a missing `stamp-roll.mp3` leaves the
 * pending cue in place rather than silence. Names without an entry stay silent until their file ships.
 */
const FALLBACK: Partial<Record<SoundName, SoundName>> = { 'stamp-roll': 'pending' };

/** The file is not there (404, or the host's single-page fallback answered with HTML): expected, not an error. */
class MissingSound extends Error {}
const MAX_VOICES = 6;
const SoundContext = createContext<SoundControls | null>(null);

function readSettings() {
  try {
    return parseSettings(localStorage.getItem(KEY));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function SoundProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(readSettings);
  const current = useRef(settings);
  current.current = settings;
  const audio = useRef<AudioContext | null>(null);
  const buffers = useRef(new Map<SoundName, Promise<AudioBuffer | null>>());
  const lastPlayed = useRef(new Map<SoundName, number>());
  const voices = useRef(0);
  const mounted = useRef(false);
  const resumed = useRef<Promise<void> | null>(null);
  const music = useRef<MusicEngine | null>(null);
  const musicLoading = useRef(false);

  const load = useCallback((context: AudioContext, name: SoundName) => {
    let buffer = buffers.current.get(name);
    if (!buffer) {
      const file = `/sfx/${name}.mp3`;
      buffer = fetch(file)
        .then(response => {
          if (!response.ok || response.headers.get('content-type')?.startsWith('text/html'))
            throw new MissingSound();
          return response.arrayBuffer();
        })
        .then(bytes => context.decodeAudioData(bytes))
        .catch(error => {
          if (!(error instanceof MissingSound)) console.error(`Unable to load or decode sound: ${file}`);
          return null;
        });
      buffers.current.set(name, buffer);
    }
    return buffer;
  }, []);

  useEffect(() => {
    mounted.current = true;
    const unlock = () => {
      try {
        const firstUnlock = !audio.current;
        const context = audio.current ?? new AudioContext();
        audio.current = context;
        if (context.state === 'suspended') resumed.current = context.resume().catch(() => {});
        if (firstUnlock) {
          for (const name of Object.keys(GAINS) as SoundName[]) void load(context, name);
        }
        if (!music.current && !musicLoading.current) {
          musicLoading.current = true;
          void import('./music')
            .then(({ createMusic }) => {
              if (mounted.current && audio.current === context) {
                music.current = createMusic(context, current.current.music);
              }
            })
            .catch(() => {})
            .finally(() => {
              musicLoading.current = false;
            });
        }
      } catch {
        /* Audio is unavailable; the interface remains usable. */
      }
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    return () => {
      mounted.current = false;
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
      const context = audio.current;
      audio.current = null;
      buffers.current.clear();
      music.current?.dispose();
      music.current = null;
      if (context) void context.close().catch(() => {});
    };
  }, [load]);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      /* Storage is optional. */
    }
  }, [settings]);

  useEffect(() => {
    void music.current?.update(settings.music);
  }, [settings.music]);

  const play = useCallback(
    (name: SoundName) => {
      const context = audio.current;
      if (!context || !current.current.enabled || document.hidden) return;
      const now = performance.now();
      if (!canPlay(lastPlayed.current.get(name), now) || voices.current >= MAX_VOICES) return;
      lastPlayed.current.set(name, now);
      voices.current++;
      const fallback = FALLBACK[name];
      const buffer = load(context, name).then(own =>
        own === null && fallback ? load(context, fallback) : own,
      );
      void buffer.then(async decoded => {
        if (context.state === 'suspended') await resumed.current;
        if (
          !decoded ||
          !mounted.current ||
          audio.current !== context ||
          context.state !== 'running' ||
          !current.current.enabled ||
          document.hidden
        ) {
          voices.current--;
          return;
        }
        try {
          const source = context.createBufferSource();
          const gain = context.createGain();
          source.buffer = decoded;
          if (name === 'tap' || name === 'stamp' || name === 'page')
            source.playbackRate.value = 0.96 + Math.random() * 0.08;
          gain.gain.value = GAINS[name] * current.current.volume;
          source.connect(gain).connect(context.destination);
          source.onended = () => {
            voices.current--;
            source.disconnect();
            gain.disconnect();
          };
          music.current?.duck();
          source.start();
        } catch {
          voices.current--;
        }
      });
    },
    [load],
  );
  const setEnabled = useCallback((enabled: boolean) => setSettings(value => ({ ...value, enabled })), []);
  const setVolume = useCallback(
    (volume: number) => setSettings(value => ({ ...value, volume: clampVolume(volume) })),
    [],
  );
  const setMusicEnabled = useCallback(
    (enabled: boolean) => setSettings(value => ({ ...value, music: { ...value.music, enabled } })),
    [],
  );
  const setMusicVolume = useCallback(
    (volume: number) =>
      setSettings(value => ({
        ...value,
        music: { ...value.music, volume: clampVolume(volume, DEFAULT_SETTINGS.music.volume) },
      })),
    [],
  );
  return createElement(
    SoundContext.Provider,
    { value: { play, ...settings, setEnabled, setVolume, setMusicEnabled, setMusicVolume } },
    children,
  );
}

export function useSound(): SoundControls {
  const value = useContext(SoundContext);
  if (!value) throw new Error('useSound must be used within SoundProvider');
  return value;
}
