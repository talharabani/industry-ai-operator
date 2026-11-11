'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { AppLayout } from '@/components/AppLayout';
import { KindBadge } from '@/components/KindBadge';
import { ApprovalModal } from '@/components/ApprovalModal';
import { CaseRecord } from '@/lib/types';
import { formatDate, humanizeProposal } from '@/lib/utils';
import {
  CheckCircle2,
  XCircle,
  Clock,
  ShieldCheck,
  Loader2,
  AlertTriangle,
  ArrowRight,
  Sparkles,
  Inbox,
  Package,
} from 'lucide-react';

export default function ApprovalsPage() {
  const [pendingCases, setPendingCases] = useState<CaseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCase, setSelectedCase] = useState<{
    caseData: CaseRecord;
    type: 'approve' | 'reject';
  } | null>(null);

  const fetchPending = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/cases?status=pending_approval&limit=50', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setPendingCases(data.cases || []);
      }
    } catch (err) {
      console.error('Failed to load pending cases:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchPending();
  }, [fetchPending]);

  return (
    <AppLayout onRefresh={fetchPending} isRefreshing={refreshing}>
      <div className="space-y-6 max-w-5xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">
                Approvals Queue
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200">
                {pendingCases.length} Awaiting Review
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1 max-w-2xl">
              Requests for refunds, size exchanges, cancellations, and custom actions are held here for your authorization. Routine inquiries are handled automatically.
            </p>
          </div>

          <Link
            href="/inbox"
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors shrink-0 self-start sm:self-center"
          >
            <Inbox className="w-3.5 h-3.5" />
            <span>Open Inbox</span>
          </Link>
        </div>

        {/* Content list */}
        {loading ? (
          <div className="bg-white p-16 rounded-2xl border border-slate-200 text-center space-y-2 text-xs text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin text-indigo-600 mx-auto" />
            <span>Loading pending approval requests...</span>
          </div>
        ) : pendingCases.length === 0 ? (
          <div className="bg-white p-16 rounded-2xl border border-slate-200 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <h2 className="text-base font-bold text-slate-900">All Clear! No Pending Approvals</h2>
            <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
              There are no customer requests awaiting your decision right now. When a customer requests a refund or exchange, it will appear here immediately for your authorization.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {pendingCases.map((c) => {
              const humanized = humanizeProposal(c.proposal);
              const orderId =
                (c.payload?.order_id as string) ||
                (c.payload?.orderId as string) ||
                '—';
              const customerEmail =
                (c.payload?.customer_email as string) ||
                (c.payload?.customerEmail as string) ||
                'Customer';
              const customerMsg =
                (c.payload?.message as string) ||
                (c.payload?.customer_message as string) ||
                null;

              const isRefundOrExchange =
                c.kind === 'return' ||
                c.kind === 'stock' ||
                Boolean(c.proposal?.amount) ||
                String(c.proposal?.action || '').includes('refund');

              return (
                <div
                  key={c.case_id}
                  className="bg-white rounded-2xl border border-slate-200 hover:border-slate-300 shadow-xs p-5 sm:p-6 transition-all space-y-4"
                >
                  {/* Case Top Bar */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <KindBadge kind={c.kind} />
                      <span className="text-xs font-bold text-slate-900">
                        {humanized.headline}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
                      <span>Order: <strong className="text-slate-700">{orderId}</strong></span>
                      <span>•</span>
                      <span>{formatDate(c.created_at)}</span>
                    </div>
                  </div>

                  {/* Customer message snippet if available */}
                  {customerMsg && (
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 text-xs">
                      <span className="font-semibold text-slate-500 text-[11px] block mb-0.5">
                        Customer Request:
                      </span>
                      <p className="text-slate-800 italic">"{customerMsg}"</p>
                      <span className="text-[10px] text-slate-400 block mt-1">From: {customerEmail}</span>
                    </div>
                  )}

                  {/* Proposal Summary Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="md:col-span-2 space-y-2">
                      <div className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                        Proposed AI Action & Draft
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        {humanized.summary}
                      </p>

                      {/* Safety reason */}
                      <div className="pt-2 flex items-center gap-2 text-xs text-amber-800 font-medium">
                        <ShieldCheck className="w-4 h-4 text-amber-600 shrink-0" />
                        <span>
                          Why approval is needed: {isRefundOrExchange ? 'Financial refund and exchange requests require owner sign-off before dispatch.' : 'Custom response review requested.'}
                        </span>
                      </div>
                    </div>

                    {/* Key metric / action badge */}
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col justify-between space-y-2">
                      <div className="text-xs text-slate-500 font-medium">
                        {humanized.keyMetric?.label || 'Action Type'}
                      </div>
                      <div className="text-lg font-bold text-slate-900">
                        {humanized.keyMetric?.value || humanized.headline}
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono">
                        Case: {c.case_id}
                      </div>
                    </div>
                  </div>

                  {/* Action Controls */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100">
                    <div className="text-xs text-slate-500">
                      {isRefundOrExchange
                        ? 'Authorizing will confirm the decision and send the response email.'
                        : 'Approving will send the draft email to the customer.'}
                    </div>

                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => setSelectedCase({ caseData: c, type: 'reject' })}
                        className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedCase({ caseData: c, type: 'approve' })}
                        className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-xs transition-colors cursor-pointer flex items-center gap-1.5"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>
                          {isRefundOrExchange ? 'Authorize Action' : 'Approve & Send'}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Decision Modal */}
      {selectedCase && (
        <ApprovalModal
          isOpen={true}
          caseData={selectedCase.caseData}
          decisionType={selectedCase.type}
          onClose={() => setSelectedCase(null)}
          onDecisionComplete={() => {
            setSelectedCase(null);
            fetchPending();
          }}
        />
      )}
    </AppLayout>
  );
}
