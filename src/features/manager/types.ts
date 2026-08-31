import type {
  DealerMailHoldCode,
  MovementStatusCode,
  PublicStatusCode,
  RequestStatusCode,
  SlaState,
  StoreName,
  TransferDetail,
} from '../transfers/types';

export interface GroupOperationRecord extends TransferDetail {
  salespersonLabel?: string;
}

export type ManagerDueWindow =
  | 'all'
  | 'today'
  | 'next-2-days'
  | 'next-7-days'
  | 'overdue'
  | 'no-due';

export interface ManagerFilters {
  query: string;
  homeStores: StoreName[];
  currentLocations: string[];
  requestingStores: StoreName[];
  requestStatuses: RequestStatusCode[];
  movementStatuses: MovementStatusCode[];
  dealerMailStatuses: DealerMailHoldCode[];
  publicStatuses: PublicStatusCode[];
  priorities: Array<'low' | 'normal' | 'high' | 'critical'>;
  custodians: string[];
  salespeople: string[];
  slaStates: SlaState[];
  nextActionOwnerIds: string[];
  dueWindow: ManagerDueWindow;
  exceptionOnly: boolean;
}

export type ManagerSortField =
  | 'sla'
  | 'dueAt'
  | 'priority'
  | 'vehicle'
  | 'homeStore'
  | 'currentLocation'
  | 'requestingStore'
  | 'movementStage'
  | 'lastConfirmedAt';

export interface ManagerSortRule {
  field: ManagerSortField;
  direction: 'asc' | 'desc';
}

export interface SavedManagerView {
  id: string;
  name: string;
  filters: Partial<ManagerFilters>;
  sortRules?: ManagerSortRule[];
}

export interface StoreFilterOption {
  value: StoreName;
  label: string;
}

export const emptyManagerFilters: ManagerFilters = {
  query: '',
  homeStores: [],
  currentLocations: [],
  requestingStores: [],
  requestStatuses: [],
  movementStatuses: [],
  dealerMailStatuses: [],
  publicStatuses: [],
  priorities: [],
  custodians: [],
  salespeople: [],
  slaStates: [],
  nextActionOwnerIds: [],
  dueWindow: 'all',
  exceptionOnly: false,
};
