import type { CaseKind, CaseStatus, CaseProposal } from './types.ts';

export function formatDate(
  dateString?: string | null,
  timeZone: string = 'Asia/Karachi'
): string {
  if (!dateString) return '—';
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return String(dateString);
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }).format(d);
  } catch {
    return String(dateString);
  }
}

export function formatRelativeTime(dateString?: string | null): string {
  if (!dateString) return '—';
  try {
    const d = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    if (diffMs < 0) return 'just now';
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDays = Math.floor(diffHr / 24);
    return `${diffDays}d ago`;
  } catch {
    return String(dateString);
  }
}

export function formatCurrency(amount?: number | null, currency: string = 'USD'): string {
  if (amount === undefined || amount === null || isNaN(amount)) {
    return '—';
  }
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount);
  } catch {
    return `${currency.toUpperCase()} ${amount.toFixed(2)}`;
  }
}

export function getKindDetails(kind: CaseKind | string) {
  switch (kind) {
    case 'order':
      return {
        label: 'Order Confirmation',
        badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
        iconName: 'ShoppingBag',
        description: 'Auto-verify stock & confirm customer order',
      };
    case 'return':
      return {
        label: 'Return / Refund',
        badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
        iconName: 'RotateCcw',
        description: 'Review return policy & process simulated refund',
      };
    case 'stock':
      return {
        label: 'Stock Shortage',
        badgeClass: 'bg-purple-50 text-purple-700 border-purple-200',
        iconName: 'PackageX',
        description: 'Analyze inventory shortfall & generate supplier PO',
      };
    case 'delivery':
      return {
        label: 'Delivery Escalation',
        badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200',
        iconName: 'Truck',
        description: 'Track delayed parcel & trigger courier escalation',
      };
    default:
      return {
        label: String(kind),
        badgeClass: 'bg-slate-50 text-slate-700 border-slate-200',
        iconName: 'HelpCircle',
        description: 'Operational case',
      };
  }
}

export function getStatusDetails(status: CaseStatus | string) {
  switch (status) {
    case 'pending_approval':
      return {
        label: 'Pending Approval',
        badgeClass: 'bg-amber-100 text-amber-800 border-amber-300 font-medium',
        dotClass: 'bg-amber-500',
      };
    case 'approved':
    case 'demo_completed':
    case 'completed':
      return {
        label: status === 'demo_completed' ? 'Simulated Complete' : 'Approved',
        badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-300 font-medium',
        dotClass: 'bg-emerald-500',
      };
    case 'rejected':
      return {
        label: 'Rejected',
        badgeClass: 'bg-rose-100 text-rose-800 border-rose-300 font-medium',
        dotClass: 'bg-rose-500',
      };
    case 'failed':
      return {
        label: 'Failed',
        badgeClass: 'bg-red-100 text-red-800 border-red-300 font-medium',
        dotClass: 'bg-red-500',
      };
    default:
      return {
        label: String(status).replace(/_/g, ' '),
        badgeClass: 'bg-slate-100 text-slate-800 border-slate-300 font-medium',
        dotClass: 'bg-slate-500',
      };
  }
}

export function humanizeProposal(proposal?: CaseProposal | null): {
  headline: string;
  summary: string;
  keyMetric?: { label: string; value: string };
  actions: string[];
} {
  if (!proposal || Object.keys(proposal).length === 0) {
    return {
      headline: 'Standard automated proposal',
      summary: 'No specific structured proposal details provided.',
      actions: ['Review case context before proceeding'],
    };
  }

  const actionType = proposal.action || proposal.type || '';
  const summary = proposal.summary || proposal.reason || '';

  if (actionType.toLowerCase().includes('refund') || proposal.amount !== undefined) {
    const currency = proposal.currency || 'USD';
    const amountStr = proposal.amount !== undefined ? formatCurrency(proposal.amount, currency) : undefined;
    return {
      headline: 'Process Refund Proposal',
      summary: summary || `Issue ${amountStr ? amountStr + ' ' : ''}simulated refund to customer.`,
      keyMetric: amountStr ? { label: 'Proposed Refund', value: amountStr } : undefined,
      actions: [
        'Simulate credit note in billing system',
        'Queue notification email draft',
        'Mark order return status as approved',
      ],
    };
  }

  if (proposal.items && proposal.items.length > 0) {
    const totalShortfall = proposal.items.reduce((acc, i) => acc + (i.shortfall || i.qty || 0), 0);
    return {
      headline: 'Supplier Restock Order',
      summary: summary || `Generate simulated purchase order for ${totalShortfall} short items.`,
      keyMetric: { label: 'Total Units Short', value: `${totalShortfall} units` },
      actions: [
        'Generate simulated supplier purchase requisition',
        'Update estimated stock replenishment ETA',
        'Notify inventory manager',
      ],
    };
  }

  if (actionType.toLowerCase().includes('delivery') || proposal.escalation_level) {
    return {
      headline: 'Courier Delay Escalation',
      summary: summary || 'Escalate delayed shipment with logistics courier partner.',
      keyMetric: proposal.escalation_level
        ? { label: 'Escalation Level', value: String(proposal.escalation_level).toUpperCase() }
        : undefined,
      actions: [
        'Transmit priority status ping to carrier API',
        'Generate customer delivery update notification draft',
        'Flag in dispatch watch-list',
      ],
    };
  }

  return {
    headline: proposal.action ? `Action: ${proposal.action}` : 'Operations Action Proposal',
    summary: summary || 'Execute simulated operational step according to e-commerce policies.',
    actions: ['Proceed with verified demo workflow step'],
  };
}
