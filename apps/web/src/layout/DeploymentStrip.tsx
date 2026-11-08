import { active, deploymentLabel } from '@/config/env';
import { Segmented } from '@/ui/Segmented';
import { useDeploymentChoice } from './demo';

/**
 * The deployment label under the header on every page, with the Live / Demo toggle. When the page talks to a
 * demo instance the strip is a permanent tomato tape that says so.
 */
export function DeploymentStrip() {
  const { current, choose, dialog } = useDeploymentChoice();
  const demo = active.kind === 'demo';
  return (
    <div
      role="note"
      data-demo={demo ? 'true' : undefined}
      className={`flex items-center justify-between gap-3 border-b-[3px] border-ink px-3.5 py-1 md:px-7 ${
        demo ? 'bg-tomato' : 'bg-paper-2'
      }`}
      style={{ minHeight: 'var(--strip-h)' }}
    >
      <span
        className={`min-w-0 flex-1 leading-tight ${
          demo
            ? 'display text-[22px] tracking-wide md:text-center'
            : 'mono text-[12px] font-bold md:text-center md:text-[13px]'
        }`}
      >
        {demo ? '' : <span aria-hidden="true">● </span>}
        {deploymentLabel(active.kind)}
      </span>
      <Segmented
        size="sm"
        label="Deployment"
        value={current}
        onChange={choose}
        options={[
          { value: 'main', label: 'Live' },
          { value: 'demo', label: 'Demo' },
        ]}
        className="shrink-0"
      />
      {dialog}
    </div>
  );
}
