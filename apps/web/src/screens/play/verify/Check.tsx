export type CheckTone = 'wait' | 'run' | 'ok' | 'bad' | 'info';

export function Check({
  tone,
  children,
  detail,
}: {
  tone: CheckTone;
  children: React.ReactNode;
  detail?: React.ReactNode;
}) {
  const icon = tone === 'ok' ? '✓' : tone === 'bad' ? '✗' : tone === 'info' ? 'i' : '';
  return (
    <li
      className={`flex items-start gap-3 font-mono text-[15px] font-bold transition-opacity ${tone === 'wait' ? 'opacity-40' : ''}`}
    >
      {tone === 'run' ? (
        <span className="spinner" aria-hidden="true" />
      ) : (
        <span
          aria-hidden="true"
          className={`grid h-[30px] w-[30px] flex-none place-items-center rounded-full border-[3px] border-ink font-display text-[18px] font-black leading-none ${
            tone === 'ok' ? 'bg-lime' : tone === 'bad' ? 'bg-tomato' : 'bg-white'
          }`}
        >
          {icon}
        </span>
      )}
      <span className="min-w-0 pt-0.5">
        {children}
        {detail ? (
          <span className="mt-0.5 block text-[13px] font-semibold text-ink-soft">{detail}</span>
        ) : null}
      </span>
    </li>
  );
}
