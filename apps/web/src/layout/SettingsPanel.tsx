import { useId } from 'react';
import { useSound } from '@/audio';
import { useMotionPrefs } from '@/motion/prefs';
import { Button } from '@/ui/Button';
import { useGuide } from './guide';

function Switch({
  checked,
  onChange,
  label,
  id,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  id: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="switch"
      onClick={() => onChange(!checked)}
    >
      <span aria-hidden="true" className="switch-knob" />
    </button>
  );
}

/** Sound, motion and the guide. One panel, shown in the header popover and in the mobile More sheet. */
export function SettingsPanel({ onNavigate }: { onNavigate?: () => void }) {
  const uid = useId();
  const sound = useSound();
  const { userReduced, setUserReduced } = useMotionPrefs();
  const { show } = useGuide();

  return (
    <div className="grid gap-4 text-left">
      <div>
        <div className="flex min-h-[44px] items-center justify-between gap-3">
          <label htmlFor={`${uid}-sound`} className="font-extrabold">
            Sound
          </label>
          <Switch
            id={`${uid}-sound`}
            label="Sound"
            checked={sound.enabled}
            onChange={on => {
              sound.setEnabled(on);
              if (on) requestAnimationFrame(() => sound.play('toggle'));
            }}
          />
        </div>
        <div className="flex min-h-[44px] items-center gap-3">
          <label htmlFor={`${uid}-vol`} className="mono text-[13px] font-bold uppercase tracking-wider">
            Volume
          </label>
          <input
            id={`${uid}-vol`}
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={sound.volume}
            disabled={!sound.enabled}
            onChange={e => sound.setVolume(Number(e.target.value))}
            onPointerUp={() => sound.play('tap')}
            className="range min-w-0 flex-1"
            aria-valuetext={`${Math.round(sound.volume * 100)} percent`}
          />
        </div>
        <p className="text-[14px] font-semibold text-ink-soft">
          Short sounds that answer what you do. Never on page load, never music.
        </p>
      </div>

      <div>
        <div className="flex min-h-[44px] items-center justify-between gap-3">
          <label htmlFor={`${uid}-motion`} className="font-extrabold">
            Reduce motion
          </label>
          <Switch
            id={`${uid}-motion`}
            label="Reduce motion"
            checked={userReduced}
            onChange={on => {
              setUserReduced(on);
              sound.play('toggle');
            }}
          />
        </div>
        <p className="text-[14px] font-semibold text-ink-soft">
          Turns off hopping, drifting and scrolling effects, for people who get dizzy from animation. Your
          device&apos;s own reduce-motion setting is always honoured too.
        </p>
      </div>

      <Button
        variant="paper"
        size="sm"
        block
        onClick={() => {
          onNavigate?.();
          show();
        }}
      >
        Show how to play
      </Button>
    </div>
  );
}
