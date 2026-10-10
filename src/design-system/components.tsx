import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode, type Ref } from "react";
import { ActionsIcon } from "./icons";
import "./components.css";

export interface FlowPageHeaderProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title: ReactNode;
  titleId?: string;
  titleLabel?: string;
  titleRef?: Ref<HTMLHeadingElement>;
  titleTabIndex?: number;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  facts?: ReactNode;
}

export function FlowPageHeader({ title, titleId, titleLabel, titleRef, titleTabIndex, description, icon, actions, facts, children, className = "", ...props }: FlowPageHeaderProps) {
  return <header {...props} className={`ifx-page-header ${className}`.trim()}>
    <div className="ifx-page-header__row">
      {icon ? <span className="ifx-page-header__icon" aria-hidden="true">{icon}</span> : null}
      <div className="ifx-page-header__identity">
        <h1 id={titleId} aria-label={titleLabel} ref={titleRef} tabIndex={titleTabIndex} className="ifx-page-header__title">{title}</h1>
        {description ? <div className="ifx-page-header__description">{description}</div> : null}
      </div>
      {actions ? <div className="ifx-page-header__actions">{actions}</div> : null}
    </div>
    {children ? <div className="ifx-page-header__controls">{children}</div> : null}
    {facts ? <div className="ifx-page-header__facts">{facts}</div> : null}
  </header>;
}

export interface FlowLedgerHeadingProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title: ReactNode;
  titleId?: string;
  titleRef?: Ref<HTMLHeadingElement>;
  titleTabIndex?: number;
  level?: 2 | 3;
  actions?: ReactNode;
  description?: ReactNode;
  variant?: "accent" | "plain";
}

export function FlowLedgerHeading({ title, titleId, titleRef, titleTabIndex, level = 2, actions, description, variant = "plain", className = "", ...props }: FlowLedgerHeadingProps) {
  const Heading = level === 3 ? "h3" : "h2";
  return <header {...props} className={`ifx-ledger-heading ifx-ledger-heading--${variant} ${className}`.trim()}>
    <div className="ifx-ledger-heading__row">
      <div className="ifx-ledger-heading__label"><Heading id={titleId} ref={titleRef} tabIndex={titleTabIndex} className="ifx-ledger-heading__title">{title}</Heading></div>
      {actions ? <div className="ifx-ledger-heading__actions">{actions}</div> : null}
    </div>
    {description ? <div className="ifx-ledger-heading__description">{description}</div> : null}
  </header>;
}

type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
type ButtonSize = "sm" | "md" | "lg";

export function flowButtonClassName({ variant = "secondary", size = "md", className = "" }: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  return `ifx-button ifx-button--${variant} ifx-button--${size} ${className}`.trim();
}

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
      className={flowButtonClassName({ variant, size, className })}
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
