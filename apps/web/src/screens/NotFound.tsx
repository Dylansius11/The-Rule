import { Link } from 'react-router';
import { roomPath } from '@/app/paths';
import { Heron } from '@/mascot/Heron';
import { Button } from '@/ui/Button';
import { InkBox } from '@/ui/InkBox';

/** 404: the heron in a suit, apologetic. Not the referee, never stamps anything. */
export function NotFound() {
  return (
    <div className="wrap py-14 md:py-20">
      <InkBox
        className="mx-auto flex max-w-[820px] flex-col items-center gap-5 p-8 text-center md:flex-row md:text-left"
        tilt={-0.8}
      >
        <Heron pose="suit" width={150} />
        <div>
          <p className="hand -rotate-2 text-[28px]">404</p>
          <h1 className="display text-[clamp(44px,8vw,76px)] leading-[0.9]">
            That page is not in the ledger.
          </h1>
          <p className="mt-3 text-[19px] font-bold">
            The clerk checked every drawer. Nothing lives at this address.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-4 md:justify-start">
            <Button to={roomPath(0)} variant="red">
              Back to the game
            </Button>
            <Button to="/" variant="paper">
              Start page
            </Button>
          </div>
          <p className="mt-4 text-[15px] font-semibold">
            <Link to={roomPath(0, 'verify')} className="font-extrabold underline decoration-2">
              Or see the last opened law
            </Link>
            .
          </p>
        </div>
      </InkBox>
    </div>
  );
}
