import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import { ActionsIcon, type FlowIconProps } from "./icons";

type ButtonVariant = "primary" | "oem" | "secondary" | "glass" | "quiet" | "danger";
type ButtonSize = "sm" | "md" | "lg";

export interface FlowButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconBefore?: ReactNode;
  iconAfter?: ReactNode;
  loading?: boolean;
  loadingLabel?: string;
}

export const FlowButton = forwardRef<HTMLButtonElement, FlowButtonProps>(function FlowButton(
  {
    children,
    className = "",
    disabled,
    iconAfter,
    iconBefore,
    loading = false,
    loadingLabel = "Working",
    size = "md",
    type = "button",
    variant = "primary",
    ...props
  },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`ifx-button ifx-button--${variant} ifx-button--${size} ${className}`.trim()}
    >
      <span className="ifx-button__edge" aria-hidden="true" />
      {loading ? <span className="ifx-button__spinner" aria-hidden="true" /> : iconBefore}
      <span className="ifx-button__label">{loading ? loadingLabel : children}</span>
      {loading ? null : iconAfter}
    </button>
  );
});

export interface FlowIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: ButtonSize;
  variant?: Exclude<ButtonVariant, "primary"> | "primary";
}

export const FlowIconButton = forwardRef<HTMLButtonElement, FlowIconButtonProps>(function FlowIconButton(
  { children = <ActionsIcon />, className = "", label, size = "md", type = "button", variant = "secondary", ...props },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      aria-label={label}
      title={props.title ?? label}
      className={`ifx-icon-button ifx-button--${variant} ifx-button--${size} ${className}`.trim()}
    >
      {children}
    </button>
  );
});

type SignalTone = "neutral" | "info" | "success" | "warning" | "danger" | "hold";

export interface FlowSignalProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: SignalTone;
  leading?: ReactNode;
}

export function FlowSignal({ children, className = "", leading, tone = "neutral", ...props }: FlowSignalProps) {
  return (
    <span {...props} className={`ifx-signal ifx-signal--${tone} ${className}`.trim()}>
      {leading}
      <span>{children}</span>
    </span>
  );
}

type SurfaceVariant = "base" | "raised" | "glass" | "command" | "dark";

export interface FlowSurfaceProps extends HTMLAttributes<HTMLElement> {
  variant?: SurfaceVariant;
  header?: ReactNode;
  footer?: ReactNode;
}

export function FlowSurface({ children, className = "", footer, header, variant = "base", ...props }: FlowSurfaceProps) {
  return (
    <section {...props} className={`ifx-surface ifx-surface--${variant} ${className}`.trim()}>
      {header ? <header className="ifx-surface__header">{header}</header> : null}
      <div className="ifx-surface__body">{children}</div>
      {footer ? <footer className="ifx-surface__footer">{footer}</footer> : null}
    </section>
  );
}

export interface FlowBrandLockupProps extends HTMLAttributes<HTMLDivElement> {
  tenantLabel?: string;
  productLabel?: string;
  compact?: boolean;
  reversed?: boolean;
}

/**
 * Product and tenant are intentionally separate DOM elements. The tenant can
 * change without altering or redrawing the Inventory Flow identity.
 */
export function FlowBrandLockup({
  className = "",
  compact = false,
  productLabel = "Inventory Flow",
  reversed = false,
  tenantLabel,
  ...props
}: FlowBrandLockupProps) {
  return (
    <div
      {...props}
      className={`ifx-brand-lockup ${compact ? "ifx-brand-lockup--compact" : ""} ${reversed ? "is-reversed" : ""} ${className}`.trim()}
    >
      <img src="/brand-kit/inventory-flow-icon.svg" alt="" className="ifx-brand-lockup__mark" />
      <span className="ifx-brand-lockup__type">
        <strong>{productLabel}</strong>
        {tenantLabel ? <small>{tenantLabel}</small> : <small>Automotive operations</small>}
      </span>
    </div>
  );
}

export interface FlowActionDockProps extends HTMLAttributes<HTMLDivElement> {
  primary: ReactNode;
  secondary?: ReactNode;
  utilities?: ReactNode;
  status?: ReactNode;
}

/** Dense action pattern intended for SRP rows and the sticky edge of a VDP. */
export function FlowActionDock({ className = "", primary, secondary, status, utilities, ...props }: FlowActionDockProps) {
  return (
    <div {...props} className={`ifx-action-dock ${className}`.trim()}>
      {status ? <div className="ifx-action-dock__status">{status}</div> : null}
      <div className="ifx-action-dock__primary">{primary}</div>
      {secondary ? <div className="ifx-action-dock__secondary">{secondary}</div> : null}
      {utilities ? <div className="ifx-action-dock__utilities">{utilities}</div> : null}
    </div>
  );
}

export type FlowIconComponent = (props: FlowIconProps) => ReactNode;
