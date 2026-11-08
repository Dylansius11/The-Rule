import { RadioChips } from '@/ui/Chip';
import type { Mode } from '@/game/types';

export function ModePicker({
  mode,
  onChange,
  label = 'Mode',
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
  label?: string;
}) {
  return (
    <RadioChips
      label={label}
      value={mode}
      onChange={onChange}
      options={[
        { value: 0 as Mode, label: 'Solo' },
        { value: 1 as Mode, label: 'Team' },
      ]}
    />
  );
}
