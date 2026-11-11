'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import { AppLayout } from '@/components/AppLayout';
import { KindBadge } from '@/components/KindBadge';
import { StatusBadge } from '@/components/StatusBadge';
import { ApprovalModal } from '@/components/ApprovalModal';
import { CaseRecord, OrderRecord, AuditRecord } from '@/lib/types';
import { formatDate, humanizeProposal, formatCurrency } from '@/lib/utils';
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Sparkles,
  User,
  ShoppingBag,
  Clock,
  Activity,
  Package,
  Loader2,
  FileCode,
  ShieldCheck,
  AlertCircle,
  Copy,
  Check,
} from 'lucide-react';

export default function CaseDetailPage() {
  const params = useParams();
  const caseId = typeof params?.id === 'string' ? params.id : Array.isArray(params?.id) ? params.id[0] : '';
  const router = useRouter();

  const [caseData, setCaseData] = useState<CaseRecord | null>(null);
  const [orderData, setOrderData] = useState<OrderRecord | null>(null);
  const [auditTrail, setAuditTrail] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decisionModal, setDecisionModal] = useState<'approve' | 'reject' | null>(null);
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [inlineDraft, setInlineDraft] = useState<string | null>(null);
  const [copiedDraft, setCopiedDraft] = useState(false);

  const fetchCaseDetails = useCallback(async () => {
    try {
      const res = await fetch(`/api/cases/${caseId}`);
      if (!res.ok) {
        throw new Error(res.status === 404 ? `Case ${caseId} not found` : 'Failed to load case');
      }
      const data = await res.json();
      setCaseData(data.case);
      setOrderData(data.order);
      setAuditTrail(data.audit || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/cases/${caseId}`);
        if (!res.ok) {
          throw new Error(res.status === 404 ? `Case ${caseId} not found` : 'Failed to load case');
        }
        if (active) {
          const data = await res.json();
          setCaseData(data.case);
          setOrderData(data.order);
          setAuditTrail(data.audit || []);
        }
      } catch (err: unknown) {
        if (active) setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [caseId]);

  const handleGenerateDraft = async () => {
    if (!caseData) return;
    setGeneratingDraft(true);
    try {
      const res = await fetch(`/api/cases/${caseData.case_id}/draft`, {
        method: 'POST',
      });
      const data = await res.json();
      if (res.ok && data.draft) {
        setInlineDraft(data.draft);
      } else {
        setError(data.error || 'Failed to generate customer draft via n8n');
      }
    } catch {
      setError('Network failure generating draft');
    } finally {
      setGeneratingDraft(false);
    }
  };

  const copyToClipboard = () => {
    if (!inlineDraft) return;
    navigator.clipboard.writeText(inlineDraft);
    setCopiedDraft(true);
    setTimeout(() => setCopiedDraft(false), 2000);
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="p-20 flex flex-col items-center justify-center gap-3 text-xs text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
          <span>Loading case and audit stream...</span>
        </div>
      </AppLayout>
    );
  }

  if (error || !caseData) {
    return (
      <AppLayout>
        <div className="bg-white p-8 rounded-2xl border border-slate-200 text-center space-y-4 max-w-lg mx-auto">
          <AlertCircle className="w-10 h-10 text-rose-500 mx-auto" />
          <h2 className="text-base font-semibold text-slate-900">Case Not Found</h2>
          <p className="text-xs text-slate-500">{error || 'The requested case could not be retrieved.'}</p>
          <button
            onClick={() => router.push('/cases')}
            className="px-4 py-2 bg-slate-900 text-white rounded-lg text-xs font-medium"
          >
            Back to Cases List
          </button>
        </div>
      </AppLayout>
    );
  }

  const humanized = humanizeProposal(caseData.proposal);
  const isPending = caseData.status === 'pending_approval';

  return (
    <AppLayout onRefresh={fetchCaseDetails}>
      <div className="space-y-6">
        {/* Top Breadcrumb & Actions Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/cases"
              className="p-2 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
              title="Back to Cases"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-lg font-bold font-mono text-slate-900">{caseData.case_id}</h1>
                <KindBadge kind={caseData.kind} />
                <StatusBadge status={caseData.status} />
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                <span>Created {formatDate(caseData.created_at)}</span>
                <span>•</span>
                <span className="font-mono">Rev {caseData.revision}</span>
                <span>•</span>
                <span className="font-mono text-slate-400">Req ID: {caseData.request_id}</span>
              </div>
            </div>
          </div>

          {/* Action Buttons for Pending Cases */}
          {isPending && (
            <div className="flex items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={() => setDecisionModal('reject')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 rounded-lg transition-colors cursor-pointer"
              >
                <XCircle className="w-4 h-4 text-rose-600" />
                <span>Reject Proposal</span>
              </button>
              <button
                type="button"
                onClick={() => setDecisionModal('approve')}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-xs transition-colors cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Approve Proposal</span>
              </button>
            </div>
          )}
        </div>

        {/* 2-Column Grid for Details */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Proposal & Order Column (2 Cols) */}
          <div className="lg:col-span-2 space-y-6">
            {/* Exact AI Proposal Box */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="p-5 border-b border-slate-200 bg-gradient-to-r from-blue-50/50 to-white flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">Proposed Action</h2>
                    <p className="text-[11px] text-slate-500">Autonomous workflow assessment</p>
                  </div>
                </div>
                <span className="text-[11px] font-mono text-slate-600 bg-white px-2.5 py-1 rounded-md border border-slate-200">
                  Revision {caseData.revision}
                </span>
              </div>

              <div className="p-6 space-y-5">
                <div>
                  <h3 className="text-base font-bold text-slate-900 mb-1">{humanized.headline}</h3>
                  <p className="text-xs text-slate-600 leading-relaxed">{humanized.summary}</p>
                </div>

                {humanized.keyMetric && (
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-600">{humanized.keyMetric.label}</span>
                    <span className="text-base font-bold text-slate-900">{humanized.keyMetric.value}</span>
                  </div>
                )}

                {/* Workflow actions planned */}
                <div>
                  <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider block mb-2">
                    Action Checklist
                  </span>
                  <ul className="space-y-2">
                    {humanized.actions.map((act, i) => (
                      <li key={i} className="text-xs text-slate-600 flex items-center gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                        <span>{act}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Simulation Notice */}
                <div className="p-3 bg-blue-50/50 border border-blue-200 rounded-xl flex items-start gap-2 text-xs text-blue-900">
                  <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                  <span>
                    Simulated execution sandbox: No actual banking transactions or supplier dispatches occur in this demo.
                  </span>
                </div>
              </div>
            </div>

            {/* Target Order & Customer Context */}
            {orderData ? (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2">
                    <ShoppingBag className="w-4 h-4 text-slate-600" />
                    <h3 className="text-sm font-semibold text-slate-900">
                      Order Reference: {orderData.order_id}
                    </h3>
                  </div>
                  <span className="text-xs font-mono font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                    Status: {orderData.data?.status || 'Processing'}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div className="space-y-1">
                    <span className="text-slate-500 block font-medium">Customer:</span>
                    <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-slate-400" />
                      <span>{orderData.data?.customer?.name || 'Alice Smith'}</span>
                    </div>
                    <div className="text-slate-500">{orderData.data?.customer?.email || 'customer@example.com'}</div>
                  </div>

                  <div className="space-y-1">
                    <span className="text-slate-500 block font-medium">Order Total:</span>
                    <div className="text-sm font-bold text-slate-900">
                      {formatCurrency(orderData.data?.total_amount, orderData.data?.currency || 'USD')}
                    </div>
                    <div className="text-slate-400">Order ID: {orderData.order_id}</div>
                  </div>
                </div>

                {orderData.data?.items && (
                  <div className="pt-2">
                    <span className="text-xs font-semibold text-slate-700 block mb-2">Order Line Items</span>
                    <div className="space-y-1.5">
                      {orderData.data.items.map((it, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-2.5 bg-slate-50 rounded-lg text-xs"
                        >
                          <div className="flex items-center gap-2">
                            <Package className="w-3.5 h-3.5 text-slate-400" />
                            <span className="font-medium text-slate-800">{it.name}</span>
                            <span className="text-[11px] font-mono text-slate-400">({it.sku})</span>
                          </div>
                          <div className="font-semibold text-slate-900">
                            x{it.qty} • {formatCurrency(it.price, it.currency || orderData.currency || orderData.data?.currency || 'USD')}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 space-y-3">
                <div className="flex items-center gap-2 text-slate-700 font-semibold text-sm">
                  <ShoppingBag className="w-4 h-4 text-slate-500" />
                  <span>Order Context (Payload Reference)</span>
                </div>
                <div className="text-xs text-slate-600 bg-slate-50 p-3 rounded-lg font-mono">
                  Order ID: {String(caseData.payload?.order_id || caseData.payload?.orderId || 'ORD-1001')}
                </div>
              </div>
            )}

            {/* AI Customer Reply Draft Generator Card */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-blue-600" />
                  <h3 className="text-sm font-semibold text-slate-900">AI Customer Reply Draft</h3>
                </div>
                <span className="text-[11px] font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                  Groq LLM via n8n
                </span>
              </div>

              <p className="text-xs text-slate-500">
                Generate an intelligent, store-tone-compliant reply draft for this case without sending any external message.
              </p>

              {inlineDraft ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-700">Generated Draft (Session Preview):</span>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-semibold">
                        Requires Review
                      </span>
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-semibold">
                        Not Sent
                      </span>
                    </div>
                  </div>

                  <textarea
                    rows={5}
                    value={inlineDraft}
                    onChange={(e) => setInlineDraft(e.target.value)}
                    className="w-full p-3 bg-slate-50 border border-slate-300 rounded-xl text-xs font-sans text-slate-900 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 leading-relaxed"
                  />

                  <div className="flex items-center justify-between pt-2">
                    <button
                      type="button"
                      onClick={handleGenerateDraft}
                      disabled={generatingDraft}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-100 hover:text-blue-600 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {generatingDraft ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                          <span>Regenerating...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5 text-blue-500" />
                          <span>Regenerate Draft</span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={copyToClipboard}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-800 transition-colors cursor-pointer shadow-2xs"
                    >
                      {copiedDraft ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Copied to Clipboard!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy Draft</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleGenerateDraft}
                  disabled={generatingDraft}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs disabled:opacity-50 transition-colors cursor-pointer"
                >
                  {generatingDraft ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Generating with Groq...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Generate Customer Reply Draft</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Side Column: Raw Payloads & Audit Trail (1 Col) */}
          <div className="space-y-6">
            {/* Audit Trail for this Case */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-slate-600" />
                  <h3 className="text-xs font-semibold text-slate-900 uppercase tracking-wider">
                    Audit Timeline
                  </h3>
                </div>
                <Clock className="w-3.5 h-3.5 text-slate-400" />
              </div>

              {auditTrail.length === 0 ? (
                <p className="text-xs text-slate-400">No events logged yet for this case.</p>
              ) : (
                <div className="space-y-4">
                  {auditTrail.map((ev) => (
                    <div key={ev.id} className="relative pl-4 border-l-2 border-slate-200 text-xs space-y-1">
                      <div className="absolute -left-[5px] top-1 w-2 h-2 rounded-full bg-blue-600 ring-4 ring-white" />
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-800 capitalize">
                          {ev.event.replace(/_/g, ' ')}
                        </span>
                        <span className="text-[10px] text-slate-400">{formatDate(ev.created_at)}</span>
                      </div>
                      {ev.details && (
                        <div className="text-[11px] text-slate-600 bg-slate-50 p-2 rounded border border-slate-100">
                          {Boolean(ev.details.decision) && <div>Decision: <strong>{String(ev.details.decision)}</strong></div>}
                          {Boolean(ev.details.status) && <div>Status: {String(ev.details.status)}</div>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Technical Payload Inspector */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileCode className="w-4 h-4 text-slate-600" />
                  <h3 className="text-xs font-semibold text-slate-900 uppercase tracking-wider">
                    Raw Stored Payload
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(JSON.stringify(caseData.payload, null, 2));
                  }}
                  className="text-[11px] text-slate-500 hover:text-slate-900 font-medium flex items-center gap-1 hover:underline cursor-pointer"
                  title="Copy JSON Payload"
                >
                  <Copy className="w-3 h-3" />
                  <span>Copy</span>
                </button>
              </div>
              <pre className="p-3.5 bg-slate-900 text-emerald-400 rounded-xl text-[11px] font-mono whitespace-pre-wrap break-all max-h-64 overflow-y-auto leading-relaxed">
                {JSON.stringify(caseData.payload, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      </div>

      {/* Decision Modal */}
      {decisionModal && caseData && (
        <ApprovalModal
          caseData={caseData}
          decisionType={decisionModal}
          isOpen={true}
          onClose={() => setDecisionModal(null)}
          onSuccess={() => {
            fetchCaseDetails();
          }}
          onConflictRefresh={() => {
            fetchCaseDetails();
          }}
        />
      )}
    </AppLayout>
  );
}
