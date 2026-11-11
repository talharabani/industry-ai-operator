'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { HealthStatus } from '@/lib/types';
import {
  Activity,
  Database,
  Workflow,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  ShoppingBag,
  MessageSquare,
  Mail,
  Truck,
} from 'lucide-react';

const EXTERNAL_CHANNELS = [
  {
    name: 'Shopify Storefront',
    icon: ShoppingBag,
    status: 'Simulated Sandbox',
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
    description: 'Order intake and catalog synchronizations are simulated via local PostgreSQL records (ORD-1001, ORD-1002).',
  },
  {
    name: 'WhatsApp Business API',
    icon: MessageSquare,
    status: 'Simulated Sandbox',
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
    description: 'Customer inquiries and return requests are formulated through local operator payloads; no real WhatsApp messages dispatched.',
  },
  {
    name: 'Customer Email Dispatch (SMTP)',
    icon: Mail,
    status: 'Simulated Sandbox',
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
    description: 'Groq drafts generated in n8n remain review-only plain text inside the dashboard workspace.',
  },
  {
    name: 'Logistics Courier Partner API',
    icon: Truck,
    status: 'Simulated Sandbox',
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
    description: 'Delivery delay escalation proposals are generated for review without real carrier webhook triggers.',
  },
];

export default function ConnectionsPage() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [shopifyInfo, setShopifyInfo] = useState<{
    is_connected: boolean;
    shop_domain?: string;
    product_count?: number;
    order_count?: number;
    sync_status?: string;
    last_error?: string | null;
  } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchHealth = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/health');
      if (res.ok) {
        const data: HealthStatus = await res.json();
        setHealth(data);
      }

      const spRes = await fetch('/api/business/connections/shopify');
      if (spRes.ok) {
        const spData = await spRes.json();
        setShopifyInfo(spData.shopify || null);
      }
    } catch (err) {
      console.error('Failed to fetch health:', err);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/health');
        if (res.ok && active) {
          const data: HealthStatus = await res.json();
          setHealth(data);
        }
        const spRes = await fetch('/api/business/connections/shopify');
        if (spRes.ok && active) {
          const spData = await spRes.json();
          setShopifyInfo(spData.shopify || null);
        }
      } catch (err) {
        console.error('Failed to test health on mount:', err);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  return (
    <AppLayout onRefresh={fetchHealth} isRefreshing={refreshing}>
      <div className="space-y-6 max-w-5xl">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <Activity className="w-5 h-5 text-blue-600" />
              <span>System Health & Integration Connectors</span>
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Live backend connectivity verification and simulation status for external channels.
            </p>
          </div>

          <button
            type="button"
            onClick={fetchHealth}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 shadow-xs transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-blue-600' : 'text-slate-500'}`} />
            <span>Test Connection Health</span>
          </button>
        </div>

        {/* Core Infrastructure Connections */}
        <div className="space-y-3">
          <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider block">
            Core Local Infrastructure
          </span>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* PostgreSQL Card */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600">
                    <Database className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">PostgreSQL Database</h3>
                    <span className="text-xs text-slate-400 font-mono">localhost:5433 / iao_demo</span>
                  </div>
                </div>

                {health?.database.connected ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    Connected
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                    <XCircle className="w-3.5 h-3.5 text-rose-600" />
                    Disconnected
                  </span>
                )}
              </div>

              <div className="text-xs space-y-2 pt-2 border-t border-slate-100">
                <div className="flex justify-between text-slate-600">
                  <span>Schema:</span>
                  <span className="font-mono font-medium text-slate-900">iao</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Tables Found:</span>
                  <span className="font-mono font-medium text-slate-900">
                    {health?.database.tablesFound?.join(', ') || (health?.database.connected ? 'None' : '—')}
                  </span>
                </div>
                {health?.database.error && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-[11px] leading-relaxed">
                    <strong>Connection Error:</strong> {health.database.error}
                  </div>
                )}
              </div>
            </div>

            {/* n8n Webhook Workflow Engine */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-orange-50 border border-orange-200 flex items-center justify-center text-orange-600">
                    <Workflow className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">n8n Workflow Engine</h3>
                    <span className="text-xs text-slate-400 font-mono">
                      {health?.n8n.url || 'http://localhost:5678'}
                    </span>
                  </div>
                </div>

                {health?.n8n.reachable ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    Reachable
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                    Unreachable
                  </span>
                )}
              </div>

              <div className="text-xs space-y-2 pt-2 border-t border-slate-100">
                <div className="flex justify-between text-slate-600">
                  <span>Operator Webhooks:</span>
                  <span className="font-mono font-medium text-slate-900">/webhook/iao/*</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Auth Header:</span>
                  <span className="font-mono font-medium text-slate-900">X-Operator-Key</span>
                </div>
                {health?.n8n.error && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-[11px] leading-relaxed">
                    <strong>Ping Notice:</strong> {health.n8n.error}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* External Simulated Channels */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
              External Integration Connectors
            </span>
            <span className="text-[11px] text-slate-400">Sandbox Environment</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {EXTERNAL_CHANNELS.map((ch, idx) => {
              const Icon = ch.icon;
              const isShopifyCard = ch.name.includes('Shopify');
              const isShopifyActive = Boolean(isShopifyCard && shopifyInfo?.is_connected);
              const isShopifyBlocked =
                isShopifyActive &&
                (shopifyInfo?.sync_status === 'partial_failed' ||
                  (shopifyInfo?.last_error &&
                    (shopifyInfo.last_error.includes('order access blocked') ||
                      shopifyInfo.last_error.includes('protected customer data') ||
                      shopifyInfo.last_error.includes('REST endpoints with protected customer data'))));

              const statusText = isShopifyBlocked
                ? 'Products synced; order access blocked'
                : isShopifyActive
                ? 'Live Connected'
                : ch.status;
              const badgeClass = isShopifyBlocked
                ? 'bg-amber-50 text-amber-800 border-amber-300'
                : isShopifyActive
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : ch.badgeClass;
              const description = isShopifyActive
                ? isShopifyBlocked
                  ? `Connected to ${shopifyInfo?.shop_domain}. ${shopifyInfo?.product_count || 0} products synced. Order access restricted pending Protected Customer Data approval.`
                  : `Connected to ${shopifyInfo?.shop_domain}. Active sync tracking ${shopifyInfo?.product_count || 0} products and ${shopifyInfo?.order_count || 0} orders.`
                : ch.description;
              const footerText = isShopifyActive
                ? 'AES-256-GCM encrypted OAuth session'
                : 'No production credentials configured';

              return (
                <div
                  key={idx}
                  className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-2.5 flex flex-col justify-between"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5 font-semibold text-xs text-slate-900">
                        <div className={`p-1.5 rounded-lg ${isShopifyActive ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-700'}`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <span>{ch.name}</span>
                      </div>
                      <span
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${badgeClass}`}
                      >
                        {statusText}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 leading-relaxed">{description}</p>
                  </div>

                  <div className={`text-[10px] font-mono pt-2 border-t border-slate-100 ${isShopifyActive ? 'text-emerald-700' : 'text-slate-400'}`}>
                    {footerText}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
