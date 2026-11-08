import { isRouteErrorResponse, useRouteError } from 'react-router';
import { NotFound } from '@/screens/NotFound';
import { Button } from '@/ui/Button';
import { InkBox } from '@/ui/InkBox';

/** A 404 from a route loader shows the not-found page; any other thrown error says what failed instead of a blank screen. */
export function RouteError() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFound />;
  const message = error instanceof Error ? error.message : 'Something went wrong while opening this page.';
  return (
    <div className="wrap py-14 md:py-20">
      <InkBox className="mx-auto max-w-[720px] p-8 text-center" fill="#fff4f1" role="alert">
        <h1 className="display text-[clamp(40px,7vw,64px)] leading-[0.9] text-tomato-deep">
          This page broke
        </h1>
        <p className="mt-3 text-[18px] font-bold">{message}</p>
        <p className="mt-2 font-semibold">Nothing was sent to the chain. Reload to try again.</p>
        <div className="mt-5 flex justify-center gap-4">
          <Button variant="red" onClick={() => location.reload()}>
            Reload
          </Button>
          <Button to="/" variant="paper">
            Back to the start
          </Button>
        </div>
      </InkBox>
    </div>
  );
}
