'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { CaseKind, OrderRecord } from '@/lib/types';
import {
  X,
  ShoppingBag,
  RotateCcw,
  PackageX,
  Truck,
  AlertCircle,
  Loader2,
  CheckCircle2,
  Info,
} from 'lucide-react';

interface CreateCaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCaseCreated?: (newCaseId: string) => void;
}

const CASE_TYPES: Array<{
  id: CaseKind;
  name: string;
  badge: string;
  description: string;
  icon: typeof ShoppingBag;
}> = [
  {
    id: 'order',
    name: 'Order Confirmation',
    badge: 'Standard Order',
    description: 'Auto-verify inventory & generate order confirmation proposal.',
    icon: ShoppingBag,
  },
  {
    id: 'return',
    name: 'Return & Refund',
    badge: 'Customer Request',
    description: 'Evaluate return eligibility against store policy & propose refund.',
    icon: RotateCcw,
  },
  {
    id: 'stock',
    name: 'Stock Shortage',
    badge: 'Inventory Shortfall',
    description: 'Detect backorder shortage & generate supplier restock PO proposal.',
    icon: PackageX,
  },
  {
    id: 'delivery',
    name: 'Delivery Escalation',
    badge: 'Carrier Delay',
    description: 'Track shipment status & generate logistics carrier escalation proposal.',
    icon: Truck,
  },
];

