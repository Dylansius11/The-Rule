import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router';

type Variant = 'sun' | 'red' | 'grape' | 'paper' | 'lime';
type Size = 'sm' | 'md' | 'lg' | 'xl';

interface Common {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  /** An action is in flight: shows busy cursor and blocks repeat presses. */
  busy?: boolean;
  /** Programmatic press, e.g. the stamp button during the thump. */
  pressed?: boolean;
  className?: string;
  children: ReactNode;
}

type ButtonProps = Common &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'> & {
    to?: undefined;
    href?: undefined;
  };
type LinkProps = Common & {
  to: string;
  href?: undefined;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
};
type AnchorProps = Common & { href: string; to?: undefined; disabled?: boolean; title?: string };

/** A slab on a visible lip. The face drops onto the lip when pressed. Renders a button, router link or external anchor. */
export function Button(props: ButtonProps | LinkProps | AnchorProps) {
  const { variant = 'sun', size = 'md', block, busy, pressed, className = '', children } = props;
  const shared = {
    className: `btn ${className}`,
    'data-variant': variant,
    'data-size': size,
    'data-block': block ? 'true' : undefined,
    'data-pressed': pressed ? 'true' : undefined,
    'aria-busy': busy ? true : undefined,
  } as const;
  const face = <span className="btn-face">{children}</span>;

  if (props.to !== undefined) {
    return (
      <Link
        to={props.to}
        onClick={props.onClick}
        title={props.title}
        {...shared}
        aria-disabled={props.disabled || undefined}
      >
        {face}
      </Link>
    );
  }
  if (props.href !== undefined) {
    return (
      <a
        href={props.href}
        target="_blank"
        rel="noreferrer noopener"
        title={props.title}
        {...shared}
        aria-disabled={props.disabled || undefined}
      >
        {face}
      </a>
    );
  }
  const {
    variant: _v,
    size: _s,
    block: _b,
    busy: _y,
    pressed: _p,
    className: _c,
    children: _ch,
    type = 'button',
    disabled,
    onClick,
    ...rest
  } = props;
  const off = disabled || busy;
  return (
    <button
      {...rest}
      type={type}
      disabled={off}
      onClick={onClick}
      {...shared}
      aria-disabled={off || undefined}
    >
      {face}
    </button>
  );
}
