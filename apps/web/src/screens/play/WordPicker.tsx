import { useMemo, useState } from 'react';
import { Button } from '@/ui/Button';
import { RadioChips } from '@/ui/Chip';

const QUICK = 12;

interface WordPickerProps {
  words: readonly string[];
  value: string | null;
  onChange: (word: string) => void;
  disabled?: boolean;
}

/** 12 word chips at a time (shuffle for more) and a search over the full published list. */
export function WordPicker({ words, value, onChange, disabled }: WordPickerProps) {
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState('');
  const stride = Math.max(1, Math.floor(words.length / QUICK));
  const quick = useMemo(() => {
    const list: string[] = [];
    for (let i = 0; i < Math.min(QUICK, words.length); i++)
      list.push(words[(offset + i * stride) % words.length]!);
    if (value && !list.includes(value)) list[list.length - 1] = value;
    return list;
  }, [words, offset, stride, value]);
  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? words.filter(w => w.includes(q)).slice(0, 24) : [];
  }, [words, query]);

  return (
    <div>
      <RadioChips
        label="Word"
        value={value}
        onChange={onChange}
        disabled={disabled}
        options={quick.map(w => ({ value: w, label: w }))}
        small
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          variant="paper"
          size="sm"
          disabled={disabled}
          onClick={() => setOffset(o => (o + 7) % Math.max(1, words.length))}
        >
          Shuffle words
        </Button>
        <div className="min-w-[180px] flex-1">
          <label htmlFor="word-search" className="sr-only">
            Search all {words.length} words
          </label>
          <input
            id="word-search"
            className="field"
            type="search"
            placeholder={`Search all ${words.length} words`}
            value={query}
            disabled={disabled}
            autoComplete="off"
            onChange={e => setQuery(e.target.value)}
          />
        </div>
      </div>
      {query.trim() ? (
        hits.length ? (
          <div className="mt-3">
            <RadioChips
              label="Search results"
              value={value}
              onChange={w => {
                onChange(w);
                setQuery('');
              }}
              options={hits.map(w => ({ value: w, label: w }))}
              plain
              small
            />
          </div>
        ) : (
          <p className="mt-2 text-[15px] font-bold">
            No word on the published list matches “{query.trim()}”.
          </p>
        )
      ) : null}
    </div>
  );
}
