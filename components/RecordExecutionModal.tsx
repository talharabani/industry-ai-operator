'use client';

import React, { useState } from 'react';
import {
  X,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ShieldCheck,
  Package,
  DollarSign,
  FileText,
} from 'lucide-react';

interface RecordExecutionModalProps {
  isOpen: boolean;
  onClose: () => void;
  issueId: string;
  taskId: string;
  taskTitle: string;
  actionType?: string;
  actionDetails?: {
    amount?: number;
    currency?: string;
    reason?: string;
    items?: unknown[];
    replacement_size?: string;
    [key: string]: unknown;
  };
  customerName?: string;
  orderRef?: string;
  onSuccess?: () => void;
}

export function RecordExecutionModal({
  isOpen,
  onClose,
  issueId,
  taskId,
  taskTitle,
  actionType = 'action',
  actionDetails,
  customerName,
  orderRef,
  onSuccess,
}: RecordExecutionModalProps) {
  const [executionRef, setExecutionRef] = useState('');
  const [evidenceNotes, setEvidenceNotes] = useState('');
  const [completedAt, setCompletedAt] = useState(new Date().toISOString());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!executionRef.trim()) {
      setError('Execution reference is required (e.g. Shopify refund ID, transaction code, or admin note).');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/order-issues/${encodeURIComponent(issueId)}/tasks/${encodeURIComponent(taskId)}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          execution_reference: executionRef.trim(),
          evidence: evidenceNotes.trim() || undefined,
          completed_at: completedAt,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Execution recording failed (HTTP ${res.status})`);
      }

      if (onSuccess) onSuccess();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to record manual execution');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl max-w-lg w-full border border-slate-200 shadow-xl overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-violet-50 text-violet-700 border border-violet-200 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Record Manual Execution</h3>
              <p className="text-[11px] text-slate-500">Owner-reported completion flow</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2.5 text-xs text-rose-800">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Context Card */}
          <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold text-slate-900">{taskTitle}</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-violet-100 text-violet-800 border border-violet-200">
                Approved — awaiting execution
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-slate-600 text-[11px]">
              {orderRef && <span>Order: <strong>{orderRef}</strong></span>}
              {customerName && <span>Customer: <strong>{customerName}</strong></span>}
              {actionDetails?.amount && (
                <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                  <DollarSign className="w-3 h-3" />
                  {actionDetails.amount} {actionDetails.currency || 'USD'}
                </span>
              )}
            </div>
          </div>

          {/* Execution Reference Field (Required) */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-800">
              Execution Reference / Transaction ID <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Shopify Refund #c728392 or POS-REF-9921"
              value={executionRef}
              onChange={(e) => setExecutionRef(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-hidden text-slate-900 bg-white"
            />
            <p className="text-[11px] text-slate-400">
              Enter the unique reference code from Shopify Admin or your payment processor.
            </p>
          </div>

          {/* Evidence / Notes (Optional) */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-700">
              Evidence Notes (Optional)
            </label>
            <textarea
              rows={2}
              placeholder="e.g. Refund issued back to original Visa card via Shopify Payments."
              value={evidenceNotes}
              onChange={(e) => setEvidenceNotes(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-hidden text-slate-900 bg-white"
            />
          </div>

          {/* Verification Disclosure */}
          <div className="p-3 bg-amber-50 rounded-xl border border-amber-200/80 text-[11px] text-amber-800 flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <span>
              <strong>Owner-reported completion:</strong> Shopify financial mutations are not executed automatically. This records your manual completion in the audit trail. Read-only Shopify order verification is used; write scopes are not requested. Other outstanding tasks remain active.
            </span>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
            <button
              type="button"
              disabled={submitting}
              onClick={onClose}
              className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !executionRef.trim()}
              className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-xl shadow-xs transition-colors cursor-pointer flex items-center gap-1.5"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Recording...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Record Execution</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
