import { useState, type ReactNode } from 'react';
import { Art } from '@/art/Art';
import { active, chooseDeployment, config, type DeploymentChoice } from '@/config/env';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';

/**
 * Live / Demo choice, shared by the deployment strip and the mobile More sheet. When no demo instance is
 * configured, choosing Demo explains that honestly instead of switching to anything.
 */
export function useDeploymentChoice(): {
  current: DeploymentChoice;
  choose: (choice: DeploymentChoice) => void;
  dialog: ReactNode;
} {
  const [explain, setExplain] = useState(false);
  const current: DeploymentChoice = active.kind === 'demo' ? 'demo' : 'main';

  function choose(choice: DeploymentChoice) {
    if (choice === current) return;
    if (choice === 'demo' && !config.demo) {
      setExplain(true);
      return;
    }
    chooseDeployment(choice);
  }

  const dialog = (
    <Dialog open={explain} onClose={() => setExplain(false)} labelledBy="demo-title">
      <div className="p-6 text-center md:p-8">
        <Art name="stickers/asleep" width={150} />
        <h2 id="demo-title" className="display mt-2 text-[clamp(34px,6vw,48px)]">
          Demo Mode is not configured in this build
        </h2>
        <p className="mx-auto mt-3 max-w-[44ch] text-[17px] font-semibold">
          Demo Mode runs a separate copy of the game with a preselected rule, its own pot and token, on a
          compressed clock. It is always labeled “Demo Mode - preselected rule”.
        </p>
        <p className="mx-auto mt-2 max-w-[44ch] text-[17px] font-semibold">
          This build has no Demo contract pair configured, so it cannot switch instances. You stay on the
          current deployment.
        </p>
        <div className="mt-5 flex justify-center">
          <Button variant="red" size="lg" onClick={() => setExplain(false)} sound={false}>
            Stay on the real game
          </Button>
        </div>
      </div>
    </Dialog>
  );

  return { current, choose, dialog };
}
