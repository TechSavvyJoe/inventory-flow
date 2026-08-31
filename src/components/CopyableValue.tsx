import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { Check, Copy } from "lucide-react";
import "./CopyableValue.css";

type CopyState = "idle" | "copied" | "failed";

export interface CopyableValueProps {
  /** Human-readable field name used in the button label and status message. */
  label: string;
  /** Exact text written to the clipboard. It is never trimmed or reformatted. */
  text: string;
  /** Optional formatted visual value. Clipboard output still comes only from `text`. */
  children?: ReactNode;
  className?: string;
  compact?: boolean;
}

function fallbackCopyText(text: string): boolean {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") {
    return false;
  }

  const previousFocus = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.inset = "-9999px auto auto -9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);

  try {
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
    previousFocus?.focus({ preventScroll: true });
  }
}

export async function copyExactText(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // A browser can expose Clipboard API but block it outside a secure context.
      // Continue to the user-initiated legacy copy path in that case.
    }
  }

  return fallbackCopyText(text);
}

export function CopyableValue({
  label,
  text,
  children,
  className = "",
  compact = false,
}: CopyableValueProps) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (resetTimerRef.current != null) window.clearTimeout(resetTimerRef.current);
  }, []);

  const resetLater = () => {
    if (resetTimerRef.current != null) window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = window.setTimeout(() => {
      setCopyState("idle");
      resetTimerRef.current = null;
    }, 1800);
  };

  const handleCopy = async (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const copied = await copyExactText(text);
    setCopyState(copied ? "copied" : "failed");
    resetLater();
  };

  const copyDescription = `Copy ${label}: ${text}`;
  const statusText = copyState === "copied"
    ? `${label} copied`
    : copyState === "failed"
      ? `Could not copy ${label}`
      : "";

  return (
    <span
      className={`copyable-value${compact ? " copyable-value--compact" : ""}${className ? ` ${className}` : ""}`}
      data-copy-state={copyState}
    >
      <span className="copyable-value__content">{children ?? text}</span>
      <button
        type="button"
        className="copyable-value__button"
        aria-label={copyDescription}
        title={copyDescription}
        onClick={handleCopy}
      >
        {copyState === "copied" ? (
          <Check size={compact ? 12 : 14} strokeWidth={2.2} aria-hidden="true" />
        ) : (
          <Copy size={compact ? 12 : 14} strokeWidth={1.9} aria-hidden="true" />
        )}
        <span className="copyable-value__button-label">
          {copyState === "copied" ? "Copied" : "Copy"}
        </span>
      </button>
      {statusText ? (
        <span
          className="copyable-value__status inventory-sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {statusText}
        </span>
      ) : null}
    </span>
  );
}
