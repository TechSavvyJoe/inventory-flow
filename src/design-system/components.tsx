import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import { ActionsIcon } from "./icons";
import "./components.css";

type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
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
        {tenantLabel ? <small>{tenantLabel}</small> : <small>Dealer tools</small>}
      </span>
    </div>
  );
}
