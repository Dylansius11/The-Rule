import { RadioChips } from '@/ui/Chip';

interface RoundPickerProps {
  /** Every round id that exists, newest first. */
  rounds: readonly number[];
  value: number | null;
  onChange: (round: number) => void;
}

/** Chips for the newest ten rounds of the mode. Renders nothing before the first round exists. */
export function RoundPicker({ rounds, value, onChange }: RoundPickerProps) {
  if (rounds.length === 0) return null;
  return (
    <RadioChips
      label="Round"
      value={value}
      onChange={onChange}
      options={rounds.slice(0, 10).map(id => ({ value: id, label: `#${id}` }))}
      small
    />
  );
}
