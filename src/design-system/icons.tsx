import type { ReactNode, SVGProps } from "react";

export type FlowIconProps = Omit<SVGProps<SVGSVGElement>, "children" | "viewBox"> & {
  size?: number | string;
  title?: string;
};

type IconFrameProps = FlowIconProps & { children: ReactNode };

function IconFrame({ children, className = "", size = 20, title, ...props }: IconFrameProps) {
  return (
    <svg
      {...props}
      className={`ifx-icon ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      aria-hidden={title ? undefined : true}
      aria-label={title}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export function ActionsIcon(props: FlowIconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle data-accent="true" cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </IconFrame>
  );
}
