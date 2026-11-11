import {
  AutomationPermissionsConfig,
  ActionPermissionLevel,
  BusinessSettings,
  TeamMember,
} from './types';

export const HARD_LOCKED_APPROVAL_ACTIONS = [
  'return_refund',
  'exchange_replacement',
  'supplier_purchase',
  'payment_reversal',
  'policy_modification',
] as const;

export function getDefaultAutomationPermissions(): AutomationPermissionsConfig {
  return {
    order_confirmation: 'approval_required',
    delay_notification: 'automatic',
    return_refund: 'approval_required',
    exchange_replacement: 'approval_required',
    supplier_purchase: 'approval_required',
    payment_reversal: 'approval_required',
    policy_modification: 'approval_required',
  };
}

/**
 * Validates automation permissions and enforces hard safety locks.
 * Financial, exchange, refund, supplier PO, and policy actions CANNOT be set to 'automatic'.
 */
export function sanitizeAutomationPermissions(
  input?: Partial<AutomationPermissionsConfig>
): AutomationPermissionsConfig {
  const defaults = getDefaultAutomationPermissions();
  if (!input) return defaults;

  const sanitizeLocked = (
    val: unknown,
    fallback: 'approval_required' | 'disabled' = 'approval_required'
  ): 'approval_required' | 'disabled' => {
    if (val === 'disabled') return 'disabled';
    // Any attempt to set to 'automatic' or invalid is coerced to 'approval_required'
    return 'approval_required';
  };

  const sanitizeStandard = (
    val: unknown,
    fallback: ActionPermissionLevel = 'approval_required'
  ): ActionPermissionLevel => {
    if (val === 'automatic' || val === 'approval_required' || val === 'disabled') {
      return val;
    }
    return fallback;
  };

  return {
    order_confirmation: sanitizeStandard(input.order_confirmation, defaults.order_confirmation),
    delay_notification: sanitizeStandard(input.delay_notification, defaults.delay_notification),
    return_refund: sanitizeLocked(input.return_refund, 'approval_required'),
    exchange_replacement: sanitizeLocked(input.exchange_replacement, 'approval_required'),
    supplier_purchase: sanitizeLocked(input.supplier_purchase, 'approval_required'),
    payment_reversal: sanitizeLocked(input.payment_reversal, 'approval_required'),
    policy_modification: sanitizeLocked(input.policy_modification, 'approval_required'),
  };
}

/**
 * Server-side check for whether an action is executable automatically or requires human review
 */
export function checkActionExecution(
  settings: BusinessSettings,
  actionKey: keyof AutomationPermissionsConfig
): {
  allowed: boolean;
  requiresApproval: boolean;
  reason?: string;
} {
  const permissions = settings.permissions || getDefaultAutomationPermissions();
  const level = permissions[actionKey];

  if (level === 'disabled') {
    return {
      allowed: false,
      requiresApproval: false,
      reason: `Action '${actionKey}' is currently disabled in business automation permissions.`,
    };
  }

  // Check hard locks
  if (HARD_LOCKED_APPROVAL_ACTIONS.includes(actionKey as any)) {
    return {
      allowed: true,
      requiresApproval: true,
      reason: `Action '${actionKey}' involves financial or supplier operations and strictly requires owner/admin authorization.`,
    };
  }

  if (level === 'approval_required') {
    return {
      allowed: true,
      requiresApproval: true,
      reason: `Action '${actionKey}' is configured for mandatory human approval.`,
    };
  }

  return {
    allowed: true,
    requiresApproval: false,
  };
}

/**
 * Validates if an authenticated team member has permission to approve proposals
 */
export function canMemberApprove(member?: TeamMember | null): boolean {
  if (!member) return false;
  if (member.role === 'owner') return true;
  if (member.role === 'admin' && member.can_approve) return true;
  return false;
}
