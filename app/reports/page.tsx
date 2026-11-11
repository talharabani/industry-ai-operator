'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { DailySummarySnapshot, SummaryStats } from '@/lib/types';
import { formatDate } from '@/lib/utils';
import {
  BarChart3,
  Calendar,
  FileSpreadsheet,
  Loader2,
  Info,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

export default function ReportsPage() {
  const [snapshots, setSnapshots] = useState<DailySummarySnapshot[]>([]);
  const [liveSummary, setLiveSummary] = useState<SummaryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'snapshots' | 'live'>('snapshots');
  const [expandedId, setExpandedId] = useState<number | string | null>(null);

  const fetchData = useCallback(async () => {
    setRefreshing(true);
    try {
      const [snapRes, liveRes] = await Promise.all([
        fetch('/api/reports'),
        fetch('/api/summary'),
      ]);

      if (snapRes.ok) {
        const snapData = await snapRes.json();
        setSnapshots(snapData.snapshots || []);
      }

      if (liveRes.ok) {
        const liveData = await liveRes.json();
        setLiveSummary(liveData);
      }
    } catch (err) {
      console.error('Failed to load reports:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [snapRes, liveRes] = await Promise.all([
          fetch('/api/reports'),
          fetch('/api/summary'),
        ]);
        if (!active) return;

        if (snapRes.ok) {
          const snapData = await snapRes.json();
          if (active) setSnapshots(snapData.snapshots || []);
        }

        if (liveRes.ok) {
          const liveData = await liveRes.json();
          if (active) setLiveSummary(liveData);
        }
      } catch (err) {
        console.error('Failed to load reports:', err);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const toggleExpand = (id: number | string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <AppLayout onRefresh={fetchData} isRefreshing={refreshing}>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-blue-600" />
              <span>Operations Reports & Daily Summaries</span>
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Historical daily audit snapshots and live 24-hour operations status.
            </p>
          </div>

          {/* Tab switcher */}
          <div className="flex items-center bg-slate-200/70 p-1 rounded-xl text-xs font-medium">
            <button
              type="button"
              onClick={() => setActiveTab('snapshots')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                activeTab === 'snapshots'
                  ? 'bg-white text-slate-900 shadow-xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Saved Daily Snapshots ({snapshots.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('live')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                activeTab === 'live'
                  ? 'bg-white text-slate-900 shadow-xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Live Operations Summary
            </button>
          </div>
        </div>

        {/* Tab 1: Saved Daily Snapshots */}
        {activeTab === 'snapshots' && (
          <div className="space-y-4">
            <div className="bg-blue-50/70 border border-blue-200 p-4 rounded-xl flex items-start gap-3 text-xs text-blue-900">
              <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <span className="font-semibold block">Automatic Audit Snapshots</span>
                <p className="text-blue-800 leading-relaxed">
                  Daily snapshots are written directly to PostgreSQL (`iao.audit` where `event = &apos;daily_summary&apos;`) by the n8n scheduled workflow. No duplicate scheduler is executed in Next.js.
                </p>
              </div>
            </div>

            {loading ? (
              <div className="bg-white p-16 rounded-2xl border border-slate-200 text-center space-y-2 text-xs text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin text-blue-600 mx-auto" />
                <span>Retrieving daily snapshots from PostgreSQL...</span>
              </div>
            ) : snapshots.length === 0 ? (
              <div className="bg-white p-16 rounded-2xl border border-slate-200 text-center space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                  <FileSpreadsheet className="w-6 h-6" />
                </div>
                <h2 className="text-sm font-semibold text-slate-900">No Saved Daily Snapshots Found</h2>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  No automated `daily_summary` audit entries have been generated yet by the scheduled n8n runner. Once the scheduled cron triggers in n8n, snapshot entries will appear here automatically.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {snapshots.map((snap) => {
                  const isExpanded = expandedId === snap.id;
                  const details = snap.details || {};
                  return (
                    <div
                      key={snap.id}
                      className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden transition-all"
                    >
                      <div
                        onClick={() => toggleExpand(snap.id)}
                        className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 cursor-pointer hover:bg-slate-50/70 select-none"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
                            <Calendar className="w-5 h-5" />
                          </div>
                          <div>
                            <div className="text-sm font-bold text-slate-900">
                              Snapshot: {formatDate(snap.created_at)}
                            </div>
                            <div className="text-xs text-slate-500 font-mono">
                              Tenant: {snap.tenant_id} • Period: {details.period_hours || 24}h
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-6">
                          <div className="grid grid-cols-3 gap-4 text-center">
                            <div>
                              <div className="text-xs font-bold text-slate-900">
                                {details.completed_last_24h ?? '—'}
                              </div>
                              <div className="text-[10px] text-slate-400">Completed</div>
                            </div>
                            <div>
                              <div className="text-xs font-bold text-slate-900">
                                {details.cases_created_last_24h ?? '—'}
                              </div>
                              <div className="text-[10px] text-slate-400">Created</div>
                            </div>
                            <div>
                              <div className="text-xs font-bold text-amber-600">
                                {details.pending_approvals_all_time ?? '—'}
                              </div>
                              <div className="text-[10px] text-slate-400">Pending</div>
                            </div>
                          </div>

                          <div className="p-1 rounded-lg text-slate-400">
                            {isExpanded ? (
                              <ChevronUp className="w-5 h-5" />
                            ) : (
                              <ChevronDown className="w-5 h-5" />
                            )}
                          </div>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="p-5 bg-slate-50 border-t border-slate-200 space-y-4 text-xs">
                          {/* Structured Metric Grid */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-2xs">
                              <span className="text-[11px] font-medium text-slate-500 block">
                                Completed (24h)
                              </span>
                              <span className="text-base font-bold text-slate-900 mt-0.5 block">
                                {details.completed_last_24h ?? 0} cases
                              </span>
                            </div>

                            <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-2xs">
                              <span className="text-[11px] font-medium text-slate-500 block">
                                Created (24h)
                              </span>
                              <span className="text-base font-bold text-slate-900 mt-0.5 block">
                                {details.cases_created_last_24h ?? 0} cases
                              </span>
                            </div>

                            <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-2xs">
                              <span className="text-[11px] font-medium text-slate-500 block">
                                Pending Approvals
                              </span>
                              <span className="text-base font-bold text-amber-600 mt-0.5 block">
                                {details.pending_approvals_all_time ?? 0} cases
                              </span>
                            </div>

                            <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-2xs">
                              <span className="text-[11px] font-medium text-slate-500 block">
                                Execution Mode
                              </span>
                              <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 mt-1 inline-block">
                                {details.mode === 'demo' ? 'Simulation (Demo)' : 'Live'}
                              </span>
                            </div>
                          </div>

                          {/* Open Cases in this snapshot */}
                          {Array.isArray(details.open_cases) && details.open_cases.length > 0 ? (
                            <div className="space-y-1.5 pt-1">
                              <span className="font-semibold text-slate-700 block uppercase tracking-wider text-[11px]">
                                Active Open Cases in Snapshot ({details.open_cases.length})
                              </span>
                              <div className="space-y-1">
                                {details.open_cases.map((c: Record<string, unknown>, idx: number) => (
                                  <div
                                    key={idx}
                                    className="p-2.5 bg-white rounded-lg border border-slate-200 flex items-center justify-between text-xs"
                                  >
                                    <span className="font-mono font-medium text-slate-800">
                                      {String(c.case_id || 'Case')}
                                    </span>
                                    <span className="font-mono text-slate-500 text-[11px]">
                                      Status: {String(c.status || 'open')}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <div className="p-3 bg-white rounded-xl border border-slate-200 text-slate-500 text-[11px] flex items-center justify-between">
                              <span>No backlog of pending cases was recorded at snapshot time.</span>
                              <span className="text-emerald-600 font-semibold font-mono">0 Backlog</span>
                            </div>
                          )}

                          {/* Collapsible Raw JSON Inspector */}
                          <details className="text-xs group pt-1">
                            <summary className="cursor-pointer text-slate-600 hover:text-slate-900 font-medium select-none flex items-center justify-between">
                              <span className="font-mono text-[11px]">View Raw Snapshot JSON Payload</span>
                              <span className="text-[11px] text-blue-600 group-open:rotate-180 transition-transform">
                                ▼
                              </span>
                            </summary>
                            <pre className="mt-2 p-3.5 bg-slate-900 text-emerald-400 rounded-xl text-[11px] font-mono overflow-x-auto max-h-56">
                              {JSON.stringify(snap, null, 2)}
                            </pre>
                          </details>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Live Operations Summary */}
        {activeTab === 'live' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-1">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Completed in last 24 hours
                </span>
                <div className="text-2xl font-bold text-slate-900">
                  {liveSummary?.completed_last_24h ?? 0}
                </div>
                <p className="text-[11px] text-slate-500">Live tally of approved/settled cases</p>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-1">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Created in last 24 hours
                </span>
                <div className="text-2xl font-bold text-slate-900">
                  {liveSummary?.cases_created_last_24h ?? 0}
                </div>
                <p className="text-[11px] text-slate-500">New workflow proposals initiated</p>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-1">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Pending approvals — all time
                </span>
                <div className="text-2xl font-bold text-amber-600">
                  {liveSummary?.pending_approvals_all_time ?? 0}
                </div>
                <p className="text-[11px] text-slate-500">Cases currently awaiting owner decision</p>
              </div>
            </div>

            {liveSummary?.open_cases && liveSummary.open_cases.length > 0 && (
              <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
                <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                  Currently Open Cases in Pipeline
                </h3>
                <div className="divide-y divide-slate-100">
                  {liveSummary.open_cases.map((c) => (
                    <div key={c.case_id} className="py-2.5 flex items-center justify-between text-xs">
                      <span className="font-mono font-medium text-slate-900">{c.case_id}</span>
                      <span className="capitalize text-slate-600">{c.kind}</span>
                      <span className="font-mono text-slate-400">Rev {c.revision}</span>
                      <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-800 text-[11px] font-semibold border border-amber-200">
                        {c.status.replace(/_/g, ' ')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
