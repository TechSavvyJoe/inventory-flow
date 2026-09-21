import {
  BadgeCheck,
  BriefcaseBusiness,
  ClipboardCheck,
  Globe2,
  MailCheck,
  Route,
  Truck,
} from 'lucide-react';
import type { TransferStatusLanes as TransferStatusLanesValue } from './types';
import { humanizeStatusLabel, toneClass } from './presentation';

export interface TransferStatusLanesProps {
  status: TransferStatusLanesValue;
  compact?: boolean;
  kind?: 'operational' | 'technical' | 'all';
}

const laneDefinitions = [
  { key: 'request', label: 'Request', Icon: ClipboardCheck },
  { key: 'movement', label: 'Movement / custody', Icon: Route },
  { key: 'deal', label: 'Customer / deal', Icon: BriefcaseBusiness },
  { key: 'delivery', label: 'Delivery', Icon: BadgeCheck },
  { key: 'dealerMail', label: 'Hold list', Icon: MailCheck },
  { key: 'publicListing', label: 'Website listing', Icon: Globe2 },
  { key: 'dealerOnInStock', label: 'At dealership', Icon: Truck },
  { key: 'dealerOnInTransit', label: 'In transit', Icon: Truck },
  { key: 'dealerOnInProduction', label: 'In production', Icon: Truck },
  { key: 'cdk', label: 'CDK', Icon: Truck },
] as const;

const technicalKeys = new Set(['publicListing', 'dealerOnInStock', 'dealerOnInTransit', 'dealerOnInProduction', 'cdk']);

export function TransferStatusLanes({ status, compact = false, kind = 'operational' }: TransferStatusLanesProps) {
  const visibleLanes = laneDefinitions.filter(({ key }) => {
    if (kind === 'all') return true;
    return kind === 'technical' ? technicalKeys.has(key) : !technicalKeys.has(key);
  });
  return (
    <dl className={`mif-status-lanes${compact ? ' mif-status-lanes--compact' : ''}`}>
      {visibleLanes.map(({ key, label, Icon }) => {
        const value = status[key];
        if (!value) return null;
        return (
          <div
            className="mif-status-lane"
            data-status-code={value.code}
            data-status-lane={key}
            data-status-tone={value.tone ?? 'neutral'}
            key={key}
          >
            <dt>
              <Icon aria-hidden="true" size={16} strokeWidth={1.75} />
              {label}
            </dt>
            <dd>
              <span className={`mif-status-value ${toneClass(value.tone)}`}>
                {humanizeStatusLabel(value.label)}
              </span>
              {value.detail ? <span className="mif-status-detail">{value.detail}</span> : null}
              {value.stale ? <span className="mif-source-stale">Stale source</span> : null}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
