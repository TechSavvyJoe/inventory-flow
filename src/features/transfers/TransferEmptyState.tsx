import {
  ClipboardList,
  DatabaseZap,
  LockKeyhole,
  MousePointer2,
  Plus,
} from 'lucide-react';

export type TransferEmptyStateVariant =
  | 'no-records'
  | 'no-selection'
  | 'no-permission'
  | 'source-unavailable';

export interface TransferEmptyStateProps {
  variant?: TransferEmptyStateVariant;
  title?: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

const variantContent: Record<
  TransferEmptyStateVariant,
  { title: string; description: string; Icon: typeof ClipboardList }
> = {
  'no-records': {
    title: 'No movement requests yet',
    description:
      'Start from a vehicle record when another store needs a customer show, operational move, or documented return.',
    Icon: ClipboardList,
  },
  'no-selection': {
    title: 'Select a movement',
    description:
      'Choose a row to see custody, independent source statuses, the next action owner, and its audit timeline.',
    Icon: MousePointer2,
  },
  'no-permission': {
    title: 'This view is restricted',
    description:
      'Your role does not include the detail or action requested. Ask a manager if your responsibilities have changed.',
    Icon: LockKeyhole,
  },
  'source-unavailable': {
    title: 'Source information needs review',
    description:
      'A connected source is stale or incomplete. Existing custody records remain visible, but availability is not confirmed.',
    Icon: DatabaseZap,
  },
};

export function TransferEmptyState({
  variant = 'no-records',
  title,
  description,
  actionLabel,
  onAction,
}: TransferEmptyStateProps) {
  const content = variantContent[variant];
  const Icon = content.Icon;

  return (
    <section className="mif-transfer-empty" aria-live="polite">
      <span className="mif-transfer-empty__icon" aria-hidden="true">
        <Icon size={24} strokeWidth={1.75} />
      </span>
      <h2>{title ?? content.title}</h2>
      <p>{description ?? content.description}</p>
      {actionLabel && onAction ? (
        <button className="mif-button mif-button--primary" onClick={onAction} type="button">
          <Plus aria-hidden="true" size={17} strokeWidth={1.75} />
          {actionLabel}
        </button>
      ) : null}
    </section>
  );
}
