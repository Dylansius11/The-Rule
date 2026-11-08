import { duckLevel, type SoundSettings } from './settings';

export type MusicEngine = {
  update: (settings: SoundSettings['music']) => Promise<void>;
  duck: () => void;
  dispose: () => void;
};

export function createMusic(context: AudioContext, initial: SoundSettings['music']): MusicEngine {
  let settings = initial;
  let buffer: AudioBuffer | null = null;
  let loading = false;
  let stopped = false;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sources: AudioBufferSourceNode[] = [];
  const master = context.createGain();
  master.gain.value = 0;
  master.connect(context.destination);

  function ramp(value: number, seconds: number) {
    const now = context.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(value, now + seconds);
  }

  function stop() {
    generation++;
    clearTimeout(timer);
    timer = undefined;
    ramp(0, 0.15);
    const old = sources;
    sources = [];
    for (const source of old) {
      try {
        source.stop(context.currentTime + 0.16);
      } catch {
        /* Already stopped. */
      }
    }
  }

  function start() {
    if (stopped || !settings.enabled || document.hidden || !buffer || sources.length) return;
    const audio = buffer;
    const serial = generation;
    const overlap = Math.min(2, audio.duration / 4);
    function schedule(when: number) {
      if (serial !== generation || stopped) return;
      const source = context.createBufferSource();
      const envelope = context.createGain();
      source.buffer = audio;
      envelope.gain.setValueAtTime(0, when);
      envelope.gain.linearRampToValueAtTime(1, when + overlap);
      envelope.gain.setValueAtTime(1, when + audio.duration - overlap);
      envelope.gain.linearRampToValueAtTime(0, when + audio.duration);
      source.connect(envelope).connect(master);
      sources.push(source);
      source.onended = () => {
        sources = sources.filter(item => item !== source);
        source.disconnect();
        envelope.disconnect();
      };
      source.start(when);
      const next = when + audio.duration - overlap;
      timer = setTimeout(() => schedule(next), Math.max(0, (next - context.currentTime - 0.5) * 1000));
    }
    schedule(context.currentTime);
    ramp(settings.volume, 2);
  }

  async function update(next: SoundSettings['music']) {
    settings = next;
    if (stopped) return;
    if (!next.enabled || document.hidden) {
      stop();
      return;
    }
    if (context.state === 'suspended') await context.resume().catch(() => {});
    if (stopped || !settings.enabled || document.hidden) return;
    if (!buffer && !loading) {
      loading = true;
      try {
        const response = await fetch('/music/ambient.mp3');
        if (!response.ok) throw new Error('Music unavailable');
        buffer = await context.decodeAudioData(await response.arrayBuffer());
      } catch {
        /* Music is optional. */
      }
      loading = false;
    }
    if (sources.length) ramp(settings.volume, 0.15);
    else start();
  }

  function visibility() {
    void update(settings);
  }
  document.addEventListener('visibilitychange', visibility);
  void update(settings);
  return {
    update,
    duck() {
      if (!sources.length || !settings.enabled || document.hidden) return;
      const now = context.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(duckLevel(settings.volume), now + 0.04);
      master.gain.linearRampToValueAtTime(settings.volume, now + 0.64);
    },
    dispose() {
      stopped = true;
      document.removeEventListener('visibilitychange', visibility);
      stop();
      setTimeout(() => master.disconnect(), 200);
    },
  };
}