export function CreateCaseModal({ isOpen, onClose, onCaseCreated }: CreateCaseModalProps) {
  const router = useRouter();
  const [selectedKind, setSelectedKind] = useState<CaseKind>('order');
  const [selectedOrderId, setSelectedOrderId] = useState<string>('ORD-1001');
  const [customOrderId, setCustomOrderId] = useState<string>('');
  const [returnMessage, setReturnMessage] = useState<string>(
    'The jacket is too small. I want to return it for a refund.'
  );
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRequestId, setLastRequestId] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<{
    caseId: string;
    isDuplicate: boolean;
    status: string;
  } | null>(null);

  // Fetch seeded orders
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    fetch('/api/orders')
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.orders && data.orders.length > 0) {
          setOrders(data.orders);
          setSelectedOrderId(data.orders[0].order_id);
        }
        setLoadingOrders(false);
      })
      .catch(() => {
        if (cancelled) return;
        setOrders([
          {
            tenant_id: 'demo-store',
            order_id: 'ORD-1001',
            data: {
              customer: { name: 'Alice Smith' },
              total_amount: 149.99,
              currency: 'USD',
            },
          },
          {
            tenant_id: 'demo-store',
            order_id: 'ORD-1002',
            data: {
              customer: { name: 'Bob Johnson' },
              total_amount: 179.0,
              currency: 'USD',
            },
          },
        ]);
        setLoadingOrders(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const finalOrderId = customOrderId.trim() || selectedOrderId;

  const handleSubmit = async (e: React.FormEvent, isRetry = false) => {
    e.preventDefault();
    setError(null);
    setSuccessInfo(null);
    setSubmitting(true);

    // Reuse last requestId if explicitly retrying
    const reqId = isRetry && lastRequestId ? lastRequestId : crypto.randomUUID();
    setLastRequestId(reqId);

    try {
      const payload: Record<string, unknown> = {
        kind: selectedKind,
        order_id: finalOrderId,
        request_id: reqId,
      };

      if (selectedKind === 'return') {
        if (!returnMessage.trim()) {
          setError('Please provide the customer return request message.');
          setSubmitting(false);
          return;
        }
        payload.message = returnMessage.trim();
      }

      const res = await fetch('/api/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      let data: Record<string, unknown> = {};
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        data = await res.json();
      } else {
        const text = await res.text();
        try {
          data = JSON.parse(text);
        } catch {
          data = { error: text.slice(0, 200) || `Server returned HTTP ${res.status}` };
        }
      }

      if (!res.ok) {
        throw new Error(
          (data.error as string) ||
            (data.message as string) ||
            `Server returned ${res.status}`
        );
      }

      const caseObj = data.case as { case_id?: string; status?: string } | undefined;
      const createdCaseId = caseObj?.case_id || (data.case_id as string) || 'new-case';
      setSuccessInfo({
        caseId: createdCaseId,
        isDuplicate: Boolean(data.duplicate),
        status: caseObj?.status || 'pending_approval',
      });

      if (onCaseCreated) {
        onCaseCreated(createdCaseId);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create demo case';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const selectedOrderData = orders.find((o) => o.order_id === selectedOrderId);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="relative bg-white rounded-2xl max-w-xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-5 bg-gradient-to-r from-slate-900 to-slate-800 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-600/30 border border-blue-400/30 flex items-center justify-center text-blue-300">
              <ShoppingBag className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Create Demo Case</h2>
              <p className="text-xs text-slate-300">Trigger an Industry AI Operator automation proposal</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {error && (
            <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-3">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <span className="font-semibold block mb-0.5">Submission Failed</span>
                <span className="leading-relaxed">{error}</span>
                {lastRequestId && (
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={(e) => handleSubmit(e, true)}
                      disabled={submitting}
                      className="px-2.5 py-1 bg-rose-600 text-white rounded text-xs font-medium hover:bg-rose-700 transition-colors"
                    >
                      Retry with same Request ID ({lastRequestId.slice(0, 8)}...)
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {successInfo ? (
            <div className="p-5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 space-y-3 text-sm">
              <div className="flex items-center gap-2 font-semibold text-emerald-800">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <span>
                  {successInfo.isDuplicate
                    ? 'Existing Case Retrieved (Idempotent Request)'
                    : 'Demo Case Created Successfully'}
                </span>
              </div>
              <p className="text-xs text-emerald-700">
                Case ID: <span className="font-mono font-semibold">{successInfo.caseId}</span>
              </p>
              {successInfo.isDuplicate ? (
                <p className="text-xs text-slate-600">
                  This request used a previously registered request_id. No duplicate case was created, preserving idempotent safety.
                </p>
              ) : (
                <p className="text-xs text-slate-600">
                  The AI Operator evaluated the order data and created a proposal awaiting owner review.
                </p>
              )}
              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    router.push(`/cases/${successInfo.caseId}`);
                  }}
                  className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors"
                >
                  View Case Details
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSuccessInfo(null);
                  }}
                  className="px-3 py-2 bg-white border border-emerald-300 text-emerald-800 hover:bg-emerald-100 rounded-lg text-xs font-medium transition-colors"
                >
                  Create Another
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={(e) => handleSubmit(e, false)} className="space-y-5">
              {/* Step 1: Select Case Kind */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                  1. Select Automation Workflow
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {CASE_TYPES.map((type) => {
                    const Icon = type.icon;
                    const isSelected = selectedKind === type.id;
                    return (
                      <button
                        key={type.id}
                        type="button"
                        onClick={() => setSelectedKind(type.id)}
                        className={`p-3 rounded-xl text-left border transition-all flex flex-col justify-between ${
                          isSelected
                            ? 'bg-blue-50/70 border-blue-500 ring-2 ring-blue-500/20 shadow-xs'
                            : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <div
                            className={`p-1.5 rounded-md ${
                              isSelected ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            <Icon className="w-3.5 h-3.5" />
                          </div>
                          <span className="text-xs font-semibold text-slate-900">{type.name}</span>
                        </div>
                        <p className="text-[11px] text-slate-500 leading-snug">{type.description}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Step 2: Select Seeded Order */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                  2. Select Target Order
                </label>
                {loadingOrders ? (
                  <div className="p-4 border rounded-xl flex items-center justify-center gap-2 text-xs text-slate-500">
                    <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                    <span>Loading seeded orders from PostgreSQL...</span>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <select
                      value={selectedOrderId}
                      onChange={(e) => {
                        setSelectedOrderId(e.target.value);
                        setCustomOrderId('');
                      }}
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-medium text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                    >
                      {orders.map((ord) => (
                        <option key={ord.order_id} value={ord.order_id}>
                          {ord.order_id} — {ord.data?.customer?.name || 'Customer'} (
                          {ord.data?.currency || 'USD'} {ord.data?.total_amount || '—'})
                        </option>
                      ))}
                      <option value="custom">+ Use Custom Order ID...</option>
                    </select>

                    {selectedOrderId === 'custom' && (
                      <input
                        type="text"
                        placeholder="e.g. ORD-9999"
                        value={customOrderId}
                        onChange={(e) => setCustomOrderId(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-medium text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                        required
                      />
                    )}

                    {selectedOrderData && selectedOrderId !== 'custom' && (
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 space-y-1">
                        <div className="flex justify-between">
                          <span className="text-slate-500">Customer:</span>
                          <span className="font-medium text-slate-900">
                            {selectedOrderData.data?.customer?.name || '—'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Items:</span>
                          <span className="font-medium text-slate-900">
                            {selectedOrderData.data?.items?.map((i) => `${i.name} (x${i.qty})`).join(', ') ||
                              '1 Item'}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Step 3: Additional Inputs for Return */}
              {selectedKind === 'return' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                    3. Customer Return Message
                  </label>
                  <textarea
                    rows={3}
                    value={returnMessage}
                    onChange={(e) => setReturnMessage(e.target.value)}
                    placeholder="Enter customer reason or quote..."
                    className="w-full p-3 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 leading-relaxed"
                    required
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    The n8n workflow parses this message against return window policies to formulate the refund proposal.
                  </p>
                </div>
              )}

              <div className="p-3 bg-blue-50/60 border border-blue-200 rounded-xl flex items-start gap-2.5 text-xs text-blue-900">
                <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <span className="leading-snug">
                  Case proposals will be generated in <strong>pending_approval</strong> status. No external simulated action will execute without explicit owner authorization.
                </span>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-lg text-xs font-semibold shadow-xs focus:outline-hidden focus:ring-2 focus:ring-blue-500 disabled:opacity-50 transition-all cursor-pointer"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Submitting to n8n...</span>
                    </>
                  ) : (
                    <span>Generate AI Proposal</span>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
