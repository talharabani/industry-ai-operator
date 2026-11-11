export interface OutboundValidationParams {
  tenantId: string;
  senderEmail: string;
  recipientEmail: string;
  isAutomated?: boolean;
  approvalStatus?: string;
  pilotWhitelist?: {
    authorized_sender?: string;
    authorized_recipient?: string;
  } | null;
  automationMode?: 'auto_routine' | 'draft_only' | 'paused';
}

export interface OutboundValidationResult {
  allowed: boolean;
  blocked: boolean;
  reason: string;
  action: 'allow' | 'block' | 'draft_required';
}

/**
 * Centralized, fail-closed security guard for ALL outbound message dispatches.
 * Enforces pilot whitelists, recipient boundaries, and explicit approval locks across
 * manual sending, Gmail sync auto-replies, and scheduled workers.
 */
export function validateOutboundDispatch(params: OutboundValidationParams): OutboundValidationResult {
  const {
    tenantId,
    senderEmail,
    recipientEmail,
    isAutomated = false,
    approvalStatus = 'none',
    pilotWhitelist,
    automationMode = 'auto_routine',
  } = params;

  const cleanSender = (senderEmail || '').trim().toLowerCase();
  const cleanRecipient = (recipientEmail || '').trim().toLowerCase();

  // 1. Automation Paused Guard
  if (automationMode === 'paused' && isAutomated) {
    return {
      allowed: false,
      blocked: true,
      action: 'block',
      reason: `Automation is paused for workspace '${tenantId}'. Automated outbound dispatch is blocked.`,
    };
  }

  // 2. Controlled Sandbox / Pilot Whitelist Check
  const isSandboxAlpha = tenantId === 'sandbox-services-alpha';
  const hasTenantWhitelist = Boolean(
    pilotWhitelist?.authorized_sender || pilotWhitelist?.authorized_recipient
  );

  if (hasTenantWhitelist || isSandboxAlpha) {
    // Derive whitelist from trusted tenant configuration; fallback to Alpha defaults only for sandbox-services-alpha
    const authorizedSender = isSandboxAlpha
      ? (pilotWhitelist?.authorized_sender || process.env.AUTHORIZED_GMAIL_SENDER || 'talhaishaqrabani9490@gmail.com').trim().toLowerCase()
      : pilotWhitelist?.authorized_sender?.trim().toLowerCase();

    const authorizedRecipient = isSandboxAlpha
      ? (pilotWhitelist?.authorized_recipient || process.env.AUTHORIZED_TEST_RECIPIENT || 'mukaramajeed28094@gmail.com').trim().toLowerCase()
      : pilotWhitelist?.authorized_recipient?.trim().toLowerCase();

    // Check sender mailbox if configured for this tenant
    if (authorizedSender && cleanSender && cleanSender !== authorizedSender) {
      return {
        allowed: false,
        blocked: true,
        action: 'block',
        reason: `Controlled Pilot Security Guard: Sender mailbox '${cleanSender}' is not the authorized pilot sender '${authorizedSender}' for tenant '${tenantId}'. Dispatch blocked fail-closed.`,
      };
    }

    // Check recipient mailbox if configured for this tenant
    if (authorizedRecipient && cleanRecipient && cleanRecipient !== authorizedRecipient) {
      return {
        allowed: false,
        blocked: true,
        action: 'block',
        reason: `Controlled Pilot Security Guard: Recipient '${cleanRecipient}' is off-whitelist. Permitted pilot recipient for tenant '${tenantId}' is '${authorizedRecipient}'. Live dispatch blocked fail-closed.`,
      };
    }

    // 3. Mandatory Human Approval Requirement for Sandbox Alpha & Draft-Only workspaces
    if (isSandboxAlpha || automationMode === 'draft_only') {
      if (isAutomated || approvalStatus !== 'approved') {
        return {
          allowed: false,
          blocked: false,
          action: 'draft_required',
          reason: `Controlled Pilot Security Guard: Workspace '${tenantId}' requires explicit owner approval for all outbound messages. Automated live sending is prohibited; message must be saved as draft.`,
        };
      }
    }
  }

  // General draft_only mode check
  if (automationMode === 'draft_only' && (isAutomated || approvalStatus !== 'approved')) {
    return {
      allowed: false,
      blocked: false,
      action: 'draft_required',
      reason: `Workspace '${tenantId}' is configured in draft_only mode. Live dispatch requires human approval.`,
    };
  }

  // 4. Null / Unconfigured Whitelist Guard:
  // A null whitelist MUST NOT permit unrestricted automatic sending.
  // In any new or unconfigured workspace, automated live dispatch strictly requires explicit owner review/approval.
  if (!hasTenantWhitelist && isAutomated && approvalStatus !== 'approved') {
    return {
      allowed: false,
      blocked: false,
      action: 'draft_required',
      reason: `Outbound Safeguard: Workspace '${tenantId}' has no active recipient whitelist configured. Unrestricted automatic outbound sending is disallowed; message requires owner review.`,
    };
  }

  return {
    allowed: true,
    blocked: false,
    action: 'allow',
    reason: 'Outbound dispatch authorized.',
  };
}
