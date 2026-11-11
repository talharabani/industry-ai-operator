'use client';

import React, { useState } from 'react';
import { CaseRecord } from '@/lib/types';
import { humanizeProposal } from '@/lib/utils';
import {
  X,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  ShieldCheck,
  RotateCcw,
  Store,
  DollarSign,
  Package,
  Mail,
} from 'lucide-react';

interface ApprovalModalProps {
  caseData: CaseRecord;
  decisionType: 'approve' | 'reject';
  isOpen: boolean;
  onClose: () => void;
  onDecisionComplete?: () => void;
  onSuccess?: (updatedRevision: number, status: string) => void;
  onConflictRefresh?: () => void;
}

export function ApprovalModal({
  caseData,
  decisionType,
  isOpen,
  onClose,
  onDecisionComplete,
  onSuccess,
  onConflictRefresh,
}: ApprovalModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflictOccurred, setConflictOccurred] = useState(false);

  if (!isOpen) return null;

  const isApprove = decisionType === 'approve';
  const humanized = humanizeProposal(caseData.proposal);
  const orderId = (caseData.payload?.order_id as string) || (caseData.payload?.orderId as string) || '—';
  const customerEmail = (caseData.payload?.customer_email as string) || (caseData.payload?.customerEmail as string) || 'Customer';
  const customerMsg = (caseData.payload?.message as string) || (caseData.payload?.customer_message as string) || null;

  const isFinancialAction =
    caseData.kind === 'return' ||
    caseData.kind === 'stock' ||
    Boolean(caseData.proposal?.amount) ||
    String(caseData.proposal?.action || '').includes('refund') ||
    String(caseData.proposal?.action || '').includes('exchange');

  const handleDecision = async () => {
    setSubmitting(true);
    setError(null);
    setConflictOccurred(false);

    try {
      const res = await fetch(`/api/cases/${caseData.case_id}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: decisionType,
          expected_revision: caseData.revision,
          proposal: caseData.proposal,
        }),
      });

      let data: Record<string, unknown> = {};
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        data = await res.json().catch(() => ({}));
      } else {
        const text = await res.text();
        try {
          data = JSON.parse(text);
        } catch {
          data = {
            error: text.trim().startsWith('<')
              ? `Server returned HTTP ${res.status}. Please check server logs for details.`
              : (text.slice(0, 200) || `Server returned HTTP ${res.status}`),
          };
        }
      }

      if (res.status === 409) {
        setConflictOccurred(true);
        setError(
          (data.error as string) ||
            'Revision Conflict (HTTP 409): The proposal was updated by another process. Please refresh and review before deciding.'
        );
        return;
      }

      if (!res.ok) {
        throw new Error(
          (data.error as string) ||
            (data.message as string) ||
            `Decision failed with HTTP ${res.status}`
        );
      }

      if (onSuccess) {
        onSuccess(
          (data.revision as number) || caseData.revision + 1,
          (data.status as string) || 'demo_completed'
        );
      }
      if (onDecisionComplete) {
        onDecisionComplete();
      }
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to submit decision';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="relative bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-5 bg-white border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                isApprove
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'bg-rose-50 text-rose-700 border border-rose-200'
              }`}
            >
              {isApprove ? (
                <CheckCircle2 className="w-5 h-5" />
              ) : (
                <XCircle className="w-5 h-5" />
              )}
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                {isApprove
                  ? isFinancialAction
                    ? 'Authorize Major Action & Reply'
                    : 'Approve & Send Draft Reply'
                  : 'Reject Proposed Action'}
              </h3>
              <p className="text-xs text-slate-500">
                Target Order: <strong className="text-slate-700">{orderId}</strong>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {error && (
            <div
              className={`p-3.5 rounded-xl text-xs flex items-start gap-2.5 ${
                conflictOccurred
                  ? 'bg-amber-50 border border-amber-300 text-amber-900'
                  : 'bg-rose-50 border border-rose-200 text-rose-800'
              }`}
            >
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1.5">
                <span className="font-semibold block">Notice</span>
                <p className="leading-relaxed">{error}</p>
                {conflictOccurred && onConflictRefresh && (
                  <button
                    type="button"
                    onClick={() => {
                      onConflictRefresh();
                      onClose();
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-semibold hover:bg-amber-700 transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Refresh Updated Proposal</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Customer Request Details */}
          {customerMsg && (
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                Customer Message
              </span>
              <p className="text-xs text-slate-700 italic">"{customerMsg}"</p>
              <div className="text-[11px] text-slate-400 pt-0.5">From: {customerEmail}</div>
            </div>
          )}

          {/* Proposal Summary Card */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Proposed Action & Response
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                Owner Review Required
              </span>
            </div>

            <div className="text-sm font-bold text-slate-900">{humanized.headline}</div>
            <p className="text-xs text-slate-600 leading-relaxed">{humanized.summary}</p>

            {humanized.keyMetric && (
              <div className="flex items-center justify-between pt-2 border-t border-slate-200 text-xs">
                <span className="text-slate-500 font-medium">{humanized.keyMetric.label}:</span>
                <span className="text-sm font-bold text-slate-900">{humanized.keyMetric.value}</span>
              </div>
            )}
          </div>

          {/* Why Approval is Required */}
          <div className="p-3.5 bg-amber-50/70 border border-amber-200 rounded-xl flex items-start gap-2.5 text-xs text-amber-900">
            <ShieldCheck className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <span className="leading-relaxed">
              <strong>Why approval is needed:</strong>{' '}
              {isFinancialAction
                ? 'Store safety policy locks all refunds, exchanges, and payment reversals to human owner authorization to prevent unauthorized money transfers.'
                : 'This proposed reply was held for your verification before sending to the customer.'}
            </span>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDecision}
              disabled={submitting || conflictOccurred}
              className={`inline-flex items-center gap-1.5 px-4 py-2 text-white rounded-xl text-xs font-semibold shadow-xs disabled:opacity-50 transition-all cursor-pointer ${
                isApprove
                  ? 'bg-indigo-600 hover:bg-indigo-700'
                  : 'bg-rose-600 hover:bg-rose-700'
              }`}
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Processing...</span>
                </>
              ) : (
                <span>
                  {isApprove
                    ? isFinancialAction
                      ? 'Authorize Action'
                      : 'Approve & Send Reply'
                    : 'Reject Proposal'}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
