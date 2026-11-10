import { RadioChips } from '@/ui/Chip';

interface RoundPickerProps {
  /** Observed round IDs, newest first; not an exhaustive retained-round index. */
  rounds: readonly number[];
  value: number | null;
  onChange: (round: number) => void;
}

/** Chips for the newest ten rounds of the mode. Renders nothing before the first round exists. */
export function RoundPicker({ rounds, value, onChange }: RoundPickerProps) {
  if (rounds.length === 0) return null;
  const visible = rounds.slice(0, 10);
  if (value !== null && rounds.includes(value) && !visible.includes(value)) visible.push(value);
  return (
    <RadioChips
      label="Round"
      value={value}
      onChange={onChange}
      options={visible.map(id => ({ value: id, label: `#${id}` }))}
      small
    />
  );
}
